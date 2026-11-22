'use client'

import { useState } from 'react'
import { CALENDAR_EXPORT_PATH } from '../../lib/calendar/ics'

type Preview = { events: number; timed: number; allDay: number; excludedUnplaced: number; excludedHistory: number; excludedClasses: number }

/** Download a one-way .ics snapshot. Counts first; an error is shown, never saved as a calendar file. */
export function CalendarExport({ initialFrom, initialTo }: { initialFrom: string; initialTo: string }) {
  const [from, setFrom] = useState(initialFrom), [to, setTo] = useState(initialTo)
  const [classes, setClasses] = useState(false), [history, setHistory] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [preview, setPreview] = useState<Preview | null>(null)
  const qs = (extra = '') => `from=${from}&to=${to}${classes ? '&classes=1' : ''}${history ? '&history=1' : ''}${extra}`

  async function run(kind: 'preview' | 'download') {
    setBusy(true); setError('')
    try {
      const res = await fetch(`${CALENDAR_EXPORT_PATH}?${qs(kind === 'preview' ? '&preview=1' : '')}`)
      if (!res.ok) { const b = await res.json().catch(() => null); setError(b?.error ?? 'The calendar could not be prepared.'); return }
      if (kind === 'preview') { setPreview((await res.json()).preview); return }
      const blob = await res.blob(), a = document.createElement('a')
      a.href = URL.createObjectURL(blob); a.download = `roadmap-schedule-${from}-to-${to}.ics`; a.click(); URL.revokeObjectURL(a.href)
    } catch { setError('Could not reach Roadmap. Nothing was downloaded.') } finally { setBusy(false) }
  }

  return (
    <div className="calendar-export" data-calendar-export>
      <p className="fine-print">A snapshot of your accepted schedule as a calendar file. It does not update when Roadmap changes, and importing it again may duplicate events in some calendar apps.</p>
      <div className="calendar-export__row">
        <label>From <input type="date" disabled={busy} value={from} onChange={e => { setFrom(e.target.value); setPreview(null) }} /></label>
        <label>To <input type="date" disabled={busy} value={to} onChange={e => { setTo(e.target.value); setPreview(null) }} /></label>
      </div>
      <label className="ob-check"><input type="checkbox" disabled={busy} checked={classes} onChange={e => { setClasses(e.target.checked); setPreview(null) }} /> <span>Include my classes and fixed commitments</span></label>
      <label className="ob-check"><input type="checkbox" disabled={busy} checked={history} onChange={e => { setHistory(e.target.checked); setPreview(null) }} /> <span>Include work I have already done (marked “done”)</span></label>
      <div className="calendar-export__actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={() => run('preview')}>Preview</button>
        <button type="button" className="primary-button" disabled={busy} onClick={() => run('download')}>{busy ? 'Preparing…' : 'Download .ics'}</button>
      </div>
      {preview && (
        <p role="status" data-export-preview>
          {preview.events} event{preview.events === 1 ? '' : 's'} ({preview.timed} timed, {preview.allDay} all-day reminder{preview.allDay === 1 ? '' : 's'}).
          {preview.excludedUnplaced > 0 && <> {preview.excludedUnplaced} unplaced task{preview.excludedUnplaced === 1 ? ' has' : 's have'} no time, so {preview.excludedUnplaced === 1 ? 'it is' : 'they are'} not included — <a href="/app/calendar">place {preview.excludedUnplaced === 1 ? 'it' : 'them'} in Calendar</a>.</>}
        </p>
      )}
      {error && <p role="alert" className="review-error">{error}</p>}
    </div>
  )
}
