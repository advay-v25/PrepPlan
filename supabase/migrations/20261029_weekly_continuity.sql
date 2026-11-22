-- Weekly continuity: finish one week and start the next without losing work.
--
-- Unfinished work continues as a NEW task in the next week (`continued_from_task_id`). The original keeps
-- its week, status, reported minutes, confirmations and history, and stops being actionable. Additive:
-- nothing is rewritten or backfilled, and no existing function body is altered.

-- 1. Lineage ---------------------------------------------------------------------------------------------
alter table public.plan_blocks
  add column continued_from_task_id text references public.plan_blocks(id) on delete set null,
  add column carry_intent text check (carry_intent in ('continue', 'later')),
  add column estimate_provisional boolean not null default false,
  add constraint plan_blocks_not_own_continuation check (continued_from_task_id is distinct from id);
-- A task has at most one direct successor; a longer carry-over is a chain.
create unique index plan_blocks_one_successor on public.plan_blocks(continued_from_task_id) where continued_from_task_id is not null;

-- Continuations are created only by the weekly-review command, and only forward, for the same owner.
-- Any other insert is stripped of lineage rather than rejected (see below).
create function public.guard_task_lineage() returns trigger language plpgsql set search_path = '' as $$
declare v_pred public.plan_blocks%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- Foreign-key actions (e.g. an account or cycle being deleted) run nested and may unlink.
    if pg_trigger_depth() > 1 then return new; end if;
    if new.continued_from_task_id is distinct from old.continued_from_task_id
       or new.carry_intent is distinct from old.carry_intent
       or new.estimate_provisional is distinct from old.estimate_provisional then
      raise exception 'Continuation links cannot be changed.' using errcode = '22023';
    end if;
    return new;
  end if;
  -- Outside the weekly-review command a row carries no lineage. This matters for two cases: a forged link
  -- has no effect, and a row copied from a continuation (e.g. a split sitting) is a sibling, not a second
  -- successor of the same task.
  if coalesce(current_setting('roadmap.continuation_command', true), '') <> 'on' then
    new.continued_from_task_id := null; new.carry_intent := null; new.estimate_provisional := false;
    return new;
  end if;
  if new.continued_from_task_id is null then
    new.carry_intent := null; new.estimate_provisional := false;
    return new;
  end if;
  select * into v_pred from public.plan_blocks where id = new.continued_from_task_id;
  if not found or v_pred.user_id is distinct from new.user_id then
    raise exception 'A continuation must continue one of your own tasks.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.planning_cycles a, public.planning_cycles b
    where a.id = v_pred.cycle_id and b.id = new.cycle_id and a.user_id = new.user_id and b.user_id = new.user_id
      and b.starts_at_local > a.starts_at_local
  ) then
    raise exception 'A continuation must belong to a later week than the task it continues.' using errcode = '22023';
  end if;
  return new;
end; $$;
create trigger plan_blocks_lineage before insert or update on public.plan_blocks
  for each row execute function public.guard_task_lineage();

-- A task that has been continued is history: it cannot be completed, moved, split, cancelled or deleted
-- independently, so it can never be resurrected or counted twice.
create function public.guard_superseded_task() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then return old; end if;
    if old.continued_from_task_id is not null then
      raise exception 'A continuation cannot be deleted. Remove it from the plan instead.' using errcode = '22023';
    end if;
    if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = old.id) then
      raise exception 'This task continues in a later week and can no longer be deleted.' using errcode = '22023';
    end if;
    return old;
  end if;
  if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = old.id)
     and (new.execution, new.local_date, new.starts_at, new.duration_minutes, new.placement, new.cancelled_at, new.scope_group_id, new.cycle_id, new.outcome_id, new.lm_id)
         is distinct from
         (old.execution, old.local_date, old.starts_at, old.duration_minutes, old.placement, old.cancelled_at, old.scope_group_id, old.cycle_id, old.outcome_id, old.lm_id) then
    raise exception 'This task continues in a later week and can no longer be changed.' using errcode = '22023';
  end if;
  return new;
end; $$;
create trigger plan_blocks_superseded before update or delete on public.plan_blocks
  for each row execute function public.guard_superseded_task();

-- Confirmed outcomes belong to the week they were confirmed in.
create function public.guard_confirmation_on_superseded() returns trigger language plpgsql set search_path = '' as $$
declare v_block text := coalesce(new.block_id, old.block_id);
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_block) then
    raise exception 'This task continues in a later week; its confirmed outcomes are history.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end; $$;
create trigger block_scope_confirmations_superseded before insert or update or delete on public.block_scope_confirmations
  for each row execute function public.guard_confirmation_on_superseded();

-- 2. Saved, server-owned preview ---------------------------------------------------------------------------
create table public.weekly_transition_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid not null references public.planning_cycles(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready', 'accepted', 'superseded')),
  closure_kind text not null check (closure_kind in ('paper_scored', 'no_paper')),
  no_paper_reason text,
  choices jsonb not null,
  proposal jsonb not null,
  proposal_hash text generated always as (md5(proposal::text)) stored,
  source_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '3 hours'
);
create unique index weekly_transition_one_ready on public.weekly_transition_drafts(cycle_id) where status = 'ready';
create index weekly_transition_drafts_user_idx on public.weekly_transition_drafts(user_id);
alter table public.weekly_transition_drafts enable row level security;
create policy weekly_transition_drafts_read_own on public.weekly_transition_drafts for select to authenticated
  using ((select auth.uid()) = user_id);
revoke all on public.weekly_transition_drafts from anon, authenticated;
grant select on public.weekly_transition_drafts to authenticated;

alter table public.weekly_reviews
  add column draft_id uuid references public.weekly_transition_drafts(id) on delete set null,
  add column continuations jsonb not null default '[]'::jsonb;

-- 3. Has anything this proposal depends on changed? -----------------------------------------------------
-- Hashed from the rows themselves, so the service and the acceptance command can never disagree.
create function public.weekly_source_version(p_user uuid, p_cycle uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(concat_ws(':', id, revision, execution, coalesce(cancelled_at::text, ''), coalesce(local_date::text, ''), coalesce(duration_minutes::text, '')), ',' order by id), '')
       from public.plan_blocks where user_id = p_user and cycle_id = p_cycle),
    (select coalesce(string_agg(c.block_id || ':' || c.outcome_id, ',' order by c.block_id, c.outcome_id), '')
       from public.block_scope_confirmations c where c.user_id = p_user
        and c.block_id in (select id from public.plan_blocks where user_id = p_user and cycle_id = p_cycle)),
    (select coalesce(string_agg(a.id::text || ':' || a.status, ',' order by a.id::text), '')
       from public.assessment_attempts a where a.user_id = p_user and a.cycle_id = p_cycle),
    (select coalesce(string_agg(to_jsonb(k)::text, ',' order by k.id::text), '')
       from public.calendar_commitments k where k.user_id = p_user and k.status = 'active'),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '')
       from public.availability_windows w where w.user_id = p_user and w.status = 'active'),
    (select coalesce(string_agg(to_jsonb(r)::text, ',' order by r.id::text), '')
       from public.repair_threads r where r.user_id = p_user and r.status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck')),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '')
       from public.user_module_state m where m.user_id = p_user),
    -- Which events exist AND whether each still counts: a voided or disputed answer changes the plan.
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;
revoke all on function public.weekly_source_version(uuid, uuid) from public, anon, authenticated;

-- 4. The one acceptance command ----------------------------------------------------------------------------
-- Closure answers (with history), continuations, the next week, the receipt and the closed cycle are saved
-- together or not at all. The student's request names a saved draft; it never supplies task rows.
create function public.accept_weekly_transition(p_draft_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_cycle_id uuid;
  v_cycle public.planning_cycles%rowtype;
  v_draft public.weekly_transition_drafts%rowtype;
  v_review public.weekly_reviews%rowtype;
  v_actions jsonb;
  v_next jsonb;
  v_action jsonb;
  v_task public.plan_blocks%rowtype;
  v_pred public.plan_blocks%rowtype;
  v_succ public.plan_blocks%rowtype;
  v_new_exec text;
  v_next_cycle uuid;
  v_next_start date;
  v_unknown text[] := '{}';
  v_continued jsonb := '[]'::jsonb;
  v_place date;
  v_minutes integer;
  v_paper_attempt text;
  v_succ_id text;
begin
  if v_user is null then raise exception 'Sign in to close your week.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_user and email_confirmed_at is not null) then
    raise exception 'Verify your email before using your plan.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = v_user and onboarding_status = 'complete') then
    raise exception 'Complete setup before closing your week.' using errcode = '42501';
  end if;

  -- Lock order: cycle, then draft, then tasks (by id).
  select cycle_id into v_cycle_id from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user;
  if v_cycle_id is null then raise exception 'That review could not be found.' using errcode = 'P0002'; end if;
  select * into v_cycle from public.planning_cycles where id = v_cycle_id and user_id = v_user for update;
  if not found then raise exception 'That week could not be found.' using errcode = 'P0002'; end if;
  select * into v_draft from public.weekly_transition_drafts where id = p_draft_id and user_id = v_user for update;

  select * into v_review from public.weekly_reviews where cycle_id = v_cycle_id;
  if found then
    if v_review.draft_id = p_draft_id then
      return jsonb_build_object('ok', true, 'alreadyClosed', true, 'closedCycleId', v_cycle_id, 'nextCycleId', v_review.next_cycle_id,
        'continued', coalesce(jsonb_array_length(v_review.continuations), 0));
    end if;
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  if v_draft.status <> 'ready' or v_draft.expires_at < now() then
    return jsonb_build_object('ok', false, 'code', 'DRAFT_UNAVAILABLE');
  end if;
  if v_cycle.status <> 'active' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_CLOSED');
  end if;
  -- Lock first, THEN compare: once the closing week's tasks are locked nothing can change them between the
  -- check and the writes. Availability and commitments are locked against edits too (an insert of a new row
  -- is not blocked; the next review sees it). Order is fixed: cycle, draft, tasks, then these.
  perform 1 from public.plan_blocks where cycle_id = v_cycle_id and user_id = v_user order by id for update;
  perform 1 from public.availability_windows where user_id = v_user and status = 'active' order by id for share;
  perform 1 from public.calendar_commitments where user_id = v_user and status = 'active' order by id for share;
  if public.weekly_source_version(v_user, v_cycle_id) is distinct from v_draft.source_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_PROPOSAL');
  end if;

  -- The paper gate is re-checked here, not trusted from the preview.
  select attempt_id into v_paper_attempt from public.plan_blocks
    where cycle_id = v_cycle_id and user_id = v_user and task_type = 'diagnostic' and assessment_scope->>'kind' = 'weekly_paper'
    order by local_date desc nulls last limit 1;
  if v_draft.closure_kind = 'paper_scored' then
    if not exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored'
        and (id::text = v_paper_attempt or (cycle_id = v_cycle_id and attempt_kind = 'weekly'))) then
      raise exception 'The weekly paper has not been scored.' using errcode = '22023';
    end if;
  else
    if coalesce(btrim(v_draft.no_paper_reason), '') = '' then
      raise exception 'A no-paper closure needs a reason.' using errcode = '22023';
    end if;
    if exists (select 1 from public.assessment_attempts where user_id = v_user and status = 'scored' and cycle_id = v_cycle_id and attempt_kind = 'weekly') then
      raise exception 'The paper was scored; close with the paper.' using errcode = '22023';
    end if;
  end if;

  v_actions := coalesce(v_draft.proposal->'actions', '[]'::jsonb);
  v_next := v_draft.proposal->'next';
  v_next_start := (v_next->>'starts_at_local')::date;
  if v_next_start is null or (v_next->>'ends_at_local') is null or v_next_start <= v_cycle.ends_at_local then
    raise exception 'The next week must start after this one ends.' using errcode = '22023';
  end if;

  -- Pass 1: what happened. Every change is recorded in the task's own history.
  for v_action in select * from jsonb_array_elements(v_actions) loop
    select * into v_task from public.plan_blocks where id = v_action->>'taskId' and cycle_id = v_cycle_id and user_id = v_user;
    if not found then raise exception 'A task in this review is no longer part of the week.' using errcode = '22023'; end if;
    v_new_exec := nullif(v_action->>'setExecution', '');
    if v_new_exec is not null and v_new_exec is distinct from v_task.execution then
      update public.plan_blocks set execution = v_new_exec, revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, v_new_exec, jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'cancel')::boolean, false) then
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1, updated_at = now() where id = v_task.id;
      insert into public.task_events(user_id, task_id, event_type, payload, previous)
        values (v_user, v_task.id, 'cancelled', jsonb_build_object('source', 'weekly_review', 'draftId', p_draft_id),
                jsonb_build_object('execution', v_task.execution, 'revision', v_task.revision));
    end if;
    if coalesce((v_action->>'unknown')::boolean, false) then v_unknown := v_unknown || v_task.id; end if;
  end loop;

  -- The next week. A learner may have only one active cycle, so the old one is closed first.
  update public.planning_cycles set status = 'closed', revision = revision + 1 where id = v_cycle_id;
  v_next_cycle := gen_random_uuid();
  insert into public.planning_cycles (id, user_id, starts_at, ends_at, starts_at_local, ends_at_local, timezone, status, anchor_day)
    values (v_next_cycle, v_user, now(), now() + interval '7 days', v_next_start, (v_next->>'ends_at_local')::date,
            coalesce(v_next->>'timezone', v_cycle.timezone, 'UTC'), 'active', nullif(v_next->>'anchor_day', '')::smallint);

  -- An empty week is valid: a planned break or no availability must not trap the student.
  insert into public.plan_blocks (
    id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
    duration_minutes, duration, lm_id, repair_thread_id, rationale, assessment_scope, created_by,
    concept_id, learning_objective, suggested_approach, completion_meaning
  )
  select r->>'id', v_user, v_next_cycle, r->>'title', r->>'detail', r->>'task_type', r->>'origin', r->>'priority', r->>'placement',
         r->>'execution', (r->>'local_date')::date, (r->>'day')::date, nullif(r->>'starts_at', '')::timestamptz,
         (r->>'duration_minutes')::smallint, r->>'duration', nullif(r->>'lm_id', ''), nullif(r->>'repair_thread_id', '')::uuid,
         r->>'rationale', case when jsonb_typeof(r->'assessment_scope') = 'object' then r->'assessment_scope' end, r->>'created_by',
         nullif(r->>'concept_id', '')::uuid, nullif(r->>'learning_objective', ''), nullif(r->>'suggested_approach', ''), nullif(r->>'completion_meaning', '')
  from jsonb_array_elements(coalesce(v_next->'rows', '[]'::jsonb)) as r;

  -- Pass 2: what happens next. A continuation copies PLANNING context (mapping, objective, method, guidance,
  -- split group, repair link). Everything specific to the occurrence is reset and stays with the week it
  -- belongs to: minutes and history (separate tables, never copied), confirmations, the attempt, the linked
  -- evidence event, the class session, any cancellation, and the date. Placement is exactly what the saved
  -- preview showed; nothing is scheduled again here.
  perform set_config('roadmap.continuation_command', 'on', true);
  for v_action in select * from jsonb_array_elements(v_actions) loop
    if v_action->'continuation' is null or jsonb_typeof(v_action->'continuation') <> 'object' then continue; end if;
    select * into v_pred from public.plan_blocks where id = v_action->>'taskId' and user_id = v_user;
    v_minutes := (v_action->'continuation'->>'minutes')::integer;
    v_place := nullif(v_action->'continuation'->'placement'->>'date', '')::date;
    if v_place is not null and (v_place < v_next_start or v_place > (v_next->>'ends_at_local')::date) then
      raise exception 'A placement must be inside the next week.' using errcode = '22023';
    end if;
    v_succ_id := 'task-' || gen_random_uuid()::text;
    v_succ := jsonb_populate_record(null::public.plan_blocks, to_jsonb(v_pred) || jsonb_build_object(
      'id', v_succ_id, 'cycle_id', v_next_cycle, 'execution', 'not_started', 'revision', 1, 'updated_at', now(),
      'local_date', v_place, 'starts_at', null,
      'day', coalesce(v_place, v_next_start)::text,                              -- plan_blocks.day is text NOT NULL
      'placement', case when v_place is null then 'floating' else 'day_preferred' end,
      'state', case when v_place is null then 'floating' else 'planned' end,
      'duration_minutes', v_minutes, 'duration', v_minutes::text,
      'cancelled_at', null, 'cancellation_reason', null, 'cancellation_source_id', null,
      'attempt_id', null, 'evidence_event_id', null, 'class_session_id', null, 'assessment_scope', null,
      'created_by', 'student', 'continued_from_task_id', v_pred.id,
      'carry_intent', v_action->'continuation'->>'intent',
      'estimate_provisional', coalesce((v_action->'continuation'->>'provisional')::boolean, false),
      'rationale', 'Continuing from last week. Your earlier progress and time stay with that week.'
    ));
    insert into public.plan_blocks select (v_succ).*;
    insert into public.task_events(user_id, task_id, event_type, payload, previous)
      values (v_user, v_pred.id, 'details_changed', jsonb_build_object('kind', 'continued', 'continuedAs', v_succ_id, 'draftId', p_draft_id), '{}'::jsonb),
             (v_user, v_succ_id, 'created', jsonb_build_object('continuedFrom', v_pred.id, 'draftId', p_draft_id, 'placedOn', v_place), '{}'::jsonb);
    v_continued := v_continued || jsonb_build_array(jsonb_build_object('from', v_pred.id, 'to', v_succ_id, 'date', v_place));
  end loop;

  insert into public.weekly_reviews (user_id, cycle_id, next_cycle_id, closure_kind, no_paper_reason, unknown_task_ids, recap, resolutions, draft_id, continuations)
    values (v_user, v_cycle_id, v_next_cycle, v_draft.closure_kind, nullif(btrim(v_draft.no_paper_reason), ''), v_unknown,
            coalesce(v_draft.proposal->'recap', '{}'::jsonb), v_draft.choices, p_draft_id, v_continued);
  update public.weekly_transition_drafts set status = 'accepted' where id = p_draft_id;

  return jsonb_build_object('ok', true, 'alreadyClosed', false, 'closedCycleId', v_cycle_id, 'nextCycleId', v_next_cycle,
    'continued', jsonb_array_length(v_continued));
end; $$;
revoke all on function public.accept_weekly_transition(uuid) from public, anon;
grant execute on function public.accept_weekly_transition(uuid) to authenticated;

-- The previous command accepted task rows from the caller. It stays in the database for history but can no
-- longer be called by a signed-in student, so a direct call cannot bypass the saved proposal.
do $$ begin
  if to_regprocedure('public.accept_weekly_review(uuid,text,text,jsonb,jsonb,jsonb)') is not null then
    revoke execute on function public.accept_weekly_review(uuid, text, text, jsonb, jsonb, jsonb) from authenticated;
  end if;
end $$;

notify pgrst, 'reload schema';
