-- A class log can be saved while the class is still going, continued later in the SAME session, corrected and then finished.
-- Identity (the occurrence), completion (completed_at, set only by an explicit finish) and coverage (class_session_items) stay separate facts.
-- Every update is an owned, versioned, receipted command; a lost reply replays; two tabs holding the same version cannot both write.
-- apply_class_log is rebuilt from the LIVE definition (patch in place): its task validation/insertion moves into class_apply_tasks so the
-- update command reuses exactly the same room, order, limit and ownership checks. Existing rows are completed as of their logged_at (they were whole entries).
alter table public.class_sessions add column if not exists version integer not null default 1;
alter table public.class_sessions add column if not exists completed_at timestamptz;
alter table public.class_sessions add column if not exists create_fp text;
update public.class_sessions set completed_at = logged_at where completed_at is null;

create table if not exists public.class_log_updates (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  session_id uuid not null references public.class_sessions(id) on delete cascade,
  from_version integer not null,
  to_version integer not null,
  request jsonb not null,
  before jsonb not null default '[]'::jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);
create index if not exists class_log_updates_session_idx on public.class_log_updates (session_id, to_version);
alter table public.class_log_updates enable row level security;
revoke all on public.class_log_updates from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant all on public.class_log_updates to service_role; end if; end $$;

create or replace function public.class_apply_tasks(
  p_user uuid, p_cycle_id uuid, p_class_date date, p_kind text, p_session_id uuid, p_items jsonb, p_tasks jsonb, p_today date, p_tz text
) returns integer language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare
  v_user uuid := p_user; v_cycle public.planning_cycles%rowtype; v_task_count integer := 0; v_limit integer; r record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
  v_items jsonb := coalesce(p_items, '[]'::jsonb); v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb); v_planned integer; v_have integer; v_sess uuid;
  v_today date := p_today; v_tz text := p_tz;
begin
  select * into v_cycle from public.planning_cycles where id = p_cycle_id and user_id = p_user;
  if jsonb_array_length(v_tasks) > 0 and (not found or v_cycle.status <> 'active') then raise exception 'Unauthorized'; end if;
  -- The student's sitting limit: locked for share so a concurrent change waits for this command (profiles has no scope-lock trigger).
  select least(90, coalesce(max_session_minutes, 90)) into v_limit from public.profiles where id = v_user for share;
  v_limit := coalesce(v_limit, 90);

  if jsonb_array_length(v_tasks) > 0 then
    if jsonb_array_length(v_tasks) > 200 then raise exception 'Too many tasks'; end if;
    -- shape: only the study/review work a class follow-up can be; the origin and priority are fixed here, never taken from the caller
    if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'id', '') = '' or coalesce(t->>'task_type', '') not in ('study', 'review')
                  or coalesce(t->>'local_date', '') = '' or coalesce(t->>'duration_minutes', '') !~ '^[0-9]+$' or nullif(t->>'repair_thread_id', '') is not null
                  or coalesce(t->>'outcome_id', '') = '' or coalesce(t->>'sitting_ordinal', '') !~ '^[0-9]+$') then
      raise exception 'Invalid task';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where nullif(t->>'session_id', '') is not null
                 and not exists (select 1 from public.class_sessions s where s.id = (t->>'session_id')::uuid and s.user_id = v_user and s.kind in ('covered', 'revision'))) then
      raise exception 'Unauthorized';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t
               where (t->>'local_date')::date <= p_class_date and nullif(t->>'session_id', '') is null) then
      raise exception 'A task falls outside the open days of this cycle';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t join public.class_sessions s on s.id = nullif(t->>'session_id', '')::uuid
               where (t->>'local_date')::date <= s.class_date) then
      raise exception 'A task falls outside the open days of this cycle';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'local_date')::date < v_cycle.starts_at_local or (t->>'local_date')::date >= v_cycle.ends_at_local) then
      raise exception 'A task falls outside the open days of this cycle';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'local_date')::date < v_today) then
      raise exception 'PREVIEW_CHANGED: a reviewed day has already passed';
    end if;
    if exists (select 1 from jsonb_array_elements(v_tasks) t where (t->>'duration_minutes')::int > v_limit or (t->>'duration_minutes')::int < 5) then
      raise exception 'PREVIEW_CHANGED: a sitting is longer than your sitting limit';
    end if;
    -- the outcome must be one of this entry's items (new session) or an existing item of the named session, and the reading must be its own
    for r in select coalesce(nullif(t->>'session_id', ''), '') as s, t->>'outcome_id' as o, min(t->>'lm_id') as lm, sum((t->>'duration_minutes')::int)::int as m,
                    max(nullif(t->>'item_planned', '')::int) as hint
               from jsonb_array_elements(v_tasks) t group by 1, 2 loop
      if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'session_id', '') = r.s and t->>'outcome_id' = r.o and t->>'lm_id' is distinct from r.lm) then
        raise exception 'Invalid task';
      end if;
      if r.lm <> '' and not exists (select 1 from public.reading_los l where l.id = r.o and l.reading_id::text = r.lm) then raise exception 'Invalid task'; end if;
      if r.s = '' then
        select nullif(i->>'planned_minutes', '')::int into v_planned from jsonb_array_elements(v_items) i
          where i->>'outcome_id' = r.o and coalesce((i->>'studied_in_class')::boolean, false) = false limit 1;
        if not found or p_kind not in ('covered', 'revision') then raise exception 'Unauthorized'; end if;
        v_have := 0;
      else
        v_sess := r.s::uuid;
        select planned_minutes into v_planned from public.class_session_items where session_id = v_sess and outcome_id = r.o and studied_in_class = false for update;
        if not found then raise exception 'Unauthorized'; end if;
        -- a row logged before planned_minutes existed is stamped ONCE from the reviewed obligation (bounded); a stamped row is never rewritten
        if v_planned is null then
          v_planned := least(2400, greatest(0, coalesce(r.hint, 0)));
          update public.class_session_items set planned_minutes = v_planned where session_id = v_sess and outcome_id = r.o;
        end if;
        v_have := public.class_item_allocated(v_sess, r.o);
      end if;
      if v_planned is null or r.m + v_have > v_planned then raise exception 'PREVIEW_CHANGED: more follow-up work was proposed than is still owed'; end if;
    end loop;
    -- declared order: a dependency is an earlier sitting of the SAME item (this batch or already saved), never anything else
    if exists (
      select 1 from jsonb_array_elements(v_tasks) t cross join lateral jsonb_array_elements_text(case when jsonb_typeof(t->'dependencies') = 'array' then t->'dependencies' else '[]'::jsonb end) d(id)
      where not exists (select 1 from jsonb_array_elements(v_tasks) u where u->>'id' = d.id and u->>'outcome_id' = t->>'outcome_id'
                          and coalesce(u->>'session_id', '') = coalesce(t->>'session_id', '') and (u->>'sitting_ordinal')::int < (t->>'sitting_ordinal')::int)
        and not exists (select 1 from public.plan_blocks p where p.id = d.id and p.user_id = v_user and p.outcome_id = t->>'outcome_id'
                          and p.class_session_id = nullif(t->>'session_id', '')::uuid)
    ) then raise exception 'Invalid task order'; end if;
    -- an existing group is the group of that same item's saved sittings, and nobody else's
    if exists (select 1 from jsonb_array_elements(v_tasks) t where coalesce(t->>'group_id', '') <> ''
                 and not exists (select 1 from public.task_scope_groups g join public.plan_blocks p on p.scope_group_id = g.id
                                  where g.id = (t->>'group_id')::uuid and g.user_id = v_user and p.user_id = v_user
                                    and p.class_session_id = nullif(t->>'session_id', '')::uuid and p.outcome_id = t->>'outcome_id')) then
      raise exception 'Unauthorized';
    end if;
    -- room: the sittings proposed for a day must fit the contiguous room that is left NOW, whole, alongside what is already accepted
    for r in select (t->>'local_date')::date as d, array_agg((t->>'duration_minutes')::int order by ord) as ms
               from jsonb_array_elements(v_tasks) with ordinality as x(t, ord) group by 1 loop
      if not public.class_day_packs(v_user, r.d, v_tz, clock_timestamp(), r.ms) then
        raise exception 'PREVIEW_CHANGED: not enough study time is left on %', r.d;
      end if;
    end loop;
  end if;

  if jsonb_array_length(v_tasks) > 0 then
    for r in select t->>'group_key' as k, min(t->>'id') as first_id, min(t->>'outcome_id') as o, min(t->>'session_id') as s
               from jsonb_array_elements(v_tasks) t where coalesce(t->>'group_key', '') <> '' group by 1 loop
      insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
        values (v_user, r.first_id, 2, jsonb_build_object('outcome_id', r.o, 'session_id', coalesce(nullif(r.s, ''), p_session_id::text), 'source', 'class_log')) returning id into v_gid;
      v_groups := v_groups || jsonb_build_object(r.k, v_gid);
    end loop;

    insert into public.plan_blocks (
      id, user_id, cycle_id, title, detail, task_type, origin, priority,
      placement, execution, local_date, day, duration_minutes, duration,
      lm_id, rationale, created_by, class_session_id, outcome_id,
      learning_objective, suggested_approach, completion_meaning, verification_intent, curriculum_reference, dependencies, scope_group_id, sitting_ordinal
    )
    select
      t->>'id', v_user, p_cycle_id, t->>'title', t->>'detail', t->>'task_type', 'planner', 'core',
      'day_preferred', 'not_started', (t->>'local_date')::date, (t->>'local_date')::date,
      (t->>'duration_minutes')::smallint, t->>'duration_minutes',
      nullif(t->>'lm_id', ''), t->>'rationale', 'algorithm',
      coalesce(nullif(t->>'session_id', '')::uuid, p_session_id), t->>'outcome_id',
      nullif(t->>'learning_objective', ''), nullif(t->>'suggested_approach', ''), nullif(t->>'completion_meaning', ''),
      nullif(t->>'verification_intent', ''), nullif(t->>'curriculum_reference', ''),
      case when jsonb_typeof(t->'dependencies') = 'array' then t->'dependencies' else '[]'::jsonb end,
      coalesce((v_groups->>(t->>'group_key'))::uuid, nullif(t->>'group_id', '')::uuid), (t->>'sitting_ordinal')::smallint
    from jsonb_array_elements(v_tasks) t;
    get diagnostics v_task_count = row_count;

    -- a group's size is its ACTUAL logical members (a continuation replaces the sitting it continues); never an estimate
    update public.task_scope_groups g set expected_parts = greatest(2, (
        select count(*) from public.plan_blocks p where p.scope_group_id = g.id
           and not exists (select 1 from public.plan_blocks c where c.continued_from_task_id = p.id)))
      where g.user_id = v_user and g.id in (select distinct scope_group_id from public.plan_blocks where scope_group_id is not null and id in (select t->>'id' from jsonb_array_elements(v_tasks) t));
  end if;


  return v_task_count;
end $$;
revoke all on function public.class_apply_tasks(uuid, uuid, date, text, uuid, jsonb, jsonb, date, text) from public, anon, authenticated;

drop function if exists public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb, text, uuid, date);
CREATE OR REPLACE FUNCTION public.apply_class_log(p_cycle_id uuid, p_idempotency_key text, p_class_date date, p_kind text, p_note text, p_items jsonb, p_tasks jsonb, p_occurrence_key text, p_commitment_id uuid, p_occurrence_date date, p_finalise boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid();
  v_cycle public.planning_cycles%rowtype;
  v_session public.class_sessions%rowtype;
  v_task_count integer := 0;
  v_tz text; v_today date; v_limit integer; r record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
  v_items jsonb := coalesce(p_items, '[]'::jsonb); v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb);
  v_planned integer; v_have integer; v_sess uuid; v_fp text;
  v_c public.calendar_commitments%rowtype; v_ex public.commitment_exceptions%rowtype; v_moved boolean; v_eff date; v_end time; v_pred text; v_n integer := 0;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('covered', 'revision', 'missed', 'cancelled', 'none') then raise exception 'Invalid kind'; end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then raise exception 'Missing idempotency key'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_tasks) <> 'array' then raise exception 'Invalid payload'; end if;

  perform public.scope_lock(v_user);

  -- Class identity: a series occurrence is (commitment, its ORIGINAL date); a one-off class is its commitment; anything else is a separate manual session.
  -- A date alone never names a class. NULL = a legacy date-level entry whose occurrence is unresolved (never guessed).
  if p_occurrence_key is not null then
    if p_occurrence_key !~ '^(series:[0-9a-f-]{36}:[0-9]{4}-[0-9]{2}-[0-9]{2}|once:[0-9a-f-]{36}|manual:[0-9a-f-]{36})$' then raise exception 'Invalid occurrence'; end if;
    if p_occurrence_key like 'manual:%' then
      if p_commitment_id is not null or p_occurrence_date is not null then raise exception 'Invalid occurrence'; end if;
    else
      if p_commitment_id is null or p_occurrence_key not like (case when p_occurrence_key like 'series:%' then 'series:' else 'once:' end || p_commitment_id::text || '%')
         or (p_occurrence_key like 'series:%' and p_occurrence_date is null) or (p_occurrence_key like 'once:%' and p_occurrence_date is not null)
         or (p_occurrence_key like 'series:%' and p_occurrence_key <> 'series:' || p_commitment_id::text || ':' || p_occurrence_date::text) then raise exception 'Invalid occurrence'; end if;
      if not exists (select 1 from public.calendar_commitments c where c.id = p_commitment_id and c.user_id = v_user and c.kind = 'class') then raise exception 'Unauthorized'; end if;
    end if;
  elsif p_commitment_id is not null or p_occurrence_date is not null then raise exception 'Invalid occurrence';
  end if;

  select * into v_session from public.class_sessions where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    -- A key names ONE event. The same key with a different date, kind or set of items is a client bug, not a retry.
    v_fp := md5(jsonb_build_array(p_cycle_id, p_class_date, p_kind, coalesce(nullif(btrim(p_note), ''), ''), p_occurrence_key,
      (select coalesce(jsonb_agg(jsonb_build_array(i->>'outcome_id', i->>'extent', coalesce(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)) order by i->>'outcome_id'), '[]'::jsonb)
         from jsonb_array_elements(v_items) i))::text);
    if v_session.create_fp is not null then
      -- the ORIGINAL request is what a key names: later updates to the session never turn a lost-reply retry into a different request
      if v_session.create_fp <> v_fp then raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used for a different class entry'; end if;
    else
    if v_session.cycle_id is distinct from p_cycle_id
       or coalesce(v_session.note, '') <> coalesce(nullif(btrim(p_note), ''), '')
       or coalesce((select jsonb_agg(jsonb_build_array(x.outcome_id, x.extent, coalesce(x.portion_note, ''), x.studied_in_class) order by x.outcome_id)
                    from public.class_session_items x where x.session_id = v_session.id), '[]'::jsonb)
          is distinct from coalesce((select jsonb_agg(jsonb_build_array(i->>'outcome_id', i->>'extent', coalesce(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)) order by i->>'outcome_id')
                                     from jsonb_array_elements(v_items) i), '[]'::jsonb)
       or v_session.class_date <> p_class_date or v_session.kind <> p_kind
       or v_session.occurrence_key is distinct from p_occurrence_key
       or (select count(*) from public.class_session_items where session_id = v_session.id) <> jsonb_array_length(v_items)
       or exists (select 1 from jsonb_array_elements(v_items) i where not exists (
            select 1 from public.class_session_items x where x.session_id = v_session.id and x.outcome_id = i->>'outcome_id' and x.extent = i->>'extent')) then
      raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used for a different class entry';
    end if;
    end if;
    return json_build_object('session_id', v_session.id, 'already_applied', true,
      'tasks', (select count(*) from public.plan_blocks where class_session_id = v_session.id));
  end if;

  if p_occurrence_key is null then raise exception 'OCCURRENCE_INVALID: say which class this log is for'; end if;
  if p_occurrence_key is not null and exists (select 1 from public.class_sessions s where s.user_id = v_user and s.occurrence_key = p_occurrence_key) then
    raise exception 'OCCURRENCE_ALREADY_LOGGED: this class has already been logged';
  end if;

  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user or v_cycle.status <> 'active' then raise exception 'Unauthorized'; end if;

  v_tz := coalesce(nullif(v_cycle.timezone, ''), public.booking_tz(v_user));
  v_today := (clock_timestamp() at time zone v_tz)::date;

  -- The occurrence is verified against the timetable under this transaction: membership, original date, moved effective date, cancelled/archived state,
  -- the supplied class date, and that the class has ended. A date alone never proves a class happened.
  if p_occurrence_key like 'series:%' then
    select * into v_c from public.calendar_commitments where id = p_commitment_id and user_id = v_user;
    if not found or v_c.kind <> 'class' or v_c.status <> 'active' or v_c.recurrence is distinct from 'weekly' then raise exception 'OCCURRENCE_INVALID: that class is no longer on your timetable'; end if;
    if not (extract(dow from p_occurrence_date)::smallint = any (v_c.weekdays)) or (v_c.starts_on is not null and p_occurrence_date < v_c.starts_on)
       or (v_c.ends_on is not null and p_occurrence_date > v_c.ends_on) then raise exception 'OCCURRENCE_INVALID: that class does not meet on that date'; end if;
    select * into v_ex from public.commitment_exceptions where commitment_id = v_c.id and occurrence_date = p_occurrence_date;
    v_moved := found and v_ex.kind = 'moved';
    if found and v_ex.kind = 'skipped' then raise exception 'OCCURRENCE_INVALID: that class was cancelled'; end if;
    v_eff := case when v_moved then coalesce(v_ex.new_date, p_occurrence_date) else p_occurrence_date end;
    v_end := case when v_moved then coalesce(v_ex.new_end_time, coalesce(v_ex.new_start_time, v_c.start_time) + greatest(interval '15 minutes', v_c.end_time - v_c.start_time)) else v_c.end_time end;
    if p_class_date <> v_eff then raise exception 'OCCURRENCE_MOVED: that class is on % now', v_eff; end if;
    if v_eff > v_today or (v_eff = v_today and v_end > (clock_timestamp() at time zone v_tz)::time) then raise exception 'OCCURRENCE_NOT_ENDED: that class has not finished yet'; end if;
    -- A "from this date" change made this series the successor of another; a class already logged under a predecessor is the same class.
    v_pred := v_c.id::text;
    while v_n < 20 loop
      v_n := v_n + 1;
      select receipt->>'commitmentId' into v_pred from public.checkpoint_commands where user_id = v_user and command = 'class_change' and receipt->>'successorId' = v_pred limit 1;
      exit when v_pred is null;
      if exists (select 1 from public.class_sessions s where s.user_id = v_user and s.occurrence_key = 'series:' || v_pred || ':' || p_occurrence_date::text) then
        raise exception 'OCCURRENCE_ALREADY_LOGGED: this class has already been logged';
      end if;
    end loop;
  elsif p_occurrence_key like 'once:%' then
    select * into v_c from public.calendar_commitments where id = p_commitment_id and user_id = v_user;
    if not found or v_c.kind <> 'class' or v_c.status <> 'active' or v_c.recurrence = 'weekly' then raise exception 'OCCURRENCE_INVALID: that class is no longer on your timetable'; end if;
    if (v_c.starts_at at time zone v_tz)::date <> p_class_date then raise exception 'OCCURRENCE_MOVED: that class is on % now', (v_c.starts_at at time zone v_tz)::date; end if;
    if v_c.ends_at is null or v_c.ends_at > clock_timestamp() then raise exception 'OCCURRENCE_NOT_ENDED: that class has not finished yet'; end if;
  elsif p_class_date > v_today then raise exception 'OCCURRENCE_NOT_ENDED: a session that has not happened cannot be logged';
  end if;
  insert into public.class_sessions (user_id, cycle_id, class_date, kind, note, idempotency_key, occurrence_key, commitment_id, occurrence_date, completed_at, create_fp)
  values (v_user, p_cycle_id, p_class_date, p_kind, nullif(btrim(p_note), ''), p_idempotency_key, p_occurrence_key, p_commitment_id, p_occurrence_date,
          case when p_finalise or p_kind not in ('covered', 'revision') then now() end,
          md5(jsonb_build_array(p_cycle_id, p_class_date, p_kind, coalesce(nullif(btrim(p_note), ''), ''), p_occurrence_key,
            (select coalesce(jsonb_agg(jsonb_build_array(i->>'outcome_id', i->>'extent', coalesce(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false)) order by i->>'outcome_id'), '[]'::jsonb) from jsonb_array_elements(v_items) i))::text)) returning * into v_session;

  insert into public.class_session_items (session_id, outcome_id, extent, portion_note, studied_in_class, planned_minutes)
  select v_session.id, i->>'outcome_id', i->>'extent', nullif(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false),
         case when coalesce((i->>'studied_in_class')::boolean, false) then null else least(2400, greatest(0, nullif(i->>'planned_minutes', '')::int)) end
  from jsonb_array_elements(v_items) as i;

  v_task_count := public.class_apply_tasks(v_user, p_cycle_id, p_class_date, p_kind, v_session.id, v_items, v_tasks, v_today, v_tz);
  return json_build_object('session_id', v_session.id, 'already_applied', false, 'tasks', v_task_count);
end;
$function$;

create or replace function public.apply_class_log(p_cycle_id uuid, p_idempotency_key text, p_class_date date, p_kind text, p_note text, p_items jsonb, p_tasks jsonb)
 returns json language sql security definer set search_path = 'public', 'pg_temp' as $$
  select public.apply_class_log(p_cycle_id, p_idempotency_key, p_class_date, p_kind, p_note, p_items, p_tasks, null::text, null::uuid, null::date, false)
$$;

revoke all on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb, text, uuid, date, boolean) from public, anon;
revoke all on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb, text, uuid, date, boolean) to authenticated, service_role;
grant execute on function public.apply_class_log(uuid, text, date, text, text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.apply_class_log_update(
  p_cycle_id uuid, p_session_id uuid, p_idempotency_key text, p_expected_version integer, p_finalise boolean, p_items jsonb, p_tasks jsonb
) returns json language plpgsql security definer set search_path = 'public', 'pg_temp' as $$
declare
  v_user uuid := auth.uid(); v_s public.class_sessions%rowtype; v_rec public.class_log_updates%rowtype; v_req jsonb; v_cycle public.planning_cycles%rowtype;
  v_items jsonb := coalesce(p_items, '[]'::jsonb); v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb); i jsonb; v_old public.class_session_items%rowtype;
  v_before jsonb := '[]'::jsonb; v_added int := 0; v_changed int := 0; v_task_n int := 0; v_done boolean := false; v_tz text; v_today date; v_result jsonb; v_new_version int;
  v_studied boolean; v_planned int; v_note text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then raise exception 'Missing idempotency key'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_tasks) <> 'array' or jsonb_array_length(v_items) > 100 then raise exception 'Invalid payload'; end if;
  if p_expected_version is null or p_expected_version < 1 then raise exception 'Invalid payload'; end if;
  perform public.scope_lock(v_user);

  v_req := jsonb_build_object('session', p_session_id, 'expected', p_expected_version, 'finalise', coalesce(p_finalise, false),
    'items', (select coalesce(jsonb_agg(jsonb_build_array(x->>'outcome_id', x->>'extent', coalesce(x->>'portion_note', ''), coalesce((x->>'studied_in_class')::boolean, false)) order by x->>'outcome_id'), '[]'::jsonb)
                from jsonb_array_elements(v_items) x));
  select * into v_rec from public.class_log_updates where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    if v_rec.request <> v_req then raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used for a different class update'; end if;
    return (v_rec.result || jsonb_build_object('already_applied', true))::json;
  end if;

  select * into v_s from public.class_sessions where id = p_session_id and user_id = v_user for update;
  if not found then raise exception 'Unauthorized'; end if;
  if v_s.version <> p_expected_version then raise exception 'VERSION_MISMATCH: this class log changed since you opened it (now version %)', v_s.version; end if;
  if jsonb_array_length(v_items) > 0 and v_s.kind not in ('covered', 'revision') then raise exception 'Invalid payload: that entry has no coverage'; end if;
  if jsonb_array_length(v_tasks) > 0 and (p_cycle_id is null or not exists (select 1 from public.planning_cycles c where c.id = p_cycle_id and c.user_id = v_user and c.status = 'active')) then raise exception 'Unauthorized'; end if;

  for i in select * from jsonb_array_elements(v_items) loop
    if coalesce(i->>'extent', '') not in ('part', 'full', 'continued') or coalesce(i->>'outcome_id', '') = '' then raise exception 'Invalid payload'; end if;
    v_studied := coalesce((i->>'studied_in_class')::boolean, false); v_note := nullif(i->>'portion_note', '');
    v_planned := case when v_studied then null else least(2400, greatest(0, nullif(i->>'planned_minutes', '')::int)) end;
    select * into v_old from public.class_session_items where session_id = p_session_id and outcome_id = i->>'outcome_id' for update;
    if not found then
      insert into public.class_session_items (session_id, outcome_id, extent, portion_note, studied_in_class, planned_minutes)
        values (p_session_id, i->>'outcome_id', i->>'extent', v_note, v_studied, v_planned);
      v_before := v_before || jsonb_build_array(jsonb_build_object('outcome_id', i->>'outcome_id', 'was', null));
      v_added := v_added + 1;
    elsif v_old.extent <> i->>'extent' or coalesce(v_old.portion_note, '') <> coalesce(v_note, '') or v_old.studied_in_class <> v_studied then
      -- a correction: the report it replaces is kept in this update's history; accepted or started work is never cancelled by it
      v_before := v_before || jsonb_build_array(jsonb_build_object('outcome_id', v_old.outcome_id, 'was', jsonb_build_object('extent', v_old.extent, 'portion_note', v_old.portion_note, 'studied_in_class', v_old.studied_in_class, 'planned_minutes', v_old.planned_minutes)));
      update public.class_session_items set extent = i->>'extent', portion_note = v_note, studied_in_class = v_studied,
        planned_minutes = case when v_studied then null else coalesce(v_planned, v_old.planned_minutes) end
        where id = v_old.id;
      v_changed := v_changed + 1;
    end if;
  end loop;

  if jsonb_array_length(v_tasks) > 0 then
    select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
    v_tz := coalesce(nullif(v_cycle.timezone, ''), public.booking_tz(v_user));
    v_today := (clock_timestamp() at time zone v_tz)::date;
    v_task_n := public.class_apply_tasks(v_user, p_cycle_id, v_s.class_date, v_s.kind, v_s.id, v_items, v_tasks, v_today, v_tz);
  end if;

  v_done := coalesce(p_finalise, false) and v_s.completed_at is null;
  v_new_version := v_s.version;
  if v_added + v_changed + v_task_n > 0 or v_done then
    v_new_version := v_s.version + 1;
    update public.class_sessions set version = v_new_version, completed_at = case when v_done then now() else completed_at end where id = v_s.id;
  end if;
  v_result := jsonb_build_object('session_id', v_s.id, 'already_applied', false, 'version', v_new_version, 'added', v_added, 'corrected', v_changed, 'tasks', v_task_n,
                                 'completed', coalesce(p_finalise, false) or v_s.completed_at is not null, 'changed', v_new_version <> v_s.version);
  insert into public.class_log_updates (user_id, idempotency_key, session_id, from_version, to_version, request, before, result)
    values (v_user, p_idempotency_key, v_s.id, v_s.version, v_new_version, v_req, v_before, v_result);
  return v_result::json;
end $$;
revoke all on function public.apply_class_log_update(uuid, uuid, text, integer, boolean, jsonb, jsonb) from public, anon;
grant execute on function public.apply_class_log_update(uuid, uuid, text, integer, boolean, jsonb, jsonb) to authenticated, service_role;
