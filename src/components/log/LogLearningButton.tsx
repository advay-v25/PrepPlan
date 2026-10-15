'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { LogLearningSheet } from './LogLearningSheet'

/** "Log learning" anywhere in the app: opens the same sheet /app/log renders, in place. */
export function LogLearningButton({ classLed = false, readingId, className = 'secondary-button', label = 'Log learning' }: {
  classLed?: boolean
  readingId?: string
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> {label}
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} size="lg" title="Log learning"
          description="Record study that already happened. It counts toward your coverage and this week’s paper.">
          <LogLearningSheet classLed={classLed} initialReadingId={readingId} onDone={() => setOpen(false)} />
        </Dialog>
      )}
    </>
  )
}
