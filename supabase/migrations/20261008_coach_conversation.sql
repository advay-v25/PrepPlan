-- Coach: a saved conversation, and proposals that carry what they would change.
-- The Coach only ever writes proposals; a student's confirmation executes them.

create table if not exists public.coach_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('student', 'coach')),
  body text not null check (char_length(body) between 1 and 4000),
  intent text,
  proposal_ids uuid[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists coach_messages_user_created_idx on public.coach_messages (user_id, created_at);

alter table public.coach_messages enable row level security;
drop policy if exists "coach_messages_all_own" on public.coach_messages;
create policy "coach_messages_all_own" on public.coach_messages for all
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Coach proposals: one row per suggested change, confirmed or dismissed by the student.
alter table public.coach_proposals add column if not exists message_id uuid references public.coach_messages(id) on delete set null;
alter table public.coach_proposals add column if not exists kind text;
alter table public.coach_proposals add column if not exists title text;
alter table public.coach_proposals add column if not exists decided_at timestamptz;
create index if not exists coach_proposals_user_status_idx on public.coach_proposals (user_id, status, created_at desc);
