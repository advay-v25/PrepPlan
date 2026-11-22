-- Version-aware setup commit for completed students' edits. ADDITIVE: it wraps the existing onboarding_commit_step (whatever its current body is)
-- rather than copying it, so later patches to that function keep applying. It takes the same profile row lock, compares the setup version the editor
-- READ with the current one, and either refuses (nothing written, current version returned) or commits and returns the new version, in one transaction.
create or replace function public.onboarding_commit_step_checked(p_user uuid, p_step text, p_args jsonb, p_expected integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cur integer; v_new integer;
begin
  select onboarding_context_version into v_cur from public.profiles where id = p_user for update;
  if not found then raise exception 'Profile not found'; end if;
  if p_expected is not null and v_cur is distinct from p_expected then
    return jsonb_build_object('ok', false, 'code', 'STALE_SETUP', 'currentVersion', v_cur);
  end if;
  v_new := public.onboarding_commit_step(p_user, p_step, p_args);
  return jsonb_build_object('ok', true, 'version', v_new);
end $$;
revoke all on function public.onboarding_commit_step_checked(uuid, text, jsonb, integer) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.onboarding_commit_step_checked(uuid, text, jsonb, integer) to service_role; end if; end $$;
notify pgrst, 'reload schema';
