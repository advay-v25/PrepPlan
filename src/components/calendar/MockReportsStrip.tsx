import Link from 'next/link'
import { describeScore, type MockReport } from '../../lib/mocks/report'

/** Past mock reports in Calendar: the entry for "a mock I already took" (no booking needed), the saved reports, work still waiting for a sitting, and old notes that can be structured. */
export function MockReportsStrip({ reports, waiting, unstructured, failed }: { reports: MockReport[]; waiting: { reportId: string; minutes: number; needsReview?: boolean }[]; unstructured: { id: string; date: string; reportedResult: string | null }[]; failed: boolean }) {
  return (
    <section className="note" aria-labelledby="mock-reports-h" data-testid="mock-reports">
      <h2 id="mock-reports-h">Mocks you have already taken</h2>
      {failed ? <p role="status">Your saved mock reports could not be loaded just now. <Link href="/app/calendar" className="prose-link">Try again</Link>.</p> : (
        <>
          <p><Link href="/app/calendar/mock-report" className="secondary-button">Record a mock already taken</Link></p>
          {reports.length > 0 && <ul>{reports.slice(0, 3).map(r => <li key={r.id}><Link href={`/app/calendar/mock-report/${r.id}`}>{r.takenOn}{r.provider ? ` · ${r.provider}` : ''}</Link> · {describeScore(r.score, r.scale, r.scoreMax)} <small className="muted">(your own report)</small></li>)}</ul>}
          {waiting.map(w => <p key={w.reportId} role="status" data-testid="recovery-waiting">{w.needsReview ? 'Earlier recovery work needs a completion decision; remaining time is not known.' : `Work you chose from a mock report still needs a sitting (${w.minutes} min).`} <Link href={`/app/calendar/mock-report/${w.reportId}?plan=left`} className="prose-link" data-testid="recovery-plan-left">{w.needsReview ? 'Review the follow-up' : 'Plan what is left'}</Link></p>)}
          {unstructured.length > 0 && <p className="muted">An earlier note of yours ({unstructured[0].date}{unstructured[0].reportedResult ? `, “${unstructured[0].reportedResult}”` : ''}) is kept as written. <Link href={`/app/calendar/mock-report?from=${unstructured[0].id}`} className="prose-link">Add structured details (optional)</Link></p>}
        </>
      )}
    </section>
  )
}
