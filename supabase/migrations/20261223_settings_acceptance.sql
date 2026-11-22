-- Settings acceptance pass. ADDITIVE: two functions are replaced (the previously applied migrations stay as they were).
-- 1. onboarding_commit_step_checked took the PROFILE row lock before the inner command's scope_lock; every other planning writer takes scope_lock FIRST and rows
--    after, so the two orders could deadlock. It now takes scope_lock first (re-entrant for the inner command, same transaction), then the row lock.
-- 2. set_classes_finished now takes part in the setup freshness boundary: a MATERIAL class transition (a series ended/restored, or the finished date changed)
--    increments profiles.onboarding_context_version in the same transaction; a repeat or no-op does not. Undo restores a series' remembered end only while the
--    series is still exactly as this command left it (active and still ending on the finished date); anything the student changed or archived since is kept,
--    reported back as `kept`, and never overwritten. Undo that would put a class over a booked mock refuses as a whole (nothing changed) with UNDO_CONFLICT.
create or replace function public.onboarding_commit_step_checked(p_user uuid, p_step text, p_args jsonb, p_expected integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur integer; v_new integer;
begin
  perform public.scope_lock(p_user);
  select onboarding_context_version into v_cur from public.profiles where id = p_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_expected is null or v_cur is distinct from p_expected then
    return jsonb_build_object('ok', false, 'code', 'STALE_SETUP', 'currentVersion', v_cur);
  end if;
  v_new := public.onboarding_commit_step(p_user, p_step, p_args);
  return jsonb_build_object('ok', true, 'version', v_new);
end $$;
revoke all on function public.onboarding_commit_step_checked(uuid, text, jsonb, integer) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.onboarding_commit_step_checked(uuid, text, jsonb, integer) to service_role; end if; end $$;

create or replace function public.set_classes_finished(p_user uuid, p_done boolean, p_date date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer := 0; v_before date; v_finish date; v_kept jsonb := '[]'::jsonb; v_conf jsonb; r record;
begin
  perform public.scope_lock(p_user);
  select classes_completed_at into v_before from public.profiles where id = p_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_done then
    update public.calendar_commitments set ends_on_before_completion = ends_on, ended_by_completion = true, ends_on = p_date
     where user_id = p_user and kind = 'class' and recurrence = 'weekly' and status = 'active' and not ended_by_completion and (ends_on is null or ends_on > p_date);
    get diagnostics v_n = row_count;
    perform public.update_planning_profile(p_user, jsonb_build_object('classes_completed_at', p_date::text));
    if v_n > 0 or v_before is distinct from p_date then
      update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    end if;
    return jsonb_build_object('ok', true, 'seriesEnded', v_n, 'effective', p_date);
  end if;

  v_finish := v_before;
  -- Series this command ended that the student has since changed (ended on another date) or archived are kept as they are now.
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'reason', case when c.status <> 'active' then 'archived' else 'edited' end)), '[]'::jsonb) into v_kept
    from public.calendar_commitments c where c.user_id = p_user and c.kind = 'class' and c.ended_by_completion
     and (c.status <> 'active' or c.ends_on is distinct from v_finish);
  -- A restored class must not land on a booked mock: refuse the whole undo, change nothing.
  select coalesce(jsonb_agg(jsonb_build_object('series', c.label, 'date', m.planned_date, 'mock', coalesce(m.label, 'Booked mock'))), '[]'::jsonb) into v_conf
    from public.calendar_commitments c
    join public.mock_appointments m on m.user_id = p_user and m.status = 'planned'
     and m.planned_date > v_finish and (c.ends_on_before_completion is null or m.planned_date <= c.ends_on_before_completion)
     and extract(dow from m.planned_date)::int = any (c.weekdays)
     and (m.start_time is null or c.start_time is null or c.end_time is null
          or (m.start_time < c.end_time and (m.start_time + make_interval(mins => coalesce(m.duration_minutes, 0))) > c.start_time))
   where c.user_id = p_user and c.kind = 'class' and c.ended_by_completion and c.status = 'active' and c.ends_on is not distinct from v_finish;
  if jsonb_array_length(v_conf) > 0 then
    return jsonb_build_object('ok', false, 'code', 'UNDO_CONFLICT', 'conflicts', v_conf);
  end if;
  update public.calendar_commitments set ends_on = ends_on_before_completion, ends_on_before_completion = null, ended_by_completion = false
   where user_id = p_user and kind = 'class' and ended_by_completion and status = 'active' and ends_on is not distinct from v_finish;
  get diagnostics v_n = row_count;
  update public.calendar_commitments set ends_on_before_completion = null, ended_by_completion = false
   where user_id = p_user and kind = 'class' and ended_by_completion;                          -- kept series are no longer "ended by completion"
  perform public.update_planning_profile(p_user, jsonb_build_object('classes_completed_at', null));
  if v_n > 0 or v_before is not null then
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
  end if;
  return jsonb_build_object('ok', true, 'seriesRestored', v_n, 'kept', v_kept);
end $$;
revoke all on function public.set_classes_finished(uuid, boolean, date) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.set_classes_finished(uuid, boolean, date) to service_role; end if; end $$;
notify pgrst, 'reload schema';
