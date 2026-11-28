'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { LogLearningSheet } from './LogLearningSheet'

/** "Log learning" anywhere in the app: opens the same sheet /app/log renders, in place. */
export function LogLearningButton({ classLed = false, readingId, taskId, className = 'secondary-button' }: {
  classLed?: boolean
  readingId?: string
  taskId?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden /> Log learning
      </button>
      {open && (
        <Dialog open onClose={() => setOpen(false)} size="lg" title="Log learning"
          description="Record study you already did, against a planned block or as a separate session.">
          <LogLearningSheet classLed={classLed} initialReadingId={readingId} initialTaskId={taskId} onDone={() => setOpen(false)} />
        </Dialog>
      )}
    </>
  )
}
