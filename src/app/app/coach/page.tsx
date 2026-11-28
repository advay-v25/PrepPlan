import { Suspense } from 'react'
import { PageLoading } from '../../../components/ui/PageLoading'
import Link from 'next/link'
import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'
import { SelectedObjectCard } from '../../../components/coach/SelectedObjectCard'
import { loadSelectedObject, parseSelection } from '../../../lib/coach/selection'
import { CoachClient } from '../../../components/coach/CoachClient'
import { loadHistory } from '../../../lib/coach/service'
import { getCheckpointView, getLatestMockReport } from '../../../lib/planning/checkpointService'
import { checkpointTitle } from '../../../lib/curriculum/mockCheckpoint'
import { getSignals } from '../../../lib/signals/signals-loader'

export const metadata = { title: 'Coach' }

export const dynamic = 'force-dynamic'

type CoachProps = { searchParams: Promise<{ q?: string; proposal?: string; repair?: string; attempt?: string; task?: string; reading?: string; report?: string }> }

export default function CoachPage(props: CoachProps) {
  return <Suspense fallback={<PageLoading message="Loading Coach…" />}><CoachContent {...props} /></Suspense>
}

async function CoachContent({ searchParams }: CoachProps) {
  const { q, proposal, repair, attempt, task, reading, report } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/coach')

  const selection = parseSelection({ proposal, repair, attempt, task, reading, report })
  const [messages, signals, checkpoint, selected, lastMock] = await Promise.all([
    loadHistory(user.id).catch(() => null),   // null = unavailable, shown as such; never a blank first conversation
    getSignals(user.id).catch(() => null),
    getCheckpointView(user.id).catch(() => null),
    loadSelectedObject(user.id, selection).catch(() => null),
    getLatestMockReport(user.id).catch(() => null),
  ])

  return (
    <div className="coach-page page-content">
      <header className="page-header">
        <div>
          <h1>Coach</h1>
          <p>Strategy and repair, based on your evidence.</p>
        </div>
      </header>

      {selected && <SelectedObjectCard object={selected} />}

      <section className="section-block" aria-label="What the Coach can see">
        <p className="eyebrow">What I am working from</p>
        <p className="text-secondary">
          {signals
            ? <>{signals.execution.completed} blocks done, {signals.execution.unreported} unreported · {signals.position.tested} of {signals.position.total} outcomes with eligible test observations · {signals.position.whole} whole outcome{signals.position.whole === 1 ? '' : 's'} confirmed{signals.position.partial ? `, ${signals.position.partial} partly covered` : ''}.</>
            : 'Your evidence could not be loaded right now, so I will say so rather than guess.'}
          {checkpoint && <> Your {checkpointTitle(checkpoint.checkpoint)} is on {checkpoint.checkpoint.date} (<Link href={checkpoint.href} className="text-button">view or change it in Calendar</Link>).</>}
          {lastMock && <span data-testid="coach-last-mock"> Your latest completed mock, {lastMock.title} on {lastMock.takenOn}{lastMock.reportedResult ? <>, is recorded as “{lastMock.reportedResult}” (your own report, not test evidence)</> : ' is recorded without a score'}{lastMock.href && <> (<Link href={lastMock.href} className="text-button">open the saved report</Link>)</>}.</span>}
          {' '}I see your plan and results, never answer keys. <Link href="/app/curriculum" className="text-button">Curriculum</Link> · <Link href="/app/tests" className="text-button">Tests</Link> · <Link href="/app/calendar" className="text-button">Calendar</Link>
        </p>
      </section>

      {messages === null && <p role="alert" className="text-secondary">Your earlier conversation could not be loaded right now. It is not lost. <Link href="/app/coach" className="text-button">Reload</Link> to try again.</p>}
      <CoachClient key={`${selected?.kind ?? 'none'}:${selected && 'id' in selected ? selected.id : ''}:${q ?? ''}`} attemptId={selected?.kind === 'attempt' ? selected.id : selected?.kind === 'unavailable' && selected.what === 'attempt' ? selection.attempt ?? undefined /* the unavailable id is still the student's selection: the server says so, and never substitutes the latest result */ : selected?.kind === 'repair' ? selected.attemptId ?? undefined : undefined} taskId={selected?.kind === 'task' ? selected.id : undefined} readingId={selected?.kind === 'reading' ? selected.id : undefined} reportId={selected?.kind === 'report' ? selected.id : selected?.kind === 'unavailable' && selected.what === 'report' ? selection.report ?? undefined /* the unavailable id is still the student's selection: the server says so and never substitutes the latest report */ : undefined} initialDraft={(q ?? '').slice(0, 300)} initialMessages={messages ?? []} historyUnavailable={messages === null} />
    </div>
  )
}
