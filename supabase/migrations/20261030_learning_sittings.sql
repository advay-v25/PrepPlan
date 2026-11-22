-- One external sitting, explicit coverage, one reported-time observation.
-- Historical logs/coverage are deliberately not inferred or rewritten.
alter table public.plan_blocks add column learning_activity_id uuid
  references public.learning_activities(id) deferrable initially deferred;
create unique index plan_blocks_learning_activity_unique on public.plan_blocks(learning_activity_id)
  where learning_activity_id is not null;

create table public.learning_log_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  request jsonb not null,
  result jsonb not null,
  task_id text references public.plan_blocks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key(user_id, idempotency_key)
);
alter table public.learning_log_commands enable row level security;
create policy learning_log_commands_read_own on public.learning_log_commands for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.learning_log_commands from public, anon, authenticated;
grant select on public.learning_log_commands to authenticated;

create function public.record_learning_sitting(
  p_activity_type text, p_description text, p_lm_id text, p_outcome_ids text[],
  p_duration_minutes integer, p_local_date date, p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_tz text; v_today date; v_date date; v_ids text[];
  v_request jsonb; v_result jsonb; v_receipt public.learning_log_commands%rowtype;
  v_task_id text; v_activity_id uuid; v_cycle_id uuid; v_title text; v_cancelled boolean;
begin
  if v_uid is null or not exists (select 1 from auth.users where id=v_uid and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id=v_uid and onboarding_status='complete') then
    raise exception 'Verify your email and complete setup before logging learning.' using errcode='42501';
  end if;
  if p_activity_type is null or p_activity_type not in ('class','independent_study','external_practice')
    or p_description is null or length(btrim(p_description)) not between 1 and 1000
    or p_lm_id is null or p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{8,60}$'
    or p_outcome_ids is null or cardinality(p_outcome_ids) not between 1 and 40 or array_position(p_outcome_ids,null) is not null
    or (p_duration_minutes is not null and p_duration_minutes not between 1 and 720) then
    raise exception 'Choose a reading, covered outcomes and valid minutes, or leave time unknown.' using errcode='22023';
  end if;
  select coalesce(timezone,'UTC') into v_tz from public.profiles where id=v_uid;
  v_today := (now() at time zone v_tz)::date;
  v_date := coalesce(p_local_date,v_today);
  select array_agg(distinct x order by x) into v_ids from unnest(p_outcome_ids) x;
  -- Preserve null in the canonical request: a retry after midnight still
  -- replays the original date instead of silently becoming tomorrow's study.
  v_request := jsonb_build_object('kind',p_activity_type,'description',btrim(p_description),'reading',p_lm_id,
    'outcomes',v_ids,'minutes',p_duration_minutes,'date',p_local_date);
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text || ':' || p_idempotency_key,0));
  select * into v_receipt from public.learning_log_commands where user_id=v_uid and idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request is distinct from v_request then
      return jsonb_build_object('ok',false,'code','IDEMPOTENCY_CONFLICT');
    end if;
    select cancelled_at is not null into v_cancelled from public.plan_blocks where id=v_receipt.task_id and user_id=v_uid;
    if v_receipt.task_id is null or coalesce(v_cancelled,true) then
      return jsonb_build_object('ok',false,'code','LOG_REMOVED');
    end if;
    return v_receipt.result || jsonb_build_object('replayed',true);
  end if;
  if v_date > v_today or v_date < v_today - 14 then
    raise exception 'Choose today or a date within the last 14 days.' using errcode='22023';
  end if;
  select title into v_title from public.curriculum_readings
    where id=p_lm_id and is_active and not structure_pending;
  if not found or exists (select 1 from unnest(v_ids) x where not exists (
    select 1 from public.reading_los where id=x and reading_id=p_lm_id
  )) then raise exception 'Choose outcomes from one current reading.' using errcode='22023'; end if;
  -- The cycle lock serializes against weekly closure. Historical dates outside
  -- the open cycle remain historical activity; they do not leak into its paper.
  select id into v_cycle_id from public.planning_cycles
    where user_id=v_uid and status='active' and v_date between starts_at_local and ends_at_local
    for share;
  v_task_id := 'log-' || gen_random_uuid()::text;
  insert into public.learning_activities(user_id,activity_type,description,lm_id,duration_minutes)
    values(v_uid,p_activity_type,btrim(p_description),p_lm_id,p_duration_minutes) returning id into v_activity_id;
  insert into public.plan_blocks(id,user_id,cycle_id,title,detail,day,local_date,duration,duration_minutes,
    task_type,origin,created_by,priority,placement,execution,lm_id,outcome_id,learning_activity_id,rationale)
    values(v_task_id,v_uid,v_cycle_id,
      (case p_activity_type when 'class' then 'Class: ' when 'external_practice' then 'Practised: ' else 'Studied: ' end)||v_title,
      btrim(p_description),v_date::text,v_date,'',null,'study','student','student','core','day_preferred','completed',
      p_lm_id,null,v_activity_id,'Learning already completed outside the planned work.');
  update public.learning_activities set related_task_id=v_task_id where id=v_activity_id;
  insert into public.block_scope_confirmations(user_id,block_id,outcome_id) select v_uid,v_task_id,x from unnest(v_ids) x;
  insert into public.task_events(user_id,task_id,event_type,payload,previous,actual_duration_minutes,notes)
    values(v_uid,v_task_id,'completed',jsonb_build_object('kind','learning_log','local_date',v_date,'timezone',v_tz,
      'activity_type',p_activity_type,'confirmed_outcomes',v_ids),'{}',p_duration_minutes,btrim(p_description));
  v_result := jsonb_build_object('ok',true,'taskId',v_task_id,'activityId',v_activity_id,'blocks',1,
    'outcomes',cardinality(v_ids),'date',v_date,'minutes',p_duration_minutes,'inCycle',v_cycle_id is not null,
    'evidenceRecorded',false,'replayed',false);
  insert into public.learning_log_commands(user_id,idempotency_key,request,result,task_id)
    values(v_uid,p_idempotency_key,v_request,v_result,v_task_id);
  return v_result;
end; $$;
revoke all on function public.record_learning_sitting(text,text,text,text[],integer,date,text) from public, anon;
grant execute on function public.record_learning_sitting(text,text,text,text[],integer,date,text) to authenticated;

-- Preserve the RPC name for deployed callers, with the same honest semantics.
create or replace function public.log_learning_entry(
  p_activity_type text,p_description text,p_lm_id text,p_outcome_ids text[],
  p_duration_minutes integer,p_local_date date,p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select public.record_learning_sitting(p_activity_type,p_description,p_lm_id,p_outcome_ids,p_duration_minutes,p_local_date,p_idempotency_key);
$$;
revoke all on function public.log_learning_entry(text,text,text,text[],integer,date,text) from public, anon;
grant execute on function public.log_learning_entry(text,text,text,text[],integer,date,text) to authenticated;
-- No active UI uses the old whole-reading writer. Existing records stay intact.
revoke execute on function public.log_learning_with_coverage(text,text,text,text,integer,text) from public, anon, authenticated;
revoke insert,update,delete on public.learning_activities from anon, authenticated;

create function public.cancel_learning_sitting(p_task_id text,p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=auth.uid(); v_task public.plan_blocks%rowtype; v_before jsonb;
begin
  if v_uid is null or not exists(select 1 from auth.users where id=v_uid and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where id=v_uid and onboarding_status='complete') then
    raise exception 'Complete verified setup first.' using errcode='42501';
  end if;
  select * into v_task from public.plan_blocks where id=p_task_id and user_id=v_uid for update;
  if not found or v_task.learning_activity_id is null then raise exception 'Learning log not found.' using errcode='P0002'; end if;
  if v_task.cancelled_at is not null then return jsonb_build_object('ok',true,'replayed',true); end if;
  if p_expected_revision is null or v_task.revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'code','REVISION_MISMATCH','current',to_jsonb(v_task));
  end if;
  v_before:=to_jsonb(v_task);
  update public.plan_blocks set execution='cancelled',cancelled_at=now(),cancellation_reason='Removed learning log',revision=revision+1 where id=p_task_id;
  insert into public.task_events(user_id,task_id,event_type,payload,previous)
    values(v_uid,p_task_id,'cancelled','{"kind":"learning_log_removed"}',v_before);
  return jsonb_build_object('ok',true,'replayed',false);
end; $$;
revoke all on function public.cancel_learning_sitting(text,integer) from public, anon;
grant execute on function public.cancel_learning_sitting(text,integer) to authenticated;

-- Recorded history is not a future task. Keep scope confirmation available,
-- but do not allow movement, resizing, reopening, splitting or replayed time.
create function public.protect_learning_sitting() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.learning_activity_id is null then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if not exists(select 1 from auth.users where id=old.user_id) then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if exists(select 1 from auth.users where id=old.user_id) then
      raise exception 'Remove this learning log through the logged-sitting command.' using errcode='22023';
    end if;
    return old;
  end if;
  if row(new.user_id,new.learning_activity_id,new.local_date,new.day,new.starts_at,new.duration_minutes,new.duration,
    new.lm_id,new.outcome_id,new.scope_group_id,new.continued_from_task_id,new.placement,new.cycle_id)
    is distinct from row(old.user_id,old.learning_activity_id,old.local_date,old.day,old.starts_at,old.duration_minutes,old.duration,
    old.lm_id,old.outcome_id,old.scope_group_id,old.continued_from_task_id,old.placement,old.cycle_id)
    or new.execution not in ('completed','cancelled')
    or (old.cancelled_at is not null and new.cancelled_at is null)
    or (new.execution='cancelled' and new.cancelled_at is null) then
    raise exception 'This is recorded learning. Remove an incorrect log and record it again.' using errcode='22023';
  end if;
  return new;
end; $$;
create trigger protect_learning_sitting before update or delete on public.plan_blocks
  for each row execute function public.protect_learning_sitting();

create function public.protect_learning_log_time() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.plan_blocks where id=new.task_id and learning_activity_id is not null) then
    if new.event_type='completed' and not exists(select 1 from public.task_events where task_id=new.task_id and event_type='completed') then return new; end if;
    if new.event_type in ('details_changed','cancelled') and new.actual_duration_minutes is null then return new; end if;
    raise exception 'A logged sitting has one reported-time observation.' using errcode='22023';
  end if;
  return new;
end; $$;
create trigger protect_learning_log_time before insert on public.task_events
  for each row execute function public.protect_learning_log_time();
notify pgrst,'reload schema';
