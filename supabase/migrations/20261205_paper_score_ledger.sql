-- paper-score.1: the reserved form owns its scoring policy; future forms are scored over DELIVERED items.
-- Forms reserved before this migration keep '1.0' (answered-only) and are never rewritten. A paper with no answers is a completed
-- submission scoring 0 with an unknown answered accuracy, not an error. The caller's p_scoring_policy argument is ignored.
alter table public.assessment_forms add column if not exists scoring_policy text not null default '1.0';
alter table public.assessment_forms alter column scoring_policy set default 'paper-score.1';
alter table public.assessment_attempts add column if not exists delivered_count integer, add column if not exists omitted_count integer;

create or replace function public.finalize_assessment_attempt(p_attempt_id uuid, p_scoring_policy text, p_evidence_policy text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_attempt record;
  v_response record;
  v_item record;
  v_total int := 0;
  v_correct int := 0;
  v_score int;
  v_evidence_written int := 0;
  v_evidence_mode text;
  v_evidence_state text;
  v_error_code text;
  v_trust_tier text;
  v_diagnoses jsonb;
  v_manifest_id uuid;
  v_purpose text;
  v_is_check boolean;
  v_concept record;
  v_thread record;
  v_state text;
  v_check_state text;
  v_policy jsonb := public.repair_resolution_policy();
  v_pol text;
  v_paper boolean;
  v_delivered int;
  v_answered int := 0;
  v_answered_correct int := 0;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select * into v_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = v_user_id for update;
  if v_attempt is null then raise exception 'Attempt not found'; end if;

  if v_attempt.status = 'scored' then
    return json_build_object('ok', true, 'alreadyScored', true, 'score', v_attempt.score, 'evidenceWritten', 0)::jsonb;
  end if;

  -- The RESERVED FORM owns the scoring policy. The caller's argument cannot choose a more favourable one.
  select coalesce(f.scoring_policy, '1.0') into v_pol from public.assessment_forms f where f.id = v_attempt.form_id;
  v_pol := coalesce(v_pol, '1.0');
  v_paper := v_pol = 'paper-score.1';

  for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id loop
    v_total := v_total + 1;
    if v_response.is_correct then v_correct := v_correct + 1; end if;
    if v_response.selected_option_index is not null then
      v_answered := v_answered + 1;
      if v_response.is_correct then v_answered_correct := v_answered_correct + 1; end if;
    end if;
  end loop;
  if v_paper then
    -- paper-score.1: correct over DELIVERED form items. An omission earns no mark and is not evidence of a miss.
    select count(*) into v_delivered from public.form_items where form_id = v_attempt.form_id;
    v_total := v_answered; v_correct := v_answered_correct;
    v_score := case when v_delivered > 0 then round((v_correct::numeric / v_delivered::numeric) * 100) else null end;
  else
    if v_total = 0 then raise exception 'No responses found'; end if;
    v_delivered := v_total;
    v_score := round((v_correct::numeric / v_total::numeric) * 100);
  end if;

  v_evidence_mode := 'evidence';
  for v_item in select ai.review_status from public.assessment_items ai join public.assessment_responses ar on ai.id = ar.item_id where ar.attempt_id = p_attempt_id loop
    if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;
  end loop;

  if v_paper then
    -- An item the student never answered is still on the form: its trust tier decides whether the paper can be evidence.
    for v_item in select ai.review_status from public.form_items fi join public.assessment_items ai on ai.id = fi.item_id where fi.form_id = v_attempt.form_id loop
      if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;
    end loop;
  end if;

  update public.assessment_attempts set
    delivered_count = v_delivered, omitted_count = greatest(v_delivered - v_total, 0),
    status = 'scored', score = v_score, completed_at = coalesce(completed_at, now()), evidence_mode = v_evidence_mode,
    scoring_policy_version = v_pol, evidence_policy_version = p_evidence_policy,
    valid_response_count = v_total, correct_response_count = v_correct
  where id = p_attempt_id;

  if v_attempt.form_id is not null then
    select b.manifest_id, b.purpose into v_manifest_id, v_purpose
      from public.assessment_forms f join public.assessment_blueprints b on b.id = f.blueprint_id where f.id = v_attempt.form_id;
  end if;
  if v_manifest_id is null then select id into v_manifest_id from public.curriculum_manifests where is_active = true limit 1; end if;
  v_is_check := coalesce(v_purpose, '') = 'repair_recheck';

  if v_evidence_mode = 'evidence' then
    for v_response in select ar.*, ai.concept_id, ai.item_card, ai.review_status from public.assessment_responses ar join public.assessment_items ai on ar.item_id = ai.id where ar.attempt_id = p_attempt_id loop
      if v_response.concept_id is not null then
        v_evidence_state := 'insufficient';
        if v_response.is_correct = false then v_evidence_state := 'needs_repair';
        elsif v_response.is_correct = true and v_response.self_reported_confidence is not null and v_response.self_reported_confidence <= 2 then v_evidence_state := 'unstable';
        elsif v_response.is_correct = true then v_evidence_state := 'supported'; end if;

        v_error_code := null;
        if v_response.is_correct = false then
          begin
            v_diagnoses := v_response.item_card->'distractorDiagnoses';
            select obj->>'errorCode' into v_error_code from jsonb_array_elements(v_diagnoses) obj where (obj->>'optionIndex')::int = v_response.selected_option_index limit 1;
          exception when others then v_error_code := null; end;
        end if;
        v_trust_tier := v_response.review_status;

        insert into public.evidence_events (
          user_id, attempt_id, item_id, concept_id, validity, is_correct, evidence_state, error_code, response_id, assessment_purpose, evidence_mode, item_trust_tier, self_reported_confidence, scoring_policy_version
        ) values (
          v_user_id, p_attempt_id, v_response.item_id, v_response.concept_id, 'valid', v_response.is_correct, v_evidence_state, v_error_code, v_response.id, coalesce(v_purpose, 'practice'), v_evidence_mode, v_trust_tier, v_response.self_reported_confidence, v_pol
        ) on conflict (attempt_id, item_id, scoring_policy_version) do nothing;
        v_evidence_written := v_evidence_written + 1;
      end if;
    end loop;

    -- ONE decision per concept per paper. Several wrong answers on a concept in the same paper are one episode.
    for v_concept in
      select e.concept_id, count(*) as n,
             bool_or(e.evidence_state = 'needs_repair') as miss, bool_or(e.evidence_state = 'unstable') as unstable
      from public.evidence_events e
      where e.attempt_id = p_attempt_id and e.user_id = v_user_id and e.validity = 'valid'
      group by e.concept_id
    loop
      v_state := case when v_concept.miss then 'needs_repair' when v_concept.unstable then 'unstable' else 'supported' end;
      select * into v_thread from public.repair_threads t
        where t.user_id = v_user_id and t.concept_id = v_concept.concept_id and t.manifest_id = v_manifest_id
          and t.status not in ('closed', 'cancelled', 'superseded') for update;

      if v_state in ('needs_repair', 'unstable') then
        v_check_state := case when v_state = 'needs_repair' then 'still_needs_work' else 'uncertain' end;
        if v_thread.id is null then
          insert into public.repair_threads (user_id, concept_id, manifest_id, status, severity, occurrence_count, opened_from_attempt_id, latest_evidence_at, updated_at, policy_version, latest_attempt_id)
            values (v_user_id, v_concept.concept_id, v_manifest_id, 'open', v_state, 1, p_attempt_id, now(), now(), p_evidence_policy, p_attempt_id)
            returning * into v_thread;
          insert into public.repair_thread_events(thread_id, event_type, details)
            values (v_thread.id, 'opened', jsonb_build_object('attemptId', p_attempt_id, 'state', v_state, 'questions', v_concept.n));
        elsif v_thread.latest_attempt_id is distinct from p_attempt_id then
          update public.repair_threads set
            severity = v_state, occurrence_count = occurrence_count + 1, latest_evidence_at = now(), updated_at = now(),
            revision = revision + 1, latest_attempt_id = p_attempt_id,
            status = case when status = 'awaiting_recheck' then 'open' else status end,
            -- A check's verdict describes the evidence at that time. Newer evidence from an ordinary paper retires it,
            -- so an older "supported" can never sit beside a newer miss.
            latest_check_state = case when v_is_check then v_check_state else null end,
            latest_check_attempt_id = case when v_is_check then p_attempt_id else null end,
            latest_check_at = case when v_is_check then now() else null end
          where id = v_thread.id;
          insert into public.repair_thread_events(thread_id, event_type, details)
            values (v_thread.id, case when v_is_check then 'check_' || v_check_state else 'new_evidence' end,
                    jsonb_build_object('attemptId', p_attempt_id, 'state', v_state, 'questions', v_concept.n));
        end if;
      elsif v_is_check and v_thread.id is not null and v_thread.status = 'awaiting_recheck' then
        -- Supported on THIS check. It is recorded; it does not close the gap unless the policy says how many answers resolve one.
        update public.repair_threads set latest_check_state = 'supported', latest_check_attempt_id = p_attempt_id, latest_check_at = now(),
          updated_at = now(), revision = revision + 1,
          status = case when coalesce((v_policy->>'autoClose')::boolean, false) and v_concept.n >= coalesce((v_policy->>'minValidQuestions')::int, 2147483647) then 'closed' else status end,
          closed_at = case when coalesce((v_policy->>'autoClose')::boolean, false) and v_concept.n >= coalesce((v_policy->>'minValidQuestions')::int, 2147483647) then now() else closed_at end,
          closure_reason = case when coalesce((v_policy->>'autoClose')::boolean, false) and v_concept.n >= coalesce((v_policy->>'minValidQuestions')::int, 2147483647) then 'supported_on_check:' || (v_policy->>'version') else closure_reason end
        where id = v_thread.id;
        insert into public.repair_thread_events(thread_id, event_type, details)
          values (v_thread.id, 'check_supported', jsonb_build_object('attemptId', p_attempt_id, 'questions', v_concept.n, 'policy', v_policy->>'version'));
      end if;
    end loop;

    -- A re-check names the repairs it was for. One it could not assess stays open and says so; it is never closed by omission.
    if v_is_check then
      for v_thread in
        select t.* from public.repair_threads t
        join public.repair_check_threads l on l.thread_id = t.id
        join public.plan_blocks b on b.id = l.check_task_id and b.attempt_id = p_attempt_id
        where t.user_id = v_user_id and t.status not in ('closed', 'cancelled', 'superseded')
          and not exists (select 1 from public.evidence_events e where e.attempt_id = p_attempt_id and e.concept_id = t.concept_id and e.validity = 'valid')
        for update of t
      loop
        update public.repair_threads set latest_check_state = 'not_assessed', latest_check_attempt_id = p_attempt_id, latest_check_at = now(), updated_at = now(), revision = revision + 1 where id = v_thread.id;
        insert into public.repair_thread_events(thread_id, event_type, details) values (v_thread.id, 'check_not_assessed', jsonb_build_object('attemptId', p_attempt_id));
      end loop;
    end if;
  end if;

  return json_build_object('ok', true, 'attemptId', p_attempt_id, 'score', v_score, 'evidenceWritten', v_evidence_written, 'mode', v_evidence_mode, 'policy', v_pol, 'delivered', v_delivered, 'answered', v_total, 'omitted', greatest(v_delivered - v_total, 0))::jsonb;
end;
$function$;

grant execute on function public.finalize_assessment_attempt(uuid, text, text) to authenticated;
