-- One open attempt per (student, kind, scope key): makes starting an assessment idempotent under
-- concurrent requests instead of relying on a read-then-insert.
alter table public.assessment_attempts add column if not exists open_key text;
create unique index if not exists assessment_attempts_one_open_idx
  on public.assessment_attempts (user_id, attempt_kind, open_key)
  where open_key is not null and status in ('ready', 'in_progress', 'assembling');
