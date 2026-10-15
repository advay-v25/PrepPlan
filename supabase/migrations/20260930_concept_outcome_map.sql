-- Links existing test concepts (what evidence is recorded against) to the 2027
-- learning outcomes, so readiness can be shown per outcome without rewriting
-- evidence. Additive reference data; approximate mappings are flagged.
create table if not exists public.concept_outcome_map (
  concept_id uuid primary key references public.curriculum_concepts(id) on delete cascade,
  outcome_id text not null references public.reading_los(id) on delete cascade,
  approximate boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists concept_outcome_map_outcome_idx on public.concept_outcome_map (outcome_id);
alter table public.concept_outcome_map enable row level security;
drop policy if exists concept_outcome_map_read on public.concept_outcome_map;
create policy concept_outcome_map_read on public.concept_outcome_map for select to authenticated using (true);
