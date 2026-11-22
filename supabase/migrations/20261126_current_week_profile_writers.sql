-- Remaining planning inputs use the same per-user barrier as a current-week acceptance.
-- Profile routes acquire it before the row lock, rather than relying on a BEFORE ROW trigger after UPDATE has locked the row.
create function public.update_planning_profile(p_user uuid,p_patch jsonb) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or exists (
    select 1 from jsonb_object_keys(p_patch) k where k not in ('display_name','max_session_minutes','prep_mode','classes_completed_at')
  ) then raise exception 'Invalid profile patch'; end if;
  perform public.scope_lock(p_user);
  update public.profiles set
    display_name=case when p_patch ? 'display_name' then p_patch->>'display_name' else display_name end,
    max_session_minutes=case when p_patch ? 'max_session_minutes' then (p_patch->>'max_session_minutes')::smallint else max_session_minutes end,
    prep_mode=case when p_patch ? 'prep_mode' then p_patch->>'prep_mode' else prep_mode end,
    classes_completed_at=case when p_patch ? 'classes_completed_at' then (p_patch->>'classes_completed_at')::date else classes_completed_at end,
    updated_at=now()
  where id=p_user;
  if not found then raise exception 'Profile not found'; end if;
end $$;
revoke all on function public.update_planning_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_planning_profile(uuid,jsonb) to service_role;

create trigger scope_write_lock before insert or update or delete on public.repair_threads
for each row execute function public.scope_write_lock();

do $$
declare f record; d text;
begin
  for f in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('confirm_coach_proposal','accept_repair_proposal','place_repair_check','start_repair_check','apply_redistribution','reverse_redistribution')
  loop
    d:=pg_get_functiondef(f.oid);
    if position('-- planning input serialization' in d)=0 then
      d:=regexp_replace(d,'\mbegin\M',E'begin\n  -- planning input serialization\n  perform public.scope_lock(' ||
        case when f.proname in ('confirm_coach_proposal','accept_repair_proposal','place_repair_check') then 'auth.uid()' else 'p_user' end || ');','i');
      if position('-- planning input serialization' in d)=0 then raise exception 'Could not add lock to %',f.proname; end if;
      execute d;
    end if;
  end loop;
end $$;
