-- The class-recovery write check (20270207) asked whether EVERYTHING on each destination day still packs into whole gaps after the moves. A day whose accepted
-- flexible work already overflowed before the move therefore refused every recovery, for a reason the move did not cause. The preview (classRecoveryPlan) now
-- only requires that a move not make the day's fit worse; this gives the write boundary the same meaning: days already unfit before the moves are recorded
-- first and are not refused afterwards, but only for days whose moves are all timed (a moved flexible sitting must itself fit). Days that fit before and no longer fit after are still refused. Patched in place; fails loudly on drift.
do $patch$
declare definition text; piece text;
begin
  definition := pg_get_functiondef('public.accept_class_recovery(uuid,integer,jsonb)'::regprocedure);

  piece := 'm jsonb; u jsonb;';
  if position(piece in definition) = 0 then raise exception 'Unexpected class recovery accept declarations'; end if;
  definition := replace(definition, piece, 'v_unfit date[] := ''{}''; ' || piece);

  piece := E'  perform set_config(''roadmap.order_deferred'', ''on'', true);\n';
  if position(piece in definition) = 0 then raise exception 'Unexpected class recovery accept body (deferral switch)'; end if;
  -- Only days whose moves are ALL timed get the exception: a moved flexible sitting must itself fit a whole gap, so those days are always checked strictly.
  definition := replace(definition, piece, E'  for m in select distinct jsonb_build_object(''date'', value->>''to_date'') from jsonb_array_elements(d.draft_json->''moves'') where nullif(value->>''to_starts'', '''') is not null and (value->>''to_date'') not in (select x->>''to_date'' from jsonb_array_elements(d.draft_json->''moves'') x where nullif(x->>''to_starts'', '''') is null) loop\n'
    || E'    if not public.class_day_packs(v_user, (m->>''date'')::date, coalesce(v_cycle.timezone, ''UTC''), clock_timestamp(), ''{}''::integer[]) then v_unfit := v_unfit || (m->>''date'')::date; end if;\n'
    || E'  end loop;\n' || piece);

  piece := E'    if not public.class_day_packs(v_user, (m->>''date'')::date, coalesce(v_cycle.timezone, ''UTC''), clock_timestamp(), ''{}''::integer[]) then\n      raise exception ''STALE_PROPOSAL: the recovered sittings no longer fit'';';
  if position(piece in definition) = 0 then raise exception 'Unexpected class recovery accept body (fit guard)'; end if;
  definition := replace(definition, piece, E'    if not ((m->>''date'')::date = any(v_unfit)) and not public.class_day_packs(v_user, (m->>''date'')::date, coalesce(v_cycle.timezone, ''UTC''), clock_timestamp(), ''{}''::integer[]) then\n      raise exception ''STALE_PROPOSAL: the recovered sittings no longer fit'';');
  execute definition;
end
$patch$;
notify pgrst, 'reload schema';
