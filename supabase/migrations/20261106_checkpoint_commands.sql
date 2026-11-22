-- Phase C1: trustworthy checkpoint commands. Student-reported planning context only; none of this is assessment evidence.
--   * The checkpoint gets a stable identity (profiles.mock_id) and a version (profiles.mock_version) that every writer bumps by trigger,
--     so a request made against an old version can never clear or change a newer checkpoint.
--   * checkpoint_command() applies each command (save / cancel / choice / outcome / add suggestion / remove or keep a related task)
--     in ONE transaction, serialised per student, and stores a receipt per (student, key). Replaying a key returns the original
--     receipt even after the checkpoint was cleared; the same key with a different payload is refused.
--   * mock_outcomes becomes append-only history: planned date, actual date taken, when it was recorded, the checkpoint it belonged to,
--     and the assessment choice in force when it was recorded. The old one-row-per-planned-date rule is replaced by one-row-per-
--     (checkpoint, planned date); legacy rows keep a null checkpoint and are never rewritten or invented.
--   * checkpoint_suggestion_tasks: a server-enforced identity for "Add to my week" (one suggestion of one checkpoint -> one task).

alter table public.profiles add column if not exists mock_id uuid, add column if not exists mock_version integer not null default 0;
update public.profiles set mock_id = gen_random_uuid(), mock_version = 1 where mock_date is not null and mock_id is null;

create or replace function public.profiles_clear_mock_timing() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.mock_date is null then
    new.mock_start_time := null; new.mock_duration_minutes := null; new.mock_label := null; new.mock_id := null;
  else
    if new.mock_id is null then new.mock_id := gen_random_uuid(); new.mock_version := 1;
    elsif tg_op = 'UPDATE' and (old.mock_date, old.mock_kind, old.mock_label, old.mock_start_time, old.mock_duration_minutes)
         is distinct from (new.mock_date, new.mock_kind, new.mock_label, new.mock_start_time, new.mock_duration_minutes) then
      new.mock_version := coalesce(old.mock_version, 0) + 1;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_clear_mock_timing on public.profiles;
create trigger profiles_clear_mock_timing before insert or update on public.profiles
  for each row execute function public.profiles_clear_mock_timing();

alter table public.mock_outcomes
  add column if not exists checkpoint_id uuid,
  add column if not exists actual_date date,
  add column if not exists choice_at_record text;
alter table public.mock_outcomes drop constraint if exists mock_outcomes_user_id_planned_date_key;
alter table public.mock_outcomes drop constraint if exists mock_outcomes_actual_check;
alter table public.mock_outcomes add constraint mock_outcomes_actual_check
  check ((outcome = 'taken' or (actual_date is null and reported_result is null))
     and (choice_at_record is null or choice_at_record in ('use_mock', 'keep_paper', 'later')));
create unique index if not exists mock_outcomes_one_per_checkpoint_date
  on public.mock_outcomes (user_id, checkpoint_id, planned_date) where checkpoint_id is not null;
create index if not exists mock_outcomes_user_planned on public.mock_outcomes (user_id, planned_date);

create table if not exists public.checkpoint_commands (
  user_id uuid not null references auth.users on delete cascade,
  key text not null check (char_length(key) between 8 and 80),
  command text not null,
  payload_hash text not null,
  receipt jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
create table if not exists public.checkpoint_suggestion_tasks (
  user_id uuid not null references auth.users on delete cascade,
  checkpoint_id uuid not null,
  suggestion_id text not null check (suggestion_id in ('prepare-1', 'prepare-2', 'analyse')),
  task_id text not null references public.plan_blocks(id) on delete cascade,
  version_added integer not null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, checkpoint_id, suggestion_id)
);
alter table public.checkpoint_commands enable row level security;
alter table public.checkpoint_suggestion_tasks enable row level security;
drop policy if exists "Users read their own checkpoint commands" on public.checkpoint_commands;
create policy "Users read their own checkpoint commands" on public.checkpoint_commands for select using (auth.uid() = user_id);
drop policy if exists "Users read their own suggestion tasks" on public.checkpoint_suggestion_tasks;
create policy "Users read their own suggestion tasks" on public.checkpoint_suggestion_tasks for select using (auth.uid() = user_id);
revoke all on public.checkpoint_commands, public.checkpoint_suggestion_tasks from public, anon, authenticated;
grant select on public.checkpoint_commands, public.checkpoint_suggestion_tasks to authenticated;

-- The one weekly paper of a week (by the week's first day), and whether it can still be replaced.
create or replace function public.checkpoint_week_paper(p_user uuid, p_week_start date) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce((
    select jsonb_build_object(
      'taskId', b.id, 'revision', b.revision, 'cycleId', c.id,
      'started', (b.execution <> 'not_started' or b.attempt_id is not null or exists (
        select 1 from public.assessment_attempts a where a.user_id = p_user and a.cycle_id = c.id and a.attempt_kind = 'weekly')))
    from public.plan_blocks b join public.planning_cycles c on c.id = b.cycle_id
    where b.user_id = p_user and c.user_id = p_user and c.starts_at_local = p_week_start
      and b.task_type = 'diagnostic' and b.assessment_scope->>'kind' = 'weekly_paper' and b.cancelled_at is null and b.execution <> 'cancelled'
    order by b.local_date desc, b.id desc limit 1), 'null'::jsonb)
$$;

-- Applies a choice; returns an error object (nothing written) or null. Used by the choice and outcome commands.
create or replace function public.checkpoint_apply_choice(p_user uuid, p_week date, p_choice text, p_paper_action text) returns jsonb
language plpgsql set search_path = '' as $$
declare v_paper jsonb; v_cancelled text;
begin
  if p_choice not in ('use_mock', 'keep_paper', 'later') then return jsonb_build_object('ok', false, 'code', 'INVALID_CHOICE'); end if;
  if p_choice = 'use_mock' then
    v_paper := public.checkpoint_week_paper(p_user, p_week);
    if v_paper is not null and v_paper <> 'null'::jsonb then
      if (v_paper->>'started')::boolean then return jsonb_build_object('ok', false, 'code', 'PAPER_STARTED'); end if;
      if coalesce(p_paper_action, '') <> 'replace' then return jsonb_build_object('ok', false, 'code', 'PAPER_DECISION_REQUIRED', 'paper', v_paper); end if;
      -- Cancelled, never deleted: the task and its history stay, and the cancellation is recorded.
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1
       where id = v_paper->>'taskId' and user_id = p_user and cancelled_at is null;
      insert into public.task_events (user_id, task_id, event_type, payload, previous)
        values (p_user, v_paper->>'taskId', 'cancelled', jsonb_build_object('reason', 'replaced_by_mock'), '{}'::jsonb);
      v_cancelled := v_paper->>'taskId';
    end if;
  end if;
  insert into public.cycle_assessment_choices (user_id, week_start, choice, decided_at) values (p_user, p_week, p_choice, now())
    on conflict (user_id, week_start) do update set choice = excluded.choice, decided_at = excluded.decided_at;
  return jsonb_build_object('ok', true, 'cancelledPaperTaskId', v_cancelled);
end $$;

create or replace function public.checkpoint_command(p_user uuid, p_key text, p_command text, p_hash text, p_args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_rec public.checkpoint_commands%rowtype; v_prof public.profiles%rowtype; v_receipt jsonb; v_res jsonb;
  v_choice text; v_week date; v_task public.plan_blocks%rowtype; v_map public.checkpoint_suggestion_tasks%rowtype;
  v_new_id text; v_outcome_id uuid; v_old_date date;
begin
  -- One command at a time per student: concurrent identical requests become one effect plus a replay.
  perform pg_advisory_xact_lock(hashtextextended('checkpoint:' || p_user::text, 0));
  select * into v_rec from public.checkpoint_commands where user_id = p_user and key = p_key;
  if found then
    if v_rec.payload_hash <> p_hash or v_rec.command <> p_command then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    return v_rec.receipt || jsonb_build_object('replayed', true);
  end if;
  select * into v_prof from public.profiles where id = p_user for update;
  if not found then raise exception 'no profile for user'; end if;

  -- Every command except keep/remove-related is made against a specific checkpoint and version.
  if p_command in ('save', 'cancel', 'choice', 'outcome', 'add_suggestion') then
    if v_prof.mock_id is null then
      if p_command <> 'save' then return jsonb_build_object('ok', false, 'code', 'NO_CHECKPOINT'); end if;
      if p_args->>'checkpointId' is not null then return jsonb_build_object('ok', false, 'code', 'CHECKPOINT_CHANGED', 'currentId', null, 'currentVersion', null); end if;
    elsif (p_args->>'checkpointId') is distinct from v_prof.mock_id::text or (p_args->>'expectedVersion')::int is distinct from v_prof.mock_version then
      return jsonb_build_object('ok', false, 'code', 'CHECKPOINT_CHANGED', 'currentId', v_prof.mock_id, 'currentVersion', v_prof.mock_version);
    end if;
  end if;

  if p_command = 'save' then
    v_old_date := v_prof.mock_date;
    update public.profiles set
      mock_date = (p_args->>'date')::date, mock_kind = p_args->>'kind', mock_label = nullif(p_args->>'label', ''),
      mock_start_time = nullif(p_args->>'startTime', '')::time, mock_duration_minutes = nullif(p_args->>'durationMinutes', '')::smallint,
      onboarding_context_version = coalesce(onboarding_context_version, 1) + 1
     where id = p_user returning * into v_prof;
    if v_old_date is not null and v_old_date <> v_prof.mock_date and (p_args->>'oldWeekStart') is not null then
      delete from public.cycle_assessment_choices where user_id = p_user and week_start = (p_args->>'oldWeekStart')::date;
    end if;
    v_receipt := jsonb_build_object('ok', true, 'command', 'save', 'checkpointId', v_prof.mock_id, 'version', v_prof.mock_version);

  elsif p_command = 'cancel' then
    update public.profiles set mock_date = null, mock_kind = null, onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    delete from public.cycle_assessment_choices where user_id = p_user and week_start = (p_args->>'weekStart')::date;
    v_receipt := jsonb_build_object('ok', true, 'command', 'cancel', 'cancelledId', v_prof.mock_id);

  elsif p_command = 'choice' then
    v_res := public.checkpoint_apply_choice(p_user, (p_args->>'weekStart')::date, p_args->>'choice', p_args->>'paperAction');
    if not (v_res->>'ok')::boolean then return v_res; end if;
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', 'choice', 'choice', p_args->>'choice', 'weekStart', p_args->>'weekStart', 'cancelledPaperTaskId', v_res->>'cancelledPaperTaskId');

  elsif p_command = 'outcome' then
    v_week := (p_args->>'weekStart')::date;
    if p_args->>'outcome' not in ('taken', 'postponed', 'not_taken') then return jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME'); end if;
    if p_args->>'outcome' = 'taken' and ((p_args->>'actualDate') is null or (p_args->>'actualDate')::date > (p_args->>'today')::date) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ACTUAL_DATE'); end if;
    if p_args->>'outcome' <> 'taken' and (nullif(p_args->>'result', '') is not null or (p_args->>'actualDate') is not null) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_RESULT'); end if;
    select choice into v_choice from public.cycle_assessment_choices where user_id = p_user and week_start = v_week;
    -- A choice offered together with the outcome is only applied while the week is still undecided.
    if (p_args->>'choice') is not null and coalesce(v_choice, 'later') = 'later' then
      v_res := public.checkpoint_apply_choice(p_user, v_week, p_args->>'choice', p_args->>'paperAction');
      if not (v_res->>'ok')::boolean then return v_res; end if;
      v_choice := p_args->>'choice';
    end if;
    insert into public.mock_outcomes (user_id, checkpoint_id, planned_date, kind, label, outcome, reported_result, notes, actual_date, choice_at_record)
      values (p_user, v_prof.mock_id, v_prof.mock_date, v_prof.mock_kind, v_prof.mock_label, p_args->>'outcome',
              nullif(p_args->>'result', ''), nullif(p_args->>'notes', ''), nullif(p_args->>'actualDate', '')::date, coalesce(v_choice, 'later'))
      returning id into v_outcome_id;
    if p_args->>'outcome' = 'postponed' and (p_args->>'newDate') is not null then
      update public.profiles set mock_date = (p_args->>'newDate')::date where id = p_user;
      delete from public.cycle_assessment_choices where user_id = p_user and week_start = v_week;
    else
      update public.profiles set mock_date = null, mock_kind = null where id = p_user;
      delete from public.cycle_assessment_choices where user_id = p_user and week_start = v_week;
    end if;
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', 'outcome', 'outcomeId', v_outcome_id, 'outcome', p_args->>'outcome',
      'plannedDate', v_prof.mock_date, 'choice', coalesce(v_choice, 'later'), 'moved', (p_args->>'outcome' = 'postponed' and (p_args->>'newDate') is not null));

  elsif p_command = 'add_suggestion' then
    select * into v_map from public.checkpoint_suggestion_tasks where user_id = p_user and checkpoint_id = v_prof.mock_id and suggestion_id = p_args->>'suggestionId';
    if found then
      select * into v_task from public.plan_blocks where id = v_map.task_id;
      if v_task.cancelled_at is null and v_task.execution <> 'cancelled' then
        v_receipt := jsonb_build_object('ok', true, 'command', 'add_suggestion', 'taskId', v_map.task_id, 'alreadyAdded', true);
        insert into public.checkpoint_commands (user_id, key, command, payload_hash, receipt) values (p_user, p_key, p_command, p_hash, v_receipt);
        return v_receipt;
      end if;
      delete from public.checkpoint_suggestion_tasks where user_id = p_user and checkpoint_id = v_prof.mock_id and suggestion_id = p_args->>'suggestionId';
    end if;
    v_new_id := 'ckpt-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
                                    duration_minutes, duration, rationale, is_protected_commitment, created_by)
      values (v_new_id, p_user, (p_args->>'cycleId')::uuid, p_args->>'title', coalesce(p_args->>'detail', ''), 'review', 'student', 'optional',
              case when nullif(p_args->>'startsAt', '') is null then 'day_preferred' else 'timed' end, 'not_started',
              (p_args->>'date')::date, (p_args->>'date')::date, nullif(p_args->>'startsAt', '')::timestamptz,
              (p_args->>'minutes')::smallint, p_args->>'minutes', 'You added this from your mock checkpoint suggestions.', false, 'student');
    insert into public.task_events (user_id, task_id, event_type, payload, previous)
      values (p_user, v_new_id, 'created', jsonb_build_object('source', 'checkpoint_suggestion', 'suggestion', p_args->>'suggestionId', 'checkpointId', v_prof.mock_id), '{}'::jsonb);
    insert into public.checkpoint_suggestion_tasks (user_id, checkpoint_id, suggestion_id, task_id, version_added)
      values (p_user, v_prof.mock_id, p_args->>'suggestionId', v_new_id, v_prof.mock_version);
    v_receipt := jsonb_build_object('ok', true, 'command', 'add_suggestion', 'taskId', v_new_id, 'alreadyAdded', false);

  elsif p_command = 'remove_related' then
    select m.* into v_map from public.checkpoint_suggestion_tasks m where m.user_id = p_user and m.task_id = p_args->>'taskId';
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_RELATED'); end if;
    select * into v_task from public.plan_blocks where id = v_map.task_id and user_id = p_user for update;
    if v_task.cancelled_at is not null then
      v_receipt := jsonb_build_object('ok', true, 'command', 'remove_related', 'taskId', v_task.id, 'alreadyRemoved', true);
    elsif v_task.execution not in ('not_started', 'deferred') then return jsonb_build_object('ok', false, 'code', 'TASK_STARTED');
    elsif v_task.revision is distinct from (p_args->>'expectedRevision')::int then return jsonb_build_object('ok', false, 'code', 'REVISION_MISMATCH');
    else
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1 where id = v_task.id;
      insert into public.task_events (user_id, task_id, event_type, payload, previous)
        values (p_user, v_task.id, 'cancelled', jsonb_build_object('reason', 'checkpoint_changed'), '{}'::jsonb);
      v_receipt := jsonb_build_object('ok', true, 'command', 'remove_related', 'taskId', v_task.id, 'alreadyRemoved', false);
    end if;

  elsif p_command = 'keep_related' then
    update public.checkpoint_suggestion_tasks set reviewed_at = now() where user_id = p_user and task_id = p_args->>'taskId';
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_RELATED'); end if;
    v_receipt := jsonb_build_object('ok', true, 'command', 'keep_related', 'taskId', p_args->>'taskId');

  else
    return jsonb_build_object('ok', false, 'code', 'UNKNOWN_COMMAND');
  end if;

  insert into public.checkpoint_commands (user_id, key, command, payload_hash, receipt) values (p_user, p_key, p_command, p_hash, v_receipt);
  return v_receipt;
end $$;

revoke all on function public.checkpoint_week_paper(uuid, date) from public, anon, authenticated;
revoke all on function public.checkpoint_apply_choice(uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.checkpoint_command(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.checkpoint_week_paper(uuid, date) to service_role;
grant execute on function public.checkpoint_apply_choice(uuid, date, text, text) to service_role;
grant execute on function public.checkpoint_command(uuid, text, text, text, jsonb) to service_role;

create or replace function public.weekly_source_version(p_user uuid, p_cycle uuid) returns text
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
    (select coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id::text), '')
       from public.commitment_exceptions x where x.user_id = p_user),
    (select coalesce(string_agg(to_jsonb(e)::text, ',' order by e.id::text), '')
       from public.exam_attempts e where e.user_id = p_user and e.status = 'active'),
    (select p.classes_completed_at::text from public.profiles p where p.id = p_user),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '')
       from public.availability_windows w where w.user_id = p_user and w.status = 'active'),
    (select coalesce(string_agg(to_jsonb(r)::text, ',' order by r.id::text), '')
       from public.repair_threads r where r.user_id = p_user and r.status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck')),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '')
       from public.user_module_state m where m.user_id = p_user),
    (select coalesce(string_agg(u.topic_id || ':' || u.level || ':' || array_to_string(u.lm_ids, '+'), ',' order by u.topic_id), '')
       from public.user_entry_uncertainty u where u.user_id = p_user),
    (select coalesce(string_agg(c.week_start::text || ':' || c.choice, ',' order by c.week_start), '')
       from public.cycle_assessment_choices c where c.user_id = p_user),
    (select coalesce(string_agg(o.id::text || ':' || o.outcome || ':' || coalesce(o.actual_date::text, ''), ',' order by o.id::text), '')
       from public.mock_outcomes o where o.user_id = p_user),
    (select coalesce(string_agg(s.suggestion_id || ':' || s.task_id, ',' order by s.suggestion_id, s.task_id), '')
       from public.checkpoint_suggestion_tasks s where s.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone', j->>'stage', j->>'mock_date', j->>'mock_kind',
                      j->>'mock_start_time', j->>'mock_duration_minutes', j->>'mock_label', j->>'mock_version')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;
