import { createAdminClient } from '../supabase/admin'
import { loadCalendarWeek, type CalendarEntry } from '../planning/calendarData'
import { listAppointments } from '../planning/checkpointService'
import { addDays, daysBetween, resolveStudyWeek, shiftStudyWeek, todayInZone, zonedTimeToUtc, parseLocalDate } from '../planning/studyWeek'
import { calendarTaskHref } from '../routing/calendar'
import { ROUTES } from '../routing/registry'
import type { IcsEvent } from './ics'

export const MAX_EXPORT_DAYS = 120
export type ExportOptions = { from: string; to: string; classes: boolean; history: boolean }
export type ExportPreview = { from: string; to: string; events: number; timed: number; allDay: number; excludedUnplaced: number; excludedHistory: number; excludedClasses: number }
export class ExportInputError extends Error {}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const clip = (s: string | null | undefined, n: number) => (s ? s.replace(/\s+/g, ' ').trim().slice(0, n) : null)

/** Validates the range and options. Account identity never comes from the client. */
export function parseExportOptions(q: URLSearchParams, today: string): ExportOptions {
  const from = q.get('from') ? parseLocalDate(q.get('from')) : today
  const to = q.get('to') ? parseLocalDate(q.get('to')) : addDays(today, 34)   // this week plus the next four
  if (!from || !to) throw new ExportInputError('Choose real dates (YYYY-MM-DD).')
  if (to < from) throw new ExportInputError('The end date is before the start date.')
  if (daysBetween(from, to) + 1 > MAX_EXPORT_DAYS) throw new ExportInputError(`Choose at most ${MAX_EXPORT_DAYS} days.`)
  return { from, to, classes: q.get('classes') === '1', history: q.get('history') === '1' }
}

/** Reads through the same occurrence reader Calendar uses (loadCalendarWeek), then keeps only what a snapshot may carry. */
export async function buildCalendarExport(userId: string, o: ExportOptions, baseUrl: string): Promise<{ events: IcsEvent[]; preview: ExportPreview; timezone: string }> {
  const { data: prof } = await createAdminClient().from('profiles').select('timezone').eq('id', userId).maybeSingle().throwOnError()
  const tz = (prof?.timezone as string) || 'UTC'
  const first = resolveStudyWeek({ timezone: tz, reference: o.from })
  const base = { ...first, startDate: o.from, endDate: addDays(o.from, 6), days: Array.from({ length: 7 }, (_, i) => addDays(o.from, i)) }
  const windows = Math.ceil((daysBetween(o.from, o.to) + 1) / 7)
  const byId = new Map<string, CalendarEntry>()
  for (let i = 0; i < windows; i++) {
    const data = await loadCalendarWeek(userId, shiftStudyWeek(base, i), { strict: true })   // any failed read throws: no half-empty file is ever presented as complete
    // Identity is the stable export key (a moved class occurrence keeps its ORIGINAL slot; two occurrences moved onto one date stay distinct), never the title.
    for (const e of data.entries) { const k = e.exportKey ?? e.id; if (!byId.has(k)) byId.set(k, e) }
  }
  const events: IcsEvent[] = []
  const p: ExportPreview = { from: o.from, to: o.to, events: 0, timed: 0, allDay: 0, excludedUnplaced: 0, excludedHistory: 0, excludedClasses: 0 }
  // Booked mock appointments are read from their own canonical schedule (Calendar loads them separately from tasks), so one with no task still exports.
  // A mock TASK is a different record: nothing in the schema links a task to an appointment, so sharing a date proves nothing and both are exported
  // (never merged by date or title). If a task-to-appointment relationship is ever stored, deduplicate through that id here.
  const appts = (await listAppointments(userId, 0)).filter(a => a.status === 'planned' && a.date >= o.from && a.date <= o.to)
  for (const a of appts) {
    const common = { id: `appointment:${a.id}`, title: a.title, description: null, url: baseUrl + a.href, category: 'mock' }
    if (a.startTime && a.durationMinutes) { const start = zonedTimeToUtc(a.date, a.startTime.slice(0, 5), tz); events.push({ ...common, kind: 'timed', start, end: new Date(start.getTime() + a.durationMinutes * 60_000) }); p.timed++ }
    else { events.push({ ...common, kind: 'allday', date: a.date }); p.allDay++ }
  }
  for (const e of [...byId.values()].sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? '') || (a.startMinutes ?? 0) - (b.startMinutes ?? 0))) {
    const ex = e.execution
    if (e.isTask && (ex === 'skipped' || ex === 'cancelled')) continue
    if (e.isTask && ex === 'deferred') { p.excludedUnplaced++; continue }
    if (e.kind === 'floating' || !e.localDate) { p.excludedUnplaced++; continue }
    if (e.localDate < o.from || e.localDate > o.to) continue
    if (!e.isTask && !o.classes) { p.excludedClasses++; continue }
    if (e.isTask && (ex === 'completed' || e.isLoggedLearning) && !o.history) { p.excludedHistory++; continue }
    // Titles and short objectives only. A repair or re-check title names a weak concept, so it is exported generically.
    const title = e.layer === 'repair' ? 'Roadmap repair session' : e.layer === 'recheck' ? 'Roadmap re-check' : e.title
    const url = baseUrl + (e.isTask ? calendarTaskHref(e.id, e.localDate) : ROUTES.app.calendar)
    const common = { id: e.exportKey ?? e.id, title: e.isTask && (ex === 'completed' || e.isLoggedLearning) ? `${title} (done)` : title, description: e.isTask && e.layer !== 'repair' && e.layer !== 'recheck' ? clip(e.learningObjective, 200) : null, url, category: e.layer }
    if (e.kind === 'timed' && e.startMinutes !== null && e.durationMinutes > 0) {
      // Exact stored instants win (they keep an overnight end and either repeated DST-hour start); only a recurring series, which is a local rule, is converted from local minutes.
      const start = e.startsAtIso ? new Date(e.startsAtIso) : zonedTimeToUtc(e.localDate, hhmm(e.startMinutes), tz)
      const end = e.endsAtIso ? new Date(e.endsAtIso) : new Date(start.getTime() + e.durationMinutes * 60_000)
      events.push({ ...common, kind: 'timed', start, end }); p.timed++
    } else { events.push({ ...common, kind: 'allday', date: e.localDate }); p.allDay++ }
  }
  p.events = events.length
  return { events, preview: p, timezone: tz }
}

export { todayInZone }
