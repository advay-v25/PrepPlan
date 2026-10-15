import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ChevronLeft, ChevronRight, Info } from 'lucide-react'
import { createClient } from '../../../lib/supabase/server'
import { getStudyWeekContext } from '../../../lib/planning/schedule'
import { loadCalendarWeek } from '../../../lib/planning/calendarData'
import {
  WEEKDAY_NAMES, addDays, formatWeekRange, todayInZone, type Weekday,
} from '../../../lib/planning/studyWeek'
import { resolvePulseWeek } from '../../../lib/planning/pulse/weekBoundary'
import { ActivationPrompt } from '../../../components/calendar/ActivationPrompt'
import { getClassLogContext } from '../../../lib/planning/classlog/service'
import { getPaperPreview } from '../../../lib/tests/paperPreview'
import { getWeeklyPaperState } from '../../../lib/tests/testsOverview'
import { getSignals } from '../../../lib/signals/signals-loader'
import { PaperStrip } from '../../../components/calendar/PaperStrip'
import { CommitmentQuickAdd } from '../../../components/calendar/CommitmentQuickAdd'
import { CalendarWeekGrid } from '../../../components/calendar/CalendarWeekGrid'
import { computeProgress, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'
import { Notice } from '../../../components/ui/Notice'
import { findCalendarTask } from '../../../lib/routing/calendar'

export const dynamic = 'force-dynamic'

/**
 * The calendar.
 *
 * A time grid over the student's own study cycle (class-driven, or Monday-Saturday study with the weekly paper on Sunday for self-study) — which ends on
 * the day they chose to review and be tested, not on an arbitrary Sunday. The
 * weekly paper is scheduled on that last day, so it is visible
 * days ahead rather than arriving as a surprise.
 */
/** Only show the paper strip once the week has planned work (otherwise Calendar leads with activation). */
function needsActivationEarly(calendar: { entries: { isTask: boolean }[] }) {
  return !calendar.entries.some(e => e.isTask)
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; view?: string; action?: string; task?: string }>
}) {
  const { week: weekParam, view, action, task } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/calendar')

  const { data: profileRow } = await supabase.from('profiles').select('class_pattern').eq('id', user.id).maybeSingle()
  const classPattern = (profileRow?.class_pattern as string | null) ?? null

  const base = await getStudyWeekContext(user.id)
  // ?week=YYYY-MM-DD navigates to the study week containing that date.
  // Resolved through the same pulse-week rule as everything else (class-led
  // cycles follow the class pattern; self-study is Monday-Saturday study with
  // the paper on Sunday, which closes the seven-day cycle), never the legacy
  // fixed-anchor resolver.
  let week = base.week
  // A task link into the current cycle must retain its next-class boundary.
  // Re-resolving the same date from recurring weekdays alone loses a variable
  // candidate's already-resolved next-class anchor.
  if (weekParam && !(weekParam >= base.week.startDate && weekParam <= base.week.endDate)) {
    const { data: classRows } = await supabase.from('calendar_commitments')
      .select('weekdays').eq('user_id', user.id).eq('kind', 'class').eq('status', 'active')
    const classWeekdays = (classRows ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[])
    week = resolvePulseWeek({ classWeekdays, timezone: base.timezone, reference: weekParam })
  }

  const ctx = { ...base, week }
  const isCurrentWeek = week.startDate === base.week.startDate

  const today = todayInZone(base.timezone)

  // Render is a pure read: nothing on this page creates plans, drafts or tasks.
  const calendar = await loadCalendarWeek(user.id, week)
  const classLog = isCurrentWeek ? await getClassLogContext(user.id) : null
  const paperPreview = isCurrentWeek && !needsActivationEarly(calendar) ? await getPaperPreview(user.id) : null
  const paperState = paperPreview ? await getWeeklyPaperState(user.id, paperPreview) : null
  const signals = paperPreview ? await getSignals(user.id) : null

  // Only the near-term milestone reaches the week. The rest of the roadmap
  // stays in Curriculum: a nine-month plan pushed into a seven-day grid is how
  // a schedule becomes brittle.
  const active = await getActiveRoadmap(user.id)


  const progress = active ? await computeProgress(user.id, active.roadmap) : null

  // Sending a student who has finished setup back through onboarding is how
  // /onboarding ended up meaning four different things.
  const { data: onboardingProfile } = await supabase
    .from('profiles').select('onboarding_status').eq('id', user.id).maybeSingle()
  const onboardingDone = onboardingProfile?.onboarding_status === 'complete'

  const prevWeek = addDays(week.startDate, -7)
  const nextWeek = addDays(week.startDate, 7)

  const hasAnything = calendar.entries.length > 0
  const hasPlannedWork = calendar.entries.some(e => e.isTask)
  const needsActivation = isCurrentWeek && !hasPlannedWork

  // The week at a glance: the same entries the grid renders, counted. Only completed is done.
  const tasks = calendar.entries.filter(e => e.isTask)
  const done = tasks.filter(e => e.execution === 'completed').length
  const plannedMinutes = tasks.reduce((sum, e) => sum + (e.durationMinutes ?? 0), 0)
  const donePct = tasks.length ? Math.round((done / tasks.length) * 100) : 0
  const paperDate = tasks.find(e => e.taskType === 'diagnostic')?.localDate ?? week.endDate
  const milestone = progress?.currentMilestone ?? null
  const weekNo = progress ? Math.min(progress.weeksElapsed + 1, progress.totalWeeks) : null
  const classLogLink = classLog?.classLed && classLog.cycle && classLog.classDates.length > 0
    ? { href: '/app/calendar/log-class', label: classLog.pendingDates.length > 0 ? `Log class (${classLog.pendingDates.length})` : 'Log a class' }
    : null

  return (
    <div className="page-content calendar-page">
      <header className="cal-head">
        <div className="cal-head__title">
          <h1>Calendar</h1>
          <p className="cal-head__meta">
            {active?.status === 'active' && weekNo != null && isCurrentWeek && <><span>Week {weekNo} of {progress!.totalWeeks}</span><span aria-hidden>·</span></>}
            <span>{hasPlannedWork ? 'Paper on' : 'Weekly checkpoint'} {shortDay(paperDate)}</span>
          </p>
        </div>
        <div className="cal-head__actions">
          {classLogLink && <Link href={classLogLink.href} className="secondary-button">{classLogLink.label}</Link>}
          <nav className="cal-nav" aria-label="Week">
            <Link href={`/app/calendar?week=${prevWeek}`} className="cal-nav__step" aria-label="Previous week"><ChevronLeft size={18} aria-hidden /></Link>
            <span className="cal-nav__range">{formatWeekRange(week)}</span>
            <Link href={`/app/calendar?week=${nextWeek}`} className="cal-nav__step" aria-label="Next week"><ChevronRight size={18} aria-hidden /></Link>
          </nav>
          {!isCurrentWeek && <Link href="/app/calendar" className="secondary-button">This week</Link>}
        </div>
      </header>

      {needsActivation && <ActivationPrompt />}

      {task && !findCalendarTask(calendar.entries, task) && (
        <Notice tone="warn" role="status">
          That task is not available in this week’s calendar. It may have moved or belong to an older plan.
          {' '}<Link href="/app/calendar" className="prose-link">Open your current week</Link>.
        </Notice>
      )}

      {hasAnything && (
        <section className="cal-summary" aria-label="This week">
          <div className="cal-summary__cell">
            <p className="cal-summary__label">{milestone ? active?.status === 'draft' ? 'Proposed focus' : 'This week draws from' : 'Roadmap'}</p>
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
            <p className="cal-summary__label">Planned this week</p>
            <p className="cal-summary__title">
              {done} <small>of {tasks.length} session{tasks.length === 1 ? '' : 's'} done</small>
            </p>
            <div className="cal-summary__bar" role="img" aria-label={`${done} of ${tasks.length} sessions done`}><span style={{ width: `${donePct}%` }} /></div>
            <p className="cal-summary__fine">{hoursLabel(plannedMinutes)} planned</p>
          </div>

          <div className="cal-summary__cell cal-summary__cell--paper">
            {paperPreview && paperState && signals ? (
              <PaperStrip preview={paperPreview} state={paperState} signals={signals} />
            ) : (
              <>
                <p className="cal-summary__label">This week&apos;s paper</p>
                <p className="cal-summary__title">{shortDay(paperDate)}</p>
                <p className="cal-summary__fine">Set from the work you complete this week.</p>
              </>
            )}
          </div>
        </section>
      )}

      {!hasAnything ? (
        <div className="calendar-empty">
          <span className="calendar-empty__icon"><CalendarDays size={26} aria-hidden /></span>
          <h2>Nothing scheduled this week yet</h2>
          <p>
            Your week runs {formatWeekRange(week)} and ends on {WEEKDAY_NAMES[ctx.anchorDay]}.{' '}
            {onboardingDone
              ? 'Prepare a draft to see study blocks around your classes and commitments.'
              : 'Finish your setup so Roadmap can propose work around your classes and commitments.'}
          </p>
          <div className="calendar-empty__actions">
            <CommitmentQuickAdd defaultDate={today >= week.startDate && today <= week.endDate ? today : week.startDate} />
            <Link href={onboardingDone ? '/app/settings' : '/onboarding'} className="secondary-button">
              {onboardingDone ? 'Adjust my setup' : 'Set up my week'}
            </Link>
          </div>
        </div>
      ) : (
        <CalendarWeekGrid
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
        />
      )}

      <footer className="cal-foot">
        {isCurrentWeek && hasPlannedWork && (
          <Link href="/app/review-week" className="text-button">Review this week and prepare the next &rarr;</Link>
        )}
        <p>
          <Info size={13} aria-hidden />
          <span>Timed sessions sit inside windows you confirmed. Work under &ldquo;Any time&rdquo; has a day but no hour — Roadmap won&apos;t invent one.</span>
        </p>
      </footer>
    </div>
  )
}

function shortDay(date: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
}

function hoursLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60), m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
