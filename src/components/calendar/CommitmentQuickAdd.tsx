'use client'

import { useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { CommitmentDialog } from './CommitmentDialog'

export function CommitmentQuickAdd({ defaultDate }: { defaultDate: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
      <CalendarPlus size={16} aria-hidden /> Add a class or commitment
    </button>
    {open && <CommitmentDialog defaultDate={defaultDate} onClose={() => setOpen(false)} />}
  </>
}
