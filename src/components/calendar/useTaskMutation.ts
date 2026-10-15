'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * The client half of the editing contract.
 *
 * Every write sends the revision it read. A 409 is not an error to swallow: it
 * means the task changed elsewhere, and the student is told rather than having
 * their edit silently win or silently lose.
 */

export type ConflictInfo = {
  message: string
  conflicts: { title: string; overlapMinutes: number }[]
  suggestions: { date: string; start: number; label: string }[]
}

export type PendingWarning = {
  warnings: { title: string; overlapMinutes: number }[]
  retry: () => Promise<void>
}

export type UndoState = {
  message: string
  taskId: string
}

export function useTaskMutation() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<ConflictInfo | null>(null)
  const [warning, setWarning] = useState<PendingWarning | null>(null)
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [staleNotice, setStaleNotice] = useState('')

  // What the last call tried to do. A conflict dialog needs it to retry against
  // a suggested slot: the task being dragged is not necessarily the one open in
  // the drawer, so the retry cannot infer its target from selection.
  const lastAttempt = useRef<{ taskId: string; body: Record<string, unknown>; options: any } | null>(null)

  const clear = useCallback(() => {
    setError(''); setConflict(null); setWarning(null); setStaleNotice('')
  }, [])

  const call = useCallback(async (
    taskId: string,
    body: Record<string, unknown>,
    options: { undoMessage?: string; onRetry?: (extra: Record<string, unknown>) => Promise<void> } = {}
  ): Promise<boolean> => {
    setBusy(true)
    clear()
    lastAttempt.current = { taskId, body, options }
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.ok) {
        if (options.undoMessage) setUndo({ message: options.undoMessage, taskId })
        router.refresh()
        setBusy(false)
        return true
      }

      if (data.code === 'CONFLICT') {
        setConflict({ message: data.error, conflicts: data.conflicts ?? [], suggestions: data.suggestions ?? [] })
      } else if (data.code === 'NEEDS_CONFIRMATION') {
        setWarning({
          warnings: data.warnings ?? [],
          retry: async () => { await call(taskId, { ...body, acceptWarnings: true }, options) },
        })
      } else if (data.code === 'REVISION_MISMATCH') {
        // Refresh so the student sees the version that actually won.
        setStaleNotice(data.error ?? 'This task changed somewhere else.')
        router.refresh()
      } else {
        setError(data.error || 'That change could not be saved')
      }
      setBusy(false)
      return false
    } catch {
      setError('Network error — nothing was changed')
      setBusy(false)
      return false
    }
  }, [router, clear])

  const runUndo = useCallback(async () => {
    if (!undo) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(undo.taskId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'undo' }),
      })
      const data = await res.json()
      if (!data.ok) setError(data.error || 'That could not be undone')
      else router.refresh()
    } catch {
      setError('Network error')
    }
    setUndo(null)
    setBusy(false)
  }, [undo, router])

  const dismissUndo = useCallback(() => setUndo(null), [])

  /**
   * Retries the refused change against a slot the student picked, keeping
   * everything else about the attempt the same.
   */
  const retryAt = useCallback(async (slot: { date: string; start: number }, undoMessage?: string) => {
    const attempt = lastAttempt.current
    if (!attempt) { setConflict(null); return }
    await call(
      attempt.taskId,
      { ...attempt.body, date: slot.date, startMinutes: slot.start },
      // The original message described the drop that was refused; the undo has
      // to describe where the task actually ended up.
      { ...attempt.options, undoMessage: undoMessage ?? attempt.options?.undoMessage }
    )
  }, [call])

  return { busy, error, conflict, warning, undo, staleNotice, call, retryAt, runUndo, dismissUndo, clear, setError }
}
