import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { Signals } from '../../lib/signals/signals'
import { ProgressRing } from '../ui/ProgressRing'

const BANDS = ['Insufficient evidence', 'Building', 'Developing', 'Stable'] as const

/**
 * Four separate signals — never one blended score (signals.ts's house rule). Three have a real
 * percentage, so they get a ring; understanding is a band, not a percent, so it is a stepped
 * meter rather than an invented number. Each tile opens the page that owns its detail.
 */
export function ReadinessOverview({ s }: { s: Signals }) {
  const position = s.position.total ? Math.round((s.position.exposed / s.position.total) * 100) : 0
  const execution = s.execution.total ? Math.round((s.execution.completed / s.execution.total) * 100) : 0
  const band = Math.max(0, BANDS.indexOf(s.understanding.band))
  const calibrated = s.calibration.sample > 0 && s.calibration.sureAccuracy != null
  const calibration = calibrated ? Math.round(s.calibration.sureAccuracy! * 100) : 0

  const tiles = [
    {
      href: '/app/curriculum?view=readiness', label: 'Syllabus covered',
      visual: <ProgressRing percent={position} size={72} stroke={7} tone="dark" />,
      value: `${s.position.exposed} / ${s.position.total}`, unit: 'outcomes',
      caption: 'Coverage is exposure, not mastery.',
    },
    {
      href: '/app/tests', label: 'Understanding',
      visual: (
        <div className="stand__meter" role="img" aria-label={`Understanding: ${s.understanding.band}`}>
          {BANDS.map((b, i) => <span key={b} className={i <= band && s.understanding.band !== 'Insufficient evidence' ? 'is-on' : ''} />)}
        </div>
      ),
      value: s.understanding.band === 'Insufficient evidence' ? 'No tests yet' : s.understanding.band, unit: '',
      caption: s.understanding.scoredPapers
        ? `${s.understanding.scoredPapers} scored paper${s.understanding.scoredPapers === 1 ? '' : 's'} so far.`
        : 'Moves only when a valid test is scored.',
    },
    {
      href: '/app/calendar', label: 'Plan followed',
      visual: <ProgressRing percent={execution} size={72} stroke={7} tone="dark" />,
      value: `${s.execution.completed} / ${s.execution.total}`, unit: 'tasks this week',
      caption: s.execution.total === 0 ? 'Nothing planned yet this week.'
        : `${s.execution.skipped} skipped · ${s.execution.postponed} deferred`,
    },
    {
      href: '/app/tests', label: 'Confidence vs accuracy',
      visual: calibrated ? <ProgressRing percent={calibration} size={72} stroke={7} tone="dark" /> : <div className="stand__unknown" aria-hidden>?</div>,
      value: calibrated ? `${calibration}%` : 'Too early', unit: calibrated ? 'right when sure' : '',
      caption: calibrated ? `${s.calibration.confidentWrong} sure-but-wrong answers.` : 'Needs answers marked with confidence.',
    },
  ]

  return (
    <section className="stand" aria-labelledby="stand-h">
      <header className="home-section__head">
        <h2 id="stand-h">Where you stand</h2>
        <Link href="/app/tests" className="text-button">All signals &rarr;</Link>
      </header>
      <div className="stand__grid">
        {tiles.map(t => (
          <Link key={t.label} href={t.href} className="stand__tile">
            <span className="stand__label">{t.label}<ArrowUpRight size={14} aria-hidden /></span>
            <span className="stand__visual">{t.visual}</span>
            <span className="stand__value">{t.value}{t.unit && <small>{t.unit}</small>}</span>
            <span className="stand__caption">{t.caption}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
