'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { useHydrated, WhenReady } from '../ui/WhenReady'
import { WEEKDAY_SHORT } from '../../lib/planning/studyWeek'
import { calendarReviewHref, calendarTaskHref } from '../../lib/routing/calendar'
import type { OccurrenceSelection } from '../../lib/planning/classOccurrence'

type Mode = 'move' | 'cancel' | 'restore' | 'future'
type Affected = { id: string; title: string; date: string; startsAt: string; minutes: number; execution: string; canMove: boolean }
type Preview = { token: string; fingerprint: string; preview: { changes: any[]; conflicts: { title: string; date?: string }[]; affectedTasks: Affected[]; inertExceptions: { occurrenceDate: string }[]; carriedExceptions: unknown[] } }

const day = (d: string) => formatStudyDate(d, 'short')
const hm = (t: unknown) => String(t ?? '').slice(0, 5)
const newKey = () => `cls-${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/-/g, '').slice(0, 40)}`

/**
 * One class session: change this class only (move or cancel), restore it, or change this and future classes from a chosen date.
 * Always preview first (read-only), then confirm: the confirm carries a bound operation key and the previewed fingerprint, so a double click
 * or a lost response resolves to one outcome and a stale preview is refused with the form kept.
 */
export function ClassOccurrenceDialog({ selection: s, closeHref, logHref, saved }: { selection: OccurrenceSelection; closeHref: string; logHref?: string; saved?: boolean }) {
  const router = useRouter()
  const exception = s.state !== 'regular'
  const [mode, setMode] = useState<Mode>(exception && s.state === 'skipped' ? 'restore' : 'move')
  const [moveDate, setMoveDate] = useState(s.current?.date ?? s.occurrence)
  const [moveStart, setMoveStart] = useState(s.current?.start ?? s.startTime)
  const [moveEnd, setMoveEnd] = useState(s.current?.end ?? s.endTime)
  const [from, setFrom] = useState(s.occurrence > s.today ? s.occurrence : s.today)
  const [weekdays, setWeekdays] = useState<number[]>(s.weekdays)
  const [fStart, setFStart] = useState(s.startTime)
  const [fEnd, setFEnd] = useState(s.endTime)
  const [ack, setAck] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [opKey, setOpKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null)
  const [error, setError] = useState('')
  const [retryable, setRetryable] = useState(false)
  const [done, setDone] = useState<{ affected: Affected[]; replayed: boolean; action: string } | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  const ready = useHydrated()
  // Opened by a link, the dialog is on screen before it can take input: focus goes to the first control once it can.
  useEffect(() => { if (ready) firstRef.current?.focus() }, [ready])

  const close = () => router.replace(closeHref, { scroll: false })
  const edited = () => { setPreview(null); setOpKey(null); setError(''); setRetryable(false) }

  const body = (): Record<string, unknown> => mode === 'move' ? { action: 'occurrence_move', occurrenceDate: s.occurrence, newDate: moveDate, newStartTime: moveStart, newEndTime: moveEnd }
    : mode === 'cancel' ? { action: 'occurrence_cancel', occurrenceDate: s.occurrence }
    : mode === 'restore' ? { action: 'occurrence_restore', occurrenceDate: s.occurrence }
    : { action: 'series_from', effectiveFrom: from, weekdays, startTime: fStart, endTime: fEnd }

  async function runPreview() {
    setBusy('preview'); setError(''); setRetryable(false)
    try {
      const res = await fetch(`/api/commitments/${s.commitmentId}/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body(), expectedToken: s.token }) })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) { setPreview(data); setOpKey(newKey()); setAck(false) }
      else if (data?.code === 'STALE_SOURCE') setError('This class changed since you opened it. Close this and open it again to see its current state.')
      else setError(data?.error || 'Could not preview that. Nothing was changed.')
    } catch { setError('Could not reach your calendar. Nothing was changed. Try again.') }
    setBusy(null)
  }

  async function confirm() {
    if (!preview || !opKey) return
    setBusy('confirm'); setError(''); setRetryable(false)
    try {
      const res = await fetch(`/api/commitments/${s.commitmentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body(), operationKey: opKey, fingerprint: preview.fingerprint, expectedToken: preview.token, acknowledgeExceptions: ack }) })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) { setDone({ affected: data.affectedTasks ?? [], replayed: Boolean(data.replayed), action: data.action }) }  // the page re-renders when the dialog closes or a link is followed (this series' old date may stop being valid, so no refresh underneath it)
      else if (data?.code === 'STALE_PREVIEW' || data?.code === 'STALE_SOURCE') { setPreview(null); setOpKey(null); setError('This changed since you previewed it, so nothing was saved. Your entries are kept. Preview again to see the current effect.') }
      else if (data?.code === 'CONFLICT' || data?.code === 'BOOKING_CONFLICT') { setPreview(null); setOpKey(null); setError(data.error || 'That would overlap a booked mock. Nothing was saved. Choose another time, or move the mock first.') }
      else if (res.status >= 500 || !data) { setRetryable(true); setError('We could not confirm whether that saved. Retry: the same request cannot apply twice.') }
      else setError(data.error || 'Could not save that.')
    } catch { setRetryable(true); setError('We could not confirm whether that saved (no response). Retry: the same request cannot apply twice.') }
    setBusy(null)
  }

  const conflicts = preview?.preview.conflicts ?? []
  const inert = preview?.preview.inertExceptions ?? []
  const canConfirm = Boolean(preview) && conflicts.length === 0 && (inert.length === 0 || ack)

  if (done) {
    const movable = done.affected.filter(a => a.canMove)
    return (
      <Dialog open onClose={close} title="Class updated" description={done.replayed ? 'That change had already been saved.' : undefined}>
        <div style={{ display: 'grid', gap: 12 }} data-testid="class-change-done">
          <p role="status">Your class change is saved. Earlier classes and everything already recorded are unchanged.</p>
          {done.affected.length > 0 ? (
            <section aria-label="Study work this affects">
              <h3>Study work this overlaps</h3>
              <ul>{done.affected.map(a => <li key={a.id}>{a.title} — {day(a.date)}, {a.minutes} min {a.canMove ? <Link href={calendarTaskHref(a.id, a.date)} className="prose-link">Find a new time</Link> : <small>(already started, left where it is)</small>}</li>)}</ul>
              {opKey && <Link className="primary-button" href={calendarReviewHref(opKey, done.affected[0].date)} data-testid="review-week-changes">Review changes to my week</Link>}
              <p className="fine-print">Your class change is saved. Nothing in your study week has moved: you will see the proposed changes first and choose whether to accept them.</p>
            </section>
          ) : <p>No planned study work overlaps it.</p>}
          <div className="ui-dialog__foot"><button type="button" className="secondary-button" onClick={close}>Done</button></div>
        </div>
      </Dialog>
    )
  }

  const pastNote = !s.canChange && !s.canRestore
  return (
    <Dialog open onClose={close} title={`${s.label} — ${s.current ? day(s.current.date) : day(s.occurrence)}`} eyebrow="Class"
      description={s.state === 'skipped' ? 'This class is cancelled.' : s.state === 'moved' ? `Moved from ${day(s.occurrence)} (${s.startTime}–${s.endTime}).` : `Repeats ${s.weekdays.map(d => WEEKDAY_SHORT[d]).join(', ')} ${s.startTime}–${s.endTime}${s.endsOn ? ` until ${day(s.endsOn)}` : ''}.`}
      initialFocusRef={firstRef}>
      <div style={{ display: 'grid', gap: 14 }} data-testid="class-occurrence" data-state={s.state} data-commitment={s.commitmentId} data-occurrence={s.occurrence}>
        <WhenReady>
        {s.current && <p><strong>{day(s.current.date)}, {s.current.start}–{s.current.end}</strong></p>}
        {logHref && <Link prefetch={false} href={logHref} className="prose-link">{saved ? 'Open saved class log' : 'Log this class'}</Link>}
        {pastNote ? <p>This class has already happened, so its record is kept as it is.</p> : (
          <>
            <fieldset className="field" style={{ border: 0, padding: 0 }}>
              <legend>What would you like to do?</legend>
              {([['move', 'Move this class only', s.state !== 'skipped' && s.canChange], ['cancel', 'Cancel this class only', s.state !== 'skipped' && s.canChange], ['restore', 'Restore this class to its original time', exception && s.canRestore], ['future', 'Change this and future classes', true]] as [Mode, string, boolean][]).filter(x => x[2]).map(([m, label]) => (
                <label key={m} className="checkbox-row"><input ref={m === mode ? firstRef : undefined} type="radio" name="class-mode" checked={mode === m} onChange={() => { setMode(m); edited() }} /> <span>{label}</span></label>
              ))}
            </fieldset>

            {mode === 'move' && (
              <div className="drawer-fields" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <label className="field"><span>New date</span><input type="date" value={moveDate} min={s.today} onChange={e => { setMoveDate(e.target.value); edited() }} /></label>
                <label className="field"><span>From</span><input type="time" value={moveStart} onChange={e => { setMoveStart(e.target.value); edited() }} /></label>
                <label className="field"><span>To</span><input type="time" value={moveEnd} onChange={e => { setMoveEnd(e.target.value); edited() }} /></label>
              </div>
            )}
            {mode === 'future' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <label className="field"><span>Starting from</span><input type="date" value={from} min={s.today} onChange={e => { setFrom(e.target.value); edited() }} /></label>
                <div className="field"><span>On which days?</span>
                  <div className="weekday-picker" role="group" aria-label="Days of the week">
                    {WEEKDAY_SHORT.map((name, d) => <button key={d} type="button" className={weekdays.includes(d) ? 'is-on' : ''} aria-pressed={weekdays.includes(d)} onClick={() => { setWeekdays(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d].sort()); edited() }}>{name}</button>)}
                  </div>
                </div>
                <div className="drawer-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label className="field"><span>From</span><input type="time" value={fStart} onChange={e => { setFStart(e.target.value); edited() }} /></label>
                  <label className="field"><span>To</span><input type="time" value={fEnd} onChange={e => { setFEnd(e.target.value); edited() }} /></label>
                </div>
                <p className="fine-print">Classes before that date keep the pattern they had. Your current accepted week does not change.</p>
              </div>
            )}

            <div aria-live="polite" data-testid="class-preview">
              {preview && (
                <section className="notice" aria-label="What this will change">
                  <h3>What will change</h3>
                  {mode === 'future' ? (
                    <>
                      <p>Earlier classes end on {day(preview.preview.changes[0].earlierEndsOn)}. From {day(preview.preview.changes[0].effectiveFrom)}:</p>
                      <p><small>Now:</small> {(preview.preview.changes[0].old as any[]).slice(0, 4).map(o => `${day(o.date)} ${hm(o.start)}`).join(' · ') || 'none'}</p>
                      <p><small>New:</small> {(preview.preview.changes[0].new as any[]).slice(0, 4).map(o => `${day(o.date)} ${hm(o.start)}–${hm(o.end)}`).join(' · ') || 'none'}</p>
                    </>
                  ) : preview.preview.changes.map((c, i) => (
                    <p key={i}>{c.from ? <>{day(c.from.date)} {hm(c.from.start)}–{hm(c.from.end)}</> : <>Cancelled</>} → {c.to ? <strong>{day(c.to.date)} {hm(c.to.start)}–{hm(c.to.end)}</strong> : <strong>cancelled</strong>}</p>
                  ))}
                  {conflicts.length > 0 && <p role="alert" className="auth-error">This would overlap {conflicts.map(c => `${c.title}${c.date ? ` (${day(c.date)})` : ''}`).join(', ')}, which is booked. Choose another time, or move the mock first.</p>}
                  {preview.preview.affectedTasks.length > 0 && (
                    <div><p>Planned study work in that time:</p><ul>{preview.preview.affectedTasks.map(a => <li key={a.id}>{a.title} — {day(a.date)}{a.canMove ? '' : ' (started, left where it is)'}</li>)}</ul><p className="fine-print">You review any rescheduling after saving; nothing moves on its own.</p></div>
                  )}
                  {inert.length > 0 && (
                    <label className="checkbox-row"><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> <span>{inert.length} one-off change{inert.length === 1 ? '' : 's'} later in this series ({inert.map(i => day(i.occurrenceDate)).join(', ')}) no longer match the new days. They stay on the old pattern, inactive.</span></label>
                  )}
                </section>
              )}
            </div>
          </>
        )}
        {error && <p role="alert" className="auth-error" data-testid="class-error">{error}</p>}
        <div className="ui-dialog__foot">
          <button type="button" className="secondary-button" onClick={close}>Close</button>
          {!pastNote && !preview && <button type="button" className="primary-button" onClick={runPreview} disabled={busy !== null}>{busy === 'preview' ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Checking…</> : 'Preview change'}</button>}
          {!pastNote && preview && <button type="button" className="primary-button" onClick={confirm} disabled={busy !== null || !canConfirm}>{busy === 'confirm' ? <><Loader2 size={16} className="animate-spin" aria-hidden /> Saving…</> : retryable ? 'Retry confirm' : 'Confirm change'}</button>}
        </div>
        </WhenReady>
      </div>
    </Dialog>
  )
}
