'use client'

import { useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import type { ConflictInfo } from './useTaskMutation'

function timeLabel(minutes: number) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const suffix = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${hour12}${suffix}` : `${hour12}:${String(m).padStart(2, '0')}${suffix}`
}

/**
 * Refusing a drop without saying where it could go leaves the student to hunt
 * for a gap by trial and error, so the alternatives are the point of this
 * dialog, not the error message.
 *
 * Built on the shared `Dialog` primitive (focus trap, scroll lock, Escape and
 * overlay dismissal) instead of its own copy of that logic.
 */
export function ConflictDialog({
  info, onPick, onClose, onConfirm, confirmLabel,
}: {
  info: ConflictInfo
  onPick?: (slot: { date: string; start: number }) => void | Promise<void>
  onConfirm?: () => void | Promise<void>
  confirmLabel?: string
  onClose: () => void
}) {
  // The dialog should not open focused on its own close button — it opens
  // focused on the most useful next action: the first suggested slot, or,
  // when there is none, the button that dismisses it.
  const firstRef = useRef<HTMLButtonElement>(null)

  return (
    <Dialog
      open
      onClose={onClose}
      role="alertdialog"
      className="conflict-dialog"
      title={<><AlertTriangle size={18} aria-hidden style={{ color: 'var(--warning)' }} /> {info.message}</>}
      initialFocusRef={firstRef}
      footer={
        <>
          <button ref={!info.suggestions.length || !onPick ? firstRef : undefined} className="secondary-button" onClick={onClose}>
            {onConfirm ? 'Cancel' : 'Leave it where it was'}
          </button>
          {onConfirm && (
            <button className="primary-button" onClick={() => onConfirm()}>{confirmLabel ?? 'Continue'}</button>
          )}
        </>
      }
    >
      {info.conflicts.length > 0 && (
        <ul className="conflict-list">
          {info.conflicts.map((c, i) => (
            <li key={i}>
              <strong>{c.title}</strong>
              <small>{c.overlapMinutes} minutes of overlap</small>
            </li>
          ))}
        </ul>
      )}

      {info.suggestions.length > 0 && onPick && (
        <>
          <h3 className="conflict-dialog__subhead">Nearest free slots</h3>
          <div className="conflict-slots">
            {info.suggestions.map((s, i) => (
              <button
                key={i}
                ref={i === 0 ? firstRef : undefined}
                className="conflict-slot"
                onClick={() => onPick(s)}
              >
                <strong>{timeLabel(s.start)}</strong>
                <small>{s.label}</small>
              </button>
            ))}
          </div>
        </>
      )}

      {info.suggestions.length === 0 && !onConfirm && (
        <p className="fine-print">
          Nothing of that length is free nearby. Shorten it, split it, or move something else first.
        </p>
      )}
    </Dialog>
  )
}
