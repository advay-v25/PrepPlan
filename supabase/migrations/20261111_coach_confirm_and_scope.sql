-- Phase 4: (1) atomic Coach confirmation, (2) the scope-race fix for paper reservation, (3) exposure- and family-aware freshness,
-- (4) timed practice as a labelled practice attempt. Additive, except that two functions are replaced by signature-compatible versions.

-- 1. Coach confirmation: validate everything the student reviewed, apply it with the existing atomic task command, write the receipt, one transaction.
create or replace function public.confirm_coach_proposal(p_proposal_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_p public.coach_proposals%rowtype;
  v_moves jsonb; v_m jsonb; v_t public.plan_blocks%rowtype; v_res jsonb;
  v_events jsonb := '[]'::jsonb; v_n int := 0;
begin
  if v_uid is null then raise exception 'Sign in to confirm a suggestion.' using errcode = '42501'; end if;
  select * into v_p from public.coach_proposals where id = p_proposal_id and user_id = v_uid for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_p.status = 'executed' then
    return jsonb_build_object('ok', true, 'replayed', true, 'applied', coalesce((v_p.proposed_changes->>'applied')::int, 0), 'receipt', v_p.proposed_changes->'receipt');
  end if;
  if v_p.status <> 'pending' then return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'not_pending'); end if;
  -- Only a proposal that carries the task identities, revisions and dates the student reviewed can be applied.
  if v_p.kind <> 'defer_today' or coalesce((v_p.proposed_changes->>'version')::int, 1) < 2 then
    update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
    return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'unreviewed_format');
  end if;
  v_moves := v_p.proposed_changes->'moves';
  if jsonb_typeof(v_moves) <> 'array' or jsonb_array_length(v_moves) = 0 or jsonb_array_length(v_moves) > 12 then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'reason', 'bad_moves');
  end if;

  -- Validate first, locking in a fixed order. Nothing is written unless every reviewed task is exactly as reviewed.
  for v_m in select value from jsonb_array_elements(v_moves) order by value->>'id' loop
    select * into v_t from public.plan_blocks where id = v_m->>'id' and user_id = v_uid for update;
    if not found or v_t.revision <> (v_m->>'revision')::int or v_t.execution <> 'not_started' or v_t.is_protected_commitment
       or v_t.cancelled_at is not null or v_t.learning_activity_id is not null
       or v_t.local_date is distinct from (v_m->>'date')::date
       or exists (select 1 from public.plan_blocks s where s.continued_from_task_id = v_t.id) then
      update public.coach_proposals set status = 'stale', decided_at = now() where id = p_proposal_id;
      return jsonb_build_object('ok', false, 'code', 'STALE', 'reason', 'task_changed', 'taskId', v_m->>'id');
    end if;
  end loop;

  -- Apply through the existing atomic execution command. Any failure raises and rolls back the whole proposal.
  for v_m in select value from jsonb_array_elements(v_moves) order by value->>'id' loop
    v_res := public.set_task_execution(v_uid, v_m->>'id', (v_m->>'revision')::int, 'deferred', null, 'Moved on your confirmation from the Coach');
    if coalesce((v_res->>'ok')::boolean, false) is not true then raise exception 'COACH_APPLY_FAILED for %', v_m->>'id' using errcode = 'P0001'; end if;
    v_events := v_events || jsonb_build_array(jsonb_build_object('taskId', v_m->>'id', 'eventId', v_res->>'eventId'));
    v_n := v_n + 1;
  end loop;

  update public.coach_proposals set status = 'executed', executed_at = now(), decided_at = now(),
    proposed_changes = proposed_changes || jsonb_build_object('applied', v_n, 'receipt', jsonb_build_object('events', v_events, 'at', now()))
   where id = p_proposal_id;
  return jsonb_build_object('ok', true, 'replayed', false, 'applied', v_n, 'receipt', jsonb_build_object('events', v_events));
end $$;
revoke all on function public.confirm_coach_proposal(uuid) from public, anon;
grant execute on function public.confirm_coach_proposal(uuid) to authenticated;

-- 2. Everything the completed scope is derived from, as one version. Reservation compares it under lock.
create or replace function public.paper_scope_source(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(concat_ws(':', id, revision, execution, coalesce(cancelled_at::text, ''), coalesce(outcome_id, ''), coalesce(lm_id, ''), coalesce(scope_group_id::text, ''), coalesce(learning_activity_id::text, ''), coalesce(cycle_id::text, '')), ',' order by id), '')
       from public.plan_blocks where user_id = p_user),
    (select coalesce(string_agg(c.block_id || ':' || c.outcome_id, ',' order by c.block_id, c.outcome_id), '') from public.block_scope_confirmations c where c.user_id = p_user),
    (select coalesce(string_agg(s.id::text || ':' || s.kind || ':' || coalesce(i.outcome_id, ''), ',' order by s.id::text, i.outcome_id), '')
       from public.class_sessions s left join public.class_session_items i on i.session_id = s.id where s.user_id = p_user),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '') from public.user_module_state m where m.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity, ',' order by e.id::text)), '') from public.evidence_events e where e.user_id = p_user)
  ))
$$;
revoke all on function public.paper_scope_source(uuid) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.paper_scope_source(uuid) to service_role; end if; end $$;

-- 3. Freshness: a question already DELIVERED (its paper was opened) is exposed even if unanswered, and its family is then not fresh.
--    Optionally an unknown family cannot establish independent evidence (re-checks).
drop function if exists public.paper_item_defects(uuid, text[]);
create or replace function public.paper_item_defects(p_user uuid, p_item_ids text[], p_require_family boolean default false) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ids as (select x.id, x.ord from unnest(p_item_ids) with ordinality as x(id, ord)),
  exposed as (
    select r.item_id from public.assessment_responses r where r.user_id = p_user
    union
    select fi.item_id from public.form_items fi join public.assessment_attempts a on a.form_id = fi.form_id
     where a.user_id = p_user and a.status not in ('ready', 'assembling')),
  seen_fam as (select distinct i.family_id from exposed e join public.assessment_items i on i.id = e.item_id where i.family_id is not null),
  rows as (
    select ids.id, ids.ord, i.family_id, i.review_status, i.held_out, i.item_version,
           row_number() over (partition by ids.id order by ids.ord) as dup_item,
           case when i.family_id is null then 1 else row_number() over (partition by i.family_id order by ids.ord) end as dup_family
      from ids left join public.assessment_items i on i.id = ids.id)
  select coalesce(jsonb_agg(jsonb_build_object('itemId', d.id, 'code', d.code) order by d.ord), '[]'::jsonb) from (
    select r.id, r.ord, case
      when r.review_status is null then 'NOT_FOUND'
      when r.dup_item > 1 then 'DUPLICATE_ITEM'
      when r.review_status <> 'reviewed' then 'NOT_REVIEWED'
      when r.held_out then 'HELD_OUT'
      when not exists (select 1 from public.item_review_decisions d where d.item_id = r.id and d.item_version = r.item_version and d.decision = 'approve') then 'NO_APPROVAL'
      when exists (select 1 from exposed e where e.item_id = r.id) then 'SEEN'
      when r.family_id is not null and exists (select 1 from seen_fam s where s.family_id = r.family_id) then 'SEEN_FAMILY'
      when p_require_family and r.family_id is null then 'UNKNOWN_FAMILY'
      when r.dup_family > 1 then 'DUPLICATE_FAMILY'
      else null end as code
    from rows r) d
  where d.code is not null
$$;
revoke all on function public.paper_item_defects(uuid, text[], boolean) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.paper_item_defects(uuid, text[], boolean) to service_role; end if; end $$;

-- Re-checks require a KNOWN family for every question.
do $$
declare d text;
begin
  select pg_get_functiondef('public.start_repair_check(uuid, text, text[], uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer)'::regprocedure) into d;
  if position('p_item_ids, true' in d) = 0 then
    d := replace(d, 'public.paper_item_defects(p_user, p_item_ids)', 'public.paper_item_defects(p_user, p_item_ids, true)');
    if position('p_item_ids, true' in d) = 0 then raise exception 'start_repair_check patch did not apply'; end if;
    execute d;
  end if;
end $$;

-- 4. Reservation with the scope source version, and a lock on the student's plan rows while it commits.
drop function if exists public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean);
create or replace function public.start_assessment_paper(
  p_user uuid, p_kind text, p_open_key text, p_cycle uuid, p_paper_kind text, p_purpose text, p_manifest uuid,
  p_item_ids text[], p_min int, p_requested_scope jsonb, p_constraints jsonb, p_requested jsonb, p_coverage jsonb,
  p_scope jsonb, p_scope_label text, p_scope_revision text, p_time_limit int, p_link_block text, p_link_weekly boolean,
  p_scope_source text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_open public.assessment_attempts%rowtype;
  v_bp uuid; v_form uuid; v_attempt uuid; v_defects jsonb; v_block text;
  v_n int := coalesce(array_length(p_item_ids, 1), 0);
begin
  if p_cycle is not null and not exists (select 1 from public.planning_cycles c where c.id = p_cycle and c.user_id = p_user and c.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'CYCLE_CHANGED');
  end if;
  if p_open_key is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_user::text || ':' || coalesce(p_kind, '') || ':' || p_open_key, 0));
    select * into v_open from public.assessment_attempts
     where user_id = p_user and attempt_kind is not distinct from p_kind and open_key = p_open_key and status in ('ready', 'in_progress', 'assembling')
     order by started_at desc nulls last limit 1;
    if found then
      return jsonb_build_object('ok', true, 'resumed', true, 'attemptId', v_open.id, 'questions', (select count(*) from public.form_items where form_id = v_open.form_id));
    end if;
  end if;
  -- Scope writers update or lock plan rows through their own commands; holding the rows FOR SHARE makes them wait for this
  -- reservation, and the version is compared AFTER the lock so an edit that landed since the student looked is seen.
  if p_scope_source is not null then
    perform 1 from public.plan_blocks where user_id = p_user order by id for share;
    if public.paper_scope_source(p_user) is distinct from p_scope_source then
      return jsonb_build_object('ok', false, 'code', 'SCOPE_CHANGED');
    end if;
  end if;
  if v_n < p_min then return jsonb_build_object('ok', false, 'code', 'BANK_INSUFFICIENT', 'deliverable', v_n, 'needed', p_min); end if;
  if v_n > 90 then raise exception 'A paper cannot exceed 90 questions.' using errcode = '22023'; end if;
  v_defects := public.paper_item_defects(p_user, p_item_ids);
  if jsonb_array_length(v_defects) > 0 then return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED', 'defects', v_defects); end if;

  insert into public.assessment_blueprints(manifest_id, purpose, requested_scope, constraints) values (p_manifest, p_purpose, p_requested_scope, p_constraints) returning id into v_bp;
  insert into public.assessment_forms(blueprint_id, delivery_mode) values (v_bp, 'fixed') returning id into v_form;
  insert into public.form_items(form_id, item_id, sequence_number) select v_form, x.item, x.ord from unnest(p_item_ids) with ordinality as x(item, ord);
  insert into public.assessment_attempts(user_id, form_id, delivery_mode, status, attempt_kind, paper_kind, cycle_id, open_key, requested_blueprint, delivered_coverage, eligibility_policy,
                                         time_limit_minutes, deadline_at)
    values (p_user, v_form, 'fixed', 'ready', p_kind, p_paper_kind, p_cycle, p_open_key, p_requested, p_coverage, 'approved-version-v1',
            p_time_limit, case when p_time_limit is null then null else now() + make_interval(mins => p_time_limit) end) returning id into v_attempt;
  if p_scope is not null then
    insert into public.paper_scope_snapshots(user_id, cycle_id, purpose, revision, scope, attempt_id)
      values (p_user, p_cycle, p_scope_label, coalesce(p_scope_revision, 'n/a'), p_scope, v_attempt);
  end if;
  if p_link_block is not null then
    update public.plan_blocks set attempt_id = v_attempt where id = p_link_block and user_id = p_user and attempt_id is null returning id into v_block;
    if v_block is null then raise exception 'BLOCK_ALREADY_CLAIMED' using errcode = 'P0001'; end if;
  elsif p_link_weekly and p_cycle is not null then
    update public.plan_blocks set attempt_id = v_attempt
     where id = (select b.id from public.plan_blocks b where b.user_id = p_user and b.cycle_id = p_cycle and b.task_type = 'diagnostic' and b.attempt_id is null order by b.local_date limit 1 for update skip locked);
  end if;
  return jsonb_build_object('ok', true, 'resumed', false, 'attemptId', v_attempt, 'questions', v_n);
end; $$;
revoke all on function public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean, text) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean, text) to service_role; end if; end $$;

-- 5. Timed practice: a labelled practice attempt that never writes evidence.
alter table public.assessment_attempts drop constraint if exists assessment_attempts_attempt_kind_check;
alter table public.assessment_attempts add constraint assessment_attempts_attempt_kind_check
  check (attempt_kind = any (array['weekly','reading','subject','repair','mock','module','other','practice']));
do $$
declare d text;
begin
  select pg_get_functiondef('public.finalize_assessment_attempt'::regproc) into d;
  if position('attempt_kind = ''practice''' in d) = 0 then
    d := replace(d, E'  v_evidence_mode := ''evidence'';\n', E'  v_evidence_mode := ''evidence'';\n  if v_attempt.attempt_kind = ''practice'' then v_evidence_mode := ''practice''; end if;\n');
    if position('attempt_kind = ''practice''' in d) = 0 then raise exception 'finalize patch did not apply'; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
