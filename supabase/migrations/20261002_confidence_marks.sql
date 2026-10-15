-- The student's own confidence marks and manual overrides, per outcome or reading.
-- Own rows only (RLS). Marks and overrides are self-report: they are shown beside
-- the evidence and verified against it, and never change evidence or the band.
create table if not exists public.confidence_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('outcome', 'reading')),
  scope_id text not null,
  level text not null check (level in ('not_started', 'shaky', 'fairly_sure', 'solid')),
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_type, scope_id)
);

create table if not exists public.evidence_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outcome_id text not null references public.reading_los(id) on delete cascade,
  overridden_band text not null check (overridden_band in ('repair', 'verify', 'maintain', 'untested')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists evidence_overrides_one_active_idx on public.evidence_overrides (user_id, outcome_id) where revoked_at is null;

alter table public.confidence_marks enable row level security;
alter table public.evidence_overrides enable row level security;

drop policy if exists confidence_marks_own on public.confidence_marks;
create policy confidence_marks_own on public.confidence_marks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists evidence_overrides_own on public.evidence_overrides;
create policy evidence_overrides_own on public.evidence_overrides for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
