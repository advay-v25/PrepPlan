-- Phase 3: Item-by-item adaptive practice (`adaptive-item.1`).
-- Additive tables and atomic server-owned commands; never writes evidence_events or closes repair_threads.

create table if not exists public.adaptive_item_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  manifest_id uuid not null references public.curriculum_manifests(id),
  reading_id text not null references public.curriculum_readings(id),
  outcome_ids text[] not null default '{}',
  policy_version text not null default 'adaptive-item.1',
  status text not null default 'active' check (status in ('active', 'finished_shortage', 'completed', 'stopped')),
  target_tier text not null default 'foundation' check (target_tier in ('foundation', 'standard', 'difficult')),
  shortage_tier text check (shortage_tier in ('foundation', 'standard', 'difficult')),
  shortage_reason text,
  revision integer not null default 1,
  request_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adaptive_item_steps (
  run_id uuid not null references public.adaptive_item_runs(id) on delete cascade,
  seq integer not null check (seq >= 1),
  item_id text not null references public.assessment_items(id),
  item_version integer not null,
  family_id uuid references public.item_families(id),
  tier text not null check (tier in ('foundation', 'standard', 'difficult')),
  selected_option_index integer check (selected_option_index between 0 and 2),
  committed_outcome text check (committed_outcome in ('correct', 'incorrect', 'omitted', 'disputed', 'void')),
  invalidated boolean not null default false,
  request_key text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (run_id, seq)
);

create table if not exists public.adaptive_item_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null,
  run_id uuid not null references public.adaptive_item_runs(id) on delete cascade,
  payload_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);

create index if not exists adaptive_item_runs_user_idx on public.adaptive_item_runs(user_id, created_at desc);

alter table public.adaptive_item_runs enable row level security;
alter table public.adaptive_item_steps enable row level security;
alter table public.adaptive_item_receipts enable row level security;

revoke all on public.adaptive_item_runs, public.adaptive_item_steps, public.adaptive_item_receipts from public, anon, authenticated;
grant select on public.adaptive_item_runs, public.adaptive_item_steps to authenticated;

drop policy if exists adaptive_item_runs_own on public.adaptive_item_runs;
create policy adaptive_item_runs_own on public.adaptive_item_runs for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists adaptive_item_steps_own on public.adaptive_item_steps;
create policy adaptive_item_steps_own on public.adaptive_item_steps for select to authenticated
  using (exists (select 1 from public.adaptive_item_runs r where r.id = run_id and r.user_id = (select auth.uid())));

do $$ begin
  if to_regrole('service_role') is not null then
    grant all on public.adaptive_item_runs, public.adaptive_item_steps, public.adaptive_item_receipts to service_role;
  end if;
end $$;

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
    insert into public.adaptive_item_runs(user_id, manifest_id, reading_id, outcome_ids, status, target_tier, request_key)
    values (p_user, p_manifest_id, p_reading_id, coalesce(p_outcome_ids, '{}'), 'active', 'foundation', p_request_key)
    returning * into v_run;
    insert into public.adaptive_item_steps(run_id, seq, item_id, item_version, family_id, tier)
    values (v_run.id, 1, p_item_id, p_item_version, p_family_id, 'foundation');
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'targetTier', v_run.target_tier, 'revision', v_run.revision, 'seq', 1, 'itemId', p_item_id);
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

  update public.adaptive_item_steps
  set selected_option_index = p_selected_option_index,
      committed_outcome = p_outcome,
      invalidated = (p_outcome in ('disputed', 'void')),
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
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'committedSeq', p_seq, 'outcome', p_outcome, 'nextTier', p_next_tier, 'nextSeq', null, 'nextItemId', null, 'shortageTier', v_run.shortage_tier, 'shortageReason', v_run.shortage_reason, 'revision', v_run.revision);
  else
    insert into public.adaptive_item_steps(run_id, seq, item_id, item_version, family_id, tier)
    values (p_run_id, p_seq + 1, p_next_item_id, p_next_item_version, p_next_family_id, p_next_tier);
    update public.adaptive_item_runs
    set target_tier = p_next_tier,
        revision = revision + 1,
        updated_at = now()
    where id = p_run_id returning * into v_run;
    v_res := jsonb_build_object('ok', true, 'runId', v_run.id, 'status', v_run.status, 'committedSeq', p_seq, 'outcome', p_outcome, 'nextTier', p_next_tier, 'nextSeq', p_seq + 1, 'nextItemId', p_next_item_id, 'revision', v_run.revision);
  end if;

  insert into public.adaptive_item_receipts(user_id, request_key, run_id, payload_hash, result)
  values (p_user, p_request_key, v_run.id, p_payload_hash, v_res);
  return v_res;
end;
$$;

create or replace function public.adaptive_item_invalidate(
  p_user uuid,
  p_run_id uuid,
  p_seq integer,
  p_outcome text default 'void'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run public.adaptive_item_runs%rowtype;
  v_step record;
  v_tier text := 'foundation';
begin
  if p_outcome not in ('disputed', 'void') then
    return jsonb_build_object('ok', false, 'code', 'BAD_INPUT');
  end if;
  select * into v_run from public.adaptive_item_runs where id = p_run_id and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  update public.adaptive_item_steps
  set invalidated = true,
      committed_outcome = coalesce(committed_outcome, p_outcome)
  where run_id = p_run_id and seq = p_seq;

  for v_step in
    select committed_outcome, invalidated from public.adaptive_item_steps
    where run_id = p_run_id order by seq asc
  loop
    if not v_step.invalidated and v_step.committed_outcome = 'correct' then
      v_tier := case v_tier when 'foundation' then 'standard' else 'difficult' end;
    elsif not v_step.invalidated and v_step.committed_outcome = 'incorrect' then
      v_tier := case v_tier when 'difficult' then 'standard' else 'foundation' end;
    end if;
  end loop;

  update public.adaptive_item_runs
  set target_tier = v_tier,
      revision = revision + 1,
      updated_at = now()
  where id = p_run_id returning * into v_run;

  return jsonb_build_object('ok', true, 'runId', v_run.id, 'targetTier', v_run.target_tier, 'revision', v_run.revision);
end;
$$;

create or replace function public.adaptive_item_stop(
  p_user uuid,
  p_run_id uuid,
  p_expected_revision integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_run public.adaptive_item_runs%rowtype;
begin
  select * into v_run from public.adaptive_item_runs where id = p_run_id and user_id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if p_expected_revision is not null and v_run.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'STALE_RUN');
  end if;
  update public.adaptive_item_runs
  set status = case when status = 'active' then 'stopped' else status end,
      revision = revision + 1,
      updated_at = now()
  where id = p_run_id returning * into v_run;
  return jsonb_build_object('ok', true, 'status', v_run.status, 'revision', v_run.revision);
end;
$$;

revoke all on function public.adaptive_item_start(uuid, text, text, uuid, text, text[], text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.adaptive_item_commit(uuid, uuid, integer, text, text, integer, text, text, text, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.adaptive_item_invalidate(uuid, uuid, integer, text) from public, anon, authenticated;
revoke all on function public.adaptive_item_stop(uuid, uuid, integer) from public, anon, authenticated;

do $$ begin
  if to_regrole('service_role') is not null then
    grant execute on function public.adaptive_item_start(uuid, text, text, uuid, text, text[], text, integer, uuid, text) to service_role;
    grant execute on function public.adaptive_item_commit(uuid, uuid, integer, text, text, integer, text, text, text, integer, uuid, text) to service_role;
    grant execute on function public.adaptive_item_invalidate(uuid, uuid, integer, text) to service_role;
    grant execute on function public.adaptive_item_stop(uuid, uuid, integer) to service_role;
  end if;
end $$;
