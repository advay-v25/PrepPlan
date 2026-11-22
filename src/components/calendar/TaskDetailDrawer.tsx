'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useState } from 'react'
import Link from 'next/link'
import { Check, Clock, Loader2, Scissors, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { CalendarEntry } from '../../lib/planning/calendarData'
import { Dialog } from '../ui/Dialog'
import type { useTaskMutation } from './useTaskMutation'
import { durationLabel, entryDuration, timeRange } from './blockFace'
import { ContinuationNotice } from './ContinuationNotice'
import { StartButton } from '../tests/StartButton'
import { TaskLearningScope } from './TaskLearningScope'
import { calendarTaskHref, classLogHref } from '../../lib/routing/calendar'

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
  split: 'Split into sittings', partial: 'Partly done', moved: 'Moved', details_changed: 'Details updated',
}

function longDay(date: string) {
  return formatStudyDate(date, 'short')
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
  entry, days, today, onClose, mutation, readOnly = false,
}: {
  entry: CalendarEntry
  readOnly?: boolean
  days: string[]
  /** The student's local date, so unfinished work is only offered today or later. */
  today: string
  onClose: () => void
  mutation: ReturnType<typeof useTaskMutation>
}) {
  const router = useRouter()
  const [date, setDate] = useState(entry.localDate ?? '')
  const [time, setTime] = useState(minutesToTimeValue(entry.startMinutes))
  const [duration, setDuration] = useState(entry.durationMinutes)
  const [history, setHistory] = useState<any[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [asking, setAsking] = useState(false)
  const [progressKind, setProgressKind] = useState<'completed' | 'partial'>('completed')
  const [actual, setActual] = useState('')
  const [historyError, setHistoryError] = useState('')
  const [historyLoading, setHistoryLoading] = useState(false)
  // The current length is always an option, so opening the drawer and pressing Apply never resizes a task.
  const durationOptions = [...new Set([15, 20, 30, 45, 60, 90, 120, 180, entry.durationMinutes])].sort((a, b) => a - b)

  const editable = !readOnly && entry.isTask && !entry.isProtected

  async function loadHistory() {
    setShowHistory(true)
    setHistoryError('')
    setHistoryLoading(true)
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(entry.id)}`)
      const data = await res.json()
      if (data.ok) setHistory(data.history ?? [])
      else setHistoryError(data.error ?? 'History could not be loaded.')
    } catch { setHistoryError('History could not be loaded. Try again.') }
    finally { setHistoryLoading(false) }
  }

  const systemAssessment = ['diagnostic', 'recheck'].includes(entry.taskType ?? '')
  // Unfinished work can only be placed today or later (the server enforces it); earlier days stay for what is already dated there.
  const todayLocal = today
  const unfinishedFromToday = entry.execution !== 'completed'

  async function applyPlacement() {
    const startMinutes = time ? Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]) : null
    const ok = await mutation.call(entry.id, {
      action: 'move', date, startMinutes, durationMinutes: duration, expectedRevision: entry.revision,
    }, { undoMessage: entry.execution === 'deferred' ? 'Placed and open again' : 'Task updated' })
    if (ok) onClose()
  }

  async function setExecution(execution: string, label: string, actualDurationMinutes?: number) {
    const ok = await mutation.call(entry.id, {
      action: 'execution', execution, expectedRevision: entry.revision,
      ...(actualDurationMinutes !== undefined ? { actualDurationMinutes } : {}),
    }, { undoMessage: label })
    if (ok) {
      setAsking(false); setActual('')
      // Keep the saved sitting open so the student can confirm its actual
      // coverage without navigating away and losing the context.
      if (!(['completed', 'partial'].includes(execution) && ['study', 'review', 'class_consolidation', 'verification'].includes(entry.taskType ?? ''))) onClose()
    }
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
      onClose={() => { if (!mutation.busy) onClose() }}
      variant="drawer"
      eyebrow={<span className={`tag layer-tag layer-${entry.layer}`}>{LAYER_LABEL[entry.layer] ?? entry.layer}</span>}
      title={entry.title}
    >
      <fieldset disabled={mutation.busy} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      {readOnly && <p className="notice" role="status">This is recorded history. Your original week and activity are kept here.</p>}
      <dl className="task-drawer__facts">
        <div>
          <dt>When</dt>
          <dd>
            {entry.localDate ? longDay(entry.localDate) : 'Not yet placed'}
            {entry.startMinutes !== null ? ` · ${timeRange(entry.startMinutes, entry.durationMinutes)}` : entry.isLoggedLearning ? ' · recorded study' : ' · any time'}
            {` · ${entryDuration(entry)}`}
          </dd>
        </div>
        {entry.conceptName && <div><dt>Concept</dt><dd>{entry.conceptName}</dd></div>}
        {entry.origin && <div><dt>Why it is here</dt><dd>{ORIGIN_LABEL[entry.origin] ?? entry.origin}</dd></div>}
        {entry.execution && entry.execution !== 'not_started' && (
          <div><dt>Status</dt><dd style={{ textTransform: 'capitalize' }}>{entry.execution.replace('_', ' ')}</dd></div>
        )}
      </dl>

      {entry.detail && <p className="task-drawer__detail">{entry.detail}</p>}
      {entry.continuation && <ContinuationNotice info={entry.continuation} />}
      {entry.classSessionId && <Link href={classLogHref({ sessionId: entry.classSessionId })} className="prose-link">Open source class log</Link>}
      {editable && (!entry.sourceReport || entry.reading) && ['study', 'review', 'class_consolidation', 'verification'].includes(entry.taskType ?? '') && ['completed', 'partial'].includes(entry.execution ?? '') && (
        <TaskLearningScope taskId={entry.id} revision={entry.revision} />
      )}
      {entry.learningObjective && <section className="task-drawer__block"><h3>What this work covers</h3><p>{entry.learningObjective}</p></section>}
      {entry.scopeProgress && <p className="notice notice--info" role="status">
        {entry.scopeProgress.completed} of {entry.scopeProgress.total} sittings finished for this shared learning task.
        {!entry.scopeProgress.complete && ' The remaining work stays unfinished; completing one sitting does not complete the whole topic.'}
      </p>}
      {entry.rationale && <section className="task-drawer__block"><h3>Why this, now</h3><p>{entry.rationale}</p></section>}
      {entry.suggestedApproach && <section className="task-drawer__block"><h3>How to approach it</h3><p>{entry.suggestedApproach}</p></section>}
      {entry.completionMeaning && <section className="task-drawer__block"><h3>What done means</h3><p>{entry.completionMeaning}</p></section>}
      {entry.sourceReport && (
          <section className="task-drawer__block" data-testid="task-source-report"><h3>From your mock report</h3>
            <p>Planned from your own mock report (version {entry.sourceReport.plannedFromVersion ?? '?'}). It is your report, not test evidence.
              {entry.sourceReport.status === 'withdrawn' ? ' You have since withdrawn that report; this sitting stays in your plan until you change it.' : entry.sourceReport.currentVersion !== null && entry.sourceReport.plannedFromVersion !== null && entry.sourceReport.currentVersion !== entry.sourceReport.plannedFromVersion ? ' That report has been edited since; this sitting is unchanged, and you can review a new plan from the report.' : ''}{' '}
              <a href={`/app/calendar/mock-report/${entry.sourceReport.id}`}>Open the report</a>{' · '}<a href={`/app/coach?report=${entry.sourceReport.id}&q=${encodeURIComponent('How should I work on this mock report?')}`} data-testid="task-source-coach">Ask the Coach about that report</a></p>
          </section>
        )}
      {(entry.sittingOrdinal || (entry.follows?.length ?? 0) > 0) && (
        <section className="task-drawer__block" data-testid="task-order"><h3>Order</h3>
          <p>{entry.sittingOrdinal ? `Sitting ${entry.sittingOrdinal} of this work. ` : ''}{entry.follows && entry.follows.length > 0 ? `Do it after “${entry.follows.map(f => f.title).join('”, “')}”. ` : 'It is the first sitting. '}{entry.kind === 'day' ? 'It has no set time: it is planned for the day, in this order. Give it a time in Calendar when you know it.' : ''}</p>
          {entry.follows?.map(f => <p key={f.id}><Link className="prose-link" href={calendarTaskHref(f.id, f.date ?? undefined)}>Open {f.title}</Link></p>)}
        </section>
      )}
      {entry.verificationIntent && <section className="task-drawer__block" data-testid="task-verification"><h3>How it can be checked</h3><p>{entry.verificationIntent}</p></section>}
      {entry.reading && (
        <p className="fine-print" data-testid="task-reading-links">
          {entry.reading.topicId ? <Link href={`/app/curriculum/${entry.reading.topicId}/${entry.reading.id}`} className="prose-link">Open {entry.reading.label} in Curriculum</Link> : entry.reading.label}
          {' · '}<Link href="/app/tests" className="prose-link">See what this week’s paper covers</Link>
        </p>
      )}

      {editable && !entry.isLoggedLearning && (
        <>
          <section className="task-drawer__block">
            <h3>Record what happened</h3>
            <div className="drawer-actions-grid">
              {systemAssessment && <p className="fine-print">This is completed by taking and scoring it, not by marking it done. {entry.taskType === 'recheck' ? 'Start or resume it with the button at the bottom of this panel.' : <><a className="prose-link" href="/app/tests">Start or resume it in Tests</a>.</>}</p>}
              {!done && !systemAssessment && (
                <button type="button" className="primary-button" onClick={() => { setProgressKind('completed'); setAsking(true) }} disabled={mutation.busy || asking}>
                  <Check size={15} aria-hidden /> Done
                </button>
              )}
              {done && !systemAssessment && (
                <button type="button" className="secondary-button" onClick={() => setExecution('not_started', 'Reopened')} disabled={mutation.busy}>
                  Reopen
                </button>
              )}
              {!systemAssessment && <button type="button" className="secondary-button" onClick={() => { setProgressKind('partial'); setAsking(true) }} disabled={mutation.busy || asking}>
                <Clock size={15} aria-hidden /> Partly done
              </button>}
              <button type="button" className="secondary-button" onClick={() => setExecution('deferred', 'Deferred')} disabled={mutation.busy}>
                Defer
              </button>
              <button type="button" className="secondary-button" onClick={split} disabled={mutation.busy || entry.durationMinutes < 30 || !['study', 'review', 'class_consolidation'].includes(entry.taskType ?? '') || !['not_started', 'in_progress', 'partial'].includes(entry.execution ?? '')}>
                <Scissors size={15} aria-hidden /> Split in two
              </button>
            </div>
            {asking && (
              <form className="drawer-ask" onSubmit={e => {
                e.preventDefault()
                const n = Number(actual)
                if (actual.trim() && (!Number.isInteger(n) || n < 0 || n > 1440)) { mutation.setError('Use whole minutes from 0 to 1440, or leave this blank.'); return }
                setExecution(progressKind, progressKind === 'completed' ? 'Marked complete' : 'Marked partly done', actual.trim() ? n : undefined)
              }}>
                <label className="field">
                  <span>Minutes studied since your last update <em>Optional</em></span>
                  <input type="number" min={0} max={1440} step={1} inputMode="numeric" autoFocus value={actual} onChange={e => setActual(e.target.value)} placeholder="Leave blank if unknown" aria-label="Actual minutes" />
                </label>
                <button type="submit" className="primary-button" disabled={mutation.busy}>{progressKind === 'completed' ? 'Save as done' : 'Save partial progress'}</button>
                <button type="button" className="text-button" onClick={() => { setAsking(false); setActual('') }}>Cancel</button>
              </form>
            )}
            <p className="fine-print" style={{ marginTop: 8 }}>
              Record only new minutes, not a running total. Splitting keeps the same learning scope and total planned time;
              the new sitting goes to unplaced work for you to schedule.
            </p>
          </section>
          <section className="task-drawer__block">
            <h3>{entry.execution === 'deferred' ? 'Choose another time' : 'Move or resize'}</h3>
            {entry.execution === 'deferred' && <p className="fine-print">Placing it puts it back in your plan as open work. What you reported and its reading are kept.</p>}
            <div className="drawer-fields">
              <label className="field">
                <span>Day</span>
                <select value={date} onChange={e => setDate(e.target.value)}>
                  <option value="" disabled>Choose a day</option>
                  {days.filter(d => !unfinishedFromToday || d >= todayLocal || d === entry.localDate).map(d => <option key={d} value={d}>{longDay(d)}</option>)}
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
            <button type="button" className="primary-button" onClick={applyPlacement} disabled={mutation.busy || !date} style={{ marginTop: 10 }}>
              {mutation.busy ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : entry.execution === 'deferred' ? 'Place it and reopen' : 'Apply'}
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
        {isDiagnostic && !readOnly && <Link href="/app/tests" className="primary-button">Go to diagnostics</Link>}
        {!readOnly && entry.taskType === 'recheck' && entry.isTask && entry.execution !== 'completed' && (
          <StartButton className="primary-button" label={entry.attemptId ? 'Resume re-check' : 'Start re-check'} body={{ kind: 'repair', checkTaskId: entry.id }} />
        )}
        {entry.taskType === 'review' && entry.isTask && entry.reading?.topicId && entry.localDate && (
          // A revision session for this reading: the student's own recall cards for it, with the exact way back to THIS task. Practising cards is the student's own report:
          // it does not complete this task, confirm outcomes, add evidence or move anything in the plan.
          <Link href={`/app/curriculum/${entry.reading.topicId}/${entry.reading.id}?tab=cards&return=${encodeURIComponent(`/app/calendar?view=agenda&week=${entry.localDate}&task=${entry.id}`)}`} className="secondary-button">Practise your recall cards for this reading</Link>
        )}
        {entry.attemptId && entry.taskType !== 'recheck' && (
          <Link href={`/app/tests/${entry.attemptId}/result`} className="secondary-button">See the result that caused this</Link>
        )}
        {entry.isTask && !showHistory && (
          <button type="button" className="text-button" onClick={loadHistory}>What changed on this task?</button>
        )}
      </div>

      {showHistory && (
        <section className="task-drawer__block">
          <h3>History</h3>
          {historyLoading ? <p role="status" className="fine-print">Loading history…</p> : historyError ? <p role="alert" className="auth-error">{historyError} <button type="button" className="text-button" onClick={loadHistory}>Try again</button></p> : history.length === 0 ? (
            <p className="fine-print">No changes recorded yet.</p>
          ) : (
            <ol className="task-history">
              {history.map(h => (
                <li key={h.id}>
                  <strong>{EVENT_LABEL[h.event_type] ?? h.event_type}</strong>
                  <small>{new Date(h.created_at).toLocaleString()}</small>
                  {h.actual_duration_minutes !== null && h.actual_duration_minutes !== undefined && <em>{h.actual_duration_minutes} min recorded</em>}
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
              <p className="fine-print">{entry.isLoggedLearning ? 'Remove this log from active coverage and study totals? Its audit history is retained.' : 'Remove this task and its activity history?'} {entry.scopeProgress && 'Removing one sitting leaves the shared learning scope unfinished.'}</p>
              <div className="drawer-actions-grid">
                <button type="button" className="secondary-button" onClick={() => setConfirmDelete(false)}>Keep it</button>
                <button type="button" className="secondary-button is-danger" onClick={remove}><Trash2 size={15} aria-hidden /> Remove</button>
              </div>
            </>
          ) : (
            <button type="button" className="text-button is-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} aria-hidden /> {entry.isLoggedLearning ? 'Remove this learning log' : 'Remove this task'}
            </button>
          )}
        </div>
      )}

      {mutation.error && <p className="auth-error" role="alert">{mutation.error} {mutation.errorLink && <Link className="prose-link" href={mutation.errorLink}>Open the task and its sitting order</Link>}</p>}
      </fieldset>
    </Dialog>
  )
}
