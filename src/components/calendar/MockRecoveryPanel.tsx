'use client'

import { formatStudyDate } from '../../lib/format/date'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Debrief } from '../../lib/mocks/debrief'
import type { RecoverySelection, SelectionItem } from '../../lib/mocks/report'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string; outcomes: { id: string; code: string; title: string }[] }[] }[]
type Preview = { ok: true; fingerprint: string; maxSitting: number; runway: { note: string }; placed: { sourceKey: string; date: string; minutes: number; title: string; reference: string; objective: string; approach: string; completion: string; verification: string; rationale: string }[]
  lastStudyDay: string | null; narrowing: { daysLeft: number; tradeoffs: string[] } | null; wouldDrop: { itemKey: string; label: string; minutes: number }[]
  alreadyPlanned: { itemKey: string; title: string; status: string; note: string; href?: string }[]; remainder: { itemKey: string; title: string; minutes: number; reason: string }[]; usableMinutes: number }

/**
 * Debrief, selection and the reviewed proposal. The student chooses what to work on; the server places whole sittings in real remaining room and shows what does
 * not fit. Nothing is added until "Confirm". A refused or stale plan keeps every choice. The request key is one per review, so a double click is one plan.
 */
export function MockRecoveryPanel({ reportId, version, debrief, catalog, maxSitting, remainder, defaultSelection, autoPlan }: {
  reportId: string; version: number; debrief: Debrief; catalog: Catalog; maxSitting: number; remainder: { itemKey: string; minutes: number; allocated: number; status?: string }[]; defaultSelection: RecoverySelection | null; autoPlan?: boolean }) {
  const router = useRouter()
  const flagged = new Set(debrief.findings.flatMap(f => f.topicIds ?? []))
  const wantsReview = debrief.findings.some(f => f.needsSelection)
  const [minutes, setMinutes] = useState(Math.min(maxSitting, 30))
  const [readingSel, setReadingSel] = useState<Set<string>>(new Set((defaultSelection?.items ?? []).filter(i => i.kind === 'review' && !i.outcomeId).map(i => i.readingId!)))
  const [outcomeSel, setOutcomeSel] = useState<Set<string>>(new Set((defaultSelection?.items ?? []).filter(i => i.kind === 'review' && i.outcomeId).map(i => i.outcomeId!)))
  const [pacing, setPacing] = useState(defaultSelection ? defaultSelection.items.some(i => i.kind === 'pacing') : debrief.findings.some(f => f.activity === 'pacing'))
  const [answers, setAnswers] = useState(defaultSelection ? defaultSelection.items.some(i => i.kind === 'answer_change') : debrief.findings.some(f => f.activity === 'answer_change'))
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const key = useRef(crypto.randomUUID())
  // "Plan what is left" previews the saved selection exactly as recorded (same items and minutes the report page shows); any edit below switches to the edited choices.
  const [useSaved, setUseSaved] = useState(false)
  const [confirmDrop, setConfirmDrop] = useState(false)

  const readingOf = new Map(catalog.flatMap(s => s.readings.map(r => [r.id, r] as const)))
  const selection = (): RecoverySelection => {
    if (useSaved && defaultSelection) return defaultSelection
    const items: SelectionItem[] = []
    for (const r of readingSel) { const inner = [...outcomeSel].filter(o => readingOf.get(r)?.outcomes.some(x => x.id === o)); if (!inner.length) items.push({ key: `review:${r}`, kind: 'review', readingId: r, minutes }) }
    for (const o of outcomeSel) { const r = catalog.flatMap(s => s.readings).find(x => x.outcomes.some(y => y.id === o)); if (r) items.push({ key: `review:${o}`, kind: 'review', readingId: r.id, outcomeId: o, minutes }) }
    if (pacing) items.push({ key: 'pacing', kind: 'pacing', minutes })
    if (answers) items.push({ key: 'answer_change', kind: 'answer_change', minutes })
    return { items }
  }
  const chosen = selection().items.length
  const edit = () => { setUseSaved(false); setPreview(null) }
  const post = async (body: object) => { const res = await fetch(`/api/mock-reports/${reportId}/recovery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { res, data: await res.json().catch(() => ({})) } }
  async function runPreview(sel: RecoverySelection = selection()) {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(null); setPreview(null); setConfirmDrop(false)
    try { const { data } = await post({ mode: 'preview', selection: sel }); if (data.ok) { setPreview(data); key.current = crypto.randomUUID() } else setError(data.message ?? data.error ?? 'Could not build the plan.') }
    catch { setError('The plan could not be built just now. Try again.') } finally { pending.current = false; setBusy(false) }
  }
  async function accept() {
    if (pending.current || !preview) return
    pending.current = true
    setBusy(true); setError(null)
    try {
      const { data } = await post({ mode: 'accept', selection: selection(), fingerprint: preview.fingerprint, key: key.current, reportVersion: version, confirmRemove: confirmDrop ? preview.wouldDrop.map(d => d.itemKey) : [] })
      if (data.ok) { router.push(data.nextUrl ?? '/app/calendar'); return }
      setError(data.error ?? 'That could not be applied. Nothing was changed.')
      if (data.code === 'preview_changed') { setPreview(null); key.current = crypto.randomUUID() }
    } catch { setError('The confirmation may not have reached the server. Press Confirm again: if it already went through you will get the same result, not a second plan.') }
    finally { pending.current = false; setBusy(false) }
  }
  useEffect(() => { if (autoPlan && defaultSelection && remainder.length > 0) { setUseSaved(true); void runPreview(defaultSelection) } }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = new Map<string, Preview['placed']>(); for (const t of preview?.placed ?? []) byDay.set(t.date, [...(byDay.get(t.date) ?? []), t])

  return (
    <section aria-labelledby="recovery-h" className="class-log__preview">
      <h2 id="recovery-h">Choose what to work on</h2>
      {remainder.length > 0 && <p className="note" data-testid="recovery-remainder">{remainder.some(r => r.status === 'needs_review') ? 'Some earlier work needs a completion decision. Its remaining time is not known; review its history or explicitly remove it from follow-up.' : `${remainder.length} thing${remainder.length === 1 ? '' : 's'} you chose earlier still need${remainder.length === 1 ? 's' : ''} a sitting (${remainder.reduce((n, r) => n + r.minutes - r.allocated, 0)} min).`} Nothing is placed until you confirm.</p>}
      {remainder.length > 0 && defaultSelection && <button type="button" className="primary-button" data-testid="plan-what-is-left" disabled={busy} onClick={() => { setUseSaved(true); void runPreview(defaultSelection) }}>Plan what is left</button>}
      {wantsReview && (
        <fieldset>
          <legend>Readings to review <small className="muted">(you choose; no reading is assumed weak)</small></legend>
          {catalog.filter(s => flagged.size === 0 || flagged.has(s.id)).map(s => (
            <details key={s.id} open={flagged.has(s.id)}>
              <summary>{s.name}{flagged.has(s.id) ? ' (you reported a result for this)' : ''}</summary>
              <ul className="class-log__list">
                {s.readings.map(r => (
                  <li key={r.id}>
                    <label><input type="checkbox" checked={readingSel.has(r.id)} onChange={e => { const n = new Set(readingSel); e.target.checked ? n.add(r.id) : n.delete(r.id); setReadingSel(n); edit() }} /> Reading {r.no}: {r.title}</label>
                    {readingSel.has(r.id) && <details><summary>Narrow to specific outcomes (optional)</summary>
                      {r.outcomes.map(o => <label key={o.id} style={{ display: 'block' }}><input type="checkbox" checked={outcomeSel.has(o.id)} onChange={e => { const n = new Set(outcomeSel); e.target.checked ? n.add(o.id) : n.delete(o.id); setOutcomeSel(n); edit() }} /> {o.code}. {o.title}</label>)}
                    </details>}
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </fieldset>
      )}
      <fieldset>
        <legend>Activities</legend>
        {debrief.findings.some(f => f.activity === 'pacing') && <label style={{ display: 'block' }}><input type="checkbox" checked={pacing} onChange={e => { setPacing(e.target.checked); edit() }} /> Pacing and application practice</label>}
        {debrief.findings.some(f => f.activity === 'answer_change') && <label style={{ display: 'block' }}><input type="checkbox" checked={answers} onChange={e => { setAnswers(e.target.checked); edit() }} /> Review answer changes</label>}
        <label>Length of each sitting <select value={minutes} onChange={e => { setMinutes(Number(e.target.value)); edit() }}>
          {[10, 15, 20, 25, 30, 40, 45, 60, 90].filter(m => m <= maxSitting).map(m => <option key={m} value={m}>{m} minutes</option>)}</select> <small className="muted">(never above your {maxSitting}-minute limit)</small></label>
      </fieldset>
      <button type="button" className="secondary-button" onClick={() => runPreview()} disabled={busy || (chosen === 0 && !defaultSelection?.items.length)}>{busy && !preview ? 'Working…' : 'Preview the plan'}</button>
      {chosen === 0 && <p className="review-hint">{defaultSelection?.items.length ? 'Preview and confirm removing the earlier choices. Their task history stays unchanged.' : 'Choose at least one reading or activity.'}</p>}
      {error && <p role="alert" className="review-error">{error}</p>}
      {preview && (
        <div data-testid="recovery-preview">
          <h3>What will be added to your week</h3>
          <p>{preview.runway.note}</p>
          {preview.placed.length === 0 && preview.remainder.length === 0 ? <p>{preview.wouldDrop.length ? 'Review the follow-up choices being removed below.' : preview.alreadyPlanned.some(a => a.status === 'needs_review') ? 'No new sitting is added. Review the earlier work before deciding what remains.' : 'Nothing new to add: everything you chose already has a sitting or is done.'}</p> : preview.placed.length === 0 ? <p>Nothing fits in your open week right now ({preview.usableMinutes} minutes of free time are left). What you chose is kept, and you can review it again next week.</p> : (
            <ul>{[...byDay.entries()].map(([date, ts]) => <li key={date}><strong>{formatStudyDate(date, 'long')}</strong>
              <ul>{ts.map(t => <li key={t.sourceKey}>{t.title} <small>{t.minutes} min</small><br /><small className="muted">{t.rationale}</small></li>)}</ul></li>)}</ul>
          )}
          <p className="muted">Nothing already in your week is moved, shortened or set aside.</p>
          {preview.alreadyPlanned.length > 0 && <div className="note" data-testid="recovery-already"><strong>Not added again:</strong>
            <ul>{preview.alreadyPlanned.map(a => <li key={a.itemKey}>{a.title}: {a.note}{a.href && <> <Link href={a.href}>Review this sitting</Link></>}</li>)}</ul></div>}
          {preview.narrowing && <div className="note" data-testid="recovery-narrowing"><strong>With {preview.narrowing.daysLeft} day{preview.narrowing.daysLeft === 1 ? '' : 's'} to go{preview.lastStudyDay ? ` (last study day ${preview.lastStudyDay})` : ''}:</strong>
            <ul>{preview.narrowing.tradeoffs.map((t, i) => <li key={i}>{t}</li>)}</ul></div>}
          {preview.wouldDrop.length > 0 && <label className="note" data-testid="recovery-drop" style={{ display: 'block' }}><input type="checkbox" checked={confirmDrop} onChange={e => setConfirmDrop(e.target.checked)} /> Remove these earlier choices from follow-up: {preview.wouldDrop.map(d => d.label).join('; ')}. Their task history and reported progress stay unchanged.</label>}
          {preview.remainder.length > 0 && <div role="status" className="note" data-testid="recovery-unplaced"><strong>Does not fit this week:</strong>
            <ul>{preview.remainder.map(r => <li key={r.itemKey}>{r.title} ({r.minutes} min): {r.reason}</li>)}</ul>
            <p>These stay on this report as work you chose. They are not forgotten and not squeezed in.</p></div>}
          <button type="button" className="primary-button" onClick={accept} disabled={busy || (preview.wouldDrop.length > 0 && !confirmDrop)}>{busy ? 'Saving…' : preview.placed.length ? 'Confirm and add to my week' : preview.wouldDrop.length ? 'Confirm follow-up changes' : 'Keep my choices for later'}</button>
          {' '}<button type="button" className="text-button" disabled={busy} onClick={() => { if (!pending.current) router.push('/app/calendar') }}>Not now</button>
        </div>
      )}
    </section>
  )
}
