'use client'

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { calm } from './motion'

export type RibbonBlock = { start: number; end: number; tone?: 'study' | 'paper' | 'class' | 'done' }
export type RibbonDay = { label: string; blocks: RibbonBlock[] }

const FROM = 6, TO = 24 // 06:00 to midnight, the hours a study week lives in

/** Hours as a decimal, from "18:30". */
export const hours = (t: string) => { const [h, m] = t.split(':').map(Number); return h + (m || 0) / 60 }

/**
 * A week at a glance: seven columns, time running down, one block per window.
 * Blocks are placed with top and height and only fade and grow when they first appear, so nothing re-lays out while animating.
 */
export function WeekRibbon({ days, label, sweep = false }: { days: RibbonDay[]; label: string; sweep?: boolean }) {
  const root = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const fresh = Array.from(el.querySelectorAll<HTMLElement>('.wr-block:not([data-seen])'))
    fresh.forEach(b => b.setAttribute('data-seen', ''))
    if (calm() || fresh.length === 0) return
    const ctx = gsap.context(() => {
      gsap.from(fresh, { autoAlpha: 0, scaleY: 0.2, transformOrigin: 'top', duration: 0.5, ease: 'power3.out', stagger: 0.035 })
      if (sweep) gsap.fromTo('.wr-sweep', { xPercent: -10, autoAlpha: 0 }, { xPercent: 1500, autoAlpha: 0.9, duration: 2.2, ease: 'power2.inOut', delay: 0.9, onComplete: () => { gsap.set('.wr-sweep', { autoAlpha: 0 }) } })
    }, el)
    return () => ctx.revert()
  })

  return (
    <div className="wr" ref={root} role="img" aria-label={label}>
      <div className="wr-cols">
        {days.map(d => (
          <div className="wr-col" key={d.label}>
            <div className="wr-track">
              {d.blocks.map((b, i) => (
                <i key={`${b.start}-${b.end}-${i}`} className={`wr-block wr-block--${b.tone ?? 'study'}`}
                  style={{ top: `${((Math.max(b.start, FROM) - FROM) / (TO - FROM)) * 100}%`, height: `${(Math.max(Math.min(b.end, TO) - Math.max(b.start, FROM), 0.4) / (TO - FROM)) * 100}%` }} />
              ))}
            </div>
            <b>{d.label}</b>
          </div>
        ))}
      </div>
      {sweep ? <span className="wr-sweep" aria-hidden /> : null}
    </div>
  )
}
