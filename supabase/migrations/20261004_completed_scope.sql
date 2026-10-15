-- Completed-cycle scope for tests.
--   * block_scope_confirmations: the learning outcomes a student confirms a partial /
--     reading-level Calendar block actually covered (never guessed silently).
--   * paper_scope_snapshots: the exact scope a paper was assembled from, frozen when
--     the attempt starts (written by the server).
--   * assessment_items.outcome_id: each item maps to a 2027 learning outcome directly,
--     so bank coverage is measured per outcome and per reading.
create table if not exists public.block_scope_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  block_id text not null references public.plan_blocks(id) on delete cascade,
  outcome_id text not null references public.reading_los(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (block_id, outcome_id)
);
create index if not exists block_scope_confirmations_user_idx on public.block_scope_confirmations (user_id, block_id);

create table if not exists public.paper_scope_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_id uuid references public.planning_cycles(id) on delete set null,
  purpose text not null,
  revision text not null,
  scope jsonb not null,
  attempt_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists paper_scope_snapshots_user_idx on public.paper_scope_snapshots (user_id, created_at desc);

alter table public.block_scope_confirmations enable row level security;
alter table public.paper_scope_snapshots enable row level security;
drop policy if exists block_scope_confirmations_own on public.block_scope_confirmations;
create policy block_scope_confirmations_own on public.block_scope_confirmations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists paper_scope_snapshots_read_own on public.paper_scope_snapshots;
create policy paper_scope_snapshots_read_own on public.paper_scope_snapshots for select using (auth.uid() = user_id);

alter table public.assessment_items add column if not exists outcome_id text references public.reading_los(id);
create index if not exists assessment_items_outcome_idx on public.assessment_items (outcome_id);
update public.assessment_items i set outcome_id = m.outcome_id
from public.concept_outcome_map m where m.concept_id = i.concept_id and i.outcome_id is null;
