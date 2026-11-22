import { addDays, weekdayOf } from '../planning/studyWeek'
import { findConflicts, type Occupant } from '../planning/mutations'

/**
 * Turning a student's day words into ONE concrete date, and a day into a free slot. Pure: the study-week "today" is passed in, so the
 * answer never depends on the server's clock zone. Anything ambiguous returns `ask`; the Coach then asks one short question.
 */
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export const dayLabel = (date: string) => { const [, m, d] = date.split('-').map(Number); return `${NAMES[weekdayOf(date)]} ${d} ${MONTHS[m - 1]}` }

export type DayResolution = { ok: true; date: string; minutes: number | null } | { ok: false; reason: 'none' | 'ambiguous' | 'past' | 'outside_cycle' | 'same_day' | 'bad_date'; ask: string }

const MON_RE = MONTHS.map(m => m.toLowerCase()).join('|')
/** "2026-11-14", "14 nov", "nov 14th" → ISO date in the year of `today` (a date already past this year is never silently moved to next year). */
export function parseDateWords(w: string, today: string): string | null {
  let y = Number(today.slice(0, 4)), m: number, d: number
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w)
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3] }
  else {
    const dm = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (${MON_RE})[a-z]*$`).exec(w), md = new RegExp(`^(${MON_RE})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?$`).exec(w)
    if (dm) { d = +dm[1]; m = MONTHS.findIndex(x => x.toLowerCase() === dm[2]) + 1 } else if (md) { d = +md[2]; m = MONTHS.findIndex(x => x.toLowerCase() === md[1]) + 1 } else return null
  }
  const out = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const back = new Date(Date.UTC(y, m - 1, d))   // reject 31 Feb: the round trip must give the same day
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? out : null
}

/** `when` is "<day words>", "<day words>@HH:MM" or "@HH:MM" (a time on the task's own day). */
export function resolveDay(when: string | null, today: string, from: string, cycle: { start: string; end: string } | null): DayResolution {
  const [dayPart, timePart] = (when ?? '').split('@')
  const minutes = timePart ? Number(timePart.slice(0, 2)) * 60 + Number(timePart.slice(3, 5)) : null
  const word = dayPart || null
  if (!word && minutes === null) return { ok: false, reason: 'none', ask: 'Which day should it go on? Say a weekday, a date like “14 Nov”, or “tomorrow”. You can add a time, like “Friday at 7pm”.' }
  let date: string
  if (!word) date = from
  else if (word === 'today') date = today
  else if (word === 'tomorrow') date = addDays(today, 1)
  else if (word === 'kal') return { ok: false, reason: 'ambiguous', ask: 'Do you mean tomorrow or yesterday? Say “tomorrow” or a weekday.' }
  else if (word === 'next week' || word.startsWith('next ')) return { ok: false, reason: 'ambiguous', ask: `Which day exactly? For example, “this ${NAMES[weekdayOf(addDays(today, 1))]}” or a date such as “${dayLabel(addDays(today, 6)).replace(/^\w+ /, '')}”.` }
  else {
    const exact = parseDateWords(word, today)
    if (exact) date = exact
    else if (/\d/.test(word)) return { ok: false, reason: 'bad_date', ask: 'I could not read that date. Try “14 Nov” or 2026-11-14.' }
    else {
      const i = DAYS.indexOf(word)
      if (i < 0) return { ok: false, reason: 'none', ask: 'Which day should it go on? Say a weekday, a date like “14 Nov”, or “tomorrow”.' }
      const delta = (i - weekdayOf(today) + 7) % 7
      if (delta === 0) return { ok: false, reason: 'ambiguous', ask: `Today is ${NAMES[i]}. Do you mean today, or ${NAMES[i]} next week?` }
      date = addDays(today, delta)
    }
  }
  if (date < today) return { ok: false, reason: 'past', ask: 'Unfinished work is placed today or later. If this already happened, record it with Log learning.' }
  if (date === from && minutes === null) return { ok: false, reason: 'same_day', ask: `It is already on ${dayLabel(date)}. Which other day, or what time? For example, “at 7pm”.` }
  if (cycle && (date < cycle.start || date > cycle.end)) return { ok: false, reason: 'outside_cycle', ask: `${dayLabel(date)} is outside this plan (${dayLabel(cycle.start)} to ${dayLabel(cycle.end)}). To carry work into another week, use the weekly review.` }
  return { ok: true, date, minutes }
}

const fmt = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
export const clock = fmt

export type Window = { start: number; end: number }
/**
 * The nearest free slot to the task's usual time (or 18:00), 15-minute steps, INSIDE the student's saved study windows for that weekday.
 * "Free" means free of EVERY occupant, so the student never has to acknowledge an overlap. No windows, or no gap that fits: null, and the
 * caller offers a day-only placement and says why. Unavailable time is never turned into capacity.
 */
export function pickSlot(occupants: Occupant[], date: string, minutes: number, preferred: number | null, ignoreId: string, windows: Window[]): number | null {
  const want = preferred ?? 18 * 60
  let best: number | null = null
  for (const w of windows) {
    for (let s = Math.ceil(w.start / 15) * 15; s + minutes <= w.end; s += 15) {
      if (findConflicts({ date, start: s, durationMinutes: minutes }, occupants, { ignoreIds: [ignoreId] }).length) continue
      if (best === null || Math.abs(s - want) < Math.abs(best - want)) best = s
    }
  }
  return best
}

/** Is [start, start+minutes) wholly inside one saved window? */
export const insideWindows = (windows: Window[], start: number, minutes: number) => windows.some(w => start >= w.start && start + minutes <= w.end)
