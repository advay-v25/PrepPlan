import { fitTimedStart, packWhole, subtractBusy, type Gap } from '../planning/pulse/gaps'
import { fillWindows, type ExtraWindow } from '../planning/extraWindows'
import type { ProposalLine } from './mockTransition'

/**
 * Where a mock, its debrief and its follow-up go inside ONE proposed week (pure).
 *
 * The mock keeps its own clock, so it takes one opening that holds all of it; it is never split. The debrief and follow-up come on later days
 * (a debrief needs the mock to have happened), each inside one opening and within the student's sitting limit. Whatever cannot be placed in this
 * week is returned as waiting, with the reason, instead of being squeezed in.
 */
export type DayRoom = { date: string; /** A day the student studies on and that is not before today. */ usable: boolean; gaps: Gap[] }
/** `start` is set when the part sits in a one-off window the student added: it is saved at that exact time. */
export type Part = { date: string; minutes: number; start?: number }
export type MockWeekPlacement = {
  mock: { date: string; start: number; minutes: number; window?: boolean } | null
  /** The debrief and follow-up as placed sittings, in order; empty when none of it fits. */
  debrief: Part[]
  followUp: Part[]
  waits: { title: string; reason: string; kind: ProposalLine['kind']; minutes: number }[]
}

/** The student's estimate cut into sittings no longer than the limit (a last piece under 15 minutes joins the one before). */
export function sittingsOf(minutes: number, limit: number | null): number[] {
  if (!limit || minutes <= limit) return [minutes]
  const n = Math.ceil(minutes / limit), base = Math.floor(minutes / n)
  return Array.from({ length: n }, (_, i) => base + (i < minutes - base * n ? 1 : 0))
}

export function placeMockWeek(days: DayRoom[], adds: ProposalLine[], maxSittingMinutes: number | null, preferredStart: number, /** The mock already sits at this moment (an added window). */ forced?: { date: string; start: number }): MockWeekPlacement {
  const line = (k: ProposalLine['kind']) => adds.find(a => a.kind === k)
  const mockLine = line('mock')
  const out: MockWeekPlacement = { mock: null, debrief: [], followUp: [], waits: [] }
  if (!mockLine) return out
  const usable = days.filter(d => d.usable)

  /** Places the debrief then the follow-up on days after the mock day, sitting by sitting, into a copy of the room. */
  const after = (mockDate: string, gaps: Map<string, Gap[]>) => {
    const got: Record<'debrief' | 'follow_up', Part[]> = { debrief: [], follow_up: [] }
    const waits: MockWeekPlacement['waits'] = []
    let lastDebrief = ''
    for (const kind of ['debrief', 'follow_up'] as const) {
      const l = line(kind)
      if (!l) continue
      let rest = 0
      for (const minutes of sittingsOf(l.minutes, maxSittingMinutes)) {
        // A follow-up prefers a day after the debrief; the debrief's own last day is the fallback, never an earlier day.
        const later = usable.map(d => d.date).filter(d => d > (kind === 'debrief' || lastDebrief < mockDate ? mockDate : lastDebrief))
        const order = kind === 'follow_up' && lastDebrief > mockDate ? [...later, lastDebrief] : later
        const date = order.find(d => packWhole(gaps.get(d) ?? [], minutes) !== null)
        if (!date) { rest += minutes; continue }
        gaps.set(date, packWhole(gaps.get(date) ?? [], minutes)!)
        got[kind].push({ date, minutes })
        if (kind === 'debrief' && date > lastDebrief) lastDebrief = date
      }
      got[kind].sort((a, b) => a.date.localeCompare(b.date))
      if (rest) waits.push({ kind, minutes: rest, title: l.label, reason: kind === 'debrief' ? 'No later day this week has an opening for it. It follows the mock.' : 'No later opening this week. It follows the debrief.' })
    }
    return { got, waits }
  }
  const roomMap = (date?: string, start?: number) => {
    const m = new Map(usable.map(d => [d.date, d.gaps] as const))
    if (date !== undefined && start !== undefined && m.has(date)) m.set(date, subtractBusy(m.get(date)!, [{ start, end: start + mockLine.minutes }]))
    return m
  }

  // Prefer the earliest day that leaves room for BOTH later pieces in full; otherwise the earliest day the mock fits at all.
  let chosen: { date: string; start: number } | null = forced ?? null, fallback: { date: string; start: number } | null = null
  for (let at = 0; at < usable.length && !chosen; at++) {
    const start = fitTimedStart(usable[at].gaps, mockLine.minutes, preferredStart, [])
    if (start === null) continue
    fallback ??= { date: usable[at].date, start }
    if (!after(usable[at].date, roomMap(usable[at].date, start)).waits.length) chosen = { date: usable[at].date, start }
  }
  const pick = chosen ?? fallback
  if (!pick) {
    out.waits.push({ kind: 'mock', minutes: mockLine.minutes, title: mockLine.label, reason: `No day this week has one opening of ${mockLine.minutes} minutes; the mock clock is not split.` })
    for (const kind of ['debrief', 'follow_up'] as const) { const l = line(kind); if (l) out.waits.push({ kind, minutes: l.minutes, title: l.label, reason: 'It comes after the mock, which is not placed.' }) }
    return out
  }
  out.mock = { date: pick.date, start: pick.start, minutes: mockLine.minutes, ...(forced ? { window: true } : {}) }
  const placed = after(pick.date, roomMap(pick.date, forced ? undefined : pick.start))
  out.debrief = placed.got.debrief; out.followUp = placed.got.follow_up; out.waits = placed.waits
  return out
}

/** The same placement, then whatever still waits into the windows the student added: the mock first, the debrief after it, the follow-up after that. */
export function placeMockWithWindows(days: DayRoom[], adds: ProposalLine[], maxSittingMinutes: number | null, preferredStart: number, windows: ExtraWindow[]): MockWeekPlacement {
  let out = placeMockWeek(days, adds, maxSittingMinutes, preferredStart)
  let free = windows
  const mockLine = adds.find(a => a.kind === 'mock')
  if (!out.mock && mockLine) {
    const f = fillWindows(free, [{ key: 'mock', title: mockLine.label, minutes: mockLine.minutes, kind: 'mock' }], maxSittingMinutes)
    if (!f.placed.length) return out
    free = f.remaining
    out = placeMockWeek(days, adds, maxSittingMinutes, preferredStart, { date: f.placed[0].date, start: f.placed[0].start })
  }
  if (!out.mock) return out
  const waits: MockWeekPlacement['waits'] = []
  let notBefore = { date: out.mock.date, start: out.mock.start + out.mock.minutes }
  for (const kind of ['debrief', 'follow_up'] as const) {
    const key = kind === 'debrief' ? 'debrief' as const : 'followUp' as const
    const w = out.waits.find(x => x.kind === kind)
    if (w) {
      let rest = 0
      for (const [n, minutes] of sittingsOf(w.minutes, maxSittingMinutes).entries()) {
        const f = fillWindows(free, [{ key: `${kind}-${n}`, title: w.title, minutes, kind, notBefore }], maxSittingMinutes)
        if (!f.placed.length) { rest += minutes; continue }
        free = f.remaining
        out[key].push({ date: f.placed[0].date, minutes, start: f.placed[0].start })
        notBefore = { date: f.placed[0].date, start: f.placed[0].start + minutes }
      }
      out[key].sort((a, b) => a.date.localeCompare(b.date))
      if (rest) waits.push({ ...w, minutes: rest, reason: windows.length ? 'Neither a later opening this week nor an added window holds the rest.' : w.reason })
    }
    const last = out[key].at(-1)
    if (last && last.date >= notBefore.date) notBefore = { date: last.date, start: last.start !== undefined ? last.start + last.minutes : 0 }
  }
  out.waits = [...out.waits.filter(x => x.kind === 'mock'), ...waits]
  return out
}
