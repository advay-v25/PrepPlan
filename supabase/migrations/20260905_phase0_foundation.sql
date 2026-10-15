-- Phase 0 Foundation Migration
-- Provides independent state models and explicit task semantics for the Roadmap planner.

-- 1. Assessment Model (Replaces legacy 'questions' for explicitly reviewed items)
create table if not exists public.assessment_items (
  id text primary key,
  lm_id text not null references public.learning_modules(id) on delete cascade,
  learning_objective text not null,
  verification_intent text not null,
  difficulty numeric(5,2) not null default 1.0,
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  per_option_feedback jsonb not null default '{}'::jsonb,
  provenance text not null,
  review_status text not null default 'draft' check (review_status in ('draft','reviewed','deprecated')),
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'abandoned')),
  score smallint check (score between 0 and 100),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  item_id text not null references public.assessment_items(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  selected_option_index smallint,
  is_correct boolean,
  self_reported_confidence smallint check (self_reported_confidence between 1 and 5),
  demonstrated_understanding boolean,
  created_at timestamptz not null default now()
);

-- 2. Coach Proposals (Independent previewable intents)
create table if not exists public.coach_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  intent text not null,
  proposed_changes jsonb not null default '{}'::jsonb,
  reasoning text not null,
  target_cycle_id uuid references public.planning_cycles(id) on delete set null,
  target_draft_id uuid references public.plan_drafts(id) on delete set null,
  target_task_id text references public.plan_blocks(id) on delete set null,
  expected_revision integer,
  status text not null default 'pending' check (status in ('pending', 'executed', 'rejected', 'stale')),
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

-- 3. Task Feedback (Immutable observations instead of mutable fields)
create table if not exists public.task_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null references public.plan_blocks(id) on delete cascade,
  was_helpful boolean,
  was_manageable boolean,
  comment text,
  method_version text,
  created_at timestamptz not null default now()
);

-- 4. Plan Blocks Semantics
-- We use DO blocks to safely add columns if they don't exist in Postgres < 13 without throwing errors on old versions, 
-- or simply rely on 'add column if not exists'.

alter table public.plan_blocks add column if not exists learning_objective text;
alter table public.plan_blocks add column if not exists suggested_approach text;
alter table public.plan_blocks add column if not exists focus_distinction text;
alter table public.plan_blocks add column if not exists verification_intent text;
alter table public.plan_blocks add column if not exists is_protected_commitment boolean not null default false;

-- Safely relax starts_at constraint if it's there
alter table public.plan_blocks alter column starts_at drop not null;

-- Add floating/deferred to plan_blocks state if they don't exist
DO $$
BEGIN
  -- We just drop and recreate the check constraint if we can't reliably alter it.
  -- Alternatively, we just disable the old check and add a new one.
  -- Since we may not know the exact constraint name, we'll try to drop known ones or just rename it.
  -- For safety, we will leave the enum as text in Supabase check constraint updates if needed.
  -- In schema.sql it was created as: state text not null check (state in ('done','planned','class','risk','empty'))
  -- To upgrade it safely without knowing the name:
END;
$$;
-- Since altering check constraints dynamically is tricky without knowing the name,
-- we'll attempt to drop the likely constraint name and apply the new one.
-- Supabase default naming for check constraint on 'state' in 'plan_blocks' is 'plan_blocks_state_check'.
alter table public.plan_blocks drop constraint if exists plan_blocks_state_check;
alter table public.plan_blocks add constraint plan_blocks_state_check check (state in ('done','planned','class','risk','empty','floating','timed','deferred'));

-- 5. RLS Policies
alter table public.assessment_items enable row level security;
alter table public.assessment_attempts enable row level security;
alter table public.assessment_responses enable row level security;
alter table public.coach_proposals enable row level security;
alter table public.task_feedback enable row level security;

-- Policies
drop policy if exists "items_select_all" on public.assessment_items;
create policy "items_select_all" on public.assessment_items for select using (true);

drop policy if exists "attempts_all_own" on public.assessment_attempts;
create policy "attempts_all_own" on public.assessment_attempts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "responses_all_own" on public.assessment_responses;
create policy "responses_all_own" on public.assessment_responses for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "coach_proposals_all_own" on public.coach_proposals;
create policy "coach_proposals_all_own" on public.coach_proposals for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "task_feedback_all_own" on public.task_feedback;
create policy "task_feedback_all_own" on public.task_feedback for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 6. Schema Migrations Ledger
create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
