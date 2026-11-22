-- A reviewed current-week plan shares the existing per-student scope lock with its input writers.
-- Parent-row commands take it before their row locks to keep the lock order consistent.
do $$
declare f record; d text;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in
      ('onboarding_commit_step','accept_onboarding_preview','accept_weekly_transition','checkpoint_command','record_exam_status')
  loop
    d := pg_get_functiondef(f.oid);
    if position('-- current-week serialization' in d)=0 then
      d := regexp_replace(d, '\mbegin\M',
        E'begin\n  -- current-week serialization\n  perform public.scope_lock(' ||
        case when f.proname in ('accept_onboarding_preview','accept_weekly_transition') then 'auth.uid()' else 'p_user' end || ');', 'i');
      if position('-- current-week serialization' in d)=0 then raise exception 'Could not add lock to %',f.proname; end if;
      execute d;
    end if;
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['calendar_commitments','commitment_exceptions','availability_windows','planning_cycles',
    'study_roadmaps','mock_appointments','user_topic_exposure','user_entry_uncertainty','task_events','assessment_attempts','exam_completion'] loop
    execute format('drop trigger if exists scope_write_lock on public.%I', t);
    execute format('create trigger scope_write_lock before insert or update or delete on public.%I for each row execute function public.scope_write_lock()', t);
  end loop;
end $$;

create or replace function public.current_week_source_hash(p_user uuid, p_cycle uuid) returns text
language sql stable set search_path=public,pg_temp as $$
  select md5(jsonb_build_object(
    'cycle', (select to_jsonb(c) from public.planning_cycles c where id=p_cycle and user_id=p_user),
    'profile', (select jsonb_build_array(onboarding_context_version,timezone,exam_date,exam_window_id,prep_mode,class_pattern,
        stage,max_session_minutes,classes_completed_at,week_availability_mode) from public.profiles where id=p_user),
    'plan_blocks', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.plan_blocks r where user_id=p_user), '[]'::jsonb),
    'task_events', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.task_events r where user_id=p_user), '[]'::jsonb),
    'calendar_commitments', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.calendar_commitments r where user_id=p_user), '[]'::jsonb),
    'commitment_exceptions', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.commitment_exceptions r where user_id=p_user), '[]'::jsonb),
    'availability_windows', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.availability_windows r where user_id=p_user), '[]'::jsonb),
    'class_sessions', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.class_sessions r where user_id=p_user), '[]'::jsonb),
    'user_module_state', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.user_module_state r where user_id=p_user), '[]'::jsonb),
    'user_topic_exposure', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.user_topic_exposure r where user_id=p_user), '[]'::jsonb),
    'user_entry_uncertainty', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.user_entry_uncertainty r where user_id=p_user), '[]'::jsonb),
    'block_scope_confirmations', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.block_scope_confirmations r where user_id=p_user), '[]'::jsonb),
    'repair_threads', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.repair_threads r where user_id=p_user), '[]'::jsonb),
    'evidence_events', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.evidence_events r where user_id=p_user), '[]'::jsonb),
    'assessment_attempts', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.assessment_attempts r where user_id=p_user), '[]'::jsonb),
    'mock_appointments', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.mock_appointments r where user_id=p_user), '[]'::jsonb),
    'study_roadmaps', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.study_roadmaps r where user_id=p_user), '[]'::jsonb),
    'exam_completion', coalesce((select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.exam_completion r where user_id=p_user), '[]'::jsonb),
    'class_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from public.class_session_items i
      join public.class_sessions c on c.id=i.session_id where c.user_id=p_user),'[]'::jsonb)
  )::text);
$$;

-- The same local intervals Calendar uses, with overlapping study windows counted once.
create function public.current_week_available_minutes(p_user uuid,p_date date,p_zone text,p_now timestamptz default now())
returns integer language sql stable set search_path=public,pg_temp as $$
with ranges as (
  select coalesce(range_agg(int4range((extract(hour from start_time)*60+extract(minute from start_time))::int,
    (extract(hour from end_time)*60+extract(minute from end_time))::int,'[)')),'{}'::int4multirange) as available
  from public.availability_windows where user_id=p_user and status='active' and weekday=extract(dow from p_date)::int
), weekly as (
  select c.*, d.original_date, e.kind as exception_kind,e.new_date,e.new_start_time,e.new_end_time
  from public.calendar_commitments c
  cross join lateral (select p_date as original_date union select x.occurrence_date from public.commitment_exceptions x
    where x.commitment_id=c.id and x.user_id=p_user and x.kind='moved' and x.new_date=p_date) d
  left join public.commitment_exceptions e on e.commitment_id=c.id and e.occurrence_date=d.original_date and e.user_id=p_user
  where c.user_id=p_user and c.status='active' and c.is_protected and c.recurrence='weekly'
    and extract(dow from d.original_date)::int=any(c.weekdays)
    and (c.starts_on is null or d.original_date>=c.starts_on) and (c.ends_on is null or d.original_date<=c.ends_on)
    and c.start_time is not null and c.end_time is not null and coalesce(e.kind,'')<>'skipped'
), occurrences as (
  select coalesce(new_date,original_date) as day,
    (extract(hour from coalesce(new_start_time,start_time))*60+extract(minute from coalesce(new_start_time,start_time)))::int as start_min,
    case when exception_kind='moved' and new_end_time is not null
      then (extract(hour from new_end_time)*60+extract(minute from new_end_time))::int
      else (extract(hour from coalesce(new_start_time,start_time))*60+extract(minute from coalesce(new_start_time,start_time)))::int
        +greatest(15,(extract(epoch from (end_time-start_time))/60)::int) end as end_min
  from weekly
), blockers as (
  select int4range(greatest(0,start_min),least(1440,end_min),'[)') as span from occurrences where day=p_date and end_min>start_min
  union all
  select int4range(
    case when c.starts_at <= p_date::timestamp at time zone p_zone then 0
      else floor(extract(epoch from (c.starts_at at time zone p_zone)::time)/60)::int end,
    case when c.ends_at >= (p_date+1)::timestamp at time zone p_zone then 1440
      else ceil(extract(epoch from (c.ends_at at time zone p_zone)::time)/60)::int end,'[)')
  from public.calendar_commitments c where c.user_id=p_user and c.status='active' and c.is_protected and c.recurrence='none'
    and c.starts_at < (p_date+1)::timestamp at time zone p_zone and c.ends_at > p_date::timestamp at time zone p_zone
  union all
  select int4range((extract(hour from start_time)*60+extract(minute from start_time))::int,
    least(1440,(extract(hour from start_time)*60+extract(minute from start_time))::int+duration_minutes),'[)')
  from public.mock_appointments where user_id=p_user and planned_date=p_date and status='planned' and start_time is not null and duration_minutes>0
), free as (
  select available-coalesce((select range_agg(span) from blockers),'{}'::int4multirange) as spans from ranges
), remaining as (
  select spans * int4multirange(int4range(
    case when p_date>(p_now at time zone p_zone)::date then 0
      when p_date<(p_now at time zone p_zone)::date then 1440
      else least(1440,ceil(extract(epoch from (p_now at time zone p_zone)::time)/60)::int) end,1440,'[)')) as spans from free
)
select coalesce(sum(upper(r)-lower(r)),0)::int from remaining,lateral unnest(spans) r;
$$;
revoke all on function public.current_week_available_minutes(uuid,date,text,timestamptz) from public,anon,authenticated;
grant execute on function public.current_week_available_minutes(uuid,date,text,timestamptz) to service_role;

-- Read-only validity is also used when deciding whether a saved preview can be reused.
create function public.current_week_proposal_problem(p_user uuid,p_draft uuid,p_now timestamptz default now())
returns text language plpgsql stable set search_path=public,pg_temp as $$
declare d public.plan_drafts%rowtype; c public.planning_cycles%rowtype; v_today date; t jsonb; r record;
begin
  select * into d from public.plan_drafts where id=p_draft and user_id=p_user and purpose='current_week_plan';
  if not found then return 'NOT_FOUND'; end if;
  select * into c from public.planning_cycles where id=d.cycle_id and user_id=p_user;
  if not found or c.status<>'active' then return 'CYCLE_CHANGED'; end if;
  v_today := (p_now at time zone coalesce(c.timezone,'UTC'))::date;
  if c.ends_at_local<v_today then return 'CYCLE_ENDED'; end if;
  if (d.draft_json->>'planning_date')::date is distinct from v_today
    or d.cycle_start_date is distinct from c.starts_at_local or d.cycle_end_date is distinct from c.ends_at_local
    or d.timezone is distinct from coalesce(c.timezone,'UTC')
    or d.context_fingerprint is distinct from public.current_week_source_hash(p_user,c.id) then return 'STALE_PROPOSAL'; end if;
  if jsonb_typeof(d.draft_json->'tasks') is distinct from 'array' or jsonb_array_length(d.draft_json->'tasks')=0 then return 'INVALID_PROPOSAL'; end if;
  for t in select value from jsonb_array_elements(d.draft_json->'tasks') loop
    if (t->>'scheduled_date')::date is null or (t->>'scheduled_date')::date<c.starts_at_local or (t->>'scheduled_date')::date>c.ends_at_local
      or (t->>'scheduled_date')::date<v_today or coalesce((t->>'duration_minutes')::int,0)<=0 then return 'INVALID_PROPOSAL'; end if;
  end loop;
  for r in select (x->>'scheduled_date')::date as day,sum((x->>'duration_minutes')::int) as minutes
    from jsonb_array_elements(d.draft_json->'tasks') x where coalesce(x->'metadata'->>'task_type','study') not in ('diagnostic','mock','admin')
    group by (x->>'scheduled_date')::date loop
    if r.minutes>public.current_week_available_minutes(p_user,r.day,coalesce(c.timezone,'UTC'),p_now) then return 'STALE_PROPOSAL'; end if;
  end loop;
  return null;
exception when data_exception then return 'INVALID_PROPOSAL';
end $$;
revoke all on function public.current_week_proposal_problem(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.current_week_proposal_problem(uuid,uuid,timestamptz) to service_role;
create or replace function public.accept_current_week_plan(p_draft_id uuid, p_expected_revision integer)
returns json language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid(); v_draft public.plan_drafts%rowtype; v_cycle public.planning_cycles%rowtype;
  v_today date; v_added integer; v_version integer; v_problem text; v_now timestamptz;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where id=v_user and onboarding_status='complete')
    or not public.is_beta_admitted(v_user) then raise exception 'Application access required' using errcode='42501'; end if;
  perform public.scope_lock(v_user);
  select * into v_draft from public.plan_drafts where id = p_draft_id for update;
  if not found then raise exception 'Draft not found'; end if;
  if v_draft.user_id <> v_user or v_draft.purpose <> 'current_week_plan' then raise exception 'Unauthorized'; end if;

  if v_draft.status = 'accepted' then
    return (v_draft.draft_json->'receipt')::json;
  end if;
  if v_draft.status <> 'ready' then raise exception 'STALE_PROPOSAL: this proposal is no longer open'; end if;
  if v_draft.revision <> p_expected_revision then raise exception 'STALE_PROPOSAL: stale revision'; end if;

  -- Same lock order as a setup edit (profile first), so an edit and this acceptance serialise one way or the other.
  select onboarding_context_version into v_version from public.profiles where id = v_user for update;
  select * into v_cycle from public.planning_cycles where id = v_draft.cycle_id and user_id = v_user for update;
  if not found or v_cycle.status <> 'active' then raise exception 'CYCLE_CHANGED: the cycle this proposal was for is no longer the active one'; end if;
  v_now := clock_timestamp();
  v_today := (v_now at time zone coalesce(v_cycle.timezone, 'UTC'))::date;
  if v_cycle.ends_at_local < v_today then raise exception 'CYCLE_ENDED: this cycle has ended; plan the next week in the weekly review'; end if;
  if (v_draft.draft_json->>'planning_date')::date <> v_today then raise exception 'STALE_PROPOSAL: the day changed since this was prepared'; end if;
  if v_draft.onboarding_context_version is distinct from v_version then raise exception 'STALE_PROPOSAL: your setup changed'; end if;
  v_problem := public.current_week_proposal_problem(v_user,p_draft_id,clock_timestamp());
  if v_problem is not null then raise exception '%',v_problem; end if;

  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at, duration_minutes,
    duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by, learning_objective, suggested_approach, completion_meaning)
  select coalesce(t->>'id', 'task-' || gen_random_uuid()::text), v_user, v_cycle.id, t->>'title',
    coalesce(t->'metadata'->>'detail', ''), coalesce(t->'metadata'->>'task_type', 'study'), coalesce(t->'metadata'->>'origin', 'planner'),
    coalesce(t->'metadata'->>'priority', 'core'), coalesce(t->'metadata'->>'placement', 'day_preferred'), 'not_started',
    (t->>'scheduled_date')::date, (t->>'scheduled_date')::date, nullif(t->'metadata'->>'starts_at', '')::timestamptz,
    (t->>'duration_minutes')::smallint, coalesce(t->>'duration_minutes', '0'), nullif(t->'metadata'->>'lm_id', ''),
    nullif(t->'metadata'->>'repair_thread_id', '')::uuid, coalesce(t->'metadata'->>'rationale', ''),
    case when jsonb_typeof(t->'metadata'->'assessment_scope') = 'object' then t->'metadata'->'assessment_scope' end, 'algorithm',
    nullif(t->'metadata'->>'learning_objective', ''), nullif(t->'metadata'->>'suggested_approach', ''), nullif(t->'metadata'->>'completion_meaning', '')
  from jsonb_array_elements(coalesce(v_draft.draft_json->'tasks', '[]'::jsonb)) t
;
  get diagnostics v_added = row_count;

  update public.plan_drafts set status = 'accepted', accepted_cycle_id = v_cycle.id, revision = revision + 1, updated_at = now(),
    draft_json = jsonb_set(draft_json, '{receipt}', jsonb_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', true))
  where id = p_draft_id;
  return json_build_object('cycle_id', v_cycle.id, 'tasks_added', v_added, 'draft_id', p_draft_id, 'replayed', false);
end $$;
revoke all on function public.accept_current_week_plan(uuid, integer) from public, anon;
grant execute on function public.accept_current_week_plan(uuid, integer) to authenticated;

-- Dismissal and acceptance serialize on the same proposal. A lost response can safely be retried.
create function public.dismiss_current_week_plan(p_draft_id uuid,p_expected_revision integer) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid(); d public.plan_drafts%rowtype; v_problem text;
begin
  if v_user is null or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null)
    or not exists(select 1 from public.profiles where id=v_user and onboarding_status='complete')
    or not public.is_beta_admitted(v_user) then raise exception 'Application access required' using errcode='42501'; end if;
  perform public.scope_lock(v_user);
  select * into d from public.plan_drafts where id=p_draft_id and user_id=v_user and purpose='current_week_plan' for update;
  if not found then return jsonb_build_object('ok',false,'code','NOT_FOUND'); end if;
  if d.status='accepted' then return jsonb_build_object('ok',true,'outcome','accepted','receipt',d.draft_json->'receipt'); end if;
  if d.status='discarded' then return jsonb_build_object('ok',true,'outcome','already_dismissed'); end if;
  if d.status<>'ready' or d.revision is distinct from p_expected_revision then return jsonb_build_object('ok',false,'code','STALE_PROPOSAL'); end if;
  v_problem:=public.current_week_proposal_problem(v_user,p_draft_id,clock_timestamp());
  if v_problem is not null then return jsonb_build_object('ok',false,'code',v_problem); end if;
  update public.plan_drafts set status='discarded',revision=revision+1,updated_at=now() where id=d.id;
  return jsonb_build_object('ok',true,'outcome','dismissed');
end $$;
revoke all on function public.dismiss_current_week_plan(uuid,integer) from public,anon;
grant execute on function public.dismiss_current_week_plan(uuid,integer) to authenticated;
