'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Clock, Loader2, Scissors, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CalendarEntry } from '../../lib/planning/calendarData'
import { Dialog } from '../ui/Dialog'
import type { useTaskMutation } from './useTaskMutation'
import { durationLabel, timeRange } from './blockFace'

const LAYER_LABEL: Record<string, string> = {
  commitment: 'Protected commitment', class: 'Class', study: 'Study', review: 'Review',
  diagnostic: 'Diagnostic', repair: 'Repair', recheck: 'Re-check', mock: 'Mock', other: 'Task',
}

const ORIGIN_LABEL: Record<string, string> = {
  planner: 'Placed by the weekly planner',
  roadmap: 'Comes from your long-term roadmap',
  class: 'Follows one of your classes',
  diagnostic: 'Created by diagnostic evidence',
  student: 'You added this',
  coach: 'Proposed by Coach and accepted',
}

const EVENT_LABEL: Record<string, string> = {
  created: 'Created', started: 'Started', partial_progress: 'Partly done',
  completed: 'Completed', skipped: 'Skipped', deferred: 'Deferred',
  placement_changed: 'Moved', duration_changed: 'Length changed',
  scope_split: 'Split in two', restored: 'Reopened', undone: 'Undone', deleted: 'Removed',
}

function longDay(date: string) {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))
}

function minutesToTimeValue(minutes: number | null) {
  if (minutes === null) return ''
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * What a task is, why it is in this week, and everything that can be done to it.
 *
 * This is also the keyboard path to every edit that dragging performs: date,
 * time and length are fields here, so the calendar is fully operable without a
 * pointer.
 */
export function TaskDetailDrawer({
  entry, days, onClose, mutation,
}: {
  entry: CalendarEntry
  days: string[]
  onClose: () => void
  mutation: ReturnType<typeof useTaskMutation>
}) {
  const router = useRouter()
  const [date, setDate] = useState(entry.localDate ?? days[0])
  const [time, setTime] = useState(minutesToTimeValue(entry.startMinutes))
  const [duration, setDuration] = useState(entry.durationMinutes)
  const [history, setHistory] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [asking, setAsking] = useState(false)
  const [actual, setActual] = useState('')
  // The current length is always an option, so opening the drawer and pressing Apply never resizes a task.
  const durationOptions = [...new Set([15, 20, 30, 45, 60, 90, 120, 180, entry.durationMinutes])].sort((a, b) => a - b)

  const editable = entry.isTask && !entry.isProtected

  async function loadHistory() {
    setShowHistory(true)
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(entry.id)}`)
      const data = await res.json()
      if (data.ok) setHistory(data.history ?? [])
    } catch { /* history is supplementary; failing to load it is not an error worth blocking on */ }
  }

  async function applyPlacement() {
    const startMinutes = time ? Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]) : null
    const ok = await mutation.call(entry.id, {
      action: 'move', date, startMinutes, durationMinutes: duration, expectedRevision: entry.revision,
    }, { undoMessage: 'Task updated' })
    if (ok) onClose()
  }

  async function setExecution(execution: string, label: string, actualDurationMinutes?: number) {
    const ok = await mutation.call(entry.id, {
      action: 'execution', execution, expectedRevision: entry.revision,
      ...(actualDurationMinutes !== undefined ? { actualDurationMinutes } : {}),
    }, { undoMessage: label })
    if (ok) onClose()
  }

  async function split() {
    const ok = await mutation.call(entry.id, { action: 'split', expectedRevision: entry.revision })
    if (ok) onClose()
  }

  async function remove() {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(entry.id)}?expectedRevision=${entry.revision}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.ok) { router.refresh(); onClose() }
      else mutation.setError(data.error || 'Could not remove that')
    } catch { mutation.setError('Network error') }
  }

  const isDiagnostic = entry.taskType === 'diagnostic'
  const done = entry.execution === 'completed'

  return (
    <Dialog
      open
      onClose={onClose}
      variant="drawer"
      eyebrow={<span className={`tag layer-tag layer-${entry.layer}`}>{LAYER_LABEL[entry.layer] ?? entry.layer}</span>}
      title={entry.title}
    >
      <dl className="task-drawer__facts">
        <div>
          <dt>When</dt>
          <dd>
            {entry.localDate ? longDay(entry.localDate) : 'Not yet placed'}
            {entry.startMinutes !== null ? ` · ${timeRange(entry.startMinutes, entry.durationMinutes)}` : ' · any time'}
            {` · ${durationLabel(entry.durationMinutes)}`}
          </dd>
        </div>
        {entry.conceptName && <div><dt>Concept</dt><dd>{entry.conceptName}</dd></div>}
        {entry.origin && <div><dt>Why it is here</dt><dd>{ORIGIN_LABEL[entry.origin] ?? entry.origin}</dd></div>}
        {entry.execution && entry.execution !== 'not_started' && (
          <div><dt>Status</dt><dd style={{ textTransform: 'capitalize' }}>{entry.execution.replace('_', ' ')}</dd></div>
        )}
      </dl>

      {entry.detail && <p className="task-drawer__detail">{entry.detail}</p>}
      {entry.rationale && <section className="task-drawer__block"><h3>Why this, now</h3><p>{entry.rationale}</p></section>}
      {entry.suggestedApproach && <section className="task-drawer__block"><h3>How to approach it</h3><p>{entry.suggestedApproach}</p></section>}
      {entry.completionMeaning && <section className="task-drawer__block"><h3>What done means</h3><p>{entry.completionMeaning}</p></section>}

      {editable && (
        <>
          <section className="task-drawer__block">
            <h3>Record what happened</h3>
            <div className="drawer-actions-grid">
              {!done && (
                <button className="primary-button" onClick={() => setAsking(true)} disabled={mutation.busy || asking}>
                  <Check size={15} aria-hidden /> Done
                </button>
              )}
              {done && (
                <button className="secondary-button" onClick={() => setExecution('not_started', 'Reopened')} disabled={mutation.busy}>
                  Reopen
                </button>
              )}
              <button className="secondary-button" onClick={() => setExecution('partial', 'Marked partly done')} disabled={mutation.busy}>
                <Clock size={15} aria-hidden /> Partly done
              </button>
              <button className="secondary-button" onClick={() => setExecution('deferred', 'Deferred')} disabled={mutation.busy}>
                Defer
              </button>
              <button className="secondary-button" onClick={split} disabled={mutation.busy || entry.durationMinutes < 30}>
                <Scissors size={15} aria-hidden /> Split in two
              </button>
            </div>
            {asking && (
              <form className="drawer-ask" onSubmit={e => {
                e.preventDefault()
                const n = Number(actual)
                setExecution('completed', 'Marked complete', actual.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : undefined)
              }}>
                <label className="field">
                  <span>How long did it actually take? <em>Optional</em></span>
                  <input inputMode="numeric" autoFocus value={actual} onChange={e => setActual(e.target.value)} placeholder={`${entry.durationMinutes}`} aria-label="Actual minutes" />
                </label>
                <button className="primary-button" disabled={mutation.busy}>Save as done</button>
                <button type="button" className="text-button" onClick={() => { setAsking(false); setActual('') }}>Cancel</button>
              </form>
            )}
            <p className="fine-print" style={{ marginTop: 8 }}>
              Partly done stays partly done. Splitting keeps the whole scope — it changes how many sittings
              it takes, not how much there is.
            </p>
          </section>
          <section className="task-drawer__block">
            <h3>Move or resize</h3>
            <div className="drawer-fields">
              <label className="field">
                <span>Day</span>
                <select value={date} onChange={e => setDate(e.target.value)}>
                  {days.map(d => <option key={d} value={d}>{longDay(d)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Start</span>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} />
              </label>
              <label className="field">
                <span>Length</span>
                <select value={duration} onChange={e => setDuration(Number(e.target.value))}>
                  {durationOptions.map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
                </select>
              </label>
            </div>
            <p className="fine-print" style={{ marginTop: 8 }}>
              Clear the start time to keep the day but leave the hour open.
            </p>
            <button className="primary-button" onClick={applyPlacement} disabled={mutation.busy} style={{ marginTop: 10 }}>
              {mutation.busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : 'Apply'}
            </button>
          </section>

        </>
      )}

      {entry.isProtected && (
        <p className="notice notice--info" style={{ margin: 0 }}>
          <span>This is a protected commitment. Study work will not be placed on top of it.</span>
        </p>
      )}

      <div className="task-drawer__actions">
        {isDiagnostic && <Link href="/app/tests" className="primary-button">Go to diagnostics</Link>}
        {entry.attemptId && (
          <Link href={`/app/tests/${entry.attemptId}/result`} className="secondary-button">See the result that caused this</Link>
        )}
        {entry.isTask && !showHistory && (
          <button className="text-button" onClick={loadHistory}>What changed on this task?</button>
        )}
      </div>

      {showHistory && (
        <section className="task-drawer__block">
          <h3>History</h3>
          {history.length === 0 ? (
            <p className="fine-print">No changes recorded yet.</p>
          ) : (
            <ol className="task-history">
              {history.map(h => (
                <li key={h.id}>
                  <strong>{EVENT_LABEL[h.event_type] ?? h.event_type}</strong>
                  <small>{new Date(h.created_at).toLocaleString()}</small>
                  {h.previous?.local_date && h.payload?.local_date && h.previous.local_date !== h.payload.local_date && (
                    <em>{h.previous.local_date} → {h.payload.local_date}</em>
                  )}
                  {h.previous?.duration_minutes && h.payload?.duration_minutes && h.previous.duration_minutes !== h.payload.duration_minutes && (
                    <em>{h.previous.duration_minutes} → {h.payload.duration_minutes} min</em>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {editable && (
        <div className="task-drawer__danger">
          {confirmDelete ? (
            <>
              <p className="fine-print">Remove this task from the calendar? Its history is kept.</p>
              <div className="drawer-actions-grid">
                <button className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep it</button>
                <button className="secondary-button is-danger" onClick={remove}><Trash2 size={15} aria-hidden /> Remove</button>
              </div>
            </>
          ) : (
            <button className="text-button is-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden /> Remove this task
            </button>
          )}
        </div>
      )}

      {mutation.error && <p className="auth-error">{mutation.error}</p>}
    </Dialog>
  )
}
