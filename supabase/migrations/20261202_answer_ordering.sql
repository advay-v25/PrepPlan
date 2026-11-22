-- Answer saves carry the runner's stamp (client_seq) so a choice that ARRIVES after a newer committed choice cannot replace it.
-- Additive column; the old 7-argument function is dropped because a default-argument overload would make calls ambiguous. Unstamped callers
-- (client_seq null) keep last-write behaviour. Refusal is SQLSTATE ST409.
alter table public.assessment_responses add column if not exists client_seq bigint;

drop function if exists public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean);
create or replace function public.save_attempt_response(p_attempt_id uuid, p_item_id text, p_selected_option integer, p_confidence integer, p_active_seconds integer, p_interrupted_seconds integer, p_flagged boolean, p_client_seq bigint default null) returns json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare
  v_user uuid := auth.uid();
  v_attempt public.assessment_attempts%rowtype;
  v_key smallint;
  v_options jsonb;
  v_correct boolean;
  v_existing public.assessment_responses%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if p_confidence is null or p_confidence not in (1, 3, 5) then raise exception 'Confidence is required'; end if;

  select * into v_attempt from public.assessment_attempts where id = p_attempt_id and user_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;
  if v_attempt.status not in ('ready', 'in_progress', 'assembling') then raise exception 'Attempt is %', v_attempt.status; end if;
  if v_attempt.paused_at is not null then raise exception 'Attempt is paused'; end if;
  if v_attempt.rehearsal_id is not null and v_attempt.deadline_at is null then raise exception 'Session not started'; end if;
  -- A timed session accepts answers until its deadline (plus a few seconds' grace for the last save).
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '10 seconds' then raise exception 'Time is up'; end if;

  if not exists (select 1 from public.form_items where form_id = v_attempt.form_id and item_id = p_item_id) then raise exception 'Item not in form'; end if;
  select key_index, options into v_key, v_options from public.assessment_items where id = p_item_id;
  if v_key is null then raise exception 'Item not found'; end if;
  if p_selected_option is null or p_selected_option < 0 or p_selected_option >= jsonb_array_length(v_options) then raise exception 'That option does not exist'; end if;
  v_correct := (p_selected_option = v_key);

  select * into v_existing from public.assessment_responses where attempt_id = p_attempt_id and item_id = p_item_id;
  if found then
    -- Ordering: the attempt row is locked above, so requests are serial, but they can ARRIVE out of order (a slow earlier request, a second tab, a
    -- retry). A choice stamped older than the stored one must not replace it; the same stamp is a retry and is idempotent.
    if p_client_seq is not null and v_existing.client_seq is not null and p_client_seq < v_existing.client_seq then
      raise exception 'Stale answer' using errcode = 'ST409';
    end if;
    update public.assessment_responses set client_seq = nullif(greatest(coalesce(client_seq, 0), coalesce(p_client_seq, 0)), 0),
      selected_option_index = p_selected_option, is_correct = v_correct, self_reported_confidence = p_confidence,
      active_seconds = greatest(coalesce(active_seconds, 0), coalesce(p_active_seconds, 0)),
      interrupted_seconds = greatest(interrupted_seconds, coalesce(p_interrupted_seconds, 0)),
      flagged = coalesce(p_flagged, flagged), answered_at = now(),
      changed_count = changed_count + case when selected_option_index is distinct from p_selected_option or self_reported_confidence is distinct from p_confidence then 1 else 0 end,
      elapsed_seconds = greatest(coalesce(elapsed_seconds, 0), coalesce(p_active_seconds, 0))
    where id = v_existing.id returning id into v_id;
  else
    insert into public.assessment_responses (user_id, attempt_id, item_id, selected_option_index, is_correct, self_reported_confidence,
      elapsed_seconds, active_seconds, interrupted_seconds, flagged, answered_at, client_seq)
    values (v_user, p_attempt_id, p_item_id, p_selected_option, v_correct, p_confidence,
      p_active_seconds, p_active_seconds, coalesce(p_interrupted_seconds, 0), coalesce(p_flagged, false), now(), p_client_seq)
    returning id into v_id;
  end if;

  if v_attempt.status in ('ready', 'assembling') then
    update public.assessment_attempts set status = 'in_progress', started_at = coalesce(started_at, now()) where id = p_attempt_id;
  end if;
  return json_build_object('id', v_id);
end;
$$;

revoke all on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean, bigint) from public, anon, authenticated, service_role;
grant execute on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean, bigint) to authenticated;
grant execute on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean, bigint) to service_role;
