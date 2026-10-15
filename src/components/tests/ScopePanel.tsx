import Link from 'next/link'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import { ScopeConfirmForm, QuickStudyForm } from './ScopeForms'

type Catalog = { id: string; name: string; readings: { id: string; no: number; title: string; outcomes: { id: string; code: string; title: string }[] }[] }[]

const EXCLUDED_LABEL: Record<string, string> = {
  postponed: 'Postponed — moved forward, not tested this time',
  missed: 'Missed — not tested; Calendar carries it forward',
  not_completed: 'Not marked done — not tested',
  structure_pending: 'Ethics structure is still being defined — not tested yet',
}
const PAPER_LABEL = { diagnostic: 'Weekly diagnostic (new material)', revisionary: 'Weekly revisionary paper (revisited material)', mixed: 'Weekly mixed paper (new + revisionary)' }

/** What this week's paper is built from. Everything here is a read; the forms write only through their own routes. */
export function ScopePanel({ preview, catalog }: { preview: PaperPreview; catalog: Catalog }) {
  const { scope, blueprint, paperKind } = preview
  const readingName = new Map(catalog.flatMap(s => s.readings.map(r => [r.id, { no: r.no, title: r.title, subject: s.id, outcomes: r.outcomes }] as const)))
  const subjName = new Map(catalog.map(s => [s.id, s.name]))

  return (
    <section className="scope-panel" aria-labelledby="scope-h">
      <h2 id="scope-h">What this week&apos;s paper tests</h2>
      <p className="muted">Only work you have <strong>completed</strong> is tested. Calendar plans it; your completion decides it.</p>

      {preview.noPaperReason ? (
        <p role="status" className="note">{preview.noPaperReason}</p>
      ) : (
        <>
          <p><strong>{PAPER_LABEL[paperKind]}</strong> — {blueprint.totalQuestions} questions, about {blueprint.estimatedMinutes} minutes
            {' '}(never more than {blueprint.policy.ceiling}). {scope.totals.newOutcomes} new and {scope.totals.revisionOutcomes} revisited outcomes from {scope.totals.readings} reading{scope.totals.readings === 1 ? '' : 's'}
            in {scope.totals.subjects} subject{scope.totals.subjects === 1 ? '' : 's'}.</p>
          <ul className="scope-panel__readings">
            {blueprint.perReading.map(r => {
              const rd = readingName.get(r.readingId)
              return <li key={r.readingId}><Link href={`/app/curriculum/${r.subjectId}/${r.readingId}`}>Reading {rd?.no}: {rd?.title}</Link> — {r.questions} question{r.questions === 1 ? '' : 's'} <small>({subjName.get(r.subjectId)}, {r.pages} pages)</small></li>
            })}
          </ul>
          {blueprint.rollingCoverage.length > 0 && <p className="note">{blueprint.rollingCoverage.length} completed outcome{blueprint.rollingCoverage.length === 1 ? ' does' : 's do'} not fit in this paper and carry into a later one. Appearing once does not mean everything you studied is verified.</p>}
          {preview.limitation && <p role="alert" className="notice notice--warn">{preview.limitation}</p>}
        </>
      )}

      {scope.unresolved.length > 0 && (
        <div className="scope-panel__unresolved">
          <h3>Confirm what these covered</h3>
          <p className="muted">These blocks name a reading but not which outcomes. Roadmap will not guess — tick what you actually covered and they join the paper.</p>
          {scope.unresolved.map(u => (
            <div key={u.blockId} className="scope-panel__block">
              <strong>{u.title}</strong> <small>{u.reason === 'partial' ? 'partly done' : 'reading-level'}</small>
              <ScopeConfirmForm blockId={u.blockId} outcomes={readingName.get(u.readingId)?.outcomes ?? []} />
            </div>
          ))}
        </div>
      )}

      {scope.excluded.length > 0 && (
        <div className="scope-panel__excluded">
          <h3>Not in this paper</h3>
          <ul>{scope.excluded.map(e => <li key={e.blockId}>{e.title} — {EXCLUDED_LABEL[e.reason]}</li>)}</ul>
          <p className="muted">These are not wrong answers and not counted against you.</p>
        </div>
      )}

      <QuickStudyForm catalog={catalog} />
    </section>
  )
}
