import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin'
import { addDays, todayInZone, type StudyWeek } from '../planning/studyWeek'
import { loadPlacementContext } from '../planning/pulse/generateWeek'
import { planRepairFollowUp, REPAIR_POLICY_VERSION, type PlanThread, type PlanResult } from './plan'

const ACTIVE = ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck']
const PROPOSABLE = ['open', 'proposed']

export type ThreadView = {
  threadId: string; conceptName: string; status: string; severity: string | null; occurrence: number
  latestCheckState: string | null; nextCheckDue: string | null
  tasks: { id: string; title: string; date: string | null; execution: string; type: string }[]
}
export type RepairState =
  | { ok: false; code: 'not_found' | 'not_scored' | 'failed'; message: string }
  | { ok: true; attemptId: string; items: ThreadView[]; proposable: number; pending: { proposalId: string; expiresAt: string } | null }

/** Read-only. Opening a result never creates a proposal, a thread, a task or a cycle. */
/** `also`: the other session attempts of the same rehearsal, so one follow-up covers both. Evidence is still read only for THIS student. */
export async function getRepairState(userId: string, attemptId: string, also: string[] = []): Promise<RepairState> {
  const admin = createAdminClient()
  const { data: attempt, error } = await admin.from('assessment_attempts').select('id, status').eq('id', attemptId).eq('user_id', userId).maybeSingle()
  if (error) return { ok: false, code: 'failed', message: 'Your follow-up could not be loaded. Try again.' }
  if (!attempt) return { ok: false, code: 'not_found', message: 'That result could not be found.' }
  if (attempt.status !== 'scored') return { ok: false, code: 'not_scored', message: 'This paper has not been scored yet.' }

  const { data: evidence, error: eErr } = await admin.from('evidence_events').select('concept_id')
    .in('attempt_id', [attemptId, ...also]).eq('user_id', userId).eq('validity', 'valid').in('evidence_state', ['needs_repair', 'unstable'])
  if (eErr) return { ok: false, code: 'failed', message: 'Your follow-up could not be loaded. Try again.' }
  const conceptIds = [...new Set((evidence ?? []).map(e => e.concept_id as string).filter(Boolean))]
  if (!conceptIds.length) return { ok: true, attemptId, items: [], proposable: 0, pending: null }

  const { data: threads, error: tErr } = await admin.from('repair_threads')
    .select('id, status, severity, occurrence_count, latest_check_state, next_recheck_due_at, concept_id, concept:curriculum_concepts(name)')
    .eq('user_id', userId).in('concept_id', conceptIds).in('status', ACTIVE)
  if (tErr) return { ok: false, code: 'failed', message: 'Your follow-up could not be loaded. Try again.' }
  const ids = (threads ?? []).map(t => t.id as string)
  const { data: tasks } = ids.length
    ? await admin.from('plan_blocks').select('id, title, local_date, execution, task_type, repair_thread_id').eq('user_id', userId).in('repair_thread_id', ids).is('cancelled_at', null).order('local_date')
    : { data: [] as any[] }
  const { data: links } = ids.length ? await admin.from('repair_check_threads').select('check_task_id, thread_id').in('thread_id', ids) : { data: [] as any[] }
  const checkIds = [...new Set((links ?? []).map(l => l.check_task_id as string))]
  const { data: checks } = checkIds.length ? await admin.from('plan_blocks').select('id, title, local_date, execution, task_type').in('id', checkIds).is('cancelled_at', null) : { data: [] as any[] }

  const items: ThreadView[] = (threads ?? []).map(t => ({
    threadId: t.id as string, conceptName: ((t.concept as any)?.name ?? 'This concept') as string, status: t.status as string, severity: (t.severity ?? null) as string | null,
    occurrence: t.occurrence_count as number, latestCheckState: (t.latest_check_state ?? null) as string | null, nextCheckDue: (t.next_recheck_due_at ?? null) as string | null,
    tasks: [
      ...(tasks ?? []).filter(b => b.repair_thread_id === t.id).map(b => ({ id: b.id as string, title: b.title as string, date: (b.local_date ?? null) as string | null, execution: b.execution as string, type: 'repair' })),
      ...(checks ?? []).filter(c => (links ?? []).some(l => l.check_task_id === c.id && l.thread_id === t.id)).map(c => ({ id: c.id as string, title: c.title as string, date: (c.local_date ?? null) as string | null, execution: c.execution as string, type: 'recheck' })),
    ],
  }))
  const { data: pending } = await admin.from('coach_proposals').select('id, expires_at').eq('user_id', userId).eq('intent', 'diagnostic_repair').eq('status', 'pending')
    .contains('proposed_changes', { attemptId }).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  return { ok: true, attemptId, items, proposable: items.filter(i => PROPOSABLE.includes(i.status)).length, pending: pending ? { proposalId: pending.id as string, expiresAt: pending.expires_at as string } : null }
}

export type PreviewInput = { attemptId: string; overrides?: Record<string, string>; keepForLater?: string[]; alsoAttemptIds?: string[]; /** A debrief is a small set: at most this many repairs are planned now, the rest are kept for later. */ limit?: number }
export type PreviewResult =
  | { ok: false; code: 'not_found' | 'not_scored' | 'nothing_to_plan' | 'no_open_week' | 'changed' | 'failed'; message: string; reviewUrl?: string }
  | { ok: true; proposalId: string; expiresAt: string; cycle: { start: string; end: string }; plan: PlanResult; threads: { id: string; conceptName: string; occurrence: number }[]; today: string }

const version = async (userId: string, cycleId: string, threadIds: string[], attemptId: string) => {
  const { data, error } = await createAdminClient().rpc('repair_source_version', { p_user: userId, p_cycle: cycleId, p_thread_ids: threadIds, p_attempt: attemptId })
  return error || typeof data !== 'string' ? null : data
}

/** Builds and SAVES a proposal; touches no task. The browser later accepts it by id, never by task rows. */
export async function previewRepairFollowUp(userId: string, input: PreviewInput): Promise<PreviewResult> {
  const admin = createAdminClient()
  const state = await getRepairState(userId, input.attemptId, input.alsoAttemptIds ?? [])
  if (!state.ok) return { ok: false, code: state.code === 'not_found' ? 'not_found' : state.code === 'not_scored' ? 'not_scored' : 'failed', message: state.message }
  let open = state.items.filter(i => PROPOSABLE.includes(i.status))
  let capped: string[] = []
  if (input.limit && open.length > input.limit) {
    const rank = (i: typeof open[number]) => (i.severity === 'needs_repair' ? 0 : 1) * 100 - i.occurrence
    const sorted = [...open].sort((a, b) => rank(a) - rank(b))
    open = sorted.slice(0, input.limit); capped = sorted.slice(input.limit).map(i => i.threadId)
  }
  if (!open.length) return { ok: false, code: 'nothing_to_plan', message: 'There is no new follow-up to add. Any existing repair or re-check is shown on the result.' }

  const { data: cycle } = await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone, revision').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (!cycle?.starts_at_local || !cycle.ends_at_local) return { ok: false, code: 'no_open_week', message: 'There is no open week to place this in. Review your week first.', reviewUrl: '/app/review-week' }
  const tz = (cycle.timezone as string | null) ?? 'UTC'
  const today = todayInZone(tz)
  const start = cycle.starts_at_local as string, end = cycle.ends_at_local as string
  const days: string[] = []; for (let d = start; d <= end && days.length < 14; d = addDays(d, 1)) days.push(d)
  if (today > end) return { ok: false, code: 'no_open_week', message: 'Your open week has ended. Review it to open the next one; this follow-up will be offered there.', reviewUrl: '/app/review-week' }

  const threadIds = open.map(o => o.threadId)
  const before = await version(userId, cycle.id as string, threadIds, input.attemptId)
  if (!before) return { ok: false, code: 'failed', message: 'Could not prepare the follow-up. Nothing was changed.' }

  const { data: rows } = await admin.from('repair_threads').select('id, concept_id, severity, occurrence_count, concept:curriculum_concepts(name, scope_notes)').in('id', threadIds)
  const { data: att } = await admin.from('assessment_attempts').select('completed_at, started_at').eq('id', input.attemptId).maybeSingle()
  const takenOn = todayInZone(tz, new Date((att?.completed_at ?? att?.started_at ?? new Date().toISOString()) as string))
  const threads: PlanThread[] = (rows ?? []).map(r => ({ id: r.id as string, conceptId: r.concept_id as string, conceptName: ((r.concept as any)?.name ?? 'this concept') as string,
    severity: (r.severity ?? null) as string | null, occurrence: r.occurrence_count as number, scopeNotes: ((r.concept as any)?.scope_notes ?? null) as string | null, takenOn }))

  const week = { startDate: start, endDate: end, days, timezone: tz, anchorDay: 0, classLed: false } as StudyWeek
  const ctx = await loadPlacementContext(userId, week)
  const { data: planned } = await admin.from('plan_blocks').select('local_date, duration_minutes, execution').eq('user_id', userId).eq('cycle_id', cycle.id as string).is('cancelled_at', null).not('local_date', 'is', null)
  const used: Record<string, number> = {}
  for (const b of planned ?? []) if (b.execution !== 'skipped') used[b.local_date as string] = (used[b.local_date as string] ?? 0) + Number(b.duration_minutes ?? 0)
  const capacity = Object.fromEntries(days.map(d => [d, Math.max(0, (ctx.capacity[d] ?? 0) - (used[d] ?? 0))]))

  const plan = planRepairFollowUp({ attemptId: input.attemptId, today, cycle: { start, end }, weekDates: days, studyDates: ctx.studyDates, capacity,
    maxSittingMinutes: ctx.maxSittingMinutes, threads, overrides: input.overrides, keepForLater: [...(input.keepForLater ?? []), ...capped], newId: () => `task-${randomUUID()}` })

  if ((await version(userId, cycle.id as string, threadIds, input.attemptId)) !== before) return { ok: false, code: 'changed', message: 'Your week changed while this was being prepared. Nothing was saved; try again.' }

  const changes = { version: 1, policyVersion: REPAIR_POLICY_VERSION, attemptId: input.attemptId, threadIds: plan.threadIds,
    tasks: plan.tasks, check: plan.check, waitingChecks: plan.waitingChecks, unplaced: plan.unplaced, choices: { overrides: input.overrides ?? {}, keepForLater: input.keepForLater ?? [] } }
  await admin.from('coach_proposals').update({ status: 'stale' }).eq('user_id', userId).eq('intent', 'diagnostic_repair').eq('status', 'pending').contains('proposed_changes', { attemptId: input.attemptId })
  const { data: saved, error } = await admin.from('coach_proposals').insert({
    user_id: userId, intent: 'diagnostic_repair', origin: 'diagnostic', target_cycle_id: cycle.id, status: 'pending', proposal_version: REPAIR_POLICY_VERSION,
    reasoning: 'Follow-up from a scored diagnostic', proposed_changes: changes, source_version: before, expires_at: new Date(Date.now() + 2 * 3600_000).toISOString(),
  }).select('id, expires_at').single()
  if (error || !saved) { console.error('[repair preview] save', error?.message); return { ok: false, code: 'failed', message: 'Could not save the follow-up. Nothing was changed.' } }
  return { ok: true, proposalId: saved.id as string, expiresAt: saved.expires_at as string, cycle: { start, end }, plan, today,
    threads: threads.map(t => ({ id: t.id, conceptName: t.conceptName, occurrence: t.occurrence })) }
}

export type AcceptResult =
  | { ok: true; replayed: boolean; taskIds: string[]; checkTaskId: string | null; waitingChecks: { threadIds: string[]; earliestDate: string }[] }
  | { ok: false; code: 'stale' | 'unavailable' | 'cycle_changed' | 'already_accepted' | 'access' | 'not_found' | 'invalid' | 'failed'; message: string }

/** `db` is the caller's own session, so the command's auth.uid() checks are the real guard. */
export async function acceptRepairFollowUp(db: SupabaseClient, proposalId: string, key: string): Promise<AcceptResult> {
  let res: Awaited<ReturnType<typeof db.rpc>>
  try { res = await db.rpc('accept_repair_proposal', { p_proposal_id: proposalId, p_key: key }) }
  catch { return { ok: false, code: 'failed', message: 'Save not confirmed. Check your calendar, or save again: saving twice cannot add the work twice.' } }
  const { data, error } = res
  if (error) {
    if (error.code === '42501') return { ok: false, code: 'access', message: error.message }
    if (error.code === 'P0002') return { ok: false, code: 'not_found', message: 'That follow-up could not be found. Prepare it again.' }
    if (error.code === '22023') return { ok: false, code: 'invalid', message: error.message }
    if (['PGRST202', '42883'].includes(error.code ?? '')) return { ok: false, code: 'failed', message: 'Adding repairs is unavailable while a database update is pending. Nothing was saved.' }
    return { ok: false, code: 'failed', message: 'Save not confirmed. Check your calendar, or save again: saving twice cannot add the work twice.' }
  }
  const r = data as any
  if (r?.ok) return { ok: true, replayed: Boolean(r.replayed), taskIds: r.taskIds ?? [], checkTaskId: r.checkTaskId ?? null, waitingChecks: r.waitingChecks ?? [] }
  const code = ({ STALE_PROPOSAL: 'stale', PROPOSAL_UNAVAILABLE: 'unavailable', CYCLE_CHANGED: 'cycle_changed', ALREADY_ACCEPTED: 'already_accepted' } as const)[r?.code as 'STALE_PROPOSAL'] ?? 'failed'
  const message = { stale: 'Your week or this result changed after the follow-up was prepared. Review it again; your choices are kept.', unavailable: 'This follow-up expired. Prepare it again.',
    cycle_changed: 'Your open week changed. Review the week, then prepare this again.', already_accepted: 'This follow-up was already accepted.', failed: 'Save not confirmed.' }[code]
  return { ok: false, code, message }
}

/** Places the re-check for repairs that are finished but had no check this week. Same guard and retry model as accept. */
export async function placeRepairCheck(db: SupabaseClient, threadIds: string[], key: string) {
  const { data, error } = await db.rpc('place_repair_check', { p_thread_ids: threadIds, p_key: key })
  if (error) return { ok: false as const, message: error.code === '42501' ? error.message : 'Could not add the re-check. Nothing was changed.' }
  const r = data as any
  if (r?.ok) return { ok: true as const, checkTaskId: r.checkTaskId as string, date: (r.date ?? null) as string | null }
  const message = ({ NOT_READY: 'Finish every repair first.', ALREADY_PLANNED: 'These repairs already have a re-check.', NO_OPEN_WEEK: 'There is no open week. Review your week first.',
    NOT_THIS_WEEK: `The re-check is due ${r?.earliestDate ?? 'later'}, after this week. Review the week and ask again then.` } as Record<string, string>)[r?.code] ?? 'Could not add the re-check.'
  return { ok: false as const, message }
}
