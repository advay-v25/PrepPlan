-- Follow-up to 20261128 (kept intact).
--  1. Reintroducing an occurrence is also a booking: deleting a skipped or moved exception brings the class back at its original slot, so it
--     is checked like a new occurrence, under the same per-student lock. Archiving or deleting the whole series removes the occurrence and is
--     not affected (the occurrence query only returns active series).
--  2. A commitment-side refusal names the competing MOCK in DETAIL and the commitment's own occurrence title in HINT, so the app can say
--     "<class> would overlap <mock>"; mock-side refusals are unchanged (DETAIL = the other booking).
create or replace function public.commitments_booking_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare m record; v_id uuid; v_user uuid; v_title text;
begin
  if tg_op = 'DELETE' then
    v_id := old.commitment_id; v_user := old.user_id;
  elsif tg_table_name = 'calendar_commitments' then
    v_id := new.id; v_user := new.user_id;
    if tg_op = 'UPDATE' and (old.status, old.recurrence, old.weekdays, old.start_time, old.end_time, old.starts_on, old.ends_on, old.starts_at, old.ends_at, old.is_protected, old.kind)
       is not distinct from (new.status, new.recurrence, new.weekdays, new.start_time, new.end_time, new.starts_on, new.ends_on, new.starts_at, new.ends_at, new.is_protected, new.kind) then return null; end if;
  else
    v_id := new.commitment_id; v_user := new.user_id;
  end if;
  perform public.scope_lock(v_user);
  for m in select * from public.mock_appointments a where a.user_id = v_user and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null loop
    select p.title into v_title from public.protected_occurrences(v_user, public.mock_booking_range(v_user, m.planned_date, m.start_time, m.duration_minutes)) p
     where p.source_id = v_id limit 1;
    if v_title is not null then
      raise exception 'SLOT_TAKEN' using errcode = 'BK409', detail = coalesce(nullif(m.label, ''), 'Your mock'), hint = v_title;
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.commitments_booking_guard() from public, anon, authenticated;

drop trigger if exists timed_booking_guard_delete on public.commitment_exceptions;
create trigger timed_booking_guard_delete after delete on public.commitment_exceptions
  for each row execute function public.commitments_booking_guard();
