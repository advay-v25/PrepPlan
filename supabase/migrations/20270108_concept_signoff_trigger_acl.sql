-- The sign-off guard is a trigger function: nobody should be able to call it directly. 20270107 revoked it from public and anon only; hosted default
-- privileges had also granted it to authenticated. Additive; 20270107 is unchanged.
revoke all on function public.guard_concept_signoff() from public, anon, authenticated;
notify pgrst, 'reload schema';
