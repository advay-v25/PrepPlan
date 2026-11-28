-- A confirmed Coach move of a day-only task into another day must fit the contiguous room that exists NOW, whole, beside everything already accepted.
-- Uses the same packer as acceptance (class_day_packs). A deliberate Calendar override (p_strict = false) keeps its own warning flow and is unchanged;
-- timed moves keep their exact-overlap checks. The refusal is reported as 'no_room' and nothing moves.
do $patch$
declare definition text; needle text;
begin
  definition := pg_get_functiondef('public.apply_task_move(uuid,text,integer,date,timestamp with time zone,integer,boolean,text)'::regprocedure);
  needle := E'  v_reopen := v_t.execution = ''deferred'';';
  if position(needle in definition) = 0 then raise exception 'Unexpected apply_task_move definition'; end if;
  execute replace(definition, needle,
    E'  if p_strict and p_starts is null and p_date is distinct from v_t.local_date\n'
    || E'     and not public.class_day_packs(p_user, p_date, v_tz, clock_timestamp(), array[p_minutes]) then\n'
    || E'    return jsonb_build_object(''ok'', false, ''code'', ''NO_ROOM'', ''date'', p_date);\n'
    || E'  end if;\n' || needle);

  definition := pg_get_functiondef('public.confirm_coach_move(uuid)'::regprocedure);
  needle := E'when ''BAD_SLOT'' then ''bad_slot''';
  if position(needle in definition) = 0 then raise exception 'Unexpected confirm_coach_move definition'; end if;
  execute replace(definition, needle, needle || E' when ''NO_ROOM'' then ''no_room''');
end
$patch$;
