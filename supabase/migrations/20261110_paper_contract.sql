-- Phase 3: one eligibility rule and one atomic reservation for every student paper.
-- Additive: new view, helper, command and two columns. Nothing historical is rewritten or relabelled.
--
-- Eligibility policy "approved-version-v1" (applied at reservation):
--   a question may enter a NEW student paper only if it is human reviewed, not held out, and a recorded approval exists for its
--   EXACT current version, it has not been answered by this student, its family (when known) has not been answered by this
--   student, and no other question of the same family is in the same paper. An unknown family stays unknown (independent).
-- Finalisation keeps the Phase 2 rule (evidence for reviewed or previously approved items), so papers reserved earlier
-- (eligibility_policy is null = "legacy-reviewed-v0") stay completable and reproducible.

alter table public.form_items add column if not exists item_version int;
alter table public.assessment_attempts add column if not exists eligibility_policy text;

create or replace view public.student_eligible_items with (security_invoker = true) as
  select i.* from public.assessment_items i
   where i.review_status = 'reviewed' and i.held_out = false
     and exists (select 1 from public.item_review_decisions d
                  where d.item_id = i.id and d.item_version = i.item_version and d.decision = 'approve');
revoke all on public.student_eligible_items from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select on public.student_eligible_items to service_role; end if; end $$;

-- Defects that would stop these questions entering a new paper for this student. Empty array = all acceptable.
create or replace function public.paper_item_defects(p_user uuid, p_item_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ids as (select x.id, x.ord from unnest(p_item_ids) with ordinality as x(id, ord)),
  seen_fam as (select distinct i.family_id from public.assessment_responses r join public.assessment_items i on i.id = r.item_id
                where r.user_id = p_user and i.family_id is not null),
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
      when exists (select 1 from public.assessment_responses a where a.user_id = p_user and a.item_id = r.id) then 'SEEN'
      when r.family_id is not null and exists (select 1 from seen_fam s where s.family_id = r.family_id) then 'SEEN_FAMILY'
      when r.dup_family > 1 then 'DUPLICATE_FAMILY'
      else null end as code
    from rows r) d
  where d.code is not null
$$;
revoke all on function public.paper_item_defects(uuid, text[]) from public, anon, authenticated;

-- A question's version is pinned on the form when it is inserted, and an unapproved version can never be inserted.
create or replace function public.form_items_boundary() returns trigger language plpgsql set search_path = '' as $$
declare v record;
begin
  select review_status, held_out, item_version into v from public.assessment_items where id = new.item_id;
  if v.review_status is distinct from 'reviewed' then raise exception 'ITEM_NOT_REVIEWED: only human-reviewed questions can enter a paper'; end if;
  if v.held_out and coalesce(current_setting('app.holdout_form', true), '') <> 'on' then
    raise exception 'ITEM_HELD_OUT: a held-out question cannot enter a routine paper';
  end if;
  if not exists (select 1 from public.item_review_decisions d where d.item_id = new.item_id and d.item_version = v.item_version and d.decision = 'approve') then
    raise exception 'ITEM_NOT_APPROVED: no recorded approval exists for this version of the question';
  end if;
  new.item_version := v.item_version;
  return new;
end $$;

-- The single reservation command. Everything a paper is, in one transaction; the caller supplies a proposed item list and
-- this re-validates it under lock. Retried or concurrent calls resume the same attempt.
create or replace function public.start_assessment_paper(
  p_user uuid, p_kind text, p_open_key text, p_cycle uuid, p_paper_kind text, p_purpose text, p_manifest uuid,
  p_item_ids text[], p_min int, p_requested_scope jsonb, p_constraints jsonb, p_requested jsonb, p_coverage jsonb,
  p_scope jsonb, p_scope_label text, p_scope_revision text, p_time_limit int, p_link_block text, p_link_weekly boolean
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
revoke all on function public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean) from public, anon, authenticated;
do $$ begin
  if to_regrole('service_role') is not null then
    grant execute on function public.start_assessment_paper(uuid, text, text, uuid, text, text, uuid, text[], int, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, int, text, boolean) to service_role;
    grant execute on function public.paper_item_defects(uuid, text[]) to service_role;
  end if;
end $$;

-- Re-checks use the same defect rule (approval of the exact version, fresh family) instead of an answered-item test alone.
do $$
declare d text;
begin
  select pg_get_functiondef('public.start_repair_check(uuid, text, text[], uuid, jsonb, jsonb, jsonb, jsonb, jsonb, integer)'::regprocedure) into d;
  if position('paper_item_defects' in d) = 0 then
    d := replace(d, 'if exists (select 1 from public.assessment_responses where user_id = p_user and item_id = any(p_item_ids)) then',
                    'if jsonb_array_length(public.paper_item_defects(p_user, p_item_ids)) > 0 then');
    d := replace(d, 'insert into public.assessment_attempts(user_id, form_id, delivery_mode, status, attempt_kind, cycle_id, open_key, requested_blueprint, delivered_coverage)',
                    'insert into public.assessment_attempts(user_id, form_id, delivery_mode, status, attempt_kind, cycle_id, open_key, requested_blueprint, delivered_coverage, eligibility_policy)');
    d := replace(d, 'v_task.cycle_id, ''check:'' || p_check_task_id, p_requested, p_coverage)', 'v_task.cycle_id, ''check:'' || p_check_task_id, p_requested, p_coverage, ''approved-version-v1'')');
    if position('paper_item_defects' in d) = 0 or position('approved-version-v1' in d) = 0 then raise exception 'start_repair_check patch did not apply'; end if;
    execute d;
  end if;
end $$;

notify pgrst, 'reload schema';
