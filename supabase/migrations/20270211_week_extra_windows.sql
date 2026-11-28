-- One-off study windows for a reviewed week. A student may add specific windows to the proposed week; work placed in them is saved as a TIMED task by
-- the same weekly acceptance, so windows and placement are accepted together and recurring availability is never changed. Weekly acceptance already
-- ignores timed rows in its flexible-room check, so this adds the check timed work in an added window needs: that exact time must be free of protected
-- commitments, booked mocks, elapsed time and other accepted timed work. Patched in place from the effective definitions; fails loudly on drift.

-- The same blocker rules as class_day_free_spans, applied to one named window instead of the weekly availability.
do $derive$
declare definition text; derived text;
begin
  definition := pg_get_functiondef('public.class_day_free_spans(uuid,date,text,timestamptz)'::regprocedure);
  derived := replace(definition, 'public.class_day_free_spans(p_user uuid, p_date date, p_zone text, p_now timestamp with time zone DEFAULT now())',
    'public.window_free_spans(p_user uuid, p_date date, p_zone text, p_now timestamp with time zone, p_window int4range)');
  derived := regexp_replace(derived, 'with ranges as \(.*?\), weekly as \(', 'with ranges as (select int4multirange(p_window) as available' || E'\n), weekly as (');
  if derived = definition or position('public.window_free_spans(' in derived) = 0 or position('availability_windows' in derived) > 0 then
    raise exception 'Unexpected class_day_free_spans definition';
  end if;
  execute derived;
end
$derive$;
revoke all on function public.window_free_spans(uuid, date, text, timestamptz, int4range) from public, anon, authenticated;
grant execute on function public.window_free_spans(uuid, date, text, timestamptz, int4range) to service_role;

-- True when any item meant for an added window no longer has that exact time.
create or replace function public.extra_window_conflict(p_user uuid, p_zone text, p_now timestamptz, p_items jsonb)
returns boolean language plpgsql stable set search_path = public, pg_temp as $$
declare r record; s int; taken int4multirange := '{}'::int4multirange; seen_date date;
begin
  for r in select (x->>'local_date')::date as d, (x->>'starts_at')::timestamptz as at, (x->>'duration_minutes')::int as m
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x order by 1, 2 loop
    if r.d is null or r.at is null or coalesce(r.m, 0) <= 0 or (r.at at time zone p_zone)::date <> r.d then return true; end if;
    s := (extract(hour from (r.at at time zone p_zone)) * 60 + extract(minute from (r.at at time zone p_zone)))::int;
    if s + r.m > 1440 or not public.window_free_spans(p_user, r.d, p_zone, p_now, int4range(s, s + r.m, '[)')) @> int4range(s, s + r.m, '[)') then return true; end if;
    if seen_date is distinct from r.d then taken := '{}'::int4multirange; seen_date := r.d; end if;
    if taken && int4multirange(int4range(s, s + r.m, '[)')) then return true; end if;
    taken := taken + int4multirange(int4range(s, s + r.m, '[)'));
    if exists (select 1 from public.plan_blocks b where b.user_id = p_user and b.local_date = r.d and b.cancelled_at is null
        and b.execution not in ('completed', 'skipped', 'deferred', 'cancelled') and b.placement = 'timed' and b.starts_at is not null
        and b.starts_at < r.at + make_interval(mins => r.m) and b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)) > r.at) then
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke all on function public.extra_window_conflict(uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.extra_window_conflict(uuid, text, timestamptz, jsonb) to service_role;

do $patch$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure);

  -- 1. The write check, before anything is saved.
  needle := E'  if public.first_unfit_day(v_user,';
  replacement := $new$  if public.extra_window_conflict(v_user, coalesce(v_cycle.timezone, 'UTC'), clock_timestamp(),
    coalesce((select jsonb_agg(r) from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where r->>'extra_window' = 'true'), '[]'::jsonb)
    || coalesce((select jsonb_agg(jsonb_build_object('local_date', a->'continuation'->'placement'->>'date', 'starts_at', a->'continuation'->'placement'->>'startsAt', 'duration_minutes', (a->'continuation'->>'minutes')::int))
        from jsonb_array_elements(v_actions) a where jsonb_typeof(a->'continuation') = 'object' and nullif(a->'continuation'->'placement'->>'startsAt', '') is not null), '[]'::jsonb)) then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;
  if public.first_unfit_day(v_user,$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (write check)'; end if;
  definition := replace(definition, needle, replacement);

  -- 2. A continuation in an added window is timed, so it is not a claim on flexible room.
  needle := $old$'placement', 'day_preferred')) from jsonb_array_elements(v_actions) a$old$;
  replacement := $new$'placement', case when nullif(a->'continuation'->'placement'->>'startsAt', '') is null then 'day_preferred' else 'timed' end)) from jsonb_array_elements(v_actions) a$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (continuation fit)'; end if;
  definition := replace(definition, needle, replacement);

  -- 3. The continuation keeps the exact time it was given.
  needle := $old$'local_date', v_place, 'starts_at', null,$old$;
  replacement := $new$'local_date', v_place, 'starts_at', nullif(v_action->'continuation'->'placement'->>'startsAt', ''),$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (start)'; end if;
  definition := replace(definition, needle, replacement);
  needle := $old$'placement', case when v_place is null then 'floating' else 'day_preferred' end,$old$;
  replacement := $new$'placement', case when v_place is null then 'floating' when nullif(v_action->'continuation'->'placement'->>'startsAt', '') is not null then 'timed' else 'day_preferred' end,$new$;
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (placement)'; end if;
  execute replace(definition, needle, replacement);
end
$patch$;
notify pgrst, 'reload schema';
