'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/** Week navigation preserves the view chosen without requiring a server read just to switch presentation. */
export function CalendarNavigation({ previous, next, today, range, current }: { previous: string; next: string; today: string; range: string; current: boolean }) {
  const params = useSearchParams(), view = params.get('view') === 'agenda' ? 'agenda' : 'week'
  const href = (date: string) => `/app/calendar?${new URLSearchParams({ week: date, view })}`
  return <>
    <nav className="cal-nav" aria-label="Week">
      <Link href={href(previous)} className="cal-nav__step" aria-label="Previous week"><ChevronLeft size={18} aria-hidden /></Link>
      <span className="cal-nav__range">{range}</span>
      <Link href={href(next)} className="cal-nav__step" aria-label="Next week"><ChevronRight size={18} aria-hidden /></Link>
    </nav>
    <Link href={`/app/calendar?${new URLSearchParams({ week: today, view: 'agenda' })}#calendar-today`} className="secondary-button">Today</Link>
    {!current && <Link href="/app/calendar" className="secondary-button">This week</Link>}
  </>
}
