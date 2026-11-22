import Link from 'next/link'
import { requireReviewerPage } from '../../../../lib/diagnostic/reviewAccess'
import { loadQueue, PAGE_SIZE } from '../../../../lib/diagnostic/reviewService'
import { ITEM_STATES, ITEM_STATE_HELP, ITEM_STATE_LABEL, itemStateLabel } from '../../../../lib/diagnostic/itemState'
import { ReviewNav } from '../../../../components/reviewer/ReviewNav'

export const metadata = { title: 'Item review' }

export const dynamic = 'force-dynamic'

type Sp = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined

/**
 * Reviewer queue. Every count on this page is the size of the whole filtered set; the table shows one page of it.
 * Draft, automatically checked, human reviewed and retired are the only four states, and only "human reviewed" reaches students.
 */
export default async function ItemReviewPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  await requireReviewerPage('/app/tests/review')

  const f = { topic: one(sp.topic), reading: one(sp.reading), outcome: one(sp.outcome), state: one(sp.state), batch: one(sp.batch), difficulty: one(sp.difficulty), family: one(sp.family), page: Number(one(sp.page) ?? 1) || 1 }
  const q = await loadQueue(f)
  const readings = q.readings.filter(r => !f.topic || r.topicId === f.topic)
  const link = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...f, ...over })) if (v !== undefined && v !== '' && !(k === 'page' && v === 1)) p.set(k, String(v))
    const s = p.toString()
    return `/app/tests/review${s ? `?${s}` : ''}`
  }
  const first = q.total === 0 ? 0 : (q.page - 1) * PAGE_SIZE + 1
  const last = Math.min(q.total, q.page * PAGE_SIZE)

  return (
    <div className="page-content tests-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Reviewer workspace</p>
          <h1>Question review</h1>
          <p>
            Inspect, correct, re-check and publish questions. Students only ever receive <strong>human reviewed</strong> questions;
            everything else here is a candidate and stays out of their papers and evidence.
          </p>
        </div>
        <ReviewNav current="queue" />
      </header>

      <section className="review-stats" aria-label="Queue totals for the current filter">
        {ITEM_STATES.map(s => (
          <Link key={s} href={link({ state: f.state === s ? undefined : s, page: 1 })} className={`review-stat rv-stat-link ${f.state === s ? 'is-active' : ''}`} title={ITEM_STATE_HELP[s]} aria-current={f.state === s ? 'true' : undefined}>
            <strong>{q.stateTotals[s]}</strong>
            <span>{ITEM_STATE_LABEL[s]}</span>
          </Link>
        ))}
        <div className="review-stat">
          <strong>{q.allTotal}</strong>
          <span>all items in this filter</span>
        </div>
        <div className="review-stat" title="Of the items a person has decided on, how many they approved. A low figure means the automatic checks pass things a person would not.">
          <strong>{q.agreement.decided ? `${Math.round((q.agreement.approved / q.agreement.decided) * 100)}%` : '—'}</strong>
          <span>verifier–human agreement ({q.agreement.decided} decided)</span>
        </div>
      </section>

      {q.legacyUnrecorded > 0 && (
        <p className="notice notice--warn" role="note">
          <span>
            {q.legacyUnrecorded} item{q.legacyUnrecorded === 1 ? ' is' : 's are'} marked <strong>Human reviewed</strong> but {q.legacyUnrecorded === 1 ? 'has' : 'have'} no recorded reviewer decision (they predate decision records).
            They are shown as “reviewed, no decision on record”. Open one and approve it to record who checked it.
          </span>
        </p>
      )}

      <form method="get" className="rv-filters" aria-label="Filter the queue">
        <label>Topic
          <select name="topic" defaultValue={f.topic ?? ''}>
            <option value="">All topics</option>
            {q.topics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>Reading
          <select name="reading" defaultValue={f.reading ?? ''}>
            <option value="">All readings</option>
            {readings.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </label>
        <label>Outcome
          <select name="outcome" defaultValue={f.outcome ?? ''} disabled={!f.reading}>
            <option value="">{f.reading ? 'All outcomes' : 'Choose a reading first'}</option>
            {q.outcomes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        </label>
        <label>State
          <select name="state" defaultValue={f.state ?? ''}>
            <option value="">Every state</option>
            {ITEM_STATES.map(s => <option key={s} value={s}>{ITEM_STATE_LABEL[s]}</option>)}
          </select>
        </label>
        <label>Batch
          <select name="batch" defaultValue={f.batch ?? ''}>
            <option value="">Any source</option>
            <option value="none">Not from a batch</option>
            {q.batches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </label>
        <label>Intended level
          <select name="difficulty" defaultValue={f.difficulty ?? ''}>
            <option value="">Any</option>
            {['foundation', 'standard', 'difficult', 'stretch'].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label>Family
          <select name="family" defaultValue={f.family ?? ''}>
            <option value="">Any</option>
            <option value="provisional">Provisional (not yet confirmed)</option>
            <option value="confirmed">Confirmed independent</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <button className="secondary-button" type="submit">Apply</button>
        <Link className="text-button" href="/app/tests/review">Clear</Link>
      </form>

      <p className="rv-count" role="status">
        {q.total === 0 ? 'No items match.' : `Showing ${first}–${last} of ${q.total} matching item${q.total === 1 ? '' : 's'}.`}
        {f.state ? ` State: ${itemStateLabel(f.state)}.` : ''}{f.family ? ` Family: ${f.family}.` : ''}{f.difficulty ? ` Level: ${f.difficulty}.` : ''}
      </p>

      {q.rows.length > 0 && (
        <div className="rv-table" role="table" aria-label="Items">
          <div className="rv-row rv-row--head" role="row">
            <span role="columnheader">Question</span><span role="columnheader">Where</span><span role="columnheader">State</span><span role="columnheader">Why it is not published</span>
          </div>
          {q.rows.map(r => (
            <Link key={r.id} href={`/app/tests/review/${encodeURIComponent(r.id)}`} className="rv-row" role="row">
              <span role="cell" className="rv-stem"><strong>{r.stem}</strong><small>{r.id} · v{r.version}{r.batchLabel ? ` · ${r.batchLabel}` : ''}{r.supersedes ? ` · replaces ${r.supersedes}` : ''}</small></span>
              <span role="cell"><small>{r.topicName}</small><small>{r.readingLabel}</small><small>{r.outcomeTitle ?? 'No outcome'}</small></span>
              <span role="cell" className="rv-tags">
                <em className={`tag tag--state-${r.state}`}>{r.legacyReview ? 'Reviewed, no decision on record' : itemStateLabel(r.state)}</em>
                {r.heldOut && <em className="tag tag--dim">Held out</em>}
                {r.familyStatus === 'unknown' && <em className="tag tag--dim">Family unknown</em>}
                {r.familyStatus === 'provisional' && <em className="tag tag--warn">Family provisional</em>}
                {r.difficulty && <em className="tag tag--dim">{r.difficulty}</em>}
                {r.disagreement && <em className="tag tag--warn">Checkers disagree</em>}
              </span>
              <span role="cell"><small>{r.state === 'reviewed' || r.state === 'deprecated' ? '—' : r.blockers.length ? r.blockers.slice(0, 2).join(' ') + (r.blockers.length > 2 ? ` (+${r.blockers.length - 2} more)` : '') : 'Ready for a decision'}</small></span>
            </Link>
          ))}
        </div>
      )}

      {q.pageCount > 1 && (
        <nav className="rv-pager" aria-label="Pages">
          {q.page > 1 ? <Link className="secondary-button" href={link({ page: q.page - 1 })}>← Previous</Link> : <span />}
          <span>Page {q.page} of {q.pageCount}</span>
          {q.page < q.pageCount ? <Link className="secondary-button" href={link({ page: q.page + 1 })}>Next →</Link> : <span />}
        </nav>
      )}
    </div>
  )
}
