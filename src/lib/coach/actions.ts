import { TUTORING_BOUNDARY_REPLY } from './policy'
import { interpret } from './interpret'
import { onboardingHref } from '../routing/registry'
import { calendarTaskHref, classLogHref } from '../routing/calendar'
import { clock } from './move'

/** Where coverage / first-pass position is actually edited. */
export const POSITION_EDITOR_HREF = onboardingHref('position', '/app/coach')

/**
 * What the Coach may propose, decided by code, not by the model.
 *
 * The model writes the explanation. It never chooses an action: that keeps every change small,
 * checkable and confirmable, and lets a test prove what a given situation produces. Each proposal
 * is executed only after the student confirms it, and only through the same services the Calendar
 * uses.
 */

export type CoachIntent = 'struggling' | 'day_was_bad' | 'redo' | 'next' | 'free' | 'today' | 'availability' | 'lighter' | 'result' | 'slow' | 'mock' | 'teach' | 'move_block' | 'log_class' | 'log_learning' | 'exam'

/** The primary intent of a message. Negation, hypotheticals and a teaching component are read by interpret(); this keeps the old entry point. */
export function classifyIntent(message: string): CoachIntent {
  return interpret(message).primary
}

export type OpenTask = { id: string; title: string; revision: number; durationMinutes: number; execution?: string; date?: string }
export type RepairTarget = { outcomeId: string; name: string; readingId: string; subjectId: string; readingLabel: string }

export type CoachSituation = {
  intent: CoachIntent
  today: string
  todayOpen: OpenTask[]
  repairs: RepairTarget[]
  classChoices?: { key: string; label: string; date: string; sessionId: string | null }[]
  cycle: { start: string; end: string } | null
  /** Planned minutes per date in the active cycle (skipped work excluded). */
  load: Record<string, number>
  /** The ONE assessment decision (Tests/Home/Calendar's): start | upcoming | resume | result | confirm_scope | no_scope | insufficient | waiting | none. 'unavailable' is read as insufficient. */
  paper: 'start' | 'upcoming' | 'resume' | 'result' | 'confirm_scope' | 'no_scope' | 'insufficient' | 'waiting' | 'none' | string
  /** Server facts behind `paper`: the exact destination, the due day and the server's reason. Never model-written. */
  paperDetail?: { href?: string | null; dueDate?: string | null; message?: string | null; unresolved?: number } | null
  closing: boolean
  /** The student said they sat the exam: study nudges are paused; the Coach only points at the follow-up. */
  examSat?: string | null
  /** The first open task the student has accepted for today (or the next day with one), resolved to its exact Calendar link. */
  /** Home's canonical next action (state.nextAction). "What next?" leads with it so the Coach and Home never name different first steps. */
  homeNext?: { code: string; title: string; rationale: string; destination: string | null } | null
  nextTask?: { id: string; title: string; date: string; minutes: number; type: string } | null
  /** The latest scored result and what it found, for "what should I do about this result?" and timing questions. */
  latestResult?: { attemptId: string; href: string; headline: string; findings: { kind: string; title: string }[]; timing?: { available: boolean; message: string | null; deliverable: number; minutes: number } | null } | null
  repairFollowUp?: { label: string; href: string } | null
  /** The student selected a result that is not theirs, not scored or not found. Nothing else is substituted for it. */
  selectedResultUnavailable?: boolean
  /** A result the student selected and that opened (so it is that result, not "the latest"). */
  selectedResultOpen?: boolean
  /** A task the student selected (validated as theirs by the server). `movable` is false once it has been started. */
  selectedTask?: { id: string; title: string; revision: number; date: string; minutes: number; movable: boolean } | null
  /** A reading the student selected (validated against the curriculum). Context and a link; it never becomes evidence. */
  selectedReading?: { id: string; title: string; href: string } | null
  /** Up to three open tasks to choose between when a move request names none. */
  taskChoices?: { id: string; title: string; date: string }[]
  /** The day the student asked for, as they wrote it. */
  when?: string | null
  /** The server's resolution of that day for the selected task: a concrete date and a free slot (or day-only), or one question to ask. */
  placement?: { state: 'ok'; date: string; dateLabel: string; startsAt: string | null; startMinutes: number | null; timeLabel: string | null; windowed?: boolean; exact?: boolean; hasWindows?: boolean } | { state: 'ask'; ask: string } | null
  /** The student's own mock, as Calendar shows it. Context and a link only: the Coach never edits it. */
  /** The message stated where preparation stands. Acknowledged only: nothing is recorded or changed. */
  preparation?: boolean
  /** The latest COMPLETED mock the student recorded, even with nothing booked next. Their own report: context and a link, never evidence. */
  /** The latest active structured report (mock_reports). Their own report: context and a link only. */
  mockReport?: { id: string; takenOn: string; scoreText: string; scope: 'full' | 'partial'; provider: string | null; selected?: boolean; status?: 'active' | 'withdrawn' } | null
  /** The student chose a specific report that is missing or not theirs: said as such, never replaced by another. */
  mockReportUnavailable?: boolean
  lastMock?: { title: string; date: string; reportedResult: string | null; notes: string | null; href: string | null } | null
  checkpoint?: { title: string; date: string; href: string; choiceUnresolved: boolean; appointments?: number; rehearsal?: { state: string; rehearsalId: string | null; reasons: string[] } | null } | null
  /** The shared revision rotation, as Curriculum shows it. Context and links only: the Coach never schedules or dates revision itself. */
  /** Why the accepted week is this size, from the review's own record. Context only: the Coach never resizes a week itself. */
  adaptation?: { headline: string; lighter: boolean; optionalMinutes: number; waiting: number } | null
  revision?: { inPlan: number; next: { name: string; href: string; why: string }[]; eligible: number } | null
}

/** What the student reviews is exactly what is applied: the tasks, the revisions they were read at and the day they sit on. */
export type DeferChanges = { version: 2; moves: { id: string; title: string; revision: number; date: string; minutes: number }[]; staysDue: { id: string; title: string; reason: string }[]; waiting: number }
/** One reviewed placement: exactly the day and (when found) the free time the student saw. Applied by confirm_coach_move, not by deferral. */
export type MoveChanges = { version: 3; move: { id: string; title: string; revision: number; fromDate: string; toDate: string; startsAt: string | null; startMinutes: number | null; minutes: number; windowed?: boolean } }
export type Proposal = { kind: 'defer_today'; title: string; reasoning: string; changes: DeferChanges } | { kind: 'move_task'; title: string; reasoning: string; changes: MoveChanges }

export type CoachLink = { label: string; href: string }

/**
 * What the Coach may say and link about the weekly assessment, from the same decision Tests, Home and Calendar read. Only `start` is ever worded as a
 * paper the student can begin; every other state explains its actual prerequisite. The server still revalidates at reservation.
 */
export function assessmentAdvice(s: Pick<CoachSituation, 'paper' | 'paperDetail'>): { note: string; link: CoachLink | null; startable: boolean } | null {
  const d = s.paperDetail ?? {}
  switch (s.paper) {
    case 'start': return { startable: true, note: 'Your weekly paper can be started now; Tests re-checks it when you begin.', link: { label: 'Go to this week’s paper', href: '/app/tests' } }
    case 'upcoming': return { startable: false, note: `Your weekly paper is available early${d.dueDate ? ` and is due ${d.dueDate}` : ''}. Today’s planned study stays your first step; take the paper early only if you choose to.`, link: { label: 'See this week’s paper (available early)', href: '/app/tests' } }
    case 'resume': return { startable: false, note: 'You have a paper in progress. Resume it rather than starting another.', link: { label: 'Resume your paper', href: d.href ?? '/app/tests' } }
    case 'result': return { startable: false, note: 'This week’s paper is already scored.', link: { label: 'Open your result', href: d.href ?? '/app/tests' } }
    case 'confirm_scope': return { startable: false, note: `${d.unresolved ? `${d.unresolved} finished or partly finished block${d.unresolved === 1 ? '' : 's'} need` : 'Some finished work needs'} you to confirm what you covered before it can be tested.`, link: { label: 'Confirm what you covered', href: d.href ?? '/app/tests#scope-h' } }
    case 'no_scope': return { startable: false, note: 'There is no completed, eligible study to test yet, so no paper is offered. Log a class or finish a study task and it becomes eligible.', link: { label: 'Open Calendar', href: '/app/calendar' } }
    case 'insufficient': case 'unavailable': return { startable: false, note: 'Your completed work is eligible, but there are not enough approved, unseen questions to build a paper right now. Nothing can be started; I will keep planning around it and Tests shows what is limited.', link: { label: 'View assessment availability', href: '/app/tests' } }
    case 'waiting': return { startable: false, note: d.message ?? 'A step has to finish before the next check can run; Tests shows what and when.', link: { label: 'See what comes first', href: '/app/tests' } }
    default: return null
  }
}

const MAX_DEFER = 6
const endClock = (start: number, minutes: number) => clock(start + minutes)

export function planProposals(s: CoachSituation): { proposals: Proposal[]; notes: string[] } {
  if (s.examSat) return { proposals: [], notes: [] }
  const proposals: Proposal[] = []
  const notes: string[] = []
  if (s.preparation) notes.push('Thanks, that helps me plan. I have not changed your coverage, revision status or calendar from what you said here; if it should be recorded, update it where you reported your position and PrepPlan re-plans from there. What you report is your own account, not test evidence.')

  if (s.intent === 'day_was_bad') {
    // Only work that has not started can move. Started or part-done work stays due: it is evidence of effort and the student's to finish.
    const movable = s.todayOpen.filter(t => (t.execution ?? 'not_started') === 'not_started')
    const stays = s.todayOpen.filter(t => !movable.includes(t)).map(t => ({ id: t.id, title: t.title, reason: 'already started, so it stays due' }))
    if (s.todayOpen.length === 0) notes.push('Nothing is left open today, so there is nothing to move.')
    else if (movable.length === 0) notes.push('What is left today has already been started, so it stays due. Finish a small part or mark what you did in Calendar.')
    else {
      const moves = movable.slice(0, MAX_DEFER).map(t => ({ id: t.id, title: t.title, revision: t.revision, date: t.date ?? s.today, minutes: t.durationMinutes }))
      const waiting = movable.length - moves.length
      proposals.push({
        kind: 'defer_today',
        title: `Move ${moves.length} open task${moves.length === 1 ? '' : 's'} off today`,
        reasoning: `Marks ${moves.length === 1 ? 'it' : 'them'} deferred, which takes ${moves.length === 1 ? 'it' : 'them'} off today. Nothing is deleted, ${moves.length === 1 ? 'it stays' : 'they stay'} due, and you choose the new time in Calendar (or ${moves.length === 1 ? 'it waits' : 'they wait'} for your weekly review). You can undo each one from Calendar.${stays.length ? ` ${stays.length} started task${stays.length === 1 ? '' : 's'} stay${stays.length === 1 ? 's' : ''} due.` : ''}${waiting ? ` ${waiting} more stay${waiting === 1 ? 's' : ''} on today; ask again after this to move them.` : ''}`,
        changes: { version: 2, moves, staysDue: stays, waiting },
      })
    }
  }

  if (s.intent === 'move_block') {
    const t = s.selectedTask
    if (!t) notes.push(s.taskChoices?.length ? 'Which task do you mean? Pick one below and I will show exactly what moving it would change.' : 'I cannot see an open task to move. Open the task in Calendar and ask again from there.')
    else if (!t.movable) notes.push(`“${t.title}” has already been started, so it stays due. Finish a small part or mark what you did in Calendar.`)
    else {
      const pl = s.placement
      if (!pl || pl.state === 'ask') notes.push(pl?.ask ?? 'Which day should it go on? Say a weekday or “tomorrow”.')
      else {
        const slot = pl.timeLabel ? `${pl.dateLabel} at ${pl.timeLabel}–${endClock(pl.startMinutes!, t.minutes)}` : `${pl.dateLabel}, with no set time`
        proposals.push({
          kind: 'move_task', title: `Move “${t.title}” to ${pl.timeLabel ? `${pl.dateLabel}, ${pl.timeLabel}` : pl.dateLabel}`,
          reasoning: pl.timeLabel
            ? `Places “${t.title}” (${t.minutes} min) on ${slot}, ${pl.exact ? `the time you asked for, which is free in your Calendar${pl.windowed ? '' : ' but outside your saved study hours'}` : 'a time that is free in your Calendar and inside your saved study hours'}. Nothing else changes, it keeps its reading and history, and you can move it again from Calendar.`
            : `Places “${t.title}” on ${pl.dateLabel} with no set time, because ${pl.hasWindows ? `I found no free ${t.minutes}-minute slot inside your saved study hours` : 'you have no saved study hours'} that day. This does not claim a study period was found. You choose the time in Calendar. Nothing else changes.`,
          changes: { version: 3, move: { id: t.id, title: t.title, revision: t.revision, fromDate: t.date, toDate: pl.date, startsAt: pl.startsAt, startMinutes: pl.startMinutes, minutes: t.minutes, windowed: pl.windowed } },
        })
      }
    }
  }
  if (s.intent === 'log_class') notes.push(s.classChoices?.length === 1 ? `Open ${s.classChoices[0].label} on ${s.classChoices[0].date} and confirm what you covered there.`
    : 'Choose the class in Calendar and confirm what you covered. Your report records coverage separately from test evidence.')
  if (s.intent === 'log_learning') notes.push('Record independent study in your log with the reading and the day you did it. A log entry records activity; a paper is what shows whether it held.')
  if (s.intent === 'exam') notes.push('Your exam target and booked date are set on the exam page. A tentative window and a booked date are kept separate there.')

  if (s.intent === 'struggling' || s.intent === 'redo') {
    notes.push(s.repairFollowUp
      ? 'Open your follow-up to review existing repairs, what fits this week and when a re-check can run. Nothing is added until you confirm there.'
      : 'I cannot point to a current repair follow-up yet. Check your test results; a completed study block alone does not prove a weakness.')
  }
  if ((s.intent === 'today' || s.intent === 'next') && s.homeNext) notes.push(`Your top step right now, the same one Home shows, is “${s.homeNext.title}”. ${s.homeNext.rationale}`)
  if (s.intent === 'today') {
    notes.push(s.nextTask
      ? `Your next accepted task is “${s.nextTask.title}”${s.nextTask.date === s.today ? ' today' : ` on ${s.nextTask.date}`} (${s.nextTask.minutes} min). Open it to see what it covers and what done means.`
      : 'Nothing accepted is open today. Check Calendar for the week, or ask me what to focus on.')
  }
  if (s.intent === 'availability') notes.push('Change your availability in your setup, and you return here afterwards. PrepPlan then re-plans what is still ahead; work you already did stays as it is. I cannot change your hours for you.')
  if (s.intent === 'lighter') {
    notes.push(s.adaptation
      ? `${s.adaptation.headline}${s.adaptation.lighter ? ' You asked for a lighter draft.' : ''}${s.adaptation.waiting ? ` ${s.adaptation.waiting} reading${s.adaptation.waiting === 1 ? '' : 's'} wait for a later week and stay due.` : ''} This is a planning decision from your weekly review, not a judgement of what you understand.`
      : 'I cannot find a recorded weekly review that made this week lighter. If the week looks smaller, it may simply be what is left to plan; open Calendar to see it.')
  }
  if (s.intent === 'result') {
    notes.push(s.latestResult
      ? `${s.selectedResultOpen ? 'The result you opened says' : 'Your latest result says'}: ${s.latestResult.headline} Open it to see each finding and the repair or revision action it leads to.`
      : s.selectedResultUnavailable ? 'I could not open the result you selected: it is not a scored result of yours. I have not substituted another one; choose a result in Tests and ask again.'
      : 'You have no scored result yet, so there is nothing to act on. A paper from your completed work is what produces one.')
  }
  if (s.intent === 'slow') {
    const t = s.latestResult?.timing
    notes.push(t?.available
      ? `Timed practice is available: ${t.deliverable} fresh questions in about ${t.minutes} minutes on the reading where you were slow. It is practice only, so it does not change your understanding signal, your repairs or your weekly paper.`
      : `${t?.message ?? 'Timed practice is not available right now, because there are not enough fresh reviewed questions on that reading.'} Meanwhile practise the method against the clock with your own materials.`)
  }
  if (s.intent === 'mock') {
    const m = s.lastMock
    const mr = s.mockReport
    if (s.mockReportUnavailable) notes.push('I cannot open the mock report you chose. It may have been removed, or it is not yours to open. I have not substituted another report; open the one you meant from Calendar.')
    else if (mr?.selected && mr.status === 'withdrawn') notes.push(`You withdrew the mock report from ${mr.takenOn}${mr.provider ? ` (${mr.provider})` : ''}. Sittings already planned from it stay in your Calendar, but I cannot plan new work from it. Choose another report if you want to.`)
    else if (mr?.selected) notes.push(`You asked about your ${mr.takenOn}${mr.provider ? ` ${mr.provider}` : ''} mock report: ${mr.scope === 'partial' ? 'a partial exam' : 'a full mock'}, ${mr.scoreText}. That is your own report, not test evidence. I can help you decide how to work on the areas you chose (for example pacing or recall practice) but I do not teach the curriculum content. Nothing changes in your week until you review and confirm a plan on the report page.`)
    else if (mr) notes.push(`Your latest saved mock report is ${mr.scope === 'partial' ? 'a partial exam' : 'a mock'}${mr.provider ? ` from ${mr.provider}` : ''} on ${mr.takenOn}: ${mr.scoreText}. That is your own report, not test evidence; the report page shows what it does and does not tell us and lets you choose what to work on. Nothing changes in your week until you review and confirm a plan there.`)
    if (m) notes.push(`Your latest completed mock is “${m.title}” on ${m.date}${m.reportedResult ? `, recorded as “${m.reportedResult}”` : ', recorded without a score'}. That is your own report: it can inform how we plan, but it is not test evidence, it does not show which concepts were weak, and it closes no repair.`)
    if (!s.mockReportUnavailable && (!mr?.selected || s.checkpoint)) notes.push(s.checkpoint
      ? `${m ? 'Next, your' : 'Your'} ${s.checkpoint.title} is on ${s.checkpoint.date}.${s.checkpoint.choiceUnresolved ? ' You have not decided how it fits with this week’s paper; that choice is in Calendar.' : ''} Preparation is the revision and repair work already in your plan. Anything you report about a mock is your own report, not test evidence.${s.checkpoint.appointments && s.checkpoint.appointments > 1 ? ` You have ${s.checkpoint.appointments} mock appointments; this is the next one.` : ''}${s.checkpoint.rehearsal?.state === 'insufficient' ? ` A full PrepPlan rehearsal cannot be built yet: ${s.checkpoint.rehearsal.reasons[0] ?? 'there are not enough approved held-out questions'}` : ''}`
      : m ? 'No further mock is booked, and that is separate from the result you recorded. Add the next one in Calendar and PrepPlan plans around it.'
      : mr ? 'No further mock is booked, and that is separate from the report you saved.'
      : 'I cannot see a mock or checkpoint in your Calendar. If you have already taken one, record it with “Record a mock already taken” in Calendar; if one is coming up, add it there. What you tell me here is not saved as a result.')
  }
  return { proposals, notes }
}

/** Links carry no change; they simply take the student to the place the answer lives. */
export function planLinks(s: CoachSituation): CoachLink[] {
  const links: CoachLink[] = []
  if (s.examSat) return [{ label: 'Open the exam page', href: '/app/exam' }]
  if (s.preparation && s.intent === 'next') return [{ label: 'Update where you are in the syllabus', href: POSITION_EDITOR_HREF }, { label: 'See your revision plan', href: '/app/curriculum?view=readiness' }, { label: 'Open the week', href: '/app/calendar' }]
  const task = s.nextTask
  const taskLink = task ? { label: `Open “${task.title}”`, href: calendarTaskHref(task.id, task.date) } : null
  const homeLink = s.homeNext?.destination?.startsWith('/app') ? { label: `Open “${s.homeNext.title}”`, href: s.homeNext.destination } : null
  if (s.intent === 'today') { if (homeLink) links.push(homeLink); if (taskLink && taskLink.href !== homeLink?.href) links.push(taskLink); links.push({ label: 'Open the week', href: '/app/calendar' }); return links.slice(0, 3) }
  if (s.intent === 'availability') return [{ label: 'Change your availability', href: onboardingHref('week', '/app/coach') }, { label: 'See the week', href: '/app/calendar' }]
  if (s.intent === 'lighter') return [{ label: 'See the week', href: '/app/calendar' }, ...(s.closing ? [{ label: 'Review the week', href: '/app/review-week' }] : [])]
  if (s.intent === 'result' || s.intent === 'slow') {
    if (s.latestResult) links.push({ label: s.intent === 'slow' ? 'See the timing finding' : s.selectedResultOpen ? 'Open this result' : 'Open your latest result', href: s.intent === 'slow' ? `${s.latestResult.href}#findings-h` : s.latestResult.href })
    if (s.intent === 'result' && s.repairFollowUp) links.push(s.repairFollowUp)
    if (!s.latestResult) links.push({ label: 'Go to Tests', href: '/app/tests' })
    return links.slice(0, 3)
  }
  if (s.intent === 'mock') { if (s.mockReportUnavailable) { links.push({ label: 'See your mock reports', href: '/app/calendar' }); return links }; if (s.mockReport) links.push({ label: s.mockReport.selected ? 'Open this mock report' : 'Open your saved mock report', href: `/app/calendar/mock-report/${s.mockReport.id}` }); if (s.lastMock?.href) links.push({ label: 'Open your saved mock report', href: s.lastMock.href }); if (s.checkpoint && s.checkpoint.href !== s.lastMock?.href) links.push({ label: 'See your next mock in Calendar', href: s.checkpoint.href }); else if (!links.length && s.mockReport === undefined && s.lastMock) links.push({ label: 'Open Calendar', href: '/app/calendar' }); if (!s.mockReport && !s.lastMock) links.push({ label: 'Record a mock already taken', href: '/app/calendar/mock-report' }); if (!links.length) links.push({ label: 'Open Calendar', href: '/app/calendar' });
    const rh = s.checkpoint?.rehearsal
    if (rh?.state === 'resume' && rh.rehearsalId) links.push({ label: 'Open your rehearsal', href: `/app/tests/rehearsal/${rh.rehearsalId}` })
    else if (rh?.state === 'start') links.push({ label: 'Prepare your rehearsal', href: s.checkpoint!.href })
    else if (rh?.state === 'insufficient') links.push({ label: 'View assessment availability', href: '/app/tests#mock-h' }); const n = s.revision?.next[0]; if (n) links.push({ label: `Revision queue: “${n.name}”`, href: n.href }); return links.slice(0, 3) }
  if (s.intent === 'move_block') {
    if (s.selectedTask) return [{ label: `Open “${s.selectedTask.title}”`, href: calendarTaskHref(s.selectedTask.id, s.selectedTask.date) }]
    return (s.taskChoices ?? []).slice(0, 3).map(c => ({ label: `Move “${c.title}”`, href: `/app/coach?task=${c.id}&q=${encodeURIComponent('Move it')}` }))
  }
  if (s.intent === 'log_class') return s.classChoices?.length ? s.classChoices.map(c => ({
    label: `${c.sessionId ? 'Open' : 'Log'} ${c.label} on ${c.date}`, href: classLogHref({ sessionId: c.sessionId ?? undefined, occurrenceKey: c.key }),
  })) : [{ label: 'Log a class', href: '/app/calendar/log-class' }, { label: 'See the week', href: '/app/calendar' }]
  if (s.intent === 'log_learning') return [{ label: 'Record your study', href: '/app/log' }]
  if (s.intent === 'exam') return [{ label: 'Open the exam page', href: '/app/exam' }]
  if (s.intent === 'teach') { links.push(s.selectedReading ? { label: `Open ${s.selectedReading.title}`, href: s.selectedReading.href } : { label: 'Choose the reading in Curriculum', href: '/app/curriculum' }); if (taskLink) links.push(taskLink); return links.slice(0, 3) }
  if (s.selectedReading && ['next', 'free', 'struggling', 'redo', 'teach'].includes(s.intent)) links.push({ label: `Open ${s.selectedReading.title}`, href: s.selectedReading.href })
  if (s.closing) links.push({ label: 'Review the week', href: '/app/review-week' })
  if (s.repairFollowUp && ['struggling', 'redo', 'next', 'free'].includes(s.intent)) links.push(s.repairFollowUp)
  if (s.checkpoint && ['next', 'free', 'struggling'].includes(s.intent)) links.push({ label: 'See your mock in Calendar', href: s.checkpoint.href })
  const paper = assessmentAdvice(s)
  if (paper?.link) links.push(paper.link)
  const nextRevision = s.revision?.next[0]
  if (nextRevision && ['next', 'free'].includes(s.intent) && !s.repairs.length) links.push({ label: `See why “${nextRevision.name}” is queued`, href: nextRevision.href })
  const r = s.repairs[0]
  if (r && (s.intent === 'struggling' || s.intent === 'redo' || s.intent === 'next')) links.push({ label: `Open ${r.readingLabel}`, href: `/app/curriculum/${r.subjectId}/${r.readingId}` })
  if (s.intent === 'next' && homeLink) links.unshift(homeLink)
  if (s.intent === 'day_was_bad' || s.intent === 'next') links.push({ label: 'Open the week', href: '/app/calendar' })
  return links.slice(0, 3)
}

/**
 * A reply that needs no model. Used for the quick intents and as the fallback when generation is
 * unavailable. It states only what the evidence shows, and says so when it shows little.
 */
export function deterministicReply(s: CoachSituation, band: string, notes: string[], proposals: Proposal[]): string {
  if (s.examSat) return `You told us you sat the exam on ${s.examSat}, so I have paused study suggestions and changed nothing in your plan. If you would like a result noted or a retake plan, that is on the exam page.`
  const parts: string[] = []
  // A statement about where preparation stands is acknowledged FIRST, in its own words, before any planning content.
  if (s.preparation && notes[0]?.startsWith('Thanks, that helps me plan')) { parts.push(notes[0]); notes = notes.slice(1) }
  if (['today', 'availability', 'lighter', 'result', 'slow', 'mock', 'move_block', 'log_class', 'log_learning', 'exam'].includes(s.intent)) {
    // These answers come entirely from verified state: the notes carry them.
    if (s.intent === 'slow') parts.push('Right but slow is a speed question, not a gap in understanding.')
    for (const n of notes) parts.push(n)
    if (proposals.length) parts.push('I have suggested a change below. Nothing happens until you confirm it.')
    return parts.join(' ')
  }
  if (s.intent === 'teach') return TUTORING_BOUNDARY_REPLY + (s.nextTask ? ` A practical way to start: open “${s.nextTask.title}” and work through it from your own materials, then mark what you covered.` : ' A practical way to start: choose the reading in Curriculum, work through it from your own materials, then mark what you covered so a paper can test it.')
  if (s.intent === 'day_was_bad') {
    parts.push('A bad day is not a wrong answer, and it does not count against your understanding.')
  } else if (s.intent === 'struggling' || s.intent === 'redo') {
    const r = s.repairs[0]
    parts.push(r
      ? `The clearest weak point in your results is “${r.name}” (${r.readingLabel}). Re-read it from your own materials, then let a paper re-test it — a re-check is what tells us whether it held.`
      : 'Your results do not yet single out one weak outcome. A scored paper is what would show it.')
  } else {
    const adv = assessmentAdvice(s)
    parts.push(band === 'Insufficient evidence'
      ? (adv?.startable
        ? 'There is not enough scored evidence yet to say what is strong or weak, so the next useful step is the one that produces evidence: this week’s paper.'
        : `There is not enough scored evidence yet to say what is strong or weak. ${adv ? adv.note : 'No paper can be offered right now, so I will not send you to one.'} Keep to the study blocks in your plan.`)
      : `Your current evidence reads “${band}”. Work the repair outcomes first, then new material.${adv && !adv.startable && s.paper !== 'none' ? ` ${adv.note}` : ''}`)
  }
  if (s.checkpoint) parts.push(`Your ${s.checkpoint.title} is on ${s.checkpoint.date}.${s.checkpoint.choiceUnresolved ? ' You have not yet decided how it fits with your weekly paper; that choice is in Calendar.' : ''} Anything you report about a mock stays your own report, not test evidence.`)
  if (s.adaptation && (s.intent === 'next' || s.intent === 'free')) {
    parts.push(`This week’s size: ${s.adaptation.headline}${s.adaptation.lighter ? ' You asked for a lighter draft.' : ''}${s.adaptation.optionalMinutes ? ` About ${s.adaptation.optionalMinutes} minutes are optional extra.` : ''}${s.adaptation.waiting ? ` ${s.adaptation.waiting} reading${s.adaptation.waiting === 1 ? '' : 's'} wait for a later week and stay due.` : ''} This is a planning assumption, not a judgement of what you understand.`)
  }
  if (s.revision && s.revision.eligible > 0 && (s.intent === 'next' || s.intent === 'free')) {
    const n = s.revision.next[0]
    parts.push(`Revision: ${s.revision.inPlan} covered reading${s.revision.inPlan === 1 ? ' is' : 's are'} in this week’s plan${n ? `, and next in your rotation is “${n.name}” (${n.why.split(/(?<=\.)\s/)[0].replace(/\.$/, '')})` : ''}. Revising records activity, not understanding.`)
  }
  if (proposals.length) parts.push('I have suggested a change below. Nothing happens until you confirm it.')
  for (const n of notes) parts.push(n)
  if (s.selectedReading) parts.push(`You are asking about ${s.selectedReading.title}. Work through it from your own materials; what you note or tick there is your own record, not test evidence.`)
  return parts.join(' ')
}
