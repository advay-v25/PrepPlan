import Link from 'next/link'
import type { AttemptResult } from '../../lib/tests/resultService'
import { PAPER_SCORE_POLICY } from '../../lib/tests/scoreLedger'
import type { Cell, Judgement } from '../../lib/tests/resultAnalysis'
import type { SwotItem } from '../../lib/tests/resultAnalysis'
import { ERROR_TAXONOMY, type ErrorCode } from '../../lib/diagnostic/types'
import { StartButton } from './StartButton'

const KIND: Record<string, string> = { weekly: 'Weekly paper', reading: 'Reading diagnostic', subject: 'Subject diagnostic', repair: 'Repair re-check', mock: 'Mock session', practice: 'Timed practice' }
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
                  <td>{JUDGE[c.judgement]}<br /><small>{c.certainty} sample · {c.questions} question{c.questions === 1 ? '' : 's'}</small></td>
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
  const a = r.analysis, o = a.overall, L = r.ledger, paper = L.policy === PAPER_SCORE_POLICY
  const pc = (v: number | null) => v === null ? 'not available' : `${Math.round(v * 100)}%`
  // Carries the exact outcome, this result and the way back, so Curriculum opens on THIS outcome and offers a return to THIS result.
  const ctx = (extra: Record<string, string>) => new URLSearchParams({ ...extra, result: r.attempt.id, return: `/app/tests/${r.attempt.id}/result` }).toString()
  const outcomeLink = (id: string, tab?: 'notes') => { const rd = id.split('-')[0]; return `/app/curriculum/${readingSubject(rd, r)}/${rd}?${ctx({ los: id, ...(tab ? { tab } : {}) })}` }
  const wrongOutcomes = a.byOutcome.filter(c => c.correct < c.questions)

  return (
    <div className="result-view">
      <section className="result-hero" aria-labelledby="res-h">
        <p className="eyebrow">{KIND[r.attempt.kind ?? ''] ?? 'Diagnostic'}{r.attempt.paperKind ? ` · ${r.attempt.paperKind}` : ''}</p>
        <h2 id="res-h">{paper
          ? (L.scoreable ? `${L.correct} of ${L.scoreable} correct (${pc(L.paperScore)})` : 'No scoreable questions')
          : `${L.correct} of ${L.correct + L.incorrect} answered correct${L.paperScore !== null ? ` (${pc(L.paperScore)})` : ''}`}</h2>
        <p data-score-basis>{paper
          ? `Paper score: correct answers over every question on the paper. ${L.correct + L.incorrect} of ${L.scoreable} answered (${pc(L.completion)}); ${L.omitted} not answered${L.voided ? `; ${L.voided} set aside` : ''}${L.provisional ? `; ${L.provisional} under review, counted for now` : ''}. Answered accuracy: ${L.correct} of ${L.correct + L.incorrect} (${pc(L.answeredAccuracy)}).`
          : `Scored under the earlier policy (${L.policy}): answered questions only, so unanswered questions did not lower this percentage. ${L.omitted} not answered.`}</p>
        <p className="muted">With {L.correct + L.incorrect} answered question{L.correct + L.incorrect === 1 ? '' : 's'} this percentage is a snapshot of this paper, not your level on the subject and not a forecast.</p>
        {r.findings[0] && <p data-top-finding><strong>{r.findings[0].title}.</strong> {r.findings[0].interpretation}</p>}
        {r.revision.adjustedAt && <p className="note" role="status" data-adjusted>A reported question was set aside after review, so this result was adjusted (revision {r.revision.number}). The score above already reflects it.</p>}
      </section>

      <section className="result-next" aria-labelledby="next-h" data-next-kind={r.nextAction.kind}>
        <p className="eyebrow">Do this next</p>
        <h2 id="next-h">{r.nextAction.title}</h2>
        <p>{r.nextAction.why}</p>
        <p><a className="primary-button" href={r.nextAction.href}>{r.nextAction.href.startsWith('#') ? 'Go to the follow-up' : r.nextAction.cta}</a></p>
      </section>


      <details className="result-group">
        <summary><h2>Findings and what to repair</h2></summary>
      <section aria-labelledby="findings-h">
        <h2 id="findings-h">What the patterns show</h2>
        {r.findings.length === 0 ? <p className="muted">No pattern stood out in this paper: no confident mistake, no unsure-but-correct answer, no repeated slowness, nothing left unanswered.</p> : (
          <ul className="finding-list">{r.findings.map((f, n) => (
            <li key={n} data-finding={f.kind}>
              <strong>{f.title}</strong> <small>{f.observations} observation{f.observations === 1 ? '' : 's'}</small>
              <p>{f.interpretation}</p>
              <p className="muted">{f.response}</p>
              {f.guidance && (
                <details className="finding-guidance">
                  <summary>How to work on this with your own materials</summary>
                  <p><strong>Scope:</strong> {f.guidance.scope}.</p>
                  <p><strong>Why now:</strong> {f.guidance.why}</p>
                  <p><strong>Do this:</strong> {f.guidance.activity}</p>
                  <p><strong>Done when:</strong> {f.guidance.completion}</p>
                  <p><strong>Afterwards:</strong> {f.guidance.verify}</p>
                  <p className="muted">Use {f.guidance.resource.kind === 'curriculum_reference' ? <Link href={f.guidance.resource.href}>{f.guidance.resource.label}</Link> : f.guidance.resource.label}.</p>
                </details>
              )}
              {f.practice && (f.practice.state === 'start' || f.practice.state === 'resume' ? (
                <p>
                  <StartButton className="secondary-button" label={f.practice.state === 'resume' ? 'Resume timed practice' : `Start timed practice (${f.practice.deliverable} questions, ${f.practice.minutes} min)`} body={{ kind: 'practice', readingId: f.practice.readingId, outcomeIds: f.practice.outcomeIds }} />
                  <small className="muted"> Practice only: it is not evidence and does not change repairs or your weekly paper.</small>
                </p>
              ) : f.action === 'timed_practice' ? <p className="muted" role="status">Timed practice is not available right now. {f.practice.message ?? ''}</p> : null)}
            </li>
          ))}</ul>
        )}
        {(r.omitted.length > 0 || r.invalidated.length > 0) && (
          <div className="note" role="status">
            {r.omitted.length > 0 && <p><strong>Not answered:</strong> question{r.omitted.length === 1 ? '' : 's'} {r.omitted.map(o => o.seq).join(', ')}. No confidence was recorded and no cause is assumed; these are not counted as wrong.</p>}
            {r.invalidated.length > 0 && <p><strong>Not counted as evidence:</strong> {r.invalidated.map(i => `question ${i.seq} (${i.why === 'challenged' || i.why === 'disputed' ? 'under review, still counted' : 'voided after a challenge was upheld'})`).join('; ')}.</p>}
          </div>
        )}
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
          </>
        )}
      </section>

      </details>

      <details className="result-group">
        <summary><h2>Evidence by reading, subject and outcome</h2></summary>
      <section aria-labelledby="break-h">
        <h2 id="break-h">By subject and reading</h2>
        <Table title="By subject" cells={a.bySubject} names={r.names.subjects} />
        <Table title="By reading" cells={a.byReading} names={r.names.readings} link={id => { const sub = readingSubject(id, r); return sub ? `/app/curriculum/${sub}/${id}` : null }} />
        <p className="muted">One or two questions cannot label a subject or a reading. The wording above never claims more than the number of questions allows.</p>
      </section>

      {wrongOutcomes.length > 0 && (
        <section aria-labelledby="miss-h">
          <h2 id="miss-h">Exactly what you missed</h2>
          <ul>{wrongOutcomes.map(c => <li key={c.id}><Link href={outcomeLink(c.id)}>{r.names.outcomes[c.id] ?? c.id}</Link> — {c.correct} of {c.questions} correct{' '}<Link className="text-button" href={outcomeLink(c.id, 'notes')}>Write a note</Link></li>)}</ul>
        </section>
      )}

      <section aria-labelledby="swot-h">
        <h2 id="swot-h">Strengths, weaknesses, opportunities, threats</h2>
        <p className="muted">Strengths and weaknesses come from your evidence. Opportunities and threats come only from verified curriculum relationships (a written link between readings) — they are never new wrong answers, and never assumed knowledge. Strengths show supported tested scope only.</p>
        <div className="swot-grid">
          <Quadrant title="Strengths" tone="green" items={r.swot.strengths} empty="Nothing counts as a strength yet: a strength needs repeated, confident, correct answers." />
          <Quadrant title="Weaknesses" tone="red" items={r.swot.weaknesses} empty="No weakness showed in this paper." />
          <Quadrant title="Opportunities" tone="blue" items={r.swot.opportunities} empty="No opportunity can be inferred yet." hint="Where to try next — inferred." />
          <Quadrant title="Threats" tone="amber" items={r.swot.threats} empty="No downstream reading is at risk from what showed here." hint="Readings that build on a weakness — inferred." />
        </div>
        {r.swot.navigation.length > 0 && <Quadrant title="Next in curriculum order (navigation only)" tone="grey" items={r.swot.navigation} empty="" hint="Reading order helps you find the next reading. It does not mean it depends on this one or that you will struggle." />}
        {r.swot.observedSuccesses.length > 0 && <Quadrant title="Observed successes (not yet strengths)" tone="grey" items={r.swot.observedSuccesses} empty="" />}
        {r.swot.toVerify.length > 0 && <Quadrant title="Right, but to verify" tone="grey" items={r.swot.toVerify} empty="" />}
      </section>

      <section aria-labelledby="cur-h" data-current-status>
        <h3 id="cur-h">Where each of these stands now</h3>
        {r.currentStatus.available ? (
          <>
            <p className="muted">Cumulative Curriculum status, read {new Date(r.currentStatus.asOf).toLocaleString()}. Later papers update this, never what this paper showed above.</p>
            <ul>{r.currentStatus.rows.map(x => <li key={x.outcomeId}>{x.title}: {x.band === 'untested' ? 'not yet tested elsewhere' : x.band}{x.verdict !== 'none' ? ` · ${x.verdict.replace('_', ' ')}` : ''}</li>)}</ul>
          </>
        ) : <p className="muted" role="status">Current status is unavailable right now. That is not the same as no evidence.</p>}
      </section>
      </details>

      <details className="result-group">
        <summary><h2>Confidence, timing, coverage and integrity</h2></summary>
      <section aria-labelledby="acc-h">
        <h2 id="acc-h">Accuracy</h2>
        <p>{L.correct} of {L.correct + L.incorrect} answered questions correct ({pc(L.answeredAccuracy)}). Confidence and timing are shown separately below because each tells you something different.</p>
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
        <p className="muted">A correct guess is not mastery, and a confident miss is more important than an unsure one.</p>
      </section>

      <section aria-labelledby="time-h2">
        <h2 id="time-h2">Timing</h2>
        <p>{o.activeMinutes} min of active solving across {o.answered} answered question{o.answered === 1 ? '' : 's'}; {a.patterns.slowCorrect} correct but slow.
          {o.interruptedMinutes > 0 ? ` ${o.interruptedMinutes} min were interrupted and are not held against you.` : ''}</p>
        <p className="muted">Each question is judged against its own type, not a flat 90 seconds. Timing says nothing about whether you understood the concept.</p>
      </section>

      <p className="muted" data-timing-note>{o.activeMinutes} min of active solving{r.attempt.pausedMinutes > 0 && ` · ${r.attempt.pausedMinutes} min paused (not counted)`}{o.interruptedMinutes > 0 && ` · ${o.interruptedMinutes} min interrupted (not held against you)`}{o.changedAnswers > 0 && ` · ${o.changedAnswers} answer${o.changedAnswers === 1 ? '' : 's'} changed before submitting`}. Result revision {r.revision.number}.</p>
      <section aria-labelledby="scope-h2">
        <h2 id="scope-h2">What was tested, and what was not</h2>
        <p>{r.coverage.deliveredQuestions} question{r.coverage.deliveredQuestions === 1 ? '' : 's'} covering {a.byOutcome.length} outcome{a.byOutcome.length === 1 ? '' : 's'} in {a.byReading.length} reading{a.byReading.length === 1 ? '' : 's'}.
          {r.coverage.requestedQuestions !== null && r.coverage.requestedQuestions > r.coverage.deliveredQuestions && ` The blueprint asked for ${r.coverage.requestedQuestions}; the bank could serve ${r.coverage.deliveredQuestions}.`}</p>
        {r.eligibilityPolicy === null && <p className="note" role="note">This paper was reserved before approved-version eligibility began, under the earlier rule (questions marked human reviewed). Its questions and answers are kept exactly as they were.</p>}
        {r.coverage.shortfalls.length > 0 && <p className="notice notice--warn" role="alert">Short on questions: {r.coverage.shortfalls.map(s => `${r.names.readings[s.readingId] ?? s.readingId} (${s.delivered} of ${s.wanted})`).join('; ')}. This is carried forward, not hidden.</p>}
        {r.coverage.untestedOutcomes.length > 0 && (
          <div><h3>Completed but not tested in this paper</h3>
            <ul>{r.coverage.untestedOutcomes.map(id => <li key={id}>{r.names.outcomes[id] ?? id}</li>)}</ul>
            <p className="muted">Appearing once would not have verified everything you studied, so these carry into a later paper.</p></div>
        )}
        {r.coverage.excluded.length > 0 && <div><h3>Left out because it was not completed</h3><ul>{r.coverage.excluded.map((e, n) => <li key={n}>{e.title} — {REASON[e.reason] ?? e.reason}</li>)}</ul><p className="muted">Not wrong answers, and not counted against you.</p></div>}
      </section>

      {(r.integrity.voidedOrDisputed > 0 || r.integrity.challenges > 0 || r.integrity.unmappedQuestions > 0) && (
          <p className="note" role="status">
            {r.integrity.voidedOrDisputed > 0 && `${r.integrity.voidedOrDisputed} evidence record${r.integrity.voidedOrDisputed === 1 ? ' is' : 's are'} voided or disputed and not counted. `}
            {r.integrity.challenges > 0 && `${r.integrity.challenges} question${r.integrity.challenges === 1 ? ' is' : 's are'} under challenge. `}
            {r.integrity.unmappedQuestions > 0 && `${r.integrity.unmappedQuestions} question${r.integrity.unmappedQuestions === 1 ? '' : 's'} could not be tied to a specific outcome, so they appear only in the totals.`}
          </p>
      )}
      {r.previous.length > 0 && (
        <section aria-labelledby="prev-h">
          <h2 id="prev-h">Earlier papers of this kind</h2>
          <ul>{r.previous.map(p => <li key={p.id}><Link href={`/app/tests/${p.id}/result`}>{p.startedAt ? new Date(p.startedAt).toLocaleDateString() : 'Earlier'}</Link>: {p.correct} of {p.answered} correct</li>)}</ul>
          <p className="muted">These are different questions on different material, so the percentages are not directly comparable.</p>
        </section>
      )}
      </details>

    </div>
  )
}

function readingSubject(readingId: string, r: AttemptResult): string {
  return r.subjectOfReading[readingId] ?? ''
}
