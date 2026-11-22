-- A retry key now names ONE complete reviewed request: concept + authenticated reviewer + decision + the scope hash that was shown + the normalised
-- reason. 20270107 replayed on reviewer and decision alone, so a changed scope hash or reason under the same key could report success for a request that
-- was never made. Additive: 20270107/20270108 are untouched; this patches the effective function in place and restates its ACL. No storage change:
-- the audit row already holds reviewer, decision, scope_hash and rationale, so the receipt is rebuilt from the ORIGINAL decision and never from the
-- concept's current state (which a later edit or a later decision may have changed). Historical rows are not rewritten or back-filled.
--   exact retry (lost response, or concurrent identical)  -> the original receipt, replay = true, nothing written
--   same key, anything materially different               -> KEY_CONFLICT, nothing written
--   key shorter than 8 / longer than 100, reason longer than 1000 -> refused, never truncated into a colliding request
-- Concurrent requests serialise on the concept row lock, so the second one always sees the first one's audit row.
create or replace function public.decide_concept_signoff(p_concept uuid, p_decision text, p_expected_hash text, p_rationale text, p_request_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_c public.curriculum_concepts%rowtype; v_hash text;
  v_why text := btrim(regexp_replace(coalesce(p_rationale, ''), '\s+', ' ', 'g'));
  v_prior public.concept_signoffs%rowtype; v_active boolean; v_affected int := 0;
begin
  if v_uid is null or not public.is_item_reviewer() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can sign off a concept.'); end if;
  if p_decision not in ('verify', 'withdraw') then return jsonb_build_object('ok', false, 'code', 'BAD_DECISION', 'message', 'The decision must be verify or withdraw.'); end if;
  if coalesce(btrim(p_expected_hash), '') = '' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'message', 'The scope you were shown is required.'); end if;
  if p_request_key is not null and char_length(p_request_key) not between 8 and 100 then return jsonb_build_object('ok', false, 'code', 'BAD_KEY', 'message', 'The request key must be 8 to 100 characters.'); end if;
  if char_length(v_why) > 1000 then return jsonb_build_object('ok', false, 'code', 'RATIONALE_TOO_LONG', 'message', 'Keep the reason to 1000 characters; nothing was cut or recorded.'); end if;
  if char_length(v_why) < 8 then return jsonb_build_object('ok', false, 'code', 'RATIONALE_REQUIRED', 'message', 'Say in a sentence why (at least 8 characters).'); end if;
  select * into v_c from public.curriculum_concepts where id = p_concept for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown concept.'); end if;
  select is_active into v_active from public.curriculum_manifests where id = v_c.manifest_id;
  if not coalesce(v_active, false) then return jsonb_build_object('ok', false, 'code', 'MANIFEST_NOT_ACTIVE', 'message', 'Only concepts of the active edition can be signed off.'); end if;
  if p_request_key is not null then
    select * into v_prior from public.concept_signoffs where concept_id = p_concept and request_key = p_request_key;
    if found then
      if v_prior.reviewer_id is distinct from v_uid or v_prior.decision is distinct from p_decision or v_prior.scope_hash is distinct from p_expected_hash
         or (v_prior.rationale is distinct from v_why and v_prior.rationale is distinct from btrim(coalesce(p_rationale, ''))) then
        return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT', 'message', 'This request key was already used for a different request (another decision, scope, reviewer or reason). Nothing was changed.');
      end if;
      return jsonb_build_object('ok', true, 'replay', true, 'decision', v_prior.decision, 'status', case when v_prior.decision = 'verify' then 'verified' else 'drafted' end,
        'approvedItemsStillLive', v_prior.approved_items_affected, 'signoffId', v_prior.id, 'decidedAt', v_prior.created_at, 'currentStatus', v_c.verification_status);
    end if;
  end if;
  v_hash := public.concept_scope_hash(v_c.name, v_c.scope_notes, v_c.excluded_or_superseded, v_c.manifest_id);
  if v_hash <> p_expected_hash then return jsonb_build_object('ok', false, 'code', 'STALE_SCOPE', 'message', 'The scope changed after you opened it. Reload and read it again.'); end if;
  if p_decision = 'verify' then
    if coalesce(btrim(v_c.scope_notes), '') = '' then return jsonb_build_object('ok', false, 'code', 'NO_SCOPE', 'message', 'This concept has no scope written for it yet. There is nothing to sign off.'); end if;
    if v_c.verification_status = 'verified' then return jsonb_build_object('ok', true, 'unchanged', true, 'status', 'verified'); end if;
  else
    if v_c.verification_status <> 'verified' then return jsonb_build_object('ok', true, 'unchanged', true, 'status', v_c.verification_status); end if;
    select count(*) into v_affected from public.assessment_items i where i.concept_id = p_concept and i.review_status = 'reviewed';
  end if;
  perform set_config('app.concept_signoff', 'on', true);
  update public.curriculum_concepts set verification_status = case when p_decision = 'verify' then 'verified' else 'drafted' end where id = p_concept;
  insert into public.concept_signoffs (concept_id, manifest_id, decision, reviewer_id, scope_hash, scope_snapshot, rationale, request_key, approved_items_affected)
  values (p_concept, v_c.manifest_id, p_decision, v_uid, v_hash, jsonb_build_object('name', v_c.name, 'scope', v_c.scope_notes, 'excluded', v_c.excluded_or_superseded), v_why, p_request_key, v_affected);
  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', case when p_decision = 'verify' then 'verified' else 'drafted' end, 'approvedItemsStillLive', v_affected);
end $$;
revoke all on function public.decide_concept_signoff(uuid, text, text, text, text) from public, anon;
grant execute on function public.decide_concept_signoff(uuid, text, text, text, text) to authenticated;
notify pgrst, 'reload schema';
