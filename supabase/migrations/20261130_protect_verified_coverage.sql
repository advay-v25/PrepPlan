-- A student's own report must never replace what their answers established. The coverage route used an unconditional upsert, so a
-- self-reported "not started" overwrote a diagnostic-verified module (state and provenance). Guarded where the row is written, so every
-- writer (route, RPC, script) obeys it:
--   * a self_report write may not replace a row that is 'verified' or whose source is 'diagnostic';
--   * a self_report write may not itself claim 'verified'.
-- Class, task-completion and diagnostic writers (their own rules) are unaffected, as is a self-report over any other row. Refusal is
-- SQLSTATE CV409 with the learning-module id in DETAIL; a multi-row statement is refused as a whole.
create or replace function public.user_module_state_protect_verified() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.source = 'self_report' then
    if new.coverage_state = 'verified' and (tg_op = 'INSERT' or old.coverage_state <> 'verified') then
      raise exception 'SELF_REPORT_CANNOT_VERIFY' using errcode = 'CV409', detail = new.lm_id;
    end if;
    if tg_op = 'UPDATE' and (old.coverage_state = 'verified' or old.source = 'diagnostic')
       and (old.coverage_state, old.source) is distinct from (new.coverage_state, new.source) then
      raise exception 'VERIFIED_COVERAGE_PROTECTED' using errcode = 'CV409', detail = new.lm_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_verified on public.user_module_state;
create trigger protect_verified before insert or update on public.user_module_state
  for each row execute function public.user_module_state_protect_verified();
revoke all on function public.user_module_state_protect_verified() from public, anon, authenticated;
