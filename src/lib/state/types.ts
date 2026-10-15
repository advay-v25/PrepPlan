// Canonical Truth Layer Types (Phase H0)

export type ISO8601Date = string // e.g., '2026-09-18'
export type ISO8601Timestamp = string // e.g., '2026-09-18T10:00:00Z'
export type TimeString = string // e.g., '14:30'

export interface OperatingState {
  schemaVersion: 1
  generatedAt: ISO8601Timestamp
  timezone: string
  dataVersion: number // Global revision or hash for cache busting/staleness
  
  identity: IdentityState
  activation: 'not_onboarded' | 'preview_required' | 'acceptance_required' | 'activation_failed' | 'ready'
  roadmap: RoadmapState | null
  cycle: CycleState | null
  today: TodayState
  execution: ExecutionSummary
  papers: PaperState
  evidence: EvidenceState
  preparedness: PreparednessState | null
  repairs: RepairState
  attention: AttentionItem[]
  nextAction: ActionableDecision | null
  capabilities: CapabilitiesState
  integrity: IntegrityState
}

export interface ActionableEntity {
  id: string
  revision: number
  availability: 'available' | 'locked' | 'stale' | 'unavailable'
  destination: string // Route or client-side drawer identifier
  permittedCommands: string[] // List of command identifiers
}

export interface IdentityState {
  userId: string
  examDate: ISO8601Date | null
  examWindowId: string | null
  classPattern: string | null
  /** null before onboarding's Week step; 'windows' | 'varies' | 'none_this_week' after. */
  weekAvailabilityMode: string | null
  /** Only meaningful when classPattern === 'variable': has an upcoming one-off class been added? */
  hasKnownNextClass: boolean
  /** The chosen sitting's opening date, present only when there is no exact examDate — an indicative target for an unregistered candidate. */
  indicativeExamDate: ISO8601Date | null
  examSitting: { sitting: string; year: number } | null
}

export interface RoadmapState extends ActionableEntity {
  status: 'active' | 'superseded' | 'draft' | 'unknown'
  route: 'coaching' | 'hybrid' | 'self_study' | 'unknown'
  phase: string
  currentMilestoneId: string | null
  nextMilestoneId: string | null
  trajectory: 'holding' | 'ahead' | 'pressure' | 'unknown'
  projectedRange: { start: ISO8601Date, end: ISO8601Date } | null
}

export interface CycleState extends ActionableEntity {
  startDateLocal: ISO8601Date
  endDateLocal: ISO8601Date
  closureState: 'active' | 'closure_ready' | 'closure_failed'
}

export interface TodayState {
  dateLocal: ISO8601Date
  blocks: PlanBlock[]
  protectedCommitments: ProtectedCommitment[]
}

export interface PlanBlock extends ActionableEntity {
  title: string
  detail: string
  taskType: 'study' | 'review' | 'verification' | 'diagnostic' | 'class_consolidation' | 'repair' | 'recheck' | 'mock' | 'admin' | 'other'
  origin: 'planner' | 'roadmap' | 'class' | 'diagnostic' | 'student' | 'coach'
  durationMinutes: number
  placement: 'timed' | 'day_preferred' | 'floating'
  startsAt: ISO8601Timestamp | null
  execution: 'not_started' | 'in_progress' | 'partial' | 'completed' | 'skipped' | 'deferred'
}

export interface ProtectedCommitment extends ActionableEntity {
  label: string
  kind: 'class' | 'work' | 'college' | 'personal' | 'commute' | 'exercise' | 'family' | 'appointment' | 'travel' | 'other'
  startsAt: ISO8601Timestamp | null
  durationMinutes: number
}

export interface ExecutionSummary {
  completedMinutes: number
  partialMinutes: number
  deferredMinutes: number
  skippedMinutes: number
  unreportedMinutes: number
  deviations: string[]
}

export interface PaperState {
  availablePapers: PaperForm[]
  activeReservation: PaperReservation | null
}

export interface PaperForm extends ActionableEntity {
  purpose: 'diagnostic' | 'revisionary' | 'mixed'
  estimatedDurationMinutes: number
  sufficientBank: boolean
}

export interface PaperReservation extends ActionableEntity {
  attemptId: string
  purpose: 'diagnostic' | 'revisionary' | 'mixed'
  expiresAt: ISO8601Timestamp
}

export interface EvidenceState {
  recentChanges: ConceptEvidence[]
  preparednessBand: 'Insufficient evidence' | 'Building' | 'Developing' | 'Stable' | 'Exam-phase ready' | null
}

export interface ConceptEvidence {
  conceptId: string
  name: string
  state: 'supported' | 'unstable' | 'needs_repair' | 'stale'
  sampleSize: number
  confidenceMismatch: boolean
  lastAssessedAt: ISO8601Timestamp
}

export interface RepairState {
  openThreads: RepairThread[]
  proposals: CoachProposal[]
}

export interface RepairThread extends ActionableEntity {
  conceptName: string
  createdAt: ISO8601Timestamp
}

export interface CoachProposal extends ActionableEntity {
  title: string
  summary: string
}

export interface AttentionItem {
  id: string
  code: string // Machine code for the type of attention item
  priority: number
  title: string
  description: string
  destination: string
  actionLabel: string
}

export interface ActionableDecision extends ActionableEntity {
  code: 'recover_activation' | 'resolve_conflict' | 'resume_task' | 'complete_logs' | 'take_paper' | 'review_scored_paper' | 'review_repair' | 'start_timed_task' | 'start_preferred_task' | 'review_draft' | 'place_task' | 'complete_closure' | 'honest_empty'
  title: string
  rationale: string
  scope: string
  timing: string
  expectedDurationMinutes: number | null
}

export interface PreparednessState {
  band: 'building' | 'developing' | 'stable' | 'exam_phase_ready'
  reasons: string[]
  evidenceCoveragePercent: number
}

export interface CapabilitiesState {
  canTakeDiagnostic: boolean
  canTakeRevisionary: boolean
  canCloseWeek: boolean
}

export interface IntegrityState {
  isStale: boolean
  activationFailed: boolean
  insufficientPaperBank: boolean
  crossPageInvariantFailed: boolean
  partialServiceFailure: string[] // List of failed service domains (e.g., 'evidence', 'roadmap')
}
