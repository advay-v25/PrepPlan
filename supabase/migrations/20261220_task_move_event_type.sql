-- task_events_event_type_check has never allowed 'placed', so Calendar's "move a deferred task back into play" has been writing no history event
-- (recordEvent logs and swallows the constraint error). The shared move boundary records that case as an ordinary 'moved' event carrying
-- payload.reopened = true, which the constraint allows and which undo restores from `previous` (execution 'deferred').
-- Patched in place from the live definition, not re-typed.
do $$
declare d text;
begin
  select pg_get_functiondef('public.apply_task_move(uuid, text, int, date, timestamptz, int, boolean, text)'::regprocedure) into d;
  if position('when v_reopen then ''placed'' ' in d) = 0 then raise exception 'apply_task_move no longer has the expected placed branch'; end if;
  d := replace(d, 'when v_reopen then ''placed'' ', 'when v_reopen then ''moved'' ');
  execute d;
end $$;
