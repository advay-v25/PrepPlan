-- Resolve progress with the existing time/undo reducer, then validate that exact snapshot under the scheduling lock.
-- Old private callers retain the conservative duplicate guard. Public callers cannot supply generated task rows or this token.
do $patch$
declare definition text; needle text;
begin
  definition := pg_get_functiondef('public.accept_mock_recovery(uuid,text,uuid,integer,uuid,jsonb,jsonb)'::regprocedure);
  needle := '  v_limit := coalesce(v_limit, 90);';
  if position(needle in definition) = 0 then raise exception 'Unexpected recovery limit guard'; end if;
  definition := replace(definition, needle, needle || $new$
  if nullif(p_selection->>'state_token', '') is not null
     and p_selection->>'state_token' is distinct from public.current_week_source_hash(p_user, p_cycle_id) then
    return jsonb_build_object('ok', false, 'code', 'STALE', 'message', 'Your recovery work changed since you reviewed it. Review the updated plan; nothing was changed.');
  end if;$new$);
  needle := '    if exists (select 1 from jsonb_array_elements(v_tasks) t join public.plan_blocks p on p.user_id = p_user and p.source_report_id = p_report_id';
  if position(needle in definition) = 0 then raise exception 'Unexpected recovery duplicate guard'; end if;
  execute replace(definition, needle, '    if nullif(p_selection->>''state_token'', '''') is null and exists (select 1 from jsonb_array_elements(v_tasks) t join public.plan_blocks p on p.user_id = p_user and p.source_report_id = p_report_id');
end
$patch$;
