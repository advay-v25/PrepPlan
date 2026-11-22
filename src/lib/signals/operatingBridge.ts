import { clockWording } from '../tests/clockPolicy'
import { closureFromGate } from '../state/closureWording'
import type { ClosureSummary, AssessmentSummary, OperatingState, PaperForm, PaperReservation, PreparednessState } from '../state/types'
import { createAdminClient } from '../supabase/admin'
import { getPaperPreview } from '../tests/paperPreview'
import { getWeeklyPaperState } from '../tests/testsOverview'
import { getWeeklyReviewState } from '../planning/weeklyReview/service'
import { getSignals } from './signals-loader'
import type { Signals } from './signals'

/**
 * The Tests/Curriculum side of the operating state, packaged so the state layer can adopt it in one
 * step. Today `getCurrentOperatingState` leaves papers, capabilities, preparedness and repair names
 * as stubs; this fills them from the shared contracts (completed scope, weekly paper, signals).
 *
 * The state layer is owned elsewhere, so nothing here edits it. To adopt: call
 *   state = mergeTestsBridge(state, await getTestsBridge(userId))
 * in getCurrentOperatingState BEFORE computeAttentionQueue / selectNextAction.
 */

export type TestsBridge = {
  papers: OperatingState['papers']
  capabilities: OperatingState['capabilities']
  preparedness: PreparednessState | null
  preparednessBand: OperatingState['evidence']['preparednessBand']
  repairNames: Record<string, string>
  insufficientPaperBank: boolean
  signals: Signals
  assessment: Omit<AssessmentSummary, 'dueDate'>
  closure: ClosureSummary | null
}

const PURPOSE_MINUTES = (q: number) => Math.round(q * 1.5)

export async function getTestsBridge(userId: string, now = new Date()): Promise<TestsBridge> {
  const admin = createAdminClient()
  const [preview, signals, review] = await Promise.all([getPaperPreview(userId, undefined, now), getSignals(userId, now), getWeeklyReviewState(userId, now, 'gate')])
  const weekly = await getWeeklyPaperState(userId, preview)
  const p = weekly.primary

  const purpose = preview.paperKind
  // A paper form exists only when one can actually be started. Coverage still to confirm is NOT a sufficient bank: it used to be
  // marked sufficient, so Home offered "your paper is ready" for scope Tests had not yet accepted.
  const form: PaperForm | null = p.kind === 'start'
    ? {
        id: `weekly:${preview.scope.revision}`, revision: 0, availability: !p.blocked ? 'available' : 'locked', destination: '/app/tests', permittedCommands: ['start_paper'],
        purpose, estimatedDurationMinutes: PURPOSE_MINUTES(preview.blueprint.totalQuestions), sufficientBank: !p.blocked,
      }
    : null

  let activeReservation: PaperReservation | null = null
  if (p.kind === 'resume') {
    activeReservation = { id: p.attemptId, revision: 0, availability: 'available', destination: `/app/tests/${p.attemptId}`, permittedCommands: ['resume_paper'], attemptId: p.attemptId, purpose, expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString() }
  }

  const band = signals.understanding.band
  const preparedness: PreparednessState | null = band === 'Insufficient evidence' ? null : {
    band: band === 'Stable' ? 'stable' : band === 'Developing' ? 'developing' : 'building', reasons: signals.understanding.reasons,
    evidenceCoveragePercent: signals.position.total ? Math.round((signals.position.tested / signals.position.total) * 1000) / 10 : 0,
  }

  const { data: threads } = await admin.from('repair_threads').select('id, concept:curriculum_concepts(name)').eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck'])
  const repairNames = Object.fromEntries((threads ?? []).map(t => [t.id as string, ((t.concept as any)?.name ?? 'a concept') as string]))

  const gate = review.status === 'active' ? review.gate.kind : null
  const assessment: Omit<AssessmentSummary, 'dueDate'> =
    p.kind === 'resume' ? { state: 'running', destination: `/app/tests/${p.attemptId}`, attemptId: p.attemptId, unresolvedBlocks: 0, message: null }
    : p.kind === 'result' ? { state: 'scored', destination: `/app/tests/${p.attemptId}/result`, attemptId: p.attemptId, unresolvedBlocks: 0, message: null }
    : p.kind === 'confirm_scope' ? { state: 'confirm_scope', destination: '/app/tests#scope-h', attemptId: null, unresolvedBlocks: p.unresolved, message: `${p.unresolved} finished or partly finished block${p.unresolved === 1 ? '' : 's'} need the outcomes ${p.unresolved === 1 ? 'it' : 'they'} covered.` }
    : p.kind === 'start' && p.blocked ? { state: 'unavailable', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: p.blocked }
    : p.kind === 'start' ? { state: 'ready', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: null }
    : { state: 'none', destination: '/app/tests', attemptId: null, unresolvedBlocks: 0, message: p.reason }

  // What the clock does in a running paper comes from the attempt's own record; a scored result's follow-up has a completion condition.
  if (p.kind === 'resume') {
    const { data: a } = await admin.from('assessment_attempts').select('time_limit_minutes, deadline_at').eq('id', p.attemptId).eq('user_id', userId).maybeSingle()
    assessment.clock = a ? clockWording({ time_limit_minutes: (a.time_limit_minutes ?? null) as number | null, deadline_at: (a.deadline_at ?? null) as string | null }) : null
  }
  if (p.kind === 'result') {
    const [{ data: a }, { count }] = await Promise.all([
      admin.from('assessment_attempts').select('result_viewed_at').eq('id', p.attemptId).eq('user_id', userId).maybeSingle(),
      admin.from('repair_threads').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('opened_from_attempt_id', p.attemptId).in('status', ['open', 'proposed']),
    ])
    const unseen = !a?.result_viewed_at, open = count ?? 0
    assessment.followUp = { pending: unseen || open > 0, reason: open > 0 ? `${open} weak area${open === 1 ? '' : 's'} from this paper still need a decision.` : unseen ? 'You have not opened this result yet.' : null }
  }
  const closure = review.status === 'active' ? closureFromGate(review.gate as any) : null
  return {
    papers: { availablePapers: form ? [form] : [], activeReservation },
    capabilities: {
      canTakeDiagnostic: p.kind === 'start' && !p.blocked && purpose !== 'revisionary',
      canTakeRevisionary: p.kind === 'start' && !p.blocked && purpose !== 'diagnostic',
      // The canonical weekly-review gate, in full: an external mock or a finished rehearsal closes a week just as a scored paper does.
      canCloseWeek: gate === 'paper_scored' || gate === 'no_paper_allowed' || gate === 'external_mock' || gate === 'rehearsal',
    },
    preparedness, preparednessBand: band, repairNames,
    insufficientPaperBank: p.kind === 'start' && Boolean(p.blocked),
    signals, assessment, closure,
  }
}

/** Pure: fills the stubbed parts of an operating state. Never mutates its input. */
export function mergeTestsBridge(state: OperatingState, b: TestsBridge): OperatingState {
  const dueDate = state.cycle?.endDateLocal ?? null
  // Availability and due time are separate: a startable paper is "ready" only on or after its due day, "upcoming" before it.
  const todayLocal = state.today.dateLocal
  const assessment: AssessmentSummary = {
    ...b.assessment, dueDate,
    state: b.assessment.state === 'ready' && dueDate && todayLocal < dueDate ? 'upcoming' : b.assessment.state,
  }
  return {
    ...state,
    papers: b.papers,
    assessment,
    closure: b.closure ?? undefined,
    capabilities: { ...state.capabilities, ...b.capabilities },
    preparedness: b.preparedness,
    evidence: { ...state.evidence, preparednessBand: b.preparednessBand },
    repairs: { ...state.repairs, openThreads: state.repairs.openThreads.map(t => ({ ...t, conceptName: b.repairNames[t.id] ?? t.conceptName })) },
    integrity: { ...state.integrity, insufficientPaperBank: b.insufficientPaperBank },
  }
}
