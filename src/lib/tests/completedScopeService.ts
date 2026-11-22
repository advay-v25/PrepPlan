import { createAdminClient } from '../supabase/admin'
import { todayInZone, zonedTimeToUtc } from '../planning/studyWeek'
import { getStudyActivity } from '../curriculum/studyActivityService'
import { readAll } from '../supabase/readAll'
import { buildCompletedScope, type BlockRow, type ClassItemRow, type CompletedCycleScope, type OutcomeRef, type ReadingRef } from './completedScope'
import { perRequest, minuteOf } from '../ops/perRequest'
import { profileTimezone, conceptOutcomeMap } from '../ops/sharedReads'

/** Loads the rows and builds the canonical scope. Read-only, scoped to the user. */
async function getCompletedCycleScopeUncached(userId: string, now = new Date()): Promise<CompletedCycleScope> {
  const admin = createAdminClient()
  const [{ data: cycle }, { data: profile }] = await Promise.all([
    admin.from('planning_cycles').select('id, starts_at, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle().throwOnError(),
    profileTimezone(userId).then(tz => ({ data: tz ? { timezone: tz } : null })),
  ])
  const [{ data: readingRows }, { data: outcomeRows }] = await Promise.all([
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title, page_count, structure_pending').eq('is_active', true).throwOnError(),
    readAll<any>((a, z) => admin.from('reading_los').select('id, reading_id, code, title').order('id').range(a, z)).then(data => ({ data })),
  ])
  const readings = new Map<string, ReadingRef>((readingRows ?? []).map(r => [r.id as string, {
    id: r.id as string, subjectId: r.topic_id as string, readingNo: r.reading_no as number, title: r.title as string,
    pageCount: r.page_count as number, structurePending: Boolean(r.structure_pending),
  }]))
  const outcomes = new Map<string, OutcomeRef>((outcomeRows ?? []).map(o => [o.id as string, {
    id: o.id as string, readingId: o.reading_id as string, subjectId: readings.get(o.reading_id as string)?.subjectId ?? '',
    code: o.code as string, title: o.title as string,
  }]))

  const today = todayInZone((cycle?.timezone as string | null) ?? (profile?.timezone as string | null) ?? 'UTC', now)
  const empty = { cycle: null, today, blocks: [] as BlockRow[], confirmations: new Map<string, string[]>(), classItems: [] as ClassItemRow[], outcomes, readings }

  // History before this cycle decides new vs revision.
  const before = cycle ? (cycle.starts_at ?? zonedTimeToUtc(cycle.starts_at_local, '00:00', cycle.timezone ?? profile?.timezone ?? 'UTC').toISOString()) : null
  // Complete pages in a stable order: a mature history must never be silently cut at the first page.
  const [activity, priorClass, events, mapRows, state] = await Promise.all([
    getStudyActivity(userId),
    readAll<any>((a, z) => admin.from('class_session_items').select('id, outcome_id, extent, class_sessions!inner(user_id, cycle_id, kind)').eq('class_sessions.user_id', userId).order('id').range(a, z)),
    readAll<any>((a, z) => { let q = admin.from('evidence_events').select('id, concept_id').eq('user_id', userId).eq('validity', 'valid').eq('evidence_mode', 'evidence'); if (before) q = q.lt('created_at', before); return q.order('id').range(a, z) }),
    conceptOutcomeMap(),
    readAll<any>((a, z) => admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', userId).in('coverage_state', ['studied', 'verified', 'decaying']).order('lm_id').range(a, z)),
  ])
  // Class provenance follows the task's own lineage (split sittings copy it; a weekly continuation resets class_session_id but keeps continued_from_task_id).
  const lineage = await readAll<{ id: string; class_session_id: string | null; continued_from_task_id: string | null }>((a, z) =>
    admin.from('plan_blocks').select('id, class_session_id, continued_from_task_id').eq('user_id', userId).or('class_session_id.not.is.null,continued_from_task_id.not.is.null').order('id').range(a, z))
  const lineageById = new Map(lineage.map(l => [l.id, l]))
  const classBlockSessions = new Map<string, string>()
  for (const l of lineage) {
    let cur: typeof l | undefined = l; const seen = new Set<string>()
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (cur.class_session_id) { classBlockSessions.set(l.id, cur.class_session_id); break } cur = cur.continued_from_task_id ? lineageById.get(cur.continued_from_task_id) : undefined }
  }
  const priorBlocks = activity.blocks.filter(b => !b.cancelled_at && ['completed', 'partial'].includes(b.execution) && ['study', 'review', 'class_consolidation', 'verification'].includes(b.task_type))
  const activeId = (cycle?.id as string | undefined) ?? null
  const priorGroups = activity.groups
  const priorOutcomes = new Set<string>(), priorReadings = new Set<string>(), priorWhole = new Set<string>()
  for (const b of priorBlocks.filter(b => b.cycle_id !== activeId))
    for (const id of activity.confirmations.get(b.id) ?? []) { priorOutcomes.add(id); priorWhole.add(id) }
  for (const b of priorBlocks ?? []) {
    if (b.cycle_id === activeId) continue
    if (b.execution !== 'completed') continue
    if (b.scope_group_id) {
      const group = priorGroups.get(b.scope_group_id as string)
      // Finishing a split in THIS cycle is new coverage, not a revision just
      // because an earlier sitting was completed in a previous week.
      if (!group?.complete || group.cycles.includes(activeId)) continue
    }
    // A class's own partial consolidation is exposure, not a completed first pass of the outcome.
    if (b.outcome_id && !classBlockSessions.has(b.id as string)) { priorOutcomes.add(b.outcome_id as string); priorWhole.add(b.outcome_id as string) }
    // A reading-level sitting cannot establish prior coverage of every outcome.
    // Its explicitly confirmed outcomes were added above.
  }
  // An earlier "part"/"continued" item is exposure only: it must not make the first whole coverage a revision.
  for (const c of priorClass) if (c.class_sessions?.cycle_id !== activeId && c.extent === 'full' && ['covered', 'revision'].includes(c.class_sessions?.kind)) { priorOutcomes.add(c.outcome_id); priorWhole.add(c.outcome_id) }
  const evidenceConcepts = new Set((events ?? []).map(e => e.concept_id as string))
  for (const m of mapRows ?? []) if (evidenceConcepts.has(m.concept_id as string)) priorOutcomes.add(m.outcome_id as string)
  for (const s of state ?? []) priorReadings.add(s.lm_id as string)

  if (!cycle) return buildCompletedScope({ ...empty, priorOutcomes, priorReadings, priorWhole })

  const blockRows = activity.blocks.filter(b => b.cycle_id === cycle.id)
  const groups = activity.groups
  const blocks: BlockRow[] = (blockRows ?? []).filter(b => !b.cancelled_at && b.execution !== 'cancelled').map(b => ({
    id: b.id as string, title: b.title as string, taskType: (b.task_type ?? 'study') as string, execution: b.execution as string,
    localDate: (b.local_date ?? null) as string | null, outcomeId: (b.outcome_id ?? null) as string | null,
    readingId: readings.has(b.lm_id as string) ? (b.lm_id as string) : null, origin: null,
    revision: b.revision as number, scopePending: Boolean(b.scope_group_id && !groups.get(b.scope_group_id as string)?.complete),
    loggedLearning: Boolean(b.learning_activity_id),
  }))

  const confirmations = activity.confirmations

  // Sessions from EARLIER weeks are read too, only so an unfinished portion stays visible until the whole outcome is confirmed.
  const sessions = await readAll<any>((x, z) => admin.from('class_sessions').select('id, class_date, kind, cycle_id, calendar_commitments(label)').eq('user_id', userId).in('kind', ['covered', 'revision']).order('id').range(x, z))
  const sessionIds = sessions.map(s => s.id as string)
  const items: any[] = []
  for (let i = 0; i < sessionIds.length; i += 100) {
    const batch = sessionIds.slice(i, i + 100)
    items.push(...await readAll<any>((x, z) => admin.from('class_session_items').select('session_id, outcome_id, extent, studied_in_class').in('session_id', batch).order('session_id').order('outcome_id').range(x, z)))
  }
  const sessionById = new Map(sessions.map(s => [s.id as string, s]))
  const classItems: ClassItemRow[] = items.map(i => ({
    sessionId: i.session_id as string, classDate: sessionById.get(i.session_id as string)!.class_date as string,
    classLabel: sessionById.get(i.session_id as string)?.calendar_commitments?.label ?? null,
    kind: sessionById.get(i.session_id as string)!.kind as 'covered' | 'revision', outcomeId: i.outcome_id as string,
    extent: i.extent as 'part' | 'full' | 'continued', studiedInClass: Boolean(i.studied_in_class),
    inCycle: sessionById.get(i.session_id as string)!.cycle_id === cycle.id,
  }))

  return buildCompletedScope({
    classBlockSessions,
    cycle: { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt: cycle.ends_at_local as string },
    today, blocks, confirmations, classItems, outcomes, readings, priorOutcomes, priorReadings, priorWhole,
  })
}

/** Shared within one request (see perRequest): Home, the operating state and the bridge all ask for this. */
export const getCompletedCycleScope = perRequest(getCompletedCycleScopeUncached, (u: string, n?: Date) => `${u}|${minuteOf(n)}`)
