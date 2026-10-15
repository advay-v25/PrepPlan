import Link from 'next/link'
import type { AttemptResult } from '../../lib/tests/resultService'
import type { Cell, Judgement } from '../../lib/tests/resultAnalysis'
import type { SwotItem } from '../../lib/tests/resultAnalysis'
import { ERROR_TAXONOMY, type ErrorCode } from '../../lib/diagnostic/types'

const KIND: Record<string, string> = { weekly: 'Weekly paper', reading: 'Reading diagnostic', subject: 'Subject diagnostic', repair: 'Repair re-check', mock: 'Mock session' }
const JUDGE: Record<Judgement, string> = { too_few: 'Too few questions to judge', unclear: 'No clear signal yet', strong: 'Looks solid so far', weak: 'Looks weak so far' }
const pct = (n: number) => `${Math.round(n * 100)}%`
const mix = (m: Record<string, number>) => Object.entries(m).map(([k, v]) => `${v} ${k}`).join(', ')
const REASON: Record<string, string> = { postponed: 'postponed', missed: 'missed', not_completed: 'not marked done', structure_pending: 'awaiting Ethics structure' }

function Table({ title, cells, names, link }: { title: string; cells: Cell[]; names: Record<string, string>; link?: (id: string) => string | null }) {
  if (cells.length === 0) return null
  return (
    <div className="result-table-wrap">
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="result-table">
          <thead><tr><th>{title.replace('By ', '')}</th><th>Questions</th><th>Correct</th><th>Reading of it</th><th>Difficulty and form</th></tr></thead>
          <tbody>
            {cells.map(c => {
              const href = link?.(c.id)
              return (
                <tr key={c.id}>
                  <td>{href ? <Link href={href}>{names[c.id] ?? c.id}</Link> : names[c.id] ?? c.id}</td>
                  <td>{c.questions}</td>
                  <td>{c.correct} <small>({pct(c.accuracy)})</small></td>
                  <td>{JUDGE[c.judgement]}<br /><small>{c.certainty} sample · plausible range {pct(c.interval[0])}–{pct(c.interval[1])}</small></td>
                  <td><small>{mix(c.difficultyMix)}{Object.keys(c.formMix).length ? ` · ${mix(c.formMix)}` : ''}</small></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Quadrant({ title, tone, items, empty, hint }: { title: string; tone: string; items: SwotItem[]; empty: string; hint?: string }) {
  return (
    <section className={`swot-q swot-q--${tone}`} aria-label={title}>
      <h3>{title}</h3>
      {hint && <p className="muted">{hint}</p>}
      {items.length === 0 ? <p className="muted">{empty}</p> : (
        <ul>{items.map((i, n) => <li key={n}><strong>{i.text}</strong><br /><small>{i.basis === 'inferred' ? 'Inferred — ' : ''}{i.support}</small></li>)}</ul>
      )}
    </section>
  )
}

/** The full account of one scored attempt. Presentational: every number comes from getAttemptResult. */
export function ResultView({ r }: { r: AttemptResult }) {
  const a = r.analysis, o = a.overall
  const outcomeLink = (id: string) => { const rd = id.split('-')[0]; return `/app/curriculum/${readingSubject(rd, r)}/${rd}` }
  const wrongOutcomes = a.byOutcome.filter(c => c.correct < c.questions)

  return (
    <div className="result-view">
      <section className="result-hero" aria-labelledby="res-h">
        <p className="eyebrow">{KIND[r.attempt.kind ?? ''] ?? 'Diagnostic'}{r.attempt.paperKind ? ` · ${r.attempt.paperKind}` : ''}</p>
        <h2 id="res-h">{o.correct} of {o.answered} correct{o.scorePercent !== null ? ` (${o.scorePercent}%)` : ''}</h2>
        <p><Link href={`/app/coach?q=${encodeURIComponent('Help me understand this result and what to do next.')}`} className="text-button">Talk this result through with the Coach &rarr;</Link></p>
        {o.interval && <p>With {o.answered} question{o.answered === 1 ? '' : 's'}, the plausible range for how you would do on this material is {pct(o.interval[0])}–{pct(o.interval[1])}. Treat the percentage as a snapshot of this paper, not your level.</p>}
        <p className="muted">
          {o.activeMinutes} min of active solving
          {r.attempt.pausedMinutes > 0 && ` · ${r.attempt.pausedMinutes} min paused (not counted)`}
          {o.interruptedMinutes > 0 && ` · ${o.interruptedMinutes} min interrupted (not held against you)`}
          {o.changedAnswers > 0 && ` · ${o.changedAnswers} answer${o.changedAnswers === 1 ? '' : 's'} changed before submitting`}
        </p>
        {(r.integrity.voidedOrDisputed > 0 || r.integrity.challenges > 0 || r.integrity.unmappedQuestions > 0) && (
          <p className="note" role="status">
            {r.integrity.voidedOrDisputed > 0 && `${r.integrity.voidedOrDisputed} evidence record${r.integrity.voidedOrDisputed === 1 ? ' is' : 's are'} voided or disputed and not counted. `}
            {r.integrity.challenges > 0 && `${r.integrity.challenges} question${r.integrity.challenges === 1 ? ' is' : 's are'} under challenge. `}
            {r.integrity.unmappedQuestions > 0 && `${r.integrity.unmappedQuestions} question${r.integrity.unmappedQuestions === 1 ? '' : 's'} could not be tied to a specific outcome, so they appear only in the totals.`}
          </p>
        )}
      </section>

      <section aria-labelledby="conf-h2">
        <h2 id="conf-h2">How sure you were</h2>
        <div className="table-scroll">
          <table className="result-table">
            <thead><tr><th>You said</th><th>Questions</th><th>Correct</th></tr></thead>
            <tbody>
              {(['high', 'medium', 'low'] as const).map(k => (
                <tr key={k}><td>{k === 'high' ? 'Sure' : k === 'medium' ? 'Somewhat sure' : 'Guessing'}</td><td>{o.confidence[k].n}</td><td>{o.confidence[k].correct}{o.confidence[k].n ? <small> ({pct(o.confidence[k].correct / o.confidence[k].n)})</small> : null}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pattern-grid">
          <div><strong>{a.patterns.confidentMistakes}</strong><span>confident mistakes — sure, and wrong</span></div>
          <div><strong>{a.patterns.correctGuesses}</strong><span>correct guesses — right, but not sure</span></div>
          <div><strong>{a.patterns.slowCorrect}</strong><span>slow but correct — retrieval or method speed</span></div>
          <div><strong>{a.patterns.repeatedMisconceptions}</strong><span>repeated mistakes</span></div>
        </div>
        {a.errorTypes.length > 0 && <p>The mistakes you made most: {a.errorTypes.slice(0, 3).map(e => `${ERROR_TAXONOMY[e.code as ErrorCode] ?? e.code} (${e.count})`).join(', ')}.</p>}
        <p className="muted">A correct guess is not mastery, and a confident miss is more important than an unsure one. Timing is judged against each question&apos;s own type, not a flat 90 seconds.</p>
      </section>

      <section aria-labelledby="scope-h2">
        <h2 id="scope-h2">What was tested, and what was not</h2>
        <p>{r.coverage.deliveredQuestions} question{r.coverage.deliveredQuestions === 1 ? '' : 's'} covering {a.byOutcome.length} outcome{a.byOutcome.length === 1 ? '' : 's'} in {a.byReading.length} reading{a.byReading.length === 1 ? '' : 's'}.
          {r.coverage.requestedQuestions !== null && r.coverage.requestedQuestions > r.coverage.deliveredQuestions && ` The blueprint asked for ${r.coverage.requestedQuestions}; the bank could serve ${r.coverage.deliveredQuestions}.`}</p>
        {r.coverage.shortfalls.length > 0 && <p className="notice notice--warn" role="alert">Short on questions: {r.coverage.shortfalls.map(s => `${r.names.readings[s.readingId] ?? s.readingId} (${s.delivered} of ${s.wanted})`).join('; ')}. This is carried forward, not hidden.</p>}
        {r.coverage.untestedOutcomes.length > 0 && (
          <div><h3>Completed but not tested in this paper</h3>
            <ul>{r.coverage.untestedOutcomes.map(id => <li key={id}>{r.names.outcomes[id] ?? id}</li>)}</ul>
            <p className="muted">Appearing once would not have verified everything you studied, so these carry into a later paper.</p></div>
        )}
        {r.coverage.excluded.length > 0 && <div><h3>Left out because it was not completed</h3><ul>{r.coverage.excluded.map((e, n) => <li key={n}>{e.title} — {REASON[e.reason] ?? e.reason}</li>)}</ul><p className="muted">Not wrong answers, and not counted against you.</p></div>}
      </section>

      <section aria-labelledby="break-h">
        <h2 id="break-h">By subject and reading</h2>
        <Table title="By subject" cells={a.bySubject} names={r.names.subjects} />
        <Table title="By reading" cells={a.byReading} names={r.names.readings} link={id => { const sub = readingSubject(id, r); return sub ? `/app/curriculum/${sub}/${id}` : null }} />
        <p className="muted">One or two questions cannot label a subject or a reading. The wording above never claims more than the number of questions allows.</p>
      </section>

      {wrongOutcomes.length > 0 && (
        <section aria-labelledby="miss-h">
          <h2 id="miss-h">Exactly what you missed</h2>
          <ul>{wrongOutcomes.map(c => <li key={c.id}><Link href={outcomeLink(c.id)}>{r.names.outcomes[c.id] ?? c.id}</Link> — {c.correct} of {c.questions} correct</li>)}</ul>
        </section>
      )}

      <section aria-labelledby="swot-h">
        <h2 id="swot-h">Strengths, weaknesses, opportunities, threats</h2>
        <p className="muted">Strengths and weaknesses come from your evidence. Opportunities and threats are inferred from the curriculum&apos;s own links between readings — they are never new wrong answers, and never assumed knowledge.</p>
        <div className="swot-grid">
          <Quadrant title="Strengths" tone="green" items={r.swot.strengths} empty="Nothing counts as a strength yet: a strength needs repeated, confident, correct answers." />
          <Quadrant title="Weaknesses" tone="red" items={r.swot.weaknesses} empty="No weakness showed in this paper." />
          <Quadrant title="Opportunities" tone="blue" items={r.swot.opportunities} empty="No opportunity can be inferred yet." hint="Where to try next — inferred." />
          <Quadrant title="Threats" tone="amber" items={r.swot.threats} empty="No downstream reading is at risk from what showed here." hint="Readings that build on a weakness — inferred." />
        </div>
        {r.swot.observedSuccesses.length > 0 && <Quadrant title="Observed successes (not yet strengths)" tone="grey" items={r.swot.observedSuccesses} empty="" />}
        {r.swot.toVerify.length > 0 && <Quadrant title="Right, but to verify" tone="grey" items={r.swot.toVerify} empty="" />}
      </section>

      <section aria-labelledby="fix-h">
        <h2 id="fix-h">What to repair, in order</h2>
        {r.repairs.length === 0 ? <p>Nothing needs repair from this paper. Widen the scope of your next one rather than re-testing what held.</p> : (
          <ol className="repair-list">
            {r.repairs.map(x => (
              <li key={x.outcomeId}>
                <strong>{x.title}</strong> <small>{x.reason}</small>
                <p>{x.method}</p>
                <p className="muted">Re-check: {x.retest.questions} independent, unseen question{x.retest.questions === 1 ? '' : 's'} after the repair. {x.retest.note}</p>
              </li>
            ))}
          </ol>
        )}
        <h3>What this could do to next week</h3>
        {!r.nextWeek || !r.nextWeek.available ? <p className="muted">There is no open week to preview. This is only a proposal; nothing changes without your confirmation.</p> : (
          <>
            <p>A preview for {r.nextWeek.weekStart} – {r.nextWeek.weekEnd}. Nothing is scheduled until you confirm it in your weekly review.</p>
            {r.nextWeek.repairTasks.length === 0 ? <p className="muted">The next-week preview does not yet contain repair work for these outcomes.</p> : <ul>{r.nextWeek.repairTasks.map((t, n) => <li key={n}>{t.date}: {t.title} <small>· {t.minutes} min</small></li>)}</ul>}
            <p><Link className="secondary-button" href={r.nextWeek.reviewUrl}>Review this week and the next</Link></p>
          </>
        )}
      </section>

      {r.previous.length > 0 && (
        <section aria-labelledby="prev-h">
          <h2 id="prev-h">Earlier papers of this kind</h2>
          <ul>{r.previous.map(p => <li key={p.id}><Link href={`/app/tests/${p.id}/result`}>{p.startedAt ? new Date(p.startedAt).toLocaleDateString() : 'Earlier'}</Link>: {p.correct} of {p.answered} correct</li>)}</ul>
          <p className="muted">These are different questions on different material, so the percentages are not directly comparable.</p>
        </section>
      )}
    </div>
  )
}

function readingSubject(readingId: string, r: AttemptResult): string {
  return r.subjectOfReading[readingId] ?? ''
}
