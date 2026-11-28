import type { WeekAdaptation } from '../../lib/planning/pulse/generateWeek'

/** Why next week is the size it is. One shared explanation: signals are kept apart and none of them is a verdict on understanding. */
export function AdaptationNote({ adaptation }: { adaptation: WeekAdaptation | null }) {
  if (!adaptation) return null
  const { pace, waiting, reconciliation } = adaptation
  return (
    <section aria-labelledby="adapt-h" className="adaptation-note">
      <h3 id="adapt-h">{adaptation.headline}</h3>
      <ul>{adaptation.reasons.map(r => <li key={r}>{r}</li>)}</ul>
      <p className="fine-print">
        Free time comes from your current availability and commitments. What happened to accepted work comes from your answers.
        {' '}Pace: {pace.source === 'observed'
          ? `about ${pace.minutesPerEffortUnit} minutes per unit of effort, from time you reported on finished readings.`
          : `a planning assumption of ${pace.minutesPerEffortUnit} minutes per unit of effort. Measuring yours takes ${pace.needed} finished readings with reported time (${pace.observedModules} so far). Reporting time is optional.`}
      </p>
      {reconciliation?.summary && <p>{reconciliation.summary}</p>}
      {adaptation.optionalMinutes > 0 && <p>About {adaptation.optionalMinutes} minutes of this week are optional extra, marked as such. Skipping them is not a miss.</p>}
      {waiting.length > 0 && (
        <details><summary>Study outside this draft ({waiting.length})</summary>
          <ul>{waiting.slice(0, 8).map(w => <li key={w.id}>{w.name} <small>· about {w.minutes} min</small></li>)}</ul>
          {waiting.length > 8 && <p>And {waiting.length - 8} more readings.</p>}
          <p className="fine-print">This draft stops at the time set aside for new study. The remaining work stays on your roadmap.</p>
        </details>
      )}
    </section>
  )
}
