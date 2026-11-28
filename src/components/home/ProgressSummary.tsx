import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { Signals } from '../../lib/signals/signals'
import { calibrationLine, understandingLine } from '../../lib/state/progressSummary'

type Tile = { key: string; label: string; href: string; value: string; unit: string; note: string; warn?: boolean; bar?: number }

/**
 * Four separate signals, never blended: what you report covering, what a valid paper shows, how the week is going, and whether
 * confidence tracks accuracy. Each tile is one number, one short note and a small visual; the tile opens the page that owns the detail.
 * Wording stays honest about how much evidence there is (the full sentences live on those pages, not here).
 */
export function ProgressSummary({ s, today, timezone, checkpoint }: { s: Signals; today: string; timezone: string; checkpoint?: { label: string; detail: string; href: string } | null }) {
  const u = understandingLine(s, today, timezone), c = calibrationLine(s)
  const r = s.position.readings, e = s.execution
  const sure = c.percent != null

  const tiles: Tile[] = [
    { key: 'coverage', label: 'Covered', href: '/app/curriculum?view=readiness', value: r.total ? `${r.covered}/${r.total}` : '–', unit: 'readings', bar: r.total ? r.covered / r.total : 0,
      note: r.total === 0 ? 'Not loaded' : r.partial ? `${r.partial} partly · exposure, not mastery` : 'Exposure, not mastery', warn: r.total === 0 },
    { key: 'understanding', label: 'Test evidence', href: u.href, warn: u.tone === 'warn',
      value: s.understanding.integrityWarning ? 'Disputed' : !s.understanding.validEvents ? 'No valid evidence' : s.understanding.recent ? 'Recent check' : 'Older check', unit: '',
      note: s.understanding.validEvents ? `${s.position.tested} outcomes sampled` : 'Moves when a valid paper is scored' },
    { key: 'week', label: 'This week', href: '/app/calendar', value: e.total ? `${e.completed}/${e.total}` : '–', unit: 'done', bar: e.total ? e.completed / e.total : 0,
      note: e.total === 0 ? 'Nothing planned' : e.unreported > 0 ? `${e.unreported} to update` : 'All up to date', warn: e.unreported > 0 },
    { key: 'confidence', label: 'Confidence', href: '/app/tests#signals-h', value: sure ? `${c.percent}%` : '–', unit: sure ? 'right when sure' : '',
      note: sure ? `From ${c.sureSample} “sure” answers` : c.sureSample > 0 ? `${c.sureSample} of 5 “sure” answers` : 'Needs 5 “sure” answers', bar: sure ? c.percent! / 100 : 0 },
  ]

  return (
    <section className="stand" aria-labelledby="stand-h">
      <header className="home-section__head">
        <h2 id="stand-h">How you are progressing</h2>
        <Link href="/app/tests#signals-h" className="text-button">All signals &rarr;</Link>
      </header>
      <ul className="stand__tiles">
        {tiles.map(t => (
          <li key={t.key}>
            <Link href={t.href} className={`stand__tile${t.warn ? ' is-warn' : ''}`}>
              <span className="stand__label">{t.label}<ArrowUpRight size={13} aria-hidden /></span>
              <span className="stand__value">{t.value}{t.unit && <small>{t.unit}</small>}</span>
              {t.bar != null && <span className="stand__bar" role="img" aria-label={`${Math.round(t.bar * 100)}%`}><span style={{ width: `${Math.round(t.bar * 100)}%` }} /></span>}
              <span className="stand__note">{t.note}</span>
            </Link>
          </li>
        ))}
      </ul>
      {checkpoint && <p className="stand__checkpoint"><span>Next checkpoint</span> <Link href={checkpoint.href}>{checkpoint.label}</Link></p>}
    </section>
  )
}
