-- Phase 3 hardening: pin delivered stem/options/key/feedback/solution on `adaptive_item_steps`,
-- grade against the pinned `key_index`, and re-check exact-version eligibility & exposure inside the lock.

alter table public.adaptive_item_steps
  add column if not exists stem text,
  add column if not exists options jsonb,
  add column if not exists key_index integer,
  add column if not exists per_option_feedback jsonb,
  add column if not exists solution text;

create or replace function public.adaptive_item_start(
  p_user uuid,
  p_request_key text,
  p_payload_hash text,
  p_manifest_id uuid,
  p_reading_id text,
  p_outcome_ids text[],
  p_item_id text,
  p_item_version integer,
  p_family_id uuid,
  p_shortage_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rec public.adaptive_item_receipts%rowtype;
  v_run public.adaptive_item_runs%rowtype;
  v_item public.assessment_items%rowtype;
  v_res jsonb;
begin
  select * into v_rec from public.adaptive_item_receipts where user_id = p_user and request_key = p_request_key;
  if found then
    if v_rec.payload_hash <> p_payload_hash then
      return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT');
    end if;
    return v_rec.result || jsonb_build_object('replay', true);
  end if;

  if p_item_id is null then
    insert into public.adaptive_item_runs(user_id, manifest_id, reading_id, outcome_ids, status, target_tier, shortage_tier, shortage_reason, request_key)
    values (p_user, p_manifest_id, p_reading_id, coalesce(p_outcome_ids, '{}'), 'finished_shortage', 'foundation', 'foundation', coalesce(p_shortage_reason, 'No eligible Easy routine item available.'), p_request_key)
    returning * into v_run;
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'targetTier', v_run.target_tier, 'shortageTier', v_run.shortage_tier, 'shortageReason', v_run.shortage_reason, 'revision', v_run.revision, 'seq', null);
  else
    -- Re-verify eligibility, confirmed tier, and non-exposure inside the transaction.
    select a.* into v_item
    from public.student_eligible_items e
    join public.assessment_items a on a.id = e.id and a.item_version = e.item_version
    join public.item_confirmed_difficulty d on d.item_id = e.id and d.item_version = e.item_version
    where e.id = p_item_id
      and e.item_version = p_item_version
      and e.lm_id = p_reading_id
      and (p_family_id is null or e.family_id = p_family_id)
      and d.level = 'foundation'
      and not exists (
        select 1 from public.adaptive_item_steps s
        join public.adaptive_item_runs r on r.id = s.run_id
        where r.user_id = p_user and (s.item_id = e.id or (e.family_id is not null and s.family_id = e.family_id))
      )
      and not exists (
        select 1 from public.assessment_responses ar
        join public.assessment_items ai on ai.id = ar.item_id
        where ar.user_id = p_user and (ar.item_id = e.id or (e.family_id is not null and ai.family_id = e.family_id))
      );
    if not found then
      return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED');
    end if;

    insert into public.adaptive_item_runs(user_id, manifest_id, reading_id, outcome_ids, status, target_tier, request_key)
    values (p_user, p_manifest_id, p_reading_id, coalesce(p_outcome_ids, '{}'), 'active', 'foundation', p_request_key)
    returning * into v_run;
    insert into public.adaptive_item_steps(run_id, seq, item_id, item_version, family_id, tier, stem, options, key_index, per_option_feedback, solution)
    values (v_run.id, 1, v_item.id, v_item.item_version, v_item.family_id, 'foundation', v_item.stem, v_item.options, v_item.key_index, v_item.per_option_feedback, v_item.item_card->>'solution');
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'targetTier', v_run.target_tier, 'revision', v_run.revision, 'seq', 1, 'itemId', v_item.id);
  end if;

  insert into public.adaptive_item_receipts(user_id, request_key, run_id, payload_hash, result)
  values (p_user, p_request_key, v_run.id, p_payload_hash, v_res);
  return v_res;
end;
$$;

create or replace function public.adaptive_item_commit(
  p_user uuid,
  p_run_id uuid,
  p_seq integer,
  p_request_key text,
  p_payload_hash text,
  p_selected_option_index integer,
  p_outcome text,
  p_next_tier text,
  p_next_item_id text,
  p_next_item_version integer,
  p_next_family_id uuid,
  p_shortage_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rec public.adaptive_item_receipts%rowtype;
  v_run public.adaptive_item_runs%rowtype;
  v_step public.adaptive_item_steps%rowtype;
  v_next_item public.assessment_items%rowtype;
  v_committed_outcome text;
  v_res jsonb;
begin
  select * into v_rec from public.adaptive_item_receipts where user_id = p_user and request_key = p_request_key;
  if found then
    if v_rec.payload_hash <> p_payload_hash then
      return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT');
    end if;
    return v_rec.result || jsonb_build_object('replay', true);
  end if;

  select * into v_run from public.adaptive_item_runs where id = p_run_id and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_run.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'RUN_CLOSED');
  end if;

  select * into v_step from public.adaptive_item_steps where run_id = p_run_id and seq = p_seq for update;
  if not found or v_step.committed_outcome is not null then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SCORED');
  end if;

  -- Grade against the PINNED key_index on adaptive_item_steps (never mutable assessment_items).
  if p_outcome in ('omitted', 'disputed', 'void') or p_selected_option_index is null then
    v_committed_outcome := p_outcome;
  elsif v_step.key_index is not null then
    v_committed_outcome := case when p_selected_option_index = v_step.key_index then 'correct' else 'incorrect' end;
  else
    v_committed_outcome := p_outcome;
  end if;

  if p_next_item_id is not null then
    select a.* into v_next_item
    from public.student_eligible_items e
    join public.assessment_items a on a.id = e.id and a.item_version = e.item_version
    join public.item_confirmed_difficulty d on d.item_id = e.id and d.item_version = e.item_version
    where e.id = p_next_item_id
      and e.item_version = p_next_item_version
      and e.lm_id = v_run.reading_id
      and (p_next_family_id is null or e.family_id = p_next_family_id)
      and d.level = p_next_tier
      and not exists (
        select 1 from public.adaptive_item_steps s
        join public.adaptive_item_runs r on r.id = s.run_id
        where r.user_id = p_user and (s.item_id = e.id or (e.family_id is not null and s.family_id = e.family_id))
      )
      and not exists (
        select 1 from public.assessment_responses ar
        join public.assessment_items ai on ai.id = ar.item_id
        where ar.user_id = p_user and (ar.item_id = e.id or (e.family_id is not null and ai.family_id = e.family_id))
      );
    if not found then
      return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED');
    end if;
  end if;

  update public.adaptive_item_steps
  set selected_option_index = p_selected_option_index,
      committed_outcome = v_committed_outcome,
      invalidated = (v_committed_outcome in ('disputed', 'void')),
      request_key = p_request_key,
      answered_at = now()
  where run_id = p_run_id and seq = p_seq;

  if p_next_item_id is null then
    update public.adaptive_item_runs
    set status = 'finished_shortage',
        target_tier = p_next_tier,
        shortage_tier = p_next_tier,
        shortage_reason = coalesce(p_shortage_reason, 'No eligible ' || p_next_tier || ' routine item available.'),
        revision = revision + 1,
        updated_at = now()
    where id = p_run_id returning * into v_run;
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'committedSeq', p_seq, 'outcome', v_committed_outcome, 'nextTier', p_next_tier, 'nextSeq', null, 'nextItemId', null, 'shortageTier', v_run.shortage_tier, 'shortageReason', v_run.shortage_reason, 'revision', v_run.revision);
  else
    insert into public.adaptive_item_steps(run_id, seq, item_id, item_version, family_id, tier, stem, options, key_index, per_option_feedback, solution)
    values (p_run_id, p_seq + 1, v_next_item.id, v_next_item.item_version, v_next_item.family_id, p_next_tier, v_next_item.stem, v_next_item.options, v_next_item.key_index, v_next_item.per_option_feedback, v_next_item.item_card->>'solution');
    update public.adaptive_item_runs
    set target_tier = p_next_tier,
        revision = revision + 1,
        updated_at = now()
    where id = p_run_id returning * into v_run;
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'committedSeq', p_seq, 'outcome', v_committed_outcome, 'nextTier', p_next_tier, 'nextSeq', p_seq + 1, 'nextItemId', v_next_item.id, 'revision', v_run.revision);
  end if;

  insert into public.adaptive_item_receipts(user_id, request_key, run_id, payload_hash, result)
  values (p_user, p_request_key, v_run.id, p_payload_hash, v_res);
  return v_res;
end;
$$;
