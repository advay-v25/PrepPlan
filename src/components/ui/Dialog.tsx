'use client'

import { useId, useRef } from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from '../../lib/a11y/useFocusTrap'
import { IconButton } from './Button'

/**
 * Modal and drawer, over one focus trap.
 *
 * `role` is a prop because `ConflictDialog` genuinely needs `alertdialog` — it
 * interrupts to report a refused action — and normalising that away would be a
 * regression. `variant` exists because `TaskDetailDrawer` is a right-edge drawer
 * with different geometry, and the mobile nav is a second drawer consumer.
 */
export function Dialog({
  open = true,
  onClose,
  title,
  eyebrow,
  description,
  role = 'dialog',
  variant = 'modal',
  size = 'md',
  dismissOnOverlay = true,
  initialFocusRef,
  footer,
  children,
  className,
}: {
  open?: boolean
  onClose: () => void
  /** Usually plain text. A dialog that must lead with a warning icon (e.g. a refused action) passes a fragment. */
  title: React.ReactNode
  /** A small label above the title, e.g. the kind of task a drawer shows. */
  eyebrow?: React.ReactNode
  description?: string
  role?: 'dialog' | 'alertdialog'
  variant?: 'modal' | 'drawer'
  size?: 'sm' | 'md' | 'lg'
  /** A decision dialog should not be dismissable by a stray click outside it. */
  dismissOnOverlay?: boolean
  initialFocusRef?: React.RefObject<HTMLElement | null>
  footer?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()

  useFocusTrap({ containerRef: panelRef, active: open, onEscape: onClose, initialFocusRef })

  if (!open) return null

  return (
    <div
      className={variant === 'drawer' ? 'ui-drawer-overlay' : 'ui-dialog-overlay'}
      onMouseDown={e => { if (dismissOnOverlay && e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={`ui-dialog ui-dialog--${variant} ui-dialog--${size} ${className ?? ''}`.trim()}
      >
        <div className="ui-dialog__head">
          <div>
            {eyebrow && <div className="ui-dialog__eyebrow">{eyebrow}</div>}
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descId} className="fine-print">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}><X size={18} /></IconButton>
        </div>

        <div className="ui-dialog__body">{children}</div>

        {footer && <div className="ui-dialog__foot">{footer}</div>}
      </div>
    </div>
  )
}
