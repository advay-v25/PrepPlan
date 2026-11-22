-- A student's generated blueprint contains their selected study scope.
-- Preserve the existing owned-attempt joins while removing the global view.
drop policy forms_read_all on public.assessment_forms;
create policy forms_read_for_owned_attempt on public.assessment_forms for select to authenticated using (
  exists (select 1 from public.assessment_attempts a where a.form_id = assessment_forms.id and a.user_id = (select auth.uid()))
);
drop policy blueprints_read_all on public.assessment_blueprints;
create policy blueprints_read_for_owned_attempt on public.assessment_blueprints for select to authenticated using (
  exists (select 1 from public.assessment_forms f where f.blueprint_id = assessment_blueprints.id)
);
revoke all on public.assessment_forms, public.assessment_blueprints, public.user_roles, public.curriculum_notes from public, anon;
revoke insert, update, delete, truncate, trigger, references on public.assessment_forms, public.assessment_blueprints, public.user_roles, public.curriculum_notes from authenticated;

-- Legacy question/source tables have no student callers. In particular, never
-- publish options and feedback directly when old data is imported.
revoke all on public.questions, public.source_references from public, anon, authenticated;
