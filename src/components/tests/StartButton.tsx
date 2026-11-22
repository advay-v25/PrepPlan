'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Starts (or resumes) an assessment. Explains a refusal instead of failing silently. */
export function StartButton({ body, label, disabled, className }: { body: Record<string, unknown>; label: string; disabled?: boolean; className?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  async function start() {
    setBusy(true); setMsg(null)
    try {
      const res = await fetch('/api/tests/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const r = await res.json()
      if (r.ok) { router.push(r.url); return }
      setMsg(r.message ?? r.error ?? 'Could not start.')
      if (r.code === 'scope_changed' || r.code === 'bank_insufficient') router.refresh()
    } catch {
      setMsg('Connection lost. Refresh to check for a paper to resume before trying again.')
    } finally { setBusy(false) }
  }
  return (
    <span className="start-button">
      <button type="button" className={className ?? 'primary-button'} disabled={busy || disabled} onClick={start}>{busy ? 'Starting…' : label}</button>
      {msg && <span role="alert" className="review-error">{msg}</span>}
    </span>
  )
}
