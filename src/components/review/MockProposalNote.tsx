'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { MockProposal } from '../../lib/planning/weeklyReview/service'
import { RunwayWork } from '../curriculum/RunwayWork'

const KIND = { repair: 'Recorded finding', untested: 'Evidence gap a mock can sample', uncovered: 'Not yet covered' } as Record<string, string>
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const when = (d: string, start?: number, window?: boolean) => `${d}${start === undefined ? '' : ` at ${clock(start)}`}${window ? ' (in the window you added)' : ''}`
export type Estimates = { debrief: number; followUp: number }

/** The student's planning estimates. Applying them rebuilds the draft, so what fits, splits or waits is shown straight away. */
function EstimateFields({ estimates, busy, onApply }: { estimates: Estimates; busy: boolean; onApply: (e: Estimates) => void }) {
  const [debrief, setDebrief] = useState(String(estimates.debrief))
  const [followUp, setFollowUp] = useState(String(estimates.followUp))
  const valid = [debrief, followUp].every(v => /^\d+$/.test(v) && Number(v) >= 15 && Number(v) <= 240)
  const changed = Number(debrief) !== estimates.debrief || Number(followUp) !== estimates.followUp
  return (
    <fieldset className="mock-estimates" data-testid="mock-estimates">
      <legend>Planning estimates (minutes)</legend>
      <label>Debrief <input type="number" inputMode="numeric" min={15} max={240} step={5} value={debrief} onChange={e => setDebrief(e.target.value)} /></label>{' '}
      <label>Follow-up <input type="number" inputMode="numeric" min={15} max={240} step={5} value={followUp} onChange={e => setFollowUp(e.target.value)} /></label>{' '}
      <button type="button" className="secondary-button" disabled={busy || !valid || !changed} onClick={() => onApply({ debrief: Number(debrief), followUp: Number(followUp) })}>Update draft</button>
      {!valid && <small className="fine-print" role="alert">Use whole minutes from 15 to 240.</small>}
      <small className="fine-print">Saved with the review you accept. Work already accepted stays as it is.</small>
    </fieldset>
  )
}

/** What the Roadmap's mock recommendation changes in THIS draft. The judgment is the server's; the student keeps the choice. */
export function MockProposalNote({ mock, busy, onToggle, onEstimates }: { mock: MockProposal | null | undefined; busy: boolean; onToggle: () => void; onEstimates: (e: Estimates) => void }) {
  if (!mock) return null
  const p = mock.placed
  const parts = (list: { date: string; minutes: number; start?: number }[], label: string) => list.map((x, n) => (
    <li key={`${label}${n}`}><strong>Adds:</strong> {label}{list.length > 1 ? `, part ${n + 1} of ${list.length}` : ''}, {x.minutes} min, on {when(x.date, x.start, x.start !== undefined)}.</li>
  ))
  return (
    <section className="verdict verdict--neutral" aria-labelledby="mock-proposal-h" data-testid="mock-proposal" data-verdict={mock.verdict} data-declined={mock.declined ? 'true' : 'false'}>
      <h3 id="mock-proposal-h">{mock.headline}</h3>
      <ul className="verdict-options">
        {mock.why.map(w => <li key={w}>{w}</li>)}
        {mock.costOfWaiting && <li><strong>Why not wait.</strong> {mock.costOfWaiting}</li>}
      </ul>
      {mock.confidenceNote && <p className="note" data-testid="mock-proposal-confidence"><strong>Lower confidence.</strong> {mock.confidenceNote}</p>}
      {(mock.verdict === 'more_revision' || (mock.verdict === 'start_with_gaps' && mock.work.weeks.length > 0)) &&
        <RunwayWork testId="mock-proposal-work" placed={mock.work.placed} waiting={mock.verdict === 'more_revision' ? mock.work.waiting : []} weeks={mock.work.weeks} />}
      {mock.gaps.length > 0 && <ul className="verdict-options" data-testid="mock-proposal-gaps">
        {mock.gaps.map(g => <li key={`${g.kind}-${g.href}`}><strong>{KIND[g.kind] ?? g.kind}</strong> ({g.when === 'before_mock' ? 'before the first mock' : 'after the mock'}). <Link href={g.href}>{g.name}</Link></li>)}
      </ul>}
      <ul className="verdict-options" data-testid="mock-proposal-changes">
        {mock.declined && <li>You kept broad revision this week. No mock is in this draft.</li>}
        {p?.mock && <li><strong>Adds:</strong> Mock sitting, {p.mock.minutes} min, on {when(p.mock.date, p.mock.start, p.mock.window)}.</li>}
        {p && parts(p.debrief, 'Debrief the mock')}
        {p && parts(p.followUp, 'Follow up on what it found')}
        {!mock.declined && mock.keepsBroadRevision && <li><strong>Keeps:</strong> broad revision, aimed at the open areas above.</li>}
        {!mock.declined && mock.waits.map(w => <li key={w.title}><strong>Waits:</strong> {w.title}. {w.reason}</li>)}
      </ul>
      <p className="fine-print">{mock.tradeoff}</p>
      {mock.externalRoute && <p className="fine-print">{mock.externalRoute}</p>}
      {mock.verdict !== 'more_revision' && !mock.declined && <EstimateFields key={`${mock.estimates.debrief}:${mock.estimates.followUp}`} estimates={mock.estimates} busy={busy} onApply={onEstimates} />}
      {(mock.declined || p?.mock || mock.verdict !== 'more_revision') && (
        <p><button type="button" className="secondary-button" disabled={busy} aria-pressed={mock.declined} onClick={onToggle}>
          {mock.declined ? 'Use the recommended mock week' : 'Keep broad revision this week instead'}</button></p>
      )}
    </section>
  )
}
