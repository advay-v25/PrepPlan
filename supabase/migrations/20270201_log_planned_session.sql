-- Phase 1: log a session against the exact planned block it was done for.
-- One transaction: actual minutes + completion status + explicit coverage + history, keyed by a client idempotency key.
-- It composes the existing owned commands (set_task_execution, confirm_task_scope) instead of re-implementing them,
-- so their revision, ownership, assessment and open-cycle rules stay the single source. Any exception rolls back both writes.
create table if not exists public.planned_log_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request jsonb not null,
  result jsonb not null,
  task_id text references public.plan_blocks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
alter table public.planned_log_commands enable row level security;
revoke all on public.planned_log_commands from public, anon, authenticated;
grant select on public.planned_log_commands to authenticated;
drop policy if exists planned_log_commands_read_own on public.planned_log_commands;
create policy planned_log_commands_read_own on public.planned_log_commands for select to authenticated
  using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.planned_log_commands to service_role;

create or replace function public.log_planned_session(
  p_user_id uuid, p_task_id text, p_expected_revision integer, p_execution text,
  p_minutes integer, p_outcome_ids text[], p_note text, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_task public.plan_blocks%rowtype; v_ids text[];
  v_request jsonb; v_receipt public.planned_log_commands%rowtype; v_exec jsonb; v_scope jsonb; v_result jsonb;
begin
  if v_uid is null or v_uid is distinct from p_user_id
    or not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id = v_uid and onboarding_status = 'complete') then
    raise exception 'Verify your email and complete setup before logging learning.' using errcode = '42501';
  end if;
  if p_task_id is null or p_expected_revision is null or p_expected_revision < 1
    or p_execution is null or p_execution not in ('completed', 'partial')
    or (p_minutes is not null and p_minutes not between 1 and 720)
    or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,60}$'
    or (p_note is not null and length(p_note) > 1000)
    or (p_outcome_ids is not null and (cardinality(p_outcome_ids) > 40 or array_position(p_outcome_ids, null) is not null)) then
    raise exception 'Check the task, status, minutes (1–720) and covered outcomes.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}'::text[]) into v_ids from unnest(coalesce(p_outcome_ids, '{}'::text[])) x;
  v_request := jsonb_build_object('task', p_task_id, 'revision', p_expected_revision, 'execution', p_execution,
    'minutes', p_minutes, 'outcomes', to_jsonb(v_ids), 'note', nullif(btrim(coalesce(p_note, '')), ''));
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':planned:' || p_idempotency_key, 0));
  select * into v_receipt from public.planned_log_commands where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.request is distinct from v_request then return jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT'); end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;

  select * into v_task from public.plan_blocks where id = p_task_id and user_id = v_uid for update;
  if not found then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  if v_task.cancelled_at is not null or v_task.execution = 'cancelled' or v_task.is_protected_commitment
    or v_task.task_type is null or v_task.task_type not in ('study', 'review', 'class_consolidation', 'verification') then
    raise exception 'This block cannot be logged as study.' using errcode = '22023';
  end if;
  if v_task.learning_activity_id is not null then
    return jsonb_build_object('ok', false, 'code', 'RECORDED_LEARNING', 'error', 'This is recorded learning. Remove an incorrect log and record it again.');
  end if;
  if exists (select 1 from public.plan_blocks where user_id = v_uid and continued_from_task_id = p_task_id) then
    return jsonb_build_object('ok', false, 'code', 'CONTINUED', 'error', 'This task continues in a later week. Open the continuation instead.');
  end if;
  if not exists (select 1 from public.planning_cycles where id = v_task.cycle_id and user_id = v_uid and status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'HISTORY_CLOSED', 'error', 'This block belongs to an earlier week. Log a separate session instead.');
  end if;

  v_exec := public.set_task_execution(p_user_id, p_task_id, p_expected_revision, p_execution, p_minutes, nullif(btrim(coalesce(p_note, '')), ''));
  if coalesce((v_exec ->> 'ok')::boolean, false) is not true then return v_exec; end if;
  if cardinality(v_ids) > 0 then
    v_scope := public.confirm_task_scope(p_user_id, p_task_id, (v_exec -> 'task' ->> 'revision')::integer, v_ids);
    if coalesce((v_scope ->> 'ok')::boolean, false) is not true then
      -- Raised so the execution write above rolls back too: no partial save.
      raise exception 'The task changed while saving. Reload and try again.' using errcode = '40001';
    end if;
    v_exec := jsonb_set(v_exec, '{task}', v_scope -> 'task');
  end if;
  v_result := jsonb_build_object('ok', true, 'action', 'planned', 'taskId', p_task_id, 'title', v_exec -> 'task' ->> 'title',
    'execution', p_execution, 'minutes', p_minutes, 'date', v_exec -> 'task' ->> 'local_date',
    'revision', (v_exec -> 'task' ->> 'revision')::integer,
    'scope', jsonb_build_object('state', case when cardinality(v_ids) > 0 then 'confirmed' else 'time_only' end, 'confirmed', cardinality(v_ids)),
    'replayed', false);
  insert into public.planned_log_commands(user_id, idempotency_key, request, result, task_id)
    values (v_uid, p_idempotency_key, v_request, v_result, p_task_id);
  return v_result;
end; $$;
revoke all on function public.log_planned_session(uuid, text, integer, text, integer, text[], text, text) from public, anon;
grant execute on function public.log_planned_session(uuid, text, integer, text, integer, text[], text, text) to authenticated;
