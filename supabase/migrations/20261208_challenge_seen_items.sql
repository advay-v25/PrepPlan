-- A question is reportable once the student has SEEN it, not only once the attempt has an answer. A paper that is still 'ready' (nothing
-- answered yet) has an attempt_item_progress row for each question the student has opened; that row, or a started attempt, is the proof of
-- exposure. A reserved question nobody opened (including a not-yet-started mock session's held-out questions) stays inaccessible.
create or replace function public.raise_item_challenge(p_attempt_id uuid, p_item_id text, p_comment text, p_reason_code text)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid; v_att record; v_id uuid; v_challenge_id uuid; v_seen boolean;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;
  select * into v_att from public.assessment_attempts where id = p_attempt_id and user_id = v_user_id for update;
  if v_att is not null then
    v_seen := (v_att.status in ('in_progress', 'submitted', 'scored', 'partially_voided', 'rescored', 'expired')
               and (exists (select 1 from public.form_items fi where fi.form_id = v_att.form_id and fi.item_id = p_item_id)
                    or exists (select 1 from public.assessment_responses r where r.attempt_id = p_attempt_id and r.item_id = p_item_id and r.user_id = v_user_id)))
              or exists (select 1 from public.attempt_item_progress p where p.attempt_id = p_attempt_id and p.item_id = p_item_id and p.user_id = v_user_id);
  end if;
  -- One message for every refusal: a foreign attempt, an unseen question and a question not on the form look alike.
  if v_att is null or not coalesce(v_seen, false) then raise exception 'Response not found'; end if;
  select id into v_id from public.item_challenges where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.item_challenges (user_id, item_id, attempt_id, comment, reason_code, status)
    values (v_user_id, p_item_id, p_attempt_id, p_comment, coalesce(p_reason_code, 'other'), 'pending') returning id into v_challenge_id;
  update public.evidence_events set validity = 'disputed', validity_reason = 'challenge_pending'
    where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id and validity = 'valid';
  return v_challenge_id;
end;
$function$;
