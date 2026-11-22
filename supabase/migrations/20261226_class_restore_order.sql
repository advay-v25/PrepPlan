-- Follow-up to 20261225 (kept intact): a restore with nothing to restore is NO_CHANGE ("already at its original time"), before the elapsed-slot rule.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.class_change_preview(uuid,uuid,text,jsonb,text)'::regprocedure);
  n := replace(d, E'    if p_action = ''occurrence_restore'' then\n      if (v_state->>''canRestore'')::boolean is not true then',
                  E'    if p_action = ''occurrence_restore'' then\n      if e.id is null then return jsonb_build_object(''ok'', false, ''code'', ''NO_CHANGE'', ''message'', ''This class is already at its original time.''); end if;\n      if (v_state->>''canRestore'')::boolean is not true then');
  if n = d then raise exception 'class_change_preview was not patched'; end if;
  execute n;
end $$;
