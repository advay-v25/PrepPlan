"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ClassesCompletedToggle({ classesCompletedAt }: { classesCompletedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const done = classesCompletedAt != null

  async function toggle() {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/profile/classes-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !done }),
      })
      if (res.ok) router.refresh()
      else setError((await res.json().catch(() => null))?.error ?? 'Could not save this. Nothing was changed; try again.')
    } catch { setError('Could not reach PrepPlan. Nothing was changed; try again.') } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-classes-done">
      <p className="fine-print">
        {done
          ? `Marked finished on ${classesCompletedAt}. From then on your roadmap plans consolidation and revision like a self-study plan. Your accepted week, finished work and class history are unchanged; review any adjustment to unfinished work in Calendar.`
          : "If your classes finished without a known end date, mark them done — your roadmap moves into consolidation and revision instead of waiting on a class it no longer expects."}
      </p>
      {error && <p role="alert" className="review-error">{error}</p>}
      <button type="button" className="secondary-button" onClick={toggle} disabled={busy}>
        {done ? 'Undo — classes are still ongoing' : 'Mark my classes as finished'}
      </button>
    </div>
  )
}
