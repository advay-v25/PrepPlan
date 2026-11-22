-- Repeat the server's calendar-date spacing rule under the existing scheduling lock, immediately before reserving a new check.
-- Effective-definition patch preserves the exact-version/family trust checks and legacy-attempt resume path.
do $patch$
declare d text; needle text;
begin
  d := pg_get_functiondef('public.start_repair_check(uuid,text,text[],uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer)'::regprocedure);
  needle := '  v_n int := coalesce(array_length(p_item_ids, 1), 0);';
  if position(needle in d) = 0 then raise exception 'Unexpected re-check declarations'; end if;
  d := replace(d, needle, needle || E'\n  v_zone text; v_today date; v_available date; v_finished timestamptz;');
  needle := '  select array_agg(t.id) into v_waiting from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id';
  if position(needle in d) = 0 then raise exception 'Unexpected re-check dependency guard'; end if;
  d := replace(d, needle, $new$
  perform 1 from public.repair_threads t join public.repair_check_threads l on l.thread_id = t.id
    where l.check_task_id = p_check_task_id and l.user_id = p_user and t.user_id = p_user order by t.id for update of t;
$new$ || needle);
  needle := '  if v_n < p_min_questions then';
  if position(needle in d) = 0 then raise exception 'Unexpected re-check reservation guard'; end if;
  d := replace(d, needle, $new$
  select coalesce(timezone, 'UTC') into v_zone from public.profiles where id = p_user for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'CHECK_UNAVAILABLE'); end if;
  select max(e.created_at) into v_finished from public.task_events e join public.plan_blocks b on b.id = e.task_id and b.user_id = p_user
    where e.user_id = p_user and e.event_type = 'completed' and b.task_type = 'repair' and b.execution = 'completed' and b.cancelled_at is null
      and exists (select 1 from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
        where l.check_task_id = p_check_task_id and l.user_id = p_user and t.user_id = p_user
          and t.status not in ('closed', 'cancelled', 'superseded') and l.thread_id = b.repair_thread_id);
  if v_finished is null then
    return jsonb_build_object('ok', false, 'code', 'WAITING_ON_REPAIRS', 'message', 'The repair completion time could not be verified.');
  end if;
  select max((t.next_recheck_due_at at time zone 'UTC')::date) into v_available
    from public.repair_check_threads l join public.repair_threads t on t.id = l.thread_id
    where l.check_task_id = p_check_task_id and l.user_id = p_user and t.user_id = p_user and t.status not in ('closed', 'cancelled', 'superseded');
  -- Three local calendar days, matching RECHECK_GAP_DAYS; moving the check cannot shorten the gap.
  v_available := greatest(v_task.local_date, v_available, (v_finished at time zone v_zone)::date + 3);
  v_today := (clock_timestamp() at time zone v_zone)::date;
  if v_available > v_today then
    return jsonb_build_object('ok', false, 'code', 'RECHECK_NOT_DUE', 'earliestDate', v_available,
      'message', 'This check is not due yet. Review its date and repair history in Calendar.');
  end if;

$new$ || needle);
  execute d;
end $patch$;
revoke all on function public.start_repair_check(uuid,text,text[],uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.start_repair_check(uuid,text,text[],uuid,jsonb,jsonb,jsonb,jsonb,jsonb,integer) to service_role;
end if; end $$;
notify pgrst, 'reload schema';
