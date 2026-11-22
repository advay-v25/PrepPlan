-- Preparation added for a mock remembers the appointment date the student last accepted (added or kept). Review is asked for when the
-- appointment's actual date differs from that record, or the appointment is gone, not when a projected suggestion date happens to differ.
-- Existing rows take the appointment's current date as accepted (history cannot say what was accepted earlier); "Keep it" re-bases it.
alter table public.checkpoint_suggestion_tasks add column if not exists basis_date date;

update public.checkpoint_suggestion_tasks s set basis_date = a.planned_date
  from public.mock_appointments a where a.id = s.checkpoint_id and s.basis_date is null;

create or replace function public.checkpoint_suggestion_tasks_basis() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or (new.reviewed_at is not null and new.reviewed_at is distinct from old.reviewed_at) then
    select a.planned_date into new.basis_date from public.mock_appointments a where a.id = new.checkpoint_id;
    if tg_op = 'UPDATE' and new.basis_date is null then new.basis_date := old.basis_date; end if;
  end if;
  return new;
end $$;
drop trigger if exists checkpoint_suggestion_tasks_basis on public.checkpoint_suggestion_tasks;
create trigger checkpoint_suggestion_tasks_basis before insert or update on public.checkpoint_suggestion_tasks
  for each row execute function public.checkpoint_suggestion_tasks_basis();
revoke all on function public.checkpoint_suggestion_tasks_basis() from public, anon, authenticated;
