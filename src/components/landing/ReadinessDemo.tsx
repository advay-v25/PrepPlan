'use client'

import { useEffect, useRef } from 'react'
import { BarChart3, ClipboardCheck, Compass, Gauge } from 'lucide-react'
import { ProgressRing } from '../ui/ProgressRing'
import { scrollReveal, progressFill } from '../../lib/motion'

/**
 * An illustration of the real Home page's four-signal readiness view — not
 * a visitor's actual data (there is none yet), so it's framed as a preview,
 * never implied to be live. The four signals and their meaning are the
 * product's real mechanism (see src/components/home/SignalsSummary.tsx),
 * not landing-page invention.
 */
const SIGNALS = [
  { icon: Compass, label: 'Position', detail: 'What you have covered', fill: 34 },
  { icon: BarChart3, label: 'Understanding', detail: 'What tests show', fill: 58 },
  { icon: ClipboardCheck, label: 'Execution', detail: 'Plan followed', fill: 71 },
  { icon: Gauge, label: 'Calibration', detail: 'Knowing what you know', fill: 46 },
] as const

export function ReadinessDemo() {
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const cleanups = [
      scrollReveal(root),
      ...Array.from(root.querySelectorAll<HTMLElement>('[data-fill-to]')).map((el, i) =>
        progressFill(el, { delay: 0.15 + i * 0.1 })
      ),
    ]
    return () => cleanups.forEach(fn => fn())
  }, [])

  return (
    <div className="readiness-demo" ref={rootRef}>
      <div className="readiness-demo__ring">
        <ProgressRing percent={52} label="Readiness" size={128} stroke={8} tone="dark" />
        <p className="readiness-demo__caption">A preview of your real readiness view — not live data</p>
      </div>
      <ul className="readiness-demo__signals">
        {SIGNALS.map(s => (
          <li key={s.label} className="readiness-demo__signal">
            <s.icon size={16} aria-hidden />
            <div className="readiness-demo__signal-body">
              <div className="readiness-demo__signal-head">
                <strong>{s.label}</strong>
                <span>{s.detail}</span>
              </div>
              <div className="readiness-demo__track">
                <div className="readiness-demo__fill" data-fill-to={s.fill} style={{ width: `${s.fill}%` }} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
