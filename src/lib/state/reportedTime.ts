/**
 * Reported time, kept apart from planned time and from remaining work. One reading of a task's history for every surface.
 *
 *  - A report is a partial or completed event. Its minutes are what the student said (new minutes since their last update), so repeated
 *    updates add up. A report with no minutes is time the student did not give: it stays UNKNOWN, never 0.
 *  - Undo reverses the report it undid (by event id when known, otherwise by the event type it names). Undoing an undo restores it.
 *  - Daily activity is dated by when the report was made (the student's local day of the event), not by the task's planned day, so late
 *    reporting against an earlier task counts on the day it was reported while the task's own history stays with its own week.
 */
export type TimeEvent = { id?: string; task_id: string; event_type: string; actual_duration_minutes?: number | null; created_at?: string; payload?: any }
export type Report = { eventId: string | null; at: string; minutes: number | null }
export type TaskTime = { minutes: number | null; unknown: boolean; reports: Report[] }

const REPORTING = ['partial', 'completed']

export function taskTimes(events: TimeEvent[]): Map<string, TaskTime> {
  const byTask = new Map<string, TimeEvent[]>()
  for (const e of events) byTask.set(e.task_id, [...(byTask.get(e.task_id) ?? []), e])
  const out = new Map<string, TaskTime>()
  for (const [task, list] of byTask) {
    const ordered = [...list].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id ?? '').localeCompare(String(b.id ?? '')))
    let active: (Report & { type: string })[] = []
    const undone: (Report & { type: string })[] = []
    for (const e of ordered) {
      if (REPORTING.includes(e.event_type)) {
        active.push({ eventId: e.id ?? null, at: e.created_at ?? '', minutes: e.actual_duration_minutes ?? null, type: e.event_type })
      } else if (e.event_type === 'undone') {
        const id = e.payload?.undid_event_id as string | undefined, named = e.payload?.undid as string | undefined
        if (named === 'undone') { const back = undone.pop(); if (back) active.push(back) } // undoing an undo restores what it had reversed
        else {
          const i = id ? active.findIndex(r => r.eventId === id) : named && REPORTING.includes(named) ? active.map(r => r.type).lastIndexOf(named) : -1
          if (i >= 0) undone.push(...active.splice(i, 1))
        }
      }
    }
    active = active.sort((a, b) => a.at.localeCompare(b.at))
    const known = active.filter(r => r.minutes !== null)
    out.set(task, { minutes: known.length ? known.reduce((n, r) => n + r.minutes!, 0) : null, unknown: active.some(r => r.minutes === null), reports: active })
  }
  return out
}

/** Minutes reported on one local day (any task), and how many reports that day gave no minutes. */
export function reportedOnDay(times: Map<string, TaskTime>, day: string, localDayOf: (iso: string) => string): { minutes: number; unknownReports: number } {
  let minutes = 0, unknownReports = 0
  for (const t of times.values()) for (const r of t.reports) {
    if (!r.at || localDayOf(r.at) !== day) continue
    if (r.minutes === null) unknownReports++; else minutes += r.minutes
  }
  return { minutes, unknownReports }
}
