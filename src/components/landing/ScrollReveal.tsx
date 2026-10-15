'use client'

import { useEffect, useRef } from 'react'
import { scrollReveal } from '../../lib/motion'

/**
 * Like Reveal, but triggers the first time the element scrolls into view
 * rather than on mount — most of a long story page is off-screen at load.
 * Content is never hidden in server-rendered markup (see Reveal's own
 * comment for why); the opacity-0 starting state is applied by the effect,
 * so a visitor without JS simply sees the real content immediately.
 */
export function ScrollReveal({ children, className, delay, y, as: Tag = 'div' }: {
  children: React.ReactNode
  className?: string
  delay?: number
  y?: number
  as?: 'div' | 'section' | 'li'
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return scrollReveal(el, { delay, y })
  }, [delay, y])

  return (
    <Tag ref={ref as never} className={className}>
      {children}
    </Tag>
  )
}
