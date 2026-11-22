-- Attributable concept sign-off. A concept's "verified" status is a human decision about an exact scope; it now has ONE writer
-- (decide_concept_signoff) that records who, when, which scope (hash + snapshot), which decision and why, in the same transaction as the status.
-- Additive: nothing existing is edited. Historical evidence is never rewritten: withdrawing or revising a sign-off blocks NEW approvals
-- (item_publish_blockers already requires a verified concept) and is audited; already-approved item versions are retired explicitly by a
-- reviewer through the existing item workflow, and frozen papers / answered evidence are untouched.

create table if not exists public.concept_signoffs (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid not null references public.curriculum_concepts(id),
  manifest_id uuid not null,
  decision text not null check (decision in ('verify', 'withdraw', 'revoked_by_edit')),
  reviewer_id uuid,                                 -- null only for a system revocation after the scope text changed
  scope_hash text not null,
  scope_snapshot jsonb not null,                    -- the exact name / scope / exclusions that were signed off (curriculum text, not source material)
  rationale text not null,
  request_key text,
  approved_items_affected int not null default 0,   -- approved item versions on this concept at the moment of a withdrawal / revocation
  created_at timestamptz not null default now(),
  constraint concept_signoffs_actor check ((decision = 'revoked_by_edit') = (reviewer_id is null))
);
create unique index if not exists concept_signoffs_request_key on public.concept_signoffs (concept_id, request_key) where request_key is not null;
create index if not exists concept_signoffs_concept on public.concept_signoffs (concept_id, created_at desc);
alter table public.concept_signoffs enable row level security;
revoke all on public.concept_signoffs from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select on public.concept_signoffs to service_role; end if; end $$;

-- The exact thing a person signs off. TypeScript computes the same string (conceptScopeHash) so a screen can state what it showed.
create or replace function public.concept_scope_hash(p_name text, p_scope text, p_excluded text, p_manifest uuid) returns text
language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(coalesce(p_name, '') || E'\n' || coalesce(p_scope, '') || E'\n' || coalesce(p_excluded, '') || E'\n' || p_manifest::text, 'UTF8')), 'hex')
$$;

create or replace function public.decide_concept_signoff(p_concept uuid, p_decision text, p_expected_hash text, p_rationale text, p_request_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_c public.curriculum_concepts%rowtype; v_hash text; v_why text := coalesce(btrim(p_rationale), '');
  v_prior public.concept_signoffs%rowtype; v_active boolean; v_affected int := 0;
begin
  if v_uid is null or not public.is_item_reviewer() then return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'message', 'Only a reviewer can sign off a concept.'); end if;
  if p_decision not in ('verify', 'withdraw') then return jsonb_build_object('ok', false, 'code', 'BAD_DECISION', 'message', 'The decision must be verify or withdraw.'); end if;
  if coalesce(btrim(p_expected_hash), '') = '' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST', 'message', 'The scope you were shown is required.'); end if;
  if char_length(v_why) < 8 then return jsonb_build_object('ok', false, 'code', 'RATIONALE_REQUIRED', 'message', 'Say in a sentence why (at least 8 characters).'); end if;
  select * into v_c from public.curriculum_concepts where id = p_concept for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Unknown concept.'); end if;
  select is_active into v_active from public.curriculum_manifests where id = v_c.manifest_id;
  if not coalesce(v_active, false) then return jsonb_build_object('ok', false, 'code', 'MANIFEST_NOT_ACTIVE', 'message', 'Only concepts of the active edition can be signed off.'); end if;
  if p_request_key is not null then
    select * into v_prior from public.concept_signoffs where concept_id = p_concept and request_key = p_request_key;
    if found then
      if v_prior.reviewer_id is distinct from v_uid or v_prior.decision is distinct from p_decision then return jsonb_build_object('ok', false, 'code', 'KEY_CONFLICT', 'message', 'This request key was used for a different decision.'); end if;
      return jsonb_build_object('ok', true, 'replay', true, 'decision', v_prior.decision, 'status', v_c.verification_status, 'signoffId', v_prior.id);
    end if;
  end if;
  v_hash := public.concept_scope_hash(v_c.name, v_c.scope_notes, v_c.excluded_or_superseded, v_c.manifest_id);
  if v_hash <> p_expected_hash then return jsonb_build_object('ok', false, 'code', 'STALE_SCOPE', 'message', 'The scope changed after you opened it. Reload and read it again.'); end if;
  if p_decision = 'verify' then
    if coalesce(btrim(v_c.scope_notes), '') = '' then return jsonb_build_object('ok', false, 'code', 'NO_SCOPE', 'message', 'This concept has no scope written for it yet. There is nothing to sign off.'); end if;
    if v_c.verification_status = 'verified' then return jsonb_build_object('ok', true, 'unchanged', true, 'status', 'verified'); end if;
  else
    if v_c.verification_status <> 'verified' then return jsonb_build_object('ok', true, 'unchanged', true, 'status', v_c.verification_status); end if;
    select count(*) into v_affected from public.assessment_items i where i.concept_id = p_concept and i.review_status = 'reviewed';
  end if;
  perform set_config('app.concept_signoff', 'on', true);
  update public.curriculum_concepts set verification_status = case when p_decision = 'verify' then 'verified' else 'drafted' end where id = p_concept;
  insert into public.concept_signoffs (concept_id, manifest_id, decision, reviewer_id, scope_hash, scope_snapshot, rationale, request_key, approved_items_affected)
  values (p_concept, v_c.manifest_id, p_decision, v_uid, v_hash, jsonb_build_object('name', v_c.name, 'scope', v_c.scope_notes, 'excluded', v_c.excluded_or_superseded), v_why, p_request_key, v_affected);
  return jsonb_build_object('ok', true, 'decision', p_decision, 'status', case when p_decision = 'verify' then 'verified' else 'drafted' end, 'approvedItemsStillLive', v_affected);
end $$;

-- Guard: after this migration a concept becomes (or stays) "verified" only through the command above. Registered fixture rows (topic 'Fixture')
-- may still be inserted verified; a revision of a verified concept's scope text revokes the sign-off and records that, so a person re-reads it.
create or replace function public.guard_concept_signoff() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_flag boolean := coalesce(current_setting('app.concept_signoff', true), '') = 'on'; v_live int;
begin
  if tg_op = 'INSERT' then
    if new.verification_status = 'verified' and not v_flag and new.topic is distinct from 'Fixture' then
      raise exception 'A concept cannot be created already signed off; sign-off is a recorded human decision (decide_concept_signoff).' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.verification_status = 'verified' and old.verification_status is distinct from 'verified' and not v_flag then
    raise exception 'A concept is signed off only through decide_concept_signoff.' using errcode = '42501';
  end if;
  if old.verification_status = 'verified' and new.verification_status = 'verified'
     and (new.name is distinct from old.name or new.scope_notes is distinct from old.scope_notes or new.excluded_or_superseded is distinct from old.excluded_or_superseded or new.manifest_id is distinct from old.manifest_id) then
    new.verification_status := 'drafted';
    select count(*) into v_live from public.assessment_items i where i.concept_id = old.id and i.review_status = 'reviewed';
    insert into public.concept_signoffs (concept_id, manifest_id, decision, reviewer_id, scope_hash, scope_snapshot, rationale, approved_items_affected)
    values (old.id, old.manifest_id, 'revoked_by_edit', null, public.concept_scope_hash(old.name, old.scope_notes, old.excluded_or_superseded, old.manifest_id),
            jsonb_build_object('name', old.name, 'scope', old.scope_notes, 'excluded', old.excluded_or_superseded), 'The scope text was changed after sign-off; it must be read and signed off again.', v_live);
  end if;
  return new;
end $$;
drop trigger if exists guard_concept_signoff on public.curriculum_concepts;
create trigger guard_concept_signoff before insert or update on public.curriculum_concepts for each row execute function public.guard_concept_signoff();

revoke all on function public.decide_concept_signoff(uuid, text, text, text, text), public.concept_scope_hash(text, text, text, uuid), public.guard_concept_signoff() from public, anon;
grant execute on function public.decide_concept_signoff(uuid, text, text, text, text) to authenticated;
grant execute on function public.concept_scope_hash(text, text, text, uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
