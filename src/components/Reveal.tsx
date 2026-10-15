'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { fadeInUp } from '../lib/motion'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type RevealProps = {
  children: React.ReactNode
  className?: string
}

/**
 * Fades content in on mount.
 *
 * It does NOT render at `opacity: 0` server-side. It used to, which meant the
 * content was invisible until GSAP loaded and ran — so a script failure, a slow
 * network, or JavaScript being off left the page silently blank. That is
 * content loss, not a missing animation.
 *
 * Instead the hiding is applied by the effect itself, which only runs where the
 * animation can also run. Without JavaScript the content is simply visible.
 */
export function Reveal({ children, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    fadeInUp(el)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
