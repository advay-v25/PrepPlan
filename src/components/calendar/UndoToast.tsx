'use client'

import { useEffect, useState } from 'react'
import { Undo2, X } from 'lucide-react'

const VISIBLE_MS = 10_000

/**
 * Edits apply immediately, so undo is what makes that safe.
 *
 * It stays long enough to notice a mistake and is dismissible, and it announces
 * politely so a screen reader hears the change without losing focus.
 */
export function UndoToast({
  message, onUndo, onDismiss,
}: {
  message: string
  onUndo: () => void | Promise<void>
  onDismiss: () => void
}) {
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), VISIBLE_MS - 400)
    const close = setTimeout(onDismiss, VISIBLE_MS)
    return () => { clearTimeout(fade); clearTimeout(close) }
  }, [onDismiss])

  return (
    <div className={`undo-toast ${leaving ? 'is-leaving' : ''}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button className="undo-toast__action" onClick={() => onUndo()}>
        <Undo2 size={14} aria-hidden /> Undo
      </button>
      <button className="icon-button" onClick={onDismiss} aria-label="Dismiss"><X size={15} /></button>
    </div>
  )
}
