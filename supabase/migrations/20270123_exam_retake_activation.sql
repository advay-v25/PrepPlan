-- Retake activation. A completed sitting (exam_completion) pauses study; a later booked date was never able to resume it (examPhase reports 'sat' whenever
-- sat_on exists). activate_retake is the explicit acceptance: the completed sitting is archived here and every reader (all key off exam_completion) sees the
-- new sitting as active. Owned, RLS on, no direct grants; cascades with the account; exported.
create table if not exists public.exam_completion_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sat_on date not null, reported_result text, psm_status text, retake_requested_at timestamptz, retake_note text,
  new_exam_date date not null, archived_at timestamptz not null default now()
);
create index if not exists exam_completion_history_user_idx on public.exam_completion_history (user_id, archived_at);
alter table public.exam_completion_history enable row level security;
revoke all on public.exam_completion_history from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant all on public.exam_completion_history to service_role; end if; end $$;

CREATE OR REPLACE FUNCTION public.record_exam_status(p_user uuid, p_action text, p_sat_on date DEFAULT NULL::date, p_today date DEFAULT NULL::date, p_result text DEFAULT NULL::text, p_psm text DEFAULT NULL::text, p_retake_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.exam_completion%rowtype; v_new date;
begin
  -- current-week serialization
  perform public.scope_lock(p_user);
  perform pg_advisory_xact_lock(hashtextextended('exam:' || p_user::text, 0));
  if p_action = 'sat' then
    if p_sat_on is null or p_today is null or p_sat_on > p_today then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE'); end if;
    insert into public.exam_completion (user_id, sat_on) values (p_user, p_sat_on)
      on conflict (user_id) do update set sat_on = excluded.sat_on;
    update public.exam_attempts set status = 'complete', updated_at = now() where user_id = p_user and status in ('active', 'paused');
  elsif p_action = 'undo' then
    delete from public.exam_completion where user_id = p_user;
    update public.exam_attempts set status = 'active', updated_at = now()
      where id = (select id from public.exam_attempts where user_id = p_user and status = 'complete' order by updated_at desc limit 1)
        and not exists (select 1 from public.exam_attempts x where x.user_id = p_user and x.status = 'active');
  elsif p_action = 'follow_up' then
    select * into v_row from public.exam_completion where user_id = p_user for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_SAT'); end if;
    if p_psm is not null and p_psm not in ('done', 'not_done', 'unsure') then return jsonb_build_object('ok', false, 'code', 'INVALID_PSM'); end if;
    update public.exam_completion set reported_result = coalesce(nullif(btrim(p_result), ''), reported_result), psm_status = coalesce(p_psm, psm_status),
      retake_requested_at = case when p_retake_note is not null then coalesce(retake_requested_at, now()) else retake_requested_at end,
      retake_note = coalesce(nullif(btrim(p_retake_note), ''), retake_note) where user_id = p_user;
  elsif p_action = 'activate_retake' then
    -- Explicit acceptance of a NEW sitting after a completed one. The completed sitting (date, reported result, PSM, retake request) moves to
    -- exam_completion_history; tasks, papers, notes and evidence are untouched. No row = already active (a repeat is a replay, never a second activation).
    select * into v_row from public.exam_completion where user_id = p_user for update;
    if not found then
      if exists (select 1 from public.exam_completion_history h where h.user_id = p_user and h.new_exam_date = (select exam_date from public.profiles where id = p_user)) then
        return jsonb_build_object('ok', true, 'action', p_action, 'already_active', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'NOT_SAT');
    end if;
    if v_row.retake_requested_at is null then return jsonb_build_object('ok', false, 'code', 'NO_RETAKE_REQUEST'); end if;
    select exam_date into v_new from public.profiles where id = p_user;
    if v_new is null or v_new <= v_row.sat_on or p_today is null or v_new < p_today then return jsonb_build_object('ok', false, 'code', 'NO_NEW_SITTING'); end if;
    insert into public.exam_completion_history (user_id, sat_on, reported_result, psm_status, retake_requested_at, retake_note, new_exam_date)
      values (p_user, v_row.sat_on, v_row.reported_result, v_row.psm_status, v_row.retake_requested_at, v_row.retake_note, v_new);
    delete from public.exam_completion where user_id = p_user;
  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;
  update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
  return jsonb_build_object('ok', true, 'action', p_action);
end $function$;
