-- Use the attempt lock first for both writes. The answer and its bounded timing
-- are accepted together, and any stale, closed or timed-out save rolls back both.
create function public.save_attempt_answer(p_attempt uuid, p_item text, p_selected integer, p_confidence integer,
  p_active integer, p_interrupted integer, p_flagged boolean, p_client_seq bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_timing jsonb;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  -- Match the existing answer and scoring commands. Progress needs a weaker
  -- share lock, so entering it under this lock cannot produce a lock upgrade.
  perform 1 from public.assessment_attempts where id = p_attempt and user_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;
  v_timing := public.record_item_progress(p_attempt, v_user, p_item, p_active, p_interrupted, false, p_flagged);
  perform public.save_attempt_response(p_attempt, p_item, p_selected, p_confidence,
    coalesce((v_timing->>'activeSeconds')::int, 0), coalesce((v_timing->>'interruptedSeconds')::int, 0),
    p_flagged, p_client_seq);
  return jsonb_build_object('ok', true, 'activeSeconds', coalesce((v_timing->>'activeSeconds')::int, 0));
end $$;
revoke all on function public.save_attempt_answer(uuid, text, integer, integer, integer, integer, boolean, bigint) from public, anon, authenticated;
grant execute on function public.save_attempt_answer(uuid, text, integer, integer, integer, integer, boolean, bigint) to authenticated;
