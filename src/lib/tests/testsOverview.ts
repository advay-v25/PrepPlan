import { createAdminClient } from '../supabase/admin'
import { allowedTiers } from '../diagnostic/blueprint'
import { getLosTracker } from '../curriculum/losTrackerService'
import { isPersistedPaperScope, getPaperManifestId, countUnseenEligibleByModule } from '../planning/pulse/paper'
import { MOCK_MINUTES, MOCK_QUESTIONS } from './limits'
import type { PaperPreview } from './paperPreview'

export type WeeklyPaperState = {
  primary:
    | { kind: 'no_scope'; reason: string }
    | { kind: 'confirm_scope'; unresolved: number }
    | { kind: 'start'; deliverable: number; needed: number; blocked: string | null }
    | { kind: 'resume'; attemptId: string }
    | { kind: 'result'; attemptId: string; closureUrl: string }
  paperLabel: string
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

  if (cycleId) {
    const { data: attempts } = await admin.from('assessment_attempts').select('id, status').eq('user_id', userId).eq('cycle_id', cycleId).eq('attempt_kind', 'weekly').order('started_at', { ascending: false, nullsFirst: true })
    const scored = (attempts ?? []).find(a => a.status === 'scored')
    const open = (attempts ?? []).find(a => ['ready', 'in_progress'].includes(a.status as string))
    if (open) return { primary: { kind: 'resume', attemptId: open.id as string }, paperLabel: label, planned }
    if (scored) return { primary: { kind: 'result', attemptId: scored.id as string, closureUrl: '/app/review-week' }, paperLabel: label, planned }
  }
  if (preview.noPaperReason) return { primary: { kind: 'no_scope', reason: preview.noPaperReason }, paperLabel: label, planned }
  if (preview.scope.unresolved.length > 0) return { primary: { kind: 'confirm_scope', unresolved: preview.scope.unresolved.length }, paperLabel: label, planned }
  const short = new Map(preview.blueprint.bankShortfalls.map(x => [x.readingId, x.available]))
  const deliverable = preview.blueprint.perReading.reduce((n, r) => n + Math.min(r.questions, short.has(r.readingId) ? short.get(r.readingId)! : r.questions), 0)
  const needed = 5
  return { primary: { kind: 'start', deliverable, needed, blocked: deliverable < needed ? `The question bank can serve ${deliverable} unseen approved question${deliverable === 1 ? '' : 's'} for this scope; at least ${needed} are needed. Nothing will be started with fewer.` : null }, paperLabel: label, planned }
}

export type OtherAssessments = {
  readings: { id: string; subjectId: string; name: string; outcomes: number }[]
  subjects: { id: string; name: string; outcomes: number }[]
  repair: { count: number }
  mock: { unseenApproved: number; needed: number; eligible: boolean; questions: number; minutes: number }
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
    const counts = await countUnseenEligibleByModule(userId, manifestId, all, allowedTiers('weekly_cumulative'))
    unseen = [...counts.values()].reduce((s, n) => s + n, 0)
  }
  return { readings: readingList, subjects, repair: { count: repair }, mock: { unseenApproved: unseen, needed: MOCK_QUESTIONS, eligible: unseen >= MOCK_QUESTIONS, questions: MOCK_QUESTIONS, minutes: MOCK_MINUTES } }
}
