-- Gate A Schema Additions

-- 1. Assessment attempts
ALTER TABLE public.assessment_attempts
  ADD COLUMN IF NOT EXISTS evidence_mode text check (evidence_mode in ('evidence', 'practice')),
  ADD COLUMN IF NOT EXISTS scoring_policy_version text,
  ADD COLUMN IF NOT EXISTS evidence_policy_version text,
  ADD COLUMN IF NOT EXISTS valid_response_count integer,
  ADD COLUMN IF NOT EXISTS correct_response_count integer,
  ADD COLUMN IF NOT EXISTS result_revision integer not null default 1,
  ADD COLUMN IF NOT EXISTS rescored_at timestamptz;

-- 2. Assessment responses
ALTER TABLE public.assessment_responses
  ADD UNIQUE NULLS NOT DISTINCT (attempt_id, item_id);

CREATE INDEX IF NOT EXISTS assessment_responses_user_attempt_idx ON public.assessment_responses (user_id, attempt_id);

-- Protect correctness from direct browser mutation. 
-- In Supabase, standard RLS policies govern this. For now we just rely on RPC scoring and 
-- not having an UPDATE policy for authenticated users. If there is one, we would drop it.

-- 3. Evidence events
ALTER TABLE public.evidence_events
  ADD COLUMN IF NOT EXISTS response_id uuid references public.assessment_responses(id),
  ADD COLUMN IF NOT EXISTS assessment_purpose text,
  ADD COLUMN IF NOT EXISTS evidence_mode text,
  ADD COLUMN IF NOT EXISTS item_trust_tier text,
  ADD COLUMN IF NOT EXISTS self_reported_confidence integer,
  ADD COLUMN IF NOT EXISTS scoring_policy_version text,
  ADD COLUMN IF NOT EXISTS validity_reason text,
  ADD COLUMN IF NOT EXISTS superseded_by_event_id uuid references public.evidence_events(id);

ALTER TABLE public.evidence_events
  ADD UNIQUE NULLS NOT DISTINCT (attempt_id, item_id, scoring_policy_version);

CREATE INDEX IF NOT EXISTS evidence_events_user_concept_idx ON public.evidence_events (user_id, concept_id, created_at desc, id);
CREATE INDEX IF NOT EXISTS evidence_events_attempt_item_idx ON public.evidence_events (attempt_id, item_id);
CREATE INDEX IF NOT EXISTS evidence_events_valid_idx ON public.evidence_events (user_id, concept_id) WHERE validity = 'valid';
CREATE INDEX IF NOT EXISTS evidence_events_disputed_idx ON public.evidence_events (user_id, concept_id) WHERE validity = 'disputed';

-- 4. Repair threads
CREATE TABLE IF NOT EXISTS public.repair_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  concept_id uuid not null references public.curriculum_concepts(id),
  manifest_id uuid not null references public.curriculum_manifests(id),
  status text not null check (status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck', 'closed', 'cancelled', 'superseded')),
  severity text,
  occurrence_count integer not null default 1,
  opened_from_attempt_id uuid references public.assessment_attempts(id),
  latest_evidence_event_id uuid references public.evidence_events(id),
  latest_evidence_at timestamptz not null,
  next_recheck_due_at timestamptz,
  policy_version text,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closure_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS repair_threads_active_idx ON public.repair_threads (user_id, concept_id, manifest_id) 
WHERE status NOT IN ('closed', 'cancelled', 'superseded');

-- 5. Repair thread events
CREATE TABLE IF NOT EXISTS public.repair_thread_events (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.repair_threads(id),
  event_type text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 6. Plan blocks
ALTER TABLE public.plan_blocks
  ADD COLUMN IF NOT EXISTS repair_thread_id uuid references public.repair_threads(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS cancellation_source_id text;

-- Execution enum needs to be extended. "Extend execution to include cancelled."
ALTER TABLE public.plan_blocks DROP CONSTRAINT IF EXISTS plan_blocks_execution_check;
ALTER TABLE public.plan_blocks ADD CONSTRAINT plan_blocks_execution_check check (execution in ('not_started', 'in_progress', 'partial', 'completed', 'skipped', 'deferred', 'cancelled'));

-- Extend task_events with cancelled, evidence_disputed, evidence_restored, origin_invalidated.
ALTER TABLE public.task_events DROP CONSTRAINT IF EXISTS task_events_event_type_check;
ALTER TABLE public.task_events ADD CONSTRAINT task_events_event_type_check check (event_type in ('created', 'started', 'completed', 'partial', 'deferred', 'skipped', 'moved', 'split', 'duration_changed', 'details_changed', 'undone', 'cancelled', 'evidence_disputed', 'evidence_restored', 'origin_invalidated'));

-- 7. Persistent proposals (coach_proposals)
ALTER TABLE public.coach_proposals
  ADD COLUMN IF NOT EXISTS origin text check (origin in ('diagnostic', 'coach', 'weekly_review')),
  ADD COLUMN IF NOT EXISTS proposal_version text,
  ADD COLUMN IF NOT EXISTS revision integer not null default 1,
  ADD COLUMN IF NOT EXISTS target_week_start date,
  ADD COLUMN IF NOT EXISTS target_week_end date,
  ADD COLUMN IF NOT EXISTS applied_task_ids uuid[],
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

-- 8. Reviewer authorization
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('diagnostic_reviewer')),
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id),
  primary key (user_id, role)
);

-- RLS Enablement
ALTER TABLE public.repair_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_thread_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "repair_threads_all_own" ON public.repair_threads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "repair_thread_events_all_own" ON public.repair_thread_events FOR SELECT USING (thread_id IN (SELECT id FROM public.repair_threads WHERE user_id = auth.uid()));

-- Only system/RPC can insert events, but we allow read.
-- User roles should be readable by self and admins.
CREATE POLICY "user_roles_read_own" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
