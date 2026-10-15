-- The actual, primary cause of "DELETE /api/account/delete" failing (confirmed
-- by direct testing — 20261013_auth_cascade_fixes.sql alone did not fix it):
-- public.profiles.id references auth.users(id) with NO ON DELETE CASCADE
-- (confdeltype = 'a', "no action"). Since every real user has a profiles row,
-- this blocked account deletion outright, for every account, not just the
-- five edge-case tables fixed in 20261013. profiles predates this project's
-- migration history (its CREATE TABLE is not tracked anywhere in
-- supabase/migrations — only later ALTER TABLE ADD COLUMN statements are), so
-- this is a fix against the live constraint, not a rerun of its creation.
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade;

-- public.handle_new_user() and its trigger on_auth_user_created (which gives
-- every new signup a profiles row) are also live-only, not tracked in any
-- migration — a fresh environment built from supabase/migrations alone would
-- have no way to create a profile on signup at all. Recreated here verbatim
-- from the live definition so it's no longer solely a dashboard artifact.
-- Idempotent: CREATE OR REPLACE and DROP ... IF EXISTS make this safe to run
-- again, and on conflict do nothing in the function body already protects
-- against a duplicate profile row if the trigger somehow fires twice.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$function$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
