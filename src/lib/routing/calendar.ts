import { ROUTES } from './registry'

/** Selection changes presentation only: opening a task never starts or completes it. */
export function calendarSelectionHref(query: string, taskId: string | null): string {
  const params = new URLSearchParams(query)
  if (taskId) params.set('task', taskId)
  else params.delete('task')
  const suffix = params.toString()
  return `${ROUTES.app.calendar}${suffix ? `?${suffix}` : ''}`
}

/** Carry the task's day so a Home link still locates its week after midnight. */
export function calendarTaskHref(taskId: string, dateLocal?: string): string {
  const params = new URLSearchParams({ view: 'agenda' })
  if (dateLocal) params.set('week', dateLocal)
  return calendarSelectionHref(params.toString(), taskId)
}

/** Resolve only against the already-authorised projection, never a global task lookup. */
export function findCalendarTask<T extends { id: string; isTask: boolean }>(entries: Iterable<T>, taskId: string | null): T | null {
  if (!taskId) return null
  for (const entry of entries) if (entry.isTask && entry.id === taskId) return entry
  return null
}
