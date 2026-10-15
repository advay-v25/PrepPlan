import Link from 'next/link'
import { Wrench, Eye, ShieldCheck, CircleDashed, ChevronDown, ClipboardCheck } from 'lucide-react'
import type { LosTracker, TrackerModule } from '../../lib/curriculum/losTrackerService'
import type { LosBand, LosProgress, TrackerRow } from '../../lib/curriculum/losTracker'

/**
 * Per-LOS readiness: what the student has actually demonstrated, and what to do
 * about it. Server-rendered from live evidence, so it is current on every visit
 * and needs no client state. Band is always shown as icon + word, never colour
 * alone.
 */

const BAND_META: Record<LosBand, { label: string; blurb: string; Icon: typeof Wrench }> = {
  repair: { label: 'Repair', blurb: 'Recurring or explicit weakness', Icon: Wrench },
  verify: { label: 'Verify', blurb: 'Isolated uncertainty or too little evidence', Icon: Eye },
  maintain: { label: 'Maintain', blurb: 'Demonstrated — keep it warm', Icon: ShieldCheck },
  untested: { label: 'Untested', blurb: 'No valid evidence yet', Icon: CircleDashed },
}
const BAND_ORDER: LosBand[] = ['repair', 'verify', 'maintain', 'untested']

const PROGRESS_LABEL: Record<LosProgress, string> = {
  not_started: 'Not started', scheduled: 'Scheduled', in_progress: 'Worked — awaiting retest',
  retest_due: 'Retest due', complete: 'Holding',
}
const COVERAGE_LABEL: Record<string, string> = {
  not_started: 'Not started', taught: 'Covered in class', studied: 'Studied',
  verified: 'Verified by a paper', decaying: 'Going stale',
}

function BandChip({ band }: { band: LosBand }) {
  const { label, Icon } = BAND_META[band]
  return <span className={`los-chip los-chip--${band}`}><Icon size={14} aria-hidden /> {label}</span>
}

function when(iso: string | null) {
  if (!iso) return 'never'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function Row({ row }: { row: TrackerRow }) {
  return (
    <details className={`los-row los-row--${row.band}`}>
      <summary>
        <span className="los-row__code">{row.los.replace(/^LOS\s*/i, '')}</span>
        <span className="los-row__name">{row.name}</span>
        <BandChip band={row.band} />
        <span className="los-row__progress">{PROGRESS_LABEL[row.progress]}</span>
        <ChevronDown size={16} aria-hidden className="los-row__chev" />
      </summary>
      <div className="los-row__body">
        <p className="los-row__why">{row.rationale}</p>
        <dl>
          {row.scopeNote && (<><dt>Scope</dt><dd>{row.scopeNote}</dd></>)}
          {row.howToImprove && (<><dt>How to improve</dt><dd>{row.howToImprove}</dd></>)}
          {row.proof && (<><dt>Proof of mastery</dt><dd>{row.proof}</dd></>)}
          {row.classCoverage !== 'none' && (<><dt>In class</dt><dd>{row.classCoverage === 'full' ? 'Covered in full' : 'Partly covered'} — exposure only, it does not change the band.</dd></>)}
          <dt>Evidence</dt>
          <dd>{row.sample === 0 ? 'None yet' : `${row.sample} valid observation${row.sample === 1 ? '' : 's'}, last checked ${when(row.lastCheckedAt)}`}
            {row.confidenceMismatch && ' · confidence and accuracy disagreed'}</dd>
        </dl>
        <Link href="/app/tests" className="los-row__action">
          <ClipboardCheck size={15} aria-hidden /> {row.band === 'untested' ? 'Take a first check' : 'Check this in Tests'}
        </Link>
      </div>
    </details>
  )
}

function ModuleBlock({ mod, band, topicId }: { mod: TrackerModule; band: LosBand | 'all'; topicId: string }) {
  const rows = band === 'all' ? mod.rows : mod.rows.filter(r => r.band === band)
  if (band !== 'all' && rows.length === 0) return null
  return (
    <div className="los-module">
      <div className="los-module__head">
        <h4><Link href={`/app/curriculum/${topicId}/${mod.id}`}>Reading {mod.readingNo}: {mod.name}</Link></h4>
        <span className="los-module__cov">{COVERAGE_LABEL[mod.coverage] ?? mod.coverage}</span>
      </div>
      {mod.tracked
        ? rows.map(r => <Row key={r.outcomeId} row={r} />)
        : <p className="los-module__none">The outcome structure for this reading is still being defined.</p>}
    </div>
  )
}

export function ReadinessTracker({ tracker, band }: { tracker: LosTracker; band: LosBand | 'all' }) {
  const { totals, topics, studyOrder, depth } = tracker
  const evidenceless = totals.repair + totals.verify + totals.maintain === 0

  return (
    <section className="los-tracker" aria-label="Readiness by learning outcome">
      <div className="los-summary" role="group" aria-label="Filter by band">
        {BAND_ORDER.map(b => {
          const { label, blurb, Icon } = BAND_META[b]
          const active = band === b
          return (
            <Link key={b} href={active ? '/app/curriculum?view=readiness' : `/app/curriculum?view=readiness&band=${b}`}
              className={`los-stat los-stat--${b} ${active ? 'is-active' : ''}`} aria-pressed={active}>
              <span className="los-stat__n">{totals[b]}</span>
              <span className="los-stat__l"><Icon size={14} aria-hidden /> {label}</span>
              <small>{blurb}</small>
            </Link>
          )
        })}
      </div>
      <p className="los-depth">
        {depth.withEvidence} of {depth.outcomes} learning outcomes have test evidence so far, across {depth.readings} readings.
        Bands come from diagnostic and revision evidence only — completing a task or feeling confident never moves a row on its own.
      </p>

      {evidenceless ? (
        <div className="los-empty">
          <h3>Nothing is classified yet</h3>
          <p>Each outcome becomes Repair, Verify or Maintain from what you demonstrate. Take a module diagnostic to start; guessed-correct answers do not count as mastery.</p>
          <Link href="/app/tests" className="primary-button">Open Tests</Link>
        </div>
      ) : studyOrder.length > 0 && band === 'all' && (
        <section className="los-order">
          <h3>Work in this order</h3>
          <p>Close the Repair rows before broad rereading, then Verify under fresh wording.</p>
          <ol>
            {studyOrder.slice(0, 8).map(r => (
              <li key={r.outcomeId}>
                <BandChip band={r.band} /> <strong>{r.name}</strong>
                <span>{r.questionRange} · {PROGRESS_LABEL[r.progress].toLowerCase()}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {topics.map(t => {
        const visible = band === 'all' ? t.modules : t.modules.filter(m => m.rows.some(r => r.band === band))
        if (visible.length === 0) return null
        return (
          <details key={t.id} className="los-topic" open={t.counts.repair + t.counts.verify > 0 || band !== 'all'}>
            <summary>
              <h3>{t.name}</h3>
              <span className="los-topic__counts">
                {BAND_ORDER.filter(b => t.counts[b] > 0).map(b => (
                  <span key={b} className={`los-count los-count--${b}`}>{t.counts[b]} {BAND_META[b].label}</span>
                ))}
                {t.counts.total === 0 && <span className="los-count">Structure to come</span>}
              </span>
            </summary>
            {visible.map(m => <ModuleBlock key={m.id} mod={m} band={band} topicId={t.id} />)}
          </details>
        )
      })}
    </section>
  )
}
