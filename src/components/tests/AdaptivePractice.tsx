'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { SetPreview } from '../../lib/tests/adaptivePractice'

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; p: SetPreview } | { kind: 'error'; message: string }

/**
 * Adaptive practice: review (read-only) → explicit Start. A run is a bounded sequence of fixed five-question sets; practice only.
 * The request key is made once per review, so a lost response is retried as the SAME start and never creates a second run.
 */
export function AdaptivePractice({ readingId, outcomeIds, cap }: { readingId: string; outcomeIds?: string[]; cap: 10 | 20 }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const key = useRef<string | null>(null)
  const body = { kind: 'practice', mode: 'adaptive', readingId, ...(outcomeIds?.length ? { outcomeIds } : {}), cap }

  async function review() {
    setPhase({ kind: 'loading' }); setMsg(null); key.current = null
    try {
      const res = await fetch('/api/tests/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      setPhase(d.ok ? { kind: 'ready', p: d.adaptive } : { kind: 'error', message: d.error ?? 'Could not check this practice.' })
    } catch { setPhase({ kind: 'error', message: 'Connection lost. Nothing was started. Try again.' }) }
  }
  async function start(p: SetPreview) {
    setBusy(true); setMsg(null)
    key.current ??= crypto.randomUUID()
    try {
      const res = await fetch('/api/tests/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestKey: key.current, expectedDecision: p.evidenceRevision }) })
      const r = await res.json()
      if (r.ok) { router.push(r.url); return }
      key.current = null
      setMsg(r.message ?? 'Could not start.'); if (r.preview) setPhase({ kind: 'ready', p: r.preview })
    } catch { setMsg('Connection lost. Retrying keeps this to one practice run: press Start again.') }
    finally { setBusy(false) }
  }
  const p = phase.kind === 'ready' ? phase.p : null
  return (
    <div className="preflight" data-preflight={phase.kind}>
      <button type="button" className="primary-button" disabled={phase.kind === 'loading'} aria-expanded={phase.kind === 'ready'} onClick={review}>
        {phase.kind === 'loading' ? 'Checking…' : phase.kind === 'ready' ? 'Check again' : 'Review this practice'}
      </button>
      {phase.kind === 'error' && <p role="alert" className="review-error">{phase.message} <button type="button" className="text-button" onClick={review}>Retry</button></p>}
      {p && (
        <div className="preflight__result" role="status" aria-live="polite">
          <p><strong>Adaptive practice{p.readingName ? ` — ${p.readingName}` : ''}</strong></p>
          {p.state === 'start' ? (
            <>
              <p>Sets of {p.size} questions, up to {p.cap} in total ({p.cap / p.size} sets). Each set is about {p.minutes} minutes; there is no timer and you can pause or leave and resume.</p>
              <p className="muted"><strong>Starting approach: {p.label}.</strong> {p.reasons[0]}</p>
              <details><summary>Why, and what it uses</summary>
                <ul>{p.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                <p className="muted">This set: {p.target.foundation} foundation · {p.target.standard} standard · {p.target.difficult} difficult, where fresh reviewed questions allow.</p>
              </details>
              <p className="muted">{p.statement}</p>
              <p className="muted">Starting reserves the first set only. Each further set is reserved when you choose Continue.</p>
              <button type="button" className="primary-button" disabled={busy} onClick={() => start(p)}>{busy ? 'Starting…' : 'Start'}</button>
              {msg && <span role="alert" className="review-error"> {msg}</span>}
            </>
          ) : (
            <>
              <p>{p.message ?? 'Adaptive practice is not available for this scope right now.'}</p>
              <p><Link className="secondary-button" href="/app/curriculum">Keep studying in Curriculum</Link></p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
