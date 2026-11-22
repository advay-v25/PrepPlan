'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Resolves a student's challenge through the existing command (restores or voids the disputed evidence and reconciles repairs). */
export function ChallengeResolver({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function go(resolution: 'resolved_kept' | 'resolved_voided') {
    setBusy(true); setErr('')
    try {
      const res = await fetch(`/api/diagnostic/challenge/${encodeURIComponent(id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution }) })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.ok) router.refresh()
      else setErr(data?.error ?? 'Could not confirm the decision. Reload to check, then try again.')
    } catch {
      setErr('Could not confirm the decision. Reload to check, then try again.')
    } finally { setBusy(false) }
  }
  return (
    <div className="rv-actions">
      <button type="button" className="secondary-button" disabled={busy} onClick={() => go('resolved_kept')}>Keep the question and the evidence</button>
      <button type="button" className="secondary-button is-danger" disabled={busy} onClick={() => go('resolved_voided')}>The question is defective: void the evidence</button>
      {err && <span role="alert" className="auth-error">{err}</span>}
    </div>
  )
}
