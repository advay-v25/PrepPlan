import { createAdminClient } from '../supabase/admin'
import { getPaperManifestId } from '../planning/pulse/paper'
import { loadEligibleItemPool } from './itemPool'
import { pickDistinct } from './assembly'
import { MAX_ASSESSMENT_QUESTIONS, MIN_PAPER_QUESTIONS, estimatedMinutes } from './limits'
import { recheckEligibility, repairCheckAvailableDate } from '../repairs/recheckDate'

export { repairCheckAvailableDate }

const PER_CONCEPT = 3
export const questionsPerRepairConcept = (concepts: number) => Math.max(PER_CONCEPT, Math.ceil(MIN_PAPER_QUESTIONS / Math.max(1, concepts)))
export type CheckPlan =
  | { state: 'resume'; attemptId: string }
  | { state: 'unavailable' | 'nothing_to_check' | 'no_manifest'; message: string }
  | { state: 'waiting'; message: string; waitingOn: { threadId: string; conceptName: string }[] }
  | { state: 'bank_insufficient'; message: string; deliverable: number; needed: number; perConcept: { conceptName: string; wanted: number; delivered: number }[] }
  | { state: 'startable'; itemIds: string[]; deliverable: number; needed: number; minutes: number; threadIds: string[]; perConcept: { conceptName: string; wanted: number; delivered: number }[] }

/**
 * Read-only. The scope of a re-check is the repairs LINKED to its Calendar task, nothing else: not the account's weaknesses, not another
 * concept in the same reading. Preflight and start both call this, so buttons and start cannot disagree.
 */
export async function planRepairCheck(userId: string, checkTaskId: string, now: Date = new Date()): Promise<CheckPlan> {
  const admin = createAdminClient()
  const { data: task } = await admin.from('plan_blocks').select('id, task_type, attempt_id, execution, cancelled_at, local_date').eq('id', checkTaskId).eq('user_id', userId).maybeSingle().throwOnError()
  if (!task || task.task_type !== 'recheck' || task.cancelled_at || ['completed', 'skipped', 'cancelled'].includes(task.execution as string)) return { state: 'unavailable', message: 'That check is no longer available.' }
  if (task.attempt_id) {
    const { data: a } = await admin.from('assessment_attempts').select('id, status').eq('id', task.attempt_id as string).eq('user_id', userId).in('status', ['ready', 'in_progress']).maybeSingle()
    if (a) return { state: 'resume', attemptId: a.id as string }          // resumed even when its own questions are no longer "unseen"
  }
  const { data: links } = await admin.from('repair_check_threads').select('thread:repair_threads(id, concept_id, status, next_recheck_due_at, concept:curriculum_concepts(name))').eq('check_task_id', checkTaskId).eq('user_id', userId).throwOnError()
  const threads = (links ?? []).map(l => l.thread as any).filter(t => t && !['closed', 'cancelled', 'superseded'].includes(t.status))
  if (!threads.length) return { state: 'nothing_to_check', message: 'The repairs this check was for are no longer open.' }
  const waiting = threads.filter(t => t.status !== 'awaiting_recheck')
  if (waiting.length) return { state: 'waiting', message: 'Finish the repair work first. The check covers only repairs you have completed.', waitingOn: waiting.map(t => ({ threadId: t.id, conceptName: t.concept?.name ?? 'a concept' })) }
  const { data: profile } = await admin.from('profiles').select('timezone').eq('id', userId).single().throwOnError()
  const { data: repairs } = await admin.from('plan_blocks').select('id').eq('user_id', userId).in('repair_thread_id', threads.map(t => t.id))
    .eq('task_type', 'repair').eq('execution', 'completed').is('cancelled_at', null).throwOnError()
  const { data: finished } = repairs?.length ? await admin.from('task_events').select('created_at').eq('user_id', userId).in('task_id', repairs.map(r => r.id))
    .eq('event_type', 'completed').order('created_at', { ascending: false }).limit(1).maybeSingle().throwOnError() : { data: null }
  if (!finished) return { state: 'waiting', message: 'The repair completion time could not be verified. Review its history in Calendar before starting this check.', waitingOn: [] }
  const timezone = profile.timezone ?? 'UTC'
  const { availableDate, eligible } = recheckEligibility({ planned: task.local_date, storedDue: threads.map(t => t.next_recheck_due_at), completedAt: finished.created_at, timezone, now })
  if (!eligible) {
    return { state: 'waiting', message: `This check can start from ${availableDate}, after the repair spacing. Moving it earlier does not skip that spacing.`, waitingOn: [] }
  }

  const manifest = await getPaperManifestId()
  if (!manifest) return { state: 'no_manifest', message: 'No question bank is active yet.' }
  const conceptIds = threads.map(t => t.concept_id as string)
  const { data: maps } = await admin.from('concept_outcome_map').select('outcome_id').in('concept_id', conceptIds)
  const { data: los } = (maps ?? []).length ? await admin.from('reading_los').select('reading_id').in('id', (maps ?? []).map(m => m.outcome_id as string)) : { data: [] as { reading_id: string }[] }
  const pool = (await loadEligibleItemPool(userId, [...new Set((los ?? []).map(l => l.reading_id as string))], 'repair_recheck')).filter(i => conceptIds.includes(i.concept_id as string) && i.family_id)   // an unknown family cannot establish independent evidence on a re-check

  const used = { d: new Map<string, number>(), c: new Map<string, number>(), f: new Map<string, number>(), k: new Map<string, number>() }
  const itemIds: string[] = [], perConcept: { conceptName: string; wanted: number; delivered: number }[] = []
  const target = questionsPerRepairConcept(threads.length)
  const famTaken = new Set<string>()
  for (const t of threads) {
    const got = pickDistinct(pool.filter(i => i.concept_id === t.concept_id && !(i.family_id && famTaken.has(i.family_id))), target, used, Math.random)
    for (const g of got) if (g.family_id) famTaken.add(g.family_id)
    itemIds.push(...got.map(g => g.id)); perConcept.push({ conceptName: t.concept?.name ?? 'a concept', wanted: target, delivered: got.length })
  }
  const deliverable = Math.min(itemIds.length, MAX_ASSESSMENT_QUESTIONS)
  if (deliverable < MIN_PAPER_QUESTIONS) {
    return { state: 'bank_insufficient', deliverable, needed: MIN_PAPER_QUESTIONS, perConcept,
      message: `The bank can serve ${deliverable} unseen reviewed question${deliverable === 1 ? '' : 's'} on these concepts; at least ${MIN_PAPER_QUESTIONS} are needed. Nothing was started, and nothing from another concept is used to fill the gap.` }
  }
  return { state: 'startable', itemIds: itemIds.slice(0, MAX_ASSESSMENT_QUESTIONS), deliverable, needed: MIN_PAPER_QUESTIONS, minutes: estimatedMinutes(deliverable), threadIds: threads.map(t => t.id as string), perConcept }
}

export type CheckStart =
  | { ok: true; attemptId: string; resumed: boolean; questions: number }
  | { ok: false; code: 'unavailable' | 'waiting' | 'bank_insufficient' | 'bank_changed' | 'failed'; message: string; plan?: CheckPlan }

export async function startRepairCheck(userId: string, checkTaskId: string, now: Date = new Date()): Promise<CheckStart> {
  const plan = await planRepairCheck(userId, checkTaskId, now)
  if (plan.state === 'resume') return { ok: true, attemptId: plan.attemptId, resumed: true, questions: 0 }
  if (plan.state === 'waiting') return { ok: false, code: 'waiting', message: plan.message, plan }
  if (plan.state === 'bank_insufficient') return { ok: false, code: 'bank_insufficient', message: plan.message, plan }
  if (plan.state !== 'startable') return { ok: false, code: 'unavailable', message: plan.message }
  const admin = createAdminClient()
  const manifest = await getPaperManifestId()
  const { data, error } = await admin.rpc('start_repair_check', {
    p_user: userId, p_check_task_id: checkTaskId, p_item_ids: plan.itemIds, p_manifest: manifest,
    p_blueprint: { kind: 'repair', label: 'repair_check', threadIds: plan.threadIds }, p_constraints: { maxQuestions: plan.deliverable, allowedTiers: ['reviewed'], ceiling: MAX_ASSESSMENT_QUESTIONS },
    p_requested: { kind: 'repair', label: 'repair_check', threadIds: plan.threadIds, key: `check:${checkTaskId}` }, p_coverage: { delivered: plan.deliverable, perConcept: plan.perConcept },
    p_scope: { kind: 'repair_check', checkTaskId, threadIds: plan.threadIds, policy: 'repair-loop-1' }, p_min_questions: MIN_PAPER_QUESTIONS,
  })
  if (error) { console.error('[repair check start]', error.message); return { ok: false, code: 'failed', message: 'Could not start the check. Nothing was started.' } }
  const r = data as any
  if (r?.ok) return { ok: true, attemptId: r.attemptId, resumed: Boolean(r.resumed), questions: r.questions }
  if (r?.code === 'WAITING_ON_REPAIRS') return { ok: false, code: 'waiting', message: r.message ?? 'Finish the repair work first.' }
  if (r?.code === 'RECHECK_NOT_DUE') return { ok: false, code: 'waiting', message: `This check can start from ${r.earliestDate}, after the repair spacing. Review its updated date in Calendar; nothing was started.` }
  if (r?.code === 'BANK_CHANGED' || r?.code === 'BANK_INSUFFICIENT') return { ok: false, code: 'bank_changed', message: 'The available questions changed while starting. Nothing was started; try again.' }
  return { ok: false, code: 'unavailable', message: 'That check is no longer available.' }
}
