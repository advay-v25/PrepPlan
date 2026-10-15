'use client'

import { useEffect, useRef } from 'react'
import { scrollStagger } from '../../lib/motion'

/** Like StaggerList, but triggers when the container scrolls into view. */
export function ScrollStagger({ children, className, stagger }: {
  children: React.ReactNode
  className?: string
  stagger?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return scrollStagger(el, { stagger })
  }, [stagger])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
