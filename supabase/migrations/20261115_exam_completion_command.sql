-- Phase 5: "I sat the exam" as ONE command. Service role only; the student's own statement, never inferred. History is kept: nothing is deleted
-- or cancelled, the active exam attempt is marked complete, and unaccepted drafts go stale (the weekly token covers exam_completion).
create or replace function public.record_exam_status(p_user uuid, p_action text, p_sat_on date default null, p_today date default null, p_result text default null,
                                                    p_psm text default null, p_retake_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.exam_completion%rowtype;
begin
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
  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_ACTION');
  end if;
  update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
  return jsonb_build_object('ok', true, 'action', p_action);
end $$;
revoke all on function public.record_exam_status(uuid, text, date, date, text, text, text) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.record_exam_status(uuid, text, date, date, text, text, text) to service_role; end if; end $$;
notify pgrst, 'reload schema';
