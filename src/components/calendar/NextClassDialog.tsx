'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'

/**
 * The one way to tell Roadmap "this is my next class" for a variable schedule.
 *
 * Distinct from the ordinary "Add commitment" dialog, which can also add a one-off class — a doubt session,
 * a makeup — but never moves the week boundary (resolvePulseWeek's anchor rule, `defines_cycle`). This is the
 * only control that sets it, so a student adding an extra session by the usual route never has their paper
 * day move by surprise.
 */
export function NextClassDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!date) { setError('Choose the date of your next class'); return }
    if (endTime <= startTime) { setError('It has to end after it starts'); return }
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/commitments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), kind: 'class', recurrence: 'none', date, startTime, endTime, isNextClass: true }),
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
      title="Add your next class"
      description="Your schedule changes week to week, so PrepPlan asks each time: when is your next class? Your paper is placed the day before it."
      initialFocusRef={firstRef}
    >
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label className="field">
          <span>Date</span>
          <input ref={firstRef} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </label>
        <div className="drawer-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label className="field">
            <span>Start</span>
            <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          </label>
          <label className="field">
            <span>End</span>
            <input type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Name (optional)</span>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. CFA evening class" maxLength={100} />
        </label>

        {error && <p className="auth-error">{error}</p>}

        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Adding…</> : 'Add class'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
