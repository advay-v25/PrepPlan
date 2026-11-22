-- Phase 1 §4: accepting a reviewed recovery can never invert DECLARED sitting order (plan_blocks.dependencies = the sittings that must come first).
-- Patches accept_class_recovery from its effective definition: after the reviewed moves and deferrals, and before the receipt, any pair (sitting, its
-- predecessor) that involves a task this proposal moved must still be in order; a violation raises, rolling the whole acceptance back.
-- Pairs with a completed, skipped, deferred or cancelled predecessor are not constrained; a task with no declared order is never constrained.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.accept_class_recovery(uuid,integer,jsonb)'::regprocedure);
  n := replace(d, E'  v_receipt := jsonb_build_object(''draft_id''', E'  if exists (
    select 1 from public.plan_blocks b
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(b.dependencies) = ''array'' then b.dependencies else ''[]''::jsonb end) x(pid)
      join public.plan_blocks p on p.id = x.pid and p.user_id = v_user
     where b.user_id = v_user and b.cycle_id = v_cycle.id and b.cancelled_at is null and p.cancelled_at is null
       and b.execution in (''not_started'', ''in_progress'', ''partial'') and p.execution in (''not_started'', ''in_progress'', ''partial'')
       and (b.id in (select m2->>''task_id'' from jsonb_array_elements(d.draft_json->''moves'') m2) or p.id in (select m2->>''task_id'' from jsonb_array_elements(d.draft_json->''moves'') m2))
       and (b.local_date < p.local_date
         or (b.local_date = p.local_date and b.starts_at is not null and p.starts_at is not null
             and b.starts_at < p.starts_at + make_interval(mins => coalesce(p.duration_minutes, 0))))
  ) then raise exception ''STALE_PROPOSAL: a move would put a sitting before the one it follows''; end if;
  v_receipt := jsonb_build_object(''draft_id''');
  if n = d then raise exception 'accept_class_recovery was not patched'; end if;
  execute n;
end $$;
