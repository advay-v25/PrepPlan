-- State ownership. (1) The weekly change token now also covers commitment exceptions, the active exam target and classes_completed_at, so editing
-- any of them makes an unaccepted weekly draft stale. (2) Server-owned records lose student write access after every writer was traced to the
-- service role or a validated route that now uses it: the browser cannot rewrite the exam target, roadmap, module state, Coach history, profile
-- or calendar commitments around the route validation.
create or replace function public.weekly_source_version(p_user uuid, p_cycle uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(concat_ws(':', id, revision, execution, coalesce(cancelled_at::text, ''), coalesce(local_date::text, ''), coalesce(duration_minutes::text, '')), ',' order by id), '')
       from public.plan_blocks where user_id = p_user and cycle_id = p_cycle),
    (select coalesce(string_agg(c.block_id || ':' || c.outcome_id, ',' order by c.block_id, c.outcome_id), '')
       from public.block_scope_confirmations c where c.user_id = p_user
        and c.block_id in (select id from public.plan_blocks where user_id = p_user and cycle_id = p_cycle)),
    (select coalesce(string_agg(a.id::text || ':' || a.status, ',' order by a.id::text), '')
       from public.assessment_attempts a where a.user_id = p_user and a.cycle_id = p_cycle),
    (select coalesce(string_agg(to_jsonb(k)::text, ',' order by k.id::text), '')
       from public.calendar_commitments k where k.user_id = p_user and k.status = 'active'),
    (select coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id::text), '')
       from public.commitment_exceptions x where x.user_id = p_user),
    (select coalesce(string_agg(to_jsonb(e)::text, ',' order by e.id::text), '')
       from public.exam_attempts e where e.user_id = p_user and e.status = 'active'),
    (select p.classes_completed_at::text from public.profiles p where p.id = p_user),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '')
       from public.availability_windows w where w.user_id = p_user and w.status = 'active'),
    (select coalesce(string_agg(to_jsonb(r)::text, ',' order by r.id::text), '')
       from public.repair_threads r where r.user_id = p_user and r.status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck')),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '')
       from public.user_module_state m where m.user_id = p_user),
    -- Which events exist AND whether each still counts: a voided or disputed answer changes the plan.
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;

-- Note: the original revoke on weekly_source_version is unchanged by create or replace (privileges are kept).

revoke insert, update, delete, truncate on public.exam_attempts, public.study_roadmaps, public.roadmap_milestones, public.user_module_state,
  public.coach_messages, public.calendar_commitments, public.commitment_exceptions from anon, authenticated;
revoke update on public.profiles from authenticated;
revoke update (display_name, max_session_minutes, prep_mode, classes_completed_at, updated_at) on public.profiles from authenticated;
