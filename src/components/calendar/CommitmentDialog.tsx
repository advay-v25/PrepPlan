'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { WEEKDAY_SHORT } from '../../lib/planning/studyWeek'

/**
 * Adding a class, work block, or other fixed commitment.
 *
 * Weekly commitments store a local wall-clock time, so a 6pm class stays at 6pm
 * across a daylight-saving change instead of drifting an hour.
 */
export function CommitmentDialog({
  defaultDate, onClose,
}: {
  defaultDate: string
  onClose: () => void
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState('class')
  const [repeats, setRepeats] = useState(true)
  const [weekdays, setWeekdays] = useState<number[]>(() => {
    const [y, m, d] = defaultDate.split('-').map(Number)
    return [new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  })
  const [date, setDate] = useState(defaultDate)
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const firstRef = useRef<HTMLInputElement>(null)

  function toggleDay(d: number) {
    setWeekdays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (label.trim().length < 2) { setError('Give it a name'); return }
    if (endTime <= startTime) { setError('It has to end after it starts'); return }
    if (repeats && weekdays.length === 0) { setError('Choose at least one day'); return }

    setBusy(true); setError('')
    try {
      const res = await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          repeats
            ? { label: label.trim(), kind, recurrence: 'weekly', weekdays, startTime, endTime }
            : { label: label.trim(), kind, recurrence: 'none', date, startTime, endTime }
        ),
      })
      const data = await res.json()
      if (data.ok) { router.refresh(); onClose(); return }
      setError(data.error || 'Could not add that')
    } catch {
      setError('Network error')
    }
    setBusy(false)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a commitment"
      description="Classes, work, travel — anything fixed. Study work will not be placed on top of it."
      initialFocusRef={firstRef}
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label className="field">
          <span>What is it?</span>
          <input ref={firstRef} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. CFA evening class" maxLength={100} />
        </label>

        <label className="field">
          <span>Type</span>
          <select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="class">Class</option>
            <option value="work">Work</option>
            <option value="personal">Personal</option>
            <option value="travel">Travel</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={repeats} onChange={e => setRepeats(e.target.checked)} />
          <span>This happens every week</span>
        </label>

        {repeats ? (
          <div className="field">
            <span>On which days?</span>
            <div className="weekday-picker" role="group" aria-label="Days of the week">
              {WEEKDAY_SHORT.map((name, d) => (
                <button
                  key={d}
                  type="button"
                  className={weekdays.includes(d) ? 'is-on' : ''}
                  aria-pressed={weekdays.includes(d)}
                  onClick={() => toggleDay(d)}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className="field">
            <span>Date</span>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </label>
        )}

        <div className="drawer-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field">
            <span>From</span>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </label>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Adding…</> : 'Add commitment'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
