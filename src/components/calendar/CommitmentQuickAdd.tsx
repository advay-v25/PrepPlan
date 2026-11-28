'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { CalendarPlus } from 'lucide-react'
import { NextClassDialog } from './NextClassDialog'
import { CommitmentDialog } from './CommitmentDialog'
import { useHydrated } from '../ui/WhenReady'

export function CommitmentQuickAdd({ defaultDate, openNextClass = false }: { defaultDate: string; openNextClass?: boolean }) {
  const requested = useSearchParams().get('action') === 'add-next-class'
  const [open, setOpen] = useState(false)
  const ready = useHydrated()
  const [nextClassOpen, setNextClassOpen] = useState(openNextClass)
  useEffect(() => {
    if (!requested) return
    setNextClassOpen(true)
    const url = new URL(window.location.href)
    url.searchParams.delete('action')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [requested])
  return <>
    <button type="button" className="secondary-button" disabled={!ready} onClick={() => setOpen(true)}>
      <CalendarPlus size={16} aria-hidden /> Add a class or commitment
    </button>
    {nextClassOpen && <NextClassDialog onClose={() => setNextClassOpen(false)} />}
    {open && <CommitmentDialog defaultDate={defaultDate} onClose={() => setOpen(false)} />}
  </>
}
