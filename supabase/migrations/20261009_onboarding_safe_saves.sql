-- Onboarding saves: replace-a-section as ONE transaction.
--
-- Route and Week used to archive the old rows and then insert new ones as separate
-- statements. If the insert failed, the archive had already happened and the
-- student's working setup was gone. Each function below does the whole replacement
-- atomically, so a failure leaves the previous setup exactly as it was.
--
-- Only rows this flow wrote (source = 'onboarding') are replaced. A class the
-- student added themselves in Calendar is not theirs-to-lose by re-saving a screen.

alter table public.profiles add column if not exists week_availability_mode text
  check (week_availability_mode in ('windows', 'varies', 'none_this_week'));

-- 1. Route: preparation mode, class pattern, recurring classes, and an optional next known class.
create or replace function public.onboarding_replace_route(
  p_user uuid, p_prep_mode text, p_class_pattern text, p_classes jsonb, p_next_class jsonb
) returns void language plpgsql as $$
declare c jsonb;
begin
  update public.profiles set prep_mode = p_prep_mode, class_pattern = p_class_pattern where id = p_user;
  if not found then raise exception 'no profile for user'; end if;

  update public.calendar_commitments set status = 'archived'
   where user_id = p_user and kind = 'class' and source = 'onboarding' and status = 'active';

  for c in select * from jsonb_array_elements(coalesce(p_classes, '[]'::jsonb)) loop
    if (c->>'end_time')::time <= (c->>'start_time')::time then
      raise exception 'a class must end after it starts';
    end if;
    insert into public.calendar_commitments
      (user_id, label, kind, weekdays, start_time, end_time, starts_at, ends_at, ends_on, status, source, recurrence, is_protected)
    values
      (p_user, coalesce(nullif(c->>'label', ''), 'Class'), 'class',
       array(select jsonb_array_elements_text(c->'weekdays')::int),
       (c->>'start_time')::time, (c->>'end_time')::time,
       '1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z', nullif(c->>'ends_on', '')::date,
       'active', 'onboarding', 'weekly', true);
  end loop;

  if p_next_class is not null and p_next_class <> 'null'::jsonb then
    if (p_next_class->>'ends_at')::timestamptz <= (p_next_class->>'starts_at')::timestamptz then
      raise exception 'the next class must end after it starts';
    end if;
    insert into public.calendar_commitments
      (user_id, label, kind, starts_at, ends_at, status, source, recurrence, is_protected)
    values
      (p_user, coalesce(nullif(p_next_class->>'label', ''), 'Class'), 'class',
       (p_next_class->>'starts_at')::timestamptz, (p_next_class->>'ends_at')::timestamptz,
       'active', 'onboarding', 'none', true);
  end if;
end $$;

-- 2. Week: focused-sitting ceiling, availability windows, and optional fixed commitments.
create or replace function public.onboarding_replace_week(
  p_user uuid, p_max_session int, p_mode text, p_windows jsonb, p_commitments jsonb
) returns void language plpgsql as $$
declare w jsonb;
begin
  update public.profiles set max_session_minutes = p_max_session, week_availability_mode = p_mode where id = p_user;
  if not found then raise exception 'no profile for user'; end if;

  update public.calendar_commitments set status = 'archived'
   where user_id = p_user and kind <> 'class' and source = 'onboarding' and status = 'active';

  for w in select * from jsonb_array_elements(coalesce(p_commitments, '[]'::jsonb)) loop
    if (w->>'end_time')::time <= (w->>'start_time')::time then
      raise exception 'a commitment must end after it starts';
    end if;
    insert into public.calendar_commitments
      (user_id, label, kind, weekdays, start_time, end_time, starts_at, ends_at, status, source, recurrence)
    values
      (p_user, coalesce(nullif(w->>'label', ''), 'Commitment'), coalesce(nullif(w->>'kind', ''), 'other'),
       array(select jsonb_array_elements_text(w->'weekdays')::int),
       (w->>'start_time')::time, (w->>'end_time')::time,
       '1970-01-01T00:00:00Z', '2100-01-01T00:00:00Z', 'active', 'onboarding', 'weekly');
  end loop;

  update public.availability_windows set status = 'archived' where user_id = p_user and status = 'active';

  for w in select * from jsonb_array_elements(coalesce(p_windows, '[]'::jsonb)) loop
    if (w->>'end_time')::time <= (w->>'start_time')::time then
      raise exception 'a study window must end after it starts';
    end if;
    insert into public.availability_windows (user_id, weekday, start_time, end_time, source, status)
    values (p_user, (w->>'weekday')::int, (w->>'start_time')::time, (w->>'end_time')::time, 'onboarding', 'active');
  end loop;
end $$;

-- 3. Position: stage plus self-reported topic status. Self-report only; never evidence.
create or replace function public.onboarding_replace_position(
  p_user uuid, p_stage text, p_exposure jsonb
) returns void language plpgsql as $$
declare e jsonb;
begin
  update public.profiles set stage = p_stage where id = p_user;
  if not found then raise exception 'no profile for user'; end if;

  delete from public.user_topic_exposure where user_id = p_user and source = 'self_report';

  for e in select * from jsonb_array_elements(coalesce(p_exposure, '[]'::jsonb)) loop
    insert into public.user_topic_exposure (user_id, topic_id, recency, source)
    values (p_user, e->>'topic_id', e->>'recency', 'self_report');
  end loop;
end $$;

-- Called only through the server's service-role client.
revoke all on function public.onboarding_replace_route(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.onboarding_replace_week(uuid, int, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.onboarding_replace_position(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.onboarding_replace_route(uuid, text, text, jsonb, jsonb) to service_role;
grant execute on function public.onboarding_replace_week(uuid, int, text, jsonb, jsonb) to service_role;
grant execute on function public.onboarding_replace_position(uuid, text, jsonb) to service_role;
