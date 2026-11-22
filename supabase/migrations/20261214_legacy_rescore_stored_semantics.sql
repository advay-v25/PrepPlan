-- Reverts 20261213 and records the decision. Reproduced first: a legacy (answered-only) paper stores delivered_count = answered rows and omitted_count = 0
-- at FINALIZE, so rescoring it with a factual omission count made the stored row internally inconsistent (delivered 3 but omitted 5).
-- Stored legacy counts keep their historical meaning (answered-based) before and after a rescore; the FACTUAL delivered / voided / scoreable / omitted /
-- completion are derived from the reserved form and the challenge rows (scoreLedger.ts), which is what the result page and the weekly recap now do.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public._rescore_attempt(uuid,uuid,text)'::regprocedure) into v_def;
  v_new := replace(v_def, E'    v_omitted := greatest(v_delivered - v_voided - v_correct - v_incorrect, 0);   -- factual; the score denominator above stays answered-only\n', E'    v_omitted := 0;   -- legacy stored counts are answered-based, exactly as finalize stores them; factual counts come from the form (scoreLedger.ts)\n');
  if v_new = v_def and position('exactly as finalize stores them' in v_def) = 0 then raise exception '_rescore_attempt anchor not found; refusing to patch blindly'; end if;
  if v_new <> v_def then execute v_new; end if;
end $$;
notify pgrst, 'reload schema';
