'use client'

import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { Notice } from '../ui/Notice'
import { Button } from '../ui/Button'
import { calendarTaskHref } from '../../lib/routing/calendar'
import type { RecoveryDraft } from '../../lib/planning/classRecovery'

type Receipt = { moved: number; set_aside: number; kept: number; replayed?: boolean; tasks: { task_id: string; title: string; outcome: 'moved' | 'set_aside' | 'kept'; to?: { date: string } }[] }
type Choice = 'keep' | 'defer'
type Phase = 'loading' | 'draft' | 'nothing' | 'failed' | 'accepted' | 'dismissed'

const dayOf = (d: string) => formatStudyDate(d, 'short')

/**
 * The reviewed adjustment of existing study work after a SAVED class change. The class change is already the student's outcome (its receipt is
 * authoritative); everything here is a proposal until "Accept these changes", which is one atomic command and receipt. Reviewing, dismissing or a
 * failure never undo the class change, and nothing moves until the student accepts.
 */
export function ClassRecoveryPanel({ changeKey, label, timezone, ownerId, closeHref }: { changeKey: string; label: string; timezone: string; ownerId: string; closeHref: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('loading')
  const [draft, setDraft] = useState<RecoveryDraft | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rebuild, setRebuild] = useState(false)
  const [uncertain, setUncertain] = useState<'accept' | 'dismiss' | null>(null)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const started = useRef(false)
  const storageKey = `roadmap.class-recovery.${ownerId}.${changeKey}`
  const time = (iso: string | null) => iso ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: timezone }).format(new Date(iso)) : 'any time that day'

  const prepare = useCallback(async () => {
    setPhase('loading'); setError(''); setRebuild(false); setUncertain(null)
    try {
      const res = await fetch('/api/planning/current-week/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'class_change', change: changeKey }) })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.code === 'NOT_FOUND' ? 'That class change was not found.' : (data.error || 'unavailable'))
      if (data.status === 'prepared') { setDraft(data.draft); setPhase('draft'); return }
      setPhase(data.status === 'nothing_to_review' ? 'nothing' : 'failed')
      if (data.status === 'no_cycle') setError('There is no active week to adjust.')
      if (data.status === 'stale') setError('Your week changed while this was prepared. Prepare it again.')
    } catch (e: any) {
      setPhase('failed'); setError(e?.message && e.message !== 'unavailable' ? e.message : 'We could not prepare the review just now.')
    }
  }, [changeKey])
  useEffect(() => { if (started.current) return; started.current = true; void prepare() }, [prepare])
  useEffect(() => { if (phase !== 'loading') heading.current?.focus() }, [phase])

  const body = (reason: 'accept' | 'dismiss') => JSON.stringify({ draftId: draft!.draftId, expectedRevision: draft!.revision, reason: 'class_change', ...(reason === 'accept' ? { choices } : {}) })
  function failure(data: { error?: string; rebuild?: boolean }, _status: number) {
    setError(data.error ?? 'The save could not be confirmed. Retry the same request.')
    setRebuild(!!data.rebuild)
  }
  async function accept() {
    if (!draft || busy) return
    setBusy(true); setError(''); setUncertain('accept')
    try {
      const res = await fetch('/api/planning/current-week/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('accept') })
      const data = await res.json()
      if (!res.ok || !data.ok) { failure(data, res.status); if (res.status < 500 && !data.uncertain) setUncertain(null); return }
      setReceipt(data.receipt); setPhase('accepted'); setUncertain(null); try { sessionStorage.removeItem(storageKey) } catch { /* optional */ }
      router.refresh()
    } catch { setError('The response was lost. Your changes may already be saved. Retry the same request to check, without moving anything twice.') }
    finally { setBusy(false) }
  }
  async function keepCurrent() {
    if (!draft || busy) return
    setBusy(true); setError(''); setUncertain('dismiss')
    try {
      const res = await fetch('/api/planning/current-week/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body('dismiss') })
      const data = await res.json()
      if (!res.ok || !data.ok) { failure(data, res.status); if (res.status < 500 && !data.uncertain) setUncertain(null); return }
      if (data.outcome === 'accepted') { setReceipt(data.receipt); setPhase('accepted'); setUncertain(null); router.refresh(); return }
      setPhase('dismissed'); setUncertain(null); router.refresh()
    } catch { setError('The response was lost. Retry the same request to check the outcome safely.') }
    finally { setBusy(false) }
  }

  const needsDecision = draft ? draft.unplaced.length + draft.kept.length : 0
  return (
    <section className="empty-week" aria-labelledby="class-recovery-h" data-testid="class-recovery" data-phase={phase}>
      <Notice tone="info" role="status">
        <strong>Your change to {label} is saved.</strong> {phase === 'accepted' ? 'Your study week has been updated as you reviewed it.' : 'Changes to your study week are only a proposal until you accept them.'}
      </Notice>
      <div className="empty-week__panel" role="region" aria-label="Review changes to my week">
        <h3 id="class-recovery-h" ref={heading} tabIndex={-1}>Review changes to my week</h3>
        {phase === 'loading' && <p role="status"><Loader2 className="animate-spin" size={16} aria-hidden /> Checking your week against the new class time…</p>}
        {error && (
          <Notice tone="danger" role="alert"><span data-testid="class-recovery-error">{error}</span>{' '}
            {(phase === 'failed' || rebuild) && <Button variant="secondary" onClick={() => void prepare()}><RefreshCw size={14} aria-hidden /> {phase === 'failed' ? 'Try again' : 'Rebuild the proposal'}</Button>}
          </Notice>
        )}
        {phase === 'failed' && !error && <p>We could not prepare the review just now. Your class change is saved and nothing in your week moved.</p>}
        {phase === 'nothing' && <p data-testid="class-recovery-nothing">Nothing in your study week needs to change. Your tasks keep their times.</p>}

        {phase === 'draft' && draft && (
          <>
            <p className="fine-print">Nothing has moved yet. Planned from your study times, classes and bookings. {draft.unchanged} other task{draft.unchanged === 1 ? '' : 's'} stay{draft.unchanged === 1 ? 's' : ''} exactly as they are.</p>
            {draft.moves.length > 0 && (
              <>
                <h4>Proposed moves</h4>
                <ul className="ob-weekpreview" data-testid="class-recovery-moves">
                  {draft.moves.map(m => (
                    <li key={m.task_id} className="ob-weekpreview__day" data-task={m.task_id}>
                      <strong>{m.title}</strong> · {m.minutes} min
                      <div>{dayOf(m.from.date)}, {time(m.from.starts_at)} → <strong>{dayOf(m.to_date)}, {time(m.to_starts)}</strong></div>
                      <small className="fine-print">{m.reason}</small>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {draft.unplaced.length > 0 && (
              <>
                <h4>No room for these</h4>
                <p className="fine-print">They cannot fit in the study time that remains this week. Nothing is shortened or dropped. Choose what happens to each.</p>
                <ul data-testid="class-recovery-unplaced">
                  {draft.unplaced.map(u => (
                    <li key={u.task_id} data-task={u.task_id}>
                      <strong>{u.title}</strong> · {u.minutes} min, now {dayOf(u.from.date)}
                      <div className="fine-print">{u.reason}</div>
                      <fieldset className="field" style={{ border: 0, padding: 0 }}>
                        <legend className="sr-only">What to do with {u.title}</legend>
                        <label className="checkbox-row"><input type="radio" name={`c-${u.task_id}`} checked={(choices[u.task_id] ?? 'keep') === 'keep'} onChange={() => setChoices(c => ({ ...c, [u.task_id]: 'keep' }))} disabled={busy || !!uncertain} /> <span>Keep it where it is for now</span></label>
                        <label className="checkbox-row"><input type="radio" name={`c-${u.task_id}`} checked={choices[u.task_id] === 'defer'} onChange={() => setChoices(c => ({ ...c, [u.task_id]: 'defer' }))} disabled={busy || !!uncertain} /> <span>Set it aside for my weekly review</span></label>
                      </fieldset>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {draft.kept.length > 0 && (
              <>
                <h4>Left where they are</h4>
                <ul data-testid="class-recovery-kept">{draft.kept.map(k => <li key={k.task_id}><strong>{k.title}</strong> <span className="fine-print">{k.reason}</span></li>)}</ul>
              </>
            )}
            {draft.moves.length === 0 && needsDecision === 0 && <p>Nothing to change.</p>}
            <div className="ob-actions">
              <Button variant="text" onClick={() => void keepCurrent()} disabled={busy || rebuild || uncertain === 'accept'}>{uncertain === 'dismiss' ? 'Retry keeping my current times' : 'Keep my current study times for now'}</Button>
              <Button onClick={() => void accept()} loading={busy} disabled={busy || rebuild || uncertain === 'dismiss' || (draft.moves.length === 0 && draft.unplaced.length === 0)} data-testid="class-recovery-accept">{uncertain === 'accept' ? 'Retry the same request' : 'Accept these changes'}</Button>
            </div>
          </>
        )}

        {phase === 'accepted' && receipt && (
          <div data-testid="class-recovery-done">
            <p role="status">{receipt.replayed ? 'These changes were already saved. ' : ''}{receipt.moved} moved, {receipt.set_aside} set aside for your weekly review, {receipt.kept} left where {receipt.kept === 1 ? 'it is' : 'they are'}.</p>
            <ul>{receipt.tasks.map(t => <li key={t.task_id}>{t.outcome === 'moved' && t.to ? <Link href={calendarTaskHref(t.task_id, t.to.date)} className="prose-link">{t.title}</Link> : t.title} — {t.outcome === 'moved' ? 'moved' : t.outcome === 'set_aside' ? 'set aside for weekly review' : 'kept where it is'}</li>)}</ul>
            <Link className="secondary-button" href={closeHref}>Back to Calendar</Link>
          </div>
        )}
        {phase === 'dismissed' && (
          <div data-testid="class-recovery-dismissed">
            <p role="status">Nothing in your study week was changed. Your class change stays saved, and Calendar keeps showing anything that now overlaps so you can decide later.</p>
            <Link className="secondary-button" href={closeHref}>Back to Calendar</Link>
          </div>
        )}
      </div>
    </section>
  )
}
