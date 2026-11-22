-- Write boundary for plan and profile state. Callers traced 1 Nov 2026: every write to these tables is made by the service-role
-- client or a SECURITY DEFINER command; the only signed-in-client writes are the two profile routes below. Reads keep working.
revoke insert, update, delete, truncate on public.plan_blocks, public.plan_drafts, public.planning_cycles, public.task_events from anon, authenticated;

-- profiles: a student may edit only what Settings and the classes-completed route write. onboarding_status, step, version, preview
-- and completion stay server-controlled so the setup gate cannot be set from the browser. Rows are created by the auth trigger.
revoke insert, update, delete, truncate on public.profiles from anon, authenticated;
grant update (display_name, max_session_minutes, prep_mode, classes_completed_at, updated_at) on public.profiles to authenticated;
