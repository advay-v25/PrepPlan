'use client'

import { clockTime as timeLabel } from '../../lib/format/date'
import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'


type Sent = { title: string; date: string; startMinutes: number | null; durationMinutes: number }
type Saved = { replayed: boolean; task: { id: string; title: string; local_date: string }; current: { title: string; local_date: string; execution: string; cancelled_at: string | null } | null }
const STATUS: Record<string, string> = { not_started: 'not started', in_progress: 'in progress', partial: 'partly done', completed: 'completed', skipped: 'skipped', deferred: 'deferred' }
const REPLY_WAIT_MS = 20000
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** What the saved result says now, in words: saved just now, or saved earlier with its present state (never "added" when nothing new was created). */
function receiptLines({ replayed, task, current }: Saved) {
  if (!replayed) return [`Added “${task.title}” on ${task.local_date}.`]
  const lines = [`“${task.title}” was already saved earlier. Nothing new was added.`]
  if (!current) lines.push('It is no longer on your Calendar: it was removed after you added it. It has not been put back.')
  else if (current.cancelled_at) lines.push('It has since been cancelled. It has not been put back.')
  else {
    lines.push(`Its status now: ${STATUS[current.execution] ?? current.execution}.`)
    if (current.local_date !== task.local_date) lines.push(`It is now on ${current.local_date}.`)
    if (current.title !== task.title) lines.push(`It is now called “${current.title}”.`)
  }
  return lines
}

/** Adding a task from the toolbar or by clicking an empty slot. The day is always chosen (and shown) explicitly. */
export function NewTaskDialog({
  date: initialDate, startMinutes, untimed = false, minDate, maxDate, onClose,
}: {
  date: string
  startMinutes: number
  /** Opened from the toolbar rather than a clicked time: start with the time left open. */
  untimed?: boolean
  minDate: string
  maxDate: string
  onClose: () => void
}) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [duration, setDuration] = useState(45)
  const [timed, setTimed] = useState(!untimed)
  // edit → pending → done | unconfirmed (reply lost: the submitted request is frozen with its key until it is known) | edit (refused)
  const [phase, setPhase] = useState<'edit' | 'pending' | 'unconfirmed' | 'done'>('edit')
  const [sent, setSent] = useState<Sent | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<{ date: string; start: number; label: string }[]>([])
  const [date, setDate] = useState(initialDate)
  const [warnings, setWarnings] = useState<string[]>([])
  // One key per request: a lost response is retried under the same key and the same payload, so the server replays instead of adding a second task.
  const key = useRef(crypto.randomUUID())
  const pending = phase === 'pending'

  const firstRef = useRef<HTMLInputElement>(null)
  // The field's own text: while a time is half-typed it reads as empty, and writing the old time back would erase what was typed.
  const [clock, setClock] = useState(() => hhmm(startMinutes))
  const [h, m] = clock.split(':').map(Number)
  const start = clock ? h * 60 + m : startMinutes
  const close = () => { if (!pending) onClose() } // a save in flight is never abandoned by Cancel, Escape or a stray click

  async function submit(e: React.FormEvent | null, acceptWarnings = false) {
    e?.preventDefault()
    if (pending || phase === 'done') return
    if (phase !== 'unconfirmed' && title.trim().length < 2) { setError('Give it a name'); return }
    // A half-typed time is stopped by the browser; an emptied one would otherwise be saved as the time the dialog opened with.
    if (phase !== 'unconfirmed' && timed && !clock) { setError('Give a start time, or untick it to leave the time open.'); return }
    // After an uncertain reply the ORIGINAL payload is resent, whatever the fields now show.
    const payload: Sent = phase === 'unconfirmed' && sent ? sent : { title: title.trim(), date, startMinutes: timed ? start : null, durationMinutes: duration }
    setSent(payload); setPhase('pending'); setError(''); setConflict([]); setWarnings([])
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), REPLY_WAIT_MS)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key.current, ...payload, acceptWarnings }),
      })
      const data = await res.json()
      if (data.ok) { setSaved({ replayed: Boolean(data.replayed), task: data.task, current: data.current ?? null }); setPhase('done'); router.refresh(); return }
      if (data.code === 'OUTCOME_UNKNOWN') { setError(data.error); setPhase('unconfirmed'); return }
      setPhase('edit')
      if (data.code === 'NEEDS_CONFIRMATION') { setWarnings((data.warnings ?? []).map((w: { title: string }) => w.title)); return }
      setError(data.error || 'Could not add that')
      if (data.suggestions) setConflict(data.suggestions)
    } catch {
      setError('We could not confirm whether it was saved. Press Retry: if it was saved you will get it back, never a second copy.')
      setPhase('unconfirmed')
    } finally { clearTimeout(timer) }
  }

  // The reviewed request is frozen while it is saving or unconfirmed, so what is retried is exactly what was sent.
  const frozen = phase === 'pending' || phase === 'unconfirmed'
  return (
    <Dialog open onClose={close} title="Add a study task" initialFocusRef={firstRef}>
      {phase === 'done' && saved ? (
        <div style={{ display: 'grid', gap: 14 }}>
          <div role="status" data-task-receipt={saved.replayed ? 'replayed' : 'created'}>
            {receiptLines(saved).map(l => <p key={l}>{l}</p>)}
          </div>
          <div className="ui-dialog__foot">
            {(!saved.replayed || saved.current) && saved.current !== undefined && (
              <Link className="secondary-button" href={`/app/calendar?week=${saved.current?.local_date ?? saved.task.local_date}&view=agenda${!saved.replayed || (saved.current && !saved.current.cancelled_at) ? `&task=${saved.task.id}` : ''}`} onClick={onClose}>Open in Calendar</Link>
            )}
            <button type="button" className="primary-button" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
      <form onSubmit={submit} style={{ display: 'grid', gap: 14 }}>
        <fieldset disabled={frozen} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 14, minWidth: 0 }}>
          <label className="field">
            <span>Day</span>
            <input type="date" value={frozen && sent ? sent.date : date} min={minDate} max={maxDate} required onChange={e => { if (e.target.value) { setDate(e.target.value); setWarnings([]) } }} />
          </label>

          <label className="field">
            <span>What is it?</span>
            <input ref={firstRef} value={frozen && sent ? sent.title : title} onChange={e => setTitle(e.target.value)} placeholder="e.g. FSA revenue recognition review" maxLength={120} />
          </label>

          <label className="field">
            <span>How long?</span>
            <select value={frozen && sent ? sent.durationMinutes : duration} onChange={e => setDuration(Number(e.target.value))}>
              {[15, 20, 30, 45, 60, 90, 120].map(m => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>

          <label className="checkbox-row">
            <input type="checkbox" checked={frozen && sent ? sent.startMinutes !== null : timed} onChange={e => setTimed(e.target.checked)} />
            <span>Start at {timeLabel(start)}. Uncheck to leave the time open.</span>
          </label>

          {(frozen && sent ? sent.startMinutes !== null : timed) && (
            <label className="field">
              <span>Start time</span>
              <input
                type="time"
                value={frozen && sent?.startMinutes != null ? hhmm(sent.startMinutes) : clock}
                onChange={e => setClock(e.target.value)}
              />
            </label>
          )}
        </fieldset>

        {error && <p className="auth-error" role="alert">{error}</p>}
        {phase === 'unconfirmed' && (
          <div className="fine-print">
            <p>Check your Calendar for “{sent?.title}” on {sent?.date} before starting a different task. Retry sends exactly the request above.</p>
            <button type="button" className="secondary-button" onClick={() => { key.current = crypto.randomUUID(); setSent(null); setPhase('edit'); setError('') }}>Start a different task</button>
          </div>
        )}
        {warnings.length > 0 && (
          <div role="alert" className="auth-error">
            {warnings.map(w => <p key={w}>{w}</p>)}
            <button type="button" className="secondary-button" disabled={pending} onClick={() => void submit(null, true)}>Add it anyway</button>
          </div>
        )}
        {conflict.length > 0 && (
          <div className="conflict-slots">
            {conflict.map((s, i) => (
              <button key={i} type="button" className="conflict-slot" onClick={() => { setClock(hhmm(s.start)); setError('') }}>
                <strong>{timeLabel(s.start)}</strong><small>{s.label}</small>
              </button>
            ))}
          </div>
        )}

        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" disabled={pending} onClick={close}>Cancel</button>
          <button type="submit" className="primary-button" disabled={pending}>
            {pending ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Adding…</> : phase === 'unconfirmed' ? 'Retry' : 'Add task'}
          </button>
        </div>
      </form>
      )}
    </Dialog>
  )
}
