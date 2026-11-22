import Link from 'next/link'
import type { PaperPreview } from '../../lib/tests/paperPreview'
import { ScopeConfirmForm } from './ScopeForms'
import { classLogHref } from '../../lib/routing/calendar'

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
  const classSources = new Map(scope.targets.flatMap(target => target.sources.filter(source => source.type === 'class').map(source => [source.id, source] as const)))

  return (
    <section className="scope-panel" aria-labelledby="scope-h">
      <h2 id="scope-h">What this week&apos;s paper tests</h2>
      <p className="muted">Only completed work and outcomes you <strong>explicitly confirm</strong> are tested. Calendar plans it; your recorded progress decides it.</p>

      {!preview.noPaperReason && (
        <>
          <p><strong>{PAPER_LABEL[paperKind]}</strong> — {blueprint.totalQuestions} questions, about {blueprint.estimatedMinutes} minutes
            {' '}(never more than {blueprint.policy.ceiling}). {scope.totals.newOutcomes} new and {scope.totals.revisionOutcomes} revisited outcomes from {scope.totals.readings} reading{scope.totals.readings === 1 ? '' : 's'}
            {' '}in {scope.totals.subjects} subject{scope.totals.subjects === 1 ? '' : 's'}.</p>
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

      {classSources.size > 0 && <details>
        <summary>Class reports in this scope</summary>
        <ul>{[...classSources.values()].map(source => <li key={source.id}>
          <Link href={classLogHref({ sessionId: source.id })}>{source.label ?? 'Saved class'}{source.at ? ` on ${source.at}` : ''}</Link>
        </li>)}</ul>
      </details>}

      {scope.unresolved.length > 0 && (
        <div className="scope-panel__unresolved">
          <h3>Confirm what these covered</h3>
          <p className="muted">Confirm the outcomes you actually covered. A finished sitting does not complete the shared learning scope while another sitting remains.</p>
          {scope.unresolved.map(u => (
            <div key={u.blockId} className="scope-panel__block">
              <strong>{u.title}</strong> <small>{u.reason === 'split' ? 'another sitting remains' : u.reason === 'partial' ? 'partly done' : u.reason === 'class_part' ? 'part of this was covered in class' : 'reading-level'}</small>
              <ScopeConfirmForm blockId={u.blockId} expectedRevision={u.revision} outcomes={(readingName.get(u.readingId)?.outcomes ?? []).filter(o => !u.outcomeId || o.id === u.outcomeId)} />
            </div>
          ))}
        </div>
      )}

      {scope.pendingPortions.length > 0 && (
        <div className="scope-panel__pending" data-testid="pending-portions">
          <h3>Part of a class, not yet testable</h3>
          <ul>{scope.pendingPortions.map(p => {
            const rd = readingName.get(p.readingId), o = rd?.outcomes.find(x => x.id === p.outcomeId)
            return <li key={`${p.sessionId}-${p.outcomeId}`}>{rd ? `Reading ${rd.no}` : 'A reading'}{o ? `, ${o.code}. ${o.title}` : ''} · {p.extent === 'continued' ? 'Continued' : 'Partly covered'} in <Link href={classLogHref({ sessionId: p.sessionId })}>{p.classLabel ?? 'saved class'} on {p.classDate}</Link></li>
          })}</ul>
          <p className="muted">Roadmap cannot tell which questions test only that part, so it asks nothing about it yet. Continuing it is progress, not completion. Log it as “All of it” in a later class, or finish its continuation task and confirm that you covered the whole outcome, and it joins the paper.</p>
        </div>
      )}

      {scope.excluded.length > 0 && (
        <div className="scope-panel__excluded">
          <h3>Not in this paper</h3>
          <ul>{scope.excluded.map(e => <li key={e.blockId}>{e.title} — {EXCLUDED_LABEL[e.reason]}</li>)}</ul>
          <p className="muted">These are not wrong answers and not counted against you.</p>
        </div>
      )}

    </section>
  )
}
