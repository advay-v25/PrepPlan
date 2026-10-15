-- Atomic write for commitWeekPlan (src/lib/planning/pulse/generateWeek.ts).
--
-- The prior code did two separate REST inserts: create the planning_cycles
-- row, then insert plan_blocks rows. If the second insert failed (as it did
-- live: a module's duration_minutes exceeded the plan_blocks_duration_minutes_check
-- range of 5-180), the first insert was left behind as an orphaned 'active'
-- cycle with zero tasks. planning_cycles_active_user_idx is a unique index on
-- (user_id) WHERE status = 'active', so every subsequent attempt to generate
-- that user's week then failed immediately on cycle creation, permanently
-- blocking generation until the orphan was manually deleted.
--
-- This RPC makes cycle-creation and task-insertion one transaction, and
-- reuses an existing active cycle instead of erroring on it — self-healing
-- any orphan left by the bug above, and giving "the user's active cycle" the
-- single-row invariant the unique index already assumes.

create or replace function public.commit_pulse_week(
  p_user_id uuid,
  p_starts_at_local date,
  p_ends_at_local date,
  p_timezone text,
  p_rows jsonb
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cycle_id uuid;
begin
  select id into v_cycle_id
  from public.planning_cycles
  where user_id = p_user_id and status = 'active'
  for update;

  if v_cycle_id is null then
    v_cycle_id := gen_random_uuid();
    insert into public.planning_cycles (
      id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status
    ) values (
      v_cycle_id, p_user_id, now(), now() + interval '7 days',
      p_starts_at_local, p_ends_at_local, p_timezone, 'active'
    );
  else
    update public.planning_cycles
    set starts_at_local = p_starts_at_local, ends_at_local = p_ends_at_local, timezone = p_timezone
    where id = v_cycle_id;
  end if;

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority,
    placement, execution, local_date, day, starts_at, duration_minutes, duration,
    lm_id, repair_thread_id, rationale, created_by
  )
  select
    r->>'id', p_user_id, v_cycle_id, r->>'title', r->>'detail', r->>'task_type', r->>'origin',
    r->>'priority', r->>'placement', r->>'execution', (r->>'local_date')::date, (r->>'day')::date,
    nullif(r->>'starts_at', '')::timestamptz, (r->>'duration_minutes')::smallint, r->>'duration',
    nullif(r->>'lm_id', ''), nullif(r->>'repair_thread_id', '')::uuid, r->>'rationale', r->>'created_by'
  from jsonb_array_elements(p_rows) as r;

  return json_build_object('cycle_id', v_cycle_id);
end;
$$;

revoke execute on function public.commit_pulse_week(uuid, date, date, text, jsonb) from public;
grant execute on function public.commit_pulse_week(uuid, date, date, text, jsonb) to authenticated;
grant execute on function public.commit_pulse_week(uuid, date, date, text, jsonb) to service_role;
