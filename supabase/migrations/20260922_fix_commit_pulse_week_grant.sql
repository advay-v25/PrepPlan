-- commit_pulse_week (20260920_commit_pulse_week_rpc.sql) is security definer,
-- takes p_user_id as a caller-supplied parameter, and never checks auth.uid()
-- against it. Granting EXECUTE to authenticated exposed it at
-- /rest/v1/rpc/commit_pulse_week to every logged-in user, who could pass an
-- arbitrary victim uuid and (a) insert plan_blocks rows into that user's
-- calendar, (b) overwrite that user's active planning_cycles row's dates —
-- a hole straight through plan_blocks' RLS. Found in the Phase 1 final
-- review.
--
-- The function's only real caller is src/lib/planning/pulse/generateWeek.ts's
-- commitWeekPlan, which uses createAdminClient() — service_role, which
-- bypasses grants entirely. The authenticated grant bought nothing and
-- should never have been added; accept_onboarding_preview (the sibling RPC)
-- is the correct pattern: it derives v_user_id from auth.uid() itself rather
-- than trusting a parameter, which is why it's safe to grant to authenticated.

revoke execute on function public.commit_pulse_week(uuid, date, date, text, jsonb) from authenticated;
