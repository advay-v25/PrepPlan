-- schema_migrations had row-level security off and full privileges for anon and authenticated: anyone holding the public anon key could read,
-- rewrite or truncate the migration ledger through the API. Only the runner (table owner, bypasses RLS) touches it.
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from public, anon, authenticated;
