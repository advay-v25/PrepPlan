-- Onboarding's "Add my next known class" writes the very commitment that should anchor a variable
-- schedule's week boundary (resolvePulseWeek's one-off anchor, added alongside defines_cycle). The function
-- predates that column and never set it, so a next class added during onboarding blocked time but never
-- actually moved the paper day the way the review screen told the student it would.
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
      (user_id, label, kind, starts_at, ends_at, status, source, recurrence, is_protected, defines_cycle)
    values
      (p_user, coalesce(nullif(p_next_class->>'label', ''), 'Class'), 'class',
       (p_next_class->>'starts_at')::timestamptz, (p_next_class->>'ends_at')::timestamptz,
       'active', 'onboarding', 'none', true, true);
  end if;
end $$;
