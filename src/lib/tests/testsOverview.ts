import { decideAssessment, type AssessmentDecision } from './assessmentDecision'
import { createAdminClient } from '../supabase/admin'
import { getLosTracker } from '../curriculum/losTrackerService'
import { isPersistedPaperScope, getPaperManifestId, countUnseenEligibleByModule } from '../planning/pulse/paper'
import type { PaperPreview } from './paperPreview'

export type WeeklyPaperState = {
  primary:
    | { kind: 'no_scope'; reason: string }
    | { kind: 'confirm_scope'; unresolved: number }
    | { kind: 'start'; deliverable: number; needed: number; blocked: string | null; stale: boolean }
    | { kind: 'resume'; attemptId: string }
    | { kind: 'result'; attemptId: string; closureUrl: string }
  paperLabel: string
  /** The shared assessment decision this card was built from (pending scope, trade-off, next action). */
  decision: AssessmentDecision | null
  /** After a scored paper: a further paper from the confirmed scope it left pending, if there is any and the bank can serve it. */
  further: AssessmentDecision | null
  /** What changed since Calendar planned this paper. */
  planned: { blockTitle: string | null; date: string | null; plannedReadings: string[]; completedReadings: string[]; notCompleted: string[]; addedSincePlanned: string[] } | null
}

export async function getWeeklyPaperState(userId: string, preview: PaperPreview): Promise<WeeklyPaperState> {
  const admin = createAdminClient()
  const cycleId = preview.scope.cycle?.id ?? null
  const label = ({ diagnostic: 'Weekly diagnostic (new material)', revisionary: 'Weekly revisionary paper (revisited material)', mixed: 'Weekly mixed paper (new + revisionary)' } as const)[preview.paperKind]

  // The paper Calendar scheduled, and what it planned to cover.
  let planned: WeeklyPaperState['planned'] = null
  if (cycleId) {
    const { data: blk } = await admin.from('plan_blocks').select('title, local_date, assessment_scope').eq('user_id', userId).eq('cycle_id', cycleId).eq('task_type', 'diagnostic').limit(1).maybeSingle()
    if (blk) {
      const ps = isPersistedPaperScope(blk.assessment_scope) ? blk.assessment_scope : null
      const plannedReadings = ps ? [...new Set(ps.sections.flatMap(s => s.moduleIds))] : []
      const completed = preview.scope.readings.map(r => r.readingId)
      planned = {
        blockTitle: blk.title as string, date: (blk.local_date ?? null) as string | null, plannedReadings, completedReadings: completed,
        notCompleted: plannedReadings.filter(r => !completed.includes(r)), addedSincePlanned: plannedReadings.length ? completed.filter(r => !plannedReadings.includes(r)) : [],
      }
    }
  }

  const { decision } = await decideAssessment(userId, { kind: 'weekly' }, { preview })
  const mk = (primary: WeeklyPaperState['primary'], paperLabel = label, further: AssessmentDecision | null = null): WeeklyPaperState => ({ primary, paperLabel, planned, decision, further })
  if (cycleId) {
    const { data: attempts } = await admin.from('assessment_attempts').select('id, status, paper_kind').eq('user_id', userId).eq('cycle_id', cycleId).eq('attempt_kind', 'weekly').order('started_at', { ascending: false, nullsFirst: true }).throwOnError()
    const scored = (attempts ?? []).find(a => a.status === 'scored')
    const open = (attempts ?? []).find(a => ['ready', 'in_progress'].includes(a.status as string))
    const frozenLabel = (kind: string | null) => kind === 'diagnostic' ? 'Weekly diagnostic (new material)' : kind === 'revisionary' ? 'Weekly revisionary paper (revisited material)' : kind === 'mixed' ? 'Weekly mixed paper (new + revisionary)' : label
    if (open) return mk({ kind: 'resume', attemptId: open.id as string }, frozenLabel(open.paper_kind))
    if (scored) {
      const next = (await decideAssessment(userId, { kind: 'weekly', part: 2 })).decision
      return mk({ kind: 'result', attemptId: scored.id as string, closureUrl: '/app/review-week' }, frozenLabel(scored.paper_kind), next.state === 'start' ? next : null)
    }
  }
  if (decision.state === 'confirm_scope') return mk({ kind: 'confirm_scope', unresolved: decision.pending.unresolvedBlocks })
  if (decision.state === 'no_scope' || decision.state === 'no_cycle') return mk({ kind: 'no_scope', reason: decision.message ?? 'There is no weekly paper yet.' })
  return mk({ kind: 'start', deliverable: decision.deliverable, needed: decision.needed, blocked: decision.state === 'start' ? null : decision.message, stale: decision.state === 'stale' })
}

export type OtherAssessments = {
  readings: { id: string; subjectId: string; name: string; outcomes: number }[]
  subjects: { id: string; name: string; outcomes: number }[]
  repair: { count: number }
}

export async function getOtherAssessments(userId: string, preview: PaperPreview): Promise<OtherAssessments> {
  const admin = createAdminClient()
  const [{ data: readings }, { data: topics }] = await Promise.all([
    admin.from('curriculum_readings').select('id, reading_no, title, topic_id'),
    admin.from('topics').select('id, name'),
  ])
  const rname = new Map((readings ?? []).map(r => [r.id as string, `Reading ${r.reading_no}: ${r.title}`]))
  const tname = new Map((topics ?? []).map(t => [t.id as string, t.name as string]))
  const readingList = preview.scope.readings.map(r => ({ id: r.readingId, subjectId: r.subjectId, name: rname.get(r.readingId) ?? r.readingId, outcomes: r.outcomeIds.length }))
  const subjects = [...new Set(preview.scope.readings.map(r => r.subjectId))].map(id => ({ id, name: tname.get(id) ?? id, outcomes: preview.scope.readings.filter(r => r.subjectId === id).reduce((s, r) => s + r.outcomeIds.length, 0) }))

  const tracker = await getLosTracker(userId)
  const repair = tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows)).filter(r => r.band === 'repair' || r.verdict === 'concept_miss' || r.verdict === 'known_gap').length

  const manifestId = await getPaperManifestId()
  let unseen = 0
  if (manifestId) {
    const all = (readings ?? []).map(r => r.id as string)
    const counts = await countUnseenEligibleByModule(userId, manifestId, all)
    unseen = [...counts.values()].reduce((s, n) => s + n, 0)
  }
  return { readings: readingList, subjects, repair: { count: repair } }
}
