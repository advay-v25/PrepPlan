-- B3: one atomic, previewable command for changing a class (or any weekly commitment).
--
--   * class_change_preview(): read-only. Validates strictly, then describes exactly what would change (old/new occurrences, mock conflicts,
--     unfinished timed tasks the changed slot overlaps, series exceptions that carry over) plus a `token` (the state of the series and its
--     exceptions) and a `fingerprint` (token + everything shown). Nothing is written.
--   * class_change_apply(): takes scope_lock first (the established order), replays a stored receipt for the same (student, key, payload),
--     refuses a stale fingerprint with the fresh preview, then writes. The existing booking guards (20261128 / 20261201) still run inside the
--     transaction, so a mock booked between preview and confirm refuses the write and rolls it back, leaving the series and its exceptions intact.
--
-- Actions: occurrence_move | occurrence_cancel | occurrence_restore | series_from.
--   series_from NEVER redraws earlier classes: the old series ends the day before the effective date and a successor series (new id, same label /
--   kind / protection / zone, `starts_on` = the effective date) carries the new pattern. Exceptions on/after that date that are still real
--   occurrences of the new pattern are COPIED to the successor; the rest stay on the old (now inert) series and are named in the preview, and a
--   confirm must acknowledge them. Nothing is deleted. A material series change also moves the setup version, like the Settings class commands.
-- Receipts reuse checkpoint_commands (command = 'class_change').

create or replace function public.class_change_date(p text) returns date language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $$;

create or replace function public.class_change_time(p text) returns time language plpgsql immutable set search_path = '' as $$
begin
  if p is null or p !~ '^([01]\d|2[0-3]):[0-5]\d(:00)?$' then return null; end if;
  return substr(p, 1, 5)::time;
end $$;

create or replace function public.class_occurrence_range(p_tz text, p_date date, p_start time, p_end time) returns tstzrange
language sql immutable set search_path = '' as $$
  select tstzrange(((p_date + p_start)::timestamp at time zone p_tz),
                   ((p_date + p_start)::timestamp at time zone p_tz) + greatest(p_end - p_start, interval '15 minutes'), '[)')
$$;

-- The state a preview was made against: the series itself and every exception on it.
create or replace function public.class_change_token(p_user uuid, p_commitment uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(coalesce((select jsonb_build_object('c', jsonb_build_array(c.id, c.label, c.kind, c.is_protected, c.status, c.recurrence, c.weekdays,
                c.start_time, c.end_time, c.starts_on, c.ends_on, c.ended_by_completion),
              'e', coalesce((select jsonb_agg(jsonb_build_array(e.occurrence_date, e.kind, e.new_date, e.new_start_time, e.new_end_time) order by e.occurrence_date)
                               from public.commitment_exceptions e where e.commitment_id = c.id), '[]'::jsonb))::text
           from public.calendar_commitments c where c.id = p_commitment and c.user_id = p_user), 'none'))
$$;

create or replace function public.class_change_preview(p_user uuid, p_commitment uuid, p_action text, p_params jsonb, p_expected_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := public.booking_tz(p_user);
  v_today date := (now() at time zone public.booking_tz(p_user))::date;
  c public.calendar_commitments%rowtype;
  e public.commitment_exceptions%rowtype;
  v_token text;
  v_occ date; v_new date; v_from date; v_s time; v_e time; v_ns time; v_ne time;
  v_wd smallint[]; v_bad boolean;
  v_changes jsonb := '[]'::jsonb; v_conflicts jsonb := '[]'::jsonb; v_affected jsonb := '[]'::jsonb;
  v_carry jsonb := '[]'::jsonb; v_inert jsonb := '[]'::jsonb;
  v_ranges tstzrange[] := '{}'; v_r tstzrange; m record; d date; v_old_start time; v_old_end time;
  v_body jsonb;
begin
  if p_action not in ('occurrence_move', 'occurrence_cancel', 'occurrence_restore', 'series_from') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_ACTION', 'message', 'Choose what to change.');
  end if;
  select * into c from public.calendar_commitments where id = p_commitment and user_id = p_user;
  if not found or c.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'That class is no longer available.');
  end if;
  if c.recurrence <> 'weekly' or c.start_time is null or c.end_time is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_RECURRING', 'message', 'This does not repeat, so it has no single class to change.');
  end if;
  v_token := public.class_change_token(p_user, p_commitment);
  if p_expected_token is not null and p_expected_token <> v_token then
    return jsonb_build_object('ok', false, 'code', 'STALE_SOURCE', 'message', 'This class changed since you opened it.');
  end if;
  if p_params is null or jsonb_typeof(p_params) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'INVALID_INPUT', 'message', 'The change is incomplete.');
  end if;

  if p_action <> 'series_from' then
    v_occ := public.class_change_date(p_params->>'occurrence_date');
    if v_occ is null then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE', 'message', 'Which class (date) is being changed?'); end if;
    if not (extract(dow from v_occ)::smallint = any (c.weekdays)) or (c.starts_on is not null and v_occ < c.starts_on) or (c.ends_on is not null and v_occ > c.ends_on) then
      return jsonb_build_object('ok', false, 'code', 'NOT_AN_OCCURRENCE', 'message', 'That date is not one of this class''s sessions.');
    end if;
    if v_occ < v_today then
      return jsonb_build_object('ok', false, 'code', 'PAST_OCCURRENCE', 'message', 'A class that has already happened keeps its record and cannot be changed.');
    end if;
    select * into e from public.commitment_exceptions where commitment_id = c.id and occurrence_date = v_occ;
  end if;

  if p_action = 'occurrence_move' then
    v_new := public.class_change_date(p_params->>'new_date');
    v_ns := public.class_change_time(p_params->>'new_start_time'); v_ne := public.class_change_time(p_params->>'new_end_time');
    if v_new is null then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE', 'message', 'Choose a valid new date.'); end if;
    if v_ns is null or v_ne is null then return jsonb_build_object('ok', false, 'code', 'INVALID_TIME', 'message', 'Choose a valid start and end time.'); end if;
    if v_ne <= v_ns then return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE', 'message', 'It has to end after it starts.'); end if;
    if v_new < v_today then return jsonb_build_object('ok', false, 'code', 'PAST_DATE', 'message', 'Choose today or a later date.'); end if;
    if v_new = v_occ and v_ns = c.start_time and v_ne = c.end_time then
      return jsonb_build_object('ok', false, 'code', 'USE_RESTORE', 'message', 'That is the original time. Use Restore this class instead.');
    end if;
    if e.id is not null and e.kind = 'moved' and coalesce(e.new_date, e.occurrence_date) = v_new and coalesce(e.new_start_time, c.start_time) = v_ns and coalesce(e.new_end_time, c.end_time) = v_ne then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE', 'message', 'It is already there.');
    end if;
    -- another ordinary session of the same series on the new date, at an overlapping time
    if v_new <> v_occ and extract(dow from v_new)::smallint = any (c.weekdays) and (c.starts_on is null or v_new >= c.starts_on) and (c.ends_on is null or v_new <= c.ends_on)
       and not exists (select 1 from public.commitment_exceptions x where x.commitment_id = c.id and x.occurrence_date = v_new)
       and public.class_occurrence_range(v_tz, v_new, c.start_time, c.end_time) && public.class_occurrence_range(v_tz, v_new, v_ns, v_ne) then
      return jsonb_build_object('ok', false, 'code', 'OVERLAPS_SERIES', 'message', 'Another session of this class is already then.');
    end if;
    v_ranges := array[public.class_occurrence_range(v_tz, v_new, v_ns, v_ne)];
    v_changes := jsonb_build_array(jsonb_build_object('occurrenceDate', v_occ,
      'from', case when e.id is not null and e.kind = 'moved' then jsonb_build_object('date', coalesce(e.new_date, v_occ), 'start', coalesce(e.new_start_time, c.start_time), 'end', coalesce(e.new_end_time, c.end_time))
                   when e.id is not null then null else jsonb_build_object('date', v_occ, 'start', c.start_time, 'end', c.end_time) end,
      'to', jsonb_build_object('date', v_new, 'start', v_ns, 'end', v_ne)));
  elsif p_action = 'occurrence_cancel' then
    if e.id is not null and e.kind = 'skipped' then return jsonb_build_object('ok', false, 'code', 'NO_CHANGE', 'message', 'That class is already cancelled.'); end if;
    v_changes := jsonb_build_array(jsonb_build_object('occurrenceDate', v_occ,
      'from', case when e.id is not null then jsonb_build_object('date', coalesce(e.new_date, v_occ), 'start', coalesce(e.new_start_time, c.start_time), 'end', coalesce(e.new_end_time, c.end_time))
                   else jsonb_build_object('date', v_occ, 'start', c.start_time, 'end', c.end_time) end, 'to', null));
  elsif p_action = 'occurrence_restore' then
    if e.id is null then return jsonb_build_object('ok', false, 'code', 'NO_CHANGE', 'message', 'This class is already at its original time.'); end if;
    v_ranges := array[public.class_occurrence_range(v_tz, v_occ, c.start_time, c.end_time)];
    v_changes := jsonb_build_array(jsonb_build_object('occurrenceDate', v_occ,
      'from', case when e.kind = 'moved' then jsonb_build_object('date', coalesce(e.new_date, v_occ), 'start', coalesce(e.new_start_time, c.start_time), 'end', coalesce(e.new_end_time, c.end_time)) else null end,
      'to', jsonb_build_object('date', v_occ, 'start', c.start_time, 'end', c.end_time)));
  else
    -- series_from
    v_from := public.class_change_date(p_params->>'effective_from');
    if v_from is null then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE', 'message', 'Choose the date the new pattern starts.'); end if;
    if c.ended_by_completion then return jsonb_build_object('ok', false, 'code', 'SERIES_FINISHED', 'message', 'This class was marked finished. Reopen it in Settings first.'); end if;
    if v_from < v_today then return jsonb_build_object('ok', false, 'code', 'PAST_DATE', 'message', 'Earlier classes keep the pattern they had. Choose today or a later date.'); end if;
    if c.starts_on is not null and v_from <= c.starts_on then return jsonb_build_object('ok', false, 'code', 'BEFORE_START', 'message', 'Choose a date after the first class of this series.'); end if;
    if c.ends_on is not null and v_from > c.ends_on then return jsonb_build_object('ok', false, 'code', 'AFTER_END', 'message', 'This series ends before that date.'); end if;
    v_s := coalesce(public.class_change_time(p_params->>'start_time'), c.start_time); v_e := coalesce(public.class_change_time(p_params->>'end_time'), c.end_time);
    if (p_params ? 'start_time' and public.class_change_time(p_params->>'start_time') is null) or (p_params ? 'end_time' and public.class_change_time(p_params->>'end_time') is null) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_TIME', 'message', 'Choose a valid start and end time.');
    end if;
    if v_e <= v_s then return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE', 'message', 'It has to end after it starts.'); end if;
    if p_params ? 'weekdays' then
      if jsonb_typeof(p_params->'weekdays') <> 'array' then return jsonb_build_object('ok', false, 'code', 'INVALID_WEEKDAYS', 'message', 'Choose the days of the week.'); end if;
      select bool_or(x !~ '^[0-6]$'), array_agg(distinct x::smallint order by x::smallint) filter (where x ~ '^[0-6]$')
        into v_bad, v_wd from jsonb_array_elements_text(p_params->'weekdays') x;
      if coalesce(v_bad, true) or coalesce(cardinality(v_wd), 0) = 0 then return jsonb_build_object('ok', false, 'code', 'INVALID_WEEKDAYS', 'message', 'Choose at least one valid day of the week.'); end if;
    else v_wd := c.weekdays; end if;
    if v_wd = (select array_agg(w order by w) from unnest(c.weekdays) w) and v_s = c.start_time and v_e = c.end_time then
      return jsonb_build_object('ok', false, 'code', 'NO_CHANGE', 'message', 'That is the pattern already.');
    end if;
    -- upcoming sessions, old versus new (first eight weeks)
    v_changes := jsonb_build_array(jsonb_build_object('effectiveFrom', v_from,
      'old', coalesce((select jsonb_agg(jsonb_build_object('date', g::date, 'start', c.start_time, 'end', c.end_time) order by g)
                         from generate_series(v_from::timestamp, (v_from + 55)::timestamp, interval '1 day') g
                        where extract(dow from g)::smallint = any (c.weekdays) and (c.ends_on is null or g::date <= c.ends_on)), '[]'::jsonb),
      'new', coalesce((select jsonb_agg(jsonb_build_object('date', g::date, 'start', v_s, 'end', v_e) order by g)
                         from generate_series(v_from::timestamp, (v_from + 55)::timestamp, interval '1 day') g
                        where extract(dow from g)::smallint = any (v_wd) and (c.ends_on is null or g::date <= c.ends_on)), '[]'::jsonb),
      'earlierEndsOn', v_from - 1, 'weekdays', to_jsonb(v_wd), 'start', v_s, 'end', v_e));
    select coalesce(array_agg(public.class_occurrence_range(v_tz, g::date, v_s, v_e) order by g), '{}') into v_ranges
      from generate_series(v_from::timestamp, (v_from + 55)::timestamp, interval '1 day') g
     where extract(dow from g)::smallint = any (v_wd) and (c.ends_on is null or g::date <= c.ends_on);
    -- Booked mocks anywhere on or after the effective date (the guard checks the same).
    for m in select a.id, a.planned_date, a.start_time, a.duration_minutes, a.label from public.mock_appointments a
              where a.user_id = p_user and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null and a.planned_date >= v_from loop
      if extract(dow from m.planned_date)::smallint = any (v_wd) and (c.ends_on is null or m.planned_date <= c.ends_on)
         and public.class_occurrence_range(v_tz, m.planned_date, v_s, v_e) && public.mock_booking_range(p_user, m.planned_date, m.start_time, m.duration_minutes) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('kind', 'mock', 'title', coalesce(nullif(m.label, ''), 'Your mock'), 'date', m.planned_date));
      end if;
    end loop;
    -- Exceptions on or after the effective date: still real sessions of the new pattern -> carried; otherwise named and left (inert) on the old series.
    for e in select * from public.commitment_exceptions x where x.commitment_id = c.id and x.occurrence_date >= v_from order by x.occurrence_date loop
      if extract(dow from e.occurrence_date)::smallint = any (v_wd) then
        v_carry := v_carry || jsonb_build_array(jsonb_build_object('occurrenceDate', e.occurrence_date, 'kind', e.kind, 'newDate', e.new_date));
      else
        v_inert := v_inert || jsonb_build_array(jsonb_build_object('occurrenceDate', e.occurrence_date, 'kind', e.kind, 'newDate', e.new_date));
      end if;
    end loop;
  end if;

  -- Booked mocks overlapping the slot(s) a single-occurrence change would occupy.
  if p_action <> 'series_from' then
    foreach v_r in array v_ranges loop
      for m in select a.planned_date, a.start_time, a.duration_minutes, a.label from public.mock_appointments a
                where a.user_id = p_user and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null loop
        if public.mock_booking_range(p_user, m.planned_date, m.start_time, m.duration_minutes) && v_r then
          v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object('kind', 'mock', 'title', coalesce(nullif(m.label, ''), 'Your mock'), 'date', m.planned_date));
        end if;
      end loop;
    end loop;
  end if;

  -- Unfinished TIMED work the occupied slot(s) overlap. Started work is shown but never moved by this command.
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'title', b.title, 'date', b.local_date, 'startsAt', b.starts_at, 'minutes', b.duration_minutes,
           'execution', b.execution, 'taskType', b.task_type, 'revision', b.revision, 'canMove', b.execution = 'not_started') order by b.starts_at, b.id), '[]'::jsonb)
    into v_affected
    from public.plan_blocks b
   where b.user_id = p_user and b.placement = 'timed' and b.starts_at is not null and b.cancelled_at is null and b.learning_activity_id is null
     and b.execution in ('not_started', 'in_progress', 'partial')
     and exists (select 1 from unnest(v_ranges) r where tstzrange(b.starts_at, b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)), '[)') && r);

  v_body := jsonb_build_object('action', p_action, 'commitmentId', p_commitment, 'label', c.label, 'changes', v_changes, 'conflicts', v_conflicts,
              'affectedTasks', v_affected, 'carriedExceptions', v_carry, 'inertExceptions', v_inert);
  return jsonb_build_object('ok', true, 'token', v_token, 'preview', v_body,
    'fingerprint', md5(v_token || '|' || jsonb_build_object('c', v_changes, 'x', v_conflicts, 'a', (select coalesce(jsonb_agg(jsonb_build_array(t->>'id', t->'revision')), '[]'::jsonb) from jsonb_array_elements(v_affected) t),
                       'k', v_carry, 'i', v_inert)::text));
end $$;

create or replace function public.class_change_apply(p_user uuid, p_key text, p_action text, p_commitment uuid, p_params jsonb, p_fingerprint text, p_expected_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hash text := md5(coalesce(p_action, '') || '|' || coalesce(p_commitment::text, '') || '|' || coalesce(p_params::text, '') || '|' || coalesce(p_fingerprint, ''));
  v_rec public.checkpoint_commands%rowtype;
  v_plan jsonb; v_prev jsonb; v_tz text := public.booking_tz(p_user);
  c public.calendar_commitments%rowtype; v_succ uuid; v_from date; v_wd smallint[]; v_s time; v_e time; v_occ date;
  v_receipt jsonb;
begin
  if p_key is null or char_length(p_key) not between 8 and 80 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_KEY', 'message', 'This request needs an operation key.');
  end if;
  perform public.scope_lock(p_user);

  select * into v_rec from public.checkpoint_commands where user_id = p_user and key = p_key;
  if found then
    if v_rec.command <> 'class_change' or v_rec.payload_hash <> v_hash then
      return jsonb_build_object('ok', false, 'code', 'KEY_REUSED', 'message', 'That request key was already used for a different change.');
    end if;
    return v_rec.receipt || jsonb_build_object('replayed', true);
  end if;

  v_plan := public.class_change_preview(p_user, p_commitment, p_action, p_params, p_expected_token);
  if (v_plan->>'ok')::boolean is not true then return v_plan; end if;
  if p_fingerprint is null or p_fingerprint <> v_plan->>'fingerprint' then
    return jsonb_build_object('ok', false, 'code', 'STALE_PREVIEW', 'message', 'This changed since you previewed it.', 'preview', v_plan->'preview', 'token', v_plan->>'token', 'fingerprint', v_plan->>'fingerprint');
  end if;
  v_prev := v_plan->'preview';
  if jsonb_array_length(v_prev->'conflicts') > 0 then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'message', 'It would overlap a booked mock.', 'conflicts', v_prev->'conflicts');
  end if;
  if p_action = 'series_from' and jsonb_array_length(v_prev->'inertExceptions') > 0 and coalesce((p_params->>'acknowledge_exceptions')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'EXCEPTIONS_UNRESOLVED', 'message', 'Some one-off changes later in this series no longer match the new pattern. Review them to continue.', 'inert', v_prev->'inertExceptions');
  end if;

  select * into c from public.calendar_commitments where id = p_commitment and user_id = p_user for update;

  if p_action = 'occurrence_move' then
    v_occ := (p_params->>'occurrence_date')::date;
    insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time, note)
      values (p_user, p_commitment, v_occ, 'moved', (p_params->>'new_date')::date, public.class_change_time(p_params->>'new_start_time'), public.class_change_time(p_params->>'new_end_time'), left(p_params->>'note', 500))
    on conflict (commitment_id, occurrence_date) do update set kind = 'moved', new_date = excluded.new_date, new_start_time = excluded.new_start_time, new_end_time = excluded.new_end_time, note = excluded.note;
  elsif p_action = 'occurrence_cancel' then
    v_occ := (p_params->>'occurrence_date')::date;
    insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, note)
      values (p_user, p_commitment, v_occ, 'skipped', left(p_params->>'note', 500))
    on conflict (commitment_id, occurrence_date) do update set kind = 'skipped', new_date = null, new_start_time = null, new_end_time = null, note = excluded.note;
  elsif p_action = 'occurrence_restore' then
    delete from public.commitment_exceptions where commitment_id = p_commitment and occurrence_date = (p_params->>'occurrence_date')::date and user_id = p_user;
  else
    v_from := (p_params->>'effective_from')::date;
    v_s := coalesce(public.class_change_time(p_params->>'start_time'), c.start_time); v_e := coalesce(public.class_change_time(p_params->>'end_time'), c.end_time);
    select coalesce(array_agg(distinct x::smallint order by x::smallint), c.weekdays) into v_wd from jsonb_array_elements_text(coalesce(p_params->'weekdays', to_jsonb(c.weekdays))) x;
    v_succ := gen_random_uuid();
    update public.calendar_commitments set ends_on = v_from - 1 where id = c.id;
    insert into public.calendar_commitments (id, user_id, label, kind, recurrence, weekdays, start_time, end_time, starts_on, ends_on, timezone, starts_at, ends_at, is_protected, source, status, defines_cycle)
      values (v_succ, p_user, c.label, c.kind, 'weekly', v_wd, v_s, v_e, v_from, c.ends_on, c.timezone,
              ((v_from + v_s)::timestamp at time zone coalesce(c.timezone, v_tz)), ((v_from + v_e)::timestamp at time zone coalesce(c.timezone, v_tz)), c.is_protected, 'student', 'active', false);
    insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time, note)
      select x.user_id, v_succ, x.occurrence_date, x.kind, x.new_date, x.new_start_time, x.new_end_time, x.note
        from public.commitment_exceptions x where x.commitment_id = c.id and x.occurrence_date >= v_from and extract(dow from x.occurrence_date)::smallint = any (v_wd);
    update public.profiles set onboarding_context_version = onboarding_context_version + 1 where id = p_user and onboarding_status = 'complete';
  end if;

  v_receipt := jsonb_build_object('ok', true, 'action', p_action, 'commitmentId', p_commitment, 'successorId', v_succ, 'replayed', false,
    'changes', v_prev->'changes', 'affectedTasks', v_prev->'affectedTasks', 'carriedExceptions', v_prev->'carriedExceptions', 'inertExceptions', v_prev->'inertExceptions');
  insert into public.checkpoint_commands (user_id, key, command, payload_hash, receipt) values (p_user, p_key, 'class_change', v_hash, v_receipt);
  return v_receipt;
end $$;

revoke all on function public.class_change_date(text), public.class_change_time(text), public.class_occurrence_range(text, date, time, time),
  public.class_change_token(uuid, uuid), public.class_change_preview(uuid, uuid, text, jsonb, text),
  public.class_change_apply(uuid, text, text, uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.class_change_token(uuid, uuid), public.class_change_preview(uuid, uuid, text, jsonb, text),
  public.class_change_apply(uuid, text, text, uuid, jsonb, text, text) to service_role;

notify pgrst, 'reload schema';
