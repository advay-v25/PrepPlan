-- In-progress logging (owner decision, 19 Nov 2026, founder decisions §21): a class can be reported once it has STARTED. Whether it has finished is a separate,
-- explicit fact (class_sessions.completed_at), so the end-time gate of 20270119 becomes a start-time gate. Every other occurrence check (ownership,
-- weekly membership, original/moved date, cancelled, archived, succession) is unchanged. Patched in place from the live definition.
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
  v_c public.calendar_commitments%rowtype; v_ex public.commitment_exceptions%rowtype; v_moved boolean; v_eff date; v_end time; v_start time; v_pred text; v_n integer := 0;
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
    v_start := case when v_moved then coalesce(v_ex.new_start_time, v_c.start_time) else v_c.start_time end;
    v_end := case when v_moved then coalesce(v_ex.new_end_time, coalesce(v_ex.new_start_time, v_c.start_time) + greatest(interval '15 minutes', v_c.end_time - v_c.start_time)) else v_c.end_time end;
    if p_class_date <> v_eff then raise exception 'OCCURRENCE_MOVED: that class is on % now', v_eff; end if;
    -- A class can be reported once it has STARTED (in-progress logging); that it has finished is a separate, explicit fact (completed_at).
    if v_eff > v_today or (v_eff = v_today and v_start > (clock_timestamp() at time zone v_tz)::time) then raise exception 'OCCURRENCE_NOT_STARTED: that class has not started yet'; end if;
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
    if v_c.starts_at > clock_timestamp() then raise exception 'OCCURRENCE_NOT_STARTED: that class has not started yet'; end if;
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
