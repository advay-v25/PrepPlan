'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

/** Edit and withdraw. Withdrawing is two steps and never deletes planned sittings or history. */
export function MockReportActions({ reportId, version, planned = 0, unplacedMinutes = 0 }: { reportId: string; version: number; planned?: number; unplacedMinutes?: number }) {
  const router = useRouter()
  const key = useRef(crypto.randomUUID())
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function withdraw() {
    if (busy) return; setBusy(true); setError(null)
    try {
      const res = await fetch('/api/mock-reports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'withdraw', key: key.current, reportId, expectedVersion: version }) })
      const data = await res.json().catch(() => ({}))
      if (data.ok) { router.push(data.nextUrl ?? '/app/calendar'); return }
      setError(data.error ?? 'Could not withdraw. Nothing was changed.'); key.current = crypto.randomUUID()
    } catch { setError('The request may not have reached the server. Press again: you will not get a second withdrawal.') } finally { setBusy(false) }
  }
  return (
    <div>
      <Link href={`/app/calendar/mock-report?edit=${reportId}`} className="secondary-button">Edit this report</Link>{' '}
      {!confirming ? <button type="button" className="text-button" onClick={() => setConfirming(true)}>Withdraw it</button>
        : <span role="group" aria-label="Confirm withdrawal">Withdraw this report? {planned > 0 ? `The ${planned} sitting${planned === 1 ? '' : 's'} already planned from it stay in your Calendar as they are (with their source explained).` : 'Nothing has been planned from it yet.'} {unplacedMinutes > 0 ? `The ${unplacedMinutes} minutes you chose that have no sitting yet are not planned or offered again.` : ''} <button type="button" className="primary-button" onClick={withdraw} disabled={busy}>{busy ? 'Working…' : 'Yes, withdraw'}</button> <button type="button" className="text-button" onClick={() => setConfirming(false)}>Keep it</button></span>}
      {error && <p role="alert" className="review-error">{error}</p>}
    </div>
  )
}
