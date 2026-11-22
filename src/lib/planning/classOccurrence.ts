import { createAdminClient } from '../supabase/admin'
import { parseLocalDate, todayInZone } from './studyWeek'
import { getStudyWeekContext } from './schedule'

export type OccurrenceSelection = {
  commitmentId: string; label: string; kind: string
  weekdays: number[]; startTime: string; endTime: string; startsOn: string | null; endsOn: string | null
  /** The ORIGINAL occurrence date this selection names. */
  occurrence: string
  state: 'regular' | 'moved' | 'skipped'
  /** Where the class actually is now (null when cancelled). */
  current: { date: string; start: string; end: string } | null
  note: string | null
  /** The database's own rule (shared with the command): where the class actually is, and what is recorded. */
  canChange: boolean
  canRestore: boolean
  today: string
  /** The series + exceptions state this was read from; sent back with every preview/confirm. */
  token: string
}

const isDate = (v: unknown): v is string => Boolean(parseLocalDate(v))
const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const hm = (t: unknown) => String(t ?? '').slice(0, 5)

/** The occurrence a Calendar link names, or null when it is malformed, not yours, archived, not recurring, or not one of the series' sessions. Never falls back to another class. */
export async function getOccurrenceSelection(userId: string, commitmentId: unknown, occurrence: unknown): Promise<OccurrenceSelection | null> {
  if (!isUuid(commitmentId) || !isDate(occurrence)) return null
  const admin = createAdminClient()
  const { data: c } = await admin.from('calendar_commitments').select('id, label, kind, recurrence, weekdays, start_time, end_time, starts_on, ends_on, status')
    .eq('id', commitmentId).eq('user_id', userId).maybeSingle().throwOnError()
  if (!c || c.status !== 'active' || c.recurrence !== 'weekly' || !c.start_time || !c.end_time) return null
  const dow = new Date(`${occurrence}T12:00:00Z`).getUTCDay()
  if (!((c.weekdays as number[]) ?? []).includes(dow) || (c.starts_on && occurrence < c.starts_on) || (c.ends_on && occurrence > c.ends_on)) return null
  const [{ data: e }, { data: token }, { data: standing }, ctx] = await Promise.all([
    admin.from('commitment_exceptions').select('kind, new_date, new_start_time, new_end_time, note').eq('commitment_id', commitmentId).eq('occurrence_date', occurrence).maybeSingle().throwOnError(),
    admin.rpc('class_change_token', { p_user: userId, p_commitment: commitmentId }),
    admin.rpc('class_occurrence_state', { p_user: userId, p_commitment: commitmentId, p_occ: occurrence }),
    getStudyWeekContext(userId),
  ])
  const today = todayInZone(ctx.timezone)
  const start = hm(c.start_time), end = hm(c.end_time)
  const state = e?.kind === 'skipped' ? 'skipped' : e?.kind === 'moved' ? 'moved' : 'regular'
  return {
    commitmentId, label: c.label as string, kind: c.kind as string, weekdays: (c.weekdays as number[]) ?? [], startTime: start, endTime: end,
    startsOn: (c.starts_on as string | null) ?? null, endsOn: (c.ends_on as string | null) ?? null, occurrence, state,
    current: state === 'skipped' ? null : state === 'moved' ? { date: (e!.new_date as string | null) ?? occurrence, start: hm(e!.new_start_time) || start, end: hm(e!.new_end_time) || end } : { date: occurrence, start, end },
    note: (e?.note as string | null) ?? null, canChange: standing?.canChange === true, canRestore: standing?.canRestore === true, today, token: String(token ?? ''),
  }
}

/** Classes cancelled for dates in this week: they leave the grid, so this is how a student finds them to restore. */
export async function listCancelledClasses(userId: string, days: string[]) {
  if (days.length === 0) return []
  const admin = createAdminClient()
  const { data } = await admin.from('commitment_exceptions').select('commitment_id, occurrence_date, calendar_commitments!inner(label, kind, status, user_id)')
    .eq('user_id', userId).eq('kind', 'skipped').gte('occurrence_date', days[0]).lte('occurrence_date', days[days.length - 1]).order('occurrence_date').throwOnError()
  return ((data ?? []) as any[]).filter(r => r.calendar_commitments?.status === 'active').map(r => ({ commitmentId: r.commitment_id as string, occurrence: r.occurrence_date as string, label: r.calendar_commitments.label as string }))
}
