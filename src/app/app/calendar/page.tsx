import { formatStudyDate, preferredDateLocale } from '../../../lib/format/date'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { PageLoading } from '../../../components/ui/PageLoading'
import { AdaptationLine } from '../../../components/review/AdaptationLine'
import { getCurrentAdaptation } from '../../../lib/planning/weeklyReview/adaptationRecord'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, Info } from 'lucide-react'
import { CalendarNavigation } from '../../../components/calendar/CalendarNavigation'
import { createClient } from '../../../lib/supabase/server'
import { getCheckpointView, listAppointments, relatedNeedingReview, type AppointmentSummary } from '../../../lib/planning/checkpointService'
import { loadExamStatus } from '../../../lib/exam/status'
import { checkpointTitle, describeTiming } from '../../../lib/curriculum/mockCheckpoint'
import { CheckpointPanel } from '../../../components/calendar/CheckpointPanel'
import { MockReportsStrip } from '../../../components/calendar/MockReportsStrip'
import { listReports, listUnstructuredOutcomes } from '../../../lib/mocks/reportService'
import { recoveryRemainder } from '../../../lib/mocks/recovery'
import { ASSESSMENT_STAGE_LABEL, stageFromWeeklyPrimary } from '../../../lib/tests/assessmentStage'
import { SectionFailed } from '../../../components/home/SectionFailed'
import type { CurrentWeekPlanState } from '../../../lib/planning/currentWeek/state'
import { EmptyWeekPlan } from '../../../components/calendar/EmptyWeekPlan'
import { getCurrentWeekPlanState } from '../../../lib/planning/currentWeek/service'
import { cycleAcceptedBy } from '../../../lib/planning/cycleProvenance'
import { onboardingHref } from '../../../lib/routing/registry'
import { getStudyWeekContext, weekForDate } from '../../../lib/planning/schedule'
import { PeriodAppointments } from '../../../components/calendar/PeriodAppointments'
import { loadCalendarWeek } from '../../../lib/planning/calendarData'
import {
  WEEKDAY_NAMES, addDays, formatWeekRange, parseLocalDate, todayInZone, type Weekday,
} from '../../../lib/planning/studyWeek'
import { ActivationPrompt } from '../../../components/calendar/ActivationPrompt'
import { getClassLogContext, listSavedClassLogs, savedClassSessionForOccurrence } from '../../../lib/planning/classlog/service'
import { LogLearningButton } from '../../../components/log/LogLearningButton'
import { getPaperPreview } from '../../../lib/tests/paperPreview'
import { getWeeklyPaperState } from '../../../lib/tests/testsOverview'
import { getSignals } from '../../../lib/signals/signals-loader'
import { PaperStrip } from '../../../components/calendar/PaperStrip'
import { CommitmentQuickAdd } from '../../../components/calendar/CommitmentQuickAdd'
import { CalendarWeekGrid } from '../../../components/calendar/CalendarWeekGrid'
import { computeProgress, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'
import { Notice } from '../../../components/ui/Notice'
import { findCalendarTask } from '../../../lib/routing/calendar'
import { getTaskLineage } from '../../../lib/planning/taskLineageService'
import { CalendarExport } from '../../../components/calendar/CalendarExport'
import { HistoricalTask } from '../../../components/calendar/HistoricalTask'
import { ReviewSummary } from '../../../components/review/ReviewSummary'
import { ClassOccurrenceDialog } from '../../../components/calendar/ClassOccurrenceDialog'
import { getOccurrenceSelection, listCancelledClasses } from '../../../lib/planning/classOccurrence'
import { calendarClassHref, calendarClassSelectionHref, calendarReviewHref, classLogHref } from '../../../lib/routing/calendar'
import { ClassRecoveryPanel } from '../../../components/calendar/ClassRecoveryPanel'
import { listOwedClassWork } from '../../../lib/planning/classlog/carry'
import { countRecoveryOverlaps, getClassChange, latestClassChangeKey } from '../../../lib/planning/classRecovery'

export const metadata = { title: 'Calendar' }
export const dynamic = 'force-dynamic'

/**
 * The calendar.
 *
 * A time grid over the student's own study cycle (class-driven, or Monday-Saturday study with the weekly paper on Sunday for self-study) — which ends on
 * the day they chose to review and be tested, not on an arbitrary Sunday. The
 * weekly paper is scheduled on that last day, so it is visible
 * days ahead rather than arriving as a surprise.
 */
type CalendarProps = {
  searchParams: Promise<{ week?: string; view?: string; action?: string; task?: string; reviewed?: string; appointment?: string; plan?: string; change?: string; commitment?: string; occurrence?: string }>
}

export default function CalendarPage(props: CalendarProps) {
  return <Suspense fallback={<PageLoading message="Loading your week…" />}><CalendarContent {...props} /></Suspense>
}

async function CalendarContent({ searchParams }: CalendarProps) {
  const { week: rawWeek, view, action, task, reviewed, appointment, plan, change, commitment, occurrence } = await searchParams
  const locale = preferredDateLocale((await headers()).get('accept-language'))
  // A malformed or impossible date opens the current week with a notice, never an error page.
  const weekParam = parseLocalDate(rawWeek) ?? undefined
  const badWeek = rawWeek !== undefined && rawWeek !== '' && !weekParam
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/calendar')

  const [{ data: profileRow }, base] = await Promise.all([
    supabase.from('profiles').select('class_pattern,onboarding_status').eq('id', user.id).maybeSingle(),
    getStudyWeekContext(user.id),
  ])
  const classPattern = (profileRow?.class_pattern as string | null) ?? null
  const onboardingDone = profileRow?.onboarding_status === 'complete'
  // ?week=YYYY-MM-DD navigates to the study week containing that date.
  // Resolved through the same pulse-week rule as everything else (class-led
  // cycles follow the class pattern; self-study is Monday-Saturday study with
  // the paper on Sunday, which closes the seven-day cycle), never the legacy
  // fixed-anchor resolver.
  let week = base.week
  // A task link into the current cycle must retain its next-class boundary.
  // Re-resolving the same date from recurring weekdays alone loses a variable
  // candidate's already-resolved next-class anchor.
  if (weekParam && !(weekParam >= base.week.startDate && weekParam <= base.week.endDate)) week = await weekForDate(user.id, weekParam)

  const ctx = { ...base, week }
  const isCurrentWeek = week.startDate === base.week.startDate

  const today = todayInZone(base.timezone)
  // The viewed period decides what the page offers: a past week reads as history (its work, minutes and assessments as recorded, no
  // current actions), a week beyond the current cycle is a forecast (nothing accepted, no current scope), the current week keeps its actions.
  const isHistory = !isCurrentWeek && week.endDate < today
  const isFuture = !isCurrentWeek && !isHistory && week.startDate > base.week.endDate

  // Render is a pure read: nothing on this page creates plans, drafts or tasks.
  let calendar: Awaited<ReturnType<typeof loadCalendarWeek>>
  try { calendar = await loadCalendarWeek(user.id, week) } catch {
    return <main className="page-content"><h1>Your week</h1><SectionFailed what="Your calendar" /></main>
  }
  const failedReads: string[] = []
  async function optionalRead<T>(promise: Promise<T>, label: string, fallback: T): Promise<T> {
    try { return await promise } catch { failedReads.push(label); return fallback }
  }
  const wantedAppointment = appointment && /^[0-9a-f-]{36}$/i.test(appointment) ? appointment : null
  const hasAnything = calendar.entries.length > 0
  const hasPlannedWork = calendar.entries.some(e => e.isTask)
  const historicalAppointments: Promise<AppointmentSummary[]> | AppointmentSummary[] = isHistory
    ? optionalRead<AppointmentSummary[]>(listAppointments(user.id), 'The mocks recorded for this period', [])
    : []
  // The exam, assessments and class timetable can load independently once the period is known.
  const [examStatusForBanner, appointments, checkpointView, reportsR, classLog, paperPreview, active] = await Promise.all([
    optionalRead(loadExamStatus(user.id), 'Your exam status', null),
    historicalAppointments,
    isHistory ? null : optionalRead(getCheckpointView(user.id, new Date(), wantedAppointment), 'Your mock schedule', null),
    // A failed read stays distinct from an empty report list.
    isHistory ? null : listReports(user.id).then(reports => ({ reports }), () => null),
    isCurrentWeek ? getClassLogContext(user.id) : null,
    isCurrentWeek && hasPlannedWork ? getPaperPreview(user.id) : null,
    getActiveRoadmap(user.id),
  ])
  const periodAppointments = appointments.filter(a => a.date >= week.startDate && a.date <= week.endDate)
  let recoveryReadFailed = false
  const [checkpointReview, waitingR, unstructuredR, paperState, signals, progress, { data: activeCycle }] = await Promise.all([
    checkpointView || isHistory ? [] : optionalRead(relatedNeedingReview(user.id), 'Mock preparation needing review', []),
    reportsR ? Promise.all(reportsR.reports.filter(r => r.planSelection).map(async r => {
      try { const left = await recoveryRemainder(user.id, r); return { reportId: r.id, minutes: left.reduce((n, x) => n + x.minutes - x.allocated, 0), needsReview: left.some(x => x.status === 'needs_review') } }
      catch { recoveryReadFailed = true; return { reportId: r.id, minutes: 0, needsReview: false } }
    })).then(w => w.filter(x => x.minutes > 0 || x.needsReview)) : [],
    reportsR ? optionalRead(listUnstructuredOutcomes(user.id), 'Unstructured mock follow-up', []) : [],
    paperPreview ? getWeeklyPaperState(user.id, paperPreview) : null,
    paperPreview ? getSignals(user.id).catch(() => null) : null,
    active ? computeProgress(user.id, active.roadmap, active.input) : null,
    isCurrentWeek && !hasPlannedWork
      ? supabase.from('planning_cycles').select('id').eq('user_id', user.id).eq('status', 'active').eq('starts_at_local', week.startDate).maybeSingle()
      : { data: null },
  ])
  const prevWeek = addDays(week.startDate, -7)
  const nextWeek = addDays(week.startDate, 7)

  // A week accepted in the weekly review is the student's own plan, even when it is empty (a planned
  // break, or no availability). Only a week nobody has accepted needs first-week activation.
  const acceptedEmptyWeek = activeCycle ? (await cycleAcceptedBy(user.id, activeCycle.id as string)) !== null : false
  const needsActivation = isCurrentWeek && !hasPlannedWork && !acceptedEmptyWeek
  // An accepted week with nothing in it: the explanation and the one next step (add study times, or review a plan for it).
  let weekPlan: CurrentWeekPlanState | null = null
  let weekPlanFailed = false
  if (isCurrentWeek && !needsActivation) {
    try { weekPlan = await getCurrentWeekPlanState(user.id) } catch { weekPlanFailed = true }
  }

  // An old link to a task from another week (for example one that was continued) opens that earlier record,
  // read-only, instead of failing. It is looked up by id, scoped to this learner, and never changes anything.
  const linkedHere = task ? findCalendarTask(calendar.entries, task) : null
  const historical = task && !linkedHere ? await optionalRead(getTaskLineage(user.id, task), 'This task’s history', null) : null
  const adaptation = isCurrentWeek ? await optionalRead(getCurrentAdaptation(user.id), 'Your latest weekly review', null) : null
  // A class occurrence is named by its series and ORIGINAL date. The server validates both; an unknown, foreign or no-longer-applicable link opens nothing else.
  const classSelection = commitment || occurrence ? await optionalRead(getOccurrenceSelection(user.id, commitment, occurrence), 'This class occurrence', null) : null
  const classLinkUnavailable = Boolean(commitment || occurrence) && !classSelection
  const savedClassLogs = isHistory || classSelection || (classLog?.classLed && classLog.sessions.length > 0)
    ? await optionalRead(listSavedClassLogs(user.id, week.days[0], week.days[week.days.length - 1]), 'Recorded class logs', []) : []
  const selectedClassKey = classSelection ? `series:${classSelection.commitmentId}:${classSelection.occurrence}` : null
  const loggableClass = classLog?.classLed ? classLog.occurrences.find(o => o.key === selectedClassKey && o.status !== 'legacy') : undefined
  const savedClassId = loggableClass?.sessionId ?? savedClassLogs.find(log => log.key === selectedClassKey)?.id
    ?? (selectedClassKey && !loggableClass ? await optionalRead(savedClassSessionForOccurrence(user.id, selectedClassKey), 'This class report', null) : null)
  const selectedLogHref = savedClassId ? classLogHref({ sessionId: savedClassId })
    : loggableClass ? classLogHref({ occurrenceKey: loggableClass.key }) : undefined
  // `plan=review&change=<operation key>` opens the reviewed adjustment for THAT saved class change; the server confirms it is this student's own
  // class-change receipt. Without `change`, `plan=review` keeps its original meaning (the empty-week plan).
  const reviewChange = plan === 'review' && change && !isHistory ? await optionalRead(getClassChange(user.id, change), 'This class-change receipt', null) : null
  const reviewUnavailable = plan === 'review' && Boolean(change) && !reviewChange
  const reviewLabel = reviewChange ? ((await supabase.from('calendar_commitments').select('label').eq('id', String(reviewChange.receipt?.successorId ?? reviewChange.receipt?.commitmentId)).maybeSingle()).data?.label as string | undefined) ?? 'your class' : 'your class'
  // Something still overlaps protected time after a class change: it stays discoverable until the student decides, whatever they did with the dialog.
  const overlapCount = isCurrentWeek && !reviewChange ? await optionalRead(countRecoveryOverlaps(user.id), 'Study work affected by class changes', 0) : 0
  const owedClassWork = isCurrentWeek ? await optionalRead(listOwedClassWork(user.id), 'Your waiting class work', []) : []
  const overlapChange = overlapCount > 0 ? await optionalRead(latestClassChangeKey(user.id), 'The latest class change', null) : null
  const cancelledClasses = isHistory ? [] : await optionalRead(listCancelledClasses(user.id, week.days), 'Cancelled classes', [])
  const classCloseHref = (() => { const q = new URLSearchParams(); if (rawWeek) q.set('week', rawWeek); if (view) q.set('view', view); return calendarClassSelectionHref(q.toString(), null) })()
  // After saving a review: what was saved, from the review's own record.
  const savedReview = reviewed && isCurrentWeek
    ? (await supabase.from('weekly_reviews').select('recap').eq('user_id', user.id).order('closed_at', { ascending: false }).limit(1).maybeSingle()).data
    : null

  // The week at a glance: the same entries the grid renders, counted. Only completed is done.
  const logged = calendar.entries.filter(e => e.isLoggedLearning)
  const tasks = calendar.entries.filter(e => e.isTask && !e.isLoggedLearning)
  const done = tasks.filter(e => e.execution === 'completed').length
  const plannedMinutes = tasks.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0)
  const donePct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  const scheduledTopics = [...new Set(tasks.filter(e => e.taskType !== 'diagnostic').map(e => e.conceptName).filter((n): n is string => !!n))]
  const assessmentStage = paperState ? stageFromWeeklyPrimary(paperState.primary) : tasks.some(e => e.taskType === 'diagnostic') ? 'scheduled_paper' as const : 'weekly_checkpoint' as const
  const paperDate = tasks.find(e => e.taskType === 'diagnostic')?.localDate ?? week.endDate
  const milestone = progress?.currentMilestone ?? null
  const weekNo = progress ? Math.min(progress.weeksElapsed + 1, progress.totalWeeks) : null
  const classLogLink = classLog?.classLed && classLog.cycle && classLog.classDates.length > 0
    ? { href: '/app/calendar/log-class', label: classLog.occurrences.some(o => o.status === 'pending') ? `Log class (${classLog.occurrences.filter(o => o.status === 'pending').length})` : 'Log a class' }
    : null

  return (
    <main className="page-content calendar-page">
      <header className="cal-head">
        <div className="cal-head__title">
          <h1>Calendar</h1>
          <p className="cal-head__meta">
            {active?.status === 'active' && weekNo != null && isCurrentWeek && <><span>Week {weekNo} of {progress!.totalWeeks}</span><span aria-hidden>·</span></>}
            {isHistory ? <span>Past week</span> : isFuture ? <span>Forecast</span> : <span>{ASSESSMENT_STAGE_LABEL[assessmentStage]} · {shortDay(paperDate)}</span>}
          </p>
        </div>
        <div className="cal-head__actions">
          <LogLearningButton classLed={Boolean(classLog?.classLed)} />
          {classLogLink && <Link prefetch={false} href={classLogLink.href} className="secondary-button">{classLogLink.label}</Link>}
          <CalendarNavigation previous={prevWeek} next={nextWeek} today={today} range={formatWeekRange(week, locale)} current={isCurrentWeek} />
        </div>
      </header>

      {failedReads.map(label => <SectionFailed key={label} what={label} />)}

      {needsActivation && <ActivationPrompt />}
      {weekPlanFailed && <SectionFailed what="Your current-week planning status" />}
      {weekPlan && <EmptyWeekPlan ownerId={user.id} state={weekPlan} autoOpen={plan === 'review' && !change} />}
      {badWeek && <Notice tone="info" role="status"><span data-bad-week>That date link was not valid, so this is the current week.</span></Notice>}
      {examStatusForBanner?.phase === 'sat' &&<Notice tone="info" role="status"><span data-exam-sat>You told us you sat the exam on {examStatusForBanner.satOn}, so study prompts are paused. Your plan stays here as history.</span> <Link href="/app/exam" className="prose-link">Optional follow-up</Link></Notice>}
      {examStatusForBanner?.phase === 'awaiting_status' && <Notice tone="warn" role="status"><span data-exam-ask>{examStatusForBanner.note}</span> <Link href="/app/exam" className="prose-link">Tell us what happened</Link></Notice>}
      {isHistory && <Notice tone="info" role="status"><span data-history-week>This is a past week, shown as it was recorded. {tasks.length > 0 ? `${done} of ${tasks.length} planned session${tasks.length === 1 ? '' : 's'} were completed.` : 'Nothing planned was recorded for it.'}{' '}<Link href="/app/calendar" className="prose-link">Open this week</Link></span></Notice>}
      {isFuture && <Notice tone="info" role="status"><span data-future-week>Forecast: this week is ahead of your current plan, so no study work is accepted for it yet. You can arrange classes, commitments and mocks here. Your weekly review prepares the study work when the current week closes. <Link href="/app/calendar" className="prose-link">Open your current week</Link>.</span></Notice>}
      {wantedAppointment && !checkpointView && !periodAppointments.some(a => a.id === wantedAppointment) && (
        <Notice tone="warn" role="status"><span data-appointment-unavailable>That mock or checkpoint is not available here. It may be finished, cancelled, or not yours. <Link href="/app/calendar#checkpoint" className="prose-link">See your schedule</Link>.</span></Notice>
      )}
      {isHistory && <PeriodAppointments appointments={periodAppointments} />}
      {savedClassLogs.length > 0 && <details className="cal-week-details">
        <summary>Recorded classes · {savedClassLogs.length}</summary>
        <ul>{savedClassLogs.map(log => <li key={log.id}><Link prefetch={false} href={classLogHref({ sessionId: log.id })}>{log.label} on {log.date}</Link> · {log.finished ? 'Log finished' : 'Saved and still open'}</li>)}</ul>
      </details>}

      {isCurrentWeek && <AdaptationLine record={adaptation} />}
      {savedReview && <ReviewSummary summary={(savedReview.recap as { summary?: Parameters<typeof ReviewSummary>[0]['summary'] } | null)?.summary ?? null} />}
      {historical && <HistoricalTask lineage={historical} />}
      {reviewChange && <ClassRecoveryPanel key={reviewChange.key} changeKey={reviewChange.key} label={reviewLabel} timezone={base.timezone} ownerId={user.id} closeHref={classCloseHref} />}
      {reviewUnavailable && <Notice tone="warn" role="status"><span data-recovery-unavailable>That class change was not found, so nothing is being reviewed. <Link href="/app/calendar" className="prose-link">Open your current week</Link>.</span></Notice>}
      {owedClassWork.length > 0 && (
        <Notice tone="warn" role="status">
          <span data-testid="calendar-owed-class-work"><strong>{owedClassWork.reduce((n, o) => n + o.remainingMinutes, 0)} min of class follow-up has no slot yet:</strong>{' '}
            {owedClassWork.map((o, i) => <span key={`${o.sessionId}:${o.outcomeId}`}>{i > 0 ? '; ' : ''}{o.title}, <Link href={classLogHref({ sessionId: o.sessionId })}>{o.classLabel ?? 'saved class'} on {o.classDate}</Link>{o.classOriginalDate && o.classOriginalDate !== o.classDate ? ` (moved from ${o.classOriginalDate})` : ''} ({o.remainingMinutes} min left of {o.plannedMinutes})</span>)}. </span>
          <Link href="/app/review-week" className="prose-link">Review the week</Link> or <Link href="/app/calendar/log-class" className="prose-link">log your next class</Link>; either proposes a place for it, and nothing is added until you accept.
        </Notice>
      )}
      {overlapChange && <Notice tone="warn" role="status"><span data-recovery-pending>{overlapCount} study task{overlapCount === 1 ? '' : 's'} now overlap{overlapCount === 1 ? 's' : ''} a class or booked time. </span><Link href={calendarReviewHref(overlapChange)} className="prose-link" data-testid="review-overlaps">Review changes to my week</Link></Notice>}
      {classLinkUnavailable && (
        <Notice tone="warn" role="status"><span data-class-unavailable>That class session is not available. It may have been changed, finished, or not be yours. <Link href="/app/calendar" className="prose-link">Open your current week</Link>.</span></Notice>
      )}
      {classSelection && <ClassOccurrenceDialog key={`${classSelection.commitmentId}@${classSelection.occurrence}`} selection={classSelection} closeHref={classCloseHref} logHref={selectedLogHref} saved={Boolean(savedClassId)} />}
      {cancelledClasses.length > 0 && (
        <Notice tone="info" role="status"><span data-cancelled-classes>Cancelled this week: {cancelledClasses.map((c, i) => <span key={`${c.commitmentId}${c.occurrence}`}>{i > 0 ? ', ' : ''}<Link href={calendarClassHref(c.commitmentId, c.occurrence, week.startDate)} className="prose-link">{c.label} on {shortDay(c.occurrence)}</Link></span>)}. Open one to restore it.</span></Notice>
      )}
      {task && !linkedHere && !historical && (
        <Notice tone="warn" role="status">
          That task is not available in this week’s calendar. It may have moved or belong to an older plan.
          {' '}<Link href="/app/calendar" className="prose-link">Open your current week</Link>.
        </Notice>
      )}

      {hasAnything && (
        <details className="cal-week-context" data-week-context>
          <summary>{isHistory ? 'Recorded week details' : 'Week details'} · {done} of {tasks.length} sessions done</summary>
        <section className="cal-summary" aria-label={isHistory ? 'That week' : 'This week'}>
          <div className="cal-summary__cell">
            <p className="cal-summary__label">{milestone ? active?.status === 'draft' ? 'Roadmap milestone (draft)' : 'Roadmap milestone' : 'Roadmap'}</p>
            {milestone ? (
              <>
                <p className="cal-summary__title">{milestone.topicName}</p>
                <p className="cal-summary__fine">
                  {milestone.startWeek === milestone.endWeek ? `Week ${milestone.startWeek}` : `Weeks ${milestone.startWeek}–${milestone.endWeek}`} of your roadmap
                  {active?.status === 'active' && progress && progress.verdict !== 'not_started' ? ` · ${progress.message.split('.')[0]}` : ''}
                  {active?.status === 'draft' ? ' · Draft, not yet accepted' : ''}
                </p>
              </>
            ) : (
              <>
                <p className="cal-summary__title">Not built yet</p>
                <p className="cal-summary__fine"><Link href="/app/curriculum?view=roadmap" className="prose-link">Build your roadmap</Link> to see what each week covers.</p>
              </>
            )}
          </div>

          <div className="cal-summary__cell">
            <p className="cal-summary__label">{isHistory ? 'Planned that week' : 'Planned this week'}</p>
            <p className="cal-summary__title">
              {done} <small>of {tasks.length} session{tasks.length === 1 ? '' : 's'} done</small>
            </p>
            <div className="cal-summary__bar" role="img" aria-label={`${done} of ${tasks.length} sessions done`}><span style={{ width: `${donePct}%` }} /></div>
            <p className="cal-summary__fine">{hoursLabel(plannedMinutes)} planned</p>
            {tasks.length > 0 && <details className="cal-summary__fine" data-placement-summary>
              <summary>How the work is spread</summary>
              <ul>{week.days.filter(d => tasks.some(t => t.localDate === d)).map(d => <li key={d}>{d}: {tasks.filter(t => t.localDate === d).reduce((n,t) => n+t.durationMinutes,0)} min planned</li>)}</ul>
              <p>{tasks.filter(t => t.kind === 'day').length} sittings have a day but no reserved clock time. Open a sitting to move it or choose a start time; its recorded order still applies. These are estimates, not a weekly hours target.</p>
              {!isHistory && <Link className="prose-link" href="/onboarding/week?returnTo=%2Fapp%2Fcalendar">Change study times or sitting length</Link>}
            </details>}
            {scheduledTopics.length > 0 && <p className="cal-summary__fine">Scheduled: {scheduledTopics.slice(0, 3).join(', ')}{scheduledTopics.length > 3 ? ` and ${scheduledTopics.length - 3} more` : ''}</p>}
            {logged.length > 0 && <p className="cal-summary__fine">{logged.length} extra sitting{logged.length === 1 ? '' : 's'} logged · {logged.some(e=>e.recordedMinutes!=null) ? `${logged.reduce((n,e) => n + (e.recordedMinutes ?? 0),0)} min reported${logged.some(e=>e.recordedMinutes==null) ? ' · some time unknown' : ''}` : 'time not reported'}</p>}
          </div>

          <div className="cal-summary__cell cal-summary__cell--paper">
            {isHistory ? (
              <>
                <p className="cal-summary__label">Assessment that week</p>
                {(() => {
                  const paper = tasks.find(e => e.taskType === 'diagnostic')
                  return paper
                    ? <p className="cal-summary__fine">{paper.execution === 'completed' ? 'Paper completed' : paper.execution === 'skipped' ? 'Paper skipped' : 'Paper not completed'}{paper.attemptId && <> · <Link href={`/app/tests/${paper.attemptId}/result`} className="prose-link">See the result</Link></>}</p>
                    : <p className="cal-summary__fine">No weekly paper was recorded for it. Any mock is listed above.</p>
                })()}
              </>
            ) : paperPreview && paperState ? (
              <PaperStrip preview={paperPreview} state={paperState} signals={signals} />   /* signals === null is a FAILED read: the strip says so and offers a retry */
            ) : (
              <>
                <p className="cal-summary__label">This week&apos;s paper</p>
                <p className="cal-summary__title">{shortDay(paperDate)}</p>
                <p className="cal-summary__fine">Set from the work you complete this week.</p>
              </>
            )}
          </div>
        </section>
        </details>
      )}

      {!hasAnything ? (
        <div className="calendar-empty">
          <span className="calendar-empty__icon"><CalendarDays size={26} aria-hidden /></span>
          <h2>{isHistory ? 'Nothing was recorded for this week' : isFuture ? 'Nothing is planned for this week yet' : 'Nothing scheduled this week yet'}</h2>
          <p>
            Your week runs {formatWeekRange(week, locale)} and ends on {WEEKDAY_NAMES[ctx.anchorDay]}.{' '}
            {onboardingDone
              ? weekPlan?.kind === 'awaiting_class_input' ? 'Your classes guide the study order. Use the next step above to organise the follow-up work.' : weekPlan?.kind === 'intentionally_empty' ? 'You can add commitments or review a plan whenever you are ready.' : 'Use the next step above to prepare study blocks around your classes and commitments.'
              : 'Finish your setup so PrepPlan can propose work around your classes and commitments.'}
          </p>
          {!isHistory && <div className="calendar-empty__actions">
            <CommitmentQuickAdd openNextClass={action === 'add-next-class'} defaultDate={today >= week.startDate && today <= week.endDate ? today : week.startDate} />
            <Link href={onboardingDone ? '/app/settings' : '/onboarding'} className="secondary-button">
              {onboardingDone ? 'Adjust my setup' : 'Set up my week'}
            </Link>
          </div>}
        </div>
      ) : (
        <CalendarWeekGrid
        readOnly={isHistory}
        allowTaskCreation={!isFuture}
          days={week.days}
          timezone={ctx.timezone}
          today={today}
          anchorDay={ctx.anchorDay}
          byDate={calendar.byDate}
          floating={calendar.floating}
          earliestMinute={calendar.earliestMinute}
          latestMinute={calendar.latestMinute}
          defaultView={view === 'agenda' ? 'agenda' : view === 'week' ? 'week' : undefined}
          classPattern={classPattern}
          openNextClass={action === 'add-next-class'}
          paperDate={paperDate}
          checkpoint={checkpointView ? { date: checkpointView.checkpoint.date, title: checkpointTitle(checkpointView.checkpoint), when: describeTiming(checkpointView.checkpoint) } : null}
        />
      )}

      {/* Mock administration follows the week itself: this week's study work comes first. */}
      {!isHistory && <CheckpointPanel view={checkpointView} review={checkpointReview} today={today}
        defaultDate={today >= week.startDate && today <= week.endDate ? today : week.startDate} />}
      {!isHistory && <MockReportsStrip reports={reportsR?.reports ?? []} waiting={waitingR} unstructured={unstructuredR} failed={!reportsR || recoveryReadFailed} />}

      <footer className="cal-foot">
        {isCurrentWeek && hasPlannedWork && (
          <Link href="/app/review-week" className="text-button">Review this week and prepare the next &rarr;</Link>
        )}
        <p>
          <Info size={13} aria-hidden />
          <span>Timed sessions sit inside windows you confirmed. Work under &ldquo;Any time&rdquo; has a day but no hour — PrepPlan won&apos;t invent one.</span>
        </p>
      </footer>
      <details className="cal-export"><summary>Download this schedule (.ics)</summary><CalendarExport key={week.startDate} initialFrom={week.startDate} initialTo={week.endDate} /></details>
    </main>
  )
}

function shortDay(date: string) {
  return formatStudyDate(date, 'short')
}

function hoursLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
