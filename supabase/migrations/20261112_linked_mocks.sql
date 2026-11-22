-- Phase 5: scope-lock protocol, canonical mock appointments, linked two-session rehearsals, exam completion.
-- Additive. Nothing historical is rewritten: the existing checkpoint keeps its id, version, outcome history, choices and related tasks.
--
--  1. Scope lock protocol. Every writer of the rows `paper_scope_source` reads takes ONE per-student advisory lock (a trigger), held
--     to the end of its transaction. A reservation takes the same lock BEFORE it reads the source, so a confirmation either commits
--     first (the reservation then sees the change and refuses with SCOPE_CHANGED) or waits until the reservation is done.
--  2. mock_appointments is the canonical schedule (internal rehearsals and external mocks, several per student). profiles.mock_* is a
--     PROJECTION of the next planned appointment; a legacy writer of those columns is translated into an edit of that appointment.
--  3. mock_rehearsals + linked session forms/attempts: two pinned 90-question forms, two 135-minute attempts, each clock started only
--     by an explicit start. The held-out exception exists ONLY inside start_rehearsal (service role) through a transaction-local setting.
--  4. exam_completion: the student's own "I sat the exam" record and optional follow-up. Never inferred, never a result.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Scope lock protocol
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function public.scope_lock(p_user uuid) returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('scope:' || p_user::text, 0))
$$;
create or replace function public.scope_write_lock() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  v_user := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  if v_user is not null then perform public.scope_lock(v_user); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create or replace function public.scope_write_lock_items() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select s.user_id into v_user from public.class_sessions s where s.id = case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  if v_user is not null then perform public.scope_lock(v_user); end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
do $$
declare t text;
begin
  foreach t in array array['plan_blocks', 'block_scope_confirmations', 'class_sessions', 'user_module_state', 'evidence_events'] loop
    execute format('drop trigger if exists scope_write_lock on public.%I', t);
    execute format('create trigger scope_write_lock before insert or update or delete on public.%I for each row execute function public.scope_write_lock()', t);
  end loop;
  drop trigger if exists scope_write_lock on public.class_session_items;
  create trigger scope_write_lock before insert or update or delete on public.class_session_items for each row execute function public.scope_write_lock_items();
end $$;

-- The reservation takes the lock first, then compares. (FOR SHARE on the plan rows is gone: it did not cover confirmations, which
-- reference a block with a key-share lock only, and mixing it with the advisory lock would invite lock-order deadlocks.)
do $$
declare d text;
begin
  select pg_get_functiondef('public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean, text)'::regprocedure) into d;
  if position('perform public.scope_lock(p_user)' in d) = 0 then
    d := replace(d, 'perform 1 from public.plan_blocks where user_id = p_user order by id for share;', 'perform public.scope_lock(p_user);');
    if position('perform public.scope_lock(p_user)' in d) = 0 then raise exception 'start_assessment_paper patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Canonical appointments
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_mock_kind_check;
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.profiles'::regclass and pg_get_constraintdef(oid) like '%mock_kind = ANY%' loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;
alter table public.profiles add constraint profiles_mock_kind_check check (
  (mock_date is null and mock_kind is null) or (mock_date is not null and mock_kind in ('provider_mock', 'school_checkpoint', 'other', 'internal_rehearsal')));
alter table public.mock_outcomes drop constraint if exists mock_outcomes_kind_check;
alter table public.mock_outcomes add constraint mock_outcomes_kind_check check (kind in ('provider_mock', 'school_checkpoint', 'other', 'internal_rehearsal'));

create table if not exists public.mock_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('provider_mock', 'school_checkpoint', 'other', 'internal_rehearsal')),
  planned_date date not null,
  start_time time,
  duration_minutes smallint check (duration_minutes is null or duration_minutes between 15 and 600),
  label text check (label is null or char_length(label) between 1 and 80),
  status text not null default 'planned' check (status in ('planned', 'completed', 'cancelled', 'postponed', 'missed')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mock_appointments_user_date on public.mock_appointments (user_id, planned_date) where status = 'planned';

create or replace function public.mock_appointments_version() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (old.planned_date, old.kind, old.label, old.start_time, old.duration_minutes, old.status)
       is distinct from (new.planned_date, new.kind, new.label, new.start_time, new.duration_minutes, new.status) then
    new.version := old.version + 1; new.updated_at := now();
  end if;
  return new;
end $$;
drop trigger if exists mock_appointments_version on public.mock_appointments;
create trigger mock_appointments_version before update on public.mock_appointments for each row execute function public.mock_appointments_version();

alter table public.mock_appointments enable row level security;
drop policy if exists "Users read their own mock appointments" on public.mock_appointments;
create policy "Users read their own mock appointments" on public.mock_appointments for select using (auth.uid() = user_id);
revoke all on public.mock_appointments from public, anon, authenticated;
grant select on public.mock_appointments to authenticated;

-- Backfill: the current checkpoint keeps its id and version; every earlier checkpoint that outcome history points at keeps its id too.
insert into public.mock_appointments (id, user_id, kind, planned_date, start_time, duration_minutes, label, status, version)
  select p.mock_id, p.id, p.mock_kind, p.mock_date, p.mock_start_time, p.mock_duration_minutes, p.mock_label, 'planned', greatest(coalesce(p.mock_version, 1), 1)
    from public.profiles p where p.mock_date is not null and p.mock_id is not null
  on conflict (id) do nothing;
insert into public.mock_appointments (id, user_id, kind, planned_date, label, status, version)
  select distinct on (o.checkpoint_id) o.checkpoint_id, o.user_id, o.kind, o.planned_date, o.label,
         case o.outcome when 'taken' then 'completed' when 'postponed' then 'postponed' else 'missed' end, 1
    from public.mock_outcomes o
   where o.checkpoint_id is not null and not exists (select 1 from public.mock_appointments a where a.id = o.checkpoint_id)
   order by o.checkpoint_id, o.recorded_at desc
  on conflict (id) do nothing;

alter table public.cycle_assessment_choices add column if not exists appointment_id uuid;
alter table public.cycle_assessment_choices add column if not exists rehearsal_id uuid;
-- Legacy choices (made when there was one checkpoint) carry no appointment: they keep applying to "the" appointment of that week.

-- The projection the profile shows: the next planned appointment.
create or replace function public.mock_apply_projection(p_user uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_n public.mock_appointments%rowtype; v_has boolean;
begin
  select * into v_n from public.mock_appointments where user_id = p_user and status = 'planned' order by planned_date, created_at, id limit 1;
  v_has := found;
  perform set_config('app.mock_projection', 'on', true);
  if v_has then
    update public.profiles set mock_id = v_n.id, mock_version = v_n.version, mock_date = v_n.planned_date, mock_kind = v_n.kind, mock_label = v_n.label,
      mock_start_time = v_n.start_time, mock_duration_minutes = v_n.duration_minutes where id = p_user;
  else
    update public.profiles set mock_id = null, mock_date = null, mock_kind = null, mock_label = null, mock_start_time = null, mock_duration_minutes = null where id = p_user;
  end if;
  perform set_config('app.mock_projection', 'off', true);
end $$;

create or replace function public.mock_appointments_project() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.mock_from_profile', true), '') = 'on' then return null; end if;
  perform public.mock_apply_projection(coalesce(new.user_id, old.user_id));
  return null;
end $$;
drop trigger if exists mock_appointments_project on public.mock_appointments;
create trigger mock_appointments_project after insert or update or delete on public.mock_appointments for each row execute function public.mock_appointments_project();

-- A legacy writer of profiles.mock_* (onboarding, Settings) edits the NEXT appointment; the profile then shows the projection again.
create or replace function public.profiles_clear_mock_timing() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_a public.mock_appointments%rowtype; v_n public.mock_appointments%rowtype; v_has boolean;
begin
  if coalesce(current_setting('app.mock_projection', 'false'), '') = 'on' then return new; end if;
  if tg_op = 'UPDATE' and (old.mock_date, old.mock_kind, old.mock_label, old.mock_start_time, old.mock_duration_minutes)
       is not distinct from (new.mock_date, new.mock_kind, new.mock_label, new.mock_start_time, new.mock_duration_minutes) then
    return new;
  end if;
  perform set_config('app.mock_from_profile', 'on', true);
  if tg_op = 'UPDATE' and old.mock_id is not null then
    select * into v_a from public.mock_appointments where id = old.mock_id and user_id = new.id and status = 'planned' for update;
  end if;
  if new.mock_date is null then
    if v_a.id is not null then update public.mock_appointments set status = 'cancelled' where id = v_a.id; end if;
  elsif v_a.id is not null then
    update public.mock_appointments set planned_date = new.mock_date, label = new.mock_label, start_time = new.mock_start_time, duration_minutes = new.mock_duration_minutes,
      kind = case when v_a.kind = 'internal_rehearsal' then v_a.kind else coalesce(new.mock_kind, v_a.kind) end where id = v_a.id;
  elsif new.mock_kind is not null then
    insert into public.mock_appointments (user_id, kind, planned_date, label, start_time, duration_minutes)
      values (new.id, new.mock_kind, new.mock_date, new.mock_label, new.mock_start_time, new.mock_duration_minutes);
  end if;
  select * into v_n from public.mock_appointments where user_id = new.id and status = 'planned' order by planned_date, created_at, id limit 1;
  v_has := found;
  perform set_config('app.mock_from_profile', 'off', true);
  if v_has then
    new.mock_id := v_n.id; new.mock_version := v_n.version; new.mock_date := v_n.planned_date; new.mock_kind := v_n.kind; new.mock_label := v_n.label;
    new.mock_start_time := v_n.start_time; new.mock_duration_minutes := v_n.duration_minutes;
  else
    new.mock_id := null; new.mock_date := null; new.mock_kind := null; new.mock_label := null; new.mock_start_time := null; new.mock_duration_minutes := null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_clear_mock_timing on public.profiles;
create trigger profiles_clear_mock_timing before insert or update on public.profiles for each row execute function public.profiles_clear_mock_timing();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. Linked rehearsals
-- ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.mock_rehearsals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  appointment_id uuid references public.mock_appointments(id) on delete set null,
  manifest_id uuid references public.curriculum_manifests(id),
  blueprint_version text not null,
  status text not null default 'ready' check (status in ('ready', 'in_progress', 'complete', 'abandoned', 'cancelled')),
  blueprint jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists mock_rehearsals_one_active_per_appointment on public.mock_rehearsals (appointment_id) where status in ('ready', 'in_progress');
alter table public.mock_rehearsals enable row level security;
drop policy if exists "Users read their own rehearsals" on public.mock_rehearsals;
create policy "Users read their own rehearsals" on public.mock_rehearsals for select using (auth.uid() = user_id);
revoke all on public.mock_rehearsals from public, anon, authenticated;
grant select on public.mock_rehearsals to authenticated;

alter table public.assessment_forms add column if not exists rehearsal_id uuid references public.mock_rehearsals(id), add column if not exists session_no smallint check (session_no in (1, 2));
alter table public.assessment_attempts add column if not exists rehearsal_id uuid references public.mock_rehearsals(id), add column if not exists session_no smallint check (session_no in (1, 2));
create unique index if not exists assessment_attempts_rehearsal_session on public.assessment_attempts (rehearsal_id, session_no) where rehearsal_id is not null;
alter table public.assessment_attempts drop constraint if exists assessment_attempts_rehearsal_pair;
alter table public.assessment_attempts add constraint assessment_attempts_rehearsal_pair check ((rehearsal_id is null) = (session_no is null));

-- Held-out, human-reviewed, exact-version-approved questions: the ONLY pool a rehearsal draws from.
create or replace view public.rehearsal_eligible_items with (security_invoker = true) as
  select i.* from public.assessment_items i
   where i.review_status = 'reviewed' and i.held_out = true
     and exists (select 1 from public.item_review_decisions d where d.item_id = i.id and d.item_version = i.item_version and d.decision = 'approve');
revoke all on public.rehearsal_eligible_items from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select on public.rehearsal_eligible_items to service_role; end if; end $$;

-- Same exposure and family rules as an ordinary paper, with the hold-out rule inverted (the question MUST be held out) and a
-- known family required, because family independence is what makes two sessions a fair rehearsal.
create or replace function public.rehearsal_item_defects(p_user uuid, p_item_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ids as (select x.id, x.ord from unnest(p_item_ids) with ordinality as x(id, ord)),
  exposed as (
    select r.item_id from public.assessment_responses r where r.user_id = p_user
    union
    select fi.item_id from public.form_items fi join public.assessment_attempts a on a.form_id = fi.form_id
     where a.user_id = p_user and a.status not in ('ready', 'assembling')),
  seen_fam as (select distinct i.family_id from exposed e join public.assessment_items i on i.id = e.item_id where i.family_id is not null),
  rows as (
    select ids.id, ids.ord, i.family_id, i.review_status, i.held_out, i.item_version,
           row_number() over (partition by ids.id order by ids.ord) as dup_item,
           case when i.family_id is null then 1 else row_number() over (partition by i.family_id order by ids.ord) end as dup_family
      from ids left join public.assessment_items i on i.id = ids.id)
  select coalesce(jsonb_agg(jsonb_build_object('itemId', d.id, 'code', d.code) order by d.ord), '[]'::jsonb) from (
    select r.id, r.ord, case
      when r.review_status is null then 'NOT_FOUND'
      when r.dup_item > 1 then 'DUPLICATE_ITEM'
      when r.review_status <> 'reviewed' then 'NOT_REVIEWED'
      when not r.held_out then 'NOT_HELD_OUT'
      when not exists (select 1 from public.item_review_decisions d where d.item_id = r.id and d.item_version = r.item_version and d.decision = 'approve') then 'NO_APPROVAL'
      when exists (select 1 from exposed e where e.item_id = r.id) then 'SEEN'
      when r.family_id is not null and exists (select 1 from seen_fam s where s.family_id = r.family_id) then 'SEEN_FAMILY'
      when r.family_id is null then 'UNKNOWN_FAMILY'
      when r.dup_family > 1 then 'DUPLICATE_FAMILY'
      else null end as code
    from rows r) d
  where d.code is not null
$$;
revoke all on function public.rehearsal_item_defects(uuid, text[]) from public, anon, authenticated;

-- The one reservation command for a full rehearsal: BOTH forms are pinned, or nothing is. The hold-out exception is a
-- transaction-local setting that only this service-role function sets; no request parameter can switch it on.
create or replace function public.start_rehearsal(p_user uuid, p_appointment uuid, p_manifest uuid, p_s1 text[], p_s2 text[], p_blueprint jsonb, p_version text, p_coverage jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_appt public.mock_appointments%rowtype; v_open public.mock_rehearsals%rowtype; v_r uuid; v_defects jsonb; v_s int; v_ids text[]; v_bp uuid; v_form uuid; v_att uuid;
  v_attempts jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('rehearsal:' || p_user::text || ':' || p_appointment::text, 0));
  select * into v_appt from public.mock_appointments where id = p_appointment and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NO_APPOINTMENT'); end if;
  if v_appt.kind <> 'internal_rehearsal' then return jsonb_build_object('ok', false, 'code', 'NOT_INTERNAL'); end if;
  if v_appt.status <> 'planned' then return jsonb_build_object('ok', false, 'code', 'APPOINTMENT_CLOSED'); end if;
  select * into v_open from public.mock_rehearsals where appointment_id = p_appointment and status in ('ready', 'in_progress');
  if found then return jsonb_build_object('ok', true, 'resumed', true, 'rehearsalId', v_open.id); end if;
  if coalesce(array_length(p_s1, 1), 0) <> 90 or coalesce(array_length(p_s2, 1), 0) <> 90 then
    return jsonb_build_object('ok', false, 'code', 'BANK_INSUFFICIENT', 'deliverable', jsonb_build_array(coalesce(array_length(p_s1, 1), 0), coalesce(array_length(p_s2, 1), 0)));
  end if;
  v_defects := public.rehearsal_item_defects(p_user, p_s1 || p_s2);
  if jsonb_array_length(v_defects) > 0 then return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED', 'defects', v_defects); end if;

  insert into public.mock_rehearsals (user_id, appointment_id, manifest_id, blueprint_version, blueprint) values (p_user, p_appointment, p_manifest, p_version, p_blueprint) returning id into v_r;
  perform set_config('app.holdout_form', 'on', true);
  for v_s in 1..2 loop
    v_ids := case when v_s = 1 then p_s1 else p_s2 end;
    insert into public.assessment_blueprints (manifest_id, purpose, requested_scope, constraints)
      values (p_manifest, 'mock_session', jsonb_build_object('kind', 'rehearsal', 'rehearsalId', v_r, 'session', v_s), jsonb_build_object('questions', 90, 'minutes', 135, 'heldOut', true, 'eligibility', 'approved-version-v1', 'blueprintVersion', p_version))
      returning id into v_bp;
    insert into public.assessment_forms (blueprint_id, delivery_mode, rehearsal_id, session_no) values (v_bp, 'fixed', v_r, v_s) returning id into v_form;
    insert into public.form_items (form_id, item_id, sequence_number) select v_form, x.item, x.ord from unnest(v_ids) with ordinality as x(item, ord);
    -- deadline_at stays NULL until the student explicitly starts the session.
    insert into public.assessment_attempts (user_id, form_id, delivery_mode, status, attempt_kind, paper_kind, open_key, requested_blueprint, delivered_coverage, eligibility_policy, time_limit_minutes, rehearsal_id, session_no)
      values (p_user, v_form, 'fixed', 'ready', 'mock', 'mixed', 'rehearsal:' || v_r || ':s' || v_s, p_blueprint, coalesce(p_coverage->(v_s::text), '{}'::jsonb), 'approved-version-v1', 135, v_r, v_s) returning id into v_att;
    v_attempts := v_attempts || jsonb_build_array(v_att);
  end loop;
  perform set_config('app.holdout_form', 'off', true);
  return jsonb_build_object('ok', true, 'resumed', false, 'rehearsalId', v_r, 'attempts', v_attempts);
end $$;
revoke all on function public.start_rehearsal(uuid, uuid, uuid, text[], text[], jsonb, text, jsonb) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.start_rehearsal(uuid, uuid, uuid, text[], text[], jsonb, text, jsonb) to service_role;
  grant execute on function public.rehearsal_item_defects(uuid, text[]) to service_role; end if; end $$;

-- Explicit start of one session's clock. Idempotent: a repeat or a concurrent call returns the SAME deadline. Session 2 only after
-- session 1 has ended (scored, expired or abandoned), and a cancelled rehearsal cannot be started.
create or replace function public.start_rehearsal_session(p_user uuid, p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_a public.assessment_attempts%rowtype; v_r public.mock_rehearsals%rowtype; v_prev public.assessment_attempts%rowtype;
begin
  select * into v_a from public.assessment_attempts where id = p_attempt and user_id = p_user and rehearsal_id is not null for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into v_r from public.mock_rehearsals where id = v_a.rehearsal_id for update;
  if v_r.status in ('cancelled', 'abandoned') then return jsonb_build_object('ok', false, 'code', 'REHEARSAL_CLOSED'); end if;
  if v_a.status in ('scored', 'expired', 'submitted', 'abandoned', 'rescored', 'partially_voided') then return jsonb_build_object('ok', false, 'code', 'SESSION_ENDED'); end if;
  if v_a.deadline_at is not null then return jsonb_build_object('ok', true, 'started', false, 'deadlineAt', v_a.deadline_at); end if;
  if v_a.session_no = 2 then
    select * into v_prev from public.assessment_attempts where rehearsal_id = v_a.rehearsal_id and session_no = 1;
    if v_prev.status not in ('scored', 'expired', 'rescored', 'partially_voided', 'abandoned') then return jsonb_build_object('ok', false, 'code', 'SESSION_1_OPEN'); end if;
  end if;
  update public.assessment_attempts set status = 'in_progress', started_at = now(), deadline_at = now() + make_interval(mins => time_limit_minutes) where id = p_attempt returning * into v_a;
  update public.mock_rehearsals set status = 'in_progress' where id = v_r.id and status = 'ready';
  return jsonb_build_object('ok', true, 'started', true, 'deadlineAt', v_a.deadline_at);
end $$;
revoke all on function public.start_rehearsal_session(uuid, uuid) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.start_rehearsal_session(uuid, uuid) to service_role; end if; end $$;

-- An answer needs a started clock for a rehearsal session.
do $$
declare d text;
begin
  select pg_get_functiondef('public.save_attempt_response'::regproc) into d;
  if position('Session not started' in d) = 0 then
    d := replace(d, E'  if v_attempt.paused_at is not null then raise exception ''Attempt is paused''; end if;\n',
                    E'  if v_attempt.paused_at is not null then raise exception ''Attempt is paused''; end if;\n  if v_attempt.rehearsal_id is not null and v_attempt.deadline_at is null then raise exception ''Session not started''; end if;\n');
    if position('Session not started' in d) = 0 then raise exception 'save_attempt_response patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Commands on appointments (replaces the single-checkpoint body; same name, same signature, same receipts)
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function if exists public.checkpoint_apply_choice(uuid, date, text, text);
create or replace function public.checkpoint_apply_choice(p_user uuid, p_week date, p_choice text, p_paper_action text, p_appt uuid default null) returns jsonb
language plpgsql set search_path = '' as $$
declare v_paper jsonb; v_cancelled text;
begin
  if p_choice not in ('use_mock', 'keep_paper', 'later') then return jsonb_build_object('ok', false, 'code', 'INVALID_CHOICE'); end if;
  if p_choice = 'use_mock' then
    v_paper := public.checkpoint_week_paper(p_user, p_week);
    if v_paper is not null and v_paper <> 'null'::jsonb then
      if (v_paper->>'started')::boolean then return jsonb_build_object('ok', false, 'code', 'PAPER_STARTED'); end if;
      if coalesce(p_paper_action, '') <> 'replace' then return jsonb_build_object('ok', false, 'code', 'PAPER_DECISION_REQUIRED', 'paper', v_paper); end if;
      update public.plan_blocks set cancelled_at = now(), revision = revision + 1 where id = v_paper->>'taskId' and user_id = p_user and cancelled_at is null;
      insert into public.task_events (user_id, task_id, event_type, payload, previous)
        values (p_user, v_paper->>'taskId', 'cancelled', jsonb_build_object('reason', 'replaced_by_mock'), '{}'::jsonb);
      v_cancelled := v_paper->>'taskId';
    end if;
  end if;
  insert into public.cycle_assessment_choices (user_id, week_start, choice, decided_at, appointment_id) values (p_user, p_week, p_choice, now(), case when p_choice = 'use_mock' then p_appt end)
    on conflict (user_id, week_start) do update set choice = excluded.choice, decided_at = excluded.decided_at, appointment_id = excluded.appointment_id;
  return jsonb_build_object('ok', true, 'cancelledPaperTaskId', v_cancelled);
end $$;
revoke all on function public.checkpoint_apply_choice(uuid, date, text, text, uuid) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.checkpoint_apply_choice(uuid, date, text, text, uuid) to service_role; end if; end $$;

create or replace function public.checkpoint_command(p_user uuid, p_key text, p_command text, p_hash text, p_args jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_rec public.checkpoint_commands%rowtype; v_a public.mock_appointments%rowtype; v_receipt jsonb; v_res jsonb;
  v_choice text; v_week date; v_task public.plan_blocks%rowtype; v_map public.checkpoint_suggestion_tasks%rowtype;
  v_new_id text; v_outcome_id uuid; v_next public.mock_appointments%rowtype; v_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('checkpoint:' || p_user::text, 0));
  select * into v_rec from public.checkpoint_commands where user_id = p_user and key = p_key;
  if found then
    if v_rec.payload_hash <> p_hash or v_rec.command <> p_command then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED'); end if;
    return v_rec.receipt || jsonb_build_object('replayed', true);
  end if;
  perform 1 from public.profiles where id = p_user for update;
  if not found then raise exception 'no profile for user'; end if;
  select * into v_next from public.mock_appointments where user_id = p_user and status = 'planned' order by planned_date, created_at, id limit 1;

  -- Every command except add/keep/remove-related is made against a specific appointment and version.
  if p_command in ('save', 'cancel', 'choice', 'outcome', 'add_suggestion') then
    if (p_args->>'checkpointId') is null then
      if p_command <> 'save' then return jsonb_build_object('ok', false, 'code', 'NO_CHECKPOINT'); end if;
      if v_next.id is not null then return jsonb_build_object('ok', false, 'code', 'CHECKPOINT_CHANGED', 'currentId', v_next.id, 'currentVersion', v_next.version); end if;
    else
      select * into v_a from public.mock_appointments where id = (p_args->>'checkpointId')::uuid and user_id = p_user for update;
      if not found or v_a.status <> 'planned' or (p_args->>'expectedVersion')::int is distinct from v_a.version then
        return jsonb_build_object('ok', false, 'code', 'CHECKPOINT_CHANGED', 'currentId', v_next.id, 'currentVersion', v_next.version);
      end if;
    end if;
  end if;

  if p_command in ('save', 'add') then
    if v_a.id is not null and p_command = 'save' then
      if (v_a.kind = 'internal_rehearsal') is distinct from ((p_args->>'kind') = 'internal_rehearsal') then
        if exists (select 1 from public.mock_rehearsals r where r.appointment_id = v_a.id and r.status in ('ready', 'in_progress', 'complete')) then
          return jsonb_build_object('ok', false, 'code', 'KIND_LOCKED'); end if;
      end if;
      update public.mock_appointments set planned_date = (p_args->>'date')::date, kind = p_args->>'kind', label = nullif(p_args->>'label', ''),
        start_time = nullif(p_args->>'startTime', '')::time, duration_minutes = nullif(p_args->>'durationMinutes', '')::smallint where id = v_a.id returning * into v_a;
      if (p_args->>'oldWeekStart') is not null then
        delete from public.cycle_assessment_choices where user_id = p_user and week_start = (p_args->>'oldWeekStart')::date and (appointment_id = v_a.id or appointment_id is null);
      end if;
    else
      insert into public.mock_appointments (user_id, kind, planned_date, label, start_time, duration_minutes)
        values (p_user, p_args->>'kind', (p_args->>'date')::date, nullif(p_args->>'label', ''), nullif(p_args->>'startTime', '')::time, nullif(p_args->>'durationMinutes', '')::smallint) returning * into v_a;
    end if;
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', p_command, 'checkpointId', v_a.id, 'version', v_a.version);

  elsif p_command = 'cancel' then
    if exists (select 1 from public.mock_rehearsals r where r.appointment_id = v_a.id and r.status = 'in_progress') then return jsonb_build_object('ok', false, 'code', 'REHEARSAL_STARTED'); end if;
    update public.mock_appointments set status = 'cancelled' where id = v_a.id;
    update public.mock_rehearsals set status = 'cancelled' where appointment_id = v_a.id and status = 'ready';
    delete from public.cycle_assessment_choices where user_id = p_user and week_start = (p_args->>'weekStart')::date and (appointment_id = v_a.id or appointment_id is null);
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', 'cancel', 'cancelledId', v_a.id);

  elsif p_command = 'choice' then
    v_res := public.checkpoint_apply_choice(p_user, (p_args->>'weekStart')::date, p_args->>'choice', p_args->>'paperAction', v_a.id);
    if not (v_res->>'ok')::boolean then return v_res; end if;
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', 'choice', 'choice', p_args->>'choice', 'weekStart', p_args->>'weekStart', 'appointmentId', v_a.id, 'cancelledPaperTaskId', v_res->>'cancelledPaperTaskId');

  elsif p_command = 'outcome' then
    v_week := (p_args->>'weekStart')::date;
    if p_args->>'outcome' not in ('taken', 'postponed', 'not_taken') then return jsonb_build_object('ok', false, 'code', 'INVALID_OUTCOME'); end if;
    if v_a.kind = 'internal_rehearsal' and p_args->>'outcome' = 'taken' then return jsonb_build_object('ok', false, 'code', 'INTERNAL_RESULT'); end if;
    if p_args->>'outcome' = 'taken' and ((p_args->>'actualDate') is null or (p_args->>'actualDate')::date > (p_args->>'today')::date) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_ACTUAL_DATE'); end if;
    if p_args->>'outcome' <> 'taken' and (nullif(p_args->>'result', '') is not null or (p_args->>'actualDate') is not null) then
      return jsonb_build_object('ok', false, 'code', 'INVALID_RESULT'); end if;
    select choice into v_choice from public.cycle_assessment_choices where user_id = p_user and week_start = v_week and (appointment_id = v_a.id or appointment_id is null);
    if (p_args->>'choice') is not null and coalesce(v_choice, 'later') = 'later' then
      v_res := public.checkpoint_apply_choice(p_user, v_week, p_args->>'choice', p_args->>'paperAction', v_a.id);
      if not (v_res->>'ok')::boolean then return v_res; end if;
      v_choice := p_args->>'choice';
    end if;
    insert into public.mock_outcomes (user_id, checkpoint_id, planned_date, kind, label, outcome, reported_result, notes, actual_date, choice_at_record)
      values (p_user, v_a.id, v_a.planned_date, v_a.kind, v_a.label, p_args->>'outcome', nullif(p_args->>'result', ''), nullif(p_args->>'notes', ''), nullif(p_args->>'actualDate', '')::date, coalesce(v_choice, 'later'))
      returning id into v_outcome_id;
    if p_args->>'outcome' = 'postponed' and (p_args->>'newDate') is not null then
      update public.mock_appointments set planned_date = (p_args->>'newDate')::date where id = v_a.id;
    else
      v_status := case p_args->>'outcome' when 'taken' then 'completed' when 'postponed' then 'postponed' else 'missed' end;
      update public.mock_appointments set status = v_status where id = v_a.id;
      update public.mock_rehearsals set status = 'cancelled' where appointment_id = v_a.id and status = 'ready';
    end if;
    delete from public.cycle_assessment_choices where user_id = p_user and week_start = v_week and (appointment_id = v_a.id or appointment_id is null);
    update public.profiles set onboarding_context_version = coalesce(onboarding_context_version, 1) + 1 where id = p_user;
    v_receipt := jsonb_build_object('ok', true, 'command', 'outcome', 'outcomeId', v_outcome_id, 'outcome', p_args->>'outcome',
      'plannedDate', v_a.planned_date, 'choice', coalesce(v_choice, 'later'), 'moved', (p_args->>'outcome' = 'postponed' and (p_args->>'newDate') is not null));

  elsif p_command = 'add_suggestion' then
    select * into v_map from public.checkpoint_suggestion_tasks where user_id = p_user and checkpoint_id = v_a.id and suggestion_id = p_args->>'suggestionId';
    if found then
      select * into v_task from public.plan_blocks where id = v_map.task_id;
      if v_task.cancelled_at is null and v_task.execution <> 'cancelled' then
        v_receipt := jsonb_build_object('ok', true, 'command', 'add_suggestion', 'taskId', v_map.task_id, 'alreadyAdded', true);
        insert into public.checkpoint_commands (user_id, key, command, payload_hash, receipt) values (p_user, p_key, p_command, p_hash, v_receipt);
        return v_receipt;
      end if;
      delete from public.checkpoint_suggestion_tasks where user_id = p_user and checkpoint_id = v_a.id and suggestion_id = p_args->>'suggestionId';
    end if;
    v_new_id := 'ckpt-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at,
                                    duration_minutes, duration, rationale, is_protected_commitment, created_by)
      values (v_new_id, p_user, (p_args->>'cycleId')::uuid, p_args->>'title', coalesce(p_args->>'detail', ''), 'review', 'student', 'optional',
              case when nullif(p_args->>'startsAt', '') is null then 'day_preferred' else 'timed' end, 'not_started',
              (p_args->>'date')::date, (p_args->>'date')::date, nullif(p_args->>'startsAt', '')::timestamptz,
              (p_args->>'minutes')::smallint, p_args->>'minutes', 'You added this from your mock checkpoint suggestions.', false, 'student');
    insert into public.task_events (user_id, task_id, event_type, payload, previous)
      values (p_user, v_new_id, 'created', jsonb_build_object('source', 'checkpoint_suggestion', 'suggestion', p_args->>'suggestionId', 'checkpointId', v_a.id), '{}'::jsonb);
    insert into public.checkpoint_suggestion_tasks (user_id, checkpoint_id, suggestion_id, task_id, version_added)
      values (p_user, v_a.id, p_args->>'suggestionId', v_new_id, v_a.version);
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

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Exam completion (the student's own record; never inferred from a date, a score or a window ending)
-- ---------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.exam_completion (
  user_id uuid primary key references auth.users on delete cascade,
  sat_on date not null,
  recorded_at timestamptz not null default now(),
  reported_result text check (reported_result is null or char_length(reported_result) between 1 and 80),
  psm_status text check (psm_status is null or psm_status in ('done', 'not_done', 'unsure')),
  retake_requested_at timestamptz,
  retake_note text check (retake_note is null or char_length(retake_note) <= 500)
);
alter table public.exam_completion enable row level security;
drop policy if exists "Users read their own exam completion" on public.exam_completion;
create policy "Users read their own exam completion" on public.exam_completion for select using (auth.uid() = user_id);
revoke all on public.exam_completion from public, anon, authenticated;
grant select on public.exam_completion to authenticated;

alter table public.profiles add column if not exists psm_reminder_dismissed_at timestamptz;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Drafts go stale when ANY appointment, rehearsal or exam completion changes
-- ---------------------------------------------------------------------------------------------------------------------------------
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
    (select coalesce(string_agg(c.week_start::text || ':' || c.choice || ':' || coalesce(c.appointment_id::text, ''), ',' order by c.week_start), '')
       from public.cycle_assessment_choices c where c.user_id = p_user),
    (select coalesce(string_agg(o.id::text || ':' || o.outcome || ':' || coalesce(o.actual_date::text, ''), ',' order by o.id::text), '')
       from public.mock_outcomes o where o.user_id = p_user),
    (select coalesce(string_agg(s.suggestion_id || ':' || s.task_id, ',' order by s.suggestion_id, s.task_id), '')
       from public.checkpoint_suggestion_tasks s where s.user_id = p_user),
    (select coalesce(string_agg(a.id::text || ':' || a.version || ':' || a.status, ',' order by a.id::text), '')
       from public.mock_appointments a where a.user_id = p_user),
    (select coalesce(string_agg(r.id::text || ':' || r.status, ',' order by r.id::text), '')
       from public.mock_rehearsals r where r.user_id = p_user),
    (select coalesce(c.sat_on::text, '') from public.exam_completion c where c.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone', j->>'stage', j->>'mock_date', j->>'mock_kind',
                      j->>'mock_start_time', j->>'mock_duration_minutes', j->>'mock_label', j->>'mock_version')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;

-- paper_scope_source covers the same rows as before, plus nothing new (appointments are not scope).
notify pgrst, 'reload schema';
