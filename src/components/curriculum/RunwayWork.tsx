import Link from 'next/link'
import type { ForecastWeek, PlacedWork, WorkItem } from '../../lib/exam/runwayForecast'

const hrs = (m: number) => `${Math.round((m / 60) * 10) / 10} h`

/** The named work the planner can finish before the mock runway, and the usable time it rests on. Weeks after the proposed one are labelled forecasts. */
export function RunwayWork({ placed, waiting, weeks, testId }: { placed: PlacedWork[]; waiting: WorkItem[]; weeks: ForecastWeek[]; testId: string }) {
  return (
    <div data-testid={testId}>
      <ul className="verdict-options">
        {placed.slice(0, 6).map(w => <li key={w.href}><strong>Finish before the mock ({w.forecast ? `forecast: week ${w.week}` : 'this proposed week'}):</strong> <Link href={w.href}>{w.name}</Link>, about {w.minutes} min.</li>)}
        {placed.length > 6 && <li>And {placed.length - 6} more.</li>}
        {waiting.slice(0, 4).map(w => <li key={w.href}><strong>Continues after the mock:</strong> <Link href={w.href}>{w.name}</Link>, about {w.minutes} min.</li>)}
      </ul>
      {weeks.length > 0 && <ul className="verdict-options" aria-label="Usable study time before the mock runway">
        {weeks.slice(0, 6).map(w => <li key={w.week} className="fine-print">{w.forecast ? `Forecast, week ${w.week} from ${w.start}` : `Proposed week from ${w.start}`}: {hrs(w.usableMinutes)} usable after commitments and planned work.</li>)}
        {weeks.length > 6 && <li className="fine-print">Forecast: {weeks.length - 6} later week{weeks.length - 6 === 1 ? '' : 's'}.</li>}
      </ul>}
    </div>
  )
}
