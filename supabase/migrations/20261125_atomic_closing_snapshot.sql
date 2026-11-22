-- Preserve the legacy closing-day field without a second, racing application write.
create function public.derived_week_closing_day(p_user uuid) returns integer
language plpgsql stable set search_path=public,pg_temp as $$
declare v_end date; v_day integer; v_zone text; v_next date; v_today date;
begin
  select ends_at_local into v_end from public.planning_cycles where user_id=p_user and status='active';
  if v_end is not null then return extract(dow from v_end)::int; end if;
  with days as (
    select distinct d::int as day from public.calendar_commitments c cross join lateral unnest(c.weekdays) d
    where c.user_id=p_user and c.kind='class' and c.status='active' and c.recurrence='weekly'
  ), gaps as (
    select day,coalesce(lag(day) over w,last_value(day) over (w rows between unbounded preceding and unbounded following)) as previous
    from days window w as (order by (day+6)%7)
  )
  select (day+6)%7 into v_day from gaps order by coalesce(nullif((day-previous+7)%7,0),7) desc,(day+6)%7 limit 1;
  if v_day is not null then return v_day; end if;
  select timezone into v_zone from public.profiles where id=p_user;
  v_zone:=coalesce(v_zone,'UTC'); v_today:=(now() at time zone v_zone)::date;
  select (starts_at at time zone v_zone)::date into v_next from public.calendar_commitments
    where user_id=p_user and kind='class' and status='active' and recurrence='none' and defines_cycle and starts_at>now()
    order by starts_at limit 1;
  if v_next-v_today between 2 and 13 then return extract(dow from v_next-1)::int; end if;
  return 0;
end $$;
revoke all on function public.derived_week_closing_day(uuid) from public,anon,authenticated;
grant execute on function public.derived_week_closing_day(uuid) to service_role;

do $$
declare d text;
begin
  select pg_get_functiondef('public.onboarding_commit_step(uuid,text,jsonb)'::regprocedure) into d;
  d:=replace(d,'  update public.profiles set onboarding_context_version',
    E'  if p_step in (''route'',''exam'') then\n    update public.profiles set diagnostic_day=public.derived_week_closing_day(p_user) where id=p_user;\n  end if;\n  update public.profiles set onboarding_context_version');
  if position('diagnostic_day=public.derived_week_closing_day' in d)=0 then raise exception 'Could not add atomic closing snapshot'; end if;
  execute d;
end $$;
