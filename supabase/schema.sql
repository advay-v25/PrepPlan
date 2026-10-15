-- Roadmap CFA Level I MVP schema. Run in the Supabase SQL editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, timezone text not null default 'Asia/Kolkata', locale text not null default 'en',
  onboarding_status text not null default 'not_started' check (onboarding_status in ('not_started','in_progress','complete')),
  onboarding_step smallint not null default 0 check (onboarding_step between 0 and 4),
  max_session_minutes smallint check (max_session_minutes in (30,45,60,90)),
  prep_mode text check (prep_mode in ('coaching','self-study','both')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

-- Safe upgrades for an earlier prototype profiles table.
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.profiles add column if not exists locale text not null default 'en';
alter table public.profiles add column if not exists onboarding_status text not null default 'not_started';
alter table public.profiles add column if not exists onboarding_step smallint not null default 0;
alter table public.profiles add column if not exists max_session_minutes smallint;
alter table public.profiles add column if not exists prep_mode text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null unique references public.profiles(id) on delete cascade,
  version smallint not null default 1, status text not null default 'in_progress' check (status in ('in_progress','complete')),
  answers jsonb not null default '{}'::jsonb, completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  curriculum_year smallint not null, level text not null, exam_window text not null, target_exam_date date not null,
  starting_stage text not null check (starting_stage in ('not-started','in-progress','revision')),
  status text not null default 'active' check (status in ('active','paused','complete','withdrawn')),
  provisional_weekly_minutes smallint not null check (provisional_weekly_minutes between 120 and 1260),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id, curriculum_year, level)
);

create table if not exists public.availability_rules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), max_session_minutes smallint not null check (max_session_minutes in (30,45,60,90)), unique(user_id, weekday)
);

create table if not exists public.class_schedules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), source text not null default 'onboarding', is_active boolean not null default true, unique(user_id, weekday)
);

create table if not exists public.user_materials (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('schweser-2027','cfai','upload')), display_name text not null,
  relevance_status text not null, relevance_confidence numeric(5,2), mapped_topics jsonb not null default '[]'::jsonb,
  analysis_summary text, storage_path text, created_at timestamptz not null default now()
);

create table if not exists public.user_metrics (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id text not null, readiness smallint not null check (readiness between 0 and 100), coverage smallint not null check (coverage between 0 and 100), unique(user_id, subject_id)
);

create table if not exists public.plan_blocks (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null, duration_minutes smallint not null check (duration_minutes between 5 and 180), title text not null,
  detail text, state text not null check (state in ('done','planned','class','risk','empty')), subject_id text,
  created_by text not null default 'algorithm' check (created_by in ('algorithm','student','coach'))
);

create table if not exists public.test_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id text not null, module_id text, title text not null, score smallint not null check (score between 0 and 100),
  correct smallint not null, total smallint not null, weakest text, confidence_misses smallint not null default 0,
  source text not null check (source in ('roadmap','imported')), completed_at timestamptz not null default now()
);

create index if not exists onboarding_sessions_user_idx on public.onboarding_sessions(user_id);
create index if not exists exam_attempts_user_idx on public.exam_attempts(user_id);
create index if not exists availability_rules_user_idx on public.availability_rules(user_id);
create index if not exists class_schedules_user_idx on public.class_schedules(user_id);
create index if not exists user_materials_user_idx on public.user_materials(user_id);
create index if not exists user_metrics_user_idx on public.user_metrics(user_id);
create index if not exists plan_blocks_user_idx on public.plan_blocks(user_id);
create index if not exists test_records_user_idx on public.test_records(user_id);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name) values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))) on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.onboarding_sessions enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.availability_rules enable row level security;
alter table public.class_schedules enable row level security;
alter table public.user_materials enable row level security;
alter table public.user_metrics enable row level security;
alter table public.plan_blocks enable row level security;
alter table public.test_records enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using ((select auth.uid()) = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert with check ((select auth.uid()) = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
drop policy if exists "onboarding_select_own" on public.onboarding_sessions;
create policy "onboarding_select_own" on public.onboarding_sessions for select using ((select auth.uid()) = user_id);
drop policy if exists "onboarding_insert_own" on public.onboarding_sessions;
create policy "onboarding_insert_own" on public.onboarding_sessions for insert with check ((select auth.uid()) = user_id);
drop policy if exists "onboarding_update_own" on public.onboarding_sessions;
create policy "onboarding_update_own" on public.onboarding_sessions for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "exam_attempts_all_own" on public.exam_attempts;
create policy "exam_attempts_all_own" on public.exam_attempts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "availability_all_own" on public.availability_rules;
create policy "availability_all_own" on public.availability_rules for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "classes_all_own" on public.class_schedules;
create policy "classes_all_own" on public.class_schedules for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "materials_all_own" on public.user_materials;
create policy "materials_all_own" on public.user_materials for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "metrics_all_own" on public.user_metrics;
create policy "metrics_all_own" on public.user_metrics for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "blocks_all_own" on public.plan_blocks;
create policy "blocks_all_own" on public.plan_blocks for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "tests_all_own" on public.test_records;
create policy "tests_all_own" on public.test_records for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);


-- --- Phase 1 Additions ---

create table if not exists public.institutes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists finance_background text;
alter table public.profiles add column if not exists esl boolean default false;
alter table public.profiles add column if not exists no_quant_background boolean default false;
alter table public.profiles add column if not exists stage text;
alter table public.profiles add column if not exists stage_recency_months int;
alter table public.profiles add column if not exists institute_id uuid references public.institutes(id);

create table if not exists public.learning_modules (
  id text primary key,
  topic_id text not null,
  name text not null,
  los_count smallint not null default 1,
  effort_units numeric(5,2) not null,
  difficulty_weight numeric(5,2) not null default 1.0,
  created_at timestamptz not null default now()
);

create table if not exists public.lm_edges (
  from_lm text references public.learning_modules(id) on delete cascade,
  to_lm text references public.learning_modules(id) on delete cascade,
  kind text not null check (kind in ('prerequisite','reinforces','applied_in')),
  strength numeric(5,2) not null default 1.0,
  rationale text,
  primary key (from_lm, to_lm, kind)
);

create table if not exists public.user_module_state (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lm_id text not null references public.learning_modules(id) on delete cascade,
  coverage_state text not null check (coverage_state in ('not_started','taught','studied','verified','decaying')),
  last_verified_at timestamptz,
  planned_hours_consumed numeric(7,2) not null default 0,
  verification_passes smallint not null default 0,
  primary key (user_id, lm_id)
);

create table if not exists public.user_rate_estimate (
  user_id uuid not null references public.profiles(id) on delete cascade,
  topic_id text,
  multiplier numeric(5,2) not null default 1.0,
  n_obs integer not null default 0,
  updated_at timestamptz not null default now()
);
create unique index if not exists user_rate_estimate_global_idx on public.user_rate_estimate (user_id) where topic_id is null;
create unique index if not exists user_rate_estimate_topic_idx on public.user_rate_estimate (user_id, topic_id) where topic_id is not null;

create table if not exists public.questions (
  id text primary key,
  lm_id text not null references public.learning_modules(id) on delete cascade,
  difficulty numeric(5,2) not null default 1.0,
  evidence_kind text not null,
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  per_option_feedback jsonb not null default '{}'::jsonb,
  provenance text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.class_templates (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes(id) on delete cascade,
  cohort_id text not null,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  duration_minutes smallint not null,
  topic_id text
);

create table if not exists public.non_negotiables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  start_time time not null,
  duration_minutes smallint not null,
  label text not null
);

create table if not exists public.onboarding_drafts (
  nonce text primary key,
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  claimed_by uuid references auth.users(id) on delete set null
);

alter table public.plan_blocks add column if not exists lm_id text references public.learning_modules(id);
alter table public.plan_blocks add column if not exists block_type text;
alter table public.plan_blocks add column if not exists rationale text not null default '';

-- Enable RLS for new tables
alter table public.institutes enable row level security;
alter table public.learning_modules enable row level security;
alter table public.lm_edges enable row level security;
alter table public.user_module_state enable row level security;
alter table public.user_rate_estimate enable row level security;
alter table public.questions enable row level security;
alter table public.class_templates enable row level security;
alter table public.non_negotiables enable row level security;
alter table public.onboarding_drafts enable row level security;

-- Add RLS policies
drop policy if exists "institutes_select_all" on public.institutes;
create policy "institutes_select_all" on public.institutes for select using (true);
drop policy if exists "learning_modules_select_all" on public.learning_modules;
create policy "learning_modules_select_all" on public.learning_modules for select using (true);
drop policy if exists "lm_edges_select_all" on public.lm_edges;
create policy "lm_edges_select_all" on public.lm_edges for select using (true);
drop policy if exists "questions_select_all" on public.questions;
create policy "questions_select_all" on public.questions for select using (true);

drop policy if exists "user_module_state_all_own" on public.user_module_state;
create policy "user_module_state_all_own" on public.user_module_state for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "user_rate_estimate_all_own" on public.user_rate_estimate;
create policy "user_rate_estimate_all_own" on public.user_rate_estimate for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "non_negotiables_all_own" on public.non_negotiables;
create policy "non_negotiables_all_own" on public.non_negotiables for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "onboarding_drafts_all" on public.onboarding_drafts;
-- Retired pre-signup screening drafts have no public access policy.
-- Data is retained for controlled migration/deletion by the project owner.
drop policy if exists "class_templates_select_all" on public.class_templates;
create policy "class_templates_select_all" on public.class_templates for select using (true);


-- --- Onboarding v2 (ONBOARDING-V2.md §7) ---
-- Three prototype tables are repurposed rather than replaced. availability_rules
-- moves from one row per weekday to one row per weekday-slot; class_schedules moves
-- from a whole-day flag to a time-bounded recurring commitment; user_materials gains
-- a plain provider string because onboarding no longer analyses uploads.

alter table public.profiles add column if not exists exam_sitting text;
alter table public.profiles add column if not exists exam_date date;
alter table public.profiles add column if not exists registered boolean not null default false;
alter table public.profiles add column if not exists capacity_factor numeric(3,2) not null default 0.85;
alter table public.profiles add column if not exists prior_attempts smallint not null default 0;
alter table public.profiles add column if not exists background text[] not null default '{}';
alter table public.profiles add column if not exists diagnostic_day smallint;   -- ISO 1..7
alter table public.profiles add column if not exists reminder_at time;
alter table public.profiles add column if not exists failure_mode text;

-- The flow is five screens now, not four.
alter table public.profiles drop constraint if exists profiles_onboarding_step_check;
alter table public.profiles add constraint profiles_onboarding_step_check check (onboarding_step between 0 and 5);

-- Availability at slot granularity. Every slot is written on submit, so a missing
-- row is never ambiguous between "unavailable" and "not asked yet".
alter table public.availability_rules add column if not exists slot text;
alter table public.availability_rules add column if not exists available boolean not null default true;
alter table public.availability_rules alter column max_session_minutes drop not null;
alter table public.availability_rules drop constraint if exists availability_rules_weekday_check;
alter table public.availability_rules drop constraint if exists availability_rules_user_id_weekday_key;
alter table public.availability_rules drop constraint if exists availability_rules_slot_check;
alter table public.availability_rules add constraint availability_rules_weekday_check check (weekday between 1 and 7);
alter table public.availability_rules add constraint availability_rules_slot_check check (slot in ('morning','afternoon','evening'));
create unique index if not exists availability_rules_user_slot_idx on public.availability_rules (user_id, weekday, slot);

-- Recurring commitments: many per day, each with a start and an end.
alter table public.class_schedules add column if not exists kind text;
alter table public.class_schedules add column if not exists start_time time;
alter table public.class_schedules add column if not exists end_time time;
alter table public.class_schedules drop constraint if exists class_schedules_weekday_check;
alter table public.class_schedules drop constraint if exists class_schedules_user_id_weekday_key;
alter table public.class_schedules drop constraint if exists class_schedules_kind_check;
alter table public.class_schedules add constraint class_schedules_weekday_check check (weekday between 1 and 7);
alter table public.class_schedules add constraint class_schedules_kind_check check (kind is null or kind in ('class','work','travel','other'));

-- Onboarding records which provider the student owns; analysis happens later, in product.
alter table public.user_materials add column if not exists provider text;
alter table public.user_materials alter column source_type drop not null;
alter table public.user_materials alter column display_name drop not null;
alter table public.user_materials drop constraint if exists user_materials_source_type_check;

-- Resume support: which screen the student left off on, and their answers so far.
alter table public.onboarding_sessions add column if not exists current_screen smallint not null default 1;
alter table public.onboarding_sessions add column if not exists partial jsonb not null default '{}'::jsonb;

-- --- Final Phase 0 / 1 Execution Additions ---

-- 1. Ensure starts_at and duration_minutes exist (additive for legacy table)
alter table public.plan_blocks add column if not exists starts_at timestamptz;
alter table public.plan_blocks add column if not exists duration_minutes smallint check (duration_minutes between 5 and 180);
alter table public.plan_blocks add column if not exists created_by text not null default 'algorithm' check (created_by in ('algorithm','student','coach'));

-- 2. Expand plan_blocks state enum to include 'floating', 'timed', 'deferred'
alter table public.plan_blocks drop constraint if exists plan_blocks_state_check;
alter table public.plan_blocks add constraint plan_blocks_state_check check (state in ('done','planned','class','risk','empty','floating','timed','deferred'));

-- 3. Cycle and Draft models
create table if not exists public.planning_cycles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','closed','superseded')),
  created_at timestamptz not null default now()
);

create table if not exists public.plan_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid references public.planning_cycles(id) on delete set null,
  draft_json jsonb not null default '{}'::jsonb,
  status text not null default 'preparing' check (status in ('preparing','ready','accepted','superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planning_cycles enable row level security;
alter table public.plan_drafts enable row level security;

drop policy if exists "planning_cycles_all_own" on public.planning_cycles;
create policy "planning_cycles_all_own" on public.planning_cycles for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "plan_drafts_all_own" on public.plan_drafts;
create policy "plan_drafts_all_own" on public.plan_drafts for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

