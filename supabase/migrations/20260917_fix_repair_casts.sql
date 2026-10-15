-- apply_diagnostic_repair_proposal inserted JSON text into typed columns.
--
-- `local_date` is a date and `starts_at` a timestamptz, but the function passed
-- `v_task->>'local_date'` and `v_task->>'starts_at'` straight through as text.
-- Postgres refuses the insert, so accepting a repair proposal always failed
-- with 'column "local_date" is of type date but expression is of type text' —
-- meaning no diagnostic follow-up could ever reach the calendar.
do $$
declare
  body text;
begin
  select pg_get_functiondef(oid) into body
  from pg_proc where proname = 'apply_diagnostic_repair_proposal' limit 1;

  if body is null then
    raise notice 'apply_diagnostic_repair_proposal not present; nothing to patch';
    return;
  end if;

  body := replace(
    body,
    'v_task->>''local_date'', v_task->>''day'', v_task->>''starts_at''',
    '(nullif(v_task->>''local_date'', ''''))::date, v_task->>''day'', (nullif(v_task->>''starts_at'', ''''))::timestamptz'
  );

  execute body;
end $$;

notify pgrst, 'reload schema';
