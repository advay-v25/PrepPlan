-- Question-level timing heartbeats as ONE atomic, monotonic command. The previous route read the row, computed in the app and upserted, so two
-- overlapping heartbeats (or one landing after submission) could lower saved time or rewrite a closed attempt's progress.
-- Contract: the attempt row is locked FOR SHARE (a concurrent submit holds it exclusively, so a late heartbeat waits and then sees "closed");
-- the progress row is locked FOR UPDATE (heartbeats for one question are serialised); saved seconds never decrease.
create or replace function public.record_item_progress(p_attempt uuid, p_user uuid, p_item text, p_active int, p_interrupted int, p_visit boolean, p_flagged boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_a public.assessment_attempts%rowtype; v_prev public.attempt_item_progress%rowtype; v_has boolean;
  v_wall numeric; v_allowed int; v_rep_a int := greatest(coalesce(p_active, 0), 0); v_rep_i int := greatest(coalesce(p_interrupted, 0), 0);
  v_active int; v_int int;
begin
  select * into v_a from public.assessment_attempts where id = p_attempt and user_id = p_user for share;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_a.status not in ('ready', 'in_progress') then return jsonb_build_object('ok', false, 'code', 'closed'); end if;
  if not exists (select 1 from public.form_items where form_id = v_a.form_id and item_id = p_item) then return jsonb_build_object('ok', false, 'code', 'bad_item'); end if;
  select * into v_prev from public.attempt_item_progress where attempt_id = p_attempt and item_id = p_item for update;
  v_has := found;
  v_wall := case when v_has then extract(epoch from (now() - v_prev.last_seen_at))
                 when v_a.started_at is null then 120 else least(3600, greatest(0, extract(epoch from (now() - v_a.started_at)))) end;
  v_allowed := greatest(0, floor(v_wall))::int + 3;
  v_active := least(v_rep_a, coalesce(v_prev.active_seconds, 0) + v_allowed);
  v_int := least(v_rep_i, coalesce(v_prev.interrupted_seconds, 0) + greatest(0, v_allowed - greatest(0, v_active - coalesce(v_prev.active_seconds, 0))));
  v_active := greatest(coalesce(v_prev.active_seconds, 0), v_active); v_int := greatest(coalesce(v_prev.interrupted_seconds, 0), v_int);
  insert into public.attempt_item_progress(attempt_id, item_id, user_id, active_seconds, interrupted_seconds, visits, flagged, last_seen_at)
    values (p_attempt, p_item, p_user, v_active, v_int, 1, coalesce(p_flagged, false), now())
    on conflict (attempt_id, item_id) do update set active_seconds = v_active, interrupted_seconds = v_int,
      visits = public.attempt_item_progress.visits + case when p_visit then 1 else 0 end,
      flagged = coalesce(p_flagged, public.attempt_item_progress.flagged), last_seen_at = now();
  if p_flagged is not null then update public.assessment_responses set flagged = p_flagged where attempt_id = p_attempt and item_id = p_item; end if;
  return jsonb_build_object('ok', true, 'activeSeconds', v_active, 'interruptedSeconds', v_int);
end $$;
revoke all on function public.record_item_progress(uuid, uuid, text, int, int, boolean, boolean) from public, anon, authenticated;
grant execute on function public.record_item_progress(uuid, uuid, text, int, int, boolean, boolean) to service_role;
notify pgrst, 'reload schema';
