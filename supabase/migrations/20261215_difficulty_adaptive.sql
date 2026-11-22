-- T3: reviewed difficulty, frozen form difficulty, atomic decision check, bounded adaptive practice runs.
-- Additive. Nothing historical is relabelled: no existing approval is given a confirmed level, no existing form_items row is rewritten.

-- 1. Reviewer-confirmed difficulty, per EXACT item version. History is kept; the latest row for a version wins (explicit metadata revision).
create table if not exists public.item_difficulty_reviews (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.assessment_items(id) on delete cascade,
  item_version int not null,
  level text not null check (level in ('foundation', 'standard', 'difficult', 'stretch')),
  rationale text not null check (char_length(btrim(rationale)) >= 10),
  reviewer_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists item_difficulty_reviews_item_idx on public.item_difficulty_reviews (item_id, item_version, created_at desc);
alter table public.item_difficulty_reviews enable row level security;
revoke all on public.item_difficulty_reviews from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select on public.item_difficulty_reviews to service_role; end if; end $$;

create or replace view public.item_confirmed_difficulty with (security_invoker = true) as
  select distinct on (r.item_id, r.item_version) r.item_id, r.item_version, r.level, r.rationale, r.reviewer_id, r.created_at, r.id as review_id
    from public.item_difficulty_reviews r order by r.item_id, r.item_version, r.created_at desc, r.id desc;
revoke all on public.item_confirmed_difficulty from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select on public.item_confirmed_difficulty to service_role; end if; end $$;

create or replace function public.confirm_item_difficulty(p_item_id text, p_expected_version int, p_level text, p_rationale text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.assessment_items%rowtype; v_last record;
begin
  if auth.uid() is null or not public.is_item_reviewer() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can confirm a difficulty level.');
  end if;
  if p_level not in ('foundation', 'standard', 'difficult', 'stretch') then
    return jsonb_build_object('ok', false, 'code', 'BAD_LEVEL', 'message', 'Level must be foundation, standard, difficult or stretch.');
  end if;
  if char_length(btrim(coalesce(p_rationale, ''))) < 10 then
    return jsonb_build_object('ok', false, 'code', 'RATIONALE_REQUIRED', 'message', 'Say in a sentence what cognitive demand justifies this level.');
  end if;
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item.'); end if;
  if v_item.item_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'This item changed after you opened it. Reload to see the current version.');
  end if;
  if v_item.review_status = 'deprecated' then return jsonb_build_object('ok', false, 'code', 'RETIRED', 'message', 'This item is retired.'); end if;
  select level, rationale into v_last from public.item_confirmed_difficulty where item_id = p_item_id and item_version = v_item.item_version;
  if found and v_last.level = p_level and v_last.rationale = btrim(p_rationale) then
    return jsonb_build_object('ok', true, 'repeated', true, 'itemId', p_item_id, 'version', v_item.item_version, 'level', p_level);
  end if;
  insert into public.item_difficulty_reviews(item_id, item_version, level, rationale, reviewer_id) values (p_item_id, v_item.item_version, p_level, btrim(p_rationale), auth.uid());
  return jsonb_build_object('ok', true, 'itemId', p_item_id, 'version', v_item.item_version, 'level', p_level);
end $$;
revoke all on function public.confirm_item_difficulty(text, int, text, text) from public, anon, authenticated;
grant execute on function public.confirm_item_difficulty(text, int, text, text) to authenticated;

-- 2. A NEW approval must carry a confirmed level for the exact version. Patched in place (one anchor); no backfill of earlier approvals.
do $$ declare d text; r text; begin
  select pg_get_functiondef('public.decide_item_review(text,int,text,text,boolean)'::regprocedure) into d;
  r := replace(d, 'v_blockers := public.item_publish_blockers(p_item_id, coalesce(p_ack_disagreement, false));',
    'v_blockers := public.item_publish_blockers(p_item_id, coalesce(p_ack_disagreement, false));
    if not exists (select 1 from public.item_confirmed_difficulty c where c.item_id = p_item_id and c.item_version = v_item.item_version) then
      v_blockers := v_blockers || ''A reviewer must confirm the difficulty level and give its rationale for this exact version.'';
    end if;');
  if r = d then raise exception 'decide_item_review anchor not found'; end if;
  execute r;
end $$;

-- 3. The difficulty interpretation a form was reserved with is frozen on its rows, in the reservation's own transaction.
alter table public.form_items add column if not exists difficulty_level text;
alter table public.form_items add column if not exists difficulty_basis text check (difficulty_basis in ('confirmed', 'proposed', 'unclassified'));
alter table public.form_items add column if not exists difficulty_review_id uuid;
create or replace function public.form_items_freeze_difficulty() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ver int; v_prop text; v record;
begin
  if new.difficulty_basis is not null then return new; end if;
  select item_version, intended_difficulty into v_ver, v_prop from public.assessment_items where id = new.item_id;
  select c.level, c.review_id into v from public.item_confirmed_difficulty c where c.item_id = new.item_id and c.item_version = coalesce(new.item_version, v_ver);
  if v.level is not null then new.difficulty_level := v.level; new.difficulty_basis := 'confirmed'; new.difficulty_review_id := v.review_id;
  else new.difficulty_level := null; new.difficulty_basis := case when v_prop is not null then 'proposed' else 'unclassified' end; end if;
  return new;
end $$;
drop trigger if exists form_items_freeze_difficulty on public.form_items;
create trigger form_items_freeze_difficulty before insert on public.form_items for each row execute function public.form_items_freeze_difficulty();

-- 4. Evidence revision for a student: any change to scored evidence, validity or rescoring changes it.
create or replace function public.difficulty_evidence_version(p_user uuid) returns text language sql stable security definer set search_path = '' as $$
  select md5(
    coalesce((select count(*) filter (where validity = 'valid') || ':' || count(*) filter (where validity <> 'valid') || ':' || coalesce(max(created_at)::text, '')
                from public.evidence_events where user_id = p_user and evidence_mode = 'evidence'), '')
    || '|' || coalesce((select count(*) || ':' || coalesce(max(result_revision), 0) || ':' || coalesce(max(completed_at)::text, '')
                from public.assessment_attempts where user_id = p_user and attempt_kind in ('weekly', 'reading', 'subject') and status in ('scored', 'rescored', 'partially_voided')), ''))
$$;
revoke all on function public.difficulty_evidence_version(uuid) from public, anon, authenticated;
grant execute on function public.difficulty_evidence_version(uuid) to service_role;

-- 5. One place that forwards a JSON description of a paper to the reservation command.
create or replace function public._reserve_paper_json(p_user uuid, p_paper jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.start_assessment_paper(
    p_user, p_paper->>'kind', p_paper->>'openKey', nullif(p_paper->>'cycle', '')::uuid, p_paper->>'paperKind', p_paper->>'purpose', (p_paper->>'manifest')::uuid,
    array(select jsonb_array_elements_text(p_paper->'itemIds')), (p_paper->>'min')::int, p_paper->'requestedScope', p_paper->'constraints', p_paper->'requested', p_paper->'coverage',
    p_paper->'scope', p_paper->>'scopeLabel', p_paper->>'scopeRevision', nullif(p_paper->>'timeLimit', '')::int, p_paper->>'linkBlock', coalesce((p_paper->>'linkWeekly')::boolean, false), p_paper->>'scopeSource');
end $$;
revoke all on function public._reserve_paper_json(uuid, jsonb) from public, anon, authenticated;

-- Reservation that re-checks, under the student's lock, that the evidence revision and every item's confirmed level are what the student reviewed.
create or replace function public.start_paper_checked(p_user uuid, p_evidence text, p_levels jsonb, p_paper jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_now jsonb;
begin
  perform public.scope_lock(p_user);
  if p_evidence is not null and public.difficulty_evidence_version(p_user) is distinct from p_evidence then
    return jsonb_build_object('ok', false, 'code', 'DECISION_CHANGED');
  end if;
  if p_levels is not null then
    select coalesce(jsonb_object_agg(x.id, coalesce(c.level, '') ), '{}'::jsonb) into v_now
      from (select jsonb_array_elements_text(p_paper->'itemIds') id) x
      left join public.assessment_items i on i.id = x.id
      left join public.item_confirmed_difficulty c on c.item_id = x.id and c.item_version = i.item_version;
    if v_now is distinct from p_levels then return jsonb_build_object('ok', false, 'code', 'DECISION_CHANGED'); end if;
  end if;
  return public._reserve_paper_json(p_user, p_paper);
end $$;
revoke all on function public.start_paper_checked(uuid, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.start_paper_checked(uuid, text, jsonb, jsonb) to service_role;

-- 6. Adaptive practice runs: a bounded sequence of fixed five-question sets. Students can only read their own rows.
create table if not exists public.practice_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_key text not null,
  last_request_key text,
  reading_id text not null,
  outcome_ids text[] not null default '{}',
  cap int not null check (cap in (10, 20)),
  policy_version text not null,
  status text not null default 'active' check (status in ('active', 'stopped')),
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, request_key)
);
create table if not exists public.practice_run_sets (
  run_id uuid not null references public.practice_runs(id) on delete cascade,
  block_no int not null check (block_no >= 1),
  attempt_id uuid not null unique references public.assessment_attempts(id) on delete cascade,
  size int not null check (size = 5),
  decision jsonb not null,
  created_at timestamptz not null default now(),
  primary key (run_id, block_no)
);
alter table public.practice_runs enable row level security;
alter table public.practice_run_sets enable row level security;
revoke all on public.practice_runs, public.practice_run_sets from public, anon, authenticated;
grant select on public.practice_runs, public.practice_run_sets to authenticated;
drop policy if exists practice_runs_own on public.practice_runs;
create policy practice_runs_own on public.practice_runs for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists practice_run_sets_own on public.practice_run_sets;
create policy practice_run_sets_own on public.practice_run_sets for select to authenticated using (exists (select 1 from public.practice_runs r where r.id = run_id and r.user_id = (select auth.uid())));
do $$ begin if to_regrole('service_role') is not null then grant all on public.practice_runs, public.practice_run_sets to service_role; end if; end $$;

-- Create the run with its first set, or reserve the next set. One transaction, one lock per student.
create or replace function public.practice_run_reserve(p_user uuid, p_run uuid, p_request_key text, p_expected_revision int, p_def jsonb, p_decision jsonb, p_paper jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.practice_runs%rowtype; v_block int; v_last record; v_total int; v_res jsonb; v_size int := jsonb_array_length(p_paper->'itemIds');
begin
  perform pg_advisory_xact_lock(hashtextextended('practice-runs:' || p_user::text, 0));
  if v_size <> 5 then return jsonb_build_object('ok', false, 'code', 'BAD_SET'); end if;
  if p_run is null then
    select * into v_run from public.practice_runs where user_id = p_user and request_key = p_request_key;
    if found then
      select s.attempt_id into v_last from public.practice_run_sets s where s.run_id = v_run.id order by block_no desc limit 1;
      return jsonb_build_object('ok', true, 'resumed', true, 'runId', v_run.id, 'attemptId', v_last.attempt_id, 'revision', v_run.revision);
    end if;
    v_block := 1;
  else
    select * into v_run from public.practice_runs where id = p_run and user_id = p_user for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
    select s.attempt_id, s.block_no, a.status into v_last from public.practice_run_sets s join public.assessment_attempts a on a.id = s.attempt_id where s.run_id = v_run.id order by s.block_no desc limit 1;
    if v_run.last_request_key is not distinct from p_request_key and p_request_key is not null then
      return jsonb_build_object('ok', true, 'resumed', true, 'runId', v_run.id, 'attemptId', v_last.attempt_id, 'revision', v_run.revision);
    end if;
    if v_run.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'RUN_CLOSED'); end if;
    if v_run.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'STALE_RUN', 'revision', v_run.revision); end if;
    if v_last.status not in ('submitted', 'scored', 'rescored', 'partially_voided', 'expired') then return jsonb_build_object('ok', false, 'code', 'SET_OPEN', 'attemptId', v_last.attempt_id); end if;
    select coalesce(sum(size), 0) into v_total from public.practice_run_sets where run_id = v_run.id;
    if v_total + v_size > v_run.cap then return jsonb_build_object('ok', false, 'code', 'CAP_REACHED'); end if;
    v_block := v_last.block_no + 1;
  end if;
  if p_run is null then
    insert into public.practice_runs(user_id, request_key, last_request_key, reading_id, outcome_ids, cap, policy_version)
      values (p_user, p_request_key, p_request_key, p_def->>'readingId', array(select jsonb_array_elements_text(coalesce(p_def->'outcomeIds', '[]'::jsonb))), (p_def->>'cap')::int, p_def->>'policy')
      returning * into v_run;
  end if;
  v_res := public._reserve_paper_json(p_user, p_paper || jsonb_build_object('openKey', 'practice-run:' || v_run.id || ':' || v_block));
  if coalesce((v_res->>'ok')::boolean, false) is not true then
    if p_run is null then delete from public.practice_runs where id = v_run.id; end if;
    return v_res;
  end if;
  insert into public.practice_run_sets(run_id, block_no, attempt_id, size, decision) values (v_run.id, v_block, (v_res->>'attemptId')::uuid, v_size, p_decision);
  update public.practice_runs set revision = revision + 1, last_request_key = p_request_key, updated_at = now() where id = v_run.id returning * into v_run;
  return jsonb_build_object('ok', true, 'resumed', false, 'runId', v_run.id, 'attemptId', v_res->>'attemptId', 'revision', v_run.revision, 'block', v_block);
end $$;
revoke all on function public.practice_run_reserve(uuid, uuid, text, int, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.practice_run_reserve(uuid, uuid, text, int, jsonb, jsonb, jsonb) to service_role;

create or replace function public.practice_run_stop(p_user uuid, p_run uuid, p_expected_revision int) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_run public.practice_runs%rowtype; v_last record;
begin
  perform pg_advisory_xact_lock(hashtextextended('practice-runs:' || p_user::text, 0));
  select * into v_run from public.practice_runs where id = p_run and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_run.status = 'stopped' then return jsonb_build_object('ok', true, 'repeated', true, 'revision', v_run.revision); end if;
  select a.status, s.attempt_id into v_last from public.practice_run_sets s join public.assessment_attempts a on a.id = s.attempt_id where s.run_id = v_run.id order by s.block_no desc limit 1;
  if v_last.status not in ('submitted', 'scored', 'rescored', 'partially_voided', 'expired') then return jsonb_build_object('ok', false, 'code', 'SET_OPEN', 'attemptId', v_last.attempt_id); end if;
  if p_expected_revision is not null and v_run.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'STALE_RUN', 'revision', v_run.revision); end if;
  update public.practice_runs set status = 'stopped', revision = revision + 1, updated_at = now() where id = p_run returning * into v_run;
  return jsonb_build_object('ok', true, 'revision', v_run.revision);
end $$;
revoke all on function public.practice_run_stop(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.practice_run_stop(uuid, uuid, int) to service_role;

notify pgrst, 'reload schema';
