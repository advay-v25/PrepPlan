import { createAdminClient } from '../supabase/admin'
import { getActiveRoadmap } from './roadmapService'
import { currentPhase, type Phase } from './roadmap'
import { selectRevisionForWeek } from './revisionQueueService'
import { checkCapability, toLine, type CheckCapability, type QueueState, type RevisionLine } from './revisionQueue'
import { loadEligibleItemPool } from '../tests/itemPool'
import { MIN_PAPER_QUESTIONS } from '../tests/limits'
import { getStudyWeekContext } from '../planning/schedule'
import { daysBetween } from '../planning/studyWeek'

/**
 * What Curriculum, Coach and Home may say about revision, from the same selection the planner uses. Read-only.
 * A reading's status is where its obligation lives now, never a verdict: "in your rotation" is not "weak" or "forgotten".
 */
export type ReadingRevisionStatus = 'in_plan' | 'continuing' | 'repair' | 'next' | 'rotation' | 'held'
export type ReadingRevision = { status: ReadingRevisionStatus; label: string; line: RevisionLine }
export type RevisionOverview = {
  weekStart: string; phase: Phase; cap: number; eligible: number
  inPlan: RevisionLine[]; next: RevisionLine[]
  byReading: Record<string, ReadingRevision>
}

const LABEL: Record<ReadingRevisionStatus, string> = {
  in_plan: 'In this week’s plan', continuing: 'Continuing from last week', repair: 'Covered by an open repair',
  next: 'Candidate for recall', rotation: 'In your revision rotation',
  held: 'Waiting for broader revision',
}

export const revisionStatusForEntry = (state: QueueState): ReadingRevisionStatus =>
  state === 'waiting' ? 'held' : state === 'selected' ? 'next' : state

export async function getRevisionOverview(userId: string, now = new Date()): Promise<RevisionOverview | null> {
  const active = await getActiveRoadmap(userId)
  if (!active) return null
  const ctx = await getStudyWeekContext(userId, now)
  const phase = currentPhase(active.roadmap, ctx.week.startDate)?.phase ?? 'first_pass'
  const weekNumber = Math.floor(daysBetween(active.roadmap.startDate, ctx.week.startDate) / 7) + 1
  const { selection, revisionPhase, cap } = await selectRevisionForWeek(userId, active, ctx.week, { phase, weekNumber, today: ctx.today, now })

  const byReading: Record<string, ReadingRevision> = {}
  const put = (e: Parameters<typeof toLine>[0], status: ReadingRevisionStatus) => { byReading[e.readingId] = { status, label: LABEL[status], line: toLine(e) } }
  for (const e of selection.waiting) put(e, 'rotation')
  for (const e of selection.selected) put(e, 'next')
  for (const e of selection.elsewhere) put(e, revisionStatusForEntry(e.state))
  return {
    weekStart: ctx.week.startDate, phase: revisionPhase, cap, eligible: selection.eligible,
    inPlan: selection.elsewhere.filter(e => e.state === 'in_plan').map(toLine),
    next: selection.selected.map(toLine), byReading,
  }
}

/**
 * Can a check be assembled for this reading RIGHT NOW? Uses the assessment service's own candidate rule (`loadEligibleItemPool`: active
 * manifest, concept-outcome binding, review tier, unseen by this student) and its own minimum, never a revision-specific count.
 * Read-only; planning is unaffected either way.
 */
export async function readingCheckCapability(userId: string, readingId: string): Promise<CheckCapability> {
  const [{ count }, pool] = await Promise.all([
    createAdminClient().from('assessment_items').select('id', { count: 'exact', head: true }).eq('lm_id', readingId).throwOnError(),
    loadEligibleItemPool(userId, [readingId], 'weekly_cumulative'),
  ])
  return checkCapability(count ?? 0, pool.length, MIN_PAPER_QUESTIONS)
}
