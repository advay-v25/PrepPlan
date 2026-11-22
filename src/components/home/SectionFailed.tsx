'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Notice } from '../ui/Notice'

/** A section that could not be read: said plainly, with a way to try again, never shown as "nothing here". */
export function SectionFailed({ what, reference }: { what: string; reference?: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [tried, setTried] = useState(false)
  return (
    <Notice tone="warn" role="alert">
      {what} could not be loaded just now.{' '}
      <button type="button" className="text-button" disabled={pending} onClick={() => { setTried(true); start(() => router.refresh()) }}>{pending ? 'Trying again…' : tried ? 'Try again' : 'Retry'}</button>
      {reference && <small>Support reference <code>{reference}</code></small>}
    </Notice>
  )
}
