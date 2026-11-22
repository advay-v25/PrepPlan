import Link from 'next/link'
import type { ReadingRevision } from '../../lib/curriculum/revisionOverview'
import type { CheckCapability } from '../../lib/curriculum/revisionQueue'

const HOW: Record<string, string> = { study_date: 'the study date you logged', recorded: 'when you marked it done' }

/** One reading's place in the revision rotation, and why. Server-rendered and read-only. */
export function RevisionStatus({ revision, capability }: { revision: ReadingRevision | null; capability: CheckCapability | null }) {
  if (!revision) return null
  const { line } = revision
  return (
    <section aria-labelledby="revision-h" className="reading-revision note">
      <h2 id="revision-h">Revision</h2>
      <p>
        <strong>{revision.label}</strong>
        {line.kind === 'targeted' ? ' · you marked this to revisit' : ' · maintenance'}
        {' · last activity: '}{line.recency.days == null ? 'unknown' : `${line.recency.days} day${line.recency.days === 1 ? '' : 's'} ago (${HOW[line.recency.provenance ?? 'recorded']})`}
      </p>
      <details>
        <summary>Why is this {revision.status === 'next' ? 'queued' : 'here'}?</summary>
        <ul>{line.why.map(w => <li key={w}>{w}</li>)}</ul>
        {line.note && <p>{line.note}</p>}
        {capability && <p><strong>Checking it with questions:</strong> {capability.message}</p>}
        <p className="muted">Intervals are planning assumptions, not predictions of memory. Revising a reading records activity, not demonstrated understanding.</p>
        {revision.status === 'in_plan' && <p><Link href="/app/calendar">Open it in Calendar</Link></p>}
      </details>
    </section>
  )
}
