-- Phase 2: a Coach move that apply_task_move refuses because it would invert a declared sitting order is reported as such
-- (reason 'sitting_order' plus the sibling's title) instead of the generic 'task_not_movable'. Nothing else changes: the refusal still
-- writes nothing to the schedule and the proposal is still marked stale. Effective definition and ACLs preserved.
do $patch$
declare definition text; needle text;
begin
  definition := pg_get_functiondef('public.confirm_coach_move(uuid)'::regprocedure);
  needle := $old$when 'BAD_SLOT' then 'bad_slot' else 'task_not_movable' end;$old$;
  if position(needle in definition) = 0 then raise exception 'Unexpected confirm_coach_move reason map'; end if;
  definition := replace(definition, needle, $new$when 'BAD_SLOT' then 'bad_slot' when 'ORDER' then 'sitting_order' else 'task_not_movable' end;$new$);
  needle := $old$return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', v_stale);$old$;
  if position(needle in definition) = 0 then raise exception 'Unexpected confirm_coach_move stale return'; end if;
  definition := replace(definition, needle, $new$return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', v_stale, 'orderTitle', v_res->>'title');$new$);
  execute definition;
end
$patch$;
