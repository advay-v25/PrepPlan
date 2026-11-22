import { calendarTaskHref } from '../routing/calendar'
import { createAdminClient } from '../supabase/admin'
import { weeklyCapacityMinutes } from '../curriculum/roadmapService'
import { getRevisionOverview } from '../curriculum/revisionOverview'
import { listAppointments, type AppointmentSummary } from '../planning/checkpointService'
import { finalStretch, type StretchPlan } from './finalStretch'
import type { ExamStatus } from './status'

/** Reads what the student actually has (repairs, revision, rehearsals) and hands it to the pure planner. */
export async function loadFinalStretch(userId: string, status: ExamStatus): Promise<StretchPlan | null> {
  if (!['final_preparation', 'final_week', 'exam_day'].includes(status.phase)) return null
  const admin = createAdminClient()
  const [{ count: repairs }, revision, appts, budget, { data: psm }, { data: done }] = await Promise.all([
    admin.from('repair_threads').select('id', { count: 'exact', head: true }).eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck']),
    getRevisionOverview(userId).catch(() => null),
    listAppointments(userId).catch(() => [] as AppointmentSummary[]),
    weeklyCapacityMinutes(userId).catch(() => null),
    admin.from('exam_completion').select('psm_status').eq('user_id', userId).maybeSingle(),
    admin.from('mock_rehearsals').select('id, appointment_id, completed_at').eq('user_id', userId).eq('status', 'complete').order('completed_at', { ascending: false }).limit(1),
  ])
  // Link to what is ALREADY accepted where possible; otherwise to the existing proposal flow. Nothing here writes to the calendar.
  const open = ['not_started', 'in_progress', 'deferred']
  const readingIds = (revision?.next ?? []).slice(0, 3).map(n => n.readingId)
  const { data: tasks } = await admin.from('plan_blocks').select('id, title, task_type, lm_id, local_date, execution').eq('user_id', userId).is('cancelled_at', null).in('execution', open).gte('local_date', status.today).order('local_date')
  const taskFor = (reading: string) => (tasks ?? []).find(t => t.lm_id === reading && ['review', 'study', 'revision'].includes(t.task_type as string))
  const repairTask = (tasks ?? []).find(t => t.task_type === 'repair')
  let proposalHref: string | null = null
  if (!repairTask && (repairs ?? 0) > 0) {
    const { data: th } = await admin.from('repair_threads').select('latest_attempt_id, opened_from_attempt_id').eq('user_id', userId).in('status', ['open', 'proposed']).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    const att = (th?.latest_attempt_id ?? th?.opened_from_attempt_id) as string | undefined
    proposalHref = att ? `/app/tests/${att}/result#proposal-h` : null
  }
  void readingIds
  const planned = appts.filter(a => a.status === 'planned')
  const internal = planned.find(a => a.kind === 'internal_rehearsal')
  const external = planned.find(a => a.kind !== 'internal_rehearsal')
  // A debrief is pending until a repair follow-up exists for it; the rehearsal page owns that flow, so the stretch only points at it.
  const last = done?.[0]
  return finalStretch({
    phase: status.phase, daysToExam: status.daysToExam, weeklyBudgetMinutes: budget, openRepairs: repairs ?? 0,
    revisionNext: (revision?.next ?? []).slice(0, 3).map(n => { const t = taskFor(n.readingId); return { name: n.name, href: `/app/curriculum/${n.topic}/${n.readingId}`, why: n.why[0] ?? '', task: t ? { href: calendarTaskHref(t.id as string, t.local_date as string), date: t.local_date as string } : null } }),
    repair: (repairs ?? 0) > 0 ? { task: repairTask ? { href: calendarTaskHref(repairTask.id as string, repairTask.local_date as string), date: repairTask.local_date as string, title: repairTask.title as string } : null, proposalHref } : null,
    rehearsal: internal ? { appointmentId: internal.id, date: internal.date, href: internal.rehearsal?.primary?.href ?? internal.href, reserved: Boolean(internal.rehearsal) } : null,
    debriefHref: last ? `/app/tests/rehearsal/${last.id}#debrief-h` : null,
    externalMockSoon: external ? { title: `${external.title} on ${external.date}`, date: external.date, href: external.href } : null,
    psm: ((psm?.psm_status ?? 'unknown') as 'done' | 'not_done' | 'unsure' | 'unknown'),
  })
}
