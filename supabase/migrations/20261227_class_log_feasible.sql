-- Phase 1: class-log follow-up work must be FEASIBLE and MEANINGFUL, atomically.
-- Replaces apply_class_log from its effective definition (same signature, grants and ownership kept) with:
--   * the per-student scope lock first (the established order), then the cycle row lock;
--   * authoritative refusal (PREVIEW_CHANGED, nothing written) when a reviewed task is dated in the past, is longer than the student's
--     sitting limit (generated work only), or the day it lands on no longer has that much usable time left (the clock passed the last
--     window, a booking or class was added, windows were edited) -- judged by current_week_available_minutes, the same rule Calendar uses;
--   * the task-semantic fields (reading, objective, approach, completion, verification, reference) and a declared order between sittings
--     (`dependencies` = the sitting that must come first);
--   * one shared scope group per piece of work that has more than one sitting (created, or extended when later previews add the rest).
create or replace function public.apply_class_log(p_cycle_id uuid, p_idempotency_key text, p_class_date date, p_kind text, p_note text, p_items jsonb, p_tasks jsonb)
 returns json language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_user uuid := auth.uid();
  v_cycle public.planning_cycles%rowtype;
  v_session public.class_sessions%rowtype;
  v_task_count integer := 0;
  v_tz text; v_today date; v_limit integer; r record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('covered', 'revision', 'missed', 'cancelled', 'none') then raise exception 'Invalid kind'; end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then raise exception 'Missing idempotency key'; end if;

  perform public.scope_lock(v_user);
  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user or v_cycle.status <> 'active' then raise exception 'Unauthorized'; end if;

  select * into v_session from public.class_sessions where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    return json_build_object('session_id', v_session.id, 'already_applied', true,
      'tasks', (select count(*) from public.plan_blocks where class_session_id = v_session.id));
  end if;

  v_tz := coalesce(nullif(v_cycle.timezone, ''), public.booking_tz(v_user));
  v_today := (clock_timestamp() at time zone v_tz)::date;
  select least(90, coalesce(max_session_minutes, 90)) into v_limit from public.profiles where id = v_user;
  v_limit := coalesce(v_limit, 90);

  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p_tasks) t
      where nullif(t->>'session_id', '') is not null
        and not exists (select 1 from public.class_sessions s where s.id = (t->>'session_id')::uuid and s.user_id = v_user)
    ) then raise exception 'Unauthorized'; end if;
    if exists (
      select 1 from jsonb_array_elements(p_tasks) t
      where (t->>'local_date')::date <= p_class_date
         or (t->>'local_date')::date < v_cycle.starts_at_local
         or (t->>'local_date')::date >= v_cycle.ends_at_local
    ) then raise exception 'A task falls outside the open days of this cycle'; end if;
    if exists (select 1 from jsonb_array_elements(p_tasks) t where (t->>'local_date')::date < v_today) then
      raise exception 'PREVIEW_CHANGED: a reviewed day has already passed';
    end if;
    if exists (select 1 from jsonb_array_elements(p_tasks) t where (t->>'duration_minutes')::int > v_limit or (t->>'duration_minutes')::int < 5) then
      raise exception 'PREVIEW_CHANGED: a sitting is longer than your sitting limit';
    end if;
    for r in select (t->>'local_date')::date as d, sum((t->>'duration_minutes')::int)::int as m from jsonb_array_elements(p_tasks) t group by 1 loop
      if r.m > public.current_week_available_minutes(v_user, r.d, v_tz, clock_timestamp()) then
        raise exception 'PREVIEW_CHANGED: not enough study time is left on %', r.d;
      end if;
    end loop;
  end if;

  insert into public.class_sessions (user_id, cycle_id, class_date, kind, note, idempotency_key)
  values (v_user, p_cycle_id, p_class_date, p_kind, nullif(btrim(p_note), ''), p_idempotency_key) returning * into v_session;

  insert into public.class_session_items (session_id, outcome_id, extent, portion_note, studied_in_class)
  select v_session.id, i->>'outcome_id', i->>'extent', nullif(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i;

  if jsonb_typeof(coalesce(p_tasks, '[]'::jsonb)) = 'array' and jsonb_array_length(p_tasks) > 0 then
    -- one scope group per piece of work with several sittings; an existing group is extended, never replaced
    for r in select t->>'group_key' as k, min(t->>'id') as first_id, max((t->>'group_parts')::int) as parts, min(t->>'outcome_id') as o, min(t->>'session_id') as s
               from jsonb_array_elements(p_tasks) t where coalesce(t->>'group_key', '') <> '' group by 1 loop
      insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
        values (v_user, r.first_id, greatest(2, r.parts), jsonb_build_object('outcome_id', r.o, 'session_id', r.s, 'source', 'class_log')) returning id into v_gid;
      v_groups := v_groups || jsonb_build_object(r.k, v_gid);
    end loop;
    for r in select (t->>'group_id')::uuid as gid, max((t->>'group_parts')::int) as parts from jsonb_array_elements(p_tasks) t where coalesce(t->>'group_id', '') <> '' group by 1 loop
      update public.task_scope_groups set expected_parts = greatest(expected_parts, r.parts) where id = r.gid and user_id = v_user;
      if not found then raise exception 'Unauthorized'; end if;
    end loop;

    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, duration_minutes, duration,
      lm_id, repair_thread_id, rationale, created_by, class_session_id, outcome_id,
      learning_objective, suggested_approach, completion_meaning, verification_intent, curriculum_reference, dependencies, scope_group_id
    )
    select
      t->>'id', v_user, p_cycle_id, t->>'title', t->>'detail', t->>'task_type', t->>'origin', 'core',
      'day_preferred', 'not_started', (t->>'local_date')::date, (t->>'local_date')::date,
      (t->>'duration_minutes')::smallint, t->>'duration_minutes',
      nullif(t->>'lm_id', ''), nullif(t->>'repair_thread_id', '')::uuid, t->>'rationale', 'algorithm',
      coalesce(nullif(t->>'session_id', '')::uuid, v_session.id), nullif(t->>'outcome_id', ''),
      nullif(t->>'learning_objective', ''), nullif(t->>'suggested_approach', ''), nullif(t->>'completion_meaning', ''),
      nullif(t->>'verification_intent', ''), nullif(t->>'curriculum_reference', ''),
      case when jsonb_typeof(t->'dependencies') = 'array' then t->'dependencies' else '[]'::jsonb end,
      coalesce((v_groups->>(t->>'group_key'))::uuid, nullif(t->>'group_id', '')::uuid)
    from jsonb_array_elements(p_tasks) t;
    get diagnostics v_task_count = row_count;
  end if;

  return json_build_object('session_id', v_session.id, 'already_applied', false, 'tasks', v_task_count);
end;
$function$;
