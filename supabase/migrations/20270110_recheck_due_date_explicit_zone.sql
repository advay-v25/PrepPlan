-- repair_threads.next_recheck_due_at holds a CALENDAR DATE in a timestamptz column (by convention: midnight UTC of that date; see src/lib/repairs/recheckDate.ts).
-- 20261031 converted it with `date::timestamptz` (write, in accept_repair_proposal) and `next_recheck_due_at::date` (read, in place_repair_check). Both conversions use
-- the SESSION time zone, so the stored/read date moved by a day whenever a session was not UTC (written from a UTC+ session: one day early; read from a UTC- session:
-- one day early). Hosted sessions are UTC, so this was latent; it is made explicit here so no session setting can matter. Existing rows were written by UTC sessions
-- and are read the same way, so nothing is rewritten. Additive: the applied migration is untouched; both effective definitions are patched in place (ACL is kept
-- by CREATE OR REPLACE and restated below).
do $$
declare d text;
begin
  select pg_get_functiondef('public.accept_repair_proposal(uuid, text)'::regprocedure) into d;
  if position('at time zone ''UTC'')' in d) = 0 then
    d := replace(d, '((v_wait->>''earliestDate'')::date)::timestamptz', '(((v_wait->>''earliestDate'')::date)::timestamp at time zone ''UTC'')');
    if position('::timestamp at time zone ''UTC''' in d) = 0 then raise exception 'accept_repair_proposal patch did not apply'; end if;
    execute d;
  end if;
  select pg_get_functiondef('public.place_repair_check(uuid[], text)'::regprocedure) into d;
  if position('next_recheck_due_at at time zone ''UTC''' in d) = 0 then
    d := replace(d, 'coalesce(next_recheck_due_at::date, v_today)', 'coalesce((next_recheck_due_at at time zone ''UTC'')::date, v_today)');
    if position('next_recheck_due_at at time zone ''UTC''' in d) = 0 then raise exception 'place_repair_check patch did not apply'; end if;
    execute d;
  end if;
end $$;
revoke all on function public.accept_repair_proposal(uuid, text), public.place_repair_check(uuid[], text) from public, anon;
grant execute on function public.accept_repair_proposal(uuid, text), public.place_repair_check(uuid[], text) to authenticated;
notify pgrst, 'reload schema';
