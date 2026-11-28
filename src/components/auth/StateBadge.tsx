'use client'

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { Check, KeyRound, Mail, MailCheck } from 'lucide-react'
import { calm } from '../flow/motion'

const ICONS = { mail: Mail, sent: MailCheck, key: KeyRound, done: Check }

/** The round icon that opens a one-purpose screen: it pops in and a ring draws around it. */
export function StateBadge({ icon }: { icon: keyof typeof ICONS }) {
  const root = useRef<HTMLSpanElement>(null)
  const Icon = ICONS[icon]
  useLayoutEffect(() => {
    if (calm() || !root.current) return
    const ctx = gsap.context(() => {
      gsap.from('.sb-icon', { scale: 0.6, autoAlpha: 0, duration: 0.55, ease: 'back.out(1.6)' })
      gsap.fromTo('.sb-ring', { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.8, ease: 'power2.out' })
    }, root)
    return () => ctx.revert()
  }, [icon])
  return (
    <span className="sb" ref={root} aria-hidden>
      <svg viewBox="0 0 64 64"><circle className="sb-ring" cx="32" cy="32" r="30" pathLength={1} strokeDasharray={1} strokeDashoffset={0} /></svg>
      <span className="sb-icon"><Icon size={24} /></span>
    </span>
  )
}
