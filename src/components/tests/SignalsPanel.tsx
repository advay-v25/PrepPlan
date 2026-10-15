import type { Signals } from '../../lib/signals/signals'

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`)
const MOVES: Record<string, string> = { paper_scored: 'Understanding', evidence_voided: 'Understanding', block_completed: 'Execution', block_postponed: 'Execution', block_skipped: 'Execution' }

/** Four separate signals, never one score. Each says what it is made of and what it is not. */
export function SignalsPanel({ s }: { s: Signals }) {
  const u = s.understanding, e = s.execution, c = s.calibration, p = s.position
  return (
    <section className="signals-panel" aria-labelledby="signals-h">
      <h2 id="signals-h">Where you stand — four separate signals</h2>
      <p className="muted">Studying is not understanding, so they are never blended into one number.</p>
      <div className="signals-grid">
        <article>
          <h3>Curriculum position</h3>
          <p>{p.exposed} of {p.total} outcomes exposed · {p.tested} tested · {p.verified} verified</p>
          <p className="muted">{p.scheduled} scheduled, {p.notStarted} not started. Exposure is what you have covered, not what you can show.</p>
        </article>
        <article>
          <h3>Demonstrated understanding</h3>
          <p><strong>{u.band}</strong></p>
          <ul>{u.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <p className="muted">Only scored test evidence moves this. Completing a block never does.</p>
        </article>
        <article>
          <h3>Plan execution</h3>
          <p>{e.completed} done · {e.partial} partial · {e.postponed} postponed · {e.skipped} skipped{e.unreported ? ` · ${e.unreported} with no status` : ''}</p>
          <p className="muted">{e.pressure === 'none' ? 'Nothing has slipped.' : e.pressure === 'building' ? 'A little has slipped and is carried forward.' : 'A lot has slipped; the weekly review offers choices, not a bigger week.'}</p>
        </article>
        <article>
          <h3>Confidence calibration</h3>
          {c.sample > 0 && <p>Sure and right {pct(c.sureAccuracy)} · guessing and right {pct(c.guessAccuracy)}</p>}
          <p className="muted">{c.reading}{c.overconfidentOutcomes > 0 ? ` ${c.overconfidentOutcomes} outcome${c.overconfidentOutcomes === 1 ? '' : 's'} you marked confident, where the evidence disagrees.` : ''}</p>
        </article>
      </div>
      {s.movement.length > 0 && (
        <details>
          <summary>Why these moved recently</summary>
          <ul>{s.movement.map((m, i) => <li key={i}><strong>{m.date}</strong> · moved {MOVES[m.kind]}: {m.text}</li>)}</ul>
        </details>
      )}
    </section>
  )
}
