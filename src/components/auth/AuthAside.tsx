'use client'

import { useLayoutEffect, useRef } from 'react'
import gsap from 'gsap'
import { WeekRibbon, type RibbonDay } from '../flow/WeekRibbon'
import { calm } from '../flow/motion'

const L = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const RAW: [number, number, 'paper'?][][] = [[[18.5, 20]], [[6.5, 8], [19, 20.5]], [], [[18.5, 20]], [[18.5, 19.5]], [[9, 12]], [[9, 11, 'paper']]]
const WEEK: RibbonDay[] = RAW.map((blocks, i) => ({ label: L[i], blocks: blocks.map(([start, end, tone]) => ({ start, end, tone: tone ?? 'study' })) }))
const DONE: RibbonDay[] = WEEK.map((d, i) => ({ ...d, blocks: d.blocks.map(b => (i < 3 && b.tone !== 'paper' ? { ...b, tone: 'done' as const } : b)) }))

/** The dark panel is the same dark in every theme, so its colours are fixed in CSS. One line of words, then the week doing the talking. */
function Aside({ title, line, days, label }: { title: string; line: string; days: RibbonDay[]; label: string }) {
  const root = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (calm() || !root.current) return
    const ctx = gsap.context(() => {
      gsap.from('.su-aside__inner > h2, .su-aside__inner > p', { autoAlpha: 0, y: 16, duration: 0.6, ease: 'power3.out', stagger: 0.08 })
      gsap.from('.su-ribbon', { autoAlpha: 0, y: 24, duration: 0.7, ease: 'power3.out', delay: 0.15 })
    }, root)
    return () => ctx.revert()
  }, [])
  return (
    <aside className="su-aside" ref={root} aria-hidden="true">
      <div className="su-aside__inner">
        <h2>{title}</h2>
        <p>{line}</p>
        <div className="su-ribbon"><WeekRibbon days={days} label={label} sweep /></div>
      </div>
    </aside>
  )
}

export const SignupAside = () => <Aside title="Your week, planned" line="Built around the hours you actually have" days={WEEK} label="An example study week" />
export const LoginAside = () => <Aside title="Back to your week" line="Pick up exactly where you left off" days={DONE} label="An example week with the first days done" />
