-- A carried study or revision task longer than a sitting is accepted as ORDERED SITTINGS. The first sitting is the one continuation of the original
-- (history and lineage stay as they are); the others are its siblings in the same split group, each declared to follow the one before. Their minutes
-- add up to what is still owed: whatever does not fit is saved as an unplaced sitting, never dropped. Work that needs one sitting is never split.
-- Patched in place from the effective definitions; fails loudly on drift.

-- Every sitting of every continuation (first and rest) as the shape the existing room checks read.
create or replace function public.continuation_parts(p_actions jsonb) returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(x.part order by x.n), '[]'::jsonb) from (
    select a.n * 100 + p.n as n, jsonb_build_object('taskId', a.v->>'taskId', 'continuation', p.v) as part
    from jsonb_array_elements(coalesce(p_actions, '[]'::jsonb)) with ordinality a(v, n)
    cross join lateral (
      select a.v->'continuation' as v, 0::bigint as n
      union all
      select jsonb_build_object('minutes', r.v->'minutes', 'placement', jsonb_build_object('date', r.v->>'date', 'startsAt', r.v->>'startsAt')), r.n
      from jsonb_array_elements(coalesce(a.v->'continuation'->'rest', '[]'::jsonb)) with ordinality r(v, n)
    ) p
    where jsonb_typeof(a.v->'continuation') = 'object'
  ) x
$$;
revoke all on function public.continuation_parts(jsonb) from public, anon, authenticated;
grant execute on function public.continuation_parts(jsonb) to service_role;

do $patch$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure);

  -- 1. Both room checks see every sitting.
  needle := E'from jsonb_array_elements(v_actions) a where jsonb_typeof(a->''continuation'') = ''object'' and nullif(a->''continuation''->''placement''->>''startsAt''';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (window sittings)'; end if;
  definition := replace(definition, needle, replace(needle, 'jsonb_array_elements(v_actions) a', 'jsonb_array_elements(public.continuation_parts(v_actions)) a'));
  needle := 'from jsonb_array_elements(v_actions) a left join public.plan_blocks b';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (room sittings)'; end if;
  definition := replace(definition, needle, 'from jsonb_array_elements(public.continuation_parts(v_actions)) a left join public.plan_blocks b');

  needle := E'  v_succ_id text;\n';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (declare)'; end if;
  definition := replace(definition, needle, needle || E'  v_rest jsonb;\n  v_group uuid;\n  v_part jsonb;\n  v_prev text;\n  v_part_id text;\n  v_part_date date;\n  v_sibling public.plan_blocks%rowtype;\n');

  -- 2. The split group exists before the first sitting is written.
  needle := E'    v_succ_id := ''task-'' || gen_random_uuid()::text;\n';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (successor)'; end if;
  definition := replace(definition, needle, needle || $new$    v_rest := coalesce(v_action->'continuation'->'rest', '[]'::jsonb);
    v_group := null;
    if jsonb_array_length(v_rest) > 0 then
      if coalesce(v_pred.task_type, '') not in ('study', 'review', 'class_consolidation') or jsonb_array_length(v_rest) > 12 then
        raise exception 'Only study and revision can be split into sittings.' using errcode = '22023';
      end if;
      v_group := v_pred.scope_group_id;
      if v_group is null then
        insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
          values (v_user, v_pred.id, 2, jsonb_build_object('outcome_id', v_pred.outcome_id, 'session_id', null, 'source', 'weekly_review')) returning id into v_group;
      end if;
    end if;
$new$);

  needle := E'      ''rationale'', ''Continuing from last week. Your earlier progress and time stay with that week.''\n    ));\n    insert into public.plan_blocks select (v_succ).*;\n';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition (insert)'; end if;
  replacement := $new$      'rationale', 'Continuing from last week. Your earlier progress and time stay with that week.'
    ) || case when v_group is null then '{}'::jsonb else jsonb_build_object('scope_group_id', v_group, 'title', coalesce(nullif(v_action->'continuation'->>'title', ''), v_pred.title), 'dependencies', '[]'::jsonb) end);
    insert into public.plan_blocks select (v_succ).*;
    v_prev := v_succ_id;
    for v_part in select * from jsonb_array_elements(v_rest) loop
      v_part_date := nullif(v_part->>'date', '')::date;
      if v_part_date is not null and (v_part_date < v_next_start or v_part_date > (v_next->>'ends_at_local')::date) then
        raise exception 'A placement must be inside the next week.' using errcode = '22023';
      end if;
      v_part_id := 'task-' || gen_random_uuid()::text;
      v_sibling := jsonb_populate_record(v_succ, jsonb_build_object(
        'id', v_part_id, 'continued_from_task_id', null, 'carry_intent', null, 'learning_activity_id', null, 'title', v_part->>'title',
        'local_date', v_part_date, 'day', coalesce(v_part_date, v_next_start)::text, 'starts_at', nullif(v_part->>'startsAt', ''),
        'placement', case when v_part_date is null then 'floating' when nullif(v_part->>'startsAt', '') is not null then 'timed' else 'day_preferred' end,
        'state', case when v_part_date is null then 'floating' else 'planned' end,
        'duration_minutes', (v_part->>'minutes')::integer, 'duration', v_part->>'minutes', 'dependencies', jsonb_build_array(v_prev)));
      insert into public.plan_blocks select (v_sibling).*;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_part_id, 'created', jsonb_build_object('sittingOf', v_succ_id, 'continuedFrom', v_pred.id, 'draftId', p_draft_id, 'placedOn', v_part_date), '{}'::jsonb);
      v_prev := v_part_id;
    end loop;
    if v_group is not null then
      update public.task_scope_groups g set expected_parts = greatest(2, (
          select count(*) from public.plan_blocks p where p.scope_group_id = g.id and not exists (select 1 from public.plan_blocks c where c.continued_from_task_id = p.id)))
        where g.id = v_group and g.user_id = v_user;
    end if;
$new$;
  execute replace(definition, needle, replacement);

  -- 3. A sibling sitting keeps the "this is an estimate" label its remainder was given.
  definition := pg_get_functiondef('public.guard_task_lineage()'::regprocedure);
  needle := E'  if new.continued_from_task_id is null then\n    new.carry_intent := null; new.estimate_provisional := false;\n';
  if position(needle in definition) = 0 then raise exception 'Unexpected guard_task_lineage definition'; end if;
  execute replace(definition, needle, E'  if new.continued_from_task_id is null then\n    new.carry_intent := null;\n    if new.scope_group_id is null then new.estimate_provisional := false; end if;\n');
end
$patch$;
notify pgrst, 'reload schema';
