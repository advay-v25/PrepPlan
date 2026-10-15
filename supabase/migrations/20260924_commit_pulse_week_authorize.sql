-- 20260922 revoked EXECUTE from `authenticated` but missed something this
-- project does differently than assumed: every new function in schema
-- public gets EXECUTE granted to `anon` (fully unauthenticated) AND
-- `authenticated` by default (`alter default privileges ... grant execute
-- on functions to ...`, configured at the project level, confirmed via
-- pg_default_acl and by checking accept_onboarding_preview and
-- apply_diagnostic_repair_proposal, which carry the same anon grant).
-- Revoking authenticated left anon still able to call commit_pulse_week
-- with no JWT at all — worse than the original finding, not better.
--
-- This project's real safety pattern, used by every other security definer
-- RPC here, is an internal auth.uid() check rather than withholding grants
-- (grants alone are fragile against exactly this kind of default-ACL drift).
-- commit_pulse_week now follows that pattern: a call from anon or a
-- mismatched authenticated user is rejected; a call with no JWT subject at
-- all (auth.uid() is null) — which is what this function's one real caller,
-- createAdminClient()'s service_role client, presents as — is allowed
-- through unchanged, since service_role already bypasses grants and RLS
-- entirely and has no auth.uid() of its own to check.

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
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Unauthorized';
  end if;

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

revoke execute on function public.commit_pulse_week(uuid, date, date, text, jsonb) from anon;
