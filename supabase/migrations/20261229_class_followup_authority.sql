-- Phase 1 completion: the reviewed class follow-up allocation is authoritative, several ordered sittings of one item may share a day,
-- work that never received a task stays a durable obligation, and a declared sitting order cannot be inverted by a move.
--
-- Every writer that can change room (plan_blocks, calendar_commitments, commitment_exceptions, availability_windows, mock_appointments,
-- planning_cycles) already takes public.scope_lock through the scope_write_lock trigger, so apply_class_log, which takes the same lock FIRST,
-- sees committed state and every later competing write waits for it. profiles (the sitting limit) has no such trigger: the row is locked FOR SHARE.

alter table public.class_session_items add column if not exists planned_minutes integer;
alter table public.class_session_items drop constraint if exists class_session_items_planned_chk;
alter table public.class_session_items add constraint class_session_items_planned_chk check (planned_minutes is null or planned_minutes between 0 and 2400);
comment on column public.class_session_items.planned_minutes is 'The follow-up effort planned when the class was logged (null = logged before this column existed). Never rewritten by a pace change.';

alter table public.plan_blocks add column if not exists sitting_ordinal smallint;
alter table public.plan_blocks drop constraint if exists plan_blocks_sitting_ordinal_chk;
alter table public.plan_blocks add constraint plan_blocks_sitting_ordinal_chk check (sitting_ordinal is null or sitting_ordinal >= 1);
-- The old day-based uniqueness made one item take one sitting per day. A limit is per sitting; identity is the logical sitting.
drop index if exists public.plan_blocks_class_outcome_day_idx;
create unique index if not exists plan_blocks_class_sitting_idx on public.plan_blocks (class_session_id, outcome_id, sitting_ordinal)
  where class_session_id is not null and outcome_id is not null and sitting_ordinal is not null;

-- Minutes already allocated (a task exists) to one class item. Cancelled sittings are not allocated; skipped/deferred ones still are.
create or replace function public.class_item_allocated(p_session uuid, p_outcome text) returns integer
 language sql stable set search_path to 'public', 'pg_temp' as $$
  select coalesce(sum(duration_minutes), 0)::int from public.plan_blocks
  where class_session_id = p_session and outcome_id = p_outcome and cancelled_at is null and execution <> 'cancelled'
$$;
revoke all on function public.class_item_allocated(uuid, text) from public, anon, authenticated;

-- The contiguous free spans of one local day: windows less protected time, bookings and the elapsed part of today.

CREATE OR REPLACE FUNCTION public.class_day_free_spans(p_user uuid, p_date date, p_zone text, p_now timestamp with time zone DEFAULT now())
 RETURNS int4multirange
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
with ranges as (
  select coalesce(range_agg(int4range((extract(hour from start_time)*60+extract(minute from start_time))::int,
    (extract(hour from end_time)*60+extract(minute from end_time))::int,'[)')),'{}'::int4multirange) as available
  from public.availability_windows where user_id=p_user and status='active' and weekday=extract(dow from p_date)::int
), weekly as (
  select c.*, d.original_date, e.kind as exception_kind,e.new_date,e.new_start_time,e.new_end_time
  from public.calendar_commitments c
  cross join lateral (select p_date as original_date union select x.occurrence_date from public.commitment_exceptions x
    where x.commitment_id=c.id and x.user_id=p_user and x.kind='moved' and x.new_date=p_date) d
  left join public.commitment_exceptions e on e.commitment_id=c.id and e.occurrence_date=d.original_date and e.user_id=p_user
  where c.user_id=p_user and c.status='active' and c.is_protected and c.recurrence='weekly'
    and extract(dow from d.original_date)::int=any(c.weekdays)
    and (c.starts_on is null or d.original_date>=c.starts_on) and (c.ends_on is null or d.original_date<=c.ends_on)
    and c.start_time is not null and c.end_time is not null and coalesce(e.kind,'')<>'skipped'
), occurrences as (
  select coalesce(new_date,original_date) as day,
    (extract(hour from coalesce(new_start_time,start_time))*60+extract(minute from coalesce(new_start_time,start_time)))::int as start_min,
    case when exception_kind='moved' and new_end_time is not null
      then (extract(hour from new_end_time)*60+extract(minute from new_end_time))::int
      else (extract(hour from coalesce(new_start_time,start_time))*60+extract(minute from coalesce(new_start_time,start_time)))::int
        +greatest(15,(extract(epoch from (end_time-start_time))/60)::int) end as end_min
  from weekly
), blockers as (
  select int4range(greatest(0,start_min),least(1440,end_min),'[)') as span from occurrences where day=p_date and end_min>start_min
  union all
  select int4range(
    case when c.starts_at <= p_date::timestamp at time zone p_zone then 0
      else floor(extract(epoch from (c.starts_at at time zone p_zone)::time)/60)::int end,
    case when c.ends_at >= (p_date+1)::timestamp at time zone p_zone then 1440
      else ceil(extract(epoch from (c.ends_at at time zone p_zone)::time)/60)::int end,'[)')
  from public.calendar_commitments c where c.user_id=p_user and c.status='active' and c.is_protected and c.recurrence='none'
    and c.starts_at < (p_date+1)::timestamp at time zone p_zone and c.ends_at > p_date::timestamp at time zone p_zone
  union all
  select int4range((extract(hour from start_time)*60+extract(minute from start_time))::int,
    least(1440,(extract(hour from start_time)*60+extract(minute from start_time))::int+duration_minutes),'[)')
  from public.mock_appointments where user_id=p_user and planned_date=p_date and status='planned' and start_time is not null and duration_minutes>0
), free as (
  select available-coalesce((select range_agg(span) from blockers),'{}'::int4multirange) as spans from ranges
), remaining as (
  select spans * int4multirange(int4range(
    case when p_date>(p_now at time zone p_zone)::date then 0
      when p_date<(p_now at time zone p_zone)::date then 1440
      else least(1440,ceil(extract(epoch from (p_now at time zone p_zone)::time)/60)::int) end,1440,'[)')) as spans from free
)
select coalesce((select spans from remaining), '{}'::int4multirange);
$function$
;


-- The declared-order conflict a placement of one task would create, or null. A predecessor/successor that is finished, skipped, set aside or
-- cancelled no longer constrains. Two day-only siblings on one day keep their declared sequence (no clock time is invented); a definite
-- inversion is an earlier DAY, or two timed sittings whose clock times overlap or cross.
create or replace function public.sitting_order_conflict(p_user uuid, p_task text, p_date date, p_starts timestamptz, p_minutes integer)
 returns text language sql stable set search_path to 'public', 'pg_temp' as $$
  with me as (select dependencies from public.plan_blocks where id = p_task and user_id = p_user),
  open_ as (select b.* from public.plan_blocks b where b.user_id = p_user and b.id <> p_task and b.cancelled_at is null and b.local_date is not null
              and b.execution in ('not_started', 'in_progress', 'partial'))
  select coalesce(
    (select 'it must stay after “' || b.title || '”' from open_ b
      where b.id in (select jsonb_array_elements_text(case when jsonb_typeof(m.dependencies) = 'array' then m.dependencies else '[]'::jsonb end) from me m)
        and (p_date < b.local_date
          or (p_date = b.local_date and p_starts is not null and b.placement = 'timed' and b.starts_at is not null
              and p_starts < b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 0))))
      limit 1),
    (select 'it must stay before “' || b.title || '”' from open_ b
      where jsonb_typeof(b.dependencies) = 'array' and b.dependencies ? p_task
        and (p_date > b.local_date
          or (p_date = b.local_date and p_starts is not null and b.placement = 'timed' and b.starts_at is not null
              and b.starts_at < p_starts + make_interval(mins => p_minutes)))
      limit 1))
$$;
revoke all on function public.sitting_order_conflict(uuid, text, date, timestamptz, integer) from public, anon, authenticated;

-- Do these sitting lengths (in this order) fit the usable room of one local day, as whole contiguous sittings?
-- Room = free spans less every accepted open timed task (its exact interval); accepted open day-only tasks are packed whole, largest first, each into
-- the largest span that holds it (one that fits nowhere consumes nothing: overload that already exists is not this proposal's doing). The proposed
-- sittings then go largest-span-first in the given order (the planner's own order); a best-fit-decreasing pass is the fallback. Never cuts a sitting.
create or replace function public.class_day_packs(p_user uuid, p_date date, p_zone text, p_now timestamptz, p_new integer[])
 returns boolean language plpgsql stable set search_path to 'public', 'pg_temp' as $$
declare spans int4multirange; t record; s int; e int; gaps int[]; g2 int[]; m int; i int; ok boolean := true;
begin
  spans := public.class_day_free_spans(p_user, p_date, p_zone, p_now);
  for t in select starts_at, coalesce(duration_minutes, 30) d from public.plan_blocks b
    where b.user_id = p_user and b.local_date = p_date and b.cancelled_at is null and b.execution not in ('completed', 'skipped', 'deferred', 'cancelled')
      and b.placement = 'timed' and b.starts_at is not null loop
    s := (extract(hour from (t.starts_at at time zone p_zone)) * 60 + extract(minute from (t.starts_at at time zone p_zone)))::int; e := least(1440, s + t.d);
    if e > s then spans := spans - int4multirange(int4range(s, e, '[)')); end if;
  end loop;
  select coalesce(array_agg(upper(r) - lower(r) order by upper(r) - lower(r) desc), '{}') into gaps from unnest(spans) r;
  for t in select coalesce(duration_minutes, 30) d from public.plan_blocks b
    where b.user_id = p_user and b.local_date = p_date and b.cancelled_at is null and b.execution not in ('completed', 'skipped', 'deferred', 'cancelled')
      and (b.placement <> 'timed' or b.starts_at is null) order by coalesce(duration_minutes, 30) desc, b.id loop
    if coalesce(gaps[1], 0) >= t.d then
      gaps[1] := gaps[1] - t.d;
      select coalesce(array_agg(x order by x desc), '{}') into gaps from unnest(gaps) x where x > 0;
    end if;
  end loop;
  g2 := gaps;
  foreach m in array coalesce(p_new, '{}') loop
    if coalesce(g2[1], 0) < m then ok := false; exit; end if;
    g2[1] := g2[1] - m;
    select coalesce(array_agg(x order by x desc), '{}') into g2 from unnest(g2) x where x > 0;
  end loop;
  if ok then return true; end if;
  g2 := gaps; ok := true;
  for m in select x from unnest(coalesce(p_new, '{}')) x order by x desc loop
    select min(x) into i from unnest(g2) x where x >= m;
    if i is null then ok := false; exit; end if;
    select coalesce(array_agg(v order by v desc), '{}') into g2 from (
      select case when n = 1 then x - m else x end v from (select x, row_number() over (order by case when x = i then 0 else 1 end, x) n from unnest(g2) x) q) w where v > 0;
  end loop;
  return ok;
end $$;
revoke all on function public.class_day_packs(uuid, date, text, timestamptz, integer[]) from public, anon, authenticated;


-- apply_class_log: same signature, grants and ownership; the reviewed allocation is validated against the CURRENT state under the scope lock.
create or replace function public.apply_class_log(p_cycle_id uuid, p_idempotency_key text, p_class_date date, p_kind text, p_note text, p_items jsonb, p_tasks jsonb)
 returns json language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  v_user uuid := auth.uid();
  v_cycle public.planning_cycles%rowtype;
  v_session public.class_sessions%rowtype;
  v_task_count integer := 0;
  v_tz text; v_today date; v_limit integer; r record; v_gid uuid; v_groups jsonb := '{}'::jsonb;
  v_items jsonb := coalesce(p_items, '[]'::jsonb); v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb);
  v_planned integer; v_have integer; v_sess uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_kind not in ('covered', 'revision', 'missed', 'cancelled', 'none') then raise exception 'Invalid kind'; end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then raise exception 'Missing idempotency key'; end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_tasks) <> 'array' then raise exception 'Invalid payload'; end if;

  perform public.scope_lock(v_user);
  select * into v_cycle from public.planning_cycles where id = p_cycle_id for update;
  if not found or v_cycle.user_id <> v_user or v_cycle.status <> 'active' then raise exception 'Unauthorized'; end if;

  select * into v_session from public.class_sessions where user_id = v_user and idempotency_key = p_idempotency_key;
  if found then
    -- A key names ONE event. The same key with a different date, kind or set of items is a client bug, not a retry.
    if v_session.class_date <> p_class_date or v_session.kind <> p_kind
       or (select count(*) from public.class_session_items where session_id = v_session.id) <> jsonb_array_length(v_items)
       or exists (select 1 from jsonb_array_elements(v_items) i where not exists (
            select 1 from public.class_session_items x where x.session_id = v_session.id and x.outcome_id = i->>'outcome_id' and x.extent = i->>'extent')) then
      raise exception 'IDEMPOTENCY_KEY_REUSED: this key was used for a different class entry';
    end if;
    return json_build_object('session_id', v_session.id, 'already_applied', true,
      'tasks', (select count(*) from public.plan_blocks where class_session_id = v_session.id));
  end if;

  v_tz := coalesce(nullif(v_cycle.timezone, ''), public.booking_tz(v_user));
  v_today := (clock_timestamp() at time zone v_tz)::date;
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

  insert into public.class_sessions (user_id, cycle_id, class_date, kind, note, idempotency_key)
  values (v_user, p_cycle_id, p_class_date, p_kind, nullif(btrim(p_note), ''), p_idempotency_key) returning * into v_session;

  insert into public.class_session_items (session_id, outcome_id, extent, portion_note, studied_in_class, planned_minutes)
  select v_session.id, i->>'outcome_id', i->>'extent', nullif(i->>'portion_note', ''), coalesce((i->>'studied_in_class')::boolean, false),
         case when coalesce((i->>'studied_in_class')::boolean, false) then null else least(2400, greatest(0, nullif(i->>'planned_minutes', '')::int)) end
  from jsonb_array_elements(v_items) as i;

  if jsonb_array_length(v_tasks) > 0 then
    for r in select t->>'group_key' as k, min(t->>'id') as first_id, min(t->>'outcome_id') as o, min(t->>'session_id') as s
               from jsonb_array_elements(v_tasks) t where coalesce(t->>'group_key', '') <> '' group by 1 loop
      insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
        values (v_user, r.first_id, 2, jsonb_build_object('outcome_id', r.o, 'session_id', coalesce(nullif(r.s, ''), v_session.id::text), 'source', 'class_log')) returning id into v_gid;
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
      coalesce(nullif(t->>'session_id', '')::uuid, v_session.id), t->>'outcome_id',
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

  return json_build_object('session_id', v_session.id, 'already_applied', false, 'tasks', v_task_count);
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_task_move(p_user uuid, p_task text, p_revision integer, p_date date, p_starts timestamp with time zone, p_minutes integer, p_strict boolean, p_source text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.plan_blocks%rowtype; v_new public.plan_blocks%rowtype; v_tz text; v_today date; v_cs date; v_ce date;
  v_range tstzrange; v_title text; v_reopen boolean; v_placement text; v_ev uuid; v_type text; v_moved boolean; v_detail text;
begin
  perform public.scope_lock(p_user);
  select * into v_t from public.plan_blocks where id = p_task and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_t.revision <> p_revision then return jsonb_build_object('ok', false, 'code', 'REVISION', 'revision', v_t.revision); end if;
  if v_t.cancelled_at is not null or v_t.execution = 'cancelled' then return jsonb_build_object('ok', false, 'code', 'CANCELLED'); end if;
  if v_t.learning_activity_id is not null then return jsonb_build_object('ok', false, 'code', 'RECORDED'); end if;
  if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_t.id and s.user_id = p_user) then return jsonb_build_object('ok', false, 'code', 'CONTINUED'); end if;
  if p_minutes is null or p_minutes < 5 or p_minutes > 480 then return jsonb_build_object('ok', false, 'code', 'BAD_DURATION'); end if;

  v_tz := public.booking_tz(p_user);
  v_today := (now() at time zone v_tz)::date;
  if p_date is distinct from v_t.local_date and v_t.cycle_id is not null then
    select starts_at_local::date, ends_at_local::date into v_cs, v_ce from public.planning_cycles where id = v_t.cycle_id and user_id = p_user;
    if v_cs is not null and (p_date < v_cs or p_date > v_ce) then return jsonb_build_object('ok', false, 'code', 'OUTSIDE_CYCLE', 'start', v_cs, 'end', v_ce); end if;
  end if;
  if v_t.execution <> 'completed' and p_date < v_today and p_date is distinct from v_t.local_date then return jsonb_build_object('ok', false, 'code', 'PAST'); end if;
  if p_starts is not null and (p_starts at time zone v_tz)::date <> p_date then return jsonb_build_object('ok', false, 'code', 'BAD_SLOT'); end if;
  -- A declared sitting order is never inverted by a move or a longer sitting (accept_class_recovery checks the whole final arrangement instead).
  if current_setting('roadmap.order_deferred', true) is distinct from 'on' then
    v_title := public.sitting_order_conflict(p_user, v_t.id, p_date, p_starts, p_minutes);
    if v_title is not null then return jsonb_build_object('ok', false, 'code', 'ORDER', 'title', v_title); end if;
  end if;

  if p_starts is not null then
    v_range := tstzrange(p_starts, p_starts + make_interval(mins => p_minutes), '[)');
    select p.title into v_title from public.protected_occurrences(p_user, v_range) p limit 1;
    if v_title is null then
      select o.title into v_title from public.plan_blocks o
       where o.user_id = p_user and o.id <> v_t.id and o.is_protected_commitment and o.cancelled_at is null and o.placement = 'timed' and o.starts_at is not null
         and tstzrange(o.starts_at, o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)), '[)') && v_range limit 1;
    end if;
    if v_title is not null then return jsonb_build_object('ok', false, 'code', 'PROTECTED', 'title', v_title); end if;
    if p_strict then
      select o.title into v_title from public.plan_blocks o
       where o.user_id = p_user and o.id <> v_t.id and o.cancelled_at is null and o.placement = 'timed' and o.starts_at is not null
         and o.execution not in ('skipped', 'deferred', 'cancelled')
         and tstzrange(o.starts_at, o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)), '[)') && v_range limit 1;
      if v_title is not null then return jsonb_build_object('ok', false, 'code', 'SLOT_TAKEN', 'title', v_title); end if;
    end if;
  end if;

  v_reopen := v_t.execution = 'deferred';
  v_placement := case when p_starts is null then 'day_preferred' else 'timed' end;
  begin
    update public.plan_blocks set local_date = p_date, day = p_date::text, starts_at = p_starts, placement = v_placement,
      duration_minutes = p_minutes, duration = p_minutes::text, execution = case when v_reopen then 'not_started' else execution end
     where id = v_t.id and user_id = p_user returning * into v_new;
  exception when sqlstate 'BK409' then
    get stacked diagnostics v_detail = pg_exception_detail;
    return jsonb_build_object('ok', false, 'code', 'MOCK', 'title', coalesce(v_detail, 'Your mock'));
  end;

  v_moved := v_t.local_date is distinct from p_date or v_t.starts_at is distinct from p_starts;
  v_type := case when v_reopen then 'moved' when v_t.duration_minutes is distinct from p_minutes and not v_moved then 'duration_changed' else 'moved' end;
  insert into public.task_events (user_id, task_id, event_type, payload, previous, notes)
    values (p_user, v_t.id, v_type,
      jsonb_build_object('local_date', p_date, 'starts_at', p_starts, 'duration_minutes', p_minutes, 'placement', v_placement) || case when v_reopen then '{"reopened":true}'::jsonb else '{}'::jsonb end,
      jsonb_build_object('local_date', v_t.local_date, 'starts_at', v_t.starts_at, 'duration_minutes', v_t.duration_minutes, 'placement', v_t.placement, 'execution', v_t.execution, 'revision', v_t.revision),
      case when p_source = 'coach' then 'Moved on your confirmation from the Coach' end)
    returning id into v_ev;
  return jsonb_build_object('ok', true, 'eventId', v_ev, 'reopened', v_reopen, 'placement', v_placement, 'task', to_jsonb(v_new));
end $function$
;

CREATE OR REPLACE FUNCTION public.split_study_task(p_user_id uuid, p_task_id text, p_expected_revision integer, p_first_minutes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_task public.plan_blocks%rowtype;
  v_second public.plan_blocks%rowtype;
  v_receipt public.task_split_commands%rowtype;
  v_group uuid;
  v_first integer;
  v_original jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_user_id
    or not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id = auth.uid() and onboarding_status = 'complete') then
    raise exception 'Verify your account and finish setup before editing your plan.' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'A valid task revision is required.' using errcode = '22023';
  end if;
  select * into v_task from public.plan_blocks where id = p_task_id and user_id = p_user_id for update;
  if not found then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  select * into v_receipt from public.task_split_commands where task_id = p_task_id and expected_revision = p_expected_revision and user_id = p_user_id;
  if found then
    if v_receipt.requested_minutes is not distinct from p_first_minutes and v_receipt.second_task_id is not null then
      return jsonb_build_object('ok',true,'task',to_jsonb(v_task),'secondId',v_receipt.second_task_id,'replayed',true);
    end if;
    return jsonb_build_object('ok',false,'code','REVISION_MISMATCH','current',to_jsonb(v_task));
  end if;
  if v_task.revision <> p_expected_revision then
    return jsonb_build_object('ok',false,'code','REVISION_MISMATCH','current',to_jsonb(v_task));
  end if;
  if v_task.task_type is null or v_task.task_type not in ('study','review','class_consolidation')
    or v_task.execution not in ('not_started','in_progress','partial') or v_task.cancelled_at is not null
    or v_task.is_protected_commitment or v_task.duration_minutes is null or v_task.duration_minutes < 30 then
    raise exception 'Split unfinished study or review work of at least 30 minutes. Tests and protected commitments stay intact.' using errcode = '22023';
  end if;
  v_first := coalesce(p_first_minutes, floor(v_task.duration_minutes / 10.0)::integer * 5);
  if v_first < 15 or v_first > v_task.duration_minutes - 15 or v_first % 5 <> 0 then
    raise exception 'Each sitting needs at least 15 minutes; use a whole 5-minute split point.' using errcode = '22023';
  end if;
  v_original := to_jsonb(v_task);
  v_group := v_task.scope_group_id;
  if v_group is null then
    insert into public.task_scope_groups(user_id,original_task_id,expected_parts,original_scope)
      values (p_user_id,p_task_id,2,v_original) returning id into v_group;
  else
    -- The group row serializes concurrent splits of different sittings.
    update public.task_scope_groups set expected_parts = expected_parts + 1 where id = v_group and user_id = p_user_id;
    if not found then raise exception 'The shared learning scope could not be checked.' using errcode = '22023'; end if;
  end if;
  -- Copy the complete row (LOS, reading, purpose, provenance and method), then
  -- override only the new sitting's identity, execution, placement and length.
  v_second := jsonb_populate_record(null::public.plan_blocks, v_original || jsonb_build_object(
    'id','task-' || gen_random_uuid()::text,'title',v_task.title || ' (continued)',
    'scope_group_id',v_group,'duration_minutes',v_task.duration_minutes - v_first,
    'duration',(v_task.duration_minutes - v_first)::text,'execution','not_started',
    'starts_at',null,'local_date',null,'placement','floating','state','floating',
    'revision',1,'sitting_ordinal',null,'updated_at',now(),'created_by','student'
  ));
  update public.plan_blocks set duration_minutes = v_first, duration = v_first::text,
    scope_group_id = v_group, revision = revision + 1
    where id = p_task_id and user_id = p_user_id returning * into v_task;
  insert into public.plan_blocks select (v_second).*;
  insert into public.task_events(user_id,task_id,event_type,payload,previous) values
    (p_user_id,p_task_id,'split',jsonb_build_object('splitInto',v_second.id,'firstDuration',v_first,'secondDuration',v_second.duration_minutes,'scope_group_id',v_group),v_original),
    (p_user_id,v_second.id,'created',jsonb_build_object('splitFrom',p_task_id,'scope_group_id',v_group),'{}'::jsonb);
  insert into public.task_split_commands(task_id,expected_revision,user_id,requested_minutes,second_task_id)
    values (p_task_id,p_expected_revision,p_user_id,p_first_minutes,v_second.id);
  return jsonb_build_object('ok',true,'task',to_jsonb(v_task),'secondId',v_second.id,'replayed',false);
end; $function$
;

CREATE OR REPLACE FUNCTION public.accept_class_recovery(p_draft_id uuid, p_expected_revision integer, p_choices jsonb DEFAULT '{}'::jsonb)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user uuid := auth.uid(); d public.plan_drafts%rowtype; v_cycle public.planning_cycles%rowtype; v_version integer; v_problem text;
  m jsonb; u jsonb; r jsonb; v_choice text; v_moved int := 0; v_deferred int := 0; v_kept int := 0; v_done jsonb := '[]'::jsonb; v_receipt jsonb;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete')
    or not public.is_beta_admitted(v_user) then raise exception 'Application access required' using errcode = '42501'; end if;
  if p_choices is null or jsonb_typeof(p_choices) <> 'object' or exists (select 1 from jsonb_each_text(p_choices) x where x.value not in ('keep', 'defer')) then
    raise exception 'INVALID_PROPOSAL: choices must be keep or defer'; end if;
  perform public.scope_lock(v_user);
  select * into d from public.plan_drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if d.user_id <> v_user or d.purpose <> 'class_change_recovery' then raise exception 'Unauthorized'; end if;
  if d.status = 'accepted' then return ((d.draft_json->'receipt') || '{"replayed":true}'::jsonb)::json; end if;
  if d.status <> 'ready' then raise exception 'STALE_PROPOSAL: this proposal is no longer open'; end if;
  if d.revision <> p_expected_revision then raise exception 'STALE_PROPOSAL: stale revision'; end if;
  select onboarding_context_version into v_version from public.profiles where id = v_user for update;
  select * into v_cycle from public.planning_cycles where id = d.cycle_id and user_id = v_user for update;
  if not found or v_cycle.status <> 'active' then raise exception 'CYCLE_CHANGED: the cycle this proposal was for is no longer the active one'; end if;
  v_problem := public.class_recovery_problem(v_user, p_draft_id, clock_timestamp());
  if v_problem is not null then raise exception '%', v_problem; end if;

  -- the moves are judged together by the final-arrangement order check below, not one by one in a transient state
  perform set_config('roadmap.order_deferred', 'on', true);
  for m in select value from jsonb_array_elements(d.draft_json->'moves') loop
    r := public.apply_task_move(v_user, m->>'task_id', (m->>'expected_revision')::int, (m->>'to_date')::date, nullif(m->>'to_starts', '')::timestamptz, (m->>'minutes')::int, true, 'class_recovery');
    if (r->>'ok')::boolean is not true then raise exception 'STALE_PROPOSAL: % could not be placed (%)', m->>'title', r->>'code'; end if;
    v_moved := v_moved + 1;
    v_done := v_done || jsonb_build_array(jsonb_build_object('task_id', m->>'task_id', 'title', m->>'title', 'outcome', 'moved', 'from', m->'from', 'to', m->'to'));
  end loop;
  for u in select value from jsonb_array_elements(d.draft_json->'unplaced') loop
    v_choice := coalesce(p_choices->>(u->>'task_id'), 'keep');
    if v_choice = 'defer' then
      r := public.set_task_execution(v_user, u->>'task_id', (u->>'expected_revision')::int, 'deferred', null, 'Set aside for your weekly review after a class change');
      if (r->>'ok')::boolean is not true then raise exception 'STALE_PROPOSAL: % could not be set aside', u->>'title'; end if;
      v_deferred := v_deferred + 1;
    else v_kept := v_kept + 1; end if;
    v_done := v_done || jsonb_build_array(jsonb_build_object('task_id', u->>'task_id', 'title', u->>'title', 'outcome', case when v_choice = 'defer' then 'set_aside' else 'kept' end, 'from', u->'from'));
  end loop;

  if exists (
    select 1 from public.plan_blocks b
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.dependencies) = 'array' then b.dependencies else '[]'::jsonb end) x(pid)
      join public.plan_blocks p on p.id = x.pid and p.user_id = v_user
     where b.user_id = v_user and b.cycle_id = v_cycle.id and b.cancelled_at is null and p.cancelled_at is null
       and b.execution in ('not_started', 'in_progress', 'partial') and p.execution in ('not_started', 'in_progress', 'partial')
       and (b.id in (select m2->>'task_id' from jsonb_array_elements(d.draft_json->'moves') m2) or p.id in (select m2->>'task_id' from jsonb_array_elements(d.draft_json->'moves') m2))
       and (b.local_date < p.local_date
         or (b.local_date = p.local_date and b.starts_at is not null and p.starts_at is not null
             and b.starts_at < p.starts_at + make_interval(mins => coalesce(p.duration_minutes, 0))))
  ) then raise exception 'STALE_PROPOSAL: a move would put a sitting before the one it follows'; end if;
  perform set_config('roadmap.order_deferred', 'off', true);
  v_receipt := jsonb_build_object('draft_id', p_draft_id, 'cycle_id', v_cycle.id, 'change_key', d.draft_json->>'change_key', 'moved', v_moved, 'set_aside', v_deferred, 'kept', v_kept, 'tasks', v_done);
  update public.plan_drafts set status = 'accepted', accepted_cycle_id = v_cycle.id, revision = revision + 1, updated_at = now(),
    draft_json = jsonb_set(draft_json, '{receipt}', v_receipt) where id = p_draft_id;
  return (v_receipt || '{"replayed":false}'::jsonb)::json;
end $function$
;

CREATE OR REPLACE FUNCTION public.accept_weekly_transition(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_cycle_id uuid;
  v_cycle public.planning_cycles%rowtype;
  v_draft public.weekly_transition_drafts%rowtype;
  v_review public.weekly_reviews%rowtype;
  v_actions jsonb;
  v_next jsonb;
  v_action jsonb;
  v_task public.plan_blocks%rowtype;
  v_pred public.plan_blocks%rowtype;
  v_succ public.plan_blocks%rowtype;
  v_new_exec text;
  v_next_cycle uuid;
  v_next_start date;
  v_unknown text[] := '{}';
  v_continued jsonb := '[]'::jsonb;
  v_place date;
  v_minutes integer;
  v_paper_attempt text;
  v_succ_id text;
  r2 record; v_gid uuid; v_groups jsonb := '{}'::jsonb; v_planned integer;
begin
  -- current-week serialization
  perform public.scope_lock(auth.uid());
  if v_user is null then raise exception 'Sign in to close your week.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verify your email before using your plan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete') then
    raise exception 'Complete setup before closing your week.' using errcode = '42501';
  end if;

  -- Lock order: cycle, then draft, then tasks (by id).
  select cycle_id into v_cycle_id from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user;
  if v_cycle_id is null then raise exception 'That review could not be found.' using errcode = 'P0002'; end if;
  select * into v_cycle from public.planning_cycles where id = v_cycle_id and user_id = v_user for update;
  if not found then raise exception 'That week could not be found.' using errcode = 'P0002'; end if;
  select * into v_draft from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user for update;

  select * into v_review from public.weekly_reviews where cycle_id = v_cycle_id;
  if found then
    if v_review.draft_id = p_draft_id then
      return jsonb_build_object('ok', true, 'alreadyClosed', true, 'closedCycleId', v_cycle_id, 'nextCycleId', v_review.next_cycle_id,
        'continued', coalesce(jsonb_array_length(v_review.continuations), 0));
    end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  if v_draft.status <> 'ready' or v_draft.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'DRAFT_UNAVAILABLE');
  end if;
  if v_cycle.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  -- Lock first, THEN compare: once the closing week's tasks are locked nothing can change them between the
  -- check and the writes. Availability and commitments are locked against edits too (an insert of a new row
  -- is not blocked; the next review sees it). Order is fixed: cycle, draft, tasks, then these.
  perform 1 from public.plan_blocks where cycle_id = v_cycle_id and user_id = v_user order by id for update;
  perform 1 from public.availability_windows where user_id = v_user and status = 'active' order by id for share;
  perform 1 from public.calendar_commitments where user_id = v_user and status = 'active' order by id for share;
  if public.weekly_source_version(v_user, v_cycle_id) is distinct from v_draft.source_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;

  -- The paper gate is re-checked here, not trusted from the preview.
  select attempt_id into v_paper_attempt from public.plan_blocks
    where cycle_id = v_cycle_id and user_id = v_user and task_type = 'diagnostic' and assessment_scope->>'kind' = 'weekly_paper'
    order by local_date desc nulls last limit 1;
  if v_draft.closure_kind = 'paper_scored' then
    if not exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored'
        and (id::text = v_paper_attempt or (cycle_id = v_cycle_id and attempt_kind = 'weekly'))) then
      raise exception 'The weekly paper has not been scored.' using errcode = '22023';
    end if;
  else
    if coalesce(btrim(v_draft.no_paper_reason), '') = '' then
      raise exception 'A no-paper closure needs a reason.' using errcode = '22023';
    end if;
    if exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored' and cycle_id = v_cycle_id and attempt_kind = 'weekly') then
      raise exception 'The paper was scored; close with the paper.' using errcode = '22023';
    end if;
  end if;

  v_actions := coalesce(v_draft.proposal->'actions', '[]'::jsonb);
  v_next := v_draft.proposal->'next';
  v_next_start := (v_next->>'starts_at_local')::date;
  if v_next_start is null or (v_next->>'ends_at_local') is null or v_next_start <= v_cycle.ends_at_local then
    raise exception 'The next week must start after this one ends.' using errcode = '22023';
  end if;

  -- Pass 1: what happened. Every change is recorded in the task's own history.
  for v_action in select * from jsonb_array_elements(v_actions) loop
    select * into v_task from public.plan_blocks where id = v_action->>'taskId' and cycle_id = v_cycle_id and user_id = v_user;
    if not found then raise exception 'A task in this review is no longer part of the week.' using errcode = '22023'; end if;
    v_new_exec := nullif(v_action->>'setExecution', '');
    if v_new_exec is not null and v_new_exec is distinct from v_task.execution then
      update public.plan_blocks set execution = v_new_exec, revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, v_new_exec, jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'cancel')::boolean, false) then
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, 'cancelled', jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'unknown')::boolean, false) then v_unknown := v_unknown || v_task.id; end if;
  end loop;

  -- The next week. A learner may have only one active cycle, so the old one is closed first.
  update public.planning_cycles set status = 'closed', revision = revision + 1 where id = v_cycle_id;
  v_next_cycle := gen_random_uuid();
  insert into public.planning_cycles (id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status, anchor_day)
    values (v_next_cycle, v_user, now(), now() + interval '7 days', v_next_start, (v_next->>'ends_at_local')::date,
            coalesce(v_next->>'timezone', v_cycle.timezone, 'UTC'), 'active', nullif(v_next->>'anchor_day', '')::smallint);

  -- Follow-up work for class items that never received a task (a durable obligation): the saved proposal may place it in the next week, but never
  -- more than is still owed, and only for this student's own item.
  for r2 in select r->>'class_session_id' as s, r->>'outcome_id' as o, sum((r->>'duration_minutes')::int)::int as m
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'class_session_id', '') <> '' group by 1, 2 loop
    select planned_minutes into v_planned from public.class_session_items i join public.class_sessions s on s.id = i.session_id
      where i.session_id = r2.s::uuid and s.user_id = v_user and i.outcome_id = r2.o and i.studied_in_class = false for update of i;
    if not found or v_planned is null or r2.m + public.class_item_allocated(r2.s::uuid, r2.o) > v_planned then
      raise exception 'STALE_PROPOSAL: more follow-up work was proposed than is still owed';
    end if;
  end loop;
  for r2 in select r->>'group_key' as k, min(r->>'id') as first_id, min(r->>'outcome_id') as o, min(r->>'class_session_id') as s
              from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) r where coalesce(r->>'group_key', '') <> '' group by 1 loop
    insert into public.task_scope_groups (user_id, original_task_id, expected_parts, original_scope)
      values (v_user, r2.first_id, 2, jsonb_build_object('outcome_id', r2.o, 'session_id', r2.s, 'source', 'class_log')) returning id into v_gid;
    v_groups := v_groups || jsonb_build_object(r2.k, v_gid);
  end loop;

  -- An empty week is valid: a planned break or no availability must not trap the student.
  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
    duration_minutes, duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by,
    concept_id, learning_objective, suggested_approach, completion_meaning,
    class_session_id, outcome_id, sitting_ordinal, dependencies, verification_intent, curriculum_reference, scope_group_id
  )
  select r->>'id', v_user, v_next_cycle, r->>'title', r->>'detail', r->>'task_type', r->>'origin', r->>'priority', r->>'placement',
         r->>'execution', (r->>'local_date')::date, (r->>'day')::date, nullif(r->>'starts_at', '')::timestamptz,
         (r->>'duration_minutes')::smallint, r->>'duration', nullif(r->>'lm_id', ''), nullif(r->>'repair_thread_id', '')::uuid,
         r->>'rationale', case when jsonb_typeof(r->'assessment_scope') = 'object' then r->'assessment_scope' end, r->>'created_by',
         nullif(r->>'concept_id', '')::uuid, nullif(r->>'learning_objective', ''), nullif(r->>'suggested_approach', ''), nullif(r->>'completion_meaning', ''),
         nullif(r->>'class_session_id', '')::uuid, nullif(r->>'outcome_id', ''), nullif(r->>'sitting_ordinal', '')::smallint,
         case when jsonb_typeof(r->'dependencies') = 'array' then r->'dependencies' else '[]'::jsonb end,
         nullif(r->>'verification_intent', ''), nullif(r->>'curriculum_reference', ''),
         coalesce((v_groups->>(r->>'group_key'))::uuid, nullif(r->>'group_id', '')::uuid)
  from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) as r;

  update public.task_scope_groups g set expected_parts = greatest(2, (
      select count(*) from public.plan_blocks p where p.scope_group_id = g.id and not exists (select 1 from public.plan_blocks c where c.continued_from_task_id = p.id)))
    where g.user_id = v_user and g.id in (select scope_group_id from public.plan_blocks where cycle_id = v_next_cycle and scope_group_id is not null and class_session_id is not null);

  -- Pass 2: what happens next. A continuation copies PLANNING context (mapping, objective, method, guidance,
  -- split group, repair link). Everything specific to the occurrence is reset and stays with the week it
  -- belongs to: minutes and history (separate tables, never copied), confirmations, the attempt, the linked
  -- evidence event, the class session, any cancellation, and the date. Placement is exactly what the saved
  -- preview showed; nothing is scheduled again here.
  perform set_config('roadmap.continuation_command', 'on', true);
  for v_action in select * from jsonb_array_elements(v_actions) loop
    if v_action->'continuation' is null or jsonb_typeof(v_action->'continuation') <> 'object' then continue; end if;
    select * into v_pred from public.plan_blocks where id = v_action->>'taskId' and user_id = v_user;
    v_minutes := (v_action->'continuation'->>'minutes')::integer;
    v_place := nullif(v_action->'continuation'->'placement'->>'date', '')::date;
    if v_place is not null and (v_place < v_next_start or v_place > (v_next->>'ends_at_local')::date) then
      raise exception 'A placement must be inside the next week.' using errcode = '22023';
    end if;
    v_succ_id := 'task-' || gen_random_uuid()::text;
    v_succ := jsonb_populate_record(null::public.plan_blocks, to_jsonb(v_pred) || jsonb_build_object(
      'id', v_succ_id, 'cycle_id', v_next_cycle, 'execution', 'not_started', 'revision', 1, 'updated_at', now(),
      'local_date', v_place, 'starts_at', null,
      'day', coalesce(v_place, v_next_start)::text,                              -- plan_blocks.day is text NOT NULL
      'placement', case when v_place is null then 'floating' else 'day_preferred' end,
      'state', case when v_place is null then 'floating' else 'planned' end,
      'duration_minutes', v_minutes, 'duration', v_minutes::text,
      'cancelled_at', null, 'cancellation_reason', null, 'cancellation_source_id', null,
      'attempt_id', null, 'evidence_event_id', null, 'class_session_id', null, 'sitting_ordinal', null, 'sitting_ordinal', null, 'assessment_scope', null,
      'created_by', 'student', 'continued_from_task_id', v_pred.id,
      'carry_intent', v_action->'continuation'->>'intent',
      'estimate_provisional', coalesce((v_action->'continuation'->>'provisional')::boolean, false),
      'rationale', 'Continuing from last week. Your earlier progress and time stay with that week.'
    ));
    insert into public.plan_blocks select (v_succ).*;
    insert into public.task_events(user_id, task_id, event_type, payload, previous)
      values (v_user, v_pred.id, 'details_changed', jsonb_build_object('kind', 'continued', 'continuedAs', v_succ_id, 'draftId', p_draft_id), '{}'::jsonb),
             (v_user, v_succ_id, 'created', jsonb_build_object('continuedFrom', v_pred.id, 'draftId', p_draft_id, 'placedOn', v_place), '{}'::jsonb);
    v_continued := v_continued || jsonb_build_array(jsonb_build_object('from', v_pred.id, 'to', v_succ_id, 'date', v_place));
  end loop;

  insert into public.weekly_reviews (user_id, cycle_id, next_cycle_id, closure_kind, no_paper_reason, unknown_task_ids, recap, resolutions, draft_id, continuations)
    values (v_user, v_cycle_id, v_next_cycle, v_draft.closure_kind, nullif(btrim(v_draft.no_paper_reason), ''), v_unknown,
            coalesce(v_draft.proposal->'recap', '{}'::jsonb), v_draft.choices, p_draft_id, v_continued);
  update public.weekly_transition_drafts set status = 'accepted' where id = p_draft_id;

  return jsonb_build_object('ok', true, 'alreadyClosed', false, 'closedCycleId', v_cycle_id, 'nextCycleId', v_next_cycle,
    'continued', jsonb_array_length(v_continued));
end; $function$
;


revoke all on function public.class_day_free_spans(uuid, date, text, timestamptz) from public, anon, authenticated;
notify pgrst, 'reload schema';
