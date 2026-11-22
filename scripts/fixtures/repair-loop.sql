-- Dependency fixture for the repair-loop migration, NOT a baseline for installing the app.
-- Applied after the task, weekly-continuity fixtures and migrations. Mirrors the REAL development schema (read-only
-- inspection, 31 Oct 2026) for the columns, checks, keys and grants the loop depends on.
create table public.curriculum_manifests (id uuid primary key default gen_random_uuid(), is_active boolean not null default true);
create table public.curriculum_concepts (id uuid primary key default gen_random_uuid(), manifest_id uuid not null references public.curriculum_manifests(id), name text not null default 'Concept');

-- repair_threads: the weekly fixture made a stub; make it the real thing.
alter table public.repair_threads
  add column concept_id uuid not null references public.curriculum_concepts(id), add column manifest_id uuid not null references public.curriculum_manifests(id),
  add column severity text, add column occurrence_count integer not null default 1, add column opened_from_attempt_id uuid,
  add column latest_evidence_event_id uuid, add column latest_evidence_at timestamptz not null default now(), add column next_recheck_due_at timestamptz,
  add column policy_version text, add column revision integer not null default 1, add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(), add column closed_at timestamptz, add column closure_reason text;
alter table public.repair_threads add constraint repair_threads_status_check
  check (status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck', 'closed', 'cancelled', 'superseded'));
alter table public.repair_threads add constraint repair_threads_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
create unique index repair_threads_active_idx on public.repair_threads(user_id, concept_id, manifest_id) where status <> all (array['closed', 'cancelled', 'superseded']);
create table public.repair_thread_events (id uuid primary key default gen_random_uuid(), thread_id uuid not null references public.repair_threads(id),
  event_type text not null, details jsonb, created_at timestamptz not null default now());
create table public.repair_queue (id uuid primary key default gen_random_uuid(), user_id uuid not null, concept_id uuid not null, status text not null default 'open');
alter table public.plan_blocks add constraint plan_blocks_repair_thread_id_fkey foreign key (repair_thread_id) references public.repair_threads(id);

create table public.coach_proposals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, intent text not null,
  proposed_changes jsonb not null default '{}', reasoning text not null default '', target_cycle_id uuid references public.planning_cycles(id) on delete set null,
  target_task_id text, expected_revision integer, status text not null default 'pending', idempotency_key text unique,
  created_at timestamptz not null default now(), executed_at timestamptz, origin text, proposal_version text, revision integer not null default 1,
  applied_task_ids uuid[], applied_at timestamptz, decided_at timestamptz,
  constraint coach_proposals_origin_check check (origin in ('diagnostic', 'coach', 'weekly_review')),
  constraint coach_proposals_status_check check (status in ('pending', 'executed', 'rejected', 'stale'))
);

alter table public.evidence_events add column attempt_id uuid, add column item_id text, add column concept_id uuid, add column is_correct boolean,
  add column evidence_state text not null default 'insufficient', add column error_code text, add column created_at timestamptz not null default now(),
  add column response_id uuid, add column assessment_purpose text, add column evidence_mode text, add column item_trust_tier text,
  add column self_reported_confidence integer, add column scoring_policy_version text;
create unique index evidence_events_attempt_item_policy on public.evidence_events(attempt_id, item_id, scoring_policy_version);

create table public.assessment_items (id text primary key, lm_id text, outcome_id text, concept_id uuid, review_status text not null default 'reviewed', item_card jsonb);
create table public.assessment_blueprints (id uuid primary key default gen_random_uuid(), manifest_id uuid not null, purpose text not null,
  requested_scope jsonb not null default '{}', constraints jsonb not null default '{}', created_at timestamptz not null default now());
create table public.assessment_forms (id uuid primary key default gen_random_uuid(), blueprint_id uuid not null references public.assessment_blueprints(id),
  delivery_mode text not null default 'fixed', is_active boolean not null default true, created_at timestamptz not null default now());
create table public.form_items (form_id uuid not null references public.assessment_forms(id), item_id text not null references public.assessment_items(id), sequence_number smallint, primary key (form_id, item_id));
create table public.assessment_responses (id uuid primary key default gen_random_uuid(), attempt_id uuid not null, item_id text not null, user_id uuid not null,
  selected_option_index smallint, is_correct boolean, self_reported_confidence smallint, created_at timestamptz not null default now());

alter table public.assessment_attempts add column score smallint, add column started_at timestamptz not null default now(), add column completed_at timestamptz,
  add column form_id uuid references public.assessment_forms(id), add column delivery_mode text not null default 'fixed', add column evidence_mode text,
  add column scoring_policy_version text, add column evidence_policy_version text, add column valid_response_count integer, add column correct_response_count integer,
  add column result_revision integer not null default 1, add column rescored_at timestamptz, add column paper_kind text, add column open_key text,
  add column requested_blueprint jsonb, add column delivered_coverage jsonb, add column submitted_at timestamptz;
alter table public.assessment_attempts add constraint assessment_attempts_status_check
  check (status in ('assembling', 'ready', 'in_progress', 'submitted', 'scored', 'partially_voided', 'rescored', 'abandoned', 'expired'));
create unique index assessment_attempts_open_key_idx on public.assessment_attempts(user_id, open_key) where status in ('ready', 'in_progress') and open_key is not null;
alter table public.plan_blocks add constraint plan_blocks_attempt_id_fkey foreign key (attempt_id) references public.assessment_attempts(id) on delete set null;

create table public.paper_scope_snapshots (id uuid primary key default gen_random_uuid(), user_id uuid not null, cycle_id uuid, purpose text not null,
  revision text not null, scope jsonb not null, attempt_id uuid references public.assessment_attempts(id), created_at timestamptz not null default now());
create table public.item_challenges (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.assessment_items(id) on delete cascade, attempt_id uuid references public.assessment_attempts(id) on delete cascade,
  comment text not null default '', status text not null default 'pending', created_at timestamptz not null default now(), resolved_at timestamptz, reason_code text,
  constraint item_challenges_status_check check (status in ('pending', 'resolved_voided', 'resolved_kept')));
create table public.user_roles (user_id uuid not null, role text not null, granted_at timestamptz not null default now(), granted_by uuid);

-- The unsafe legacy applier (same signature as the live one), so the migration's retirement of it can be proven.
create function public.apply_diagnostic_repair_proposal(p_proposal_id uuid, p_tasks jsonb) returns uuid[] language sql security definer set search_path = '' as $$ select '{}'::uuid[] $$;

-- Today's grants, which the migration narrows: a signed-in student could write all of these.
grant select, insert, update, delete, truncate on public.repair_threads, public.repair_thread_events, public.repair_queue, public.coach_proposals,
  public.evidence_events, public.item_challenges, public.assessment_responses, public.assessment_attempts to authenticated, anon;
grant select on public.assessment_items, public.assessment_blueprints, public.assessment_forms, public.form_items, public.curriculum_concepts, public.curriculum_manifests, public.paper_scope_snapshots to authenticated;
grant execute on function public.apply_diagnostic_repair_proposal(uuid, jsonb) to authenticated, anon;

-- The live challenge-raising function (unchanged by the migration): a pending challenge marks the evidence "disputed", it does not erase it.
create function public.raise_item_challenge(p_attempt_id uuid, p_item_id text, p_comment text, p_reason_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_id uuid;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if not exists (select 1 from public.assessment_responses where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user) then raise exception 'Response not found'; end if;
  insert into public.item_challenges(user_id, item_id, attempt_id, comment, reason_code) values (v_user, p_item_id, p_attempt_id, p_comment, coalesce(p_reason_code, 'other')) returning id into v_id;
  update public.evidence_events set validity = 'disputed', validity_reason = 'challenge_pending' where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user;
  return v_id;
end $$;
grant execute on function public.raise_item_challenge(uuid, text, text, text) to authenticated;
