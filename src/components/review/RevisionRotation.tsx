import Link from 'next/link'
import type { RevisionPreview } from '../../lib/planning/weeklyReview/service'

/** What revision the next week proposes, why each reading was chosen, and what is waiting. Read-only; nothing here changes the plan. */
export function RevisionRotation({ revision }: { revision: RevisionPreview | null }) {
  if (!revision || (revision.placed.length === 0 && revision.waiting.length === 0 && revision.elsewhere.length === 0)) return null
  const href = (r: { readingId: string; topic: string }) => `/app/curriculum/${r.topic}/${r.readingId}`
  return (
    <section aria-labelledby="rotation-h" className="revision-rotation">
      <h3 id="rotation-h">Revision in the next week</h3>
      {revision.placed.length === 0
        ? <p>{revision.limit === 0
            ? 'Revision continuing from this week already fills next week’s revision allowance, so no new reading is added. Nothing is lost: your other covered readings stay in the rotation.'
            : 'No revision fits next week’s free time. Nothing is lost: your covered readings stay in the rotation.'}</p>
        : <ul>{revision.placed.map(p => (
            <li key={p.readingId}>
              <strong>{p.name}</strong> <small>· {p.kind === 'targeted' ? 'you marked it to revisit' : 'maintenance'}</small>
              <details><summary>Why this one?</summary>
                <ul>{p.why.map(w => <li key={w}>{w}</li>)}</ul>
                <p><Link href={href(p)}>Open the reading</Link></p>
              </details>
            </li>))}</ul>}
      {revision.elsewhere.length > 0 && (
        <p className="fine-print">Not scheduled again because it is already covered: {revision.elsewhere.map(e => `${e.name} (${e.note?.split('.')[0].toLowerCase()})`).join('; ')}.</p>
      )}
      {revision.waiting.length > 0 && (
        <details><summary>Waiting for a later week ({revision.waiting.length}{revision.waiting.length === 8 ? '+' : ''})</summary>
          <ul>{revision.waiting.map(w => <li key={w.readingId}>{w.name} — {w.note}</li>)}</ul>
        </details>
      )}
      {revision.tradeoffs.map(t => <p key={t} className="fine-print">{t}</p>)}
      <p className="fine-print">Revision records what you revisited, not what you understood. How often a reading returns is a planning assumption.</p>
    </section>
  )
}
