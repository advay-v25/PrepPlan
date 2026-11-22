'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { Notice } from '../ui/Notice'

/**
 * Shown on the current week when it has no planned work yet.
 *
 * Calendar rendering never writes. Building the week is an explicit,
 * student-triggered command: it restores or regenerates a *draft* and takes
 * the student to the existing review step. Nothing reaches the calendar until
 * the draft is accepted there.
 */
export function ActivationPrompt() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function build() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/activation/recover', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) throw new Error(body.error || 'Could not prepare your week.')
      if (body.status === 'already_active') router.refresh()
      else router.push(body.reviewUrl)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="activation-prompt">
      <span className="activation-prompt__icon"><CalendarPlus size={20} aria-hidden /></span>
      <div className="activation-prompt__text">
        <strong>This week isn’t planned yet</strong>
        <p>PrepPlan can draft it from your setup — you review it before anything is placed.</p>
      </div>
      <button type="button" className="primary-button" onClick={build} disabled={busy}>
        <CalendarPlus size={16} aria-hidden /> {busy ? 'Preparing…' : 'Prepare this week'}
      </button>
      {error && <Notice tone="danger" role="alert">{error}</Notice>}
    </div>
  )
}
