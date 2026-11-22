import Link from 'next/link'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import type { WeeklyPaperState } from '../../lib/tests/testsOverview'
import { PreflightStart } from './PreflightStart'
import { LogLearningButton } from '../log/LogLearningButton'

export type CardResult = { score: number | null; policy: string | null; answered: number | null; delivered: number | null } | null

/**
 * The ONE primary card on the Week view. It shows the single justified next action for the student's paper and nothing else;
 * scope, pending work and plan changes sit behind one disclosure. Every enabled button leads somewhere that works.
 */
export function WeeklyPaperCard({ preview, state, readingName, today, result, classLed }: { preview: PaperPreview; state: WeeklyPaperState; readingName: Map<string, string>; today: string; result: CardResult; classLed: boolean }) {
  const p = state.primary
  const d = state.decision
  const names = (ids: string[]) => ids.map(i => readingName.get(i) ?? i)
  const planned = state.planned?.date ?? null
  const upcoming = Boolean(planned && planned > today)
  const hasDetail = Boolean(state.planned && (state.planned.notCompleted.length > 0 || state.planned.addedSincePlanned.length > 0)) || Boolean(d && (d.pending.bank.length > 0 || d.pending.capacityTotal > 0 || d.readings.length > 0))

  return (
    <section className="weekly-card" aria-labelledby="weekly-h" data-state={p.kind}>
      <p className="eyebrow">This week&apos;s paper</p>
      <h2 id="weekly-h">{state.paperLabel}</h2>

      {p.kind === 'no_scope' && (
        <>
          <p role="status">{p.reason}</p>
          <div className="weekly-card__actions">
            <LogLearningButton className="primary-button" classLed={classLed} />
          </div>
        </>
      )}

      {p.kind === 'confirm_scope' && (
        <>
          <p role="status">{p.unresolved} finished or partly finished block{p.unresolved === 1 ? ' needs' : 's need'} you to say what {p.unresolved === 1 ? 'it' : 'they'} covered before they can be tested.</p>
          <div className="weekly-card__actions"><a className="primary-button" href="#scope-h">Confirm what you covered</a></div>
        </>
      )}

      {p.kind === 'start' && d && (
        <>
          {!p.blocked && (upcoming
            ? <p>Planned for <strong>{planned}</strong> on your Calendar. You can start early if you have finished the learning it covers.</p>
            : <p>{`${d.deliverable < d.requested ? `${d.deliverable} of ${d.requested} planned questions can be served` : `${d.requested} questions`} · about ${d.minutes} minutes`}. You can pause and resume.</p>)}
          {p.blocked ? (
            <div className="weekly-card__actions">
              <p role="status">{p.blocked}</p>
              <Link className="primary-button" href={d.next?.href ?? '/app/review-week'}>{d.next?.label ?? 'Continue planning'}</Link>
            </div>
          ) : (
            <div className="weekly-card__actions">
              <PreflightStart className={upcoming ? 'secondary-button' : 'primary-button'} reviewLabel={upcoming ? 'Review and start early' : 'Review and start'} startLabel="Start weekly paper"
                body={{ kind: 'weekly', paperKind: preview.paperKind, expectedRevision: preview.scope.revision }} />
            </div>
          )}
        </>
      )}

      {p.kind === 'resume' && (
        <>
          <p>Your paper is open. Your saved answers are kept.</p>
          <div className="weekly-card__actions"><Link className="primary-button" href={`/app/tests/${p.attemptId}`}>Resume paper</Link></div>
        </>
      )}

      {p.kind === 'result' && (
        <>
          <p role="status">{result && result.score !== null
            ? <>Scored <strong>{result.score}%</strong>{result.policy === 'paper-score.1' ? ` of the paper (${result.answered ?? 0} of ${result.delivered ?? 0} answered)` : ' of the questions you answered'}. </>
            : 'Your paper is scored. '}The result says what to do next.</p>
          <div className="weekly-card__actions">
            <Link className="primary-button" href={`/app/tests/${p.attemptId}/result`}>See result</Link>
            <Link className="secondary-button" href={`/app/tests/${p.attemptId}/result#proposal-h`}>Follow-up</Link>
            <Link className="secondary-button" href={p.closureUrl}>Complete weekly closure</Link>
          </div>
          {state.further && (
            <div>
              <p className="muted">{state.further.furtherPaper ? state.further.furtherPaper.tradeoff : `${state.further.pending.capacityTotal} confirmed outcomes were not asked.`} A further paper: {state.further.deliverable} different questions, about {state.further.minutes} minutes.</p>
              <PreflightStart className="secondary-button" reviewLabel="Review a further paper" startLabel="Start further paper" body={{ kind: 'weekly', paperKind: state.further.paperKind ?? undefined, part: state.further.part }} />
            </div>
          )}
        </>
      )}

      {hasDetail && (
        <details className="weekly-card__detail">
          <summary>What this paper covers</summary>
          {state.planned && state.planned.notCompleted.length > 0 && <p>Planned but not completed, so not tested: {names(state.planned.notCompleted).join('; ')}. Calendar carries it forward.</p>}
          {state.planned && state.planned.addedSincePlanned.length > 0 && <p>Completed since it was planned, so now included: {names(state.planned.addedSincePlanned).join('; ')}.</p>}
          {d && d.readings.length > 0 && <p>{d.readings.map(r => `${r.name}: ${r.delivered}${r.delivered < r.wanted ? ` of ${r.wanted}` : ''}`).join(' · ')}</p>}
          {d && d.furtherPaper && p.kind === 'start' && <p><strong>Trade-off.</strong> {d.furtherPaper.tradeoff}</p>}
          {d && d.pending.bank.length > 0 && p.kind !== 'result' && (
            <>
              <p><strong>Waiting on reviewed questions.</strong> These stay untested until more are approved; nothing unrelated is used instead.</p>
              <ul>{d.pending.bank.map(b => <li key={b.readingId}>{b.name}: {b.available} of {b.wanted} available</li>)}</ul>
            </>
          )}
        </details>
      )}
    </section>
  )
}
