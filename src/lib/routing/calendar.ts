import { ROUTES } from './registry'

export function classLogHref(selection: { sessionId?: string; occurrenceKey?: string; fromReview?: boolean } = {}): string {
  const params = new URLSearchParams()
  if (selection.sessionId) params.set('session', selection.sessionId)
  else if (selection.occurrenceKey) params.set('occurrence', selection.occurrenceKey)
  if (selection.fromReview) params.set('from', 'review')
  const query = params.toString()
  return `${ROUTES.app.calendar}/log-class${query ? `?${query}` : ''}`
}

/** Selection changes presentation only: opening a task never starts or completes it. */
export function calendarSelectionHref(query: string, taskId: string | null): string {
  const params = new URLSearchParams(query)
  if (taskId) params.set('task', taskId)
  else params.delete('task')
  if (taskId) params.delete('entry')
  const suffix = params.toString()
  return `${ROUTES.app.calendar}${suffix ? `?${suffix}` : ''}`
}

/** Carry the task's day so a Home link still locates its week after midnight. */
export function calendarTaskHref(taskId: string, dateLocal?: string): string {
  const params = new URLSearchParams({ view: 'agenda' })
  if (dateLocal) params.set('week', dateLocal)
  return calendarSelectionHref(params.toString(), taskId)
}

/** An exact protected occurrence in the student's authorised Calendar projection. */
export function calendarOccupantHref(id: string, kind: string, date: string): string {
  if (kind === 'task') return calendarTaskHref(id, date)
  const query = new URLSearchParams({ week: date, view: 'agenda' })
  if (kind === 'mock' && id.startsWith('mock:')) query.set('appointment', id.slice(5))
  else query.set('entry', id)
  return `${ROUTES.app.calendar}?${query}`
}

/** Resolve only against the already-authorised projection, never a global task lookup. */
export function findCalendarTask<T extends { id: string; isTask: boolean }>(entries: Iterable<T>, taskId: string | null): T | null {
  if (!taskId) return null
  for (const entry of entries) if (entry.isTask && entry.id === taskId) return entry
  return null
}

/** A class occurrence is identified by its commitment and its ORIGINAL occurrence date (stable even after it moves). `week` only helps the page open the right period. */
export function calendarClassHref(commitmentId: string, occurrence: string, week?: string): string {
  const params = new URLSearchParams({ commitment: commitmentId, occurrence })
  if (week) params.set('week', week)
  return `${ROUTES.app.calendar}?${params.toString()}`
}

/** Select a class occurrence while keeping the rest of the page state (week, view). Selection is presentation only. */
export function calendarClassSelectionHref(query: string, commitmentId: string | null, occurrence?: string): string {
  const params = new URLSearchParams(query)
  params.delete('task')
  if (commitmentId && occurrence) { params.set('commitment', commitmentId); params.set('occurrence', occurrence) }
  else { params.delete('commitment'); params.delete('occurrence') }
  const suffix = params.toString()
  return `${ROUTES.app.calendar}${suffix ? `?${suffix}` : ''}`
}

/** The reviewed adjustment of existing study work after a saved class change. Bound server-side to the student's own receipt (`change` = its operation key). */
export function calendarReviewHref(changeKey: string, week?: string): string {
  const params = new URLSearchParams({ plan: 'review', change: changeKey })
  if (week) params.set('week', week)
  return `${ROUTES.app.calendar}?${params.toString()}`
}
