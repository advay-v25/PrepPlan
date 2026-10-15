import { createAdminClient } from '../supabase/admin'
import { todayInZone } from '../planning/studyWeek'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getCompletedCycleScope } from '../tests/completedScopeService'
import { toLevel } from '../curriculum/confidence'
import { computeSignals, type BlockRow, type EvidenceStats, type MovementEvent, type OutcomeState, type Signals } from './signals'

/** Loads the shared inputs and computes the four signals. Read-only, scoped to the user. */
export async function getSignals(userId: string, now = new Date()): Promise<Signals> {
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('timezone').eq('id', userId).maybeSingle()
  const today = todayInZone((profile?.timezone as string | null) ?? 'UTC', now)

  const [tracker, scope, { data: cycle }] = await Promise.all([
    getLosTracker(userId, now),
    getCompletedCycleScope(userId, now),
    admin.from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle(),
  ])
  const cycleId = (cycle?.id as string | undefined) ?? null

  const [{ data: blockRows }, { data: doneBlocks }, { data: classItems }, { data: attempts }, { data: events }, { data: resp }] = await Promise.all([
    cycleId ? admin.from('plan_blocks').select('id, title, execution, task_type, duration_minutes, local_date, outcome_id, cancelled_at, updated_at').eq('user_id', userId).eq('cycle_id', cycleId) : Promise.resolve({ data: [] as any[] }),
    admin.from('plan_blocks').select('outcome_id').eq('user_id', userId).eq('execution', 'completed').not('outcome_id', 'is', null),
    admin.from('class_session_items').select('outcome_id, class_sessions!inner(user_id, kind)').eq('class_sessions.user_id', userId),
    admin.from('assessment_attempts').select('id, status, submitted_at, started_at, evidence_mode').eq('user_id', userId).eq('status', 'scored'),
    admin.from('evidence_events').select('validity, self_reported_confidence, is_correct, created_at, evidence_mode').eq('user_id', userId),
    admin.from('assessment_responses').select('item_id, attempt_id').eq('user_id', userId),
  ])

  const blocks = (blockRows ?? []).filter(b => !b.cancelled_at && b.execution !== 'cancelled')
  const scheduledOutcomes = new Set(blocks.filter(b => b.outcome_id && !['completed', 'skipped'].includes(b.execution as string)).map(b => b.outcome_id as string))
  const exposedOutcomes = new Set<string>([
    ...(doneBlocks ?? []).map(b => b.outcome_id as string),
    ...((classItems ?? []) as any[]).filter(i => ['covered', 'revision'].includes(i.class_sessions?.kind)).map(i => i.outcome_id as string),
    ...scope.targets.map(t => t.outcomeId),
  ])

  const rows = tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows.map(r => ({ ...r, subjectId: t.id }))))
  const outcomes: OutcomeState[] = rows.map(r => ({
    outcomeId: r.outcomeId, readingId: r.readingId, subjectId: r.subjectId,
    exposed: exposedOutcomes.has(r.outcomeId) || r.classCoverage !== 'none', scheduled: scheduledOutcomes.has(r.outcomeId),
    tested: r.band !== 'untested' || r.verdict !== 'none', verified: r.verdict === 'secure',
  }))

  const valid = (events ?? []).filter(e => e.validity === 'valid' && e.evidence_mode === 'evidence')
  const tally = { high: { n: 0, correct: 0 }, low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 } }
  for (const e of valid) { const l = toLevel(e.self_reported_confidence as number | null); if (l) { tally[l].n++; if (e.is_correct) tally[l].correct++ } }
  const evidenceAttempts = new Set((attempts ?? []).filter(a => (a.evidence_mode ?? 'evidence') === 'evidence').map(a => a.id as string))

  const itemIds = [...new Set((resp ?? []).filter(r => evidenceAttempts.has(r.attempt_id as string)).map(r => r.item_id as string))]
  const { data: itemRows } = itemIds.length ? await admin.from('assessment_items').select('id, lm_id').in('id', itemIds) : { data: [] as any[] }
  const readingIds = new Set((itemRows ?? []).map(i => i.lm_id as string))
  const subjectOfReading = new Map(tracker.topics.flatMap(t => t.modules.map(m => [m.id, t.id] as const)))
  const evidence: EvidenceStats = {
    validEvents: valid.length, voidedEvents: (events ?? []).filter(e => ['voided', 'void'].includes(e.validity as string)).length,
    disputedEvents: (events ?? []).filter(e => e.validity === 'disputed').length,
    scoredPapers: evidenceAttempts.size, readingsTested: readingIds.size, subjectsTested: new Set([...readingIds].map(r => subjectOfReading.get(r)).filter(Boolean)).size,
    latestEvidenceAt: valid.length ? valid.map(e => e.created_at as string).sort().at(-1)! : null,
    ...tally,
    overconfidentOutcomes: rows.filter(r => r.markCheck === 'overconfident').length, underconfidentOutcomes: rows.filter(r => r.markCheck === 'underconfident').length,
    markedOutcomes: rows.filter(r => r.selfMark !== null).length,
  }

  // Day-by-day: each event states which signal it is allowed to move.
  const since = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const movement: MovementEvent[] = []
  for (const a of attempts ?? []) if ((a.submitted_at ?? a.started_at) && String(a.submitted_at ?? a.started_at) >= since) movement.push({ date: String(a.submitted_at ?? a.started_at).slice(0, 10), kind: 'paper_scored', text: 'A paper was scored — its valid answers now count as evidence.' })
  for (const e of events ?? []) if (['voided', 'void'].includes(e.validity as string) && String(e.created_at) >= since) movement.push({ date: String(e.created_at).slice(0, 10), kind: 'evidence_voided', text: 'A question was voided — its evidence and anything built on it was reversed.' })
  for (const b of blocks) {
    const d = String(b.updated_at ?? '').slice(0, 10); if (!d || String(b.updated_at) < since) continue
    if (b.execution === 'completed') movement.push({ date: d, kind: 'block_completed', text: `${b.title}: completed — makes it eligible for a test; it does not change your understanding.` })
    else if (b.execution === 'deferred') movement.push({ date: d, kind: 'block_postponed', text: `${b.title}: postponed — carried forward and adds plan pressure; not a wrong answer.` })
    else if (b.execution === 'skipped') movement.push({ date: d, kind: 'block_skipped', text: `${b.title}: skipped — carried forward.` })
  }

  const blockRowsOut: BlockRow[] = blocks.map(b => ({ id: b.id as string, execution: b.execution as string, taskType: (b.task_type ?? 'study') as string, minutes: (b.duration_minutes ?? 0) as number, localDate: (b.local_date ?? null) as string | null, title: b.title as string }))
  return computeSignals({ outcomes, blocks: blockRowsOut, evidence, movement, today })
}
