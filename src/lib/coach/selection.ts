import { createAdminClient } from '../supabase/admin'
import { calendarTaskHref } from '../routing/calendar'
import { getReport } from '../mocks/reportService'
import { describeScore } from '../mocks/report'

/**
 * A Coach screen opened on one object: a proposal or a repair, by id. The id is validated and the object is read by owner, so another
 * student's id and a missing one look the same ("unavailable"). Reading changes nothing; confirming a proposal still goes through the
 * existing confirm endpoint, and repair work is placed through the existing Calendar preview and confirmation flow.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Selection = { proposal: string | null; repair: string | null; attempt: string | null; task: string | null; reading: string | null; report: string | null }
export function parseSelection(q: { proposal?: string; repair?: string; attempt?: string; task?: string; reading?: string; report?: string }): Selection {
  const id = (v?: string) => v && UUID.test(v) ? v.toLowerCase() : null
  // Task ids are text keys, not uuids: bounded and charset-limited, and then read by owner like the others.
  const task = q.task && /^[A-Za-z0-9_.:-]{1,80}$/.test(q.task) ? q.task : null
  const reading = q.reading && /^[A-Za-z0-9_.:-]{1,80}$/.test(q.reading) ? q.reading : null
  return { proposal: id(q.proposal), repair: id(q.repair), attempt: id(q.attempt), task, reading, report: id(q.report) }
}
export const coachReportHref = (id: string) => `/app/coach?report=${id}`
export const coachProposalHref = (id: string) => `/app/coach?proposal=${id}`
export const coachRepairHref = (id: string) => `/app/coach?repair=${id}`

/** One task an accepted proposal created. `href` is null when the task no longer exists: said plainly, never a broken link. */
export type TaskLink = { label: string; href: string | null; state: 'open' | 'done' | 'cancelled' | 'removed'; continuedAs?: { label: string; href: string } | null }

export type SelectedObject =
  | { kind: 'unavailable'; what: 'proposal' | 'repair' | 'attempt' | 'task' | 'reading' | 'report'; message: string }
  | { kind: 'report'; id: string; status: 'active' | 'withdrawn'; title: string; summary: string; href: string }
  | { kind: 'reading'; id: string; title: string; href: string }
  | { kind: 'task'; id: string; title: string; date: string; minutes: number; movable: boolean; href: string }
  | { kind: 'attempt'; id: string; title: string; summary: string; resultHref: string }
  | { kind: 'proposal'; id: string; status: 'pending' | 'executed' | 'rejected' | 'stale' | 'expired'; title: string; reasoning: string; moves: { id: string; title: string; minutes: number; date: string }[]; staysDue: { title: string; reason: string }[]; taskLinks: TaskLink[]; message: string }
  | { kind: 'repair'; id: string; attemptId: string | null; status: string; conceptName: string; message: string; taskLinks: { label: string; href: string }[]; checkLink: { label: string; href: string } | null }

const GONE = (what: 'proposal' | 'repair' | 'attempt' | 'task' | 'reading' | 'report'): SelectedObject => ({ kind: 'unavailable', what, message: `That ${what === 'proposal' ? 'suggestion' : what === 'attempt' ? 'paper' : what === 'task' ? 'task' : what === 'reading' ? 'reading' : what === 'report' ? 'mock report' : 'weak area'} is not available. It may have been removed, or it is not yours to open.` })

export async function loadSelectedObject(userId: string, sel: Selection): Promise<SelectedObject | null> {
  const admin = createAdminClient()
  if (sel.report) {
    // Owner-checked. A withdrawn report is a real, different state from a missing one, and neither is ever replaced by another report.
    const r = await getReport(userId, sel.report)
    if (!r) return GONE('report')
    const label = `${r.takenOn}${r.provider ? ` · ${r.provider}` : ''}`
    return { kind: 'report', id: r.id, status: r.status, title: `Mock report · ${label}`, summary: `${r.scope === 'partial' ? 'Partial exam' : 'Full mock'}, ${describeScore(r.score, r.scale, r.scoreMax)} (your own report, not test evidence).`, href: `/app/calendar/mock-report/${r.id}` }
  }
  if (sel.reading) {
    const { data: r } = await admin.from('curriculum_readings').select('id, topic_id, reading_no, title').eq('id', sel.reading).eq('is_active', true).maybeSingle()
    if (!r) return GONE('reading')
    return { kind: 'reading', id: r.id as string, title: `Reading ${r.reading_no}: ${r.title}`, href: `/app/curriculum/${r.topic_id}/${r.id}` }
  }
  if (sel.task) {
    const { data: t } = await admin.from('plan_blocks').select('id, title, local_date, duration_minutes, execution, is_protected_commitment, cancelled_at, learning_activity_id').eq('id', sel.task).eq('user_id', userId).maybeSingle()
    if (!t || t.cancelled_at || !t.local_date) return GONE('task')
    return { kind: 'task', id: t.id as string, title: t.title as string, date: t.local_date as string, minutes: Number(t.duration_minutes ?? 0),
      movable: t.execution === 'not_started' && !t.is_protected_commitment && !t.learning_activity_id, href: calendarTaskHref(t.id as string, t.local_date as string) }
  }
  if (sel.attempt) {
    // Owned and scored only. Another student's id and a missing one look the same.
    const { data: a } = await admin.from('assessment_attempts').select('id, status, attempt_kind, score, scoring_policy_version, valid_response_count, delivered_count, started_at').eq('id', sel.attempt).eq('user_id', userId).maybeSingle()
    if (!a || a.status !== 'scored') return GONE('attempt')
    const label = ({ weekly: 'Weekly paper', reading: 'Reading check', subject: 'Subject check', repair: 'Repair re-check', mock: 'Mock session', practice: 'Timed practice' } as Record<string, string>)[(a.attempt_kind ?? '') as string] ?? 'Paper'
    const basis = a.scoring_policy_version === 'paper-score.1' ? `${a.valid_response_count ?? 0} of ${a.delivered_count ?? 0} answered` : 'answered questions only'
    return { kind: 'attempt', id: a.id as string, title: `${label}${a.started_at ? ` · ${String(a.started_at).slice(0, 10)}` : ''}`, summary: a.score === null ? 'No score is available for this paper.' : `Scored ${a.score}% (${basis}).`, resultHref: `/app/tests/${a.id}/result` }
  }
  if (sel.proposal) {
    const { data: p } = await admin.from('coach_proposals').select('id, status, title, reasoning, proposed_changes, expires_at, applied_task_ids, target_task_id, accept_receipt').eq('id', sel.proposal).eq('user_id', userId).maybeSingle()
    if (!p) return GONE('proposal')
    const expired = p.status === 'pending' && p.expires_at && String(p.expires_at) < new Date().toISOString()
    const status = (expired ? 'expired' : p.status) as 'pending' | 'executed' | 'rejected' | 'stale' | 'expired'
    const ch = (p.proposed_changes ?? {}) as any
    // The tasks an accepted proposal actually created come from its own acceptance receipt (written inside the acceptance transaction),
    // never from matching titles. A pending, dismissed, stale or expired proposal has created nothing, so it links nothing.
    const receipt = (p.accept_receipt ?? {}) as { taskIds?: unknown }
    const ids = status !== 'executed' ? [] : [...new Set([...(Array.isArray(receipt.taskIds) ? receipt.taskIds : []), ...(p.applied_task_ids ?? []), ...(p.target_task_id ? [p.target_task_id] : [])].filter((x): x is string => typeof x === 'string'))]
    const [{ data: tasks }, { data: successors }] = ids.length ? await Promise.all([
      admin.from('plan_blocks').select('id, title, local_date, execution, cancelled_at').in('id', ids).eq('user_id', userId),
      admin.from('plan_blocks').select('id, title, local_date, continued_from_task_id').in('continued_from_task_id', ids).eq('user_id', userId).is('cancelled_at', null),
    ]) : [{ data: [] as any[] }, { data: [] as any[] }]
    const byId = new Map((tasks ?? []).map((t: any) => [t.id as string, t])), nextOf = new Map((successors ?? []).map((t: any) => [t.continued_from_task_id as string, t]))
    const taskLinks: TaskLink[] = ids.map(id => {
      const t = byId.get(id) as any
      if (!t) return { label: 'A task from this plan is no longer available', href: null, state: 'removed' as const }
      const n = nextOf.get(id) as any
      return {
        label: t.title as string, href: calendarTaskHref(id, (t.local_date ?? undefined) as string | undefined),
        state: t.cancelled_at ? 'cancelled' as const : t.execution === 'completed' ? 'done' as const : 'open' as const,
        continuedAs: n ? { label: n.title as string, href: calendarTaskHref(n.id as string, (n.local_date ?? undefined) as string | undefined) } : null,
      }
    })
    return {
      kind: 'proposal', id: p.id as string, status, title: (p.title ?? 'Suggested change') as string, reasoning: (p.reasoning ?? '') as string,
      moves: (ch.moves ?? []).map((m: any) => ({ id: m.id, title: m.title, minutes: m.minutes, date: m.date })), staysDue: (ch.staysDue ?? []).map((t: any) => ({ title: t.title, reason: t.reason })),
      taskLinks,
      message: ({ pending: 'Waiting for your decision. Nothing changes until you confirm.', executed: ids.length === 0 ? 'Confirmed, and it added no tasks.' : 'Already applied. Your plan was changed when you confirmed it.', rejected: 'You dismissed this suggestion. Ask Coach for a fresh one if you still want it.', stale: 'Your plan changed since this was suggested, so it no longer applies. Ask Coach for a fresh one.', expired: 'This suggestion has expired. Ask Coach for a fresh one.' } as const)[status],
    }
  }
  if (sel.repair) {
    const { data: t } = await admin.from('repair_threads').select('id, status, latest_attempt_id, latest_check_state, concept:curriculum_concepts(name)').eq('id', sel.repair).eq('user_id', userId).maybeSingle()
    if (!t) return GONE('repair')
    const { data: work } = await admin.from('plan_blocks').select('id, title, task_type, local_date, execution').eq('user_id', userId).eq('repair_thread_id', sel.repair).is('cancelled_at', null).neq('execution', 'cancelled').order('local_date')
    const repairs = (work ?? []).filter(w => w.task_type === 'repair'), check = (work ?? []).find(w => w.task_type === 'recheck')
    const status = t.status as string
    const message = status === 'open' ? 'Found from a paper. Roadmap has not planned work for it yet; nothing is added until you confirm a plan.'
      : status === 'proposed' ? 'Repair work has been proposed. Review it, then confirm to add it to Calendar.'
      : status === 'scheduled' ? 'Repair work is on your Calendar.'
      : status === 'in_progress' ? 'You are working on it.'
      : status === 'awaiting_recheck' ? 'The repair work is done. A re-check will show whether it worked.'
      : status === 'closed' ? 'Closed: the re-check showed it is no longer a weak area.'
      : 'This weak area was set aside; it no longer needs action.'
    return {
      kind: 'repair', id: t.id as string, attemptId: (t.latest_attempt_id as string | null) ?? null, status, conceptName: ((t.concept as any)?.name ?? 'A weak area') as string, message,
      taskLinks: repairs.map(w => ({ label: `${w.title}${w.execution === 'completed' ? ' (done)' : ''}`, href: calendarTaskHref(w.id as string, (w.local_date ?? undefined) as string | undefined) })),
      checkLink: check ? { label: 'Open the re-check', href: calendarTaskHref(check.id as string, (check.local_date ?? undefined) as string | undefined) } : null,
    }
  }
  return null
}
