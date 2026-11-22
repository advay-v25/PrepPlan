-- Freshness: a class outcome can now be corrected in place (20270120) without inserting a task or an item, so the two staleness fingerprints must read the
-- mutable class facts. paper_scope_source gains the session version, outcome extent and studied flag; weekly_source_version gains every class session with its
-- items (extent, studied, planned minutes), version and completion. Both rebuilt from the LIVE definitions; grants unchanged (create or replace).
CREATE OR REPLACE FUNCTION public.paper_scope_source(p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select md5(concat_ws('|',
    (select coalesce(string_agg(concat_ws(':', id, revision, execution, coalesce(cancelled_at::text, ''), coalesce(outcome_id, ''), coalesce(lm_id, ''), coalesce(scope_group_id::text, ''), coalesce(learning_activity_id::text, ''), coalesce(cycle_id::text, '')), ',' order by id), '')
       from public.plan_blocks where user_id = p_user),
    (select coalesce(string_agg(c.block_id || ':' || c.outcome_id, ',' order by c.block_id, c.outcome_id), '') from public.block_scope_confirmations c where c.user_id = p_user),
    (select coalesce(string_agg(s.id::text || ':' || s.kind || ':' || s.version::text || ':' || coalesce(i.outcome_id, '') || ':' || coalesce(i.extent, '') || ':' || coalesce(i.studied_in_class::text, ''), ',' order by s.id::text, i.outcome_id), '')
       from public.class_sessions s left join public.class_session_items i on i.session_id = s.id where s.user_id = p_user),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '') from public.user_module_state m where m.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity, ',' order by e.id::text)), '') from public.evidence_events e where e.user_id = p_user)
  ))
$function$;

CREATE OR REPLACE FUNCTION public.weekly_source_version(p_user uuid, p_cycle uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- class reports the review reads (owed work, coverage): extent, studied flag, planned minutes and the session version, for EVERY session of the student
    (select coalesce(string_agg(s.id::text || ':' || s.kind || ':' || s.version::text || ':' || coalesce(s.completed_at::text, '') || ':' || coalesce(i.outcome_id, '') || ':' || coalesce(i.extent, '') || ':' || coalesce(i.studied_in_class::text, '') || ':' || coalesce(i.planned_minutes::text, ''), ',' order by s.id::text, i.outcome_id), '')
       from public.class_sessions s left join public.class_session_items i on i.session_id = s.id where s.user_id = p_user),
    (select p.classes_completed_at::text from public.profiles p where p.id = p_user),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '')
       from public.availability_windows w where w.user_id = p_user and w.status = 'active'),
    (select coalesce(string_agg(to_jsonb(r)::text, ',' order by r.id::text), '')
       from public.repair_threads r where r.user_id = p_user and r.status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck')),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '')
       from public.user_module_state m where m.user_id = p_user),
    (select coalesce(string_agg(u.topic_id || ':' || u.level || ':' || array_to_string(u.lm_ids, '+'), ',' order by u.topic_id), '')
       from public.user_entry_uncertainty u where u.user_id = p_user),
    (select coalesce(string_agg(c.week_start::text || ':' || c.choice || ':' || coalesce(c.appointment_id::text, ''), ',' order by c.week_start), '')
       from public.cycle_assessment_choices c where c.user_id = p_user),
    (select coalesce(string_agg(o.id::text || ':' || o.outcome || ':' || coalesce(o.actual_date::text, ''), ',' order by o.id::text), '')
       from public.mock_outcomes o where o.user_id = p_user),
    (select coalesce(string_agg(s.suggestion_id || ':' || s.task_id, ',' order by s.suggestion_id, s.task_id), '')
       from public.checkpoint_suggestion_tasks s where s.user_id = p_user),
    (select coalesce(string_agg(a.id::text || ':' || a.version || ':' || a.status, ',' order by a.id::text), '')
       from public.mock_appointments a where a.user_id = p_user),
    (select coalesce(string_agg(r.id::text || ':' || r.status, ',' order by r.id::text), '')
       from public.mock_rehearsals r where r.user_id = p_user),
    (select coalesce(c.sat_on::text, '') from public.exam_completion c where c.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone', j->>'stage', j->>'mock_date', j->>'mock_kind',
                      j->>'mock_start_time', j->>'mock_duration_minutes', j->>'mock_label', j->>'mock_version')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$function$;
