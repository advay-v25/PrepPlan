import type { AdaptationRecord } from '../../lib/planning/weeklyReview/adaptationRecord'

/** One shared line saying why this accepted week is the size it is. Read from the review's record; never recalculated here. */
export function AdaptationLine({ record }: { record: AdaptationRecord | null }) {
  if (!record) return null
  return (
    <section aria-label="Why this week is this size" className="adaptation-line">
      <p><strong>{record.headline}</strong>{record.lighter ? ' You asked for a lighter draft.' : ''}{record.optionalMinutes > 0 ? ` About ${record.optionalMinutes} minutes are optional extra.` : ''}</p>
      <details><summary>Why</summary>
        <ul>{record.reasons.map(r => <li key={r}>{r}</li>)}</ul>
        {record.ahead && <p>{record.ahead}</p>}
        {record.waiting > 0 && <>
          <p className="fine-print">When you accepted this week, work from {record.waiting} reading{record.waiting === 1 ? '' : 's'} fell outside the time set aside for new study.</p>
          {Boolean(record.waitingWork?.length) && <ul>{record.waitingWork?.map(w => <li key={w.id}>{w.name} · about {w.minutes} min outside the draft</li>)}</ul>}
        </>}
      </details>
    </section>
  )
}
