import { weekdayOf, zonedTimeToUtc } from './studyWeek'

/**
 * Pure: where existing, unfinished study tasks go after a class change made their slot unusable.
 *
 * Only real room is used: the student's availability windows minus protected time, mocks and other tasks. Tasks keep their identity, minutes and
 * order (never earlier than they were, never past a later sitting of the same reading). Work that does not fit is returned as `unplaced`; nothing
 * is shortened, dropped or squeezed into time that does not exist. Started or recorded work is a constraint (`kept`), never moved.
 */
export type RecoveryTask = {
  id: string; title: string; revision: number; date: string; startsAt: string | null; minutes: number
  placement: string; execution: string; taskType: string; priority: string; lmId: string | null
  /** Started, recorded, protected or part of a frozen paper: shown, never moved. */
  fixed: boolean
  /** Tasks that must come BEFORE this one (the declared `dependencies` order of linked sittings). Order is never inferred from titles or a shared reading. */
  after?: string[]
}
export type Window = { weekday: number; start: number; end: number }
export type Blocker = { date: string; start: number; end: number }
export type RecoveryInput = {
  tasks: RecoveryTask[]
  /** task id -> the booking it overlaps now (from the database's effective schedule). */
  overlaps: Record<string, string>
  today: string; cycleEnd: string; timezone: string
  /** Dates study may be placed on (route / exam horizon / assessment-day rules). */
  studyDates: string[]
  /** Free study minutes per date from the database (windows minus protected time and mocks, from now). */
  available: Record<string, number>
  windows: Window[]
  /** Protected commitments, classes and booked mocks, per date, in minutes from local midnight. */
  blockers: Blocker[]
  /** Earliest minute today a new start may take. */
  earliestToday: number
}
export type Move = {
  task_id: string; title: string; minutes: number; expected_revision: number; reason: string
  from: { date: string; starts_at: string | null; placement: string }
  to_date: string; to_starts: string | null
  to: { date: string; starts_at: string | null; placement: string }
}
export type Unplaced = { task_id: string; title: string; minutes: number; expected_revision: number; reason: string; from: { date: string; starts_at: string | null } }
export type Kept = { task_id: string; title: string; reason: string }
export type RecoveryPlan = { moves: Move[]; unplaced: Unplaced[]; kept: Kept[]; unchanged: number }

const STEP = 15
const RANK: Record<string, number> = { optional: 0, stretch: 1, supporting: 1, core: 2, critical: 3 }
const OFF_LOAD = new Set(['diagnostic', 'mock', 'admin'])
const OPEN = new Set(['not_started', 'in_progress', 'partial'])
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export function planClassRecovery(input: RecoveryInput): RecoveryPlan {
  const open = input.tasks.filter(t => OPEN.has(t.execution) && t.date >= input.today && t.date <= input.cycleEnd)
  const load: Record<string, number> = {}
  for (const t of open) if (!OFF_LOAD.has(t.taskType)) load[t.date] = (load[t.date] ?? 0) + t.minutes
  const affected = new Map<string, string>() // id -> reason
  const overloaded = new Set<string>() // affected only because its day lost room: it must leave that day
  for (const t of open) if (input.overlaps[t.id]) affected.set(t.id, `Overlaps ${input.overlaps[t.id]}`)

  // A day that no longer holds its load gives back its lowest-priority, latest, still-movable day-preferred work first.
  const afterMoves: Record<string, number> = { ...load }
  for (const t of open) if (affected.has(t.id) && !OFF_LOAD.has(t.taskType)) afterMoves[t.date] -= t.minutes
  for (const date of Object.keys(load).sort()) {
    if ((afterMoves[date] ?? 0) <= (input.available[date] ?? 0)) continue
    const give = open.filter(t => t.date === date && !affected.has(t.id) && !t.fixed && t.placement !== 'timed' && !OFF_LOAD.has(t.taskType) && t.execution === 'not_started')
      .sort((a, b) => (RANK[a.priority] ?? 2) - (RANK[b.priority] ?? 2) || b.minutes - a.minutes || a.id.localeCompare(b.id))
    for (const t of give) {
      if ((afterMoves[date] ?? 0) <= (input.available[date] ?? 0)) break
      affected.set(t.id, 'That day no longer has enough study time'); overloaded.add(t.id); afterMoves[date] -= t.minutes
    }
  }

  const blockers: Blocker[] = [...input.blockers]
  for (const t of input.tasks) {
    if (t.placement !== 'timed' || !t.startsAt || !['not_started', 'in_progress', 'partial', 'completed'].includes(t.execution)) continue
    // Where a task is now still counts, even if it is about to move: moves are applied one after another under a strict overlap check.
    blockers.push({ date: t.date, start: minuteOfDay(t.startsAt, input.timezone), end: minuteOfDay(t.startsAt, input.timezone) + t.minutes })
  }

  // Declared order between sittings: where every open task is NOW, updated as proposals are made.
  const pos = new Map<string, { date: string; start: number | null }>()
  for (const t of open) pos.set(t.id, { date: t.date, start: t.placement === 'timed' && t.startsAt ? minuteOfDay(t.startsAt, input.timezone) : null })
  const byId = new Map(open.map(t => [t.id, t]))
  /** An earlier sitting never lands after its later sibling: not on a later date, and on the same date (both timed) not overlapping or after it. */
  const orderOk = (t: RecoveryTask, date: string, start: number | null): boolean => {
    for (const pid of t.after ?? []) {
      const p = byId.get(pid); if (!p) continue                  // a completed, cancelled or skipped predecessor no longer constrains
      const pp = pos.get(pid)!
      if (date < pp.date) return false
      if (date === pp.date && start !== null && pp.start !== null && start < pp.start + p.minutes) return false
    }
    for (const q of open) {
      if (!(q.after ?? []).includes(t.id)) continue
      const qq = pos.get(q.id)!
      if (date > qq.date) return false
      if (date === qq.date && start !== null && qq.start !== null && start + t.minutes > qq.start) return false
    }
    return true
  }
  const out: RecoveryPlan = { moves: [], unplaced: [], kept: [], unchanged: 0 }
  const order = open.filter(t => affected.has(t.id)).sort((a, b) => a.date.localeCompare(b.date) || (a.startsAt ?? '').localeCompare(b.startsAt ?? '') || (RANK[b.priority] ?? 2) - (RANK[a.priority] ?? 2) || a.id.localeCompare(b.id))
  // predecessors are decided before their dependents
  for (let pass = 0; pass < order.length; pass++) {
    let swapped = false
    for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) if ((order[i].after ?? []).includes(order[j].id)) { [order[i], order[j]] = [order[j], order[i]]; swapped = true }
    if (!swapped) break
  }
  const day = { ...load }
  for (const t of order) {
    const reason = affected.get(t.id)!
    if (t.fixed || t.execution !== 'not_started' || OFF_LOAD.has(t.taskType)) { out.kept.push({ task_id: t.id, title: t.title, reason: OFF_LOAD.has(t.taskType) ? `${reason}. Papers and bookings keep their reserved time; change them from Tests or Calendar.` : `${reason}. It is already started or recorded, so it stays where it is until you decide.` }); continue }
    // Never earlier than it was, never past a later sitting of the same reading.
    const floor = t.date < input.today ? input.today : t.date
    const next = t.lmId ? open.filter(o => o.id !== t.id && o.lmId === t.lmId && !affected.has(o.id) && (o.date > t.date || (o.date === t.date && (o.startsAt ?? '') > (t.startsAt ?? '')))).map(o => o.date).sort()[0] : undefined
    const dates = input.studyDates.filter(d => d >= floor && d <= input.cycleEnd && (!next || d <= next)).sort()
    let placed: { date: string; start: number | null } | null = null
    for (const date of dates) {
      if (!OFF_LOAD.has(t.taskType) && date !== t.date && (day[date] ?? 0) + t.minutes > (input.available[date] ?? 0)) continue
      if (overloaded.has(t.id) && date === t.date) continue
      if (t.placement !== 'timed') { if (orderOk(t, date, null)) { placed = { date, start: null }; break } continue }
      const start = firstSlot(input, blockers.filter(b => b.date === date), date, t.minutes, s => orderOk(t, date, s))
      if (start !== null) { placed = { date, start }; break }
    }
    const from = { date: t.date, starts_at: t.startsAt, placement: t.placement }
    if (!placed) { out.unplaced.push({ task_id: t.id, title: t.title, minutes: t.minutes, expected_revision: t.revision, reason: `${reason}, and there is no room for it before this week ends.`, from: { date: t.date, starts_at: t.startsAt } }); continue }
    const toStarts = placed.start === null ? null : zonedTimeToUtc(placed.date, hm(placed.start), input.timezone).toISOString()
    out.moves.push({ task_id: t.id, title: t.title, minutes: t.minutes, expected_revision: t.revision, reason, from, to_date: placed.date, to_starts: toStarts, to: { date: placed.date, starts_at: toStarts, placement: placed.start === null ? 'day_preferred' : 'timed' } })
    if (!OFF_LOAD.has(t.taskType)) { day[t.date] -= t.minutes; day[placed.date] = (day[placed.date] ?? 0) + t.minutes; }
    pos.set(t.id, { date: placed.date, start: placed.start })
    if (placed.start !== null) blockers.push({ date: placed.date, start: placed.start, end: placed.start + t.minutes })
  }
  out.unchanged = open.filter(t => !affected.has(t.id)).length
  return out
}

function minuteOfDay(iso: string, tz: string): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso))
  return Number(p.find(x => x.type === 'hour')!.value) * 60 + Number(p.find(x => x.type === 'minute')!.value)
}

/** First start, on a 15-minute grid, where `minutes` fit wholly inside one study window and touch no blocker. */
function firstSlot(input: RecoveryInput, blockers: Blocker[], date: string, minutes: number, ok: (start: number) => boolean = () => true): number | null {
  for (const w of input.windows.filter(w => w.weekday === weekdayOf(date)).sort((a, b) => a.start - b.start)) {
    const from = date === input.today ? Math.max(w.start, Math.ceil(input.earliestToday / STEP) * STEP) : w.start
    for (let s = Math.ceil(from / STEP) * STEP; s + minutes <= w.end; s += STEP) {
      if (!blockers.some(b => s < b.end && b.start < s + minutes) && ok(s)) return s
    }
  }
  return null
}
