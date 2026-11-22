-- Repairs, re-checks and Calendar acceptance: one traceable loop.
--   diagnostic -> evidence -> ONE active thread per concept -> saved proposal -> guarded acceptance
--   -> repair work -> dependency-safe re-check of EXACTLY the repaired scope -> evidence -> thread state.
-- Additive: no applied migration is edited. Replaces three live functions (finalize_assessment_attempt,
-- resolve_item_challenge, accept path of repairs) and retires one unsafe one (apply_diagnostic_repair_proposal).

-- 0. Students may read their evidence and repair state. They may not write it. ----------------------------
-- The application writes these tables only with the server key or through guarded functions; a signed-in
-- student's own token must not be able to void evidence, mark a wrong answer correct or close a gap.
revoke insert, update, delete, truncate on public.evidence_events, public.item_challenges, public.repair_threads,
  public.repair_thread_events, public.repair_queue, public.coach_proposals, public.assessment_responses from anon, authenticated;
-- Attempts are still created with the student's session; updating or deleting them is not theirs to do.
revoke update, delete, truncate on public.assessment_attempts from anon, authenticated;

-- The old applier took caller-supplied task rows and updated any thread id. It is retired, not patched.
revoke execute on function public.apply_diagnostic_repair_proposal(uuid, jsonb) from public, anon, authenticated;

-- 1. The smallest additions the loop needs ---------------------------------------------------------------
alter table public.repair_threads
  add column latest_attempt_id uuid references public.assessment_attempts(id) on delete set null,
  add column latest_check_state text check (latest_check_state in ('supported', 'still_needs_work', 'uncertain', 'not_assessed')),
  add column latest_check_attempt_id uuid references public.assessment_attempts(id) on delete set null,
  add column latest_check_at timestamptz;

-- Saved proposals reuse coach_proposals (origin 'diagnostic'): there is no second proposal system.
alter table public.coach_proposals
  add column source_version text, add column expires_at timestamptz, add column accept_receipt jsonb;

-- Account deletion must keep working now that threads carry history: events go with their thread, and a task's link to a
-- deleted thread is cleared rather than blocking the delete.
alter table public.repair_thread_events drop constraint repair_thread_events_thread_id_fkey,
  add constraint repair_thread_events_thread_id_fkey foreign key (thread_id) references public.repair_threads(id) on delete cascade;
alter table public.plan_blocks drop constraint plan_blocks_repair_thread_id_fkey,
  add constraint plan_blocks_repair_thread_id_fkey foreign key (repair_thread_id) references public.repair_threads(id) on delete set null;

-- A re-check names the repairs it checks. One check can cover several repairs; a repair has one active check.
create table public.repair_check_threads (
  check_task_id text not null references public.plan_blocks(id) on delete cascade,
  thread_id uuid not null references public.repair_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (check_task_id, thread_id)
);
create index repair_check_threads_thread_idx on public.repair_check_threads(thread_id);
create index repair_check_threads_user_idx on public.repair_check_threads(user_id);
alter table public.repair_check_threads enable row level security;
create policy repair_check_threads_read_own on public.repair_check_threads for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.repair_check_threads from anon, authenticated;
grant select on public.repair_check_threads to authenticated;

-- 2. Resolution policy: deliberately NOT decided here. ---------------------------------------------------
-- The only documented criterion is the same-attempt reducer ("supported" = every valid answer on the concept
-- correct, none low-confidence). How many questions are enough to RESOLVE a gap is a product decision that has
-- not been made, so automatic closure is off. Changing this is a new migration with a new version string.
create function public.repair_resolution_policy() returns jsonb language sql immutable as $$
  select jsonb_build_object('version', 'unset', 'autoClose', false, 'minValidQuestions', null)
$$;

-- 3. A repair thread follows its repair work -------------------------------------------------------------
-- Started work moves it on; finishing every logical portion makes it ready for its re-check; cancelling all of
-- it reopens it. Finishing work never closes it: only a qualifying scored check can change what is demonstrated.
create function public.sync_repair_thread_state() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_thread uuid := coalesce(new.repair_thread_id, old.repair_thread_id);
  v_type text := coalesce(new.task_type, old.task_type);
  v_status text; v_total int; v_done int; v_started int; v_next text;
begin
  if v_thread is null or v_type is distinct from 'repair' then return coalesce(new, old); end if;
  select status into v_status from public.repair_threads where id = v_thread for update;
  if v_status is null or v_status in ('closed', 'cancelled', 'superseded') then return coalesce(new, old); end if;
  if v_status in ('open', 'proposed') and tg_op <> 'INSERT' then return coalesce(new, old); end if;
  -- Logical portions: not cancelled, and not already continued by a later week's task.
  select count(*), count(*) filter (where b.execution = 'completed'), count(*) filter (where b.execution in ('in_progress', 'partial'))
    into v_total, v_done, v_started
  from public.plan_blocks b
  where b.repair_thread_id = v_thread and b.task_type = 'repair' and b.cancelled_at is null and b.execution <> 'cancelled'
    and not exists (select 1 from public.plan_blocks s where s.continued_from_task_id = b.id);
  v_next := case when v_total = 0 then 'open' when v_done = v_total then 'awaiting_recheck'
                 when v_started > 0 or v_done > 0 then 'in_progress' else 'scheduled' end;
  if v_next is distinct from v_status then
    update public.repair_threads set status = v_next, revision = revision + 1, updated_at = now() where id = v_thread;
    insert into public.repair_thread_events(thread_id, event_type, details)
      values (v_thread, 'status_changed', jsonb_build_object('from', v_status, 'to', v_next, 'portions', v_total, 'done', v_done));
  end if;
  return coalesce(new, old);
end; $$;
create trigger plan_blocks_repair_thread_state after insert or delete or update of execution, cancelled_at on public.plan_blocks
  for each row execute function public.sync_repair_thread_state();

-- 4. Scoring: one episode per concept per PAPER, and the result reaches the thread ------------------------
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select * into v_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = v_user_id for update;
  if v_attempt is null then raise exception 'Attempt not found'; end if;

  if v_attempt.status = 'scored' then
    return json_build_object('ok', true, 'alreadyScored', true, 'score', v_attempt.score, 'evidenceWritten', 0)::jsonb;
  end if;

  for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id loop
    v_total := v_total + 1;
    if v_response.is_correct then v_correct := v_correct + 1; end if;
  end loop;
  if v_total = 0 then raise exception 'No responses found'; end if;
  v_score := round((v_correct::numeric / v_total::numeric) * 100);

  v_evidence_mode := 'evidence';
  for v_item in select ai.review_status from public.assessment_items ai join public.assessment_responses ar on ai.id = ar.item_id where ar.attempt_id = p_attempt_id loop
    if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;
  end loop;

  update public.assessment_attempts set
    status = 'scored', score = v_score, completed_at = coalesce(completed_at, now()), evidence_mode = v_evidence_mode,
    scoring_policy_version = p_scoring_policy, evidence_policy_version = p_evidence_policy,
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
          v_user_id, p_attempt_id, v_response.item_id, v_response.concept_id, 'valid', v_response.is_correct, v_evidence_state, v_error_code, v_response.id, coalesce(v_purpose, 'practice'), v_evidence_mode, v_trust_tier, v_response.self_reported_confidence, p_scoring_policy
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

  return json_build_object('ok', true, 'attemptId', p_attempt_id, 'score', v_score, 'evidenceWritten', v_evidence_written, 'mode', v_evidence_mode)::jsonb;
end;
$function$;

-- 5. A voided answer removes only its own contribution ---------------------------------------------------
-- A pending challenge marks the evidence "disputed" (shown as under review, not erased). Only an AUTHORISED
-- void changes what the plan is justified by. Work that was done, the time reported and the history stay.
create or replace function public.resolve_item_challenge(p_challenge_id uuid, p_resolution text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid;
  v_is_reviewer boolean;
  v_challenge record;
  v_concept uuid;
  v_thread record;
  v_cancelled_tasks int := 0;
  v_cancelled_threads int := 0;
  v_task record;
begin
  v_user_id := auth.uid();
  select count(*) > 0 into v_is_reviewer from public.user_roles where user_id = v_user_id and role = 'diagnostic_reviewer';
  if not v_is_reviewer then raise exception 'Unauthorized'; end if;

  select * into v_challenge from public.item_challenges where id = p_challenge_id for update;
  if v_challenge.status != 'pending' then raise exception 'Challenge already resolved'; end if;
  if p_resolution not in ('resolved_voided', 'resolved_kept') then raise exception 'Invalid resolution'; end if;

  update public.item_challenges set status = p_resolution, resolved_at = now() where id = p_challenge_id;

  if p_resolution = 'resolved_kept' then
    update public.evidence_events set validity = 'valid', validity_reason = 'challenge_kept'
    where attempt_id = v_challenge.attempt_id and item_id = v_challenge.item_id and user_id = v_challenge.user_id;
  else
    update public.evidence_events set validity = 'voided', validity_reason = 'challenge_voided'
    where attempt_id = v_challenge.attempt_id and item_id = v_challenge.item_id and user_id = v_challenge.user_id;
    -- The attempt stays 'scored' so the student can still read it; its revision tells readers the figures changed.
    update public.assessment_attempts set result_revision = result_revision + 1, rescored_at = now() where id = v_challenge.attempt_id;

    for v_concept in select distinct concept_id from public.evidence_events
      where attempt_id = v_challenge.attempt_id and item_id = v_challenge.item_id and user_id = v_challenge.user_id loop
      -- Is there ANY other valid miss/unstable evidence for this concept? Then the gap is still justified.
      if exists (select 1 from public.evidence_events e where e.user_id = v_challenge.user_id and e.concept_id = v_concept
                   and e.validity = 'valid' and e.evidence_state in ('needs_repair', 'unstable')) then continue; end if;
      for v_thread in select * from public.repair_threads t where t.user_id = v_challenge.user_id and t.concept_id = v_concept
                        and t.status not in ('closed', 'cancelled', 'superseded') for update loop
        update public.repair_threads set status = 'cancelled', closure_reason = 'evidence_voided', closed_at = now(), updated_at = now(), revision = revision + 1 where id = v_thread.id;
        insert into public.repair_thread_events(thread_id, event_type, details)
          values (v_thread.id, 'cancelled', jsonb_build_object('reason', 'evidence_voided', 'challengeId', p_challenge_id));
        v_cancelled_threads := v_cancelled_threads + 1;
        -- Cancel only work that has not started. Anything started or finished is the student's history and stays.
        for v_task in select b.id, b.execution from public.plan_blocks b
            where b.user_id = v_challenge.user_id and b.repair_thread_id = v_thread.id and b.cancelled_at is null
              and b.execution in ('not_started', 'deferred')
              and not exists (select 1 from public.plan_blocks s where s.continued_from_task_id = b.id) loop
          update public.plan_blocks set cancelled_at = now(), cancellation_reason = 'evidence_voided', cancellation_source_id = p_challenge_id::text where id = v_task.id;
          insert into public.task_events(user_id, task_id, event_type, payload, previous)
            values (v_challenge.user_id, v_task.id, 'origin_invalidated', jsonb_build_object('reason', 'evidence_voided', 'challengeId', p_challenge_id), jsonb_build_object('execution', v_task.execution));
          v_cancelled_tasks := v_cancelled_tasks + 1;
        end loop;
      end loop;
    end loop;
    -- A re-check whose every repair is cancelled no longer has a reason to exist (if it has not been started).
    for v_task in select b.id from public.plan_blocks b
        where b.user_id = v_challenge.user_id and b.task_type = 'recheck' and b.cancelled_at is null and b.execution in ('not_started', 'deferred') and b.attempt_id is null
          and exists (select 1 from public.repair_check_threads l where l.check_task_id = b.id)
          and not exists (select 1 from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
                           where l.check_task_id = b.id and t.status not in ('closed', 'cancelled', 'superseded')) loop
      update public.plan_blocks set cancelled_at = now(), cancellation_reason = 'evidence_voided', cancellation_source_id = p_challenge_id::text where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_challenge.user_id, v_task.id, 'origin_invalidated', jsonb_build_object('reason', 'evidence_voided', 'challengeId', p_challenge_id), '{}'::jsonb);
      v_cancelled_tasks := v_cancelled_tasks + 1;
    end loop;
  end if;

  return json_build_object('ok', true, 'challengeId', p_challenge_id, 'resolution', p_resolution,
    'cancelledThreads', v_cancelled_threads, 'cancelledTasks', v_cancelled_tasks)::jsonb;
end;
$function$;

-- 6. Has anything this proposal depends on changed? --------------------------------------------------------
create function public.repair_source_version(p_user uuid, p_cycle uuid, p_thread_ids uuid[], p_attempt uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|',
    (select concat_ws(':', c.id::text, c.status, c.revision::text, coalesce(c.ends_at_local::text, '')) from public.planning_cycles c where c.id = p_cycle and c.user_id = p_user),
    (select coalesce(string_agg(concat_ws(':', b.id, b.revision, b.execution, coalesce(b.cancelled_at::text, ''), coalesce(b.local_date::text, ''), coalesce(b.duration_minutes::text, '')), ',' order by b.id), '')
       from public.plan_blocks b where b.user_id = p_user and b.cycle_id = p_cycle),
    (select coalesce(string_agg(concat_ws(':', t.id::text, t.status, t.revision::text, t.occurrence_count::text, coalesce(t.latest_attempt_id::text, ''), coalesce(t.latest_check_state, '')), ',' order by t.id::text), '')
       from public.repair_threads t where t.user_id = p_user and t.id = any(p_thread_ids)),
    (select coalesce(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text), '')
       from public.evidence_events e where e.user_id = p_user and e.attempt_id = p_attempt),
    (select coalesce(string_agg(to_jsonb(k)::text, ',' order by k.id::text), '') from public.calendar_commitments k where k.user_id = p_user and k.status = 'active'),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '') from public.availability_windows w where w.user_id = p_user and w.status = 'active')
  ))
$$;
revoke all on function public.repair_source_version(uuid, uuid, uuid[], uuid) from public, anon, authenticated;

-- 7. The one acceptance command ----------------------------------------------------------------------------
-- The request names a saved proposal and a retry key; it never carries task rows. Tasks, links, thread state, the
-- history, the receipt and the proposal's own status are written together or not at all.
create function public.accept_repair_proposal(p_proposal_id uuid, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_prop public.coach_proposals%rowtype;
  v_cycle public.planning_cycles%rowtype;
  v_changes jsonb;
  v_thread_ids uuid[];
  v_attempt uuid;
  v_today date;
  v_task jsonb;
  v_wait jsonb;
  v_thread public.repair_threads%rowtype;
  v_ids text[] := '{}';
  v_check_id text;
  v_minutes int;
  v_date date;
  v_receipt jsonb;
begin
  if v_user is null then raise exception 'Sign in to update your plan.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verify your email before using your plan.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete') then
    raise exception 'Complete setup before updating your plan.' using errcode = '42501'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 100 then raise exception 'A request key is required.' using errcode = '22023'; end if;

  select * into v_prop from public.coach_proposals where id = p_proposal_id and user_id = v_user and intent = 'diagnostic_repair' for update;
  if not found then raise exception 'That follow-up could not be found.' using errcode = 'P0002'; end if;

  if v_prop.status = 'executed' then
    if v_prop.idempotency_key = p_key then return coalesce(v_prop.accept_receipt, '{}'::jsonb) || jsonb_build_object('replayed', true); end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_ACCEPTED');
  end if;
  if v_prop.status <> 'pending' or v_prop.expires_at is null or v_prop.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'PROPOSAL_UNAVAILABLE');
  end if;

  v_changes := v_prop.proposed_changes;
  v_thread_ids := array(select x::uuid from jsonb_array_elements_text(coalesce(v_changes->'threadIds', '[]'::jsonb)) x);
  v_attempt := nullif(v_changes->>'attemptId', '')::uuid;

  select * into v_cycle from public.planning_cycles where id = v_prop.target_cycle_id and user_id = v_user for update;
  if not found or v_cycle.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'CYCLE_CHANGED'); end if;

  -- Lock, THEN compare: once these are locked nothing can change them between the check and the writes.
  perform 1 from public.plan_blocks where cycle_id = v_cycle.id and user_id = v_user order by id for update;
  perform 1 from public.repair_threads where id = any(v_thread_ids) and user_id = v_user order by id for update;
  perform 1 from public.availability_windows where user_id = v_user and status = 'active' order by id for share;
  perform 1 from public.calendar_commitments where user_id = v_user and status = 'active' order by id for share;
  if public.repair_source_version(v_user, v_cycle.id, v_thread_ids, v_attempt) is distinct from v_prop.source_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;
  if coalesce(array_length(v_thread_ids, 1), 0) = 0
     or (select count(*) from public.repair_threads where id = any(v_thread_ids) and user_id = v_user and status in ('open', 'proposed')) <> array_length(v_thread_ids, 1) then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;

  v_today := (now() at time zone coalesce(v_cycle.timezone, 'UTC'))::date;

  for v_task in select * from jsonb_array_elements(coalesce(v_changes->'tasks', '[]'::jsonb)) loop
    v_date := (v_task->>'local_date')::date;
    v_minutes := (v_task->>'duration_minutes')::int;
    select * into v_thread from public.repair_threads where id = (v_task->>'repair_thread_id')::uuid;
    if v_thread.id is null or not (v_thread.id = any(v_thread_ids)) or v_thread.user_id <> v_user then
      raise exception 'A task refers to a repair that is not part of this follow-up.' using errcode = '22023'; end if;
    if v_date is null or v_date < v_cycle.starts_at_local or v_date > v_cycle.ends_at_local or v_date < v_today then
      raise exception 'A repair must be placed today or later, inside your open week.' using errcode = '22023'; end if;
    if v_minutes is null or v_minutes not between 5 and 180 then raise exception 'A repair needs 5 to 180 minutes.' using errcode = '22023'; end if;
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day,
        duration_minutes, duration, rationale, suggested_approach, completion_meaning, learning_objective, is_protected_commitment, created_by,
        repair_thread_id, attempt_id, concept_id, source_pointer)
      values (v_task->>'id', v_user, v_cycle.id, v_task->>'title', coalesce(v_task->>'detail', ''), 'repair', 'diagnostic', 'core', 'day_preferred', 'not_started',
        v_date, v_date::text, v_minutes, v_minutes::text, coalesce(v_task->>'rationale', ''), nullif(v_task->>'suggested_approach', ''),
        nullif(v_task->>'completion_meaning', ''), nullif(v_task->>'learning_objective', ''), false, 'algorithm', v_thread.id, v_attempt, v_thread.concept_id,
        jsonb_build_object('kind', 'diagnostic_result', 'attemptId', v_attempt, 'proposalId', p_proposal_id));
    insert into public.task_events(user_id, task_id, event_type, payload, previous)
      values (v_user, v_task->>'id', 'created', jsonb_build_object('source', 'repair_proposal', 'proposalId', p_proposal_id, 'threadId', v_thread.id), '{}'::jsonb);
    v_ids := array_append(v_ids, v_task->>'id');
  end loop;

  -- A re-check that fits in this week is a real task, linked to exactly the repairs it checks.
  if jsonb_typeof(v_changes->'check') = 'object' then
    v_date := (v_changes->'check'->>'local_date')::date;
    v_minutes := (v_changes->'check'->>'duration_minutes')::int;
    if v_date is null or v_date < v_cycle.starts_at_local or v_date > v_cycle.ends_at_local or v_date < v_today then
      raise exception 'A re-check must be placed today or later, inside your open week.' using errcode = '22023'; end if;
    v_check_id := v_changes->'check'->>'id';
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day,
        duration_minutes, duration, rationale, suggested_approach, completion_meaning, learning_objective, is_protected_commitment, created_by, source_pointer)
      values (v_check_id, v_user, v_cycle.id, v_changes->'check'->>'title', coalesce(v_changes->'check'->>'detail', ''), 'recheck', 'diagnostic', 'core', 'day_preferred', 'not_started',
        v_date, v_date::text, v_minutes, v_minutes::text, coalesce(v_changes->'check'->>'rationale', ''), nullif(v_changes->'check'->>'suggested_approach', ''),
        nullif(v_changes->'check'->>'completion_meaning', ''), nullif(v_changes->'check'->>'learning_objective', ''), false, 'algorithm',
        jsonb_build_object('kind', 'diagnostic_result', 'attemptId', v_attempt, 'proposalId', p_proposal_id));
    insert into public.repair_check_threads(check_task_id, thread_id, user_id)
      select v_check_id, x::uuid, v_user from jsonb_array_elements_text(v_changes->'check'->'threadIds') x
      where x::uuid = any(v_thread_ids);
    insert into public.task_events(user_id, task_id, event_type, payload, previous)
      values (v_user, v_check_id, 'created', jsonb_build_object('source', 'repair_proposal', 'proposalId', p_proposal_id), '{}'::jsonb);
    v_ids := array_append(v_ids, v_check_id);
  end if;

  -- A re-check that cannot fit this week is an explicit waiting obligation on its repairs, with the earliest date it may happen.
  for v_wait in select * from jsonb_array_elements(coalesce(v_changes->'waitingChecks', '[]'::jsonb)) loop
    update public.repair_threads set next_recheck_due_at = ((v_wait->>'earliestDate')::date)::timestamptz, updated_at = now(), revision = revision + 1
      where id in (select x::uuid from jsonb_array_elements_text(v_wait->'threadIds') x) and id = any(v_thread_ids) and user_id = v_user;
    insert into public.repair_thread_events(thread_id, event_type, details)
      select x::uuid, 'check_waiting', jsonb_build_object('earliestDate', v_wait->>'earliestDate', 'proposalId', p_proposal_id)
      from jsonb_array_elements_text(v_wait->'threadIds') x where x::uuid = any(v_thread_ids);
  end loop;

  v_receipt := jsonb_build_object('ok', true, 'replayed', false, 'proposalId', p_proposal_id, 'taskIds', to_jsonb(v_ids),
    'checkTaskId', v_check_id, 'threadIds', to_jsonb(v_thread_ids), 'waitingChecks', coalesce(v_changes->'waitingChecks', '[]'::jsonb));
  update public.coach_proposals set status = 'executed', executed_at = now(), applied_at = now(), decided_at = now(), idempotency_key = p_key,
    applied_task_ids = null, accept_receipt = v_receipt where id = p_proposal_id;
  return v_receipt;
end; $$;
revoke all on function public.accept_repair_proposal(uuid, text) from public, anon;
grant execute on function public.accept_repair_proposal(uuid, text) to authenticated;

-- 7b. Placing a re-check for repairs that are already finished -------------------------------------------------
-- For a re-check that had to wait (it fell after the week it was planned in): once the repairs are done, the student asks
-- for it, and it lands in the OPEN week on the earliest day the spacing rule allows. Linked to exactly those repairs.
create function public.place_repair_check(p_thread_ids uuid[], p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_cycle public.planning_cycles%rowtype; v_id text; v_today date; v_due date; v_date date; v_n int;
begin
  if v_user is null then raise exception 'Sign in to update your plan.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then raise exception 'Verify your email before using your plan.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete') then raise exception 'Complete setup before updating your plan.' using errcode = '42501'; end if;
  if p_key is null or length(p_key) < 8 or length(p_key) > 100 then raise exception 'A request key is required.' using errcode = '22023'; end if;
  if coalesce(array_length(p_thread_ids, 1), 0) = 0 then raise exception 'Choose the repairs to check.' using errcode = '22023'; end if;
  v_id := 'task-chk-' || p_key;
  if exists (select 1 from public.plan_blocks where id = v_id and user_id = v_user) then return jsonb_build_object('ok', true, 'replayed', true, 'checkTaskId', v_id); end if;

  select * into v_cycle from public.planning_cycles where user_id = v_user and status = 'active' for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NO_OPEN_WEEK'); end if;
  perform 1 from public.repair_threads where id = any(p_thread_ids) and user_id = v_user order by id for update;
  select count(*) into v_n from public.repair_threads where id = any(p_thread_ids) and user_id = v_user and status = 'awaiting_recheck';
  if v_n <> array_length(p_thread_ids, 1) then return jsonb_build_object('ok', false, 'code', 'NOT_READY'); end if;
  if exists (select 1 from public.repair_check_threads l join public.plan_blocks b on b.id = l.check_task_id
              where l.thread_id = any(p_thread_ids) and b.cancelled_at is null and b.execution in ('not_started', 'in_progress', 'partial', 'deferred')) then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_PLANNED');
  end if;
  v_today := (now() at time zone coalesce(v_cycle.timezone, 'UTC'))::date;
  select max(coalesce(next_recheck_due_at::date, v_today)) into v_due from public.repair_threads where id = any(p_thread_ids);
  v_date := greatest(v_today, v_due, v_cycle.starts_at_local);
  if v_date > v_cycle.ends_at_local then return jsonb_build_object('ok', false, 'code', 'NOT_THIS_WEEK', 'earliestDate', v_date); end if;
  insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, duration_minutes, duration,
      rationale, completion_meaning, learning_objective, is_protected_commitment, created_by)
    values (v_id, v_user, v_cycle.id, 'Re-check: ' || v_n || ' repaired concept' || case when v_n = 1 then '' else 's' end, 'A short check on exactly what you repaired, using questions you have not seen.',
      'recheck', 'diagnostic', 'core', 'day_preferred', 'not_started', v_date, v_date::text, case when v_n <= 2 then 15 else 30 end, (case when v_n <= 2 then 15 else 30 end)::text,
      'Your repairs are finished, so the re-check is due.', 'You took the check. What it shows comes from the scored result.', 'Show whether the repaired concepts hold.', false, 'algorithm');
  insert into public.repair_check_threads(check_task_id, thread_id, user_id) select v_id, x, v_user from unnest(p_thread_ids) x;
  insert into public.task_events(user_id, task_id, event_type, payload, previous) values (v_user, v_id, 'created', jsonb_build_object('source', 'place_repair_check'), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'replayed', false, 'checkTaskId', v_id, 'date', v_date);
end; $$;
revoke all on function public.place_repair_check(uuid[], text) from public, anon;
grant execute on function public.place_repair_check(uuid[], text) to authenticated;

-- 8. Starting a re-check: the paper is created whole or not at all ------------------------------------------
-- Server-only. The caller (the server) chose the questions; this command re-verifies readiness, scope and that
-- every question is still unseen, then writes the blueprint, form, questions, attempt, frozen scope and the task
-- link in one transaction. An attempt that already exists for this check is resumed, never duplicated.
create function public.start_repair_check(
  p_user uuid, p_check_task_id text, p_item_ids text[], p_manifest uuid, p_blueprint jsonb, p_constraints jsonb,
  p_requested jsonb, p_coverage jsonb, p_scope jsonb, p_min_questions integer default 5
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_task public.plan_blocks%rowtype;
  v_open public.assessment_attempts%rowtype;
  v_waiting uuid[];
  v_bp uuid; v_form uuid; v_attempt uuid;
  v_n int := coalesce(array_length(p_item_ids, 1), 0);
begin
  select * into v_task from public.plan_blocks where id = p_check_task_id and user_id = p_user for update;
  if not found or v_task.task_type <> 'recheck' or v_task.cancelled_at is not null or v_task.execution in ('completed', 'skipped', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'CHECK_UNAVAILABLE');
  end if;
  if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_task.id) then
    return jsonb_build_object('ok', false, 'code', 'CHECK_UNAVAILABLE');
  end if;

  -- An attempt already started for this check is resumed even if its own questions are no longer "unseen".
  if v_task.attempt_id is not null then
    select * into v_open from public.assessment_attempts where id = v_task.attempt_id and user_id = p_user and status in ('ready', 'in_progress');
    if found then return jsonb_build_object('ok', true, 'resumed', true, 'attemptId', v_open.id,
        'questions', (select count(*) from public.form_items where form_id = v_open.form_id)); end if;
  end if;

  select array_agg(t.id) into v_waiting from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
    where l.check_task_id = p_check_task_id and t.user_id = p_user and t.status not in ('closed', 'cancelled', 'superseded') and t.status <> 'awaiting_recheck';
  if v_waiting is not null then return jsonb_build_object('ok', false, 'code', 'WAITING_ON_REPAIRS', 'threadIds', to_jsonb(v_waiting)); end if;
  if not exists (select 1 from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
                  where l.check_task_id = p_check_task_id and t.user_id = p_user and t.status = 'awaiting_recheck') then
    return jsonb_build_object('ok', false, 'code', 'NOTHING_TO_CHECK');
  end if;

  if v_n < p_min_questions then return jsonb_build_object('ok', false, 'code', 'BANK_INSUFFICIENT', 'deliverable', v_n, 'needed', p_min_questions); end if;
  if v_n > 90 then raise exception 'A paper cannot exceed 90 questions.' using errcode = '22023'; end if;
  if exists (select 1 from public.assessment_responses where user_id = p_user and item_id = any(p_item_ids)) then
    return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED');
  end if;
  -- Every question must belong to a concept of a repair this check is for. An unrelated concept cannot fill the paper.
  if exists (select 1 from public.assessment_items i where i.id = any(p_item_ids) and (i.concept_id is null or not exists (
      select 1 from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
       where l.check_task_id = p_check_task_id and t.concept_id = i.concept_id))) then
    raise exception 'A question is outside the repairs this check is for.' using errcode = '22023';
  end if;

  insert into public.assessment_blueprints(manifest_id, purpose, requested_scope, constraints) values (p_manifest, 'repair_recheck', p_blueprint, p_constraints) returning id into v_bp;
  insert into public.assessment_forms(blueprint_id, delivery_mode) values (v_bp, 'fixed') returning id into v_form;
  insert into public.form_items(form_id, item_id, sequence_number) select v_form, x.item, x.ord from unnest(p_item_ids) with ordinality as x(item, ord);
  insert into public.assessment_attempts(user_id, form_id, delivery_mode, status, attempt_kind, cycle_id, open_key, requested_blueprint, delivered_coverage)
    values (p_user, v_form, 'fixed', 'ready', 'repair', v_task.cycle_id, 'check:' || p_check_task_id, p_requested, p_coverage) returning id into v_attempt;
  insert into public.paper_scope_snapshots(user_id, cycle_id, purpose, revision, scope, attempt_id)
    values (p_user, v_task.cycle_id, 'repair_check', 'repair-loop-1', p_scope, v_attempt);
  update public.plan_blocks set attempt_id = v_attempt where id = p_check_task_id;
  return jsonb_build_object('ok', true, 'resumed', false, 'attemptId', v_attempt, 'questions', v_n);
end; $$;
revoke all on function public.start_repair_check(uuid, text, text[], uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer) from public, anon, authenticated;
do $$ begin
  if to_regrole('service_role') is not null then
    grant execute on function public.start_repair_check(uuid, text, text[], uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer) to service_role;
    grant execute on function public.repair_source_version(uuid, uuid, uuid[], uuid) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
