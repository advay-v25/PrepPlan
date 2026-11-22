-- A split changes sittings, never duplicates a learning objective.
create table public.task_scope_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  original_task_id text not null,
  expected_parts integer not null check (expected_parts >= 2),
  original_scope jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.task_scope_groups enable row level security;
create policy task_scope_groups_read_own on public.task_scope_groups for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.task_scope_groups from public, anon, authenticated;
grant select on public.task_scope_groups to authenticated;
alter table public.plan_blocks add column scope_group_id uuid references public.task_scope_groups(id) on delete set null;
create index plan_blocks_scope_group_idx on public.plan_blocks(user_id, scope_group_id) where scope_group_id is not null;

create table public.task_split_commands (
  task_id text not null references public.plan_blocks(id) on delete cascade,
  expected_revision integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  requested_minutes integer,
  second_task_id text references public.plan_blocks(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id, expected_revision)
);
alter table public.task_split_commands enable row level security;
create policy task_split_commands_read_own on public.task_split_commands for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.task_split_commands from public, anon, authenticated;
grant select on public.task_split_commands to authenticated;
create index task_split_commands_user_idx on public.task_split_commands(user_id);

create function public.split_study_task(p_user_id uuid, p_task_id text, p_expected_revision integer, p_first_minutes integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    'revision',1,'updated_at',now(),'created_by','student'
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
end; $$;
revoke all on function public.split_study_task(uuid,text,integer,integer) from public, anon;
grant execute on function public.split_study_task(uuid,text,integer,integer) to authenticated;

-- Replace scope confirmations atomically, under the same task revision lock.
create function public.confirm_task_scope(p_user_id uuid,p_task_id text,p_expected_revision integer,p_outcome_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_task public.plan_blocks%rowtype;
  v_ids text[];
  v_old text[];
  v_before jsonb;
begin
  if auth.uid() is null or auth.uid() is distinct from p_user_id
    or not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null)
    or not exists (select 1 from public.profiles where id = auth.uid() and onboarding_status = 'complete') then
    raise exception 'Verify your account and finish setup before confirming scope.' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 1 or p_outcome_ids is null or cardinality(p_outcome_ids) > 40 or array_position(p_outcome_ids,null) is not null then
    raise exception 'Supply a valid revision and up to 40 learning outcomes.' using errcode = '22023';
  end if;
  select * into v_task from public.plan_blocks where id=p_task_id and user_id=p_user_id for update;
  if not found then raise exception 'Task not found.' using errcode = 'P0002'; end if;
  if v_task.cancelled_at is not null or v_task.execution not in ('completed','partial')
    or not exists (select 1 from public.planning_cycles where id=v_task.cycle_id and user_id=p_user_id and status='active') then
    raise exception 'Confirm completed or partly completed work in your open cycle.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct x order by x),'{}'::text[]) into v_ids from unnest(p_outcome_ids) as x;
  if exists (select 1 from unnest(v_ids) as x where not exists (
    select 1 from public.reading_los o where o.id=x and
      ((v_task.outcome_id is not null and o.id=v_task.outcome_id) or (v_task.outcome_id is null and o.reading_id=v_task.lm_id))
  )) then raise exception 'Choose only learning outcomes mapped to this task.' using errcode = '22023'; end if;
  select coalesce(array_agg(outcome_id order by outcome_id),'{}'::text[]) into v_old
    from public.block_scope_confirmations where user_id=p_user_id and block_id=p_task_id;
  if v_old = v_ids then return jsonb_build_object('ok',true,'task',to_jsonb(v_task),'confirmed',cardinality(v_ids),'replayed',true); end if;
  if v_task.revision <> p_expected_revision then
    return jsonb_build_object('ok',false,'code','REVISION_MISMATCH','current',to_jsonb(v_task));
  end if;
  v_before := to_jsonb(v_task) || jsonb_build_object('confirmed_outcomes',v_old);
  delete from public.block_scope_confirmations where block_id=p_task_id and user_id=p_user_id;
  insert into public.block_scope_confirmations(user_id,block_id,outcome_id) select p_user_id,p_task_id,x from unnest(v_ids) as x;
  update public.plan_blocks set revision=revision+1 where id=p_task_id and user_id=p_user_id returning * into v_task;
  insert into public.task_events(user_id,task_id,event_type,payload,previous) values
    (p_user_id,p_task_id,'details_changed',jsonb_build_object('kind','scope_confirmation','confirmed_outcomes',v_ids),v_before);
  return jsonb_build_object('ok',true,'task',to_jsonb(v_task),'confirmed',cardinality(v_ids),'replayed',false);
end; $$;
revoke all on function public.confirm_task_scope(uuid,text,integer,text[]) from public, anon;
grant execute on function public.confirm_task_scope(uuid,text,integer,text[]) to authenticated;
revoke insert,update,delete on public.block_scope_confirmations from anon, authenticated;
notify pgrst, 'reload schema';
