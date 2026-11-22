-- The legacy profile path (onboarding and Settings write profiles.mock_*) edits or clears the NEXT appointment. It bypassed two rules the
-- Calendar command enforces: a rehearsal that has started cannot be cancelled, and cancelling an appointment also closes its unstarted
-- rehearsal and drops a week choice that pointed at it. Both now hold on this path too. Otherwise identical to 20261112.
create or replace function public.profiles_clear_mock_timing() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a public.mock_appointments%rowtype; v_n public.mock_appointments%rowtype; v_has boolean;
begin
  if coalesce(current_setting('app.mock_projection', 'false'), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and (old.mock_date, old.mock_kind, old.mock_label, old.mock_start_time, old.mock_duration_minutes)
       is not distinct from (new.mock_date, new.mock_kind, new.mock_label, new.mock_start_time, new.mock_duration_minutes) then
    return new;
  end if;
  perform set_config('app.mock_from_profile', 'on', true);
  if tg_op = 'UPDATE' and old.mock_id is not null then
    select * into v_a from public.mock_appointments where id = old.mock_id and user_id = new.id and status = 'planned' for update;
  end if;
  if new.mock_date is null then
    if v_a.id is not null then
      if exists (select 1 from public.mock_rehearsals r where r.appointment_id = v_a.id and r.status = 'in_progress') then
        raise exception 'REHEARSAL_STARTED: a rehearsal that has started cannot be removed from setup';
      end if;
      update public.mock_appointments set status = 'cancelled' where id = v_a.id;
      update public.mock_rehearsals set status = 'cancelled' where appointment_id = v_a.id and status = 'ready';
      delete from public.cycle_assessment_choices where user_id = new.id and appointment_id = v_a.id;
    end if;
  elsif v_a.id is not null then
    update public.mock_appointments set planned_date = new.mock_date, label = new.mock_label, start_time = new.mock_start_time, duration_minutes = new.mock_duration_minutes,
      kind = case when v_a.kind = 'internal_rehearsal' then v_a.kind else coalesce(new.mock_kind, v_a.kind) end where id = v_a.id;
  elsif new.mock_kind is not null then
    insert into public.mock_appointments (user_id, kind, planned_date, label, start_time, duration_minutes)
      values (new.id, new.mock_kind, new.mock_date, new.mock_label, new.mock_start_time, new.mock_duration_minutes);
  end if;
  select * into v_n from public.mock_appointments where user_id = new.id and status = 'planned' order by planned_date, created_at, id limit 1;
  v_has := found;
  perform set_config('app.mock_from_profile', 'off', true);
  if v_has then
    new.mock_id := v_n.id; new.mock_version := v_n.version; new.mock_date := v_n.planned_date; new.mock_kind := v_n.kind; new.mock_label := v_n.label;
    new.mock_start_time := v_n.start_time; new.mock_duration_minutes := v_n.duration_minutes;
  else
    new.mock_id := null; new.mock_date := null; new.mock_kind := null; new.mock_label := null; new.mock_start_time := null; new.mock_duration_minutes := null;
  end if;
  return new;
end $$;
