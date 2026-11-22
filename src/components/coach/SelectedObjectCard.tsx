'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SelectedObject } from '../../lib/coach/selection'

/** The object Home linked to, with its current status. Confirming a proposal uses the same endpoint as the chat's Confirm button; nothing else changes the plan. */
export function SelectedObjectCard({ object }: { object: SelectedObject }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  async function decide(decision: 'accept' | 'reject') {
    if (object.kind !== 'proposal') return
    setBusy(true); setNote('')
    try {
      const res = await fetch(`/api/coach/proposals/${object.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })
      const data = await res.json()
      setNote(data.ok ? (decision === 'accept' ? 'Confirmed. Your plan was updated.' : 'Dismissed.') : data.error ?? 'That could not be saved.')
      router.refresh()
    } catch { setNote('Connection lost. Nothing was confirmed; refresh to check.') } finally { setBusy(false) }
  }
  if (object.kind === 'unavailable') return <section className="section-block" role="status" aria-label="Selected item"><p>{object.message}</p></section>
  if (object.kind === 'report') return (
    <section className="section-block" aria-label="Selected mock report" data-testid="coach-selected-report">
      <p className="eyebrow">Mock report you are asking about</p>
      <h2>{object.title}</h2>
      <p>{object.summary} {object.status === 'withdrawn' ? 'You withdrew this report: sittings already planned from it stay in your Calendar, but new work cannot be planned from it.' : 'I can help you decide how to work on the areas you chose. Nothing changes in your plan until you review and confirm it on the report page.'}</p>
      <div className="stack-inline"><Link className="secondary-button" href={object.href}>Open the report</Link> <Link className="text-button" href="/app/coach">Choose something else</Link></div>
    </section>
  )
  if (object.kind === 'reading') return (
    <section className="section-block" aria-label="Selected reading">
      <p className="eyebrow">Reading you are asking about</p>
      <h2>{object.title}</h2>
      <p>I will point you to this reading and plan around it. Your notes and ticks there are your own record, not test evidence.</p>
      <div className="stack-inline"><Link className="secondary-button" href={object.href}>Open the reading</Link></div>
    </section>
  )
  if (object.kind === 'task') return (
    <section className="section-block" aria-label="Selected task">
      <p className="eyebrow">Task you are asking about</p>
      <h2>{object.title}</h2>
      <p>{object.minutes} min on {object.date}. {object.movable ? 'Ask me to move it and I will show exactly what changes before anything happens.' : 'It has been started, so it stays due.'}</p>
      <div className="stack-inline"><Link className="secondary-button" href={object.href}>Open in Calendar</Link> <Link className="text-button" href="/app/coach">Choose something else</Link></div>
    </section>
  )
  if (object.kind === 'attempt') return (
    <section className="section-block" aria-label="Selected paper">
      <p className="eyebrow">Paper you are asking about</p>
      <h2>{object.title}</h2>
      <p>{object.summary} I will talk from this paper&apos;s result, not guess.</p>
      <div className="stack-inline"><Link className="secondary-button" href={object.resultHref}>Open the result</Link></div>
    </section>
  )
  if (object.kind === 'repair') return (
    <section className="section-block" aria-label="Selected weak area">
      <p className="eyebrow">Weak area · {object.status.replace('_', ' ')}</p>
      <h2>{object.conceptName}</h2>
      <p>{object.message}</p>
      <div className="stack-inline">
        {object.taskLinks.map(l => <Link key={l.href} className="secondary-button" href={l.href}>{l.label}</Link>)}
        {object.checkLink && <Link className="secondary-button" href={object.checkLink.href}>{object.checkLink.label}</Link>}
      </div>
    </section>
  )
  return (
    <section className="section-block" aria-label="Selected suggestion">
      <p className="eyebrow">Suggestion · {object.status}</p>
      <h2>{object.title}</h2>
      <p className="text-secondary">{object.reasoning}</p>
      {object.moves.length > 0 && <ul aria-label="Exactly what will change">{object.moves.map(m => <li key={m.id}>{m.title}: {m.minutes} min on {m.date} moves off the day (marked deferred)</li>)}</ul>}
      {object.staysDue.length > 0 && <p className="text-secondary">Stays due: {object.staysDue.map(t => `${t.title} (${t.reason})`).join('; ')}.</p>}
      <p role="status">{note || object.message}</p>
      {object.status === 'pending' && (
        <div className="stack-inline">
          <button type="button" className="primary-button" disabled={busy} onClick={() => void decide('accept')}>{busy ? 'Checking…' : 'Confirm'}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => void decide('reject')}>Not now</button>
        </div>
      )}
      {object.taskLinks.length > 0 && (
        <ul aria-label="Tasks this created" className="stack-list">{object.taskLinks.map((l, i) => (
          <li key={l.href ?? `gone-${i}`}>
            {l.href ? <Link className="secondary-button" href={l.href}>{l.label}</Link> : <span className="fine-print">{l.label}.</span>}
            {l.state !== 'open' && l.href && <small> · {l.state === 'done' ? 'done' : 'removed from your plan'}</small>}
            {l.continuedAs && <> <small>continued as</small> <Link className="text-button" href={l.continuedAs.href}>{l.continuedAs.label}</Link></>}
          </li>
        ))}</ul>
      )}
    </section>
  )
}
