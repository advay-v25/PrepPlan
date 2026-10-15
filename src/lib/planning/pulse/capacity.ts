import { createAdminClient } from '../../supabase/admin'
import { zonedTimeToUtc, type Weekday } from '../studyWeek'

export function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

type Range = { start: string; end: string }

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
export async function dailyCapacityMinutes(userId: string, weekday: Weekday, date: string, timezone = 'UTC'): Promise<number> {
  const admin = createAdminClient()
  // The local calendar day's real UTC span, not the UTC calendar day's — a timezone offset can otherwise
  // put a genuinely same-day one-off class just outside a naive UTC-midnight window.
  const dayStart = zonedTimeToUtc(date, '00:00', timezone).toISOString()
  const dayEnd = zonedTimeToUtc(date, '23:59', timezone).toISOString()
  const [{ data: windows }, { data: weekly }, { data: oneOff }] = await Promise.all([
    admin.from('availability_windows').select('start_time, end_time')
      .eq('user_id', userId).eq('weekday', weekday).eq('status', 'active'),
    admin.from('calendar_commitments').select('weekdays, start_time, end_time')
      .eq('user_id', userId).eq('status', 'active').eq('is_protected', true).eq('recurrence', 'weekly')
      .contains('weekdays', [weekday]),
    // A one-off class (a variable schedule's "next known class") has no weekday/start_time — it carries an
    // absolute starts_at/ends_at instead — so the weekly-recurring query above never matches it. Without
    // this it would show on Calendar but never actually block a study window on its own date.
    admin.from('calendar_commitments').select('starts_at, ends_at')
      .eq('user_id', userId).eq('status', 'active').eq('is_protected', true).eq('recurrence', 'none')
      .lt('starts_at', dayEnd).gt('ends_at', dayStart),
  ])

  // Weekly windows and weekly commitments are stored as bare local wall-clock HH:MM with no timezone. A
  // one-off commitment carries a real UTC instant, so it has to be read back in the user's own timezone to
  // land in the same frame — otherwise a class at "6pm Europe/London" would subtract the wrong hour in summer.
  const toLocalRange = (iso: string) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00'
    return `${get('hour')}:${get('minute')}`
  }
  const blocks: Range[] = [
    ...(weekly ?? [])
      .filter(c => c.start_time && c.end_time)
      .map(c => ({ start: String(c.start_time).slice(0, 5), end: String(c.end_time).slice(0, 5) })),
    ...(oneOff ?? []).map(c => ({
      start: c.starts_at < dayStart ? '00:00' : toLocalRange(c.starts_at as string),
      end: c.ends_at > dayEnd ? '23:59' : toLocalRange(c.ends_at as string),
    })),
  ]

  let total = 0
  for (const w of windows ?? []) {
    if (!w.start_time || !w.end_time) continue
    const window: Range = { start: String(w.start_time).slice(0, 5), end: String(w.end_time).slice(0, 5) }
    const free = subtractOverlaps(window, blocks)
    total += free.reduce((sum, r) => sum + minutesBetween(r.start, r.end), 0)
  }
  return total
}
