-- finalize_assessment_attempt read manifest_id off the wrong table.
--
-- `assessment_forms` has no manifest_id — a form points at a blueprint, and the
-- blueprint carries the manifest. The function therefore failed with
-- 'column "manifest_id" does not exist' on every attempt submission, so no
-- diagnostic could be scored at all.
--
-- Rather than redefine the whole function, patch the one statement by adding
-- the join it was missing. Done as a targeted replacement so the rest of the
-- scoring and evidence logic is untouched.
do $$
declare
  body text;
begin
  select pg_get_functiondef(oid) into body
  from pg_proc where proname = 'finalize_assessment_attempt' limit 1;

  if body is null then
    raise notice 'finalize_assessment_attempt not present; nothing to patch';
    return;
  end if;

  body := replace(
    body,
    'select manifest_id into v_manifest_id from public.assessment_forms where id = v_attempt.form_id;',
    'select b.manifest_id into v_manifest_id
       from public.assessment_forms f
       join public.assessment_blueprints b on b.id = f.blueprint_id
      where f.id = v_attempt.form_id;'
  );

  execute body;
end $$;

notify pgrst, 'reload schema';
