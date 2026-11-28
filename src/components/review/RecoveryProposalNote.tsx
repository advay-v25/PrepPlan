import Link from 'next/link'
import type { RecoveryProposal } from '../../lib/planning/weeklyReview/service'
import type { PathKey } from '../../lib/planning/recovery/status'

const h = (m: number) => `${Math.round((m / 60) * 10) / 10} h`

/** Catch-up as this draft applies it, and (only when repeated shortfalls make the roadmap hard to sustain) the recovery paths. Choosing one rebuilds the draft. */
export function RecoveryProposalNote({ recovery, busy, onChoose }: { recovery: RecoveryProposal | null | undefined; busy: boolean; onChoose: (p: PathKey | null) => void }) {
  if (!recovery) return null
  const { status: s, fits: f, chosenPath } = recovery
  return (
    <section className="verdict verdict--neutral" aria-labelledby="recovery-h" data-testid="recovery-proposal" data-level={s.level} data-chosen={chosenPath ?? ''}>
      <h3 id="recovery-h">{s.level === 'catching_up' ? 'Catching up on the same roadmap' : s.headline}</h3>
      <ul className="verdict-options" data-testid="recovery-why">{s.why.map(w => <li key={w}>{w}</li>)}</ul>
      {s.numbers.newStudyMinutes > 0 && <p className="fine-print">These forecast figures are worked out before you save: this draft’s new tasks still count as not accepted, so the minutes can shift slightly afterwards.</p>}
      <ul className="verdict-options" data-testid="recovery-fits">
        <li><strong>Remaining work:</strong> {h(s.numbers.owedMinutes)} across {s.numbers.owedItems} piece{s.numbers.owedItems === 1 ? '' : 's'}, counted once.</li>
        <li><strong>Additional hours to close the gap:</strong> {h(s.numbers.owedMinutes)}.</li>
        <li><strong>Fits in this draft:</strong> {h(f.placedMinutes)}{f.waitingMinutes > 0 ? `; ${h(f.waitingMinutes)} still waiting` : ''}.</li>
        {f.carried.map(c => <li key={`${c.title}${c.date}`}><strong>Carried:</strong> {c.title}, {c.minutes} min, on {c.date}.</li>)}
        {f.split.map(c => <li key={`s${c.title}`}><strong>In sittings:</strong> {c.title}, {c.minutes} min. {c.reason}</li>)}
        {f.waiting.map(c => <li key={`w${c.title}`}><strong>Still waiting:</strong> {c.title}, {c.minutes} min. {c.reason}</li>)}
      </ul>
      {s.level === 'recovery_offered' && <>
        <p className="fine-print">{s.rule}</p>
        <ul className="verdict-options" data-testid="recovery-paths">
          {s.paths.map(p => (
            <li key={p.key} data-path={p.key} data-chosen={chosenPath === p.key ? 'true' : 'false'}>
              <strong>{p.label}.</strong> {p.hoursRequired > 0 ? `${p.hoursRequired} h in total${p.perWeekMinutes ? `, about ${p.perWeekMinutes} min a week` : ''}${p.weeksToClear ? ` over ${p.weeksToClear} week${p.weeksToClear === 1 ? '' : 's'}` : ''}.` : 'No extra hours.'}
              {!p.feasible && ' This does not fit your current spare time.'}
              {p.moved.map(m => <span key={m}> Moves: {m}</span>)}{p.deferred.map(d => <span key={d}> Waits: {d}</span>)}
              <span> Revision: {p.effect.revision} Mocks: {p.effect.mocks} Timeline: {p.effect.timeline}</span>{' '}
              {p.via === 'draft'
                ? <button type="button" className="secondary-button" disabled={busy} aria-pressed={chosenPath === p.key} onClick={() => onChoose(chosenPath === p.key ? null : p.key)}>{chosenPath === p.key ? 'Back to the current roadmap' : 'Use this path'}</button>
                : <Link href="/app/exam">Change your exam date</Link>}
            </li>
          ))}
        </ul>
      </>}
    </section>
  )
}
