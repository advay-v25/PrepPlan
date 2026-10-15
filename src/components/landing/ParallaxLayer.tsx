'use client'

import { useEffect, useRef } from 'react'
import { parallaxLayer } from '../../lib/motion'

/**
 * A decorative-only drift layer. Never wraps body copy or a control — per
 * the GSAP parallax guidance this follows, that hurts reading comfort. The
 * parent section needs `overflow: hidden` (set in CSS) so the drifted layer
 * never spills past its section's edge.
 */
export function ParallaxLayer({ children, className, speed = 10 }: {
  children: React.ReactNode
  className?: string
  speed?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return parallaxLayer(el, speed)
  }, [speed])

  return (
    <div ref={ref} className={className} aria-hidden>
      {children}
    </div>
  )
}
