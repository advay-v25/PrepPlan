import { nextSitting } from './weeklyReview/composer'

/**
 * One-off study windows a student adds to ONE proposed week (pure). They never change recurring availability. Work placed in them is saved as a timed
 * task at that exact time, together with the review that accepted it; anything that does not fit stays waiting and says why.
 */
export const EXTRA = { maxWindows: 7, minMinutes: 15, maxMinutes: 360 } as const
/** Minutes from local midnight. */
export type ExtraWindow = { date: string; start: number; end: number }
export type FillItem = { /** Study or revision: may take several sittings, each within the limit; what does not fit is returned as waiting. */ splittable?: boolean; key: string; title: string; minutes: number; kind: 'continuing' | 'mock' | 'debrief' | 'follow_up' | 'single'; /** Earliest moment it may start (a debrief follows its mock). */ notBefore?: { date: string; start: number } }
export type Filled = { key: string; title: string; kind: FillItem['kind']; date: string; start: number; minutes: number }

const toMin = (t: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(t) || t === '24:00' ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN)
export const clockOf = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Validates the student's windows against the proposed week and the time already taken. Every refusal names the window. */
export function parseExtraWindows(raw: unknown, weekDates: string[], today: string, busy: Record<string, { start: number; end: number; title: string }[]> = {}): { windows: ExtraWindow[]; errors: string[] } {
  if (raw === undefined || raw === null) return { windows: [], errors: [] }
  if (!Array.isArray(raw) || raw.length > EXTRA.maxWindows) return { windows: [], errors: [`Add at most ${EXTRA.maxWindows} extra windows.`] }
  const windows: ExtraWindow[] = [], errors: string[] = []
  for (const x of raw as { date?: unknown; start?: unknown; end?: unknown }[]) {
    const date = typeof x?.date === 'string' ? x.date : '', start = toMin(String(x?.start ?? '')), end = toMin(String(x?.end ?? ''))
    const label = `${date || 'A window'} ${String(x?.start ?? '')}–${String(x?.end ?? '')}`
    if (!weekDates.includes(date) || date < today) { errors.push(`${label}: choose a day in the proposed week that has not passed.`); continue }
    if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < EXTRA.minMinutes || end - start > EXTRA.maxMinutes) { errors.push(`${label}: a window runs from ${EXTRA.minMinutes} minutes to ${EXTRA.maxMinutes / 60} hours.`); continue }
    if (windows.some(w => w.date === date && start < w.end && w.start < end)) { errors.push(`${label}: it overlaps another window you added.`); continue }
    const clash = (busy[date] ?? []).find(b => start < b.end && b.start < end)
    if (clash) { errors.push(`${label}: “${clash.title}” is already at that time.`); continue }
    windows.push({ date, start, end })
  }
  return { windows: windows.sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start), errors }
}

/**
 * Fills the windows with waiting work, in the order given, each item whole in one window. A study sitting stays within the sitting limit; a mock keeps
 * its own clock, and study or revision may continue across sittings. Returns what each window takes, what is left of each window, and what still waits with the reason.
 */
export function fillWindows(windows: ExtraWindow[], items: FillItem[], maxSitting: number | null) {
  const cursor = windows.map(w => w.start)
  const placed: Filled[] = [], waiting: (FillItem & { reason: string })[] = []
  for (const item of items) {
    if (item.splittable) {
      let need = item.minutes
      for (let k = 0; k < windows.length && need > 0;) {
        const take = nextSitting(need, windows[k].end - cursor[k], maxSitting ?? need)
        if (!take) { k++; continue }
        placed.push({ key: item.key, title: item.title, kind: item.kind, date: windows[k].date, start: cursor[k], minutes: take })
        cursor[k] += take; need -= take
      }
      if (need > 0) waiting.push({ ...item, minutes: need, reason: windows.length ? 'No added window has room for the rest.' : 'No extra window was added.' })
      continue
    }
    // A mock keeps its own clock; a check or repair the student made a window for stays whole, even past the study sitting limit.
    if (item.kind !== 'mock' && item.kind !== 'single' && maxSitting && item.minutes > maxSitting) { waiting.push({ ...item, reason: `It is longer than your ${maxSitting}-minute sitting.` }); continue }
    const from = (w: ExtraWindow, i: number) => item.notBefore && w.date === item.notBefore.date ? Math.max(cursor[i], item.notBefore.start) : cursor[i]
    const i = windows.findIndex((w, k) => (!item.notBefore || w.date >= item.notBefore.date) && w.end - from(w, k) >= item.minutes)
    if (i < 0) { waiting.push({ ...item, reason: windows.length ? `No added window has ${item.minutes} minutes left for it.` : 'No extra window was added.' }); continue }
    const start = from(windows[i], i)
    placed.push({ key: item.key, title: item.title, kind: item.kind, date: windows[i].date, start, minutes: item.minutes })
    cursor[i] = start + item.minutes
  }
  return { placed, waiting, remaining: windows.map((w, i) => ({ ...w, start: cursor[i] })).filter(w => w.end - w.start >= EXTRA.minMinutes),
    perWindow: windows.map((w, i) => ({ ...w, items: placed.filter(p => p.date === w.date && p.start >= w.start && p.start < w.end), unusedMinutes: w.end - cursor[i] })) }
}
