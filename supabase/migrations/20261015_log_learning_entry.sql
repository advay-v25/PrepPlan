-- Log learning, end to end, in one transaction.
--
-- Before this, /app/log wrote learning_activities + user_module_state only. But
-- the student's position (Home, Curriculum) and a weekly paper's scope are both
-- read from COMPLETED plan_blocks that carry an outcome_id — so a logged session
-- never moved coverage and never appeared on Calendar. This function writes all
-- three together:
--   1. the activity (history), via the existing log_learning_with_coverage,
--   2. the reading's self-reported coverage (never 'verified' — only tests do that),
--   3. one completed, student-origin block per outcome the student named, placed in
--      the active cycle when the date falls inside it (so Calendar shows it and the
--      paper can test it), otherwise kept outside any cycle (still counts as covered).
-- Idempotent per p_idempotency_key: a repeated submit returns the first result.

create or replace function public.log_learning_entry(
  p_activity_type text,
  p_description text,
  p_lm_id text,
  p_outcome_ids text[],
  p_duration_minutes integer,
  p_local_date date,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_activity_id uuid;
  v_cycle_id uuid;
  v_n integer;
  v_minutes integer;
  v_prefix text;
  v_existing integer;
begin
  if v_user_id is null then raise exception 'Unauthorized'; end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,60}$' then
    raise exception 'Invalid idempotency key';
  end if;
  if p_lm_id is null then raise exception 'Choose a reading'; end if;
  if p_outcome_ids is null or array_length(p_outcome_ids, 1) is null or array_length(p_outcome_ids, 1) > 40 then
    raise exception 'Choose between 1 and 40 outcomes';
  end if;
  if p_local_date is null or p_local_date > current_date + 1 or p_local_date < current_date - 14 then
    raise exception 'Date must be within the last two weeks';
  end if;

  v_prefix := 'log-' || p_idempotency_key || '-';
  select count(*) into v_existing from public.plan_blocks
    where user_id = v_user_id and id like v_prefix || '%';
  if v_existing > 0 then
    return jsonb_build_object('blocks', v_existing, 'replayed', true);
  end if;

  select count(*) into v_n from public.reading_los
    where id = any(p_outcome_ids) and reading_id = p_lm_id;
  if v_n <> array_length(p_outcome_ids, 1) then
    raise exception 'Those outcomes are not all part of this reading';
  end if;

  -- History + coverage, through the existing guarded function.
  v_activity_id := public.log_learning_with_coverage(
    p_activity_type, p_description, p_lm_id, null, p_duration_minutes, null
  );

  select id into v_cycle_id from public.planning_cycles
    where user_id = v_user_id and status = 'active'
      and p_local_date between starts_at_local and ends_at_local
    limit 1;

  v_minutes := greatest(5, least(180, round(coalesce(p_duration_minutes, 30)::numeric / v_n)::integer));

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement,
    execution, local_date, day, duration_minutes, duration, lm_id, outcome_id,
    rationale, created_by
  )
  select
    v_prefix || l.id, v_user_id, v_cycle_id,
    (case p_activity_type
       when 'class' then 'Covered in class: '
       when 'external_practice' then 'Practised: '
       else 'Studied: ' end) || l.title || ' (Reading ' || r.reading_no || ')',
    '', 'study', 'student', 'core', 'day_preferred',
    'completed', p_local_date, p_local_date::text, v_minutes, v_minutes::text, p_lm_id, l.id,
    'Learning you logged yourself.', 'student'
  from public.reading_los l
  join public.curriculum_readings r on r.id = l.reading_id
  where l.id = any(p_outcome_ids) and l.reading_id = p_lm_id
  on conflict (id) do nothing;

  return jsonb_build_object(
    'activityId', v_activity_id,
    'blocks', v_n,
    'inCycle', v_cycle_id is not null,
    'replayed', false
  );
end;
$$;

revoke all on function public.log_learning_entry(text,text,text,text[],integer,date,text) from public;
revoke all on function public.log_learning_entry(text,text,text,text[],integer,date,text) from anon;
grant execute on function public.log_learning_entry(text,text,text,text[],integer,date,text) to authenticated;
