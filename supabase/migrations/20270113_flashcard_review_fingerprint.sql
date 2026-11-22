-- 20270112's review fingerprint covered the computed schedule. A retry recomputes it from the card AFTER the first rating applied, so an exact retry of a lost-response
-- rating would have looked like a different request. A review request is (card, expected revision, rating): fingerprint exactly that, and refuse an unknown rating.
-- Patches the effective function in place (CREATE OR REPLACE keeps the ACL; restated below). 20270112 is untouched.
do $$
declare d text;
begin
  select pg_get_functiondef('public.flashcard_apply(text, text, uuid, integer, jsonb)'::regprocedure) into d;
  if position('p_f->>''rating''' in d) = 0 then
    d := replace(d, 'coalesce(p_f::text, '''')', 'case when p_action = ''review'' then coalesce(p_f->>''rating'', '''') else coalesce(p_f::text, '''') end');
    d := replace(d, 'if (p_f->>''dueAt'') is null or', 'if coalesce(p_f->>''rating'', '''') not in (''again'', ''hard'', ''good'', ''easy'') or (p_f->>''dueAt'') is null or');
    if position('p_f->>''rating''' in d) = 0 or position('not in (''again''' in d) = 0 then raise exception 'flashcard_apply patch did not apply'; end if;
    execute d;
  end if;
end $$;
revoke all on function public.flashcard_apply(text, text, uuid, int, jsonb) from public, anon;
grant execute on function public.flashcard_apply(text, text, uuid, int, jsonb) to authenticated;
notify pgrst, 'reload schema';
