import Link from 'next/link'
import { createClient } from '../../../lib/supabase/server'
import { redirect } from 'next/navigation'
import { CoachClient } from '../../../components/coach/CoachClient'
import { loadHistory } from '../../../lib/coach/service'
import { getSignals } from '../../../lib/signals/signals-loader'

export const dynamic = 'force-dynamic'

export default async function CoachPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/app/coach')

  const [messages, signals] = await Promise.all([
    loadHistory(user.id).catch(() => []),
    getSignals(user.id).catch(() => null),
  ])

  return (
    <div className="coach-page page-content">
      <header className="page-header">
        <div>
          <h1>Coach</h1>
          <p>Strategy and misconception repair grounded in your real evidence.</p>
        </div>
      </header>

      <section className="section-block" aria-label="What the Coach can see">
        <p className="eyebrow">What I am working from</p>
        <p className="text-secondary">
          {signals
            ? <>Understanding: <strong>{signals.understanding.band}</strong> · {signals.execution.completed} blocks done, {signals.execution.unreported} unreported · {signals.position.tested} of {signals.position.total} outcomes tested.</>
            : 'Your evidence could not be loaded right now, so I will say so rather than guess.'}
          {' '}I see your plan and results, never answer keys. <Link href="/app/curriculum" className="text-button">Curriculum</Link> · <Link href="/app/tests" className="text-button">Tests</Link> · <Link href="/app/calendar" className="text-button">Calendar</Link>
        </p>
      </section>

      <CoachClient initialDraft={(q ?? '').slice(0, 300)} initialMessages={messages} />
    </div>
  )
}
