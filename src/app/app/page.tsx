import { formatStudyDate, preferredDateLocale } from '../../lib/format/date'
import { headers } from 'next/headers'
import { Suspense } from 'react'
import { PageLoading } from '../../components/ui/PageLoading'
import { AdaptationLine } from '../../components/review/AdaptationLine'
import { getCurrentAdaptation } from '../../lib/planning/weeklyReview/adaptationRecord'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CheckCircle2, MessageCircle, Map as MapIcon } from 'lucide-react'
import { createClient } from '../../lib/supabase/server'
import { getCurrentOperatingState } from '../../lib/state/operatingState'
import { getSignals } from '../../lib/signals/signals-loader'
import { weekVsMilestone } from '../../lib/curriculum/weekMilestone'
import type { Signals } from '../../lib/signals/signals'
import type { AttentionItem } from '../../lib/state/types'
import { getStudyWeekContext } from '../../lib/planning/schedule'
import { loadCalendarWeek } from '../../lib/planning/calendarData'
import { getActiveRoadmap, computeProgress } from '../../lib/curriculum/roadmapService'
import { Notice } from '../../components/ui/Notice'
import { NextActionCard } from '../../components/home/NextActionCard'
import { TodaySequence } from '../../components/home/TodaySequence'
import { WeekAtAGlance } from '../../components/home/WeekAtAGlance'
import { NeedsAttention } from '../../components/home/NeedsAttention'
import { RoadmapStrip } from '../../components/home/RoadmapStrip'
import { getCheckpointView } from '../../lib/planning/checkpointService'
import { loadExamStatus } from '../../lib/exam/status'
import { loadFinalStretch } from '../../lib/exam/finalStretchService'
import { FinalStretchView } from '../../components/exam/FinalStretchView'
import { ProgressSummary } from '../../components/home/ProgressSummary'
import { SectionFailed } from '../../components/home/SectionFailed'
import { DueCardsLine } from '../../components/home/DueCardsLine'
import { PAPER_UNAVAILABLE_BANK } from '../../lib/tests/assessmentStage'
import { ATTENTION_FOR_ACTION } from '../../lib/state/attentionReducer'
import { checkpointTitle, describeTiming } from '../../lib/curriculum/mockCheckpoint'
import { LogLearningButton } from '../../components/log/LogLearningButton'
import { daysBetween } from '../../lib/planning/studyWeek'

export const metadata = { title: 'Home' }

export const dynamic = 'force-dynamic'

function daysTo(date: string | null, today: string) {
  if (!date) return null
  const d = daysBetween(today, date)
  return d < 0 ? null : d
}

function firstName(displayName: string | null | undefined) {
  const word = (displayName ?? '').trim().split(/\s+/)[0]?.split('+')[0] ?? ''
  if (!word || word.includes('@')) return null
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * Home answers three things in a few seconds: what to do now, what is left this week, and where
 * the student stands. It reads; it never writes. Every number here comes from the same loaders the
 * owning pages use (operating state, signals, loadCalendarWeek, getActiveRoadmap + computeProgress).
 */
/** Runs a loader and keeps "it failed" apart from "there is nothing": a failed read must never render as an empty state. */
async function settle<T>(p: Promise<T>): Promise<{ value: T | null; failed: boolean }> {
  try { return { value: await p, failed: false } } catch { return { value: null, failed: true } }
}

const rangeLabel = (a: string, b: string) => { const f = (d: string) => formatStudyDate(d, 'dayMonth'); return `${f(a)}–${f(b)}` }
const shortDate = (d: string) => formatStudyDate(d, 'short')

/**
 * Home answers four questions in a few seconds: what to do next, what remains today, what needs a decision, and how preparation is
 * progressing. It reads; it never writes. Everything comes from the operating state and the loaders the owning pages use.
 */
export default function HomePage() {
  return <Suspense fallback={<PageLoading message="Loading your workspace…" />}><HomeContent /></Suspense>
}

async function HomeContent() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()
  const state = await getCurrentOperatingState(user.id)
  if (state.activation === 'not_onboarded') redirect('/onboarding')

  const [profileRes, signalsR, weekR, roadmapR, checkpointR, examR] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    settle(getSignals(user.id, now)),
    settle(getStudyWeekContext(user.id, now).then(async ctx => ({ ctx, data: await loadCalendarWeek(user.id, ctx.week) }))),
    settle(getActiveRoadmap(user.id)),
    settle(getCheckpointView(user.id, now)),
    settle(loadExamStatus(user.id, now)),
  ])
  const signals = signalsR.value, week = weekR.value, roadmapResult = roadmapR.value, checkpoint = checkpointR.value, examStatus = examR.value
  const sat = examStatus?.phase === 'sat'
  const stretchR = examStatus && !sat ? await settle(loadFinalStretch(user.id, examStatus)) : { value: null, failed: false }
  const progressR = roadmapResult ? await settle(computeProgress(user.id, roadmapResult.roadmap, roadmapResult.input)) : { value: null, failed: false }
  const stretch = stretchR.value, progress = progressR.value

  const adaptation = await getCurrentAdaptation(user.id).catch(() => null)
  const name = firstName(profileRes.data?.display_name as string | null)
  const classLed = (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && !!state.identity.classPattern && state.identity.classPattern !== 'none'
  const today = state.today.dateLocal
  const locale = preferredDateLocale((await headers()).get('accept-language'))
  const todayLabel = formatStudyDate(today, 'long', locale)

  // Exact booked date beats the indicative sitting; the indicative one says so. Once the exam is sat there is no countdown.
  const exactDays = sat ? null : daysTo(state.identity.examDate, today)
  const indicativeDays = sat || exactDays != null ? null : daysTo(state.identity.indicativeExamDate, today)
  const sitting = state.identity.examSitting ? `${state.identity.examSitting.sitting.replace(/^./, c => c.toUpperCase())} ${state.identity.examSitting.year}` : null

  // Decisions: the deduplicated queue minus the decision "Up next" already is, by identity (never by URL), at most three.
  const covered = state.nextAction ? ATTENTION_FOR_ACTION[state.nextAction.code] : null
  const decisions: AttentionItem[] = state.attention.filter(a => a.code !== covered)

  const hasDecisions = decisions.length > 0 || state.repairs.openThreads.length > 0
  const ready = state.activation === 'ready'
  const featuredId = state.nextAction && ['resume_task', 'start_timed_task', 'start_preferred_task'].includes(state.nextAction.code) ? state.nextAction.id : null

  // The next checkpoint: the student's mock if there is one (named for its own assessment week), otherwise the week's assessment.
  const a = state.assessment
  const next = checkpoint
    ? { label: `${checkpointTitle(checkpoint.checkpoint)} · ${shortDate(checkpoint.checkpoint.date)}`, detail: `${describeTiming(checkpoint.checkpoint)}. Counts toward the week of ${rangeLabel(checkpoint.week.startDate, checkpoint.week.endDate)}.`, href: checkpoint.href }
    : a && a.dueDate && !sat ? { label: `Weekly ${a.state === 'none' ? 'checkpoint' : 'paper'} · due ${shortDate(a.dueDate)}`, detail: ({ none: 'Set from the work you complete this week.', confirm_scope: a.message ?? 'Confirm what you covered first.', upcoming: 'Available now; tests only work you have confirmed.', ready: 'Ready to take.', running: 'In progress.', unavailable: `${PAPER_UNAVAILABLE_BANK} Tests shows what can be assessed.`, scored: 'Scored. See the result.' } as const)[a.state], href: a.state === 'scored' || a.state === 'running' ? a.destination : '/app/tests' } : null

  return (
    <main className="page-content home">
      <header className="home-head">
        <div>
          <p className="home-head__date">{todayLabel}</p>
          <h1>Welcome back{name ? `, ${name}` : ''}.</h1>
        </div>
        <div className="home-head__side">
          {!examR.failed && (exactDays != null || indicativeDays != null) && (
            <Link href="/app/exam" className="countdown" aria-label="Exam countdown. Open your exam details">
              <strong>{Math.floor((exactDays ?? indicativeDays!) / 7)}</strong>
              <span>
                {exactDays != null ? 'weeks to your exam' : `weeks to the ${sitting ?? 'chosen'} sitting`}
                <small>{exactDays != null ? `${exactDays} days · ${formatStudyDate(state.identity.examDate!, 'date', locale)}` : 'Target month, no booked date yet'}</small>
              </span>
            </Link>
          )}
          {!sat && !examR.failed && !hasDecisions && <span className="all-clear-chip" role="status" title="Nothing needs your decision"><CheckCircle2 size={15} aria-hidden /> All clear</span>}
          <Link href="/app/coach" className="secondary-button"><MessageCircle size={16} aria-hidden /> Ask Coach</Link>
          <LogLearningButton classLed={classLed} className="primary-button" />
        </div>
      </header>

      {state.integrity.partialServiceFailure.length > 0 && <SectionFailed what={`Some of your information (${state.integrity.partialServiceFailure.join(', ')})`} />}

      {sat && (
        <section className="home-card" aria-labelledby="sat-h" data-exam-sat>
          <h2 id="sat-h">You sat the exam{examStatus?.satOn ? ` on ${shortDate(examStatus.satOn)}` : ''}</h2>
          <p>Study prompts are paused and your history is kept. Nothing here is planned for you now.</p>
          <ul className="attention__list">
            <li><Link className="attention__row" href="/app/exam"><span className="attention__text"><strong>Optional follow-up</strong><span>Tell us how it went, or plan a retake</span></span></Link></li>
            <li><Link className="attention__row" href="/app/calendar"><span className="attention__text"><strong>Your history</strong><span>Every week, session and note you recorded</span></span></Link></li>
            <li><Link className="attention__row" href="/app/tests"><span className="attention__text"><strong>Your results</strong><span>Papers you took and what they showed</span></span></Link></li>
          </ul>
        </section>
      )}
      {examStatus?.phase === 'awaiting_status' && (
        <Notice tone="warn" role="status"><span data-exam-ask>{examStatus.note} </span><Link href="/app/exam" className="prose-link">Tell us what happened</Link></Notice>
      )}

      {examR.failed && <SectionFailed what="Your exam status" />}
      {!sat && !examR.failed && (
        <>
          {hasDecisions && <div className="hb-decide"><NeedsAttention items={decisions} threads={state.repairs.openThreads} /></div>}
          <div className="home-board">
            <div className="hb hb-next">
              {state.nextAction && <NextActionCard action={state.nextAction} />}
              {stretch && (
                <details className="home-fold" open>
                  <summary>Final stretch: what matters most now</summary>
                  <section className="home-card" aria-label="Final stretch"><FinalStretchView plan={stretch} /><p><Link href="/app/exam" className="prose-link">Exam details</Link></p></section>
                </details>
              )}
              {stretchR.failed && <SectionFailed what="The final-stretch plan" />}
            </div>
            <div className="hb hb-today">{ready && state.work ? <TodaySequence work={state.work} featuredId={featuredId} today={today} timezone={state.timezone} /> : <section className="home-card today"><h2>Today</h2><p className="home-card__empty">Your plan is not accepted yet, so nothing is placed for today.</p></section>}</div>
            <div className="hb hb-week">{weekR.failed ? <SectionFailed what="This week’s agenda" /> : week && <WeekAtAGlance week={week.ctx.week} today={today} data={week.data} accepted={ready} />}</div>
            <div className="hb hb-road">
              {roadmapR.failed || progressR.failed ? <SectionFailed what="Your roadmap" /> : roadmapResult && progress ? (
                <RoadmapStrip status={roadmapResult.status} roadmap={roadmapResult.roadmap} progress={progress} weekNote={ready && week ? weekVsMilestone(progress.currentMilestone, week.data.entries, id => roadmapResult.roadmap.milestones.find(m => m.topicId === id)?.topicName ?? null) : null} />
              ) : (
                <section className="home-card road road--empty">
                  <MapIcon size={20} aria-hidden />
                  <div><h2>Your roadmap isn’t built yet</h2><p>It is built from your exam sitting and starting point.</p></div>
                  <Link href="/app/curriculum?view=roadmap" className="secondary-button">Build it</Link>
                </section>
              )}
            </div>
            <div className="hb hb-stand">{signalsR.failed ? <SectionFailed what="Your progress summary" /> : signals && <ProgressSummary s={signals} today={today} timezone={state.timezone} checkpoint={next} />}</div>
          </div>
          <div className="hb-lines">
            <DueCardsLine />
            {signals?.movement[0] && <p className="muted"><strong>Recent</strong> · {signals.movement[0].text}</p>}
            <AdaptationLine record={adaptation} />
          </div>
        </>
      )}
      {sat && (signalsR.failed ? <SectionFailed what="Your progress summary" /> : signals && <ProgressSummary s={signals} today={today} timezone={state.timezone} checkpoint={null} />)}
    </main>
  )
}
