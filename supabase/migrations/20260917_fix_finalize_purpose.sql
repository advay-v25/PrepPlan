-- finalize_assessment_attempt read the assessment purpose off the wrong table.
--
-- It referenced v_attempt.assessment_scope, but assessment_attempts has no such
-- column — the purpose lives on assessment_blueprints, reached through the
-- form. Every submission failed with
-- 'record "v_attempt" has no field "assessment_scope"', so no attempt could be
-- scored and no evidence could be written.
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
    'coalesce((v_attempt.assessment_scope->>''purpose''), ''practice'')',
    'coalesce((select b.purpose
                 from public.assessment_forms f
                 join public.assessment_blueprints b on b.id = f.blueprint_id
                where f.id = v_attempt.form_id), ''practice'')'
  );

  execute body;
end $$;

notify pgrst, 'reload schema';
