-- Phase 2: reviewer workspace, atomic publication, item versions/families, durable generation batches, content boundary.
-- Additive only. Existing items, attempts and evidence are not rewritten or relabelled.

-- 1. Generation batches (durable, idempotent, resumable) -----------------------------------------
create table if not exists public.item_batches (
  id uuid primary key default gen_random_uuid(),
  request_key text not null unique,                   -- stable request identity: the same request never makes a second batch
  label text not null,
  manifest_id uuid not null references public.curriculum_manifests(id),
  curriculum_version text not null,
  source_provenance jsonb not null,                   -- what the authoring inputs were and their rights basis
  rights_status text not null default 'unconfirmed' check (rights_status in ('unconfirmed', 'cleared')),
  prompt_version text not null,
  model_versions jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'complete', 'failed', 'cancelled')),
  requested_count int not null,
  max_attempts int not null default 2 check (max_attempts between 1 and 5),
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  last_error text
);
create table if not exists public.item_batch_cells (
  batch_id uuid not null references public.item_batches(id) on delete cascade,
  ordinal int not null,
  cell jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'drafted', 'failed')),
  attempts int not null default 0,
  lease_until timestamptz,
  item_id text,
  verdict text,
  failure_reason text,
  defect_codes text[] not null default '{}',
  generate_ms int,
  provider_usage jsonb,
  updated_at timestamptz not null default now(),
  primary key (batch_id, ordinal)
);
create index if not exists item_batch_cells_open_idx on public.item_batch_cells (batch_id, status);

-- 2. Families, hold-out, versions ------------------------------------------------------------------
create table if not exists public.item_families (
  id uuid primary key default gen_random_uuid(),
  family_key text not null unique,
  held_out boolean not null default false,
  held_out_reason text,
  held_out_by uuid,
  held_out_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

-- family_id null = explicitly UNKNOWN family. A text hash (semantic_fingerprint) is only a duplicate hint, never a family.
alter table public.assessment_items add column if not exists family_id uuid references public.item_families(id);
alter table public.assessment_items add column if not exists held_out boolean not null default false;
alter table public.assessment_items add column if not exists supersedes_item_id text references public.assessment_items(id);
alter table public.assessment_items add column if not exists batch_id uuid references public.item_batches(id);
alter table public.item_batch_cells drop constraint if exists item_batch_cells_item_fk;
alter table public.item_batch_cells add constraint item_batch_cells_item_fk foreign key (item_id) references public.assessment_items(id) on delete set null;
create index if not exists assessment_items_state_reading_idx on public.assessment_items (review_status, lm_id);
create index if not exists assessment_items_batch_idx on public.assessment_items (batch_id) where batch_id is not null;
create index if not exists assessment_items_family_idx on public.assessment_items (family_id) where family_id is not null;
create index if not exists assessment_items_supersedes_idx on public.assessment_items (supersedes_item_id) where supersedes_item_id is not null;

alter table public.item_validations add column if not exists item_version int;

create table if not exists public.item_review_decisions (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.assessment_items(id) on delete cascade,
  item_version int not null,
  decision text not null check (decision in ('approve', 'reject', 'return', 'retire')),
  reviewer_id uuid not null,
  note text not null default '',
  acknowledged_disagreement boolean not null default false,
  created_at timestamptz not null default now()
);
-- One review decision per version, one retirement per version: repeated or racing decisions cannot duplicate history.
create unique index if not exists item_review_decisions_review_once on public.item_review_decisions (item_id, item_version) where decision in ('approve', 'reject', 'return');
create unique index if not exists item_review_decisions_retire_once on public.item_review_decisions (item_id, item_version) where decision = 'retire';

create table if not exists public.item_revisions (
  id uuid primary key default gen_random_uuid(),
  item_id text not null references public.assessment_items(id) on delete cascade,
  item_version int not null,
  kind text not null check (kind in ('created', 'edited', 'new_version', 'verified', 'returned', 'approved', 'rejected', 'retired', 'superseded', 'family', 'holdout')),
  actor_id uuid,
  summary text not null default '',
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists item_revisions_item_idx on public.item_revisions (item_id, created_at);

alter table public.item_batches enable row level security;
alter table public.item_batch_cells enable row level security;
alter table public.item_families enable row level security;
alter table public.item_review_decisions enable row level security;
alter table public.item_revisions enable row level security;
revoke all on public.item_batches, public.item_batch_cells, public.item_families, public.item_review_decisions, public.item_revisions from anon, authenticated;

-- 3. Guards ---------------------------------------------------------------------------------------
create or replace function public.is_item_reviewer() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'diagnostic_reviewer')
$$;

-- Human-reviewed status is granted only by the recorded decision command. No generator, import script or worker can set it,
-- and a used or published item's answer and meaning cannot be rewritten in place.
create or replace function public.items_review_guard() returns trigger language plpgsql set search_path = '' as $$
declare cmd boolean := coalesce(current_setting('app.review_command', true), '') = 'on';
begin
  if new.review_status = 'reviewed' and not cmd and (tg_op = 'INSERT' or old.review_status is distinct from 'reviewed') then
    raise exception 'REVIEW_COMMAND_REQUIRED: reviewed status is granted only by a recorded reviewer decision';
  end if;
  if tg_op = 'UPDATE' and not cmd
     and (old.stem, old.options, old.key_index, old.per_option_feedback) is distinct from (new.stem, new.options, new.key_index, new.per_option_feedback)
     and (old.review_status in ('reviewed', 'deprecated')
          or exists (select 1 from public.assessment_responses r where r.item_id = old.id)
          or exists (select 1 from public.form_items f where f.item_id = old.id)) then
    raise exception 'ITEM_IMMUTABLE: a published or used item cannot change its answer or meaning; edit it to create a new version';
  end if;
  return new;
end $$;
drop trigger if exists assessment_items_review_guard on public.assessment_items;
create trigger assessment_items_review_guard before insert or update on public.assessment_items for each row execute function public.items_review_guard();

create or replace function public.items_family_sync() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.family_id is not null then
    new.held_out := coalesce((select f.held_out from public.item_families f where f.id = new.family_id), new.held_out);
  end if;
  return new;
end $$;
drop trigger if exists assessment_items_family_sync on public.assessment_items;
create trigger assessment_items_family_sync before insert or update of family_id on public.assessment_items for each row execute function public.items_family_sync();

-- No paper can contain a question that is not human reviewed, and held-out families stay out of routine papers.
create or replace function public.form_items_boundary() returns trigger language plpgsql set search_path = '' as $$
declare v record;
begin
  select review_status, held_out into v from public.assessment_items where id = new.item_id;
  if v.review_status is distinct from 'reviewed' then raise exception 'ITEM_NOT_REVIEWED: only human-reviewed questions can enter a paper'; end if;
  if v.held_out and coalesce(current_setting('app.holdout_form', true), '') <> 'on' then
    raise exception 'ITEM_HELD_OUT: a held-out question cannot enter a routine paper';
  end if;
  return new;
end $$;
drop trigger if exists form_items_boundary on public.form_items;
create trigger form_items_boundary before insert on public.form_items for each row execute function public.form_items_boundary();

-- 4. Scoring: only human-reviewed items produce evidence (a recorded approval survives a later retirement) ------------
do $$
declare d text;
begin
  select pg_get_functiondef('public.finalize_assessment_attempt(uuid,text,text)'::regprocedure) into d;
  if position($o1$for v_item in select ai.review_status from public.assessment_items ai$o1$ in d) = 0
     or position($o2$if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;$o2$ in d) = 0 then
    raise exception 'finalize_assessment_attempt has an unexpected shape; refusing to patch it';
  end if;
  d := replace(d, $o1$for v_item in select ai.review_status from public.assessment_items ai$o1$, $n1$for v_item in select ai.id, ai.review_status from public.assessment_items ai$n1$);
  d := replace(d, $o2$if v_item.review_status not in ('reviewed', 'gold', 'verified', 'approved') then v_evidence_mode := 'practice'; end if;$o2$,
    $n2$if not (v_item.review_status = 'reviewed' or exists (select 1 from public.item_review_decisions d where d.item_id = v_item.id and d.decision = 'approve')) then v_evidence_mode := 'practice'; end if;$n2$);
  execute d;
end $$;

-- 5. Verification results (service role): stale-safe, one current set per version ------------------------------------
create or replace function public._write_item_verdict(p_item_id text, p_version int, p_gates jsonb, p_verdict text, p_reason text, p_model text, p_extra jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare g jsonb; v_status text;
begin
  delete from public.item_validations where item_id = p_item_id and reviewer_role in ('editorial_verifier', 'numerical_verifier')
    and coalesce(item_version, 1) = p_version;
  for g in select * from jsonb_array_elements(coalesce(p_gates, '[]'::jsonb)) loop
    insert into public.item_validations(item_id, reviewer_role, status, defect_codes, detail, item_version)
    values (p_item_id, case when g->>'gate' in ('numerical', 'distractors') then 'numerical_verifier' else 'editorial_verifier' end,
            case when (g->>'passed')::boolean then 'PASS' else 'REVISE' end,
            case when (g->>'passed')::boolean then '{}'::text[] else coalesce(array(select jsonb_array_elements_text(coalesce(p_extra->'defectCodes', '[]'::jsonb))), '{}') end,
            jsonb_build_object('gate', g->>'gate', 'detail', g->>'detail'), p_version);
  end loop;
  -- The overall verdict is its own row so a verifier disagreement (HUMAN_REVIEW) stays visible to the reviewer.
  insert into public.item_validations(item_id, reviewer_role, status, defect_codes, detail, item_version)
  values (p_item_id, 'editorial_verifier', p_verdict,
          coalesce(array(select jsonb_array_elements_text(coalesce(p_extra->'defectCodes', '[]'::jsonb))), '{}'),
          jsonb_build_object('gate', 'verdict', 'detail', coalesce(p_reason, ''), 'independentAnswerIndex', p_extra->'independentAnswerIndex', 'derivation', p_extra->'derivation'), p_version);
  v_status := case when p_verdict in ('PASS', 'HUMAN_REVIEW') then 'verified' else 'draft' end;
  update public.assessment_items set review_status = v_status, verifier_model = p_model,
    verified_at = case when v_status = 'verified' then now() else null end
    where id = p_item_id and review_status in ('draft', 'verified');
  insert into public.item_revisions(item_id, item_version, kind, summary) values (p_item_id, p_version, 'verified', 'Automatic check: ' || p_verdict);
  return v_status;
end $$;

create or replace function public.store_item_verification(p_item_id text, p_expected_version int, p_gates jsonb, p_verdict text, p_reason text, p_model text, p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_item public.assessment_items%rowtype; v_status text;
begin
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_item.item_version <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'The item was edited while it was being checked; the result was discarded.'); end if;
  if v_item.review_status in ('reviewed', 'deprecated') then return jsonb_build_object('ok', false, 'code', 'IMMUTABLE', 'message', 'A published or retired item is not re-checked in place; edit it to create a new version.'); end if;
  v_status := public._write_item_verdict(p_item_id, p_expected_version, p_gates, p_verdict, p_reason, p_model, p_extra);
  return jsonb_build_object('ok', true, 'status', v_status, 'verdict', p_verdict);
end $$;

-- 6. The publication decision: one authorised, atomic, idempotent command ------------------------------------------------
create or replace function public.decide_item_review(p_item_id text, p_expected_version int, p_decision text, p_note text default '', p_ack_disagreement boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.assessment_items%rowtype;
  v_note text := coalesce(btrim(p_note), '');
  v_blockers text[] := '{}';
  v_concept record; v_manifest uuid; v_batch record; v_pred text;
  v_has_approve boolean; v_prior text; v_disagree boolean; v_failed int; v_auto int;
  v_validation_status text;
begin
  if v_uid is null or not public.is_item_reviewer() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can decide an item.');
  end if;
  if p_decision not in ('approve', 'reject', 'return', 'retire') then
    return jsonb_build_object('ok', false, 'code', 'BAD_DECISION', 'message', 'Decision must be approve, reject, return or retire.');
  end if;
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item.'); end if;

  select decision into v_prior from public.item_review_decisions
    where item_id = p_item_id and item_version = p_expected_version and decision in (p_decision) limit 1;
  if v_prior is not null then
    return jsonb_build_object('ok', true, 'repeated', true, 'itemId', p_item_id, 'decision', p_decision, 'status', v_item.review_status, 'version', v_item.item_version);
  end if;
  if v_item.item_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'This item changed after you opened it. Reload to see the current version.');
  end if;
  select decision into v_prior from public.item_review_decisions
    where item_id = p_item_id and item_version = v_item.item_version and decision in ('approve', 'reject', 'return') limit 1;
  if v_prior is not null and p_decision <> 'retire' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_DECIDED', 'message', 'This version already has a different decision (' || v_prior || ').');
  end if;
  v_has_approve := exists (select 1 from public.item_review_decisions where item_id = p_item_id and decision = 'approve');

  if p_decision in ('reject', 'return', 'retire') and char_length(v_note) < 3 then
    return jsonb_build_object('ok', false, 'code', 'NOTE_REQUIRED', 'message', 'Say what is wrong. The reason is the record.');
  end if;

  if p_decision = 'approve' then
    if not (v_item.review_status = 'verified' or (v_item.review_status = 'reviewed' and not v_has_approve)) then
      v_blockers := v_blockers || case v_item.review_status
        when 'draft' then 'Not yet automatically checked, or the check failed. Re-verify it first.'
        when 'deprecated' then 'This item is retired.'
        else 'It is already human reviewed with a recorded decision.' end;
    end if;
    if jsonb_typeof(v_item.options) <> 'array' or jsonb_array_length(v_item.options) <> 3
       or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(v_item.options) o) <> 3
       or (select count(*) from jsonb_array_elements_text(v_item.options) o where btrim(o) = '') > 0 then
      v_blockers := v_blockers || 'It needs exactly three distinct, non-empty options.';
    end if;
    if v_item.key_index is null or v_item.key_index not between 0 and 2 then v_blockers := v_blockers || 'It has no valid answer key.'; end if;
    if char_length(coalesce(v_item.item_card->>'solution', '')) < 20 then v_blockers := v_blockers || 'It has no worked solution.'; end if;

    select id into v_manifest from public.curriculum_manifests where is_active = true limit 1;
    if v_item.concept_id is null or v_item.outcome_id is null then
      v_blockers := v_blockers || 'It is not mapped to a curriculum concept and outcome.';
    else
      select c.verification_status, c.manifest_id, c.name into v_concept from public.curriculum_concepts c where c.id = v_item.concept_id;
      if not found then v_blockers := v_blockers || 'Its concept no longer exists.';
      else
        if v_concept.manifest_id is distinct from v_manifest then v_blockers := v_blockers || 'Its concept is not in the active curriculum manifest.'; end if;
        if v_concept.verification_status <> 'verified' then v_blockers := v_blockers || ('The concept "' || v_concept.name || '" has not been signed off in the manifest.'); end if;
      end if;
      if not exists (select 1 from public.concept_outcome_map m join public.reading_los l on l.id = m.outcome_id
                      where m.concept_id = v_item.concept_id and m.outcome_id = v_item.outcome_id and l.reading_id = v_item.lm_id) then
        v_blockers := v_blockers || 'Its concept, outcome and reading do not agree in the curriculum map.';
      end if;
    end if;

    select count(*) filter (where status in ('REVISE', 'VOID')), count(*), coalesce(bool_or(status = 'HUMAN_REVIEW'), false)
      into v_failed, v_auto, v_disagree
      from public.item_validations where item_id = p_item_id and reviewer_role in ('editorial_verifier', 'numerical_verifier')
        and coalesce(item_version, 1) = v_item.item_version;
    if v_auto = 0 then v_blockers := v_blockers || 'There is no automatic check result for this version.'; end if;
    if v_failed > 0 then v_blockers := v_blockers || 'An automatic check failed for this version.'; end if;
    if v_disagree and not p_ack_disagreement then v_blockers := v_blockers || 'The automatic checkers disagree. Acknowledge the disagreement to approve.'; end if;

    if v_item.batch_id is not null then
      select rights_status into v_batch from public.item_batches where id = v_item.batch_id;
      if v_batch.rights_status is distinct from 'cleared' then v_blockers := v_blockers || 'The source rights for its batch are not confirmed as cleared.'; end if;
    end if;

    if array_length(v_blockers, 1) > 0 then
      return jsonb_build_object('ok', false, 'code', 'BLOCKED', 'message', 'Publication is blocked.', 'blockers', to_jsonb(v_blockers));
    end if;
  elsif p_decision in ('reject', 'return') then
    if v_item.review_status not in ('draft', 'verified') then
      return jsonb_build_object('ok', false, 'code', 'NOT_AWAITING_REVIEW', 'message', 'This item is "' || v_item.review_status || '"; only an unpublished item can be ' || p_decision || 'ed.');
    end if;
  else -- retire
    if v_item.review_status <> 'reviewed' then
      return jsonb_build_object('ok', false, 'code', 'NOT_PUBLISHED', 'message', 'Only a published item can be retired.');
    end if;
  end if;

  perform set_config('app.review_command', 'on', true);
  begin
    if p_decision = 'approve' then
      update public.assessment_items set review_status = 'reviewed', reviewed_at = now() where id = p_item_id;
      v_validation_status := 'PASS';
      if v_item.supersedes_item_id is not null then
        update public.assessment_items set review_status = 'deprecated', reviewed_at = coalesce(reviewed_at, now()) where id = v_item.supersedes_item_id and review_status <> 'deprecated';
        insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
          select id, item_version, 'superseded', v_uid, 'Replaced by ' || p_item_id from public.assessment_items where id = v_item.supersedes_item_id;
      end if;
    elsif p_decision = 'reject' or p_decision = 'retire' then
      update public.assessment_items set review_status = 'deprecated', reviewed_at = now() where id = p_item_id;
      v_validation_status := 'VOID';
    else -- return: the decision consumes this version; the corrected item is a new version
      update public.assessment_items set review_status = 'draft', verified_at = null, item_version = item_version + 1 where id = p_item_id;
      v_validation_status := 'REVISE';
    end if;

    insert into public.item_review_decisions(item_id, item_version, decision, reviewer_id, note, acknowledged_disagreement)
      values (p_item_id, v_item.item_version, p_decision, v_uid, v_note, coalesce(p_ack_disagreement, false));
    -- Kept so verifier-human agreement stays measurable from one table.
    insert into public.item_validations(item_id, reviewer_role, status, defect_codes, detail, item_version)
      values (p_item_id, 'human_reviewer', v_validation_status, case when p_decision = 'approve' then '{}'::text[] else array['HUMAN_' || upper(p_decision)] end,
              jsonb_build_object('decision', p_decision, 'note', v_note, 'reviewerId', v_uid, 'at', now()), v_item.item_version);
    insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
      values (p_item_id, v_item.item_version, case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' when 'return' then 'returned' else 'retired' end, v_uid, v_note);
  exception when others then
    perform set_config('app.review_command', '', true);
    raise;
  end;
  perform set_config('app.review_command', '', true);

  return jsonb_build_object('ok', true, 'itemId', p_item_id, 'decision', p_decision,
    'status', (select review_status from public.assessment_items where id = p_item_id),
    'version', (select item_version from public.assessment_items where id = p_item_id));
end $$;

-- 7. Editing: draft/verified items change in place; published or used items get a NEW candidate version ---------------
create or replace function public.edit_item(p_item_id text, p_expected_version int, p_patch jsonb, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_item public.assessment_items%rowtype;
  v_new_id text; v_base text; v_existing text; v_new_version int;
  v_options jsonb; v_stem text; v_key int; v_outcome text; v_lm text; v_new_mode boolean;
  v_note text := coalesce(btrim(p_note), '');
begin
  if v_uid is null or not public.is_item_reviewer() then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can edit an item.');
  end if;
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item.'); end if;
  if v_item.item_version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'This item changed after you opened it. Reload to see the current version.');
  end if;
  if v_item.review_status = 'deprecated' then
    return jsonb_build_object('ok', false, 'code', 'RETIRED', 'message', 'A retired item cannot be edited.');
  end if;

  v_options := case when p_patch ? 'options' then p_patch->'options' else v_item.options end;
  v_stem := case when p_patch ? 'stem' then btrim(p_patch->>'stem') else v_item.stem end;
  v_key := case when p_patch ? 'key_index' then (p_patch->>'key_index')::int else v_item.key_index end;
  if char_length(coalesce(v_stem, '')) < 20 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'The question text is too short.'); end if;
  if jsonb_typeof(v_options) <> 'array' or jsonb_array_length(v_options) <> 3
     or (select count(distinct lower(btrim(o))) from jsonb_array_elements_text(v_options) o) <> 3
     or (select count(*) from jsonb_array_elements_text(v_options) o where btrim(o) = '') > 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'A question needs exactly three distinct, non-empty options.');
  end if;
  if v_key is null or v_key not between 0 and 2 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Choose which option is correct.'); end if;
  v_outcome := case when p_patch ? 'outcome_id' then nullif(p_patch->>'outcome_id', '') else v_item.outcome_id end;
  v_lm := v_item.lm_id;
  if p_patch ? 'outcome_id' and v_outcome is not null then
    select reading_id into v_lm from public.reading_los where id = v_outcome;
    if v_lm is null then return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'That outcome does not exist.'); end if;
  end if;

  v_new_mode := v_item.review_status = 'reviewed'
    or exists (select 1 from public.assessment_responses r where r.item_id = p_item_id)
    or exists (select 1 from public.form_items f where f.item_id = p_item_id);
  v_new_version := v_item.item_version + 1;

  perform set_config('app.review_command', 'on', true);
  if v_new_mode then
    select id into v_existing from public.assessment_items where supersedes_item_id = p_item_id and review_status <> 'deprecated' limit 1;
    if v_existing is not null then
      perform set_config('app.review_command', '', true);
      return jsonb_build_object('ok', false, 'code', 'SUCCESSOR_EXISTS', 'message', 'A newer candidate version of this item already exists.', 'itemId', v_existing);
    end if;
    v_base := regexp_replace(p_item_id, '-v[0-9]+$', '');
    v_new_id := v_base || '-v' || v_new_version;
    insert into public.assessment_items(id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance,
        review_status, concept_id, cognition, item_form, intended_difficulty, item_version, key_index, item_card, semantic_fingerprint, generator_model, outcome_id,
        family_id, held_out, supersedes_item_id)
      values (v_new_id, v_lm, v_item.learning_objective, v_item.verification_intent, v_item.difficulty, v_stem, v_options,
        case when p_patch ? 'per_option_feedback' then p_patch->'per_option_feedback' else v_item.per_option_feedback end,
        coalesce(v_item.provenance, '') || ' (revised from ' || p_item_id || ')', 'draft',
        case when p_patch ? 'concept_id' then nullif(p_patch->>'concept_id', '')::uuid else v_item.concept_id end,
        coalesce(p_patch->>'cognition', v_item.cognition), coalesce(p_patch->>'item_form', v_item.item_form), coalesce(p_patch->>'intended_difficulty', v_item.intended_difficulty),
        v_new_version, v_key, case when p_patch ? 'item_card' then p_patch->'item_card' else v_item.item_card end,
        p_patch->>'semantic_fingerprint', v_item.generator_model, v_outcome, v_item.family_id, v_item.held_out, p_item_id);
    insert into public.item_revisions(item_id, item_version, kind, actor_id, summary, snapshot)
      values (v_new_id, v_new_version, 'new_version', v_uid, coalesce(nullif(v_note, ''), 'New candidate version of ' || p_item_id),
              (select to_jsonb(i) - 'item_card' from public.assessment_items i where i.id = v_new_id));
    perform set_config('app.review_command', '', true);
    return jsonb_build_object('ok', true, 'mode', 'new_version', 'itemId', v_new_id, 'version', v_new_version, 'supersedes', p_item_id);
  end if;

  update public.assessment_items set
    stem = v_stem, options = v_options, key_index = v_key, lm_id = v_lm, outcome_id = v_outcome,
    per_option_feedback = case when p_patch ? 'per_option_feedback' then p_patch->'per_option_feedback' else per_option_feedback end,
    item_card = case when p_patch ? 'item_card' then p_patch->'item_card' else item_card end,
    concept_id = case when p_patch ? 'concept_id' then nullif(p_patch->>'concept_id', '')::uuid else concept_id end,
    cognition = coalesce(p_patch->>'cognition', cognition), item_form = coalesce(p_patch->>'item_form', item_form),
    intended_difficulty = coalesce(p_patch->>'intended_difficulty', intended_difficulty),
    semantic_fingerprint = coalesce(p_patch->>'semantic_fingerprint', semantic_fingerprint),
    item_version = v_new_version, review_status = 'draft', verified_at = null
    where id = p_item_id;
  insert into public.item_revisions(item_id, item_version, kind, actor_id, summary, snapshot)
    values (p_item_id, v_new_version, 'edited', v_uid, v_note, (select to_jsonb(i) - 'item_card' from public.assessment_items i where i.id = p_item_id));
  perform set_config('app.review_command', '', true);
  return jsonb_build_object('ok', true, 'mode', 'in_place', 'itemId', p_item_id, 'version', v_new_version);
end $$;

-- 8. Families and hold-out ---------------------------------------------------------------------------------------------
create or replace function public.group_items_in_family(p_item_ids text[], p_family_id uuid default null, p_note text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_family uuid := p_family_id; v_n int; v_id text;
begin
  if v_uid is null or not public.is_item_reviewer() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can group items.'); end if;
  select count(*) into v_n from public.assessment_items where id = any(p_item_ids);
  if coalesce(array_length(p_item_ids, 1), 0) = 0 or v_n <> array_length(p_item_ids, 1) then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'One or more items do not exist.'); end if;
  if v_family is null then
    insert into public.item_families(family_key, note) values ('fam-' || gen_random_uuid()::text, nullif(btrim(p_note), '')) returning id into v_family;
  elsif not exists (select 1 from public.item_families where id = v_family) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown family.');
  end if;
  update public.assessment_items set family_id = v_family where id = any(p_item_ids);
  for v_id in select unnest(p_item_ids) loop
    insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
      select id, item_version, 'family', v_uid, 'Grouped in family ' || v_family from public.assessment_items where id = v_id;
  end loop;
  return jsonb_build_object('ok', true, 'familyId', v_family);
end $$;

create or replace function public.set_item_holdout(p_family_id uuid, p_item_id text, p_held_out boolean, p_reason text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_reason text := coalesce(btrim(p_reason), '');
begin
  if v_uid is null or not public.is_item_reviewer() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can change a hold-out.'); end if;
  if p_held_out and char_length(v_reason) < 3 then return jsonb_build_object('ok', false, 'code', 'NOTE_REQUIRED', 'message', 'Say why this is held out.'); end if;
  if p_family_id is not null then
    update public.item_families set held_out = p_held_out, held_out_reason = case when p_held_out then v_reason else null end,
      held_out_by = v_uid, held_out_at = now() where id = p_family_id;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown family.'); end if;
    update public.assessment_items set held_out = p_held_out where family_id = p_family_id;
  elsif p_item_id is not null then
    -- Family unknown: only this one item is held out. Its unknown relatives cannot be inferred from a text hash.
    update public.assessment_items set held_out = p_held_out where id = p_item_id and family_id is null;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item, or it belongs to a family (hold out the family).'); end if;
    insert into public.item_revisions(item_id, item_version, kind, actor_id, summary)
      select id, item_version, 'holdout', v_uid, case when p_held_out then 'Held out: ' || v_reason else 'Hold-out released' end from public.assessment_items where id = p_item_id;
  else
    return jsonb_build_object('ok', false, 'code', 'INVALID', 'message', 'Name a family or an item.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- 9. Batch worker commands (service role only) --------------------------------------------------------------------------
create or replace function public._settle_batch(p_batch uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_b public.item_batches%rowtype; v_open int; v_drafted int;
begin
  update public.item_batch_cells c set status = 'failed', failure_reason = coalesce(failure_reason, 'lease expired after the last allowed attempt'), updated_at = now()
    from public.item_batches b where c.batch_id = b.id and b.id = p_batch and c.status = 'running' and c.lease_until < now() and c.attempts >= b.max_attempts;
  select * into v_b from public.item_batches where id = p_batch;
  if v_b.status in ('cancelled', 'complete', 'failed') then return; end if;
  select count(*) filter (where status in ('pending', 'running')), count(*) filter (where status = 'drafted') into v_open, v_drafted from public.item_batch_cells where batch_id = p_batch;
  if v_open = 0 then
    update public.item_batches set status = case when v_drafted > 0 then 'complete' else 'failed' end, finished_at = now(),
      last_error = case when v_drafted = 0 then 'No cell produced a candidate' else last_error end where id = p_batch;
  end if;
end $$;

create or replace function public.claim_batch_cell(p_batch uuid, p_lease_seconds int default 600) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.item_batches%rowtype; v_c public.item_batch_cells%rowtype;
begin
  select * into v_b from public.item_batches where id = p_batch for update;
  if not found or v_b.status in ('cancelled', 'complete', 'failed') then return null; end if;
  if v_b.status = 'queued' then update public.item_batches set status = 'running', started_at = now() where id = p_batch; end if;
  select * into v_c from public.item_batch_cells
    where batch_id = p_batch and attempts < v_b.max_attempts and (status = 'pending' or (status = 'running' and lease_until < now()))
    order by ordinal limit 1 for update skip locked;
  if not found then perform public._settle_batch(p_batch); return null; end if;
  update public.item_batch_cells set status = 'running', attempts = attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    where batch_id = p_batch and ordinal = v_c.ordinal returning * into v_c;
  return to_jsonb(v_c);
end $$;

create or replace function public.store_batch_cell(p_batch uuid, p_ordinal int, p_item jsonb, p_gates jsonb, p_verdict text, p_reason text, p_model text, p_extra jsonb, p_generate_ms int, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.item_batch_cells%rowtype; v_b public.item_batches%rowtype; v_id text; v_family uuid;
begin
  select * into v_c from public.item_batch_cells where batch_id = p_batch and ordinal = p_ordinal for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_c.status = 'drafted' then return jsonb_build_object('ok', true, 'repeated', true, 'itemId', v_c.item_id); end if;
  if v_c.status <> 'running' then return jsonb_build_object('ok', false, 'code', 'NOT_RUNNING'); end if;
  select * into v_b from public.item_batches where id = p_batch;
  v_id := 'bq-' || left(replace(p_batch::text, '-', ''), 8) || '-' || p_ordinal;
  insert into public.item_families(family_key, note) values ('fam-' || v_id, 'One construction from batch ' || v_b.label) on conflict (family_key) do nothing;
  select id into v_family from public.item_families where family_key = 'fam-' || v_id;
  insert into public.assessment_items(id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status,
      concept_id, cognition, item_form, intended_difficulty, key_index, item_card, semantic_fingerprint, generator_model, outcome_id, family_id, batch_id)
    values (v_id, p_item->>'lm_id', p_item->>'learning_objective', p_item->>'verification_intent', (p_item->>'difficulty')::numeric, p_item->>'stem', p_item->'options',
      p_item->'per_option_feedback', 'Generated candidate, batch ' || v_b.label || ' (' || v_b.curriculum_version || ')', 'draft',
      (p_item->>'concept_id')::uuid, p_item->>'cognition', p_item->>'item_form', p_item->>'intended_difficulty', (p_item->>'key_index')::int, p_item->'item_card',
      p_item->>'semantic_fingerprint', p_item->>'generator_model', p_item->>'outcome_id', v_family, p_batch)
    on conflict (id) do nothing;
  insert into public.item_revisions(item_id, item_version, kind, summary) values (v_id, 1, 'created', 'Generated in batch ' || v_b.label) ;
  perform public._write_item_verdict(v_id, 1, p_gates, p_verdict, p_reason, p_model, p_extra);
  update public.item_batch_cells set status = 'drafted', item_id = v_id, verdict = p_verdict, failure_reason = null, lease_until = null,
    generate_ms = p_generate_ms, provider_usage = p_usage, updated_at = now() where batch_id = p_batch and ordinal = p_ordinal;
  perform public._settle_batch(p_batch);
  return jsonb_build_object('ok', true, 'itemId', v_id);
end $$;

create or replace function public.fail_batch_cell(p_batch uuid, p_ordinal int, p_reason text, p_codes text[], p_verdict text, p_usage jsonb, p_ms int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.item_batch_cells%rowtype; v_max int;
begin
  select * into v_c from public.item_batch_cells where batch_id = p_batch and ordinal = p_ordinal for update;
  if not found or v_c.status <> 'running' then return jsonb_build_object('ok', false, 'code', 'NOT_RUNNING'); end if;
  select max_attempts into v_max from public.item_batches where id = p_batch;
  update public.item_batch_cells set status = case when attempts >= v_max then 'failed' else 'pending' end, lease_until = null,
    failure_reason = left(p_reason, 600), defect_codes = coalesce(p_codes, '{}'), verdict = p_verdict, generate_ms = p_ms, provider_usage = p_usage, updated_at = now()
    where batch_id = p_batch and ordinal = p_ordinal;
  perform public._settle_batch(p_batch);
  return jsonb_build_object('ok', true);
end $$;

-- 10. Permissions -------------------------------------------------------------------------------------------------------
revoke all on function public.is_item_reviewer(), public._write_item_verdict(text, int, jsonb, text, text, text, jsonb), public.store_item_verification(text, int, jsonb, text, text, text, jsonb),
  public.decide_item_review(text, int, text, text, boolean), public.edit_item(text, int, jsonb, text), public.group_items_in_family(text[], uuid, text),
  public.set_item_holdout(uuid, text, boolean, text), public._settle_batch(uuid), public.claim_batch_cell(uuid, int),
  public.store_batch_cell(uuid, int, jsonb, jsonb, text, text, text, jsonb, int, jsonb), public.fail_batch_cell(uuid, int, text, text[], text, jsonb, int) from public, anon, authenticated;
grant execute on function public.is_item_reviewer(), public.decide_item_review(text, int, text, text, boolean), public.edit_item(text, int, jsonb, text),
  public.group_items_in_family(text[], uuid, text), public.set_item_holdout(uuid, text, boolean, text) to authenticated;
grant execute on function public._write_item_verdict(text, int, jsonb, text, text, text, jsonb), public.store_item_verification(text, int, jsonb, text, text, text, jsonb), public._settle_batch(uuid),
  public.claim_batch_cell(uuid, int), public.store_batch_cell(uuid, int, jsonb, jsonb, text, text, text, jsonb, int, jsonb), public.fail_batch_cell(uuid, int, text, text[], text, jsonb, int) to service_role;

notify pgrst, 'reload schema';
