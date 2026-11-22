-- Preserve the effective function bodies and ACLs; fail on unexpected drift rather than re-install an older command.
do $patch$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.class_day_packs(uuid,date,text,timestamptz,integer[])'::regprocedure);
  needle := $old$    if coalesce(gaps[1], 0) >= t.d then
      gaps[1] := gaps[1] - t.d;
      select coalesce(array_agg(x order by x desc), '{}') into gaps from unnest(gaps) x where x > 0;
    end if;$old$;
  replacement := $new$    -- Existing unsplittable work must not disappear from the load when windows shrink.
    if coalesce(gaps[1], 0) < t.d then return false; end if;
    gaps[1] := gaps[1] - t.d;
    select coalesce(array_agg(x order by x desc), '{}') into gaps from unnest(gaps) x where x > 0;$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected class_day_packs definition'; end if;
  execute replace(definition, needle, replacement);
  comment on function public.class_day_packs(uuid,date,text,timestamptz,integer[]) is 'Conservative whole-sitting packing. Existing unplaceable open work blocks new generated allocations until reviewed; no accepted work is ignored.';

  definition := pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb)'::regprocedure);
  needle := $old$  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user or v_cycle.status <> 'active' then raise exception 'Unauthorized'; end if;
$old$;
  if position(needle in definition) = 0 then raise exception 'Unexpected class-log cycle guard'; end if;
  definition := replace(definition, needle, '');
  replacement := needle || E'\n  v_tz := coalesce';
  if position('  v_tz := coalesce' in definition) = 0 then raise exception 'Missing class-log timezone guard'; end if;
  definition := replace(definition, '  v_tz := coalesce', replacement);
  needle := $old$    if v_session.class_date <> p_class_date or v_session.kind <> p_kind$old$;
  replacement := $new$    if v_session.cycle_id is distinct from p_cycle_id
       or coalesce(v_session.note, '') <> coalesce(nullif(btrim(p_note), ''), '')
       or coalesce((select jsonb_agg(jsonb_build_array(x.outcome_id, x.extent, coalesce(x.portion_note, ''), x.studied_in_class) order by x.outcome_id)
                    from public.class_session_items x where x.session_id = v_session.id), '[]'::jsonb)
          is distinct from coalesce((select jsonb_agg(jsonb_build_array(i->>'outcome_id', i->>'extent', coalesce(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)) order by i->>'outcome_id')
                                     from jsonb_array_elements(v_items) i), '[]'::jsonb)
       or v_session.class_date <> p_class_date or v_session.kind <> p_kind$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected class-log replay guard'; end if;
  execute replace(definition, needle, replacement);

  -- A pre-upgrade open-cycle obligation is estimated in the reviewed draft, then stamped ONCE in the same acceptance transaction.
  definition := pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure);
  needle := $old$sum((r->>'duration_minutes')::int)::int as m
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'class_session_id', '') <> '' group by 1, 2 loop$old$;
  replacement := $new$sum((r->>'duration_minutes')::int)::int as m, max((r->>'item_planned')::int) as planned
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'class_session_id', '') <> '' group by 1, 2 loop$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected weekly class obligation reader'; end if;
  definition := replace(definition, needle, replacement);
  needle := $old$    if not found or v_planned is null or r2.m + public.class_item_allocated(r2.s::uuid, r2.o) > v_planned then$old$;
  replacement := $new$    if not found then raise exception 'STALE_PROPOSAL: the class item is no longer available'; end if;
    if v_planned is null then
      if r2.planned is null or r2.planned < 0 or r2.planned > 2400 then
        raise exception 'STALE_PROPOSAL: the legacy class estimate must be reviewed';
      end if;
      v_planned := r2.planned;
      update public.class_session_items set planned_minutes = v_planned where session_id = r2.s::uuid and outcome_id = r2.o;
    end if;
    if r2.m + public.class_item_allocated(r2.s::uuid, r2.o) > v_planned then$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected weekly class obligation guard'; end if;
  execute replace(definition, needle, replacement);
end
$patch$;
