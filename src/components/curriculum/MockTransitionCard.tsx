import Link from 'next/link'
import type { MockTransition } from '../../lib/exam/mockTransition'
import { RunwayWork } from './RunwayWork'

const KIND_LABEL = { repair: 'Recorded finding', untested: 'Evidence gap a mock can sample', uncovered: 'Not yet covered' } as const
const mins = (n: number) => n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`

/**
 * The Roadmap's mock recommendation. The judgment lives on the server (mockTransition); this only shows it.
 * Nothing here changes the plan: the proposal goes through Weekly Review, where the student accepts or changes it.
 */
export function MockTransitionCard({ transition: t, reviewHref = '/app/review-week' }: { transition: MockTransition; reviewHref?: string }) {
  if (!t.available) return null
  return (
    <section className="verdict verdict--neutral" aria-labelledby="mock-transition-h" data-testid="mock-transition" data-verdict={t.verdict}>
      <h2 id="mock-transition-h">{t.headline}</h2>
      <ul className="verdict-options">
        {t.why.map(w => <li key={w}>{w}</li>)}
        {t.costOfWaiting && <li><strong>Why not wait.</strong> {t.costOfWaiting}</li>}
      </ul>
      {t.confidence.note && <p className="note" data-testid="mock-transition-confidence"><strong>Lower confidence.</strong> {t.confidence.note}</p>}
      {t.gaps.length > 0 && <>
        <h3>Open areas</h3>
        <ul className="verdict-options" data-testid="mock-transition-gaps">
          {t.gaps.map(g => <li key={`${g.kind}-${g.href}`}><strong>{KIND_LABEL[g.kind]}</strong> ({g.when === 'before_mock' ? 'before the first mock' : 'after the mock'}). <Link href={g.href}>{g.name}</Link></li>)}
        </ul>
      </>}
      {(t.verdict === 'more_revision' || (t.verdict === 'start_with_gaps' && t.broadRevision.weeks.length > 0)) && <>
        <h3>{t.verdict === 'more_revision' ? 'Work to finish before the first mock' : 'Time before the mock runway'}</h3>
        <RunwayWork testId="mock-transition-work" placed={t.broadRevision.placed} waiting={t.verdict === 'more_revision' ? t.broadRevision.waiting : []} weeks={t.broadRevision.weeks} />
      </>}
      <h3>What changes in your proposed week</h3>
      <ul className="verdict-options" data-testid="mock-transition-proposal">
        {t.proposal.adds.map(a => <li key={a.kind}><strong>Adds:</strong> {a.label}, {mins(a.minutes)}.</li>)}
        {t.proposal.adds.length === 0 && <li>No mock is added yet.</li>}
        {t.proposal.keepsBroadRevision && <li><strong>Keeps:</strong> broad revision, aimed at the gaps above.</li>}
        {t.proposal.waits.map(w => <li key={w.title}><strong>Waits:</strong> {w.title}. {w.reason}</li>)}
      </ul>
      <p className="fine-print">{t.feasibility.note} You can change the debrief and follow-up estimates in Weekly Review. Your accepted work does not change until you review the proposal and accept it.</p>
      <p className="fine-print" data-testid="mock-transition-tradeoff">{t.tradeoff}</p>
      {t.externalRoute && <p className="fine-print" data-testid="mock-transition-external">{t.externalRoute}</p>}
      <Link href={reviewHref}>Open Weekly Review</Link>
    </section>
  )
}
