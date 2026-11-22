import { perRequest } from '../../ops/perRequest'
import { createAdminClient } from '../../supabase/admin'
import { zonedTimeToUtc, utcToZonedParts, addDays, type Weekday } from '../studyWeek'
import { expandCommitment } from '../mutations'

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

type Range = { start: string; end: string }

/** New plans may use only the part of a local study window that has not passed. */
export function remainingWindow(window: Range, date: string, timezone: string, now: Date): Range | null {
  const local = utcToZonedParts(now, timezone)
  if (date < local.date) return null
  if (date > local.date) return window
  const [hour, minute] = local.time.split(':').map(Number)
  const elapsed = hour * 60 + minute + (now.getUTCSeconds() || now.getUTCMilliseconds() ? 1 : 0)
  if (elapsed >= 1440) return null
  const floor = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  const start = window.start > floor ? window.start : floor
  return start < window.end ? { start, end: window.end } : null
}

/** Removes every overlapping portion of `blocks` from `window`, in clock-time order. */
export function subtractOverlaps(window: Range, blocks: Range[]): Range[] {
  let pieces: Range[] = [window]
  for (const block of blocks) {
    const next: Range[] = []
    for (const piece of pieces) {
      if (block.end <= piece.start || block.start >= piece.end) {
        next.push(piece)
        continue
      }
      if (block.start > piece.start) next.push({ start: piece.start, end: block.start })
      if (block.end < piece.end) next.push({ start: block.end, end: piece.end })
    }
    pieces = next
  }
  return pieces
}

/**
 * Real available minutes for one specific date — availability_windows for
 * that weekday, minus protected calendar_commitments overlapping that date.
 * This is the fix for weeklyCapacityMinutes()'s old bug: exact ranges, not
 * a per-slot max_session_minutes guess.
 */
/**
 * Everything a day's capacity is computed from, read once per server request instead of once per day (a week asks fourteen times).
 * Per user, per request only (see perRequest): outside a render each call reads fresh, so a write is never hidden by an earlier snapshot.
 */
const capacityInputs = perRequest(async (userId: string) => {
  const admin = createAdminClient()
  const [w, c, e, m] = await Promise.all([
    admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', userId).eq('status', 'active').throwOnError(),
    admin.from('calendar_commitments').select('*').eq('user_id', userId).eq('status', 'active').eq('is_protected', true).throwOnError(),
    admin.from('commitment_exceptions').select('*').eq('user_id', userId).throwOnError(),
    admin.from('mock_appointments').select('planned_date, start_time, duration_minutes').eq('user_id', userId).eq('status', 'planned').throwOnError(),
  ])
  return { windows: (w.data ?? []) as { weekday: number; start_time: string; end_time: string }[], commitments: (c.data ?? []) as any[], exceptions: (e.data ?? []) as any[], mocks: (m.data ?? []) as { planned_date: string; start_time: string | null; duration_minutes: number | null }[] }
}, (u: string) => u)

export async function dailyCapacityMinutes(userId: string, weekday: Weekday, date: string, timezone = 'UTC', notBefore?: Date): Promise<number> {
  return (await dailyFreeRanges(userId, weekday, date, timezone, notBefore)).reduce((sum, r) => sum + minutesBetween(r.start, r.end), 0)
}

/**
 * The contiguous free study ranges of one local date, in clock order: availability windows (overlaps counted once) minus classes, commitments and
 * timed mock bookings, and, for `notBefore`'s own date, minus time that has already passed. `dailyCapacityMinutes` is exactly their total.
 * A sitting that must be contiguous fits only inside ONE of these ranges: a sum of fragments is not a gap.
 */
export async function dailyFreeRanges(userId: string, weekday: Weekday, date: string, timezone = 'UTC', notBefore?: Date): Promise<Range[]> {
  if (notBefore && date < utcToZonedParts(notBefore, timezone).date) return []
  // The local calendar day's real UTC span, not the UTC calendar day's — a timezone offset can otherwise
  // put a genuinely same-day one-off class just outside a naive UTC-midnight window.
  const dayStart = zonedTimeToUtc(date, '00:00', timezone).toISOString()
  const dayEnd = zonedTimeToUtc(addDays(date, 1), '00:00', timezone).toISOString()
  const inputs = await capacityInputs(userId)
  const windows = inputs.windows.filter(w => w.weekday === weekday)
  const { commitments, exceptions } = inputs
  const mockRows = inputs.mocks.filter(m => m.planned_date === date)
  const occurrenceExceptions = (exceptions ?? []).map(e => ({
    commitmentId: e.commitment_id, occurrenceDate: e.occurrence_date, kind: e.kind as 'skipped' | 'moved',
    newDate: e.new_date, newStartTime: e.new_start_time, newEndTime: e.new_end_time,
  }))
  const weekly = (commitments ?? []).filter(c => c.recurrence === 'weekly').flatMap(c =>
    expandCommitment({
      id: c.id, label: c.label, kind: c.kind, isProtected: true, recurrence: 'weekly', weekdays: c.weekdays ?? [],
      startTime: c.start_time, endTime: c.end_time, startsOn: c.starts_on, endsOn: c.ends_on,
    }, [date], occurrenceExceptions))
  const oneOff = (commitments ?? []).filter(c => c.recurrence === 'none' && c.starts_at < dayEnd && c.ends_at > dayStart)
  // Weekly windows and weekly commitments are stored as bare local wall-clock HH:MM with no timezone. A
  // one-off commitment carries a real UTC instant, so it has to be read back in the user's own timezone to
  // land in the same frame — otherwise a class at "6pm Europe/London" would subtract the wrong hour in summer.
  const toLocalRange = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
    return `${get('hour')}:${get('minute')}`
  }
  const blocks: Range[] = [
    ...weekly.map(c => ({
      start: `${String(Math.floor(c.start / 60)).padStart(2, '0')}:${String(c.start % 60).padStart(2, '0')}`,
      end: `${String(Math.floor((c.start + c.durationMinutes) / 60)).padStart(2, '0')}:${String((c.start + c.durationMinutes) % 60).padStart(2, '0')}`,
    })),
    ...(oneOff ?? []).map(c => ({
      start: c.starts_at < dayStart ? '00:00' : toLocalRange(c.starts_at as string),
      end: c.ends_at > dayEnd ? '23:59' : toLocalRange(c.ends_at as string),
    })),
  ]

  // Every planned appointment of the day with a start time AND a length reserves exactly that interval; a date-only one reserves nothing.
  for (const m of mockRows ?? []) {
    if (!m.start_time || !m.duration_minutes) continue
    const start = String(m.start_time).slice(0, 5)
    const endMin = Math.min(1440, minutesBetween('00:00', start) + (m.duration_minutes as number))
    blocks.push({ start, end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}` })
  }

  const ranges: Range[] = []
  const counted: Range[] = []
  for (const w of windows ?? []) {
    if (!w.start_time || !w.end_time) continue
    const original: Range = { start: String(w.start_time).slice(0, 5), end: String(w.end_time).slice(0, 5) }
    const window = notBefore ? remainingWindow(original, date, timezone, notBefore) : original
    if (!window) continue
    const free = subtractOverlaps(window, [...blocks, ...counted])
    ranges.push(...free)
    counted.push(window)
  }
  const sorted = ranges.filter(r => minutesBetween(r.start, r.end) > 0).sort((x, y) => x.start.localeCompare(y.start))
  const merged: Range[] = []   // touching windows (09:00-11:00 and 11:00-13:00) are one contiguous gap
  for (const r of sorted) { const last = merged[merged.length - 1]; if (last && last.end >= r.start) last.end = last.end > r.end ? last.end : r.end; else merged.push({ ...r }) }
  return merged
}
