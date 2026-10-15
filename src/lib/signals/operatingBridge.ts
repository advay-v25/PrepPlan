import type { OperatingState, PaperForm, PaperReservation, PreparednessState } from '../state/types'
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
}

const PURPOSE_MINUTES = (q: number) => Math.round(q * 1.5)

export async function getTestsBridge(userId: string, now = new Date()): Promise<TestsBridge> {
  const admin = createAdminClient()
  const [preview, signals, review] = await Promise.all([getPaperPreview(userId, undefined, now), getSignals(userId, now), getWeeklyReviewState(userId, now)])
  const weekly = await getWeeklyPaperState(userId, preview)
  const p = weekly.primary

  const purpose = preview.paperKind
  const form: PaperForm | null = p.kind === 'start' || p.kind === 'confirm_scope'
    ? {
        id: `weekly:${preview.scope.revision}`, revision: 0, availability: p.kind === 'start' && !p.blocked ? 'available' : 'locked', destination: '/app/tests', permittedCommands: ['start_paper'],
        purpose, estimatedDurationMinutes: PURPOSE_MINUTES(preview.blueprint.totalQuestions), sufficientBank: p.kind === 'start' ? !p.blocked : true,
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
  return {
    papers: { availablePapers: form ? [form] : [], activeReservation },
    capabilities: {
      canTakeDiagnostic: p.kind === 'start' && !p.blocked && purpose !== 'revisionary',
      canTakeRevisionary: p.kind === 'start' && !p.blocked && purpose !== 'diagnostic',
      canCloseWeek: gate === 'paper_scored' || gate === 'no_paper_allowed',
    },
    preparedness, preparednessBand: band, repairNames,
    insufficientPaperBank: p.kind === 'start' && Boolean(p.blocked),
    signals,
  }
}

/** Pure: fills the stubbed parts of an operating state. Never mutates its input. */
export function mergeTestsBridge(state: OperatingState, b: TestsBridge): OperatingState {
  return {
    ...state,
    papers: b.papers,
    capabilities: { ...state.capabilities, ...b.capabilities },
    preparedness: b.preparedness,
    evidence: { ...state.evidence, preparednessBand: b.preparednessBand },
    repairs: { ...state.repairs, openThreads: state.repairs.openThreads.map(t => ({ ...t, conceptName: b.repairNames[t.id] ?? t.conceptName })) },
    integrity: { ...state.integrity, insufficientPaperBank: b.insufficientPaperBank },
  }
}
