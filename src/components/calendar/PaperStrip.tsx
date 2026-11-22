import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { PAPER_UNAVAILABLE_BANK } from '../../lib/tests/assessmentStage'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import type { WeeklyPaperState } from '../../lib/tests/testsOverview'
import type { Signals } from '../../lib/signals/signals'

function shortDay(date: string) {
  return formatStudyDate(date, 'short')
}

/** Calendar's view of the paper: what it will test, what was left out, and where to act. */
/** `signals === null` means the progress read FAILED (not zero, not unrequested): the strip says so and offers a retry; the paper facts below do not depend on it. */
export function PaperStrip({ preview, state, signals, retryHref = '' }: { preview: PaperPreview; state: WeeklyPaperState; signals: Signals | null; retryHref?: string }) {
  const p = state.primary
  const ex = signals?.execution
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
    postponed > 0 && `${postponed} postponed block${postponed === 1 ? ' is' : 's are'} left out. Decide what continues at weekly review.`,
    missed > 0 && `${missed} missed or unmarked block${missed === 1 ? ' is' : 's are'} left out too.`,
    ex?.pressure === 'high' && 'Some planned work needs a decision at weekly review.',
  ].filter(Boolean).join(' ')

  return (
    <section className="paper-strip" aria-labelledby="paper-strip-h">
      <h2 id="paper-strip-h" className="cal-summary__label">This week&apos;s paper</h2>
      {p.kind === 'no_scope' ? (
        <>
          <p className="cal-summary__title">{state.planned?.date ? shortDay(state.planned.date) : 'Not set yet'}</p>
          <p className="cal-summary__fine">{p.reason}</p>
        </>
      ) : p.kind === 'confirm_scope' ? (
        <>
          <p className="cal-summary__title">Confirm test scope</p>
          <p className="cal-summary__fine">Some work is recorded, but its covered outcomes need confirmation before a paper can be built.</p>
        </>
      ) : p.kind === 'result' || p.kind === 'resume' ? (
        <>
          <p className="cal-summary__title">{p.kind === 'result' ? 'Paper scored' : 'Paper in progress'}</p>
          <p className="cal-summary__fine">{state.paperLabel}. Its questions and scope stay as they were when you started.</p>
        </>
      ) : (
        <>
          <p className="cal-summary__title">
            {p.deliverable} <small>questions{state.planned?.date ? ` · ${shortDay(state.planned.date)}` : ''}</small>
          </p>
          <p className="cal-summary__fine">
            {state.paperLabel} from {preview.scope.totals.outcomes} completed outcome{preview.scope.totals.outcomes === 1 ? '' : 's'}. Only work marked done is tested.
            {p.blocked ? <> {PAPER_UNAVAILABLE_BANK} <Link className="prose-link" href="/app/tests">View assessment availability</Link></> : ''}
          </p>
        </>
      )}
      {!signals && <p className="cal-summary__fine is-warn" role="status" data-testid="calendar-signals-unavailable">This week’s progress counts could not be loaded just now, so they are not shown rather than guessed. The calendar itself is unaffected. <a className="prose-link" href={retryHref}>Try again</a></p>}
      {left && <p className="cal-summary__fine is-warn">{left}</p>}
      {p.kind === 'confirm_scope' && <p className="cal-summary__fine" role="status">{p.unresolved} finished or partly finished block{p.unresolved === 1 ? ' needs' : 's need'} the outcomes {p.unresolved === 1 ? 'it' : 'they'} covered.</p>}
      {action && <div className="paper-strip__actions">{action}</div>}
    </section>
  )
}
