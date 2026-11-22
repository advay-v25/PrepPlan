import { createAdminClient } from '../supabase/admin'
import { todayInZone } from '../planning/studyWeek'
import { getLosTracker } from '../curriculum/losTrackerService'
import { readingCoverageSummary } from '../curriculum/readingCoverage'
import { getCompletedCycleScope } from '../tests/completedScopeService'
import { toLevel } from '../curriculum/confidence'
import { getStudyActivity } from '../curriculum/studyActivityService'
import { confirmedActivity } from '../curriculum/studyActivity'
import { computeSignals, type BlockRow, type EvidenceStats, type MovementEvent, type OutcomeState, type Signals } from './signals'
import { perRequest, minuteOf } from '../ops/perRequest'
import { readAll } from '../supabase/readAll'
import { profileTimezone, activeCycleId } from '../ops/sharedReads'

/** Loads the shared inputs and computes the four signals. Read-only, scoped to the user. */
async function getSignalsUncached(userId: string, now = new Date()): Promise<Signals> {
  const admin = createAdminClient()
  // A failed profile read must not silently become "UTC": every date below depends on it.
  const zone = (await profileTimezone(userId)) ?? 'UTC'
  const today = todayInZone(zone, now)

  const [tracker, scope, { data: cycle }, activity] = await Promise.all([
    getLosTracker(userId, now),
    getCompletedCycleScope(userId, now),
    activeCycleId(userId).then(id => ({ data: id ? { id } : null })),
    getStudyActivity(userId),
  ])
  const cycleId = (cycle?.id as string | undefined) ?? null

  // Every history read is complete (stable unique order, all pages) and a failed page fails the section; it is never "no activity".
  const [blockRows, attempts, events] = await Promise.all([
    cycleId ? readAll<any>((a, z) => admin.from('plan_blocks').select('id, title, execution, task_type, duration_minutes, local_date, outcome_id, cancelled_at, updated_at').eq('user_id', userId).eq('cycle_id', cycleId).is('learning_activity_id', null).order('id').range(a, z)) : Promise.resolve([] as any[]),
    readAll<any>((a, z) => admin.from('assessment_attempts').select('id, status, submitted_at, started_at, evidence_mode').eq('user_id', userId).eq('status', 'scored').order('id').range(a, z)),
    readAll<any>((a, z) => admin.from('evidence_events').select('validity, self_reported_confidence, is_correct, created_at, evidence_mode').eq('user_id', userId).order('created_at').order('id').range(a, z)),
  ])

  const blocks = blockRows.filter(b => !b.cancelled_at && b.execution !== 'cancelled')
  const scheduledOutcomes = new Set(blocks.filter(b => b.outcome_id && !['completed', 'skipped'].includes(b.execution as string)).map(b => b.outcome_id as string))
  const rows = tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows.map(r => ({ ...r, subjectId: t.id }))))
  // WHOLE = explicit whole-outcome coverage the scope engine accepts (a block confirmation or whole-outcome sitting, a class logged "all of it", a confirmed scope target).
  // PARTIAL = a class covered only a part, or coverage is unresolved. One outcome is one fact however many sources describe it (a Set), and whole wins over partial.
  const wholeOutcomes = new Set<string>([
    ...confirmedActivity(activity.blocks, activity.confirmations,
      new Map(rows.map(r => [r.outcomeId, r.readingId] as const)),
      activity.pendingGroups, activity.completedAt).map(w => w.outcomeId),
    ...rows.filter(r => r.classCoverage === 'full').map(r => r.outcomeId),
    ...scope.targets.map(t => t.outcomeId),
  ])
  const partialOutcomes = new Set(rows.filter(r => r.classCoverage === 'part' && !wholeOutcomes.has(r.outcomeId)).map(r => r.outcomeId))
  const outcomes: OutcomeState[] = rows.map(r => ({
    outcomeId: r.outcomeId, readingId: r.readingId, subjectId: r.subjectId,
    exposed: wholeOutcomes.has(r.outcomeId) || partialOutcomes.has(r.outcomeId), whole: wholeOutcomes.has(r.outcomeId), partial: partialOutcomes.has(r.outcomeId),
    scheduled: scheduledOutcomes.has(r.outcomeId),
    tested: r.band !== 'untested' || r.verdict !== 'none', verified: r.verdict === 'secure',
  }))

  const valid = events.filter(e => e.validity === 'valid' && e.evidence_mode === 'evidence')
  const tally = { high: { n: 0, correct: 0 }, low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 } }
  for (const e of valid) { const l = toLevel(e.self_reported_confidence as number | null); if (l) { tally[l].n++; if (e.is_correct) tally[l].correct++ } }
  const evidenceAttempts = new Set(attempts.filter(a => (a.evidence_mode ?? 'evidence') === 'evidence').map(a => a.id as string))

  // Items of this student's evidence papers: attempts and then item ids are read in bounded batches (URL length), each batch paged.
  const attemptIds = [...evidenceAttempts]
  const itemIds = new Set<string>()
  for (let i = 0; i < attemptIds.length; i += 100) {
    const batch = attemptIds.slice(i, i + 100)
    for (const r of await readAll<any>((a, z) => admin.from('assessment_responses').select('item_id').eq('user_id', userId).in('attempt_id', batch).order('id').range(a, z))) itemIds.add(r.item_id as string)
  }
  const readingIds = new Set<string>()
  const itemList = [...itemIds]
  for (let i = 0; i < itemList.length; i += 100) {
    const batch = itemList.slice(i, i + 100)
    for (const r of await readAll<any>((a, z) => admin.from('assessment_items').select('id, lm_id').in('id', batch).order('id').range(a, z))) readingIds.add(r.lm_id as string)
  }
  const subjectOfReading = new Map(tracker.topics.flatMap(t => t.modules.map(m => [m.id, t.id] as const)))
  const evidence: EvidenceStats = {
    validEvents: valid.length, voidedEvents: events.filter(e => ['voided', 'void'].includes(e.validity as string)).length,
    disputedEvents: events.filter(e => e.validity === 'disputed').length,
    scoredPapers: evidenceAttempts.size, readingsTested: readingIds.size, subjectsTested: new Set([...readingIds].map(r => subjectOfReading.get(r)).filter(Boolean)).size,
    latestEvidenceAt: valid.length ? valid.map(e => e.created_at as string).sort().at(-1)! : null,
    latestAttemptId: [...attempts].filter(a => evidenceAttempts.has(a.id as string)).sort((a, b) => String(b.submitted_at ?? b.started_at).localeCompare(String(a.submitted_at ?? a.started_at)))[0]?.id as string | undefined ?? null,
    ...tally,
    overconfidentOutcomes: rows.filter(r => r.markCheck === 'overconfident').length, underconfidentOutcomes: rows.filter(r => r.markCheck === 'underconfident').length,
    markedOutcomes: rows.filter(r => r.selfMark !== null).length,
  }

  // Day-by-day: each event states which signal it is allowed to move.
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const movement: MovementEvent[] = []
  for (const a of attempts) if (evidenceAttempts.has(a.id) && (a.submitted_at ?? a.started_at) && String(a.submitted_at ?? a.started_at) >= since) movement.push({ date: todayInZone(zone, new Date(a.submitted_at ?? a.started_at)), kind: 'paper_scored', text: 'A paper was scored. Its valid answers now count as evidence.' })
  for (const e of events) if (['voided', 'void'].includes(e.validity as string) && String(e.created_at) >= since) movement.push({ date: todayInZone(zone, new Date(e.created_at)), kind: 'evidence_voided', text: 'A question was voided — its evidence and anything built on it was reversed.' })
  for (const b of blocks) {
    const at = activity.executionAt.get(`${b.id}:${b.execution}`)
    if (!at || at < since) continue
    const d = todayInZone(zone, new Date(at))
    if (b.execution === 'completed') movement.push({ date: d, kind: 'block_completed', text: `${b.title}: sitting finished — confirmed outcomes can join a test; understanding is unchanged.` })
    else if (b.execution === 'deferred') movement.push({ date: d, kind: 'block_postponed', text: `${b.title}: postponed — decide what to continue at weekly review; not a wrong answer.` })
    else if (b.execution === 'skipped') movement.push({ date: d, kind: 'block_skipped', text: `${b.title}: skipped — decide what to continue at weekly review.` })
  }

  const blockRowsOut: BlockRow[] = blocks.map(b => ({ id: b.id as string, execution: b.execution as string, taskType: (b.task_type ?? 'study') as string, minutes: (b.duration_minutes ?? 0) as number, localDate: (b.local_date ?? null) as string | null, title: b.title as string }))
  const readings = readingCoverageSummary(tracker.topics.flatMap(t => t.modules))
  return computeSignals({ outcomes, blocks: blockRowsOut, evidence, movement, today, timezone: zone, readings })
}

/** Shared within one request (see perRequest): Home, the operating state and the bridge all ask for this. */
export const getSignals = perRequest(getSignalsUncached, (u: string, n?: Date) => `${u}|${minuteOf(n)}`)
