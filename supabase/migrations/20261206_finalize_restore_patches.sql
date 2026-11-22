-- 20261205 rebuilt finalize_assessment_attempt from its original file and so dropped two later in-place patches. Re-apply them to the LIVE
-- definition, exactly as 20261107 and 20261111 did: (1) a recorded human approval survives a later retirement and only approved items make
-- evidence; (2) a practice attempt never writes evidence. Guarded: an unexpected shape stops the migration instead of guessing.
do $$
declare d text;
begin
  select pg_get_functiondef('public.finalize_assessment_attempt(uuid,text,text)'::regprocedure) into d;

  if position($o2$if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;$o2$ in d) > 0 then
    d := replace(d, $o1$select ai.review_status from public.assessment_items ai$o1$, $n1$select ai.id, ai.review_status from public.assessment_items ai$n1$);
    d := replace(d, $o1$select ai.review_status from public.form_items fi join public.assessment_items ai$o1$, $n1$select ai.id, ai.review_status from public.form_items fi join public.assessment_items ai$n1$);
    d := replace(d, $o2$if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;$o2$,
      $n2$if not (v_item.review_status = 'reviewed' or exists (select 1 from public.item_review_decisions d where d.item_id = v_item.id and d.decision = 'approve')) then v_evidence_mode := 'practice'; end if;$n2$);
  end if;

  if position('attempt_kind = ''practice''' in d) = 0 then
    d := replace(d, E'  v_evidence_mode := ''evidence'';\n', E'  v_evidence_mode := ''evidence'';\n  if v_attempt.attempt_kind = ''practice'' then v_evidence_mode := ''practice''; end if;\n');
  end if;

  if position('item_review_decisions' in d) = 0 or position('attempt_kind = ''practice''' in d) = 0 or position('paper-score.1' in d) = 0 then
    raise exception 'finalize_assessment_attempt patch did not apply';
  end if;
  execute d;
end $$;
