-- Student notes (one document per subject or reading) and flashcards.
-- Own rows only (RLS). Notes autosave with a revision guard. Flashcard ratings are
-- self-report: they schedule review and never change evidence or a readiness band.
create table if not exists public.curriculum_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('subject', 'reading')),
  scope_id text not null,
  doc jsonb not null,
  revision integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, scope_type, scope_id),
  check (pg_column_size(doc) <= 262144)
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope_type text not null check (scope_type in ('subject', 'reading')),
  scope_id text not null,
  front text not null check (char_length(btrim(front)) between 1 and 1000),
  back text not null check (char_length(btrim(back)) between 1 and 2000),
  source text not null default 'manual' check (source in ('manual', 'outcome_prompt')),
  due_at timestamptz not null default now(),
  interval_days numeric(7,2) not null default 0,
  ease numeric(4,2) not null default 2.5 check (ease between 1.3 and 3.5),
  reps integer not null default 0,
  lapses integer not null default 0,
  last_reviewed_at timestamptz,
  suspended boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists flashcards_user_due_idx on public.flashcards (user_id, due_at) where not suspended;
create index if not exists flashcards_scope_idx on public.flashcards (user_id, scope_type, scope_id);

alter table public.curriculum_notes enable row level security;
alter table public.flashcards enable row level security;
drop policy if exists curriculum_notes_own on public.curriculum_notes;
create policy curriculum_notes_own on public.curriculum_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists flashcards_own on public.flashcards;
create policy flashcards_own on public.flashcards for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
