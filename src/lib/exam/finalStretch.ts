import { addDays, daysBetween } from '../planning/studyWeek'

/**
 * Where the student is relative to the exam, and what the final stretch should ask of them (pure).
 *
 * Phases come from the student's OWN exam date and their own "I sat the exam" statement. A date, a window ending or a score never
 * establishes that the exam was sat: after the date it only asks. Study prompts pause only once the student says they sat it.
 */
export type ExamPhase = 'no_date' | 'long_horizon' | 'final_preparation' | 'final_week' | 'exam_day' | 'awaiting_status' | 'sat'
export const FINAL_PREPARATION_DAYS = 56   // the founder's "final eight weeks"
export const FINAL_WEEK_DAYS = 7

export type PhaseInput = { today: string; examDate: string | null; satOn: string | null; windowCloses?: string | null; windowConfirmed?: boolean | null }
export type PhaseResult = { phase: ExamPhase; daysToExam: number | null; note: string }

export function examPhase(i: PhaseInput): PhaseResult {
  if (i.satOn) return { phase: 'sat', daysToExam: null, note: `You told us you sat the exam on ${i.satOn}. Study prompts are paused and your history is kept.` }
  if (!i.examDate) return { phase: 'no_date', daysToExam: null, note: 'You have not set an exam date.' }
  const days = daysBetween(i.today, i.examDate)
  if (days < 0) return { phase: 'awaiting_status', daysToExam: days, note: `Your exam date (${i.examDate}) has passed. Roadmap cannot know whether you sat it: tell us, or move the date if it changed.` }
  if (i.windowCloses && i.windowConfirmed === false && i.windowCloses < i.today) return { phase: 'awaiting_status', daysToExam: days, note: `The exam window you picked ended on ${i.windowCloses} and was never confirmed. Tell us whether you sat the exam, or choose a new window.` }
  if (days === 0) return { phase: 'exam_day', daysToExam: 0, note: 'Your exam is today.' }
  if (days <= FINAL_WEEK_DAYS) return { phase: 'final_week', daysToExam: days, note: `${days} day${days === 1 ? '' : 's'} to your exam.` }
  if (days <= FINAL_PREPARATION_DAYS) return { phase: 'final_preparation', daysToExam: days, note: `${Math.ceil(days / 7)} weeks to your exam.` }
  return { phase: 'long_horizon', daysToExam: days, note: `${Math.ceil(days / 7)} weeks to your exam.` }
}

export type StretchKind = 'debrief' | 'fix' | 'maintenance' | 'check' | 'rehearsal' | 'logistics'
/** `on_calendar`: an accepted task already exists (the link opens it); `proposal`: new work goes through the existing proposal flow; `not_planned`: nothing is planned yet. */
export type StretchItem = { key: string; kind: StretchKind; title: string; why: string; href: string; minutes: number; status?: 'on_calendar' | 'proposal' | 'not_planned'; date?: string }
export type StretchInput = {
  phase: ExamPhase; daysToExam: number | null
  /** Minutes the student can give in a week; null = not stated. */
  weeklyBudgetMinutes: number | null
  openRepairs: number
  revisionNext: { name: string; href: string; why: string; task?: { href: string; date: string } | null }[]
  /** An accepted repair task (open) if one exists, else the follow-up proposal (existing flow) for the newest result with open repairs. */
  repair?: { task: { href: string; date: string; title: string } | null; proposalHref: string | null } | null
  /** The next planned internal rehearsal, if any, and whether a rehearsal is already reserved. */
  rehearsal: { appointmentId: string; date: string; href: string; reserved: boolean } | null
  /** A finished rehearsal whose debrief has not been planned yet. */
  debriefHref: string | null
  externalMockSoon: { title: string; date: string; href: string } | null
  psm: 'done' | 'not_done' | 'unsure' | 'unknown'
}
export type StretchPlan = { headline: string; items: StretchItem[]; waits: { title: string; reason: string }[]; note: string }

const PRIORITY: StretchKind[] = ['debrief', 'fix', 'logistics', 'maintenance', 'check', 'rehearsal']
const LOGISTICS = (d: number | null): StretchItem[] => [
  { key: 'logistics-centre', kind: 'logistics', title: 'Confirm your test-centre booking and ID', why: 'Check the booking, the address, the arrival time and the identification the centre needs. This is administration, not study.', href: '/app/calendar', minutes: 15 },
  { key: 'logistics-calculator', kind: 'logistics', title: 'Check your calculator is on the approved list', why: 'The exam allows only specific calculator models. Check yours against the CFA Institute list and make sure the battery is fresh.', href: '/app/calendar', minutes: 10 },
]

/** Builds the final stretch from what the student actually has; never invents work and never dumps the backlog. */
export function finalStretch(i: StretchInput): StretchPlan | null {
  if (!['final_preparation', 'final_week', 'exam_day'].includes(i.phase)) return null
  const week = i.phase !== 'final_preparation'
  const items: StretchItem[] = []
  const waits: StretchPlan['waits'] = []

  if (i.phase === 'exam_day') {
    return { headline: 'Exam day', items: [{ key: 'exam-day', kind: 'logistics', title: 'Your exam is today', why: 'Nothing new to learn. Check what else is on your calendar today and keep it simple.', href: '/app/calendar', minutes: 0 }], waits: [], note: 'You will be asked afterwards whether you sat it; nothing is assumed.' }
  }
  if (i.debriefHref) items.push({ key: 'debrief', kind: 'debrief', title: 'Debrief your last rehearsal', why: 'A short, manageable list of what the rehearsal showed. It is the most useful thing you can do with it.', href: i.debriefHref, minutes: 30 })
  if (i.openRepairs > 0) {
    const r = i.repair
    items.push(r?.task
      ? { key: 'fix', kind: 'fix', title: `Do your repair: ${r.task.title}`, why: `${i.openRepairs} concept${i.openRepairs === 1 ? '' : 's'} showed a gap. This repair is already on your calendar; repairs and their re-checks come before new revision.`, href: r.task.href, minutes: 45, status: 'on_calendar', date: r.task.date }
      : { key: 'fix', kind: 'fix', title: `Plan ${Math.min(i.openRepairs, 2)} targeted fix${Math.min(i.openRepairs, 2) === 1 ? '' : 'es'}`, why: `${i.openRepairs} concept${i.openRepairs === 1 ? '' : 's'} showed a gap and no repair is on your calendar yet. Review the proposal; nothing is added until you confirm it.`, href: r?.proposalHref ?? '/app/tests', minutes: 45, status: r?.proposalHref ? 'proposal' : 'not_planned' })
  }
  for (const r of i.revisionNext.slice(0, week ? 2 : 1)) items.push(r.task
    ? { key: `maintenance-${r.href}`, kind: 'maintenance', title: `Keep ${r.name} fresh`, why: `${r.why || 'Covered material that has not been revisited recently.'} It is already on your calendar.`, href: r.task.href, minutes: 30, status: 'on_calendar', date: r.task.date }
    : { key: `maintenance-${r.href}`, kind: 'maintenance', title: `Keep ${r.name} fresh`, why: `${r.why || 'Covered material that has not been revisited recently.'} Not on your calendar yet: it is offered in your next weekly review, where you accept or change it.`, href: '/app/review-week', minutes: 30, status: 'proposal' })
  if (i.openRepairs === 0 && !i.debriefHref) items.push({ key: 'check', kind: 'check', title: 'Take a check on something you feel unsure about', why: 'With no open repair, a selected check is how you find what is still shaky.', href: '/app/tests', minutes: 30 })
  if (week) items.push(...LOGISTICS(i.daysToExam))
  if (i.psm !== 'done') items.push({ key: 'psm', kind: 'logistics', title: 'Practical Skills Module: check its status', why: 'CFA Institute requires the Practical Skills Module before results are released. This is an administrative reminder; Roadmap does not teach it. You can ignore it if it is already done.', href: '/app/exam', minutes: 5 })
  if (i.rehearsal) {
    if (week && (i.daysToExam ?? 99) < 4) waits.push({ title: 'A full rehearsal', reason: 'It takes about five hours and needs a debrief. Too close to the exam to do both well.' })
    else items.push({ key: 'rehearsal', kind: 'rehearsal', title: i.rehearsal.reserved ? 'Take your rehearsal' : 'Prepare your rehearsal', why: `Two timed sessions, planned for ${i.rehearsal.date}.`, href: i.rehearsal.href, minutes: 280 })
  } else if (!week) items.push({ key: 'plan-rehearsal', kind: 'rehearsal', title: 'Plan a rehearsal', why: 'A full rehearsal in the final weeks shows pacing and fragile areas. Pick a date in Calendar.', href: '/app/calendar#checkpoint', minutes: 5 })
  if (i.externalMockSoon) items.push({ key: 'external', kind: 'check', title: `${i.externalMockSoon.title}`, why: 'An external mock you planned. Record what happened afterwards; it stays your own report.', href: i.externalMockSoon.href, minutes: 0 })

  items.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))
  // Capacity: keep the highest-priority work that fits this week's budget; the rest waits, with the reason said.
  const budget = i.weeklyBudgetMinutes
  const kept: StretchItem[] = []
  let used = 0
  for (const it of items) {
    if (budget !== null && it.minutes > 0 && used + it.minutes > budget && kept.some(k => k.minutes > 0)) { waits.push({ title: it.title, reason: `It does not fit this week's ${Math.round(budget / 60)}-hour budget alongside the work above.` }); continue }
    kept.push(it); used += it.minutes
  }
  const cap = week ? 5 : 6
  while (kept.length > cap) { const x = kept.pop()!; waits.push({ title: x.title, reason: 'Kept short on purpose: the final stretch is about doing less, better.' }) }
  return {
    headline: week ? 'Your final week' : 'Final preparation',
    items: kept, waits,
    note: week ? 'Manageable review, selected checks and exam logistics. What waits is listed, and you can bring any of it back.' : 'A balance of maintenance, targeted fixes, a rehearsal and its debrief. You choose the trade-offs.',
  }
}

export const lastStudyDay = (examDate: string) => addDays(examDate, -1)
