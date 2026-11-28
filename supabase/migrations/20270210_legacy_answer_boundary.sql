-- Keep old diagnostic links compatible while applying the current answer rules.
create or replace function public.record_assessment_response(
  p_attempt_id uuid, p_item_id text, p_selected_option integer,
  p_confidence integer, p_elapsed_seconds integer
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_response uuid;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  perform 1 from public.assessment_attempts
    where id = p_attempt_id and user_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;

  select id into v_response from public.assessment_responses
    where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user;
  if found then return v_response; end if;

  perform public.save_attempt_answer(p_attempt_id, p_item_id, p_selected_option,
    p_confidence, p_elapsed_seconds, 0, false, null);
  select id into strict v_response from public.assessment_responses
    where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user;
  return v_response;
end $$;

revoke all on function public.record_assessment_response(uuid, text, integer, integer, integer) from public, anon;
revoke all on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean, bigint)
  from public, anon, authenticated;
