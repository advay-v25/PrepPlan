'use client'

import { useEffect, useRef } from 'react'
import { countUp } from '../../lib/motion'

/**
 * A number that counts up to its real value once scrolled into view. The
 * real value is always server-rendered — `value`/`suffix` are read off the
 * element itself at mount, so without JS (or under reduced motion) the
 * visitor sees the correct final number immediately, never a stuck "0".
 */
export function CountUpStat({ value, suffix = '', className }: {
  value: number
  suffix?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    return countUp(el)
  }, [])

  return (
    <span ref={ref} className={className} data-count-to={value} data-count-suffix={suffix}>
      {value}{suffix}
    </span>
  )
}
