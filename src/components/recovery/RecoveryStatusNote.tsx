import Link from 'next/link'
import type { RecoveryStatus } from '../../lib/planning/recovery/status'

/**
 * The same catch-up and recovery status on Home, Calendar and the Roadmap. The server owns the judgment; this only shows it and links the one decision
 * point (Weekly Review). Quiet when nothing is owed.
 */
export function RecoveryStatusNote({ status, className = 'verdict verdict--neutral' }: { status: RecoveryStatus | 'unavailable' | null | undefined; className?: string }) {
  // A failed read is said. Showing nothing would read as "nothing is owed".
  if (status === 'unavailable') return <p className="fine-print" role="status" data-testid="recovery-unavailable">Your catch-up status could not be loaded just now. Nothing was changed; reload to try again.</p>
  if (!status || status.level === 'on_track') return null
  const n = status.numbers
  return (
    <section className={className} data-testid="recovery-status" data-level={status.level} data-chosen={status.chosen ?? ''} aria-label="Catch-up status">
      <h2 className="recovery-status__title">{status.headline}</h2>
      <p>{status.why[status.why.length > 2 ? 0 : status.why.length - 1] ?? status.why[0]}</p>
      <p className="fine-print" data-testid="recovery-numbers">
        {n.extraHours} h to catch up, counted once{n.loggedOnOwedMinutes ? `; ${n.loggedOnOwedMinutes} min already logged on it` : ''}{n.owedEstimatedMinutes ? `; ${n.owedEstimatedMinutes} min is PrepPlan’s estimate` : ''}{n.unplacedMinutes ? `; ${Math.round(n.unplacedMinutes / 6) / 10} h of it does not fit your usable time before mocks` : n.weeksToClear !== null ? `; fits your usable time by week ${n.weeksToClear || 1}` : ''}.{n.provisionalMinutes || n.newStudyMinutes ? ' Study, revision and papers you have not accepted are counted as provisional.' : ''}
        {status.level === 'recovery_offered' && ' Choose how to proceed in Weekly Review. Nothing changes until you accept.'}
      </p>
      {status.tradeoff && <p className="fine-print" data-testid="recovery-tradeoff">{status.tradeoff.summary}</p>}
      <Link href="/app/review-week">{status.level === 'recovery_offered' ? 'Choose a recovery path' : 'Open Weekly Review'}</Link>
    </section>
  )
}
