'use client'

import { clockTime as timeLabel } from '../../lib/format/date'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, ClipboardCheck, Plus } from 'lucide-react'
import { CalendarEntry } from '../../lib/planning/calendarData'
import { WEEKDAY_SHORT, Weekday } from '../../lib/planning/studyWeek'
import { TaskDetailDrawer } from './TaskDetailDrawer'
import { useDragPlacement, SNAP_MINUTES } from './useDragPlacement'
import { useTaskMutation } from './useTaskMutation'
import { ConflictDialog } from './ConflictDialog'
import { UndoToast } from './UndoToast'
import { NewTaskDialog } from './NewTaskDialog'
import { useHydrated } from '../ui/WhenReady'
import { CommitmentDialog } from './CommitmentDialog'
import { NextClassDialog } from './NextClassDialog'
import { calendarClassSelectionHref, calendarSelectionHref, findCalendarTask } from '../../lib/routing/calendar'
import { BlockFace, LayerIcon, LAYER_LABEL, blockSummary, durationLabel, durationShort, entryDuration, displayTitle, sizeFor, statusOf } from './blockFace'

/**
 * A real seven-day time grid, editable.
 *
 * Timed work is positioned against an hour axis and can be dragged between days
 * and resized. Work that has a date but no confirmed hour sits in a labelled
 * band under the column rather than being given an invented clock position.
 */

const PX_PER_MINUTE = 1.0

function dayLabel(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return { weekday: WEEKDAY_SHORT[date.getUTCDay()], dayNumber: d }
}

export function CalendarWeekGrid({
  days, today, byDate, floating, earliestMinute, latestMinute, timezone, defaultView, classPattern = null, openNextClass = false, paperDate, checkpoint, readOnly = false, allowTaskCreation = true,
}: {
  days: string[]
  readOnly?: boolean
  allowTaskCreation?: boolean
  today: string
  anchorDay: Weekday
  timezone: string
  byDate: Record<string, CalendarEntry[]>
  floating: CalendarEntry[]
  earliestMinute: number
  latestMinute: number
  defaultView?: 'week' | 'agenda'
  /** Whether "Add next class" is offered at all — only meaningful for a variable schedule. */
  classPattern?: string | null
  /** Opens the dialog immediately, for a deep link from the "Add your next class" attention item. */
  openNextClass?: boolean
  /** The day the weekly paper falls on; marked even before the paper task exists. */
  paperDate?: string
  /** The student's mock, shown on its day. It is the same record the checkpoint panel edits. */
  checkpoint?: { date: string; title: string; when: string } | null
}) {
  const router = useRouter()
  const lastDay = days[days.length - 1]
  const searchParams = useSearchParams()
  const [view, setView] = useState<'week' | 'agenda'>(defaultView ?? 'week')
  const queryView = searchParams.get('view')
  useEffect(() => { if (queryView === 'week' || queryView === 'agenda') setView(queryView) }, [queryView])
  function chooseView(next: 'week' | 'agenda') {
    setView(next)
    const query = new URLSearchParams(searchParams.toString()); query.set('view', next)
    window.history.replaceState(null, '', `/app/calendar?${query}${window.location.hash}`)
  }
  const [selected, setSelected] = useState<CalendarEntry | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [creatingOn, setCreatingOn] = useState<{ date: string; startMinutes: number; untimed?: boolean } | null>(null)
  const [addingCommitment, setAddingCommitment] = useState(false)
  const [addingNextClass, setAddingNextClass] = useState(openNextClass)
  const ready = useHydrated()   // a press before then would be dropped

  // Seven 128px columns do not fit a phone; it opens on the agenda unless a view was asked for.
  useEffect(() => {
    if (!defaultView && window.matchMedia('(max-width: 760px)').matches) chooseView('agenda')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Consume the deep link without navigating away from the dialog that just opened.
  const nextClassRequested = searchParams.get('action') === 'add-next-class'
  useEffect(() => {
    if (!nextClassRequested) return
    setAddingNextClass(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('action')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [nextClassRequested])

  // Where a task has been put but the server render has not caught up yet.
  // Without this the block snaps back to its old slot on release and jumps
  // forward a moment later, which reads as the edit having failed.
  const [optimistic, setOptimistic] = useState<Record<string, { date: string; startMinutes: number; durationMinutes: number }>>({})

  const mutation = useTaskMutation()

  const allEntries = useMemo(() => {
    const map = new Map<string, CalendarEntry>()
    for (const d of days) for (const e of byDate[d] ?? []) map.set(e.id, e)
    for (const e of floating) map.set(e.id, e)
    return map
  }, [days, byDate, floating])

  // Task selection follows the URL and fresh server data; refresh and Back
  // cannot retain an old task snapshot. Commitments keep their local editor.
  const linkedTask = findCalendarTask(allEntries.values(), searchParams.get('task'))
  const linkedEntryId = searchParams.get('entry')
  const linkedEntry = linkedEntryId ? allEntries.get(linkedEntryId) : null
  const selectedEntry = linkedTask ?? (linkedEntry && !linkedEntry.isTask ? linkedEntry : null) ?? selected

  function openEntry(entry: CalendarEntry) {
    if (entry.isTask) {
      setSelected(null)
      router.push(calendarSelectionHref(searchParams.toString(), entry.id), { scroll: false })
    } else if (!readOnly && entry.commitmentId && entry.originalDate) {
      // A recurring session: the URL names the series and the ORIGINAL date; the server validates it and renders the editor.
      setSelected(null)
      router.push(calendarClassSelectionHref(searchParams.toString(), entry.commitmentId, entry.originalDate), { scroll: false })
    } else setSelected(entry)
  }

  function closeEntry() {
    setSelected(null)
    if (searchParams.has('entry')) {
      const next = new URLSearchParams(searchParams.toString()); next.delete('entry')
      window.history.replaceState(null, '', `/app/calendar?${next}`); return
    }
    // Selection is presentation only. Closing must not wait on another full Calendar read.
    if (searchParams.has('task')) window.history.replaceState(null, '', calendarSelectionHref(searchParams.toString(), null))
  }

  const drag = useDragPlacement({
    pxPerMinute: PX_PER_MINUTE,
    originMinute: earliestMinute,
    onCommit: async payload => {
      const entry = allEntries.get(payload.id)
      if (!entry) return
      const verb = payload.mode === 'resize' ? 'Resized' : 'Moved'
      setOptimistic(prev => ({
        ...prev,
        [payload.id]: { date: payload.date, startMinutes: payload.startMinutes, durationMinutes: payload.durationMinutes },
      }))
      const ok = await mutation.call(payload.id, {
        action: 'move',
        date: payload.date,
        startMinutes: payload.startMinutes,
        durationMinutes: payload.durationMinutes,
        expectedRevision: entry.revision,
      }, {
        undoMessage: payload.mode === 'resize'
          ? `${verb} to ${payload.durationMinutes} min`
          : `${verb} to ${dayLabel(payload.date).weekday} ${timeLabel(payload.startMinutes)}`,
      })
      // A refused move must snap back rather than sit in a position the server
      // rejected.
      if (!ok) setOptimistic(prev => { const next = { ...prev }; delete next[payload.id]; return next })
    },
  })

  // Once the server render agrees with an optimistic position, stop overriding.
  useEffect(() => {
    setOptimistic(prev => {
      const ids = Object.keys(prev)
      if (ids.length === 0) return prev
      let changed = false
      const next = { ...prev }
      for (const id of ids) {
        const server = allEntries.get(id)
        if (!server) continue
        const o = prev[id]
        if (server.localDate === o.date && server.startMinutes === o.startMinutes && server.durationMinutes === o.durationMinutes) {
          delete next[id]; changed = true
        }
      }
      return changed ? next : prev
    })
  }, [allEntries])

  // Escape abandons an in-flight gesture rather than committing it.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') drag.cancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drag])

  const layers = useMemo(() => {
    const present = new Set<string>()
    for (const d of days) for (const e of byDate[d] ?? []) present.add(e.layer)
    for (const e of floating) present.add(e.layer)
    return [...present].sort()
  }, [days, byDate, floating])

  const visible = (e: CalendarEntry) => !hidden.has(e.layer)

  function toggleLayer(layer: string) {
    setHidden(prev => {
      const next = new Set(prev)
      next.has(layer) ? next.delete(layer) : next.add(layer)
      return next
    })
  }

  const hourMarks: number[] = []
  for (let m = earliestMinute; m <= latestMinute; m += 60) hourMarks.push(m)
  const gridHeight = (latestMinute - earliestMinute) * PX_PER_MINUTE

  // The "now" line is client-only state: computing it during render made the server's minute differ from the client's at hydration (a style mismatch).
  const [nowMinutes, setNowMinutes] = useState<number | null>(null)
  useEffect(() => {
    const read = () => {
      try {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
        const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0), mi = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
        setNowMinutes((h === 24 ? 0 : h) * 60 + mi)
      } catch { setNowMinutes(null) }
    }
    read(); const id = setInterval(read, 60_000); return () => clearInterval(id)
  }, [timezone])

  const dayClass = (date: string) =>
    [date === today ? 'is-today' : '', date < today ? 'is-past' : '', date === paperDate ? 'is-paper' : ''].filter(Boolean).join(' ')

  /** Clicking empty grid offers to create a task at that time. */
  function onColumnClick(e: React.MouseEvent<HTMLDivElement>, date: string) {
    if (readOnly || !allowTaskCreation) return
    if (drag.drag) return
    if ((e.target as HTMLElement).closest('.calendar-event')) return
    const rect = e.currentTarget.getBoundingClientRect()
    const minutes = earliestMinute + Math.round((e.clientY - rect.top) / PX_PER_MINUTE / SNAP_MINUTES) * SNAP_MINUTES
    setCreatingOn({ date, startMinutes: Math.max(0, Math.min(23 * 60, minutes)) })
  }

  return (
    <div className="calendar">
      {!readOnly && <p className="muted cal-hint">Open a task to change its day or time.</p>}
      <div className="calendar-toolbar">
        <div className="calendar-viewswitch" role="tablist" aria-label="Calendar view" onKeyDown={event => {
          if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'week' : event.key === 'End' ? 'agenda' : view === 'week' ? 'agenda' : 'week'
          chooseView(next); event.currentTarget.querySelector<HTMLButtonElement>(`#calendar-${next}-tab`)?.focus()
        }}>
          <button type="button" id="calendar-week-tab" aria-controls="calendar-week-panel" tabIndex={view === 'week' ? 0 : -1} role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'is-active' : ''} onClick={() => chooseView('week')}>Week</button>
          <button type="button" id="calendar-agenda-tab" aria-controls="calendar-agenda-panel" tabIndex={view === 'agenda' ? 0 : -1} role="tab" aria-selected={view === 'agenda'} className={view === 'agenda' ? 'is-active' : ''} onClick={() => chooseView('agenda')}>Agenda</button>
        </div>
        <div className="calendar-toolbar__right">
          {layers.length > 1 && (
            <div className="calendar-filters">
              {layers.map(l => (
                <button type="button" key={l} className={`calendar-filter layer-${l} ${hidden.has(l) ? 'is-off' : ''}`} onClick={() => toggleLayer(l)} aria-pressed={!hidden.has(l)}>
                  <LayerIcon layer={l} size={13} /> {LAYER_LABEL[l] ?? l}
                </button>
              ))}
            </div>
          )}
          {!readOnly && allowTaskCreation && days.some(d => d >= today) && (
            <button type="button" className="secondary-button is-sm" disabled={!ready} onClick={() => setCreatingOn({ date: days.includes(today) ? today : days[0], startMinutes: 9 * 60, untimed: true })}>
              Add study task
            </button>
          )}
          {!readOnly && classPattern === 'variable' && (
            <button type="button" className="secondary-button is-sm" disabled={!ready} onClick={() => setAddingNextClass(true)}>
              Add next class
            </button>
          )}
          {!readOnly && <button type="button" className="secondary-button is-sm" disabled={!ready} onClick={() => setAddingCommitment(true)}>
            <Plus size={14} aria-hidden /> Add commitment
          </button>}
        </div>
      </div>

      {mutation.staleNotice && (
        <p className="notice notice--warn" role="status">
          <span>{mutation.staleNotice} The calendar has been refreshed with the version that was saved.</span>
        </p>
      )}
      {linkedEntryId && (!linkedEntry || linkedEntry.isTask) && <p className="notice" role="status">That calendar entry is unavailable in this week.</p>}
      {mutation.error && <p className="auth-error" role="alert">{mutation.error} {mutation.errorLink && <Link className="prose-link" href={mutation.errorLink}>Open the task and its sitting order</Link>}</p>}

      {view === 'week' ? (
        <div className="calendar-grid-wrap" id="calendar-week-panel" role="tabpanel" aria-labelledby="calendar-week-tab">
          <div className="calendar-grid" style={{ ['--grid-height' as any]: `${gridHeight}px` }}>
            <div className="calendar-corner" aria-hidden />
            {days.map(date => {
              const { weekday, dayNumber } = dayLabel(date)
              return (
                <div key={date} id={date === today ? 'calendar-today' : undefined} className={`calendar-dayhead ${dayClass(date)}`}>
                  <span className="calendar-dayhead__weekday">{weekday}</span>
                  <span className="calendar-dayhead__number">{dayNumber}</span>
                  {date === paperDate && <span className="calendar-dayhead__tag">Paper day</span>}
                  {date === checkpoint?.date && <span className="calendar-dayhead__tag">Mock</span>}
                </div>
              )
            })}

            <div className="calendar-anytime-label">Any time</div>
            {days.map(date => {
              const dayOnly = (byDate[date] ?? []).filter(visible).filter(e => e.kind === 'day')
              const paperMarker = date === paperDate && !(byDate[date] ?? []).some(e => e.taskType === 'diagnostic')
              return (
                <div key={date} className={`calendar-dayband ${dayClass(date)}`}>
                  {date === checkpoint?.date && (
                    <a href="#checkpoint" className="calendar-chip layer-mock">
                      <CalendarClock size={13} aria-hidden className="cb-icon" />
                      <span className="calendar-chip__body"><span className="calendar-chip__title">{checkpoint.title}</span><small>{checkpoint.when}</small></span>
                    </a>
                  )}
                  {paperMarker && (
                    <Link href="/app/tests" className="calendar-chip calendar-chip--paper layer-diagnostic">
                      <ClipboardCheck size={13} aria-hidden className="cb-icon" />
                      <span className="calendar-chip__body"><span className="calendar-chip__title">Weekly paper</span><small>Built from this week</small></span>
                    </Link>
                  )}
                  {dayOnly.map(e => (
                    <button type="button" key={e.id} className={`calendar-chip layer-${e.layer} ${e.execution === 'completed' ? 'is-done' : ''}`} onClick={() => openEntry(e)} aria-label={blockSummary(e)} title={e.title}>
                      <LayerIcon layer={e.layer} size={13} />
                      <span className="calendar-chip__body">
                        <span className="calendar-chip__title" title={e.title}>{displayTitle(e, true)}</span>
                        <small>{entryDuration(e,true)}{statusOf(e) === 'done' ? ' · Done' : statusOf(e) === 'partial' ? ' · Partly' : ''}</small>
                      </span>
                    </button>
                  ))}
                </div>
              )
            })}

            <div className="calendar-hours" style={{ height: gridHeight }} aria-hidden>
              {hourMarks.map(m => (
                <div key={m} className="calendar-hour-label" style={{ top: (m - earliestMinute) * PX_PER_MINUTE }}>{timeLabel(m)}</div>
              ))}
            </div>
            {days.map(date => {
              const isToday = date === today
              // While dragging, the entry follows the pointer: it renders in the
              // column it would land in, not the one it came from.
              const timed = days
                .flatMap(d => (byDate[d] ?? []))
                .filter(visible)
                .filter(e => e.kind === 'timed' && e.startMinutes !== null)
                .map(e => {
                  // A live gesture wins over an optimistic position, which wins
                  // over what the server last rendered.
                  if (drag.drag?.id === e.id) {
                    return { ...e, localDate: drag.drag.date, startMinutes: drag.drag.startMinutes, durationMinutes: drag.drag.durationMinutes }
                  }
                  const o = optimistic[e.id]
                  return o ? { ...e, localDate: o.date, startMinutes: o.startMinutes, durationMinutes: o.durationMinutes } : e
                })
                .filter(e => e.localDate === date)

              return (
                <div
                  key={date}
                  className={`calendar-column ${dayClass(date)}`}
                  style={{ height: gridHeight, cursor: readOnly || !allowTaskCreation ? 'default' : undefined }}
                  ref={el => drag.registerColumn(date, el)}
                  onClick={e => onColumnClick(e, date)}
                >
                  {hourMarks.map(m => (
                    <div key={m} className="calendar-gridline" style={{ top: (m - earliestMinute) * PX_PER_MINUTE }} aria-hidden />
                  ))}

                  {isToday && nowMinutes !== null && nowMinutes >= earliestMinute && nowMinutes <= latestMinute && (
                    <div className="calendar-now" style={{ top: (nowMinutes - earliestMinute) * PX_PER_MINUTE }} aria-label="Current time"><i /></div>
                  )}

                  {timed.map(e => {
                    const isDragging = drag.drag?.id === e.id && drag.drag.active
                    const top = ((e.startMinutes as number) - earliestMinute) * PX_PER_MINUTE
                    const height = Math.max(26, e.durationMinutes * PX_PER_MINUTE)
                    const editable = !readOnly && e.isTask && !e.isProtected && !e.isLoggedLearning
                    const state = statusOf(e)

                    return (
                      <div
                        key={e.id}
                        className={`calendar-event layer-${e.layer} ${state === 'done' ? 'is-done' : ''} ${state === 'partial' ? 'is-partial' : ''} ${e.isProtected ? 'is-fixed' : ''} ${isDragging ? 'is-dragging' : ''} ${editable ? 'is-editable' : ''}`}
                        data-size={sizeFor(height)}
                        style={{ top, height }}
                        onPointerDown={editable ? ev => drag.begin(ev, { id: e.id, date, startMinutes: e.startMinutes as number, durationMinutes: e.durationMinutes }, 'move') : undefined}
                        onPointerMove={editable ? drag.move : undefined}
                        onPointerUp={editable ? drag.finish : undefined}
                        onPointerCancel={editable ? () => drag.cancel() : undefined}
                      >
                        <button type="button"
                          className="calendar-event__open"
                          aria-label={blockSummary(e)}
                          title={e.title}
                          onClick={ev => { ev.stopPropagation(); if (!drag.drag?.active) openEntry(e) }}
                        >
                          <BlockFace entry={e} />
                        </button>
                        {editable && (
                          <span
                            className="calendar-event__resize"
                            aria-hidden
                            onPointerDown={ev => drag.begin(ev, { id: e.id, date, startMinutes: e.startMinutes as number, durationMinutes: e.durationMinutes }, 'resize')}
                            onPointerMove={drag.move}
                            onPointerUp={drag.finish}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="calendar-agenda" id="calendar-agenda-panel" role="tabpanel" aria-labelledby="calendar-agenda-tab">
          {days.map(date => {
            const { weekday, dayNumber } = dayLabel(date)
            const entries = (byDate[date] ?? []).filter(visible)
            const paperMarker = date === paperDate && !(byDate[date] ?? []).some(e => e.taskType === 'diagnostic')
            return (
              <section key={date} id={date === today ? 'calendar-today' : undefined} className={`agenda-day ${dayClass(date)}`} aria-label={`${weekday} ${dayNumber}`}>
                <div className="agenda-day__date">
                  <span>{weekday}</span>
                  <strong>{dayNumber}</strong>
                  {date === today && <em className="agenda-today">Today</em>}
                </div>
                <div className="agenda-day__items">
                  {date === checkpoint?.date && (
                    <a href="#checkpoint" className="agenda-item layer-mock">
                      <span className="agenda-item__time">Mock</span>
                      <span className="agenda-item__body"><strong><CalendarClock size={14} aria-hidden /> {checkpoint.title}</strong><small>{checkpoint.when}</small></span>
                    </a>
                  )}
                  {paperMarker && (
                    <Link href="/app/tests" className="agenda-item layer-diagnostic">
                      <span className="agenda-item__time">Paper day</span>
                      <span className="agenda-item__body">
                        <strong><ClipboardCheck size={14} aria-hidden /> Weekly paper</strong>
                        <small>Built from what you complete this week</small>
                      </span>
                    </Link>
                  )}
                  {entries.length === 0 && !paperMarker ? <p className="agenda-empty">{date < today ? 'Nothing was planned.' : 'Free'}</p> : entries.map(e => (
                    <button type="button" key={e.id} className={`agenda-item layer-${e.layer} ${e.execution === 'completed' ? 'is-done' : ''} ${e.isProtected ? 'is-fixed' : ''}`} onClick={() => openEntry(e)} aria-label={blockSummary(e)}>
                      <span className="agenda-item__time">{e.startMinutes !== null ? timeLabel(e.startMinutes) : 'Any time'}</span>
                      <span className="agenda-item__body">
                        <strong><LayerIcon layer={e.layer} size={14} /> {displayTitle(e)}</strong>
                        <small>{LAYER_LABEL[e.layer] ?? e.layer} · {entryDuration(e)}{statusOf(e) === 'done' ? ' · Done' : statusOf(e) === 'partial' ? ' · Partly done' : ''}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {floating.filter(visible).length > 0 && (
        <section className="calendar-floating" id="unplaced">
          <h3>Not yet placed</h3>
          <p className="fine-print">These belong to this week but have no date. PrepPlan leaves work floating rather than inventing a time for it.</p>
          <div className="calendar-floating__list">
            {floating.filter(visible).map(e => (
              <button type="button" key={e.id} className={`calendar-chip layer-${e.layer}`} onClick={() => openEntry(e)} aria-label={blockSummary(e)}>
                <LayerIcon layer={e.layer} size={13} />
                <span className="calendar-chip__title">{e.title}</span>
                <small>{entryDuration(e)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {selectedEntry && (
        <TaskDetailDrawer
          key={selectedEntry.id}
          entry={selectedEntry}
          readOnly={readOnly}
          days={days}
          today={today}
          onClose={closeEntry}
          mutation={mutation}
        />
      )}

      {mutation.conflict && (
        <ConflictDialog
          info={mutation.conflict}
          onPick={slot => mutation.retryAt(slot, `Moved to ${dayLabel(slot.date).weekday} ${timeLabel(slot.start)}`)}
          onClose={mutation.clear}
        />
      )}

      {mutation.warning && (
        <ConflictDialog
          info={{
            message: 'Review this placement before saving.',
            conflicts: mutation.warning.warnings,
            suggestions: [],
          }}
          confirmLabel="Place it anyway"
          onConfirm={mutation.warning.retry}
          onClose={mutation.clear}
        />
      )}

      {mutation.undo && (
        <UndoToast message={mutation.undo.detail ?? mutation.undo.message} onUndo={mutation.runUndo} onDismiss={mutation.dismissUndo} />
      )}

      {addingCommitment && (
        <CommitmentDialog defaultDate={days.includes(today) ? today : days[0]} onClose={() => setAddingCommitment(false)} />
      )}

      {addingNextClass && <NextClassDialog onClose={() => setAddingNextClass(false)} />}

      {creatingOn && (
        <NewTaskDialog
          date={creatingOn.date}
          startMinutes={creatingOn.startMinutes}
          untimed={creatingOn.untimed}
          minDate={days[0] > today ? days[0] : today > lastDay ? lastDay : today}
          maxDate={lastDay}
          onClose={() => setCreatingOn(null)}
        />
      )}
    </div>
  )
}
