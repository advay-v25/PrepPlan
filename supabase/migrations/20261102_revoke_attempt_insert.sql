-- A student could insert an assessment attempt with any status, form or paper kind and then drive the evidence-producing commands with it.
-- Attempts are now created only by the server (startAssessment and the legacy diagnostic route use the service role). Students keep SELECT.
revoke insert on public.assessment_attempts from anon, authenticated;
