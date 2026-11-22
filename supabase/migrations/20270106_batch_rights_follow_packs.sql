-- A batch may be created as rights "cleared" only when every cell that carries a grounding packet names a pack with cleared rights, a recorded authority and a permitted use.
-- Patches the effective create_item_batch (which already holds the blocked-cell patch) in place.
do $patch$
declare v_def text; v_needle text := E'  perform pg_advisory_xact_lock(hashtext(''batch:'' || p_request_key));';
begin
  v_def := pg_get_functiondef('public.create_item_batch(text,text,jsonb,jsonb)'::regprocedure);
  if position('RIGHTS_NOT_SUPPORTED' in v_def) > 0 then return; end if;
  if position(v_needle in v_def) = 0 then raise exception 'create_item_batch rights anchor not found; refusing to patch blindly'; end if;
  execute replace(v_def, v_needle, E'  if v_rights = ''cleared'' and (\n    not exists (select 1 from jsonb_array_elements(p_cells) c where c->''packet'' is not null)\n    or exists (select 1 from jsonb_array_elements(p_cells) c where c->''packet'' is not null and (\n      coalesce(c->''packet''->''pack''->''rights''->>''state'', '''') <> ''cleared''\n      or coalesce(btrim(c->''packet''->''pack''->''rights''->>''authority''), '''') = ''''\n      or coalesce(c->''packet''->''pack''->''rights''->>''permittedUse'', ''none'') = ''none''))\n  ) then return jsonb_build_object(''ok'', false, ''code'', ''RIGHTS_NOT_SUPPORTED''); end if;\n' || v_needle);
end $patch$;
notify pgrst, 'reload schema';
