"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function ClassesCompletedToggle({ classesCompletedAt }: { classesCompletedAt: string | null }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const done = classesCompletedAt != null

  async function toggle() {
    setBusy(true)
    try {
      const res = await fetch('/api/profile/classes-completed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: !done }),
      })
      if (res.ok) router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-classes-done">
      <p className="fine-print">
        {done
          ? `Marked finished on ${classesCompletedAt}. Your roadmap now plans consolidation and revision like a self-study plan would.`
          : "If your classes finished without a known end date, mark them done — your roadmap moves into consolidation and revision instead of waiting on a class it no longer expects."}
      </p>
      <button type="button" className="secondary-button" onClick={toggle} disabled={busy}>
        {done ? 'Undo — classes are still ongoing' : 'Mark my classes as finished'}
      </button>
    </div>
  )
}
