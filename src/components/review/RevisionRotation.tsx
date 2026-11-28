import Link from 'next/link'
import type { RevisionPreview } from '../../lib/planning/weeklyReview/service'

/** What revision the next week proposes, why each reading was chosen, and what is waiting. Read-only; nothing here changes the plan. */
export function RevisionRotation({ revision }: { revision: RevisionPreview | null }) {
  if (!revision || (!revision.bridge && revision.placed.length === 0 && revision.waiting.length === 0 && revision.elsewhere.length === 0)) return null
  const held = revision.elsewhere.filter(e => e.state === 'waiting')
  const covered = revision.elsewhere.filter(e => !held.includes(e))
  const href = (r: { readingId: string; topic: string }) => `/app/curriculum/${r.topic}/${r.readingId}`
  return (
    <section aria-labelledby="rotation-h" className="revision-rotation">
      <h3 id="rotation-h">Revision in the next week</h3>
      {revision.bridge && <p>Your first pass is recorded as finished. Until broader revision begins, only test-supported concerns or readings you marked to revisit are proposed: {revision.bridge.tested} supported by checks, {revision.bridge.selfReported} from your own report. {revision.bridge.held} other reading{revision.bridge.held === 1 ? ' is' : 's are'} held for broader revision, without being labelled weak.</p>}
      {revision.placed.length === 0
        ? <p>{revision.bridge?.justified === 0
            ? 'No targeted revision is indicated yet. Your recorded coverage is kept; this does not mean your understanding has been tested.'
            : revision.limit === 0
            ? 'Revision continuing from this week already fills next week’s revision allowance, so no new reading is added. Nothing is lost: your other covered readings stay in the rotation.'
            : revision.waiting.some(entry => entry.note?.startsWith('Due for recall.'))
            ? 'No due recall fits in this proposal. The readings stay in the rotation.'
            : 'No new recall is proposed. Open the waiting list or Curriculum to see each reading’s status.'}</p>
        : <ul>{revision.placed.map(p => (
            <li key={p.readingId}>
              <strong>{p.name}</strong> <small>· {p.kind === 'targeted' ? 'you marked it to revisit' : 'recall'}</small>
              <details><summary>Why this one?</summary>
                <ul>{p.why.map(w => <li key={w}>{w}</li>)}</ul>
                <p><Link href={href(p)}>Open the reading</Link></p>
              </details>
            </li>))}</ul>}
      {covered.length > 0 && (
        <p className="fine-print">Not scheduled again because it is already covered: {covered.map(e => `${e.name} (${e.note?.split('.')[0].toLowerCase()})`).join('; ')}.</p>
      )}
      {held.length > 0 && <details><summary>{revision.bridge ? 'Held for broader revision' : 'Kept in the recall rotation'} ({held.length})</summary><ul>{held.map(e => <li key={e.readingId}><Link href={href(e)}>{e.name}</Link> — {e.note}</li>)}</ul></details>}
      {revision.waiting.length > 0 && (
        <details><summary>Waiting for a later week ({revision.waiting.length}{revision.waiting.length === 8 ? '+' : ''})</summary>
          <ul>{revision.waiting.map(w => <li key={w.readingId}><Link href={href(w)}>{w.name}</Link> — {w.note}</li>)}</ul>
        </details>
      )}
      {revision.tradeoffs.map(t => <p key={t} className="fine-print">{t}</p>)}
      <p className="fine-print">Revision records what you revisited, not what you understood. How often a reading returns is a planning assumption.</p>
    </section>
  )
}
