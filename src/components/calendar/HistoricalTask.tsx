import { formatStudyDate } from '../../lib/format/date'
import Link from 'next/link'
import { calendarSelectionHref, classLogHref } from '../../lib/routing/calendar'
import { ContinuationNotice } from './ContinuationNotice'
import type { getTaskLineage } from '../../lib/planning/taskLineageService'

type Lineage = NonNullable<Awaited<ReturnType<typeof getTaskLineage>>>
const STATUS: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', partial: 'Partly done', completed: 'Done',
  skipped: 'Skipped', deferred: 'Kept for later', cancelled: 'Removed',
}
const f = (d: string) => formatStudyDate(d, 'date')

/** A task from another week, opened from an old link. Read-only: history is not edited from here. */
export function HistoricalTask({ lineage }: { lineage: Lineage }) {
  const { task, week, info } = lineage
  return (
    <section className="notice notice--info historical-task" role="region" aria-label="Task from another week">
      <h2>{task.title as string}</h2>
      <p>
        {STATUS[task.execution as string] ?? task.execution}
        {week.start && week.end ? ` · week of ${f(week.start)} – ${f(week.end)}` : ''}
        {task.duration_minutes ? ` · planned ${task.duration_minutes} min` : ''}
      </p>
      {task.learning_objective ? <p>{task.learning_objective as string}</p> : null}
      <ContinuationNotice info={info} />
      {info.classSessionId && <p><Link href={classLogHref({ sessionId: info.classSessionId })}>Open source class log</Link></p>}
      <p><Link href={calendarSelectionHref('', null)} className="prose-link">Back to this week</Link></p>
    </section>
  )
}
