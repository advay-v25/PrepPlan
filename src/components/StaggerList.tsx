'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { staggerIn } from '../lib/motion'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

type StaggerListProps = {
  children: React.ReactNode
  className?: string
}

/**
 * Staggers children in on mount.
 *
 * Like Reveal, the hiding is applied by the effect rather than in server-rendered
 * markup, so a list is never invisible because a script did not load. The
 * companion `.stagger-list > * { opacity: 0 }` rule has been removed from
 * styles.css for the same reason.
 */
export function StaggerList({ children, className }: StaggerListProps) {
  const ref = useRef<HTMLDivElement>(null)

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const items = el.querySelectorAll<HTMLElement>(':scope > *')
    items.forEach(item => { item.style.opacity = '0' })
    staggerIn(items)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={ref} className={`stagger-list ${className || ''}`.trim()}>
      {children}
    </div>
  )
}
