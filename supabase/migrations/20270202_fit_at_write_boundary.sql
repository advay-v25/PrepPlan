-- Fit is checked at the write boundary against real contiguous room, not a day total.
-- One helper (public.first_unfit_day) wraps the existing whole-sitting packer class_day_packs, which already subtracts classes, commitments,
-- booked mocks, elapsed time and accepted timed work, and packs accepted flexible work first. The two accepting commands call it under the
-- planning lock they already hold. Bodies are patched in place from their effective definitions and fail loudly on drift.

create or replace function public.first_unfit_day(p_user uuid, p_zone text, p_now timestamptz, p_rows jsonb, p_date_key text, p_minutes_key text, p_type_key text, p_placement_key text)
returns date language plpgsql stable set search_path = public, pg_temp as $$
declare r record;
begin
  -- Papers, mocks and admin items carry their own required slot and are not flexible study sittings.
  for r in
    select (x->>p_date_key)::date as d, array_agg((x->>p_minutes_key)::int order by ord) as ms
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as e(x, ord)
    where coalesce(x->>p_type_key, x#>>'{metadata,task_type}', 'study') not in ('diagnostic', 'mock', 'admin')
      and coalesce(x->>p_placement_key, x#>>'{metadata,placement}', 'day_preferred') <> 'timed'
      and (x->>p_date_key) is not null and coalesce((x->>p_minutes_key)::int, 0) > 0
    group by 1 order by 1
  loop
    if not public.class_day_packs(p_user, r.d, p_zone, p_now, r.ms) then return r.d; end if;
  end loop;
  return null;
end $$;
revoke all on function public.first_unfit_day(uuid, text, timestamptz, jsonb, text, text, text, text) from public, anon, authenticated;
grant execute on function public.first_unfit_day(uuid, text, timestamptz, jsonb, text, text, text, text) to service_role;

do $patch$
declare definition text; needle text; replacement text;
begin
  -- Current-week proposals: the saved preview is also what acceptance validates, so the packing rule lives in the shared validator.
  definition := pg_get_functiondef('public.current_week_proposal_problem(uuid,uuid,timestamptz)'::regprocedure);
  needle := E'  return null;\nexception when data_exception';
  replacement := E'  if public.first_unfit_day(p_user, coalesce(c.timezone, ''UTC''), p_now, d.draft_json->''tasks'', ''scheduled_date'', ''duration_minutes'', ''__none__'', ''__none__'') is not null then return ''STALE_PROPOSAL''; end if;\n  return null;\nexception when data_exception';
  if position(needle in definition) = 0 then raise exception 'Unexpected current_week_proposal_problem definition'; end if;
  execute replace(definition, needle, replacement);

  -- Weekly review: the reviewed next-week rows must fit the room that exists NOW, whole, beside everything already accepted.
  definition := pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure);
  needle := E'    raise exception ''The next week must start after this one ends.'' using errcode = ''22023'';\n  end if;\n';
  replacement := needle || E'  if public.first_unfit_day(v_user, coalesce(v_cycle.timezone, ''UTC''), clock_timestamp(), v_next->''rows'', ''local_date'', ''duration_minutes'', ''task_type'', ''placement'') is not null then\n    return jsonb_build_object(''ok'', false, ''code'', ''STALE_PROPOSAL'');\n  end if;\n';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition'; end if;
  execute replace(definition, needle, replacement);
end
$patch$;
