import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { getStudyActivity } from './studyActivityService'
import { confirmedActivity, type ActivityDateKind } from './studyActivity'
import { getLosTracker } from './losTrackerService'
import { isFirstPassPending, type ModuleInput, type Phase, type Roadmap, type RoadmapInput } from './roadmap'
import { MAX_REVISION_TASKS, selectRevision, type RevisionReading, type Selection } from './revisionQueue'
import { daysBetween, zonedTimeToUtc } from '../planning/studyWeek'
import type { ClosingAnswers } from '../planning/cycleObservationService'

/**
 * Loads the facts the revision queue ranks, from records the product already keeps. Read-only; owned by `userId`.
 * No second progress store: activity comes from confirmed task scope, evidence from the LOS tracker (which already applies
 * the validity and supersession rules), and selection history from the student's own plan.
 */
export type RevisionFacts = {
  readings: RevisionReading[]
  /** Subject → midpoint of its exam weight. */
  topicWeight: Record<string, number>
}

const LIVE = ['not_started', 'in_progress', 'partial']

function newestKind(outcomeIds: string[], lastAt: Map<string, { at: string; kind: ActivityDateKind }>): ActivityDateKind | null {
  const dated = outcomeIds.map(id => lastAt.get(id)).filter((x): x is { at: string; kind: ActivityDateKind } => Boolean(x))
  return dated.length ? dated.reduce((a, b) => (a.at >= b.at ? a : b)).kind : null
}

export async function loadRevisionFacts(
  userId: string, modules: ModuleInput[], opts: { weekStart: string; weekEnd: string; continuingReadingIds?: string[]; closingAnswers?: ClosingAnswers; now?: Date },
): Promise<RevisionFacts> {
  const admin = createAdminClient()
  const now = opts.now ?? new Date()
  const [activity, outcomes, exposure, topics, tracker] = await Promise.all([
    getStudyActivity(userId),
    readAll<{ id: string; reading_id: string }>((a, z) => admin.from('reading_los').select('id,reading_id').order('id').range(a, z)),
    admin.from('user_topic_exposure').select('topic_id, recency').eq('user_id', userId).throwOnError(),
    admin.from('topics').select('id, name, exam_weight_min, exam_weight_max').throwOnError(),
    getLosTracker(userId, now),
  ])

  const readingOf = new Map(outcomes.map(o => [o.id, o.reading_id]))
  const outcomesOf = new Map<string, string[]>()
  for (const o of outcomes) outcomesOf.set(o.reading_id, [...(outcomesOf.get(o.reading_id) ?? []), o.id])

  // Recorded activity: only work whose scope the student explicitly confirmed, dated by when it was recorded.
  // A missed, deferred or merely scheduled task is not in this list, and a partly done one carries only its confirmed outcomes.
  // The date is the study date when the student logged one, otherwise when completion was recorded; confirming scope later never moves it.
  const lastAt = new Map<string, { at: string; kind: ActivityDateKind }>()
  for (const ob of confirmedActivity(activity.blocks, activity.confirmations, readingOf, activity.pendingGroups, activity.completedAt, activity.completedKind)) {
    if (!ob.at) continue
    if (!lastAt.has(ob.outcomeId) || ob.at > lastAt.get(ob.outcomeId)!.at) lastAt.set(ob.outcomeId, { at: ob.at, kind: ob.atKind ?? 'recorded' })
  }

  const evidenceOf = new Map<string, RevisionReading['evidence']>()
  const openRepairReadings = new Set<string>()
  const evidenceByOutcome = new Map<string, { band: 'repair' | 'verify' | 'maintain' | 'untested'; checkedAt: string | null }>()
  for (const t of tracker.topics) for (const m of t.modules) {
    if (m.rows.some(row => row.hasOpenRepair)) openRepairReadings.add(m.id)
    for (const row of m.rows) evidenceByOutcome.set(row.outcomeId, { band: row.band, checkedAt: row.lastCheckedAt ?? null })
    const ev = { repair: m.counts.repair, verify: m.counts.verify, maintain: m.counts.maintain, untested: m.counts.untested, latestAt: null as string | null }
    for (const row of m.rows) if (row.lastCheckedAt && (!ev.latestAt || row.lastCheckedAt > ev.latestAt)) ev.latestAt = row.lastCheckedAt
    evidenceOf.set(m.id, ev)
  }

  // Selection history from the student's own plan. Revision tasks are 'review' tasks that name a reading (lm_id).
  const history = new Map<string, { lastPlannedAt: string | null; lastDeclinedAt: string | null }>()
  const scheduled = new Set<string>()
  const closingActions = new Map(opts.closingAnswers?.actions.map(action => [action.taskId, action]))
  for (const b of activity.blocks) {
    if (b.task_type !== 'review' || !b.lm_id || b.learning_activity_id || !b.local_date) continue
    // The next plan is prepared before the review is saved. Use the answers for selection history only.
    const answer = b.cycle_id === opts.closingAnswers?.cycleId ? closingActions.get(b.id) : undefined
    const cancelled = Boolean(b.cancelled_at || answer?.cancel)
    const execution = answer?.setExecution ?? b.execution
    const h = history.get(b.lm_id) ?? { lastPlannedAt: null, lastDeclinedAt: null }
    const inWeek = b.local_date >= opts.weekStart && b.local_date <= opts.weekEnd
    if (cancelled || execution === 'skipped') {
      if (!h.lastDeclinedAt || b.local_date > h.lastDeclinedAt) h.lastDeclinedAt = b.local_date
    } else if (inWeek && LIVE.includes(execution)) scheduled.add(b.lm_id)
    if (!cancelled && b.local_date < opts.weekStart && (!h.lastPlannedAt || b.local_date > h.lastPlannedAt)) h.lastPlannedAt = b.local_date
    history.set(b.lm_id, h)
  }

  const workingOn = new Set(((exposure.data ?? []) as { topic_id: string; recency: string }[]).filter(e => e.recency === 'current').map(e => e.topic_id))
  const topicName = new Map(((topics.data ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]))
  const topicWeight = Object.fromEntries(((topics.data ?? []) as { id: string; exam_weight_min: number; exam_weight_max: number }[])
    .map(t => [t.id, (Number(t.exam_weight_min) + Number(t.exam_weight_max)) / 2]))
  const continuing = new Set(opts.continuingReadingIds ?? [])

  const readings: RevisionReading[] = modules.map(m => {
    const ev = evidenceOf.get(m.id) ?? { repair: 0, verify: 0, maintain: 0, untested: 0, latestAt: null }
    return {
      id: m.id, name: m.name, topic: m.topic, topicName: topicName.get(m.topic) ?? m.topic, coverage: m.coverage, uncertainty: m.uncertainty ?? null,
      outcomeActivity: (outcomesOf.get(m.id) ?? []).map(id => lastAt.get(id)?.at ?? null),
      outcomeEvidence: (outcomesOf.get(m.id) ?? []).map(id => evidenceByOutcome.get(id) ?? null),
      newestActivityKind: newestKind(outcomesOf.get(m.id) ?? [], lastAt),
      reportedCurrent: workingOn.has(m.topic),
      evidence: ev, scheduled: scheduled.has(m.id), continuing: continuing.has(m.id), repairOverlap: openRepairReadings.has(m.id),
      history: history.get(m.id) ?? { lastPlannedAt: null, lastDeclinedAt: null },
    }
  })
  return { readings, topicWeight }
}

/**
 * The one place a week's revision selection is assembled, so the planner and every read-only page agree. Read-only.
 * When no first-pass work is left anywhere, "first pass" is only a label: the week plans as consolidation, so a finished
 * first pass leads into real revision rather than a thin or empty week.
 */
export async function selectRevisionForWeek(
  userId: string, active: { roadmap: Roadmap; input: RoadmapInput }, week: { startDate: string; endDate: string; timezone: string },
  o: { phase: Phase; weekNumber: number; today: string; now: Date; continuingReadingIds?: string[]; closingAnswers?: ClosingAnswers },
): Promise<{ selection: Selection; revisionPhase: Phase; cap: number; firstPassLeft: boolean }> {
  const firstPassLeft = active.input.modules.some(isFirstPassPending)
  const revisionPhase: Phase = o.phase === 'first_pass' && !firstPassLeft ? 'consolidation' : o.phase
  const cap = Math.max(0, MAX_REVISION_TASKS[revisionPhase] - new Set(o.continuingReadingIds ?? []).size)
  const focusTopics = o.phase === 'first_pass' ? [] : active.roadmap.milestones.filter(m => m.phase === o.phase && m.startWeek <= o.weekNumber && o.weekNumber <= m.endWeek).map(m => m.topicId)
  const mock = active.roadmap.checkpoints[0]
  const reviewAt = week.startDate > o.today ? zonedTimeToUtc(week.startDate, '00:00', week.timezone) : o.now
  const facts = await loadRevisionFacts(userId, active.input.modules, { weekStart: week.startDate, weekEnd: week.endDate, continuingReadingIds: o.continuingReadingIds, closingAnswers: o.closingAnswers, now: o.now })
  const selection = selectRevision({
    readings: facts.readings, phase: revisionPhase, now: reviewAt, weekStart: week.startDate, limit: cap, topicWeight: facts.topicWeight, focusTopics,
    daysToCheckpoint: mock && mock.date >= week.startDate ? daysBetween(week.startDate, mock.date) : null,
    // First pass is finished (confirmed, or reported on entry) and broader revision has not begun: weakness-only bridge.
    bridge: (o.phase === 'first_pass' || o.phase === 'consolidation') && !firstPassLeft,
    assessmentLed: o.phase === 'final',
  })
  return { selection, revisionPhase, cap, firstPassLeft }
}
