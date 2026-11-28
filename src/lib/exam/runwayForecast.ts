import { packSittings, type Gap } from '../planning/pulse/gaps'

/**
 * What can really be finished before the mock runway (pure). It plans on the same terms as Calendar: free contiguous ranges that are already net of
 * commitments, bookings and accepted work; study days only; sittings no longer than the student's limit, each inside one gap; and the daily cap on new
 * learning. Weekly study time added up is never used as capacity. Weeks after the proposed one are forecasts: nothing in them is scheduled.
 */
export type ForecastDay = { date: string; week: number; gaps: Gap[] }
/** Other work that needs the time first (carried work, open repairs, a booked mock's debrief and follow-up). */
export type Reserved = { title: string; minutes: number; notBefore?: string }
export type ForecastRules = { maxSitting: number; minSitting: number; dailyNewMinutes: number }
export type WorkItem = { name: string; href: string; minutes: number }
export type PlacedWork = WorkItem & { week: number; forecast: boolean }
export type ForecastWeek = { week: number; start: string; forecast: boolean; usableMinutes: number }
export type Forecast = { placed: PlacedWork[]; waiting: WorkItem[]; weeks: ForecastWeek[]; reservedMinutes: number; reservedUnplaced: number }

export function forecastBeforeRunway(days: ForecastDay[], reserved: Reserved[], work: WorkItem[], rules: ForecastRules): Forecast {
  const gaps = new Map(days.map(d => [d.date, d.gaps.map(g => ({ ...g }))]))
  /** Packs as much of `want` into one day's gaps as the rules allow; returns the minutes taken and the gaps left. */
  const take = (g: Gap[], want: number) => {
    const r = packSittings(g, want, rules.maxSitting, Math.min(rules.minSitting, want))
    return { minutes: r.sittings.reduce((a, b) => a + b, 0), gaps: r.gaps }
  }
  let reservedMinutes = 0, reservedUnplaced = 0
  for (const item of reserved) {
    let need = item.minutes
    for (const d of days) {
      if (need <= 0) break
      if (item.notBefore && d.date < item.notBefore) continue
      const t = take(gaps.get(d.date)!, need)
      gaps.set(d.date, t.gaps); need -= t.minutes
    }
    reservedMinutes += item.minutes - need; reservedUnplaced += Math.max(0, need)
  }
  const usable = (d: ForecastDay) => gaps.get(d.date)!.reduce((n, g) => n + (g.end - g.start >= rules.minSitting ? g.end - g.start : 0), 0)
  const weeks: ForecastWeek[] = []
  for (const d of days) {
    const w = weeks.find(x => x.week === d.week)
    if (w) w.usableMinutes += usable(d)
    else weeks.push({ week: d.week, start: d.date, forecast: d.week > 1, usableMinutes: usable(d) })
  }
  const placed: PlacedWork[] = [], waiting: WorkItem[] = []
  const newUsed = new Map<string, number>()
  for (const item of work) {
    if (item.minutes <= 0) continue
    // Tried on a copy: a piece counts only if ALL of it finishes before the runway, otherwise it claims no time.
    const trial = new Map<string, { gaps: Gap[]; used: number }>()
    let need = item.minutes, week = 0
    for (const d of days) {
      if (need <= 0) break
      const room = rules.dailyNewMinutes - (newUsed.get(d.date) ?? 0)
      const want = Math.min(need, room)
      if (want < Math.min(rules.minSitting, need)) continue
      const t = take(gaps.get(d.date)!, want)
      if (!t.minutes) continue
      trial.set(d.date, { gaps: t.gaps, used: t.minutes }); need -= t.minutes; week = d.week
    }
    if (need > 0) { waiting.push(item); continue }
    for (const [date, t] of trial) { gaps.set(date, t.gaps); newUsed.set(date, (newUsed.get(date) ?? 0) + t.used) }
    placed.push({ ...item, week, forecast: week > 1 })
  }
  return { placed, waiting, weeks, reservedMinutes, reservedUnplaced }
}
