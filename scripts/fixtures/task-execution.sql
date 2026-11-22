-- Isolated command dependency fixture, NOT a baseline for installing the app.
-- No hosted project or real account data is used by foundation-db-test.cjs.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, onboarding_status text not null
);
create table public.plan_blocks (
  id text primary key,
  user_id uuid not null references public.profiles(id),
  title text not null,
  duration text not null default '45',
  detail text not null default 'Fixture',
  state text,
  local_date date,
  starts_at timestamptz,
  duration_minutes smallint not null check (duration_minutes between 5 and 180),
  placement text not null,
  execution text not null check (execution in ('not_started','in_progress','partial','completed','skipped','deferred','cancelled')),
  outcome_id text,
  lm_id text,
  task_type text default 'study',
  is_protected_commitment boolean not null default false,
  cancelled_at timestamptz,
  cycle_id uuid,
  learning_objective text,
  suggested_approach text,
  origin text default 'student',
  created_by text default 'student',
  revision integer not null default 1,
  updated_at timestamptz not null default now()
);
create table public.task_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id text not null references public.plan_blocks(id) on delete cascade,
  event_type text not null check (event_type in ('created','started','completed','partial','deferred','skipped','moved','split','duration_changed','details_changed','undone','cancelled','evidence_disputed','evidence_restored','origin_invalidated')),
  payload jsonb not null default '{}',
  previous jsonb not null default '{}',
  actual_duration_minutes smallint,
  notes text,
  created_at timestamptz not null default now()
);
-- A sentinel: marking a block done must never manufacture test evidence.
create table public.evidence_events (id uuid primary key default gen_random_uuid());
create table public.planning_cycles (id uuid primary key, user_id uuid not null, status text not null);
create table public.reading_los (id text primary key, reading_id text not null);
create table public.block_scope_confirmations (
  user_id uuid not null references auth.users(id) on delete cascade, block_id text not null references public.plan_blocks(id) on delete cascade,
  outcome_id text not null references public.reading_los(id), unique(block_id,outcome_id)
);
grant select,insert,update,delete on public.block_scope_confirmations to authenticated;
