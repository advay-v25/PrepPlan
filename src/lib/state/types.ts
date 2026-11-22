// Canonical Truth Layer Types (Phase H0)
import type { CurrentWeekPlanState } from '../planning/currentWeek/state'

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
  /** Study tasks that still overlap a class or booked time after a saved class change, and the change to review them against. */
  classRecovery?: { overlaps: number; changeKey: string }
  /** Class follow-up that has not received all its tasks yet (durable; survives cycles). */
  classFollowUp?: { minutes: number; items: { title: string; remainingMinutes: number }[] }
  nextAction: ActionableDecision | null
  /** Today's, overdue and unplaced work of the current cycle. Optional so older constructors of a state still type-check. */
  work?: WorkModel
  /** The week's assessment, with availability kept apart from its due day. */
  assessment?: AssessmentSummary
  /** For a cycle with nothing planned: the canonical state of planning it (add study times, review a plan, stale, accepted, empty on purpose, ...). Absent when the week has planned work. */
  weekPlan?: CurrentWeekPlanState
  /** The canonical weekly-review gate with its reason (scored paper, external mock, rehearsal, no paper permitted, or what is still pending). */
  closure?: ClosureSummary
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
  /** Why the planner proposed it. Used to say why a revision task is next. */
  rationale?: string | null
  /** The task's own local day (null = no day yet). Links carry it so a task is found even after midnight. */
  localDate?: ISO8601Date | null
  /** Minutes the student has reported against it so far (sum of recorded events), never an estimate. */
  /** Minutes the student reported against it: null = none given (unknown), never an estimate and never 0 by default. */
  reportedMinutes?: number | null
  /** Some report on it gave no minutes. */
  timeUnknown?: boolean
  /** For a repair or re-check task: the thread it belongs to. */
  repairThreadId?: string | null
  /** Declared order: ids of the sittings that must come first, and this sitting's number within its reading. */
  follows?: string[]
  sittingOrdinal?: number | null
}

/** What a system assessment task (paper or re-check) offers instead of "done": start, resume, result, waiting or unavailable. */
export type AssessmentControl = { kind: 'start' | 'resume' | 'result' | 'waiting' | 'unavailable'; label: string; href: string; note: string | null }

/** Why an open task is where it is in Home's ordering. */
export type WorkStatus = 'in_progress' | 'current' | 'overdue' | 'upcoming' | 'today' | 'unplaced'

export interface WorkModel {
  /** Open work in the order Home recommends it: deterministic, with explicit tie-breakers. */
  open: (PlanBlock & { workStatus: WorkStatus; assessmentControl?: AssessmentControl })[]
  overdue: number
  unplaced: number
  completedToday: PlanBlock[]
  /** Deferred today: set aside, not done. */
  deferredToday: PlanBlock[]
  /** Every deferred task in the cycle (not just today's): each can be given another time. */
  deferred: PlanBlock[]
  remainingPlannedMinutes: number
  /** Open tasks (partly done) whose planned allocation is already used up. */
  plannedUsedButOpen: number
  /** Minutes reported on the student's local day, by when each report was made. Unknown reports are counted, not valued. */
  reportedMinutesToday: number
  reportedTodayUnknown: number
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

export type AssessmentSummary = {
  state: 'none' | 'confirm_scope' | 'upcoming' | 'ready' | 'running' | 'unavailable' | 'scored'
  /** The day the weekly assessment is due (the cycle's last day). */
  dueDate: ISO8601Date | null
  destination: string
  attemptId: string | null
  unresolvedBlocks: number
  /** Human reason when unavailable or waiting. */
  message: string | null
  /** What the clock does in a running assessment, from its own record. */
  clock?: string | null
  /** A scored result: whether its required follow-up is still open (not yet opened, or a repair from it still needs a decision). */
  followUp?: { pending: boolean; reason: string | null }
}

/** Why the week can or cannot be closed, from the canonical weekly-review gate. */
export type ClosureSummary = { gate: 'paper_scored' | 'external_mock' | 'rehearsal' | 'no_paper_allowed' | 'mock_pending' | 'paper_pending' | 'not_ready'; canClose: boolean; label: string; reason: string }

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
  actionLabel?: string
  code: 'recover_activation' | 'resolve_conflict' | 'resume_task' | 'complete_logs' | 'take_paper' | 'review_scored_paper' | 'review_repair' | 'start_timed_task' | 'start_preferred_task' | 'review_draft' | 'place_task' | 'complete_closure' | 'add_availability' | 'confirm_coverage' | 'repair_check' | 'review_current_week' | 'class_followup_owed' | 'honest_empty'
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
