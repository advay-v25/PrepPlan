-- Step 3 answers must reach the roadmap. The roadmap reads starting position from
-- user_module_state, not user_topic_exposure, so a topic marked "working on now" changed nothing.
-- This replaces the position save so it also writes self-reported module coverage:
--   working on now -> taught, covered before -> studied.
-- A self-report never overwrites 'verified' (only a diagnostic earns that), and re-saving first
-- clears the previous self-reported rows this screen wrote, so unticking a topic really unticks it.

create or replace function public.onboarding_replace_position(
  p_user uuid, p_stage text, p_exposure jsonb
) returns void language plpgsql as $$
declare e jsonb; v_state text;
begin
  update public.profiles set stage = p_stage where id = p_user;
  if not found then raise exception 'no profile for user'; end if;

  delete from public.user_topic_exposure where user_id = p_user and source = 'self_report';
  delete from public.user_module_state
   where user_id = p_user and source = 'self_report' and coverage_state in ('taught', 'studied');

  for e in select * from jsonb_array_elements(coalesce(p_exposure, '[]'::jsonb)) loop
    insert into public.user_topic_exposure (user_id, topic_id, recency, source)
    values (p_user, e->>'topic_id', e->>'recency', 'self_report');

    v_state := case e->>'recency' when 'current' then 'taught' else 'studied' end;
    insert into public.user_module_state (user_id, lm_id, coverage_state, source, updated_at)
    select p_user, m.id, v_state, 'self_report', now()
      from public.learning_modules m
     where m.topic_id = e->>'topic_id'
    on conflict (user_id, lm_id) do update
      set coverage_state = excluded.coverage_state, source = 'self_report', updated_at = now()
      where public.user_module_state.coverage_state <> 'verified';
  end loop;
end $$;

revoke all on function public.onboarding_replace_position(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.onboarding_replace_position(uuid, text, jsonb) to service_role;
