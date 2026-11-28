-- Generated changes must fit whole at commit time; Calendar's explicit manual override remains separate.
do $patch$
declare definition text; needle text;
begin
  definition := pg_get_functiondef('public.apply_redistribution(uuid,text,jsonb,text)'::regprocedure);
  needle := '  if v_placed = 0 then';
  if strpos(definition, needle) = 0 then raise exception 'Unexpected redistribution definition'; end if;
  definition := replace(definition, 'v_end timestamptz;', 'v_end timestamptz; v_date date; v_zone text;');
  execute replace(definition, needle, $guard$
  select coalesce(timezone, 'UTC') into v_zone from public.profiles where id = p_user;
  for v_date in select distinct (value->>'date')::date from jsonb_array_elements(v_out) loop
    if not public.class_day_packs(p_user, v_date, coalesce(v_zone, 'UTC'), clock_timestamp(), '{}'::integer[]) then
      raise exception 'REDISTRIBUTION_NO_ROOM: the longer sittings do not fit';
    end if;
  end loop;
$guard$ || needle);

  definition := pg_get_functiondef('public.accept_onboarding_preview(uuid,integer)'::regprocedure);
  needle := '  if v_draft.roadmap_id is not null then';
  if strpos(definition, needle) = 0 then raise exception 'Unexpected onboarding accept definition'; end if;
  execute replace(definition, needle, $guard$
  if public.first_unfit_day(v_user_id, coalesce(v_draft.timezone, 'UTC'), clock_timestamp(),
    (select coalesce(jsonb_agg(t || jsonb_build_object('task_type', t->'metadata'->>'task_type')), '[]'::jsonb)
      from jsonb_array_elements(v_draft.draft_json->'tasks') t),
    'scheduled_date', 'duration_minutes', 'task_type', '__none__') is not null then
    raise exception 'STALE_PREVIEW: the proposed sittings no longer fit your study windows';
  end if;
$guard$ || needle);

  definition := pg_get_functiondef('public.accept_class_recovery(uuid,integer,jsonb)'::regprocedure);
  needle := '  v_receipt := jsonb_build_object(';
  if strpos(definition, needle) = 0 then raise exception 'Unexpected class recovery accept definition'; end if;
  execute replace(definition, needle, $guard$
  for m in select distinct jsonb_build_object('date', value->>'to_date') from jsonb_array_elements(d.draft_json->'moves') loop
    if not public.class_day_packs(v_user, (m->>'date')::date, coalesce(v_cycle.timezone, 'UTC'), clock_timestamp(), '{}'::integer[]) then
      raise exception 'STALE_PROPOSAL: the recovered sittings no longer fit';
    end if;
  end loop;
$guard$ || needle);
end
$patch$;
