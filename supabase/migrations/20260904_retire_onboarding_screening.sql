-- Apply separately in the Supabase SQL editor. No rows are deleted.
-- v4 context uses existing onboarding_sessions.answers; no new columns needed.
begin;
alter table public.onboarding_drafts enable row level security;
drop policy if exists "onboarding_drafts_all" on public.onboarding_drafts;
commit;
