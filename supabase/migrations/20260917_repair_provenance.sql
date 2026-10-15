-- Repair tasks lost the link back to the diagnostic that caused them.
--
-- apply_diagnostic_repair_proposal inserts plan_blocks with repair_thread_id but
-- not attempt_id or concept_id, so the task drawer's "see the result that caused
-- this" had nothing to link to, and nothing could tell which diagnostic a repair
-- came from. A repair that cannot name its cause is just a chore.
do $$
declare
  body text;
begin
  select pg_get_functiondef(oid) into body
  from pg_proc where proname = 'apply_diagnostic_repair_proposal' limit 1;

  if body is null then
    raise notice 'apply_diagnostic_repair_proposal not present; nothing to patch';
    return;
  end if;

  body := replace(
    body,
    'is_protected_commitment, created_by, repair_thread_id',
    'is_protected_commitment, created_by, repair_thread_id, attempt_id, concept_id'
  );
  body := replace(
    body,
    'false, ''algorithm'', (v_task->>''repair_thread_id'')::uuid',
    'false, ''algorithm'', (v_task->>''repair_thread_id'')::uuid, (nullif(v_task->>''attempt_id'', ''''))::uuid, (nullif(v_task->>''concept_id'', ''''))::uuid'
  );

  execute body;
end $$;

notify pgrst, 'reload schema';
