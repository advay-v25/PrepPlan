'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'

function timeLabel(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

/** Adding a task by clicking an empty slot. */
export function NewTaskDialog({
  date, startMinutes, onClose,
}: {
  date: string
  startMinutes: number
  onClose: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(45)
  const [timed, setTimed] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<{ date: string; start: number; label: string }[]>([])

  const firstRef = useRef<HTMLInputElement>(null)
  const [start, setStart] = useState(startMinutes)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (title.trim().length < 2) { setError('Give it a name'); return }
    setBusy(true); setError(''); setConflict([])
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), date, startMinutes: timed ? start : null, durationMinutes: duration }),
      })
      const data = await res.json()
      if (data.ok) { router.refresh(); onClose(); return }
      setError(data.error || 'Could not add that')
      if (data.suggestions) setConflict(data.suggestions)
    } catch {
      setError('Network error')
    }
    setBusy(false)
  }

  return (
    <Dialog open onClose={onClose} title={`Add to ${date}`} initialFocusRef={firstRef}>
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <label className="field">
          <span>What is it?</span>
          <input ref={firstRef} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. FSA revenue recognition review" maxLength={120} />
        </label>

        <label className="field">
          <span>How long?</span>
          <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
            {[15, 20, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>

        <label className="checkbox-row">
          <input type="checkbox" checked={timed} onChange={e => setTimed(e.target.checked)} />
          <span>Start at {timeLabel(start)}. Uncheck to leave the time open.</span>
        </label>

        {timed && (
          <label className="field">
            <span>Start time</span>
            <input
              type="time"
              value={`${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`}
              onChange={e => {
                const [h, m] = e.target.value.split(':').map(Number)
                if (Number.isFinite(h)) setStart(h * 60 + (m || 0))
              }}
            />
          </label>
        )}

        {error && <p className="auth-error">{error}</p>}
        {conflict.length > 0 && (
          <div className="conflict-slots">
            {conflict.map((s, i) => (
              <button key={i} type="button" className="conflict-slot" onClick={() => { setStart(s.start); setError('') }}>
                <strong>{timeLabel(s.start)}</strong><small>{s.label}</small>
              </button>
            ))}
          </div>
        )}

        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Adding…</> : 'Add task'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
