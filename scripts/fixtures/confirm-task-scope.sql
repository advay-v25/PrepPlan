-- confirm_task_scope as deployed (pg_get_functiondef), for the isolated planned-log test.
CREATE OR REPLACE FUNCTION public.confirm_task_scope(p_user_id uuid, p_task_id text, p_expected_revision integer, p_outcome_ids text[]) 
 RETURNS jsonb 
 LANGUAGE plpgsql 
 SECURITY DEFINER 
 SET search_path TO '' 
AS $function$ 
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
end; $function$ 
 
;
