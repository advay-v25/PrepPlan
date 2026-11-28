'use client'

import { useState } from 'react'
import type { ExtraTime } from '../../lib/planning/weeklyReview/service'
import { formatStudyDate } from '../../lib/format/date'

export type WindowInput = { date: string; start: string; end: string }

/**
 * Specific extra time for the proposed week only. Each added window rebuilds the draft and shows what it takes; nothing is saved until the review is,
 * and the usual weekly availability is not changed.
 */
export function ExtraTimePanel({ extra, dates, windows, busy, onChange, useLeftover, onUseLeftover }: { extra: ExtraTime | null | undefined; dates: string[]; windows: WindowInput[]; busy: boolean; onChange: (w: WindowInput[]) => void; useLeftover: boolean; onUseLeftover: (v: boolean) => void }) {
  const [date, setDate] = useState(dates[0] ?? '')
  const [start, setStart] = useState('07:00')
  const [end, setEnd] = useState('08:00')
  if (!extra && !windows.length) return null
  return (
    <section className="verdict verdict--neutral" aria-labelledby="extra-time-h" data-testid="extra-time">
      <h3 id="extra-time-h">Add time this week</h3>
      <p className="fine-print">One-off windows for this week only. They are saved with the work placed in them when you save the review; your usual availability stays as it is.</p>
      <label className="review-ack"><input type="checkbox" checked={useLeftover} disabled={busy} onChange={e => onUseLeftover(e.target.checked)} /> After the work you are catching up and any mock, offer leftover time to new study or revision (optional).</label>
      <div className="extra-time__form">
        <label>Day <select value={date} onChange={e => setDate(e.target.value)}>{dates.map(d => <option key={d} value={d}>{formatStudyDate(d, 'short')}</option>)}</select></label>{' '}
        <label>From <input type="time" step={300} value={start} onChange={e => setStart(e.target.value)} /></label>{' '}
        <label>To <input type="time" step={300} value={end} onChange={e => setEnd(e.target.value)} /></label>{' '}
        <button type="button" className="secondary-button" disabled={busy || !date || !start || !end || windows.length >= 7} onClick={() => onChange([...windows, { date, start, end }])}>Add this window</button>
      </div>
      {(!start || !end) && <p className="fine-print" role="status">Finish both times to add this window.</p>}
      {windows.length > 0 && <ul className="verdict-options" data-testid="extra-time-windows">
        {windows.map((w, i) => {
          const shown = extra?.windows.find(x => x.date === w.date && x.start === w.start && x.end === w.end)
          return <li key={`${w.date}${w.start}`}><strong>{formatStudyDate(w.date, 'short')} {w.start}–{w.end}:</strong>{' '}
            {shown ? shown.items.length ? `${shown.items.map(x => `${x.isNew ? 'New, optional: ' : ''}${x.title}, ${x.minutes} min at ${x.start}`).join('; ')}.${shown.unusedMinutes ? ` ${shown.unusedMinutes} min unused.` : ''}` : 'Nothing waiting fits in it.' : 'Not in the draft yet.'}{' '}
            <button type="button" className="text-button" disabled={busy} onClick={() => onChange(windows.filter((_, k) => k !== i))}>Remove {w.start}</button></li>
        })}
      </ul>}
      {extra && <>
        {extra.waiting.length > 0 && <ul className="verdict-options" data-testid="extra-time-waiting">{extra.waiting.map((w, i) => <li key={i}><strong>Still waiting:</strong> {w.title}{w.minutes > 0 ? `, ${w.minutes} min` : ''}. {w.reason}</li>)}</ul>}
        <ul className="verdict-options" data-testid="extra-time-impact">{extra.impact.map(x => <li key={x}>{x}</li>)}</ul>
      </>}
    </section>
  )
}
