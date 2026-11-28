'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { AdaptiveItemPreview } from '../../lib/tests/adaptiveItemPractice'

type Phase = { kind: 'idle' } | { kind: 'loading' } | { kind: 'ready'; p: AdaptiveItemPreview } | { kind: 'error'; message: string }

/**
 * Item-by-item adaptive practice preflight → Start (`adaptive-item.1`).
 * Reuses one `requestKey` per review so lost responses replay the same run.
 */
export function AdaptiveItemPractice({ readingId, outcomeIds }: { readingId: string; outcomeIds?: string[] }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const key = useRef<string | null>(null)
  const body = { kind: 'practice', mode: 'adaptive_item', readingId, ...(outcomeIds?.length ? { outcomeIds } : {}) }

  async function review() {
    setPhase({ kind: 'loading' })
    setMsg(null)
    key.current = null
    try {
      const res = await fetch('/api/tests/preflight', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      setPhase(d.ok && d.adaptiveItem ? { kind: 'ready', p: d.adaptiveItem } : { kind: 'error', message: d.error ?? 'Could not check this practice.' })
    } catch {
      setPhase({ kind: 'error', message: 'Connection lost. Nothing was started. Try again.' })
    }
  }

  async function start() {
    setBusy(true)
    setMsg(null)
    key.current ??= crypto.randomUUID()
    try {
      const res = await fetch('/api/tests/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, requestKey: key.current }),
      })
      const r = await res.json()
      if (r.ok && r.url) {
        router.push(r.url)
        return
      }
      if (res.status < 500) key.current = null
      setMsg(r.message ?? 'Could not start.')
    } catch {
      setMsg('Connection lost. Retrying keeps this to one run: press Start again.')
    } finally {
      setBusy(false)
    }
  }

  const p = phase.kind === 'ready' ? phase.p : null
  return (
    <div className="preflight" data-preflight={phase.kind}>
      <button type="button" className="primary-button" disabled={phase.kind === 'loading'} aria-expanded={phase.kind === 'ready'} onClick={review}>
        {phase.kind === 'loading' ? 'Checking…' : phase.kind === 'ready' ? 'Check again' : 'Review item-by-item practice'}
      </button>
      {phase.kind === 'error' && (
        <p role="alert" className="review-error">
          {phase.message} <button type="button" className="text-button" onClick={review}>Retry</button>
        </p>
      )}
      {p && (
        <div className="preflight__result" role="status" aria-live="polite">
          <p><strong>Item-by-item adaptive practice{p.readingName ? ` — ${p.readingName}` : ''}</strong></p>
          {p.state === 'start' ? (
            <>
              <p>Starts at <strong>{p.startingLabel}</strong> ({p.deliverableEasy} fresh Easy item{p.deliverableEasy === 1 ? '' : 's'} available). Correct answers step up one tier; incorrect answers step down one tier.</p>
              <p className="muted">{p.statement}</p>
              <button type="button" className="primary-button" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start'}</button>
              {msg && <span role="alert" className="review-error"> {msg}</span>}
            </>
          ) : p.state === 'unavailable' ? (
            <>
              <p role="alert" className="review-error">{p.message}</p>
              <button type="button" className="secondary-button" onClick={review}>Retry</button>
            </>
          ) : (
            <>
              <p>{p.message ?? 'Item-by-item practice is not available for this scope right now.'}</p>
              <p><Link className="secondary-button" href="/app/curriculum">Keep studying in Curriculum</Link></p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
