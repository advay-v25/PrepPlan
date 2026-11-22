'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { RehearsalDecision } from '../../lib/rehearsal/service'

/**
 * The ONE rehearsal action, shown on Calendar, Tests and Coach: reads the same capability decision (`/api/rehearsal`) and offers
 * exactly what is possible — start, resume, or the session-specific reasons it cannot be built yet. Reserving never starts a clock.
 */
export function RehearsalAction({ appointmentId, compact = false }: { appointmentId: string; compact?: boolean }) {
  const router = useRouter()
  const [d, setD] = useState<RehearsalDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    fetch(`/api/rehearsal?appointmentId=${appointmentId}`, { cache: 'no-store' }).then(r => r.json()).then(r => { if (live) r.ok ? setD(r.decision) : setError(r.error ?? 'Could not check the rehearsal.') }).catch(() => live && setError('Could not check the rehearsal.'))
    return () => { live = false }
  }, [appointmentId])

  async function start() {
    setBusy(true); setError(null)
    try {
      const r = await (await fetch('/api/rehearsal/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointmentId }) })).json()
      if (r.ok) router.push(r.url)
      else { setError(r.message ?? 'Could not reserve the rehearsal.'); if (r.decision) setD(r.decision); setBusy(false) }
    } catch { setError('We could not confirm the reservation. Try again to open the same rehearsal if it was saved.'); setBusy(false) }
  }

  if (error && !d) return <p role="alert" className="fine-print">{error}</p>
  if (!d) return <p role="status" className="fine-print">Checking whether a full rehearsal can be built…</p>
  return (
    <div className="rehearsal-action" data-rehearsal-state={d.state}>
      {d.state === 'start' && (<>
        <p className="fine-print">Ready: two sessions of 90 questions, 135 minutes each, from questions held back from every other paper. Reserving pins both sessions; no clock starts until you press Start inside.</p>
        <button type="button" className="primary-button" disabled={busy} onClick={start}>{busy ? 'Reserving…' : 'Prepare my rehearsal'}</button>
      </>)}
      {d.state === 'resume' && d.rehearsalId && <Link className="primary-button" href={`/app/tests/rehearsal/${d.rehearsalId}`}>Open my rehearsal</Link>}
      {d.state === 'insufficient' && (<div>
        <p><strong>View assessment availability:</strong> a full rehearsal cannot be built yet.</p>
        {!compact && <ul>{d.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        {d.next && <p><Link className="secondary-button" href={d.next.href}>{d.next.label}</Link></p>}
      </div>)}
      {!['start', 'resume', 'insufficient'].includes(d.state) && d.message && <p className="fine-print">{d.message}{d.next ? <> <Link className="prose-link" href={d.next.href}>{d.next.label}</Link></> : null}</p>}
      {error && <p role="alert" className="review-error">{error}</p>}
    </div>
  )
}
