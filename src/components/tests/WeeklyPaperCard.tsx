import Link from 'next/link'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import type { WeeklyPaperState } from '../../lib/tests/testsOverview'
import { StartButton } from './StartButton'

/** The current Calendar-linked paper, with the button that matches its real state. */
export function WeeklyPaperCard({ preview, state, readingName }: { preview: PaperPreview; state: WeeklyPaperState; readingName: Map<string, string> }) {
  const { blueprint } = preview
  const p = state.primary
  const names = (ids: string[]) => ids.map(i => readingName.get(i) ?? i)
  return (
    <section className="weekly-card" aria-labelledby="weekly-h">
      <div>
        <p className="eyebrow">This week&apos;s paper</p>
        <h2 id="weekly-h">{state.paperLabel}</h2>
        {state.planned?.date && <p className="muted">Scheduled on your <Link href="/app/calendar">Calendar</Link> for {state.planned.date}. It closes your study week.</p>}
        {p.kind === 'start' || p.kind === 'confirm_scope' ? (
          <p>{blueprint.totalQuestions} questions · about {blueprint.estimatedMinutes} minutes · at most {blueprint.policy.ceiling}. You can pause and resume; paused time is not counted.</p>
        ) : null}
      </div>

      {state.planned && (state.planned.notCompleted.length > 0 || state.planned.addedSincePlanned.length > 0) && (
        <div className="note" role="status">
          <strong>What changed since this paper was planned</strong>
          {state.planned.notCompleted.length > 0 && <p>Planned but not completed, so not tested: {names(state.planned.notCompleted).join('; ')}. Calendar carries it forward.</p>}
          {state.planned.addedSincePlanned.length > 0 && <p>Completed since, so now included: {names(state.planned.addedSincePlanned).join('; ')}.</p>}
        </div>
      )}

      <div className="weekly-card__actions">
        {p.kind === 'no_scope' && <p role="status">{p.reason}</p>}
        {p.kind === 'confirm_scope' && (<><p role="status">{p.unresolved} completed block{p.unresolved === 1 ? '' : 's'} need you to confirm what they covered before they can be tested.</p><a className="secondary-button" href="#scope-h">Review scope</a></>)}
        {p.kind === 'start' && (
          <>
            <a className="secondary-button" href="#scope-h">Review scope</a>
            <StartButton label="Start weekly paper" disabled={Boolean(p.blocked)} body={{ kind: 'weekly', paperKind: preview.paperKind, expectedRevision: preview.scope.revision }} />
            {p.blocked && <p role="alert" className="notice notice--warn">{p.blocked}</p>}
          </>
        )}
        {p.kind === 'resume' && <Link className="primary-button" href={`/app/tests/${p.attemptId}`}>Resume weekly paper</Link>}
        {p.kind === 'result' && (
          <>
            <Link className="secondary-button" href={`/app/tests/${p.attemptId}/result`}>See result</Link>
            <Link className="primary-button" href={p.closureUrl}>Complete weekly closure</Link>
          </>
        )}
      </div>
    </section>
  )
}
