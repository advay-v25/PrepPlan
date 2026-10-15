-- Diagnostic Item Pipeline — pilot support
-- Spec: docs/superpowers/specs/2026-09-07-diagnostic-item-pipeline-design.md
--
-- Three things this migration settles:
--   1. Items had no answer key. Scoring inferred it from a "Correct." prefix in
--      per_option_feedback, which only worked for hand-written seed rows.
--   2. There was no representation of the spec's two trust tiers (§5.5), so a
--      verifier-passed item was indistinguishable from an unverified draft.
--   3. Items carried none of the §11.3 gold-record fields, so a verified item
--      could not be re-checked, de-duplicated, or attributed to a generator.

-- 1. The answer key -----------------------------------------------------------
alter table public.assessment_items add column if not exists key_index smallint;

-- Backfill from the legacy "Correct." convention before it stops being read.
update public.assessment_items ai
set key_index = sub.idx
from (
  select id, (kv.key)::smallint as idx
  from public.assessment_items,
       lateral jsonb_each_text(per_option_feedback) as kv
  where kv.value like 'Correct.%'
) sub
where ai.id = sub.id and ai.key_index is null;

-- 2. Trust tiers (§5.5) -------------------------------------------------------
--   draft      generated, not yet through the verifier
--   verified   verifier PASS, no human sign-off — routine testing only
--   reviewed   human-signed gold — required for readiness-moving assessments
--   deprecated voided
alter table public.assessment_items drop constraint if exists assessment_items_review_status_check;
alter table public.assessment_items add constraint assessment_items_review_status_check
  check (review_status in ('draft', 'verified', 'reviewed', 'deprecated'));

-- 3. Gold item record (§11.3) -------------------------------------------------
alter table public.assessment_items add column if not exists item_card jsonb not null default '{}'::jsonb;
alter table public.assessment_items add column if not exists semantic_fingerprint text;
alter table public.assessment_items add column if not exists generator_model text;
alter table public.assessment_items add column if not exists verifier_model text;
alter table public.assessment_items add column if not exists verified_at timestamptz;
alter table public.assessment_items add column if not exists reviewed_at timestamptz;

create index if not exists assessment_items_fingerprint_idx
  on public.assessment_items (semantic_fingerprint);
create index if not exists assessment_items_concept_status_idx
  on public.assessment_items (concept_id, review_status);

-- 4. Validation runs ----------------------------------------------------------
-- The verifier is a numerical gate plus an editorial gate; neither role existed.
alter table public.item_validations drop constraint if exists item_validations_reviewer_role_check;
alter table public.item_validations add constraint item_validations_reviewer_role_check
  check (reviewer_role in (
    'planner', 'writer', 'scope_verifier', 'solver', 'language_reviewer',
    'originality_reviewer', 'numerical_verifier', 'editorial_verifier', 'human_reviewer'
  ));
alter table public.item_validations add column if not exists detail jsonb not null default '{}'::jsonb;

-- 5. Rejected drafts ----------------------------------------------------------
-- §11.2 requires a defect-labelled corpus. Rejected drafts never become items,
-- so they need their own store rather than a review_status value.
create table if not exists public.rejected_item_drafts (
  id uuid primary key default gen_random_uuid(),
  concept_id uuid references public.curriculum_concepts(id) on delete set null,
  blueprint_cell jsonb not null default '{}'::jsonb,
  draft jsonb not null,
  verifier_status text not null,
  defect_codes text[] not null default '{}',
  reason text,
  generator_model text,
  verifier_model text,
  created_at timestamptz not null default now()
);
alter table public.rejected_item_drafts enable row level security;
-- No policy: service-role only. Rejected drafts are never learner-visible.

-- 6. Item challenges feed the repair loop ------------------------------------
alter table public.item_challenges add column if not exists reason_code text;

-- 7. PostgREST needs to see the new columns
notify pgrst, 'reload schema';
