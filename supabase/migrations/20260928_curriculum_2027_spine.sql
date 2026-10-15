-- The 2027 curriculum spine: subject (topics) -> reading -> module -> outcome.
--
-- Additive reference data. Nothing existing is altered or removed:
-- learning_modules, curriculum_concepts, user_module_state and the roadmap keep
-- working while the new pages read this spine. Readings carry their Schweser
-- page span, and effort is derived from it. Tables are public reference data:
-- readable by signed-in users, writable only with the service role.

create table if not exists public.curriculum_readings (
  id text primary key,
  reading_no integer not null unique,
  topic_id text not null references public.topics(id),
  title text not null,
  sequence integer not null,
  start_page integer not null,
  page_count integer not null check (page_count > 0),
  effort_units numeric(5,2) not null check (effort_units > 0),
  effort_band smallint not null check (effort_band between 1 and 5),
  summary text,
  relevance text,
  structure_pending boolean not null default false,
  is_active boolean not null default true,
  legacy_module_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists curriculum_readings_topic_idx on public.curriculum_readings (topic_id, sequence);

create table if not exists public.reading_modules (
  id text primary key,
  reading_id text not null references public.curriculum_readings(id) on delete cascade,
  module_no text not null,
  title text not null,
  start_page integer not null,
  sequence integer not null,
  unique (reading_id, module_no)
);

create table if not exists public.reading_los (
  id text primary key,
  reading_id text not null references public.curriculum_readings(id) on delete cascade,
  module_id text references public.reading_modules(id) on delete set null,
  code text not null,
  title text not null,
  page integer not null,
  sequence integer not null,
  unique (reading_id, code)
);
create index if not exists reading_los_reading_idx on public.reading_los (reading_id, sequence);

alter table public.curriculum_readings enable row level security;
alter table public.reading_modules enable row level security;
alter table public.reading_los enable row level security;

drop policy if exists curriculum_readings_read on public.curriculum_readings;
create policy curriculum_readings_read on public.curriculum_readings for select to authenticated using (true);
drop policy if exists reading_modules_read on public.reading_modules;
create policy reading_modules_read on public.reading_modules for select to authenticated using (true);
drop policy if exists reading_los_read on public.reading_los;
create policy reading_los_read on public.reading_los for select to authenticated using (true);
