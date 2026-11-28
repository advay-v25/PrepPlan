alter table public.profiles
  add column entry_revision_completed boolean,
  add column entry_last_mock_feeling text check (
    entry_last_mock_feeling in ('not_taken', 'below_target', 'near_target', 'on_target', 'unscored')
  );

-- Reuse the canonical position write, including its freshness check and single version increment.
create function public.onboarding_commit_position_context(p_user uuid, p_args jsonb, p_expected integer)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_result jsonb;
  v_status text;
  v_current integer;
begin
  perform public.scope_lock(p_user);
  select onboarding_status, onboarding_context_version into strict v_status, v_current
    from public.profiles where id = p_user for update;

  if p_expected is null then
    if v_status = 'complete' then
      return jsonb_build_object('ok', false, 'code', 'STALE_SETUP', 'currentVersion', v_current);
    end if;
    v_result := jsonb_build_object('ok', true, 'version', public.onboarding_commit_step(p_user, 'position', p_args));
  else
    v_result := public.onboarding_commit_step_checked(p_user, 'position', p_args, p_expected);
  end if;

  if v_result->>'ok' = 'true' then
    update public.profiles set
      entry_revision_completed = case when p_args ? 'revision_completed' then (p_args->>'revision_completed')::boolean else entry_revision_completed end,
      entry_last_mock_feeling = case when p_args ? 'last_mock_feeling' then p_args->>'last_mock_feeling' else entry_last_mock_feeling end
      where id = p_user;
  end if;
  return v_result;
end $$;
revoke all on function public.onboarding_commit_position_context(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.onboarding_commit_position_context(uuid, jsonb, integer) to service_role;

notify pgrst, 'reload schema';
