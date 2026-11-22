-- Phase 2 (c): explicit array_append (a bare string literal concatenated to text[] is parsed as an array literal).
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
    v_blockers := array_append(v_blockers, case v_item.review_status
      when 'draft' then 'Not yet automatically checked, or the check failed. Re-verify it first.'
      when 'deprecated' then 'This item is retired.'
      else 'It is already human reviewed with a recorded decision.' end);
  end if;
  if jsonb_typeof(v_item.options) <> 'array' or jsonb_array_length(v_item.options) <> 3
     or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(v_item.options) o) <> 3
     or (select count(*) from jsonb_array_elements_text(v_item.options) o where btrim(o) = '') > 0 then
    v_blockers := array_append(v_blockers, 'It needs exactly three distinct, non-empty options.');
  end if;
  if v_item.key_index is null or v_item.key_index not between 0 and 2 then v_blockers := array_append(v_blockers, 'It has no valid answer key.'); end if;
  if char_length(coalesce(v_item.item_card->>'solution', '')) < 20 then v_blockers := array_append(v_blockers, 'It has no worked solution.'); end if;

  select id into v_manifest from public.curriculum_manifests where is_active = true limit 1;
  if v_item.concept_id is null or v_item.outcome_id is null then
    v_blockers := array_append(v_blockers, 'It is not mapped to a curriculum concept and outcome.');
  else
    select c.verification_status, c.manifest_id, c.name into v_concept from public.curriculum_concepts c where c.id = v_item.concept_id;
    if not found then v_blockers := array_append(v_blockers, 'Its concept no longer exists.');
    else
      if v_concept.manifest_id is distinct from v_manifest then v_blockers := array_append(v_blockers, 'Its concept is not in the active curriculum manifest.'); end if;
      if v_concept.verification_status <> 'verified' then v_blockers := array_append(v_blockers, 'The concept "' || v_concept.name || '" has not been signed off in the manifest.'); end if;
    end if;
    if not exists (select 1 from public.concept_outcome_map m join public.reading_los l on l.id = m.outcome_id
                    where m.concept_id = v_item.concept_id and m.outcome_id = v_item.outcome_id and l.reading_id = v_item.lm_id) then
      v_blockers := array_append(v_blockers, 'Its concept, outcome and reading do not agree in the curriculum map.');
    end if;
  end if;

  select count(*) filter (where status in ('REVISE', 'VOID')), count(*), coalesce(bool_or(status = 'HUMAN_REVIEW'), false)
    into v_failed, v_auto, v_disagree
    from public.item_validations where item_id = p_item_id and reviewer_role in ('editorial_verifier', 'numerical_verifier')
      and coalesce(item_version, 1) = v_item.item_version;
  if v_auto = 0 then v_blockers := array_append(v_blockers, 'There is no automatic check result for this version.'); end if;
  if v_failed > 0 then v_blockers := array_append(v_blockers, 'An automatic check failed for this version.'); end if;
  if v_disagree and not coalesce(p_ack, false) then v_blockers := array_append(v_blockers, 'The automatic checkers disagree. Acknowledge the disagreement to approve.'); end if;

  if v_item.batch_id is not null then
    select rights_status into v_batch from public.item_batches where id = v_item.batch_id;
    if v_batch.rights_status is distinct from 'cleared' then v_blockers := array_append(v_blockers, 'The source rights for its batch are not confirmed as cleared.'); end if;
  end if;
  return v_blockers;
end $$;


revoke all on function public.item_publish_blockers(text, boolean) from public, anon, authenticated;
grant execute on function public.item_publish_blockers(text, boolean) to service_role;
notify pgrst, 'reload schema';
