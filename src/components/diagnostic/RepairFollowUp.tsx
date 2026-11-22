'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { calendarTaskHref } from '../../lib/routing/calendar'
import type { RepairState, PreviewResult } from '../../lib/repairs/service'

type State = Extract<RepairState, { ok: true }>
type Preview = Extract<PreviewResult, { ok: true }>
const CHECK: Record<string, string> = { supported: 'Supported on the last check', still_needs_work: 'Still needs work after the last check', uncertain: 'Uncertain after the last check', not_assessed: 'Not assessed by the last check' }
const day = (d: string) => formatStudyDate(d, 'short')

/** Result → follow-up. Reads state, saves a reviewable proposal, and accepts it by id. Nothing reaches the calendar before "Confirm changes". */
export function RepairFollowUp({ attemptId, alsoAttemptIds = [], limit }: { attemptId: string; alsoAttemptIds?: string[]; limit?: number }) {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const keys = useRef(new Map<string, string>())      // one retry key per proposal: a repeat click or a lost response can never add the work twice

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await (await fetch(`/api/diagnostic/repair?attemptId=${attemptId}${alsoAttemptIds.length ? `&also=${alsoAttemptIds.join(',')}` : ''}`)).json()
      if (r.ok) setState(r); else setError(r.message ?? 'Your follow-up could not be loaded.')
    } catch { setError('Your follow-up could not be loaded. Check your connection and try again.') }
  }, [attemptId, alsoAttemptIds.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  async function build(next = overrides) {
    setBusy(true); setError(null)
    try {
      const r = await (await fetch('/api/diagnostic/repair/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attemptId, overrides: next, alsoAttemptIds, limit }) })).json()
      if (r.ok) { setPreview(r); setSaved(null) } else setError(r.message ?? 'Could not prepare the follow-up.')
    } catch { setError('Could not reach PrepPlan. Nothing was changed.') } finally { setBusy(false) }
  }
  async function confirm() {
    if (!preview) return
    const key = keys.current.get(preview.proposalId) ?? `repair-${crypto.randomUUID()}`
    keys.current.set(preview.proposalId, key)
    setBusy(true); setError(null)
    try {
      const r = await (await fetch('/api/diagnostic/repair/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposalId: preview.proposalId, idempotencyKey: key }) })).json()
      if (r.ok) { setSaved(`${r.taskIds.length} item${r.taskIds.length === 1 ? '' : 's'} added to your calendar${r.waitingChecks?.length ? '; the re-check stays waiting for a later week' : ''}.`); setPreview(null); await load() }
      else { setError(r.message ?? 'Save not confirmed.'); if (['stale', 'unavailable', 'cycle_changed'].includes(r.code)) setPreview(null) }   // choices are kept
    } catch { setError('Save not confirmed. Check your calendar, or confirm again: confirming twice cannot add the work twice.') } finally { setBusy(false) }
  }

  async function placeCheck(threadId: string) {
    const key = keys.current.get(`check:${threadId}`) ?? `check-${crypto.randomUUID()}`
    keys.current.set(`check:${threadId}`, key)
    setBusy(true); setError(null)
    try {
      const r = await (await fetch('/api/diagnostic/repair/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadIds: [threadId], idempotencyKey: key }) })).json()
      if (r.ok) { setSaved('The re-check is in your calendar.'); await load() } else setError(r.message ?? 'Could not add the re-check.')
    } catch { setError('Save not confirmed. Check your calendar, or try again: trying twice cannot add it twice.') } finally { setBusy(false) }
  }

  if (error && !state) return <p role="alert">{error} <button type="button" className="text-button" onClick={load}>Try again</button></p>
  if (!state) return <p role="status" className="muted">Loading your follow-up…</p>
  if (!state.items.length) return <p className="muted">Nothing from this paper needs follow-up right now.</p>

  if (preview) {
    const { plan } = preview
    const byDay = new Map<string, typeof plan.tasks>(); for (const t of plan.tasks) byDay.set(t.local_date, [...(byDay.get(t.local_date) ?? []), t])
    const dates = (() => { const out: string[] = []; for (let d = new Date(`${preview.cycle.start}T12:00:00Z`); d.toISOString().slice(0, 10) <= preview.cycle.end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out.filter(d => d >= preview.today) })()
    return (
      <div className="repair-preview">
        <p>This is exactly what will be added to your open week ({day(preview.cycle.start)} – {day(preview.cycle.end)}). Nothing is added until you confirm.</p>
        {plan.tasks.length > 0 && <ul>{[...byDay].sort(([a], [b]) => a.localeCompare(b)).flatMap(([d, ts]) => ts.map(t => (
          <li key={t.id}><strong>{t.title}</strong> · {t.duration_minutes} min ·{' '}
            <select aria-label={`Day for ${t.title}`} value={t.local_date} disabled={busy} onChange={e => { const o = { ...overrides, [t.key]: e.target.value }; setOverrides(o); void build(o) }}>
              {dates.map(x => <option key={x} value={x}>{day(x)}</option>)}<option value="none">Leave unplaced</option>
            </select><br /><small>{t.rationale}</small></li>)))}</ul>}
        {plan.check && <p><strong>{plan.check.title}</strong> · {plan.check.duration_minutes} min · {day(plan.check.local_date)}. <small>It checks only the repairs listed above, with questions you have not seen. It cannot start until every one of those repairs is finished.</small></p>}
        {plan.waitingChecks.map((w, i) => <p key={i}><strong>Re-check waiting.</strong> {w.reason}</p>)}
        {plan.unplaced.length > 0 && <div><strong>Not placed this week</strong><ul>{plan.unplaced.map(u => <li key={u.threadId}>{u.conceptName}: {u.reason} <small>It stays open and is offered when you review next week.</small></li>)}</ul></div>}
        {plan.tasks.length === 0 && !plan.check && <p>Nothing fits in this week. <Link href="/app/review-week" className="prose-link">Review the week</Link> and these repairs are offered in the next one.</p>}
        {error && <p role="alert" className="review-error">{error}</p>}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => setPreview(null)}>Back</button>{' '}
        <button type="button" className="secondary-button" disabled={busy} onClick={() => { setOverrides({}); setPreview(null); setSaved('Nothing was added to your calendar. You can review these repairs again whenever you’re ready.') }}>Keep for later</button>{' '}
        <button type="button" className="primary-button" disabled={busy || (plan.tasks.length === 0 && !plan.check && plan.waitingChecks.length === 0)} onClick={confirm}>{busy ? 'Working…' : 'Confirm changes'}</button>
      </div>
    )
  }

  return (
    <div className="repair-state">
      {saved && <p role="status">{saved}</p>}
      <ul>{state.items.map(i => {
        const repair = i.tasks.filter(t => t.type === 'repair'), check = i.tasks.find(t => t.type === 'recheck')
        const open = repair.find(t => t.execution !== 'completed')
        return (
          <li key={i.threadId}>
            <strong>{i.conceptName}</strong> <small>({i.severity === 'unstable' ? 'correct but unsure' : 'answered wrongly'}{i.occurrence > 1 ? `, ${i.occurrence} times` : ''})</small>
            <div>
              {['open', 'proposed'].includes(i.status) && 'Not planned yet.'}
              {i.status === 'scheduled' && open && <>Repair planned. <Link className="prose-link" href={calendarTaskHref(open.id, open.date ?? undefined)}>See this repair</Link></>}
              {i.status === 'in_progress' && open && <>Repair under way. <Link className="prose-link" href={calendarTaskHref(open.id, open.date ?? undefined)}>Continue repair</Link></>}
              {i.status === 'awaiting_recheck' && (check ? <>Repair done. <Link className="prose-link" href={calendarTaskHref(check.id, check.date ?? undefined)}>Review the re-check</Link></> : <>Repair done. The re-check is due{i.nextCheckDue ? ` from ${day(i.nextCheckDue.slice(0, 10))}` : ''}. <button type="button" className="text-button" disabled={busy} onClick={() => placeCheck(i.threadId)}>Add the re-check to my calendar</button></>)}
              {i.latestCheckState && <div><small>{CHECK[i.latestCheckState]}.</small></div>}
            </div>
          </li>)
      })}</ul>
      {error && <p role="alert" className="review-error">{error}</p>}
      {(state.proposable > 0 || state.pending) && <button type="button" className="primary-button" disabled={busy} onClick={() => build()}>{busy ? 'Preparing…' : 'Review follow-up'}</button>}
    </div>
  )
}
