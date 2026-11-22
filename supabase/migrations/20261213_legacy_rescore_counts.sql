-- _rescore_attempt under the legacy answered-only policy: keep the SCORE denominator (answered items, stored as scoreable_count exactly as finalize
-- stores it) but report the FACTUAL omission count (delivered - voided - answered), as finalize does. Before this, a rescored legacy paper
-- showed omitted = 0 while finalize showed the real number, so stored data disagreed with the ledger the result page rebuilds.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public._rescore_attempt(uuid,uuid,text)'::regprocedure) into v_def;
  v_new := replace(v_def, E'    v_omitted := 0;\n', E'    v_omitted := greatest(v_delivered - v_voided - v_correct - v_incorrect, 0);   -- factual; the score denominator above stays answered-only\n');
  if v_new = v_def then
    if position('factual; the score denominator' in v_def) > 0 then return; end if;
    raise exception '_rescore_attempt legacy anchor not found; refusing to patch blindly';
  end if;
  execute v_new;
end $$;
notify pgrst, 'reload schema';
