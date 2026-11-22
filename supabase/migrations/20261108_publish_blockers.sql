-- Phase 2 (b): one definition of "why is publication blocked", used by the decision command and by the reviewer screens.
create or replace function public.item_publish_blockers(p_item_id text, p_ack boolean default false)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_item public.assessment_items%rowtype; v_blockers text[] := '{}';
  v_concept record; v_manifest uuid; v_batch record;
  v_has_approve boolean; v_disagree boolean; v_failed int; v_auto int;
begin
  select * into v_item from public.assessment_items where id = p_item_id;
  if not found then return array['Unknown item.']; end if;
  v_has_approve := exists (select 1 from public.item_review_decisions where item_id = p_item_id and decision = 'approve');
  if not (v_item.review_status = 'verified' or (v_item.review_status = 'reviewed' and not v_has_approve)) then
    v_blockers := v_blockers || case v_item.review_status
      when 'draft' then 'Not yet automatically checked, or the check failed. Re-verify it first.'
      when 'deprecated' then 'This item is retired.'
      else 'It is already human reviewed with a recorded decision.' end;
  end if;
  if jsonb_typeof(v_item.options) <> 'array' or jsonb_array_length(v_item.options) <> 3
     or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(v_item.options) o) <> 3
     or (select count(*) from jsonb_array_elements_text(v_item.options) o where btrim(o) = '') > 0 then
    v_blockers := v_blockers || 'It needs exactly three distinct, non-empty options.';
  end if;
  if v_item.key_index is null or v_item.key_index not between 0 and 2 then v_blockers := v_blockers || 'It has no valid answer key.'; end if;
  if char_length(coalesce(v_item.item_card->>'solution', '')) < 20 then v_blockers := v_blockers || 'It has no worked solution.'; end if;

  select id into v_manifest from public.curriculum_manifests where is_active = true limit 1;
  if v_item.concept_id is null or v_item.outcome_id is null then
    v_blockers := v_blockers || 'It is not mapped to a curriculum concept and outcome.';
  else
    select c.verification_status, c.manifest_id, c.name into v_concept from public.curriculum_concepts c where c.id = v_item.concept_id;
    if not found then v_blockers := v_blockers || 'Its concept no longer exists.';
    else
      if v_concept.manifest_id is distinct from v_manifest then v_blockers := v_blockers || 'Its concept is not in the active curriculum manifest.'; end if;
      if v_concept.verification_status <> 'verified' then v_blockers := v_blockers || ('The concept "' || v_concept.name || '" has not been signed off in the manifest.'); end if;
    end if;
    if not exists (select 1 from public.concept_outcome_map m join public.reading_los l on l.id = m.outcome_id
                    where m.concept_id = v_item.concept_id and m.outcome_id = v_item.outcome_id and l.reading_id = v_item.lm_id) then
      v_blockers := v_blockers || 'Its concept, outcome and reading do not agree in the curriculum map.';
    end if;
  end if;

  select count(*) filter (where status in ('REVISE', 'VOID')), count(*), coalesce(bool_or(status = 'HUMAN_REVIEW'), false)
    into v_failed, v_auto, v_disagree
    from public.item_validations where item_id = p_item_id and reviewer_role in ('editorial_verifier', 'numerical_verifier')
      and coalesce(item_version, 1) = v_item.item_version;
  if v_auto = 0 then v_blockers := v_blockers || 'There is no automatic check result for this version.'; end if;
  if v_failed > 0 then v_blockers := v_blockers || 'An automatic check failed for this version.'; end if;
  if v_disagree and not coalesce(p_ack, false) then v_blockers := v_blockers || 'The automatic checkers disagree. Acknowledge the disagreement to approve.'; end if;

  if v_item.batch_id is not null then
    select rights_status into v_batch from public.item_batches where id = v_item.batch_id;
    if v_batch.rights_status is distinct from 'cleared' then v_blockers := v_blockers || 'The source rights for its batch are not confirmed as cleared.'; end if;
  end if;
  return v_blockers;
end $$;

create or replace function public.decide_item_review(p_item_id text, p_expected_version int, p_decision text, p_note text default '', p_ack_disagreement boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.assessment_items%rowtype;
  v_note text := coalesce(btrim(p_note), '');
  v_blockers text[] := '{}';
  v_prior text;
  v_validation_status text;
begin
  if v_uid is null or not public.is_item_reviewer() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can decide an item.');
  end if;
  if p_decision not in ('approve', 'reject', 'return', 'retire') then
    return jsonb_build_object('ok', false, 'code', 'BAD_DECISION', 'message', 'Decision must be approve, reject, return or retire.');
  end if;
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item.'); end if;

  select decision into v_prior from public.item_review_decisions
    where item_id = p_item_id and item_version = p_expected_version and decision in (p_decision) limit 1;
  if v_prior is not null then
    return jsonb_build_object('ok', true, 'repeated', true, 'itemId', p_item_id, 'decision', p_decision, 'status', v_item.review_status, 'version', v_item.item_version);
  end if;
  if v_item.item_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'This item changed after you opened it. Reload to see the current version.');
  end if;
  select decision into v_prior from public.item_review_decisions
    where item_id = p_item_id and item_version = v_item.item_version and decision in ('approve', 'reject', 'return') limit 1;
  if v_prior is not null and p_decision <> 'retire' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED', 'message', 'This version already has a different decision (' || v_prior || ').');
  end if;
  if p_decision in ('reject', 'return', 'retire') and char_length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'code', 'NOTE_REQUIRED', 'message', 'Say what is wrong. The reason is the record.');
  end if;

  if p_decision = 'approve' then
    v_blockers := public.item_publish_blockers(p_item_id, coalesce(p_ack_disagreement, false));
    if array_length(v_blockers, 1) > 0 then
      return jsonb_build_object('ok', false, 'code', 'BLOCKED', 'message', 'Publication is blocked.', 'blockers', to_jsonb(v_blockers));
    end if;
  elsif p_decision in ('reject', 'return') then
    if v_item.review_status not in ('draft', 'verified') then
      return jsonb_build_object('ok', false, 'code', 'NOT_AWAITING_REVIEW', 'message', 'This item is "' || v_item.review_status || '"; only an unpublished item can be ' || p_decision || 'ed.');
    end if;
  else -- retire
    if v_item.review_status <> 'reviewed' then
      return jsonb_build_object('ok', false, 'code', 'NOT_PUBLISHED', 'message', 'Only a published item can be retired.');
    end if;
  end if;

  perform set_config('app.review_command', 'on', true);
  begin
    if p_decision = 'approve' then
      update public.assessment_items set review_status = 'reviewed', reviewed_at = now() where id = p_item_id;
      v_validation_status := 'PASS';
      if v_item.supersedes_item_id is not null then
        update public.assessment_items set review_status = 'deprecated', reviewed_at = coalesce(reviewed_at, now()) where id = v_item.supersedes_item_id and review_status <> 'deprecated';
        insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
          select id, item_version, 'superseded', v_uid, 'Replaced by ' || p_item_id from public.assessment_items where id = v_item.supersedes_item_id;
      end if;
    elsif p_decision = 'reject' or p_decision = 'retire' then
      update public.assessment_items set review_status = 'deprecated', reviewed_at = now() where id = p_item_id;
      v_validation_status := 'VOID';
    else -- return: the decision consumes this version; the corrected item is a new version
      update public.assessment_items set review_status = 'draft', verified_at = null, item_version = item_version + 1 where id = p_item_id;
      v_validation_status := 'REVISE';
    end if;

    insert into public.item_review_decisions(item_id, item_version, decision, reviewer_id, note, acknowledged_disagreement)
      values (p_item_id, v_item.item_version, p_decision, v_uid, v_note, coalesce(p_ack_disagreement, false));
    -- Kept so verifier-human agreement stays measurable from one table.
    insert into public.item_validations(item_id, reviewer_role, status, defect_codes, detail, item_version)
      values (p_item_id, 'human_reviewer', v_validation_status, case when p_decision = 'approve' then '{}'::text[] else array['HUMAN_' || upper(p_decision)] end,
              jsonb_build_object('decision', p_decision, 'note', v_note, 'reviewerId', v_uid, 'at', now()), v_item.item_version);
    insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
      values (p_item_id, v_item.item_version, case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'return' then 'returned' else 'retired' end, v_uid, v_note);
  exception when others then
    perform set_config('app.review_command', '', true);
    raise;
  end;
  perform set_config('app.review_command', '', true);

  return jsonb_build_object('ok', true, 'itemId', p_item_id, 'decision', p_decision,
    'status', (select review_status from public.assessment_items where id = p_item_id),
    'version', (select item_version from public.assessment_items where id = p_item_id));
end $$;


revoke all on function public.item_publish_blockers(text, boolean) from public, anon, authenticated;
grant execute on function public.item_publish_blockers(text, boolean) to service_role;
revoke all on function public.decide_item_review(text, int, text, text, boolean) from public, anon, authenticated;
grant execute on function public.decide_item_review(text, int, text, text, boolean) to authenticated;
notify pgrst, 'reload schema';
