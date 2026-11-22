-- Timed bookings are checked where they are written, under the per-student scope lock.
--
-- The TypeScript preflight (assertSlotFree, occupantsFor) stays for suggestions, but a check made before the transaction can lose a race.
-- Every writer of these tables already takes scope_lock(user) in a BEFORE trigger (scope_write_lock), so this guard runs after that lock is
-- held and reads committed rows with a fresh statement snapshot: one of two conflicting writers waits, then sees the other and is refused.
--
--   * a timed MOCK (status planned, with a start time and length) is refused against a protected occurrence (protected commitment or class,
--     one-off or weekly with its exceptions), another timed planned mock, or a timed task;
--   * a timed TASK is refused against a timed planned mock (task-to-task overlap stays a warning, handled in the app);
--   * a protected commitment / class / moved occurrence is refused when it lands on a timed planned mock.
-- Intervals are half-open ('[)') so adjacent bookings work. Everything is compared as absolute instants in the student's timezone,
-- so a one-off commitment that crosses local midnight occupies both days. Rows that already overlap are left alone; only a write that
-- changes the time, length, owner status or kind of a booking is checked. The refusal is SQLSTATE BK409 with message SLOT_TAKEN and the
-- conflicting title in DETAIL; the whole transaction (including a checkpoint_command receipt) rolls back.

create or replace function public.booking_tz(p_user uuid) returns text language sql stable set search_path = '' as $$
  select coalesce((select nullif(timezone, '') from public.profiles where id = p_user), 'UTC')
$$;

create or replace function public.mock_booking_range(p_user uuid, p_date date, p_start time, p_minutes int) returns tstzrange
language sql stable set search_path = '' as $$
  select case when p_date is null or p_start is null or p_minutes is null then null
    else tstzrange(((p_date + p_start)::timestamp at time zone public.booking_tz(p_user)),
                   ((p_date + p_start)::timestamp at time zone public.booking_tz(p_user)) + make_interval(mins => p_minutes), '[)') end
$$;

-- Protected occurrences (protected commitments and classes) overlapping a range.
create or replace function public.protected_occurrences(p_user uuid, p_range tstzrange)
returns table (source_id uuid, title text) language plpgsql stable set search_path = '' as $$
declare
  v_tz text := public.booking_tz(p_user);
  v_from date := ((lower(p_range) at time zone v_tz)::date) - 1;
  v_to date := ((upper(p_range) at time zone v_tz)::date) + 1;
begin
  return query
  select c.id, c.label from public.calendar_commitments c
   where c.user_id = p_user and c.status = 'active' and c.recurrence = 'none' and (c.is_protected or c.kind = 'class')
     and tstzrange(c.starts_at, greatest(c.ends_at, c.starts_at + interval '15 minutes'), '[)') && p_range;

  -- ordinary weekly occurrences (not skipped or moved on that date)
  return query
  select c.id, c.label
    from public.calendar_commitments c
    cross join lateral generate_series(v_from::timestamp, v_to::timestamp, interval '1 day') g(ts)
   where c.user_id = p_user and c.status = 'active' and c.recurrence = 'weekly' and (c.is_protected or c.kind = 'class')
     and c.start_time is not null and c.end_time is not null
     and extract(dow from g.ts)::smallint = any (c.weekdays)
     and (c.starts_on is null or g.ts::date >= c.starts_on) and (c.ends_on is null or g.ts::date <= c.ends_on)
     and not exists (select 1 from public.commitment_exceptions e where e.commitment_id = c.id and e.occurrence_date = g.ts::date)
     and tstzrange((g.ts::date + c.start_time)::timestamp at time zone v_tz,
                   ((g.ts::date + c.start_time)::timestamp at time zone v_tz) + greatest(c.end_time - c.start_time, interval '15 minutes'), '[)') && p_range;

  -- moved occurrences, at their new date and time (the original occurrence must have been a real one)
  return query
  select c.id, c.label
    from public.commitment_exceptions e
    join public.calendar_commitments c on c.id = e.commitment_id
   where e.user_id = p_user and e.kind = 'moved' and c.status = 'active' and c.recurrence = 'weekly' and (c.is_protected or c.kind = 'class')
     and c.start_time is not null and c.end_time is not null
     and extract(dow from e.occurrence_date)::smallint = any (c.weekdays)
     and (c.starts_on is null or e.occurrence_date >= c.starts_on) and (c.ends_on is null or e.occurrence_date <= c.ends_on)
     and coalesce(e.new_date, e.occurrence_date) between v_from and v_to
     and tstzrange((coalesce(e.new_date, e.occurrence_date) + coalesce(e.new_start_time, c.start_time))::timestamp at time zone v_tz,
                   ((coalesce(e.new_date, e.occurrence_date) + coalesce(e.new_start_time, c.start_time))::timestamp at time zone v_tz)
                     + greatest(coalesce(e.new_end_time - coalesce(e.new_start_time, c.start_time), c.end_time - c.start_time), interval '15 minutes'), '[)') && p_range;
end $$;

create or replace function public.booking_refuse(p_title text) returns void language plpgsql set search_path = '' as $$
begin
  raise exception 'SLOT_TAKEN' using errcode = 'BK409', detail = coalesce(p_title, 'Another booking');
end $$;

-- A timed mock against protected occurrences, other timed mocks and timed tasks.
create or replace function public.mock_appointments_booking_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_range tstzrange; v_title text;
begin
  if new.status <> 'planned' or new.start_time is null or new.duration_minutes is null then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'planned' and old.planned_date = new.planned_date
     and old.start_time is not distinct from new.start_time and old.duration_minutes is not distinct from new.duration_minutes then return new; end if;
  perform public.scope_lock(new.user_id);
  v_range := public.mock_booking_range(new.user_id, new.planned_date, new.start_time, new.duration_minutes);
  select p.title into v_title from public.protected_occurrences(new.user_id, v_range) p limit 1;
  if v_title is null then
    select coalesce(nullif(m.label, ''), 'Another mock') into v_title from public.mock_appointments m
     where m.user_id = new.user_id and m.id <> new.id and m.status = 'planned' and m.start_time is not null and m.duration_minutes is not null
       and public.mock_booking_range(m.user_id, m.planned_date, m.start_time, m.duration_minutes) && v_range limit 1;
  end if;
  if v_title is null then
    select b.title into v_title from public.plan_blocks b
     where b.user_id = new.user_id and b.placement = 'timed' and b.starts_at is not null and b.cancelled_at is null and b.execution <> 'cancelled'
       and b.learning_activity_id is null
       and tstzrange(b.starts_at, b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)), '[)') && v_range limit 1;
  end if;
  if v_title is not null then perform public.booking_refuse(v_title); end if;
  return new;
end $$;
drop trigger if exists timed_booking_guard on public.mock_appointments;
create trigger timed_booking_guard before insert or update on public.mock_appointments
  for each row execute function public.mock_appointments_booking_guard();

-- A timed open task against timed planned mocks. Only a write that changes its time, length, placement or reopens it is checked.
create or replace function public.plan_blocks_booking_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_range tstzrange; v_title text;
begin
  if new.placement is distinct from 'timed' or new.starts_at is null or new.cancelled_at is not null
     or new.execution in ('cancelled', 'completed', 'skipped') or new.learning_activity_id is not null then return new; end if;
  if tg_op = 'UPDATE' and old.starts_at is not distinct from new.starts_at and old.duration_minutes is not distinct from new.duration_minutes
     and old.placement is not distinct from new.placement and old.cancelled_at is null and old.execution not in ('cancelled', 'completed', 'skipped') then return new; end if;
  perform public.scope_lock(new.user_id);
  v_range := tstzrange(new.starts_at, new.starts_at + make_interval(mins => coalesce(new.duration_minutes, 30)), '[)');
  select coalesce(nullif(m.label, ''), 'Your mock') into v_title from public.mock_appointments m
   where m.user_id = new.user_id and m.status = 'planned' and m.start_time is not null and m.duration_minutes is not null
     and public.mock_booking_range(m.user_id, m.planned_date, m.start_time, m.duration_minutes) && v_range limit 1;
  if v_title is not null then perform public.booking_refuse(v_title); end if;
  return new;
end $$;
drop trigger if exists timed_booking_guard on public.plan_blocks;
create trigger timed_booking_guard before insert or update on public.plan_blocks
  for each row execute function public.plan_blocks_booking_guard();

-- A protected commitment, class or moved occurrence landing on a timed planned mock. AFTER the write so the new row is visible to the check.
create or replace function public.commitments_booking_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; v_id uuid; v_title text;
begin
  if tg_table_name = 'calendar_commitments' then
    v_id := new.id;
    if tg_op = 'UPDATE' and (old.status, old.recurrence, old.weekdays, old.start_time, old.end_time, old.starts_on, old.ends_on, old.starts_at, old.ends_at, old.is_protected, old.kind)
       is not distinct from (new.status, new.recurrence, new.weekdays, new.start_time, new.end_time, new.starts_on, new.ends_on, new.starts_at, new.ends_at, new.is_protected, new.kind) then return new; end if;
  else
    v_id := new.commitment_id;
  end if;
  for m in select * from public.mock_appointments a where a.user_id = new.user_id and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null loop
    select p.title into v_title from public.protected_occurrences(new.user_id, public.mock_booking_range(new.user_id, m.planned_date, m.start_time, m.duration_minutes)) p
     where p.source_id = v_id limit 1;
    if v_title is not null then perform public.booking_refuse(v_title); end if;
  end loop;
  return null;
end $$;
drop trigger if exists timed_booking_guard on public.calendar_commitments;
create trigger timed_booking_guard after insert or update on public.calendar_commitments
  for each row execute function public.commitments_booking_guard();
drop trigger if exists timed_booking_guard on public.commitment_exceptions;
create trigger timed_booking_guard after insert or update on public.commitment_exceptions
  for each row when (new.kind = 'moved') execute function public.commitments_booking_guard();

-- Service-only helpers: the guards are the supported entry point.
revoke all on function public.booking_tz(uuid), public.mock_booking_range(uuid, date, time, int), public.protected_occurrences(uuid, tstzrange),
  public.booking_refuse(text), public.mock_appointments_booking_guard(), public.plan_blocks_booking_guard(), public.commitments_booking_guard()
  from public, anon, authenticated;
