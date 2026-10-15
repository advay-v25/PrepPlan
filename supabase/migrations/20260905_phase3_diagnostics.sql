-- Phase 3: Diagnostic Engine, Tests and Accountability
-- Strict canonical schemas for assessment, curriculum evidence, and diagnostic blueprints.

-- 1. Curriculum Manifest and Concepts
create table if not exists public.curriculum_manifests (
  id uuid primary key default gen_random_uuid(),
  year smallint not null,
  level text not null,
  version text not null,
  is_active boolean not null default false,
  capabilities jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(year, level, version)
);

create table if not exists public.curriculum_concepts (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.curriculum_manifests(id) on delete cascade,
  topic text not null,
  reading text not null,
  module text not null,
  los text not null,
  name text not null,
  importance text not null default 'supporting' check (importance in ('core', 'supporting', 'peripheral')),
  prerequisites uuid[] default '{}',
  created_at timestamptz not null default now()
);

-- 2. Source References
create table if not exists public.source_references (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.curriculum_concepts(id) on delete cascade,
  source_type text not null,
  edition text not null,
  location text not null,
  verification_status text not null default 'pending' check (verification_status in ('pending', 'extracted', 'student_confirmed', 'verified')),
  created_at timestamptz not null default now()
);

-- 3. Expanded Assessment Items (Phase 0 expansion)
-- We safely add columns rather than recreating the table.
alter table public.assessment_items add column if not exists concept_id uuid references public.curriculum_concepts(id);
alter table public.assessment_items add column if not exists cognition text check (cognition in ('recall', 'interpret', 'apply', 'calculate', 'compare', 'diagnose', 'integrate'));
alter table public.assessment_items add column if not exists item_form text check (item_form in ('direct', 'scenario', 'data_table', 'calculation', 'exception', 'integrated'));
alter table public.assessment_items add column if not exists intended_difficulty text check (intended_difficulty in ('foundation', 'standard', 'difficult', 'stretch'));
alter table public.assessment_items add column if not exists item_version integer not null default 1;
alter table public.assessment_items add column if not exists solution_hash text;
-- We keep keys server-side only in actual API responses, but store them here.

-- 4. Validation Runs
create table if not exists public.item_validations (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.assessment_items(id) on delete cascade,
  reviewer_role text not null check (reviewer_role in ('planner', 'writer', 'scope_verifier', 'solver', 'language_reviewer', 'originality_reviewer')),
  status text not null check (status in ('PASS', 'REVISE', 'VOID', 'HUMAN_REVIEW')),
  defect_codes text[] default '{}',
  created_at timestamptz not null default now()
);

-- 5. Blueprints and Forms
create table if not exists public.assessment_blueprints (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.curriculum_manifests(id),
  purpose text not null,
  requested_scope jsonb not null default '{}'::jsonb,
  constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_forms (
  id uuid primary key default gen_random_uuid(),
  blueprint_id uuid not null references public.assessment_blueprints(id) on delete cascade,
  delivery_mode text not null default 'adaptive' check (delivery_mode in ('adaptive', 'fixed')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.form_items (
  form_id uuid not null references public.assessment_forms(id) on delete cascade,
  item_id text not null references public.assessment_items(id) on delete cascade,
  sequence_number smallint,
  primary key (form_id, item_id)
);

-- 6. Expanded Attempts and Responses
alter table public.assessment_attempts add column if not exists form_id uuid references public.assessment_forms(id);
alter table public.assessment_attempts add column if not exists delivery_mode text not null default 'adaptive' check (delivery_mode in ('adaptive', 'fixed'));
alter table public.assessment_attempts drop constraint if exists assessment_attempts_status_check;
alter table public.assessment_attempts add constraint assessment_attempts_status_check check (status in ('assembling', 'ready', 'in_progress', 'submitted', 'scored', 'partially_voided', 'rescored', 'abandoned', 'expired'));
alter table public.assessment_attempts add column if not exists idempotency_key text unique;

alter table public.assessment_responses add column if not exists attempt_id uuid references public.assessment_attempts(id) on delete cascade;
alter table public.assessment_responses add column if not exists elapsed_seconds integer;
alter table public.assessment_responses add column if not exists is_flagged boolean not null default false;

-- 7. Item Challenges
create table if not exists public.item_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null references public.assessment_items(id) on delete cascade,
  attempt_id uuid references public.assessment_attempts(id) on delete cascade,
  comment text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved_voided', 'resolved_kept')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 8. Evidence Events
create table if not exists public.evidence_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  attempt_id uuid references public.assessment_attempts(id) on delete set null,
  item_id text references public.assessment_items(id) on delete set null,
  concept_id uuid not null references public.curriculum_concepts(id) on delete cascade,
  validity text not null default 'valid' check (validity in ('valid', 'voided', 'disputed')),
  is_correct boolean,
  evidence_state text not null check (evidence_state in ('insufficient', 'needs_repair', 'unstable', 'supported')),
  error_code text,
  created_at timestamptz not null default now()
);

-- 9. Repair Queue
create table if not exists public.repair_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  concept_id uuid not null references public.curriculum_concepts(id) on delete cascade,
  source_reference_id uuid references public.source_references(id),
  evidence_event_id uuid references public.evidence_events(id),
  status text not null default 'pending' check (status in ('pending', 'proposed', 'completed', 'superseded')),
  created_at timestamptz not null default now()
);

-- RLS Enablement
alter table public.curriculum_manifests enable row level security;
alter table public.curriculum_concepts enable row level security;
alter table public.source_references enable row level security;
alter table public.item_validations enable row level security;
alter table public.assessment_blueprints enable row level security;
alter table public.assessment_forms enable row level security;
alter table public.form_items enable row level security;
alter table public.item_challenges enable row level security;
alter table public.evidence_events enable row level security;
alter table public.repair_queue enable row level security;

-- Policies
create policy "manifests_read_all" on public.curriculum_manifests for select using (true);
create policy "concepts_read_all" on public.curriculum_concepts for select using (true);
create policy "sources_read_all" on public.source_references for select using (true);

create policy "blueprints_read_all" on public.assessment_blueprints for select using (true);
create policy "forms_read_all" on public.assessment_forms for select using (true);
create policy "form_items_read_all" on public.form_items for select using (true);

create policy "challenges_all_own" on public.item_challenges for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "evidence_all_own" on public.evidence_events for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "repair_queue_all_own" on public.repair_queue for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Explicit Retirement Path for legacy stores (Documented, not destructive)
-- legacy 'questions', 'exam_attempts', 'user_metrics', 'test_records' remain accessible 
-- but will no longer be written to by Phase 3 endpoints.
