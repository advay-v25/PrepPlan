-- T2 content operations: atomic, idempotent batch creation; fenced claims; budget reservations; provisional families.
-- Additive. Existing items, families, batches and student evidence are not relabelled. Applied migrations are untouched:
-- the old store/fail overloads are dropped here because they could write without proving ownership of the current claim.

-- 1. Batch snapshot, budget, rights authority, attempt history --------------------------------------------------------
alter table public.item_batches add column if not exists config_hash text;
alter table public.item_batches add column if not exists config jsonb;                 -- the exact inputs the batch was planned from; resuming never re-plans
alter table public.item_batches add column if not exists budget jsonb;                 -- {maxRequests, maxTokens, wallSeconds}; null = unbounded (legacy)
alter table public.item_batches add column if not exists requests_reserved int not null default 0;
alter table public.item_batches add column if not exists tokens_reserved bigint not null default 0;
alter table public.item_batches add column if not exists parent_batch_id uuid references public.item_batches(id);
alter table public.item_batches add column if not exists rights_ref text;              -- who/what authorised the input use; a flag alone is not provenance
alter table public.item_batches drop constraint if exists item_batches_status_check;
alter table public.item_batches add constraint item_batches_status_check
  check (status in ('queued', 'running', 'complete', 'failed', 'cancelled', 'budget_exhausted'));

alter table public.item_batch_cells add column if not exists claim_token uuid;         -- fencing token: only the current claim may store, fail or extend

create table if not exists public.item_batch_attempts (
  batch_id uuid not null references public.item_batches(id) on delete cascade,
  ordinal int not null,
  attempt int not null,
  claim_token uuid not null,
  claimed_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text,                                       -- drafted | failed | lease_expired | stale_refused | cancelled | duplicate
  code text,
  ms int,
  usage jsonb,
  primary key (batch_id, ordinal, attempt)
);
alter table public.item_batch_attempts enable row level security;

-- 2. Families: a generated candidate starts PROVISIONAL; only a reviewer's act makes it independent supply ----------------
alter table public.item_families add column if not exists construction_status text not null default 'confirmed'
  check (construction_status in ('provisional', 'confirmed'));
alter table public.item_families add column if not exists confirmed_by uuid;
alter table public.item_families add column if not exists confirmed_at timestamptz;
-- Historical batch families that no human has published are provisional; published and hand-made families keep counting as before.
update public.item_families f set construction_status = 'provisional'
  where f.family_key like 'fam-bq-%' and f.construction_status = 'confirmed'
    and not exists (select 1 from public.assessment_items i where i.family_id = f.id and i.review_status = 'reviewed');

-- 3. Publication blockers: unconfirmed family; "cleared" rights without a recorded authority --------------------------
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.item_publish_blockers(text,boolean)'::regprocedure) into v_def;
  if position('construction_status' in v_def) > 0 then return; end if;
  v_new := replace(v_def, E'  return v_blockers;\nend', E'  if v_item.family_id is not null and exists (select 1 from public.item_families where id = v_item.family_id and construction_status = ''provisional'') then
    v_blockers := array_append(v_blockers, ''Its question family is provisional. Confirm the construction or group it with its siblings first.'');
  end if;
  if v_item.batch_id is not null and exists (select 1 from public.item_batches where id = v_item.batch_id and rights_status = ''cleared'' and coalesce(btrim(rights_ref), '''') = '''') then
    v_blockers := array_append(v_blockers, ''Its batch is marked cleared but records no authority for the input use.'');
  end if;
  return v_blockers;\nend');
  if v_new = v_def then raise exception 'item_publish_blockers tail not found; refusing to patch blindly'; end if;
  execute v_new;
end $$;

-- 4. Reviewer family commands -----------------------------------------------------------------------------------------
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.group_items_in_family(text[],uuid,text)'::regprocedure) into v_def;
  if position('construction_status' in v_def) > 0 then return; end if;
  v_new := replace(v_def, E'  update public.assessment_items set family_id = v_family where id = any(p_item_ids);',
    E'  update public.item_families set construction_status = ''confirmed'', confirmed_by = v_uid, confirmed_at = now() where id = v_family;\n  update public.assessment_items set family_id = v_family where id = any(p_item_ids);');
  if v_new = v_def then raise exception 'group_items_in_family anchor not found; refusing to patch blindly'; end if;
  execute v_new;
end $$;

create or replace function public.confirm_item_family(p_item_id text, p_expected_version int, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_item public.assessment_items%rowtype;
begin
  if v_uid is null or not public.is_item_reviewer() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can confirm a family.'); end if;
  if char_length(coalesce(btrim(p_note), '')) < 3 then return jsonb_build_object('ok', false, 'code', 'NOTE_REQUIRED', 'message', 'Say why this is its own construction.'); end if;
  select * into v_item from public.assessment_items where id = p_item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown item.'); end if;
  if v_item.item_version <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'STALE_VERSION', 'message', 'This item changed after you opened it.'); end if;
  if v_item.family_id is null then return jsonb_build_object('ok', false, 'code', 'NO_FAMILY', 'message', 'This item has no family to confirm.'); end if;
  update public.item_families set construction_status = 'confirmed', confirmed_by = v_uid, confirmed_at = now() where id = v_item.family_id and construction_status = 'provisional';
  insert into public.item_revisions(item_id, item_version, kind, actor_id, summary) values (p_item_id, v_item.item_version, 'family', v_uid, 'Family confirmed: ' || btrim(p_note));
  return jsonb_build_object('ok', true, 'familyId', v_item.family_id);
end $$;

-- 5. Atomic, idempotent batch creation --------------------------------------------------------------------------------
create or replace function public.create_item_batch(p_request_key text, p_config_hash text, p_batch jsonb, p_cells jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing public.item_batches%rowtype; v_id uuid; v_n int; v_rights text := coalesce(p_batch->>'rights_status', 'unconfirmed');
begin
  if coalesce(btrim(p_request_key), '') = '' or coalesce(btrim(p_config_hash), '') = '' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  if jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) = 0 then return jsonb_build_object('ok', false, 'code', 'NO_CELLS'); end if;
  if v_rights = 'cleared' and coalesce(btrim(p_batch->>'rights_ref'), '') = '' then return jsonb_build_object('ok', false, 'code', 'RIGHTS_AUTHORITY_REQUIRED'); end if;
  perform pg_advisory_xact_lock(hashtext('batch:' || p_request_key));
  select * into v_existing from public.item_batches where request_key = p_request_key;
  if found then
    select count(*) into v_n from public.item_batch_cells where batch_id = v_existing.id;
    if v_existing.config_hash is distinct from p_config_hash then return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT', 'batchId', v_existing.id); end if;
    if v_n <> v_existing.requested_count then return jsonb_build_object('ok', false, 'code', 'INCOMPLETE_BATCH', 'batchId', v_existing.id); end if;
    return jsonb_build_object('ok', true, 'created', false, 'batchId', v_existing.id, 'cells', v_n);
  end if;
  insert into public.item_batches(request_key, label, manifest_id, curriculum_version, source_provenance, rights_status, rights_ref, prompt_version, model_versions,
      requested_count, max_attempts, config_hash, config, budget, parent_batch_id)
    values (p_request_key, p_batch->>'label', (p_batch->>'manifest_id')::uuid, p_batch->>'curriculum_version', coalesce(p_batch->'source_provenance', '{}'::jsonb), v_rights,
      nullif(btrim(p_batch->>'rights_ref'), ''), p_batch->>'prompt_version', coalesce(p_batch->'model_versions', '{}'::jsonb), jsonb_array_length(p_cells),
      coalesce((p_batch->>'max_attempts')::int, 2), p_config_hash, p_batch->'config', p_batch->'budget', nullif(p_batch->>'parent_batch_id', '')::uuid)
    returning id into v_id;
  insert into public.item_batch_cells(batch_id, ordinal, cell)
    select v_id, t.ord::int, t.cell from jsonb_array_elements(p_cells) with ordinality as t(cell, ord);
  return jsonb_build_object('ok', true, 'created', true, 'batchId', v_id, 'cells', jsonb_array_length(p_cells));
end $$;

-- 6. Settlement, claim, fenced store / fail / extend, budget, cancel --------------------------------------------------
create or replace function public._settle_batch(p_batch uuid) returns void language plpgsql security definer set search_path = '' as $$
declare v_b public.item_batches%rowtype; v_open int; v_drafted int;
begin
  update public.item_batch_cells c set status = 'failed', failure_reason = coalesce(failure_reason, 'lease expired after the last allowed attempt'), updated_at = now()
    from public.item_batches b where c.batch_id = b.id and b.id = p_batch and c.status = 'running' and c.lease_until < now() and c.attempts >= b.max_attempts;
  select * into v_b from public.item_batches where id = p_batch;
  if v_b.status in ('cancelled', 'complete', 'failed', 'budget_exhausted') then return; end if;
  select count(*) filter (where status in ('pending', 'running')), count(*) filter (where status = 'drafted') into v_open, v_drafted from public.item_batch_cells where batch_id = p_batch;
  if v_open = 0 then
    update public.item_batches set status = case when v_drafted > 0 then 'complete' else 'failed' end, finished_at = now(),
      last_error = case when v_drafted = 0 then 'No cell produced a candidate' else last_error end where id = p_batch;
  end if;
end $$;

create or replace function public._stop_batch_budget(p_batch uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.item_batch_cells set status = 'failed', lease_until = null, verdict = 'BUDGET_EXHAUSTED', defect_codes = array['BUDGET_EXHAUSTED'],
      failure_reason = coalesce(failure_reason, p_reason), updated_at = now()
    where batch_id = p_batch and status = 'pending';
  update public.item_batches set status = 'budget_exhausted', finished_at = now(), last_error = p_reason where id = p_batch and status in ('queued', 'running');
end $$;

create or replace function public.claim_batch_cell(p_batch uuid, p_lease_seconds int default 600) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.item_batches%rowtype; v_c public.item_batch_cells%rowtype; v_tok uuid := gen_random_uuid();
begin
  select * into v_b from public.item_batches where id = p_batch for update;
  if not found or v_b.status in ('cancelled', 'complete', 'failed', 'budget_exhausted') then return null; end if;
  if v_b.budget is not null and v_b.started_at is not null and coalesce((v_b.budget->>'wallSeconds')::int, 0) > 0
     and v_b.started_at + make_interval(secs => (v_b.budget->>'wallSeconds')::int) < now() then
    perform public._stop_batch_budget(p_batch, 'The batch wall-clock limit was reached.'); return null;
  end if;
  if v_b.budget is not null and coalesce((v_b.budget->>'maxRequests')::int, 0) > 0 and v_b.requests_reserved >= (v_b.budget->>'maxRequests')::int then
    perform public._stop_batch_budget(p_batch, 'The batch provider-request budget was used up.'); return null;
  end if;
  if v_b.status = 'queued' then update public.item_batches set status = 'running', started_at = now() where id = p_batch; end if;
  select * into v_c from public.item_batch_cells
    where batch_id = p_batch and attempts < v_b.max_attempts and (status = 'pending' or (status = 'running' and lease_until < now()))
    order by ordinal limit 1 for update skip locked;
  if not found then perform public._settle_batch(p_batch); return null; end if;
  update public.item_batch_attempts set outcome = 'lease_expired', finished_at = now() where batch_id = p_batch and ordinal = v_c.ordinal and outcome is null;
  update public.item_batch_cells set status = 'running', attempts = attempts + 1, claim_token = v_tok, lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    where batch_id = p_batch and ordinal = v_c.ordinal returning * into v_c;
  insert into public.item_batch_attempts(batch_id, ordinal, attempt, claim_token) values (p_batch, v_c.ordinal, v_c.attempts, v_tok);
  return to_jsonb(v_c) || jsonb_build_object('claimToken', v_tok);
end $$;

drop function if exists public.store_batch_cell(uuid, int, jsonb, jsonb, text, text, text, jsonb, int, jsonb);
drop function if exists public.fail_batch_cell(uuid, int, text, text[], text, jsonb, int);

create or replace function public.store_batch_cell(p_batch uuid, p_ordinal int, p_claim uuid, p_item jsonb, p_gates jsonb, p_verdict text, p_reason text, p_model text, p_extra jsonb, p_generate_ms int, p_usage jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.item_batch_cells%rowtype; v_b public.item_batches%rowtype; v_id text; v_family uuid; v_fp text := p_item->>'semantic_fingerprint';
begin
  select * into v_b from public.item_batches where id = p_batch for share;
  select * into v_c from public.item_batch_cells where batch_id = p_batch and ordinal = p_ordinal for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_c.claim_token is distinct from p_claim then
    update public.item_batch_attempts set outcome = 'stale_refused', finished_at = now() where batch_id = p_batch and ordinal = p_ordinal and claim_token = p_claim and outcome is null;
    return jsonb_build_object('ok', false, 'code', 'STALE_CLAIM');
  end if;
  if v_c.status = 'drafted' then return jsonb_build_object('ok', true, 'repeated', true, 'itemId', v_c.item_id); end if;
  if v_b.status in ('cancelled', 'budget_exhausted') then return jsonb_build_object('ok', false, 'code', 'CANCELLED'); end if;
  if v_c.status <> 'running' then return jsonb_build_object('ok', false, 'code', 'NOT_RUNNING'); end if;
  v_id := 'bq-' || left(replace(p_batch::text, '-', ''), 8) || '-' || p_ordinal;
  -- Equivalent output from two workers is decided here, under a lock on the fingerprint, not in either worker's memory.
  if v_fp is not null then
    perform pg_advisory_xact_lock(hashtext('fp:' || v_fp));
    if exists (select 1 from public.assessment_items where semantic_fingerprint = v_fp and id <> v_id) then
      update public.item_batch_cells set status = case when attempts >= v_b.max_attempts then 'failed' else 'pending' end, lease_until = null, verdict = 'DUPLICATE',
          defect_codes = array['DUPLICATE_OUTPUT'], failure_reason = 'An equivalent question already exists (same normalised construction).', generate_ms = p_generate_ms, provider_usage = p_usage, updated_at = now()
        where batch_id = p_batch and ordinal = p_ordinal;
      update public.item_batch_attempts set outcome = 'duplicate', code = 'DUPLICATE_OUTPUT', finished_at = now(), ms = p_generate_ms, usage = p_usage where batch_id = p_batch and ordinal = p_ordinal and claim_token = p_claim;
      perform public._settle_batch(p_batch);
      return jsonb_build_object('ok', false, 'code', 'DUPLICATE_OUTPUT');
    end if;
  end if;
  insert into public.item_families(family_key, note, construction_status) values ('fam-' || v_id, 'Provisional: one unconfirmed construction from batch ' || v_b.label, 'provisional') on conflict (family_key) do nothing;
  select id into v_family from public.item_families where family_key = 'fam-' || v_id;
  insert into public.assessment_items(id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status,
      concept_id, cognition, item_form, intended_difficulty, key_index, item_card, semantic_fingerprint, generator_model, outcome_id, family_id, batch_id)
    values (v_id, p_item->>'lm_id', p_item->>'learning_objective', p_item->>'verification_intent', (p_item->>'difficulty')::numeric, p_item->>'stem', p_item->'options',
      p_item->'per_option_feedback', 'Generated candidate, batch ' || v_b.label || ' (' || v_b.curriculum_version || ')', 'draft',
      (p_item->>'concept_id')::uuid, p_item->>'cognition', p_item->>'item_form', p_item->>'intended_difficulty', (p_item->>'key_index')::int, p_item->'item_card',
      v_fp, p_item->>'generator_model', p_item->>'outcome_id', v_family, p_batch)
    on conflict (id) do nothing;
  insert into public.item_revisions(item_id, item_version, kind, summary) values (v_id, 1, 'created', 'Generated in batch ' || v_b.label);
  perform public._write_item_verdict(v_id, 1, p_gates, p_verdict, p_reason, p_model, p_extra);
  update public.item_batch_cells set status = 'drafted', item_id = v_id, verdict = p_verdict, failure_reason = null, lease_until = null,
    generate_ms = p_generate_ms, provider_usage = p_usage, updated_at = now() where batch_id = p_batch and ordinal = p_ordinal;
  update public.item_batch_attempts set outcome = 'drafted', code = p_verdict, finished_at = now(), ms = p_generate_ms, usage = p_usage where batch_id = p_batch and ordinal = p_ordinal and claim_token = p_claim;
  perform public._settle_batch(p_batch);
  return jsonb_build_object('ok', true, 'itemId', v_id);
end $$;

create or replace function public.fail_batch_cell(p_batch uuid, p_ordinal int, p_claim uuid, p_reason text, p_codes text[], p_verdict text, p_usage jsonb, p_ms int, p_reject jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.item_batch_cells%rowtype; v_b public.item_batches%rowtype;
begin
  select * into v_b from public.item_batches where id = p_batch for share;
  select * into v_c from public.item_batch_cells where batch_id = p_batch and ordinal = p_ordinal for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_c.claim_token is distinct from p_claim then
    update public.item_batch_attempts set outcome = 'stale_refused', finished_at = now() where batch_id = p_batch and ordinal = p_ordinal and claim_token = p_claim and outcome is null;
    return jsonb_build_object('ok', false, 'code', 'STALE_CLAIM');
  end if;
  if v_c.status <> 'running' then return jsonb_build_object('ok', false, 'code', 'NOT_RUNNING'); end if;
  if p_reject is not null then
    insert into public.rejected_item_drafts(concept_id, blueprint_cell, draft, verifier_status, defect_codes, reason, generator_model, verifier_model, stage)
      values ((p_reject->>'concept_id')::uuid, p_reject->'blueprint_cell', p_reject->'draft', p_reject->>'verifier_status', coalesce(p_codes, '{}'), left(p_reason, 600),
              p_reject->>'generator_model', p_reject->>'verifier_model', coalesce(p_reject->>'stage', 'verification'));
  end if;
  update public.item_batch_cells set status = case when attempts >= v_b.max_attempts or v_b.status in ('cancelled', 'budget_exhausted') then 'failed' else 'pending' end, lease_until = null,
    failure_reason = left(p_reason, 600), defect_codes = coalesce(p_codes, '{}'), verdict = p_verdict, generate_ms = p_ms, provider_usage = p_usage, updated_at = now()
    where batch_id = p_batch and ordinal = p_ordinal;
  update public.item_batch_attempts set outcome = 'failed', code = p_verdict, finished_at = now(), ms = p_ms, usage = p_usage where batch_id = p_batch and ordinal = p_ordinal and claim_token = p_claim;
  perform public._settle_batch(p_batch);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.extend_batch_cell(p_batch uuid, p_ordinal int, p_claim uuid, p_seconds int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.item_batch_cells c set lease_until = now() + make_interval(secs => least(greatest(p_seconds, 1), 900)), updated_at = now()
    from public.item_batches b where c.batch_id = p_batch and c.ordinal = p_ordinal and c.claim_token = p_claim and c.status = 'running' and b.id = c.batch_id and b.status = 'running';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n = 1, 'code', case when v_n = 1 then null else 'STALE_CLAIM' end);
end $$;

-- Reserve BEFORE dispatching a provider request. Every attempt, SDK retry and verifier call goes through here.
create or replace function public.reserve_batch_budget(p_batch uuid, p_claim uuid, p_requests int, p_tokens int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_b public.item_batches%rowtype; v_max_r int; v_max_t bigint; v_wall int;
begin
  select * into v_b from public.item_batches where id = p_batch for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_b.status not in ('running', 'queued') then return jsonb_build_object('ok', false, 'code', case when v_b.status = 'budget_exhausted' then 'BUDGET' else 'CANCELLED' end); end if;
  if not exists (select 1 from public.item_batch_cells where batch_id = p_batch and claim_token = p_claim and status = 'running') then return jsonb_build_object('ok', false, 'code', 'STALE_CLAIM'); end if;
  v_max_r := coalesce((v_b.budget->>'maxRequests')::int, 0); v_max_t := coalesce((v_b.budget->>'maxTokens')::bigint, 0); v_wall := coalesce((v_b.budget->>'wallSeconds')::int, 0);
  if (v_max_r > 0 and v_b.requests_reserved + p_requests > v_max_r) or (v_max_t > 0 and v_b.tokens_reserved + p_tokens > v_max_t)
     or (v_wall > 0 and v_b.started_at is not null and v_b.started_at + make_interval(secs => v_wall) < now()) then
    perform public._stop_batch_budget(p_batch, 'The batch budget was used up before this request could be sent.');
    return jsonb_build_object('ok', false, 'code', 'BUDGET');
  end if;
  update public.item_batches set requests_reserved = requests_reserved + p_requests, tokens_reserved = tokens_reserved + p_tokens where id = p_batch;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cancel_item_batch(p_batch uuid, p_reason text default 'cancelled by operator') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.item_batches set status = 'cancelled', finished_at = now(), last_error = left(p_reason, 300) where id = p_batch and status in ('queued', 'running');
  get diagnostics v_n = row_count;
  if v_n = 0 then return jsonb_build_object('ok', false, 'code', 'NOT_OPEN'); end if;
  update public.item_batch_cells set status = 'failed', lease_until = null, verdict = 'CANCELLED', defect_codes = array['CANCELLED'], failure_reason = coalesce(failure_reason, 'Batch cancelled before this cell finished.'), updated_at = now()
    where batch_id = p_batch and status in ('pending', 'running');
  update public.item_batch_attempts set outcome = 'cancelled', finished_at = now() where batch_id = p_batch and outcome is null;
  return jsonb_build_object('ok', true);
end $$;

-- 7. Atomic mapping preparation: manifest-scoped, never overwrites, never claims exactness for a title-only stub ----------
create or replace function public.prepare_concept_stubs(p_manifest uuid, p_stubs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_s jsonb; v_made int := 0; v_existing int := 0; v_cid uuid;
begin
  if not exists (select 1 from public.curriculum_manifests where id = p_manifest) then return jsonb_build_object('ok', false, 'code', 'NO_MANIFEST'); end if;
  for v_s in select * from jsonb_array_elements(p_stubs) loop
    -- an outcome already mapped to a concept IN THIS MANIFEST is left exactly as it is
    if exists (select 1 from public.concept_outcome_map m join public.curriculum_concepts c on c.id = m.concept_id where c.manifest_id = p_manifest and m.outcome_id = v_s->>'outcome_id') then v_existing := v_existing + 1; continue; end if;
    v_cid := (v_s->>'concept_id')::uuid;
    insert into public.curriculum_concepts(id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes)
      values (v_cid, p_manifest, v_s->>'topic', v_s->>'reading', v_s->>'module', v_s->>'los', v_s->>'name', 'core', v_s->>'lm_id', 'pending', v_s->>'scope_notes')
      on conflict (id) do nothing;
    insert into public.concept_outcome_map(concept_id, outcome_id, approximate) values (v_cid, v_s->>'outcome_id', true) on conflict (concept_id) do nothing;
    v_made := v_made + 1;
  end loop;
  return jsonb_build_object('ok', true, 'created', v_made, 'existing', v_existing);
end $$;

-- 8. Permissions: service role / reviewers only ----------------------------------------------------------------------
revoke all on function public.create_item_batch(text, text, jsonb, jsonb), public._stop_batch_budget(uuid, text), public.store_batch_cell(uuid, int, uuid, jsonb, jsonb, text, text, text, jsonb, int, jsonb),
  public.fail_batch_cell(uuid, int, uuid, text, text[], text, jsonb, int, jsonb), public.extend_batch_cell(uuid, int, uuid, int), public.reserve_batch_budget(uuid, uuid, int, int),
  public.cancel_item_batch(uuid, text), public.prepare_concept_stubs(uuid, jsonb), public.confirm_item_family(text, int, text) from public, anon, authenticated;
grant execute on function public.create_item_batch(text, text, jsonb, jsonb), public._stop_batch_budget(uuid, text), public.store_batch_cell(uuid, int, uuid, jsonb, jsonb, text, text, text, jsonb, int, jsonb),
  public.fail_batch_cell(uuid, int, uuid, text, text[], text, jsonb, int, jsonb), public.extend_batch_cell(uuid, int, uuid, int), public.reserve_batch_budget(uuid, uuid, int, int),
  public.cancel_item_batch(uuid, text), public.prepare_concept_stubs(uuid, jsonb) to service_role;
grant execute on function public.confirm_item_family(text, int, text) to authenticated;

notify pgrst, 'reload schema';
