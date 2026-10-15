'use client'

import { useEffect, useRef } from 'react'
import { scrollStagger } from '../../lib/motion'

const DAYS = [
  { label: 'Mon', state: 'done' },
  { label: 'Tue', state: 'done' },
  { label: 'Wed', state: 'today' },
  { label: 'Thu', state: 'planned' },
  { label: 'Fri', state: 'planned' },
  { label: 'Sat', state: 'planned' },
  { label: 'Sun', state: 'paper' },
] as const

const STATE_LABEL: Record<(typeof DAYS)[number]['state'], string> = {
  done: 'Done', today: 'Today', planned: 'Planned', paper: 'Paper day',
}

/** A mocked week, illustrating "the week adjusts to you" rather than just saying it. */
export function WeekPreview() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return scrollStagger(el, { stagger: 0.06 })
  }, [])

  return (
    <div className="week-preview" ref={ref}>
      {DAYS.map(d => (
        <div key={d.label} className={`week-preview__day week-preview__day--${d.state}`}>
          <span className="week-preview__weekday">{d.label}</span>
          <span className="week-preview__state">{STATE_LABEL[d.state]}</span>
        </div>
      ))}
    </div>
  )
}
