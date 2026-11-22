import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { calendarTaskHref } from '../../lib/routing/calendar'
import type { ContinuationInfo, OccurrenceRef } from '../../lib/planning/taskLineageService'

const STATUS: Record<string, string> = {
  not_started: 'not started', in_progress: 'in progress', partial: 'partly done', completed: 'done',
  skipped: 'skipped', deferred: 'kept for later', cancelled: 'removed',
}

function weekLabel(r: OccurrenceRef) {
  if (!r.weekStart) return 'an earlier week'
  const f = (d: string) => formatStudyDate(d, 'dayMonth')
  return `the week of ${f(r.weekStart)}`
}

/**
 * Where a task came from and where it went. Earlier progress is shown SEPARATELY from this week's: it stays with
 * the week it happened in and is never added to a new occurrence, so nothing is counted twice.
 */
export function ContinuationNotice({ info }: { info: ContinuationInfo }) {
  const from = info.continuedFrom, as = info.continuedAs
  if (!from && !as) return null
  return (
    <section className="task-drawer__block" aria-label="Continuation">
      {from && (
        <>
          <h3>Continued from {weekLabel(from)}</h3>
          <p>
            <Link className="prose-link" href={calendarTaskHref(from.id, from.weekStart ?? undefined)}>{from.title}</Link>{' '}
            <small>({STATUS[from.execution] ?? from.execution})</small>
          </p>
          {info.earlier && (
            <p className="fine-print">
              Earlier progress: {info.earlier.minutes > 0 ? `${info.earlier.minutes} min reported` : 'no time reported'}
              {info.earlier.unknown ? ', and time for some earlier work was not reported' : ''}. It stays with that week; this starts fresh.
            </p>
          )}
          {info.estimateProvisional && <p className="fine-print">The time shown here is a first guess. Adjust it once you start.</p>}
          {info.carryIntent === 'later' && <p className="fine-print">Kept for later: it is not scheduled until you place it.</p>}
        </>
      )}
      {as && (
        <>
          <h3>Continued as</h3>
          <p>
            <Link className="prose-link" href={calendarTaskHref(as.id, as.weekStart ?? undefined)}>{as.title}</Link>{' '}
            <small>({weekLabel(as)}, {STATUS[as.execution] ?? as.execution})</small>
          </p>
          <p className="fine-print">This is the earlier record. Continue the work in the later week; this one can no longer be changed.</p>
        </>
      )}
    </section>
  )
}
