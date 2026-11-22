-- The generic task command no longer lets the student represent a diagnostic paper or a repair re-check as done, started or partly done.
-- Those are completed by the attempt and scoring flows. Otherwise identical to 20261028.
create or replace function public.set_task_execution(
  p_user_id uuid,
  p_task_id text,
  p_expected_revision integer,
  p_execution text,
  p_actual_duration_minutes integer default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_task public.plan_blocks%rowtype;
  v_before jsonb;
  v_request jsonb;
  v_receipt public.task_execution_commands%rowtype;
  v_event_id uuid;
  v_event_type text;
begin
  if v_user_id is null or v_user_id is distinct from p_user_id then
    raise exception 'Sign in to update your task.' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = v_user_id and email_confirmed_at is not null) then
    raise exception 'Verify your email before using your plan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_user_id and onboarding_status = 'complete') then
    raise exception 'Complete setup before updating your plan.' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1
    or p_execution is null or p_execution not in ('not_started', 'in_progress', 'partial', 'completed', 'skipped', 'deferred')
    or (p_actual_duration_minutes is not null and p_actual_duration_minutes not between 0 and 1440)
    or (p_note is not null and length(p_note) > 2000) then
    raise exception 'Invalid task execution input.' using errcode = '22023';
  end if;

  -- Lock only the owned task. Concurrent retries serialize here; another
  -- learner cannot discover the task, its receipt or its current revision.
  select * into v_task from public.plan_blocks
    where id = p_task_id and user_id = v_user_id for update;
  if not found then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  -- A paper or a repair re-check is completed by being taken and scored, never by the student marking the task done: this command cannot
  -- represent one as finished, started or partly done. (Deferring or skipping it is still a statement the student can make.)
  if v_task.task_type in ('diagnostic', 'recheck') and p_execution in ('completed', 'partial', 'in_progress') then
    raise exception 'SYSTEM_ASSESSMENT: a % is completed by taking and scoring it, not by marking it done', case v_task.task_type when 'diagnostic' then 'paper' else 'check' end using errcode = '22023';
  end if;
  v_request := jsonb_build_object('execution', p_execution,
    'actual_duration_minutes', p_actual_duration_minutes, 'note', p_note);
  select * into v_receipt from public.task_execution_commands
    where task_id = p_task_id and expected_revision = p_expected_revision and user_id = v_user_id;
  if found then
    if v_receipt.request = v_request then
      return jsonb_build_object('ok', true, 'replayed', true, 'task', to_jsonb(v_task), 'eventId', v_receipt.event_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH', 'current', to_jsonb(v_task));
  end if;
  if v_task.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH', 'current', to_jsonb(v_task));
  end if;
  if v_task.execution = 'cancelled' then
    raise exception 'This task was cancelled. Review its origin before restoring it.' using errcode = '22023';
  end if;

  v_before := jsonb_build_object('local_date', v_task.local_date, 'starts_at', v_task.starts_at,
    'duration_minutes', v_task.duration_minutes, 'placement', v_task.placement,
    'execution', v_task.execution, 'revision', v_task.revision);
  -- Every accepted execution command advances the revision, even recording
  -- actual time against an otherwise unchanged state. The existing revision
  -- trigger also sets this to old+1 (it does not increment it twice).
  update public.plan_blocks set execution = p_execution, revision = revision + 1
    where id = p_task_id and user_id = v_user_id returning * into v_task;
  v_event_type := case p_execution
    when 'not_started' then 'undone' when 'in_progress' then 'started'
    else p_execution end;
  insert into public.task_events(user_id, task_id, event_type, payload, previous, actual_duration_minutes, notes)
    values (v_user_id, p_task_id, v_event_type,
      jsonb_build_object('execution', p_execution, 'note', p_note), v_before, p_actual_duration_minutes, p_note)
    returning id into v_event_id;
  insert into public.task_execution_commands(task_id, expected_revision, user_id, request, event_id)
    values (p_task_id, p_expected_revision, v_user_id, v_request, v_event_id);
  -- No evidence, confidence, curriculum scope or calendar redistribution is
  -- guessed here. Only the task and its factual activity history are committed.
  return jsonb_build_object('ok', true, 'replayed', false, 'task', to_jsonb(v_task), 'eventId', v_event_id);
end;
$$;
revoke all on function public.set_task_execution(uuid, text, integer, text, integer, text) from public, anon;
grant execute on function public.set_task_execution(uuid, text, integer, text, integer, text) to authenticated;
