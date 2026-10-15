import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Map as MapIcon } from 'lucide-react'
import { createClient } from '../../lib/supabase/server'
import { getCurrentOperatingState } from '../../lib/state/operatingState'
import { getSignals } from '../../lib/signals/signals-loader'
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
import { ReadinessOverview } from '../../components/home/ReadinessOverview'
import { RoadmapStrip } from '../../components/home/RoadmapStrip'
import { LogLearningButton } from '../../components/log/LogLearningButton'

export const dynamic = 'force-dynamic'

const DAY = 86_400_000

function daysTo(date: string | null, now: Date) {
  if (!date) return null
  const d = Math.ceil((new Date(`${date}T00:00:00Z`).getTime() - now.getTime()) / DAY)
  return d < 0 ? null : d
}

function longDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)))
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
export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()
  const state = await getCurrentOperatingState(user.id)
  if (state.activation === 'not_onboarded') redirect('/onboarding')

  const [profileRes, signals, week, roadmapResult] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
    getSignals(user.id, now).catch(() => null as Signals | null),
    getStudyWeekContext(user.id, now).then(async ctx => ({ ctx, data: await loadCalendarWeek(user.id, ctx.week) })).catch(() => null),
    getActiveRoadmap(user.id).catch(() => null),
  ])
  const progress = roadmapResult
    ? await computeProgress(user.id, roadmapResult.roadmap, roadmapResult.input).catch(() => null)
    : null

  const name = firstName(profileRes.data?.display_name as string | null)
  const classLed = (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && !!state.identity.classPattern && state.identity.classPattern !== 'none'
  const today = week?.ctx.today ?? now.toISOString().slice(0, 10)
  const todayLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${today}T12:00:00Z`))

  // Exact booked date beats the indicative sitting; the indicative one says so.
  const exactDays = daysTo(state.identity.examDate, now)
  const indicativeDays = exactDays == null ? daysTo(state.identity.indicativeExamDate, now) : null
  const sitting = state.identity.examSitting
    ? `${state.identity.examSitting.sitting.replace(/^./, c => c.toUpperCase())} ${state.identity.examSitting.year}`
    : null

  // One list of decisions: the attention queue minus what "Up next" already covers, plus the
  // week-closure and paper-bank states the old page showed as separate panels.
  const nextDest = state.nextAction?.destination
  const items: AttentionItem[] = state.attention.filter(a => a.destination !== nextDest)
  if (state.cycle?.closureState === 'closure_ready' && state.nextAction?.code !== 'complete_closure') {
    items.push({ id: 'close-week', code: 'closure_ready', priority: 50, title: 'This week is ready to close', description: '', destination: '/app/review-week', actionLabel: 'Review the week' })
  }
  if (state.integrity.insufficientPaperBank) {
    items.push({ id: 'paper-bank', code: 'paper_bank', priority: 40, title: 'Not enough checked questions for this week’s paper', description: '', destination: '/app/tests', actionLabel: 'See what can be tested' })
  }

  const ready = state.activation === 'ready'
  const featuredId = state.nextAction && ['resume_task', 'start_timed_task', 'start_preferred_task', 'place_task'].includes(state.nextAction.code)
    ? state.nextAction.id : null

  return (
    <main className="page-content home">
      <header className="home-head">
        <div>
          <p className="home-head__date">{todayLabel}</p>
          <h1>Welcome back{name ? `, ${name}` : ''}.</h1>
        </div>
        <div className="home-head__side">
          {(exactDays != null || indicativeDays != null) && (
            <Link href="/app/settings" className="countdown" aria-label="Exam countdown — change in Settings">
              <strong>{Math.floor((exactDays ?? indicativeDays!) / 7)}</strong>
              <span>
                {exactDays != null ? 'weeks to your exam' : `weeks to the ${sitting ?? 'chosen'} sitting`}
                <small>{exactDays != null
                  ? `${exactDays} days · ${longDate(state.identity.examDate!)}`
                  : 'Indicative · add your booked date'}</small>
              </span>
            </Link>
          )}
          <LogLearningButton classLed={classLed} className="primary-button" />
        </div>
      </header>

      {state.integrity.partialServiceFailure.length > 0 && (
        <Notice tone="warn" role="status">Some information could not be loaded ({state.integrity.partialServiceFailure.join(', ')}). What is shown may be incomplete — refresh to retry.</Notice>
      )}

      <div className="home-grid">
        <div className="home-grid__main">
          {state.nextAction && <NextActionCard action={state.nextAction} />}
          {ready && <TodaySequence tasks={state.today.blocks} featuredId={featuredId} />}
        </div>
        <aside className="home-grid__side">
          {week && <WeekAtAGlance week={week.ctx.week} today={today} data={week.data} accepted={ready} />}
          <NeedsAttention items={items} threads={state.repairs.openThreads} />
        </aside>
      </div>

      {signals && <ReadinessOverview s={signals} />}

      {roadmapResult && progress ? (
        <RoadmapStrip status={roadmapResult.status} roadmap={roadmapResult.roadmap} progress={progress} />
      ) : (
        <section className="home-card road road--empty">
          <MapIcon size={20} aria-hidden />
          <div>
            <h2>Your roadmap isn’t built yet</h2>
            <p>It is built from your exam sitting and starting point.</p>
          </div>
          <Link href="/app/curriculum?view=roadmap" className="secondary-button">Build it</Link>
        </section>
      )}
    </main>
  )
}
