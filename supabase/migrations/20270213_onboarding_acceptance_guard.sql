-- First-week acceptance, two guards the earlier checks did not cover. (1) A later draft must never add a second copy of the week to an open cycle that
-- already holds accepted work. (2) A task fixed to a clock time (the weekly paper) must still be ahead of the database clock and clear of protected time
-- and booked mocks; the whole-sitting check looks only at flexible work. Patched in place from the effective definition; fails loudly on drift.
do $patch$
declare definition text; needle text; timed text;
begin
  definition := pg_get_functiondef('public.accept_onboarding_preview(uuid,integer)'::regprocedure);

  needle := '  if public.first_unfit_day(v_user_id,';
  if strpos(definition, needle) = 0 then raise exception 'Unexpected onboarding accept definition (accepted week)'; end if;
  definition := replace(definition, needle, $guard$
  if exists (select 1 from public.planning_cycles c join public.plan_blocks b on b.cycle_id = c.id and b.cancelled_at is null
      where c.user_id = v_user_id and c.status = 'active' and c.ends_at_local >= coalesce(v_draft.cycle_start_date, v_draft.proposed_cycle_starts_at_local)) then
    raise exception 'ALREADY_ACCEPTED: your first week is already accepted';
  end if;
$guard$ || needle);

  needle := '  if v_draft.roadmap_id is not null then';
  if strpos(definition, needle) = 0 then raise exception 'Unexpected onboarding accept definition (timed work)'; end if;
  timed := $guard$  if public.extra_window_conflict(v_user_id, coalesce(v_draft.timezone, 'UTC'), clock_timestamp(),
    (select coalesce(jsonb_agg(jsonb_build_object('local_date', t->>'scheduled_date', 'starts_at', t->'metadata'->>'starts_at', 'duration_minutes', (t->>'duration_minutes')::int)), '[]'::jsonb)
      from jsonb_array_elements(v_draft.draft_json->'tasks') t
      where t->'metadata'->>'placement' = 'timed' and nullif(t->'metadata'->>'starts_at', '') is not null)) then
    raise exception 'STALE_PREVIEW: the proposed sittings no longer fit your study windows';
  end if;
$guard$;
  execute replace(definition, needle, timed || needle);
end
$patch$;
notify pgrst, 'reload schema';
