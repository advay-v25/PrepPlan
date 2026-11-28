import { utcToZonedParts } from '../studyWeek'
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

/** A free interval of one local day, in minutes from local midnight. Fit is decided against these, never against a day total. */
export type Gap = { start: number; end: number }

export const gapsFromRanges = (ranges: { start: string; end: string }[]): Gap[] =>
  ranges.map(r => ({ start: toMin(r.start), end: toMin(r.end) })).filter(g => g.end > g.start).sort((a, b) => a.start - b.start)

/** Removes busy intervals (accepted timed work, bookings) from the gaps. Exact adjacency leaves both sides intact. */
export function subtractBusy(gaps: Gap[], busy: Gap[]): Gap[] {
  let out = gaps
  for (const b of busy) out = out.flatMap(g => b.end <= g.start || b.start >= g.end ? [g]
    : [...(b.start > g.start ? [{ start: g.start, end: b.start }] : []), ...(b.end < g.end ? [{ start: b.end, end: g.end }] : [])])
  return out
}

/** Takes `minutes` of already-represented day-flexible work out of the gaps, earliest first, so the same time is never promised twice. */
export function reserveFlexible(gaps: Gap[], minutes: number): Gap[] {
  let left = Math.max(0, minutes)
  const out: Gap[] = []
  for (const g of gaps) {
    const used = Math.min(left, g.end - g.start)
    left -= used
    if (g.end - g.start - used > 0) out.push({ start: g.start + used, end: g.end })
  }
  return out
}

export const totalMinutes = (gaps: Gap[]) => gaps.reduce((n, g) => n + (g.end - g.start), 0)

/**
 * Packs up to `want` minutes into ordered sittings, each inside ONE gap and at most `limit` long. A sitting shorter than `min` is not offered.
 * Two 30-minute gaps hold two 30-minute sittings; a 45-minute sitting limit cannot claim their sum. Returns the sittings and the remaining gaps;
 * the packed total may be less than `want`, and the caller shows the rest as waiting.
 */
export function packSittings(gaps: Gap[], want: number, limit: number, min = 5): { sittings: number[]; gaps: Gap[] } {
  const left = gaps.map(g => ({ ...g }))
  const sittings: number[] = []
  let need = want
  for (const g of left) {
    while (need > 0 && g.end - g.start >= min) {
      const take = Math.min(need, limit, g.end - g.start)
      if (take < min) break
      sittings.push(take); g.start += take; need -= take
    }
    if (need <= 0) break
  }
  return { sittings, gaps: left.filter(g => g.end > g.start) }
}

/** Places one unsplittable sitting of `minutes` in the first gap that holds all of it; null when no single gap does. */
export function packWhole(gaps: Gap[], minutes: number): Gap[] | null {
  const i = gaps.findIndex(g => g.end - g.start >= minutes)
  if (i < 0) return null
  return gaps.map((g, j) => j === i ? { start: g.start + minutes, end: g.end } : g).filter(g => g.end > g.start)
}

/**
 * Accepted timed work as busy intervals per local date, read on the student's own clock. An instant whose local date is not the task's date
 * (stale or corrupt) cannot be placed on that day's clock and is skipped; an interval is clipped at local midnight. Repeated and skipped DST hours
 * follow the zone, never a fixed offset.
 */
export function busyFromTimed(rows: { local_date: string; starts_at: string; duration_minutes: number | null }[], timezone: string): Record<string, Gap[]> {
  const out: Record<string, Gap[]> = {}
  for (const t of rows) {
    const at = utcToZonedParts(new Date(t.starts_at), timezone)
    if (at.date !== t.local_date) continue
    const start = Number(at.time.slice(0, 2)) * 60 + Number(at.time.slice(3, 5))
    ;(out[t.local_date] ??= []).push({ start, end: Math.min(1440, start + Number(t.duration_minutes ?? 0)) })
  }
  return out
}

/**
 * The largest remaining gap after accepted work is packed whole. This is spare room, not an amount that can be appended to any sitting.
 * Existing work that fits nowhere blocks further allocation until reviewed, matching the database packer.
 */
export function roomAfterAccepted(free: Gap[], timedBusy: Gap[], flexibleMinutes: number[]): number {
  return gapsAfterAccepted(free, timedBusy, flexibleMinutes).reduce((best, g) => Math.max(best, g.end - g.start), 0)
}

/** The gaps left once accepted timed work is removed and accepted flexible sittings are packed whole, largest first. A sitting that fits nowhere leaves no room. */
export function gapsAfterAccepted(free: Gap[], timedBusy: Gap[], flexibleMinutes: number[]): Gap[] {
  let gaps = subtractBusy(free, timedBusy)
  for (const m of [...flexibleMinutes].sort((a, b) => b - a)) { const next = packWhole(gaps, m); if (!next) return []; gaps = next }
  return gaps
}

/** Remove this sitting before measuring its entire replacement; spare room in another gap cannot extend it. */
export function growthRoom(free: Gap[], timedBusy: Gap[], otherMinutes: number[], currentMinutes: number): number {
  return Math.max(0, roomAfterAccepted(free, timedBusy, otherMinutes) - currentMinutes)
}

/** Whether every accepted flexible sitting still fits whole into the gaps left by timed work (largest first). Used to say "this no longer fits", never to move anything. */
export function allFitWhole(free: Gap[], timedBusy: Gap[], flexibleMinutes: number[]): boolean {
  let gaps = subtractBusy(free, timedBusy)
  for (const m of [...flexibleMinutes].sort((a, b) => b - a)) { const next = packWhole(gaps, m); if (!next) return false; gaps = next }
  return true
}

/** Prefer the usual paper time when it leaves room for the other accepted sittings. */
export function fitTimedStart(gaps: Gap[], duration: number, preferred: number, flexibleMinutes: number[]): number | null {
  for (const start of [preferred, ...gaps.map(g => g.start)]) {
    const end = start + duration
    if (gaps.some(g => g.start <= start && end <= g.end) && allFitWhole(gaps, [{ start, end }], flexibleMinutes)) return start
  }
  return null
}
