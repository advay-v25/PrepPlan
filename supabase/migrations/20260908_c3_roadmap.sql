-- C3: the long-term curriculum roadmap.
--
-- The roadmap is what decides how and when everything gets studied, when tests
-- fall, and what "behind" actually means. It needs three things the schema did
-- not have: a topic layer above modules, effort and sequencing on the graph,
-- and somewhere to record a plan so that planned can be compared with actual.

-- 1. Topics ------------------------------------------------------------------
create table if not exists public.topics (
  id text primary key,
  name text not null,
  -- Published CFA Level I exam weighting, as a range. Stored as the range
  -- rather than a single number because that is how it is published, and the
  -- midpoint is a planning choice made in code, not a fact.
  exam_weight_min numeric(4,1) not null,
  exam_weight_max numeric(4,1) not null,
  -- Typical teaching order. A starting point for sequencing, not a constraint —
  -- prerequisites in lm_edges are what actually bind.
  default_sequence smallint not null,
  summary text,
  created_at timestamptz not null default now()
);
alter table public.topics enable row level security;
drop policy if exists "topics_read_all" on public.topics;
create policy "topics_read_all" on public.topics for select using (true);

-- 2. Modules gain what planning needs ---------------------------------------
alter table public.learning_modules add column if not exists topic_ref text references public.topics(id);
-- Relative effort, 1–5. Never hours: it says FSA is roughly twice Derivatives,
-- and the exam date decides what that means in weeks.
alter table public.learning_modules add column if not exists effort_band smallint
  check (effort_band between 1 and 5);
alter table public.learning_modules add column if not exists sequence_hint smallint;
alter table public.learning_modules add column if not exists summary text;
alter table public.learning_modules add column if not exists is_active boolean not null default true;

create index if not exists learning_modules_topic_idx on public.learning_modules(topic_ref, sequence_hint);

-- 3. The roadmap itself ------------------------------------------------------
create table if not exists public.study_roadmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_window_id uuid references public.exam_windows(id),
  target_date date not null,
  route text not null default 'self_study' check (route in ('self_study', 'coaching', 'hybrid')),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded', 'discarded')),
  -- The phase boundaries this roadmap committed to, and the inputs that
  -- produced them. Kept so a later plan can be compared with what was actually
  -- assumed, rather than silently re-deriving different numbers.
  phases jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '{}'::jsonb,
  feasibility jsonb not null default '{}'::jsonb,
  revision integer not null default 1,
  generated_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.study_roadmaps enable row level security;
drop policy if exists "study_roadmaps_all_own" on public.study_roadmaps;
create policy "study_roadmaps_all_own" on public.study_roadmaps
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists study_roadmaps_user_idx on public.study_roadmaps(user_id, status);

-- 4. Milestones --------------------------------------------------------------
-- Scope allocated to a range of weeks, not hours to days. The range is the
-- point: an exact completion date nine months out would be a fiction.
create table if not exists public.roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  roadmap_id uuid not null references public.study_roadmaps(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phase text not null check (phase in ('first_pass', 'consolidation', 'revision', 'final')),
  topic_ref text references public.topics(id),
  lm_id text references public.learning_modules(id),
  sequence smallint not null,
  -- Week numbers are relative to the roadmap's first study week, so a shifted
  -- start does not corrupt every stored date.
  planned_start_week smallint not null,
  planned_end_week smallint not null,
  planned_start_date date not null,
  planned_end_date date not null,
  effort_weight numeric(8,3) not null default 0,
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'complete', 'skipped', 'deferred')),
  created_at timestamptz not null default now()
);
alter table public.roadmap_milestones enable row level security;
drop policy if exists "roadmap_milestones_all_own" on public.roadmap_milestones;
create policy "roadmap_milestones_all_own" on public.roadmap_milestones
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create index if not exists roadmap_milestones_roadmap_idx on public.roadmap_milestones(roadmap_id, sequence);

-- 5. Where the student says they already are ---------------------------------
-- user_module_state exists but has no notion of who said so. A self-report is
-- context; a diagnostic is evidence. Conflating them is how an app tells a
-- student they know something because they ticked a box.
alter table public.user_module_state add column if not exists source text not null default 'self_report'
  check (source in ('self_report', 'class', 'task_completion', 'diagnostic'));
alter table public.user_module_state add column if not exists updated_at timestamptz not null default now();

notify pgrst, 'reload schema';
