-- A learning log is exposure context, never diagnostic evidence. Keep the
-- activity and its module-coverage update atomic so planning cannot see one
-- without the other. This function never marks a module verified.
create or replace function public.log_learning_with_coverage(
  p_activity_type text,
  p_description text,
  p_lm_id text default null,
  p_related_task_id text default null,
  p_duration_minutes integer default null,
  p_self_reported_confidence text default null
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_activity_id uuid;
  v_coverage text;
  v_source text;
begin
  if v_user_id is null then raise exception 'Unauthorized'; end if;
  if p_activity_type not in ('class', 'independent_study', 'external_practice') then
    raise exception 'Invalid activity type';
  end if;
  if p_description is null or length(btrim(p_description)) < 1 or length(p_description) > 1000 then
    raise exception 'Describe what you covered in 1 to 1000 characters';
  end if;
  if p_duration_minutes is not null and (p_duration_minutes < 1 or p_duration_minutes > 720) then
    raise exception 'Invalid duration';
  end if;
  if p_self_reported_confidence is not null and
     p_self_reported_confidence not in ('low', 'medium', 'high', 'unknown') then
    raise exception 'Invalid confidence';
  end if;
  if p_lm_id is not null and not exists (
    select 1 from public.learning_modules where id = p_lm_id and is_active = true
  ) then raise exception 'Choose a current curriculum module'; end if;
  if p_related_task_id is not null and not exists (
    select 1 from public.plan_blocks where id = p_related_task_id and user_id = v_user_id
  ) then raise exception 'Invalid task reference'; end if;

  insert into public.learning_activities (
    user_id, activity_type, description, lm_id, related_task_id,
    duration_minutes, self_reported_confidence
  ) values (
    v_user_id, p_activity_type, btrim(p_description), p_lm_id,
    p_related_task_id, p_duration_minutes, p_self_reported_confidence
  ) returning id into v_activity_id;

  if p_lm_id is not null then
    v_coverage := case when p_activity_type = 'class' then 'taught' else 'studied' end;
    v_source := case when p_activity_type = 'class' then 'class' else 'self_report' end;
    insert into public.user_module_state (user_id, lm_id, coverage_state, source, updated_at)
    values (v_user_id, p_lm_id, v_coverage, v_source, now())
    on conflict (user_id, lm_id) do update set
      coverage_state = case
        when public.user_module_state.coverage_state = 'verified' then 'verified'
        when public.user_module_state.coverage_state = 'studied' and v_coverage = 'taught' then 'studied'
        else v_coverage
      end,
      source = case
        when public.user_module_state.coverage_state = 'verified' then public.user_module_state.source
        when public.user_module_state.coverage_state = 'studied' and v_coverage = 'taught' then public.user_module_state.source
        else v_source
      end,
      updated_at = now();
  end if;
  return v_activity_id;
end;
$$;

revoke all on function public.log_learning_with_coverage(text,text,text,text,integer,text) from public;
revoke all on function public.log_learning_with_coverage(text,text,text,text,integer,text) from anon;
grant execute on function public.log_learning_with_coverage(text,text,text,text,integer,text) to authenticated;
