import { createAdminClient } from '../supabase/admin'
import { todayInZone } from '../planning/studyWeek'
import { buildCompletedScope, type BlockRow, type ClassItemRow, type CompletedCycleScope, type OutcomeRef, type ReadingRef } from './completedScope'

/** Loads the rows and builds the canonical scope. Read-only, scoped to the user. */
export async function getCompletedCycleScope(userId: string, now = new Date()): Promise<CompletedCycleScope> {
  const admin = createAdminClient()
  const [{ data: cycle }, { data: profile }] = await Promise.all([
    admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    admin.from('profiles').select('timezone').eq('id', userId).maybeSingle(),
  ])
  const [{ data: readingRows }, { data: outcomeRows }] = await Promise.all([
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title, page_count, structure_pending').eq('is_active', true),
    admin.from('reading_los').select('id, reading_id, code, title'),
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
  const [{ data: priorBlocks }, { data: priorClass }, { data: events }, { data: mapRows }, { data: state }] = await Promise.all([
    admin.from('plan_blocks').select('outcome_id, lm_id, cycle_id, execution, task_type').eq('user_id', userId).eq('execution', 'completed').in('task_type', ['study', 'review', 'class_consolidation', 'verification']),
    admin.from('class_session_items').select('outcome_id, class_sessions!inner(user_id, cycle_id, kind)').eq('class_sessions.user_id', userId),
    admin.from('evidence_events').select('concept_id').eq('user_id', userId).eq('validity', 'valid').eq('evidence_mode', 'evidence'),
    admin.from('concept_outcome_map').select('concept_id, outcome_id'),
    admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', userId).in('coverage_state', ['studied', 'verified', 'decaying']),
  ])
  const activeId = (cycle?.id as string | undefined) ?? null
  const priorOutcomes = new Set<string>(), priorReadings = new Set<string>()
  for (const b of priorBlocks ?? []) {
    if (b.cycle_id === activeId) continue
    if (b.outcome_id) priorOutcomes.add(b.outcome_id as string)
    else if (b.lm_id) priorReadings.add(b.lm_id as string)
  }
  for (const c of (priorClass ?? []) as any[]) if (c.class_sessions?.cycle_id !== activeId && ['covered', 'revision'].includes(c.class_sessions?.kind)) priorOutcomes.add(c.outcome_id)
  const evidenceConcepts = new Set((events ?? []).map(e => e.concept_id as string))
  for (const m of mapRows ?? []) if (evidenceConcepts.has(m.concept_id as string)) priorOutcomes.add(m.outcome_id as string)
  for (const s of state ?? []) priorReadings.add(s.lm_id as string)

  if (!cycle) return buildCompletedScope({ ...empty, priorOutcomes, priorReadings })

  const { data: blockRows } = await admin.from('plan_blocks')
    .select('id, title, task_type, execution, local_date, outcome_id, lm_id, origin, cancelled_at')
    .eq('user_id', userId).eq('cycle_id', cycle.id as string)
  const blocks: BlockRow[] = (blockRows ?? []).filter(b => !b.cancelled_at && b.execution !== 'cancelled').map(b => ({
    id: b.id as string, title: b.title as string, taskType: (b.task_type ?? 'study') as string, execution: b.execution as string,
    localDate: (b.local_date ?? null) as string | null, outcomeId: (b.outcome_id ?? null) as string | null,
    readingId: readings.has(b.lm_id as string) ? (b.lm_id as string) : null, origin: (b.origin ?? null) as string | null,
  }))

  const ids = blocks.map(b => b.id)
  const { data: confRows } = ids.length ? await admin.from('block_scope_confirmations').select('block_id, outcome_id').eq('user_id', userId).in('block_id', ids) : { data: [] as any[] }
  const confirmations = new Map<string, string[]>()
  for (const c of confRows ?? []) confirmations.set(c.block_id as string, [...(confirmations.get(c.block_id as string) ?? []), c.outcome_id as string])

  const { data: sessions } = await admin.from('class_sessions').select('id, class_date, kind').eq('user_id', userId).eq('cycle_id', cycle.id as string).in('kind', ['covered', 'revision'])
  const sessionIds = (sessions ?? []).map(s => s.id as string)
  const { data: items } = sessionIds.length ? await admin.from('class_session_items').select('session_id, outcome_id, extent, studied_in_class').in('session_id', sessionIds) : { data: [] as any[] }
  const sessionById = new Map((sessions ?? []).map(s => [s.id as string, s]))
  const classItems: ClassItemRow[] = (items ?? []).map(i => ({
    sessionId: i.session_id as string, classDate: sessionById.get(i.session_id as string)!.class_date as string,
    kind: sessionById.get(i.session_id as string)!.kind as 'covered' | 'revision', outcomeId: i.outcome_id as string,
    extent: i.extent as 'part' | 'full' | 'continued', studiedInClass: Boolean(i.studied_in_class),
  }))

  return buildCompletedScope({
    cycle: { id: cycle.id as string, startsAt: cycle.starts_at_local as string, endsAt: cycle.ends_at_local as string },
    today, blocks, confirmations, classItems, outcomes, readings, priorOutcomes, priorReadings,
  })
}
