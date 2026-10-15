-- Gate A RPCs
-- Security definer functions for transactional safety.

-- 1. record_assessment_response
create or replace function public.record_assessment_response(
  p_attempt_id uuid,
  p_item_id text,
  p_selected_option integer,
  p_confidence integer,
  p_elapsed_seconds integer
) returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_attempt record;
  v_item record;
  v_form_item record;
  v_is_correct boolean;
  v_response_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Unauthorized';
  end if;

  select id, status, form_id into v_attempt
  from public.assessment_attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;

  if v_attempt is null then
    raise exception 'Attempt not found';
  end if;

  if v_attempt.status not in ('ready', 'in_progress', 'assembling') then
    raise exception 'Attempt is %', v_attempt.status;
  end if;

  select id, key_index into v_item
  from public.assessment_items
  where id = p_item_id;

  if v_item is null then
    raise exception 'Item not found';
  end if;

  if v_attempt.form_id is not null then
    select item_id into v_form_item
    from public.form_items
    where form_id = v_attempt.form_id and item_id = p_item_id;
    if v_form_item is null then
      raise exception 'Item not in form';
    end if;
  end if;

  v_is_correct := (p_selected_option = v_item.key_index);

  insert into public.assessment_responses (
    user_id, attempt_id, item_id, selected_option_index, is_correct, self_reported_confidence, elapsed_seconds
  ) values (
    v_user_id, p_attempt_id, p_item_id, p_selected_option, v_is_correct, p_confidence, p_elapsed_seconds
  ) on conflict (attempt_id, item_id) do update set
    selected_option_index = excluded.selected_option_index,
    is_correct = excluded.is_correct,
    self_reported_confidence = excluded.self_reported_confidence,
    elapsed_seconds = excluded.elapsed_seconds
  returning id into v_response_id;

  if v_attempt.status = 'ready' or v_attempt.status = 'assembling' then
    update public.assessment_attempts set status = 'in_progress', started_at = coalesce(started_at, now()) where id = p_attempt_id;
  end if;

  return v_response_id;
end;
$$;
revoke all on function public.record_assessment_response from public;
grant execute on function public.record_assessment_response to authenticated;

-- 2. finalize_assessment_attempt
create or replace function public.finalize_assessment_attempt(
  p_attempt_id uuid,
  p_scoring_policy text,
  p_evidence_policy text
) returns jsonb
language plpgsql
security definer set search_path = ''
as $$
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
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select * into v_attempt from public.assessment_attempts
  where id = p_attempt_id and user_id = v_user_id for update;

  if v_attempt is null then raise exception 'Attempt not found'; end if;

  if v_attempt.status = 'scored' then
    return json_build_object('ok', true, 'alreadyScored', true, 'score', v_attempt.score, 'evidenceWritten', 0)::jsonb;
  end if;

  -- Form completion logic can go here (simplified for MVP: count responses)

  for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id loop
    v_total := v_total + 1;
    if v_response.is_correct then v_correct := v_correct + 1; end if;
  end loop;

  if v_total = 0 then
    raise exception 'No responses found';
  end if;

  v_score := round((v_correct::numeric / v_total::numeric) * 100);
  
  -- Determine mode based on items (simplified: if all items reviewed, evidence)
  v_evidence_mode := 'evidence';
  for v_item in select ai.review_status from public.assessment_items ai join public.assessment_responses ar on ai.id = ar.item_id where ar.attempt_id = p_attempt_id loop
    if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then
      v_evidence_mode := 'practice';
    end if;
  end loop;

  update public.assessment_attempts set 
    status = 'scored', 
    score = v_score, 
    completed_at = coalesce(completed_at, now()),
    evidence_mode = v_evidence_mode,
    scoring_policy_version = p_scoring_policy,
    evidence_policy_version = p_evidence_policy,
    valid_response_count = v_total,
    correct_response_count = v_correct
  where id = p_attempt_id;

  if v_attempt.form_id is not null then
    select manifest_id into v_manifest_id from public.assessment_forms where id = v_attempt.form_id;
  end if;
  if v_manifest_id is null then
    select id into v_manifest_id from public.curriculum_manifests where is_active = true limit 1;
  end if;

  if v_evidence_mode = 'evidence' then
    for v_response in select ar.*, ai.concept_id, ai.item_card, ai.review_status from public.assessment_responses ar join public.assessment_items ai on ar.item_id = ai.id where ar.attempt_id = p_attempt_id loop
      if v_response.concept_id is not null then
        v_evidence_state := 'insufficient';
        if v_response.is_correct = false then
          v_evidence_state := 'needs_repair';
        elsif v_response.is_correct = true and v_response.self_reported_confidence is not null and v_response.self_reported_confidence <= 2 then
          v_evidence_state := 'unstable';
        elsif v_response.is_correct = true then
          v_evidence_state := 'supported';
        end if;
        
        v_error_code := null;
        if v_response.is_correct = false then
          begin
            v_diagnoses := v_response.item_card->'distractorDiagnoses';
            select obj->>'errorCode' into v_error_code from jsonb_array_elements(v_diagnoses) obj where (obj->>'optionIndex')::int = v_response.selected_option_index limit 1;
          exception when others then
            v_error_code := null;
          end;
        end if;
        
        v_trust_tier := v_response.review_status;

        insert into public.evidence_events (
          user_id, attempt_id, item_id, concept_id, validity, is_correct, evidence_state, error_code, response_id, assessment_purpose, evidence_mode, item_trust_tier, self_reported_confidence, scoring_policy_version
        ) values (
          v_user_id, p_attempt_id, v_response.item_id, v_response.concept_id, 'valid', v_response.is_correct, v_evidence_state, v_error_code, v_response.id, coalesce((v_attempt.assessment_scope->>'purpose'), 'practice'), v_evidence_mode, v_trust_tier, v_response.self_reported_confidence, p_scoring_policy
        ) on conflict (attempt_id, item_id, scoring_policy_version) do nothing;
        
        if v_evidence_state in ('needs_repair', 'unstable') then
          insert into public.repair_threads (
            user_id, concept_id, manifest_id, status, severity, occurrence_count, opened_from_attempt_id, latest_evidence_at, updated_at, policy_version
          ) values (
            v_user_id, v_response.concept_id, v_manifest_id, 'open', v_evidence_state, 1, p_attempt_id, now(), now(), p_evidence_policy
          ) on conflict (user_id, concept_id, manifest_id) where status not in ('closed', 'cancelled', 'superseded') do update set
            severity = v_evidence_state,
            occurrence_count = repair_threads.occurrence_count + 1,
            latest_evidence_at = now(),
            updated_at = now();
        end if;
        
        v_evidence_written := v_evidence_written + 1;
      end if;
    end loop;
  end if;

  return json_build_object('ok', true, 'attemptId', p_attempt_id, 'score', v_score, 'evidenceWritten', v_evidence_written, 'mode', v_evidence_mode)::jsonb;
end;
$$;
revoke all on function public.finalize_assessment_attempt from public;
grant execute on function public.finalize_assessment_attempt to authenticated;

-- 3. raise_item_challenge
create or replace function public.raise_item_challenge(
  p_attempt_id uuid,
  p_item_id text,
  p_comment text,
  p_reason_code text
) returns uuid
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_response record;
  v_challenge_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select * into v_response from public.assessment_responses where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id;
  if v_response is null then raise exception 'Response not found'; end if;

  insert into public.item_challenges (user_id, item_id, attempt_id, comment, reason_code, status)
  values (v_user_id, p_item_id, p_attempt_id, p_comment, coalesce(p_reason_code, 'other'), 'pending')
  returning id into v_challenge_id;

  update public.evidence_events set validity = 'disputed', validity_reason = 'challenge_pending'
  where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id;

  return v_challenge_id;
end;
$$;
revoke all on function public.raise_item_challenge from public;
grant execute on function public.raise_item_challenge to authenticated;

-- 4. resolve_item_challenge
create or replace function public.resolve_item_challenge(
  p_challenge_id uuid,
  p_resolution text
) returns jsonb
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_is_reviewer boolean;
  v_challenge record;
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
  elsif p_resolution = 'resolved_voided' then
    update public.evidence_events set validity = 'voided', validity_reason = 'challenge_voided'
    where attempt_id = v_challenge.attempt_id and item_id = v_challenge.item_id and user_id = v_challenge.user_id;
    -- Recalculate score is omitted here for MVP, but a real impl would update attempts and tasks.
    update public.assessment_attempts set status = 'partially_voided' where id = v_challenge.attempt_id;
  end if;

  return json_build_object('ok', true, 'challengeId', p_challenge_id, 'resolution', p_resolution)::jsonb;
end;
$$;
revoke all on function public.resolve_item_challenge from public;
grant execute on function public.resolve_item_challenge to authenticated;

-- 5. apply_diagnostic_repair_proposal
create or replace function public.apply_diagnostic_repair_proposal(
  p_proposal_id uuid,
  p_tasks jsonb
) returns uuid[]
language plpgsql
security definer set search_path = ''
as $$
declare
  v_user_id uuid;
  v_proposal record;
  v_task jsonb;
  v_task_id uuid;
  v_applied_ids uuid[] := '{}';
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;

  select * into v_proposal from public.coach_proposals where id = p_proposal_id and user_id = v_user_id for update;
  if v_proposal is null then raise exception 'Proposal not found'; end if;
  if v_proposal.status = 'executed' then return v_proposal.applied_task_ids; end if;

  for v_task in select * from jsonb_array_elements(p_tasks) loop
    v_task_id := (v_task->>'id')::uuid;
    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, 
      local_date, day, starts_at, duration_minutes, duration, rationale, suggested_approach, completion_meaning, is_protected_commitment, created_by, repair_thread_id
    ) values (
      v_task_id, v_user_id, (v_task->>'cycle_id')::uuid, v_task->>'title', v_task->>'detail', v_task->>'task_type', v_task->>'origin', v_task->>'priority', v_task->>'placement', v_task->>'execution',
      v_task->>'local_date', v_task->>'day', v_task->>'starts_at', (v_task->>'duration_minutes')::int, v_task->>'duration', v_task->>'rationale', v_task->>'suggested_approach', v_task->>'completion_meaning', false, 'algorithm', (v_task->>'repair_thread_id')::uuid
    );
    v_applied_ids := array_append(v_applied_ids, v_task_id);
    
    if (v_task->>'repair_thread_id') is not null then
      update public.repair_threads set status = 'scheduled', updated_at = now() where id = (v_task->>'repair_thread_id')::uuid;
    end if;
  end loop;

  update public.coach_proposals set status = 'executed', applied_task_ids = v_applied_ids, applied_at = now() where id = p_proposal_id;

  return v_applied_ids;
end;
$$;
revoke all on function public.apply_diagnostic_repair_proposal from public;
grant execute on function public.apply_diagnostic_repair_proposal to authenticated;
