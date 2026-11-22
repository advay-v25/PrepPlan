-- B3 closeout: exception-aware series preview, effective-occurrence editability, and one reviewed recovery command for existing study tasks.
-- Applied after 20261224 (never edited). class_change_preview / class_change_apply are replaced from their effective definitions.

-- One class occurrence's real standing. Original date is identity; where it ACTUALLY is decides whether it can still be changed.
--   canChange  : move/cancel -- the class is not cancelled-and-gone, its actual start has not passed, and nothing is logged for that day.
--   canRestore : Restore puts it back at its ORIGINAL slot, which must not have started and must not hold a class log.
create or replace function public.class_occurrence_state(p_user uuid, p_commitment uuid, p_occ date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := public.booking_tz(p_user); c public.calendar_commitments%rowtype; e public.commitment_exceptions%rowtype;
  v_eff date; v_est time; v_cur_start timestamptz; v_orig_start timestamptz; v_logged boolean;
begin
  select * into c from public.calendar_commitments where id = p_commitment and user_id = p_user;
  if not found or c.start_time is null then return jsonb_build_object('canChange', false, 'canRestore', false); end if;
  select * into e from public.commitment_exceptions where commitment_id = p_commitment and occurrence_date = p_occ;
  v_orig_start := (p_occ + c.start_time)::timestamp at time zone v_tz;
  v_eff := case when e.kind = 'moved' then coalesce(e.new_date, p_occ) else p_occ end;
  v_est := case when e.kind = 'moved' then coalesce(e.new_start_time, c.start_time) else c.start_time end;
  v_cur_start := (v_eff + v_est)::timestamp at time zone v_tz;
  select exists (select 1 from public.class_sessions s where s.user_id = p_user and s.class_date in (p_occ, v_eff)) into v_logged;
  return jsonb_build_object('effectiveDate', v_eff, 'effectiveStart', v_est, 'logged', v_logged,
    'canChange', not v_logged and (case when e.kind = 'skipped' then v_orig_start else v_cur_start end) > now(),
    'canRestore', e.id is not null and not v_logged and v_orig_start > now());
end $$;

-- A series' real upcoming schedule for a pattern: skipped dates removed, moved occurrences at their moved slot (their own times, else the pattern's).
-- Only exceptions whose ORIGINAL date is a day of the pattern count; the rest are inert for it. Dates are bounded by the effective-date window.
create or replace function public.class_effective_occurrences(p_series uuid, p_wd smallint[], p_start time, p_dur interval, p_min_occ date, p_ends_on date, p_win_from date, p_win_to date)
returns table (original_date date, d date, st time, dur interval, moved boolean) language sql stable set search_path = '' as $$
  select g::date, g::date, p_start, p_dur, false
    from generate_series(p_win_from::timestamp, p_win_to::timestamp, interval '1 day') g
   where g::date >= p_min_occ and extract(dow from g)::smallint = any (p_wd) and (p_ends_on is null or g::date <= p_ends_on)
     and not exists (select 1 from public.commitment_exceptions x where x.commitment_id = p_series and x.occurrence_date = g::date)
  union all
  select x.occurrence_date, coalesce(x.new_date, x.occurrence_date), coalesce(x.new_start_time, p_start),
         coalesce(x.new_end_time - coalesce(x.new_start_time, p_start), p_dur), true
    from public.commitment_exceptions x
   where x.commitment_id = p_series and x.kind = 'moved' and x.occurrence_date >= p_min_occ and extract(dow from x.occurrence_date)::smallint = any (p_wd)
     and (p_ends_on is null or x.occurrence_date <= p_ends_on) and coalesce(x.new_date, x.occurrence_date) between p_win_from and p_win_to
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
  v_ranges tstzrange[] := '{}'; v_r tstzrange; m record; d date; v_state jsonb; v_mr tstzrange;
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
    select * into e from public.commitment_exceptions where commitment_id = c.id and occurrence_date = v_occ;
    -- Editability follows where the class ACTUALLY is (a class moved out of a past slot into the future has not happened) and what is recorded.
    v_state := public.class_occurrence_state(p_user, p_commitment, v_occ);
    if p_action = 'occurrence_restore' then
      if (v_state->>'canRestore')::boolean is not true then
        return jsonb_build_object('ok', false, 'code', 'PAST_OCCURRENCE', 'message', 'Its original time has already passed, so it cannot be restored there.');
      end if;
    elsif (v_state->>'canChange')::boolean is not true then
      return jsonb_build_object('ok', false, 'code', 'PAST_OCCURRENCE', 'message', 'A class that has started, happened or been logged keeps its record and cannot be changed.');
    end if;
  end if;

  if p_action = 'occurrence_move' then
    v_new := public.class_change_date(p_params->>'new_date');
    v_ns := public.class_change_time(p_params->>'new_start_time'); v_ne := public.class_change_time(p_params->>'new_end_time');
    if v_new is null then return jsonb_build_object('ok', false, 'code', 'INVALID_DATE', 'message', 'Choose a valid new date.'); end if;
    if v_ns is null or v_ne is null then return jsonb_build_object('ok', false, 'code', 'INVALID_TIME', 'message', 'Choose a valid start and end time.'); end if;
    if v_ne <= v_ns then return jsonb_build_object('ok', false, 'code', 'INVALID_RANGE', 'message', 'It has to end after it starts.'); end if;
    if v_new < v_today or ((v_new + v_ns)::timestamp at time zone v_tz) <= now() then return jsonb_build_object('ok', false, 'code', 'PAST_DATE', 'message', 'Choose a time that has not passed.'); end if;
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
    -- Upcoming sessions, old versus new, from the ACTUAL schedule (skips removed, moves at their moved slot; the new pattern carries only the
    -- exceptions that still land on one of its days). The summary is bounded to eight weeks from the effective date; booked mocks are checked beyond it.
    v_changes := jsonb_build_array(jsonb_build_object('effectiveFrom', v_from, 'horizonEnd', v_from + 55,
      'old', coalesce((select jsonb_agg(jsonb_build_object('date', o.d, 'start', o.st, 'end', o.st + o.dur, 'moved', o.moved) order by o.d, o.st)
                         from public.class_effective_occurrences(c.id, c.weekdays, c.start_time, c.end_time - c.start_time, v_from, c.ends_on, v_from, v_from + 55) o), '[]'::jsonb),
      'new', coalesce((select jsonb_agg(jsonb_build_object('date', o.d, 'start', o.st, 'end', o.st + o.dur, 'moved', o.moved) order by o.d, o.st)
                         from public.class_effective_occurrences(c.id, v_wd, v_s, v_e - v_s, v_from, c.ends_on, v_from, v_from + 55) o), '[]'::jsonb),
      'earlierEndsOn', v_from - 1, 'weekdays', to_jsonb(v_wd), 'start', v_s, 'end', v_e));
    select coalesce(array_agg(public.class_occurrence_range(v_tz, o.d, o.st, o.st + o.dur) order by o.d, o.st), '{}') into v_ranges
      from public.class_effective_occurrences(c.id, v_wd, v_s, v_e - v_s, v_from, c.ends_on, v_from, v_from + 55) o;
    -- Booked mocks anywhere on or after the effective date, against the adjusted schedule (a carried skip frees its slot; a carried move occupies its new one).
    for m in select a.id, a.planned_date, a.start_time, a.duration_minutes, a.label from public.mock_appointments a
              where a.user_id = p_user and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null and a.planned_date >= v_from - 1 loop
      v_mr := public.mock_booking_range(p_user, m.planned_date, m.start_time, m.duration_minutes);
      if exists (select 1 from public.class_effective_occurrences(c.id, v_wd, v_s, v_e - v_s, v_from, c.ends_on, m.planned_date - 1, m.planned_date + 1) o
                  where public.class_occurrence_range(v_tz, o.d, o.st, o.st + o.dur) && v_mr) then
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
              ((v_from + v_s)::timestamp at time zone coalesce(c.timezone, v_tz)), ((v_from + v_e)::timestamp at time zone coalesce(c.timezone, v_tz)), c.is_protected, 'student', 'archived', false);
    insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time, note)
      select x.user_id, v_succ, x.occurrence_date, x.kind, x.new_date, x.new_start_time, x.new_end_time, x.note
        from public.commitment_exceptions x where x.commitment_id = c.id and x.occurrence_date >= v_from and extract(dow from x.occurrence_date)::smallint = any (v_wd);
    -- Activation is the moment the booking guard judges the final schedule (new pattern WITH its carried skips and moves) against booked mocks.
    update public.calendar_commitments set status = 'active' where id = v_succ;
    update public.profiles set onboarding_context_version = onboarding_context_version + 1 where id = p_user and onboarding_status = 'complete';
  end if;

  v_receipt := jsonb_build_object('ok', true, 'action', p_action, 'commitmentId', p_commitment, 'successorId', v_succ, 'replayed', false,
    'changes', v_prev->'changes', 'affectedTasks', v_prev->'affectedTasks', 'carriedExceptions', v_prev->'carriedExceptions', 'inertExceptions', v_prev->'inertExceptions');
  insert into public.checkpoint_commands (user_id, key, command, payload_hash, receipt) values (p_user, p_key, 'class_change', v_hash, v_receipt);
  return v_receipt;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------
-- Reviewed recovery of EXISTING study tasks after a class change. A draft (purpose 'class_change_recovery', in plan_drafts beside the current-week
-- draft) holds the old -> proposed placements and the work that did not fit; one command applies the whole reviewed set or nothing.
-- ---------------------------------------------------------------------------------------------------------------------------------------

-- Unfinished timed tasks (today onward, not yet over) whose slot overlaps protected time or a booked mock in the EFFECTIVE schedule.
create or replace function public.class_recovery_overlaps(p_user uuid, p_cycle uuid, p_now timestamptz default now())
returns table (task_id text, source_title text) language sql stable set search_path = '' as $$
  select b.id, coalesce(
      (select p.title from public.protected_occurrences(p_user, tstzrange(b.starts_at, b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)), '[)')) p limit 1),
      (select coalesce(nullif(a.label, ''), 'Your mock') from public.mock_appointments a
        where a.user_id = p_user and a.status = 'planned' and a.start_time is not null and a.duration_minutes is not null
          and public.mock_booking_range(p_user, a.planned_date, a.start_time, a.duration_minutes) && tstzrange(b.starts_at, b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)), '[)') limit 1))
    from public.plan_blocks b
   where b.user_id = p_user and b.cycle_id = p_cycle and b.placement = 'timed' and b.starts_at is not null and b.cancelled_at is null and b.learning_activity_id is null
     and b.is_protected_commitment is not true and b.execution in ('not_started', 'in_progress', 'partial')
     and b.starts_at + make_interval(mins => coalesce(b.duration_minutes, 30)) > p_now
$$;
revoke all on function public.class_recovery_overlaps(uuid, uuid, timestamptz), public.class_occurrence_state(uuid, uuid, date),
  public.class_effective_occurrences(uuid, smallint[], time, interval, date, date, date, date) from public, anon, authenticated;
grant execute on function public.class_recovery_overlaps(uuid, uuid, timestamptz), public.class_occurrence_state(uuid, uuid, date),
  public.class_effective_occurrences(uuid, smallint[], time, interval, date, date, date, date) to service_role;

-- One ready recovery draft per (student, cycle, inputs, class change): preparing it again for unchanged inputs returns the same row.
create unique index if not exists plan_drafts_ready_class_recovery_idx on public.plan_drafts (user_id, cycle_id, context_fingerprint, (draft_json->>'change_key'))
  where status = 'ready' and purpose = 'class_change_recovery';

-- Read-only: is this recovery draft still exactly what the database would plan from today's inputs?
create or replace function public.class_recovery_problem(p_user uuid, p_draft uuid, p_now timestamptz default now())
returns text language plpgsql stable set search_path = public, pg_temp as $$
declare d public.plan_drafts%rowtype; c public.planning_cycles%rowtype; v_today date; t jsonb;
begin
  select * into d from public.plan_drafts where id = p_draft and user_id = p_user and purpose = 'class_change_recovery';
  if not found then return 'NOT_FOUND'; end if;
  select * into c from public.planning_cycles where id = d.cycle_id and user_id = p_user;
  if not found or c.status <> 'active' then return 'CYCLE_CHANGED'; end if;
  v_today := (p_now at time zone coalesce(c.timezone, 'UTC'))::date;
  if c.ends_at_local < v_today then return 'CYCLE_ENDED'; end if;
  if (d.draft_json->>'planning_date')::date is distinct from v_today
    or d.cycle_start_date is distinct from c.starts_at_local or d.cycle_end_date is distinct from c.ends_at_local
    or d.context_fingerprint is distinct from public.current_week_source_hash(p_user, c.id) then return 'STALE_PROPOSAL'; end if;
  if jsonb_typeof(d.draft_json->'moves') is distinct from 'array' or jsonb_typeof(d.draft_json->'unplaced') is distinct from 'array' then return 'INVALID_PROPOSAL'; end if;
  for t in select value from jsonb_array_elements(d.draft_json->'moves') loop
    if (t->>'to_date')::date is null or (t->>'to_date')::date < c.starts_at_local or (t->>'to_date')::date > c.ends_at_local or (t->>'to_date')::date < v_today
      or coalesce((t->>'minutes')::int, 0) <= 0 or t->>'task_id' is null then return 'INVALID_PROPOSAL'; end if;
  end loop;
  return null;
exception when data_exception then return 'INVALID_PROPOSAL';
end $$;
revoke all on function public.class_recovery_problem(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.class_recovery_problem(uuid, uuid, timestamptz) to service_role;

-- One atomic acceptance: every reviewed move (through the same apply_task_move boundary Calendar and the Coach use, strict about overlaps) and
-- every "set aside for weekly review" choice, or nothing. A repeat returns the stored receipt. Same lock order as the current-week plan.
create or replace function public.accept_class_recovery(p_draft_id uuid, p_expected_revision integer, p_choices jsonb default '{}'::jsonb)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
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

  v_receipt := jsonb_build_object('draft_id', p_draft_id, 'cycle_id', v_cycle.id, 'change_key', d.draft_json->>'change_key', 'moved', v_moved, 'set_aside', v_deferred, 'kept', v_kept, 'tasks', v_done);
  update public.plan_drafts set status = 'accepted', accepted_cycle_id = v_cycle.id, revision = revision + 1, updated_at = now(),
    draft_json = jsonb_set(draft_json, '{receipt}', v_receipt) where id = p_draft_id;
  return (v_receipt || '{"replayed":false}'::jsonb)::json;
end $$;
revoke all on function public.accept_class_recovery(uuid, integer, jsonb) from public, anon;
grant execute on function public.accept_class_recovery(uuid, integer, jsonb) to authenticated;

-- "Keep my current study placements for now": the draft closes, nothing moves, and the overlap stays visible on Calendar.
create or replace function public.dismiss_class_recovery(p_draft_id uuid, p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid := auth.uid(); d public.plan_drafts%rowtype;
begin
  if v_user is null or not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete')
    or not public.is_beta_admitted(v_user) then raise exception 'Application access required' using errcode = '42501'; end if;
  perform public.scope_lock(v_user);
  select * into d from public.plan_drafts where id = p_draft_id and user_id = v_user and purpose = 'class_change_recovery' for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if d.status = 'accepted' then return jsonb_build_object('ok', true, 'outcome', 'accepted', 'receipt', d.draft_json->'receipt'); end if;
  if d.status = 'discarded' then return jsonb_build_object('ok', true, 'outcome', 'already_dismissed'); end if;
  if d.status <> 'ready' or d.revision is distinct from p_expected_revision then return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL'); end if;
  update public.plan_drafts set status = 'discarded', revision = revision + 1, updated_at = now() where id = d.id;
  return jsonb_build_object('ok', true, 'outcome', 'dismissed');
end $$;
revoke all on function public.dismiss_class_recovery(uuid, integer) from public, anon;
grant execute on function public.dismiss_class_recovery(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
