import Link from 'next/link'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import type { WeeklyPaperState } from '../../lib/tests/testsOverview'
import type { Signals } from '../../lib/signals/signals'

function shortDay(date: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
}

/** Calendar's view of the paper: what it will test, what was left out, and where to act. */
export function PaperStrip({ preview, state, signals }: { preview: PaperPreview; state: WeeklyPaperState; signals: Signals }) {
  const p = state.primary
  const ex = signals.execution
  const excluded = preview.scope.excluded
  const postponed = excluded.filter(e => e.reason === 'postponed').length
  const missed = excluded.filter(e => e.reason === 'missed' || e.reason === 'not_completed').length
  const action =
    p.kind === 'resume' ? <Link className="primary-button is-sm" href={`/app/tests/${p.attemptId}`}>Resume the paper</Link>
    : p.kind === 'result' ? <><Link className="secondary-button is-sm" href={`/app/tests/${p.attemptId}/result`}>See result</Link><Link className="primary-button is-sm" href={p.closureUrl}>Complete weekly closure</Link></>
    : p.kind === 'start' ? <Link className="primary-button is-sm" href="/app/tests">Go to the paper</Link>
    : p.kind === 'confirm_scope' ? <Link className="secondary-button is-sm" href="/app/tests#scope-h">Confirm what you covered</Link>
    : null
  const left = [
    postponed > 0 && `${postponed} postponed block${postponed === 1 ? ' is' : 's are'} left out and carried to next week.`,
    missed > 0 && `${missed} missed or unmarked block${missed === 1 ? ' is' : 's are'} left out too.`,
    ex.pressure === 'high' && 'A lot has slipped — the weekly review will offer choices.',
  ].filter(Boolean).join(' ')

  return (
    <section className="paper-strip" aria-labelledby="paper-strip-h">
      <h2 id="paper-strip-h" className="cal-summary__label">This week&apos;s paper</h2>
      {p.kind === 'no_scope' ? (
        <>
          <p className="cal-summary__title">{state.planned?.date ? shortDay(state.planned.date) : 'Not set yet'}</p>
          <p className="cal-summary__fine">Nothing completed yet to test. Finish a session or log learning and it builds itself.</p>
        </>
      ) : (
        <>
          <p className="cal-summary__title">
            {preview.blueprint.totalQuestions} <small>questions{state.planned?.date ? ` · ${shortDay(state.planned.date)}` : ''}</small>
          </p>
          <p className="cal-summary__fine">
            {state.paperLabel} from {preview.scope.totals.outcomes} completed outcome{preview.scope.totals.outcomes === 1 ? '' : 's'}. Only work marked done is tested.
          </p>
        </>
      )}
      {left && <p className="cal-summary__fine is-warn">{left}</p>}
      {p.kind === 'confirm_scope' && <p className="cal-summary__fine" role="status">{p.unresolved} completed block{p.unresolved === 1 ? '' : 's'} need the outcomes they covered before they can be tested.</p>}
      {action && <div className="paper-strip__actions">{action}</div>}
    </section>
  )
}
