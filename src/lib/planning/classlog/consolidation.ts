/**
 * Class-log consolidation planner (pure).
 *
 * Given what the student logged from class and the days still open in the
 * cycle, decide which consolidation tasks go where. It never plans into a day
 * on or before the class it consolidates, never exceeds a day's capacity or
 * the daily absorption cap, never touches the paper day, and reports anything
 * that does not fit as carryover instead of stretching the week. There is no
 * hours target: the only limits are the student's own availability windows
 * and the absorption cap.
 */

export type Extent = 'part' | 'full' | 'continued'

export type LoggedItem = {
  sessionId: string
  /** The class date, YYYY-MM-DD. Consolidation is never placed on or before it. */
  classDate: string
  outcomeId: string
  moduleId: string
  title: string
  extent: Extent
  /** Effort units of the whole outcome (module effort spread across its outcomes). */
  outcomeEffortUnits: number
  /** A revision/doubt class: planned as revision, not new consolidation. */
  revision?: boolean
  /** Minutes still owed for this item (already net of what earlier previews placed). Defaults to the covered effort. */
  requiredMinutes?: number
  /** Sittings of this item that already exist (earlier previews): their shared group, how many, and the last one's id (the next one follows it). */
  existing?: { groupId: string | null; count: number; lastTaskKey: string | null }
}

export type OpenDay = {
  date: string
  /** Free minutes left on the day (after the clock, classes, bookings and accepted load). */
  capacityMinutes: number
  /** The contiguous free ranges that make up `capacityMinutes`, in minutes each. Absent: one range of `capacityMinutes`. */
  gaps?: number[]
}

export type RepairIn = { id: string; title: string; minutes: number }

export type PlannedTask = {
  date: string
  title: string
  taskType: 'study' | 'repair' | 'review'
  minutes: number
  sessionId: string | null
  outcomeId: string | null
  repairThreadId: string | null
  lane: 'repair' | 'consolidation' | 'revision'
  /** `${sessionId}:${outcomeId}` of the item this sitting belongs to. */
  itemKey?: string
  /** Position among this item's sittings (1-based, counting earlier previews' sittings) and the total when it is settled (null while some is still owed). */
  sitting?: { index: number; count: number | null }
  /** Key shared by every sitting of one item; the sitting before this one (its `key`), so order is declared, never inferred from titles. */
  key?: string
  after?: string | null
}

export type Carryover = {
  outcomeId: string | null; repairThreadId: string | null; title: string; reason: 'no_capacity' | 'no_open_day'
  /** Minutes still owed and minutes placed now, so a partly placed item reports exactly what is left. */
  remainingMinutes?: number; placedMinutes?: number
  /** The class event this belongs to (`${sessionId}:${outcomeId}`): two classes on one outcome stay two items. */
  sessionId?: string | null; itemKey?: string
}

export type Pressure = 'comfortable' | 'tight' | 'over'

export type ConsolidationPlan = { tasks: PlannedTask[]; carryover: Carryover[]; pressure: Pressure }

export const PART_FRACTION = 0.5
export const MIN_TASK_MINUTES = 15
/** The task ceiling when the student has not set a smaller sitting limit. */
export const MAX_TASK_MINUTES = 90
/** The database's own floor for a task. */
export const FLOOR_TASK_MINUTES = 5
export const DAILY_ABSORPTION_CAP_UNITS = 6

/** Effort of what was actually covered: a part is half an outcome. */
export function coveredUnits(i: Pick<LoggedItem, 'extent' | 'outcomeEffortUnits'>): number {
  return i.extent === 'full' ? i.outcomeEffortUnits : i.outcomeEffortUnits * PART_FRACTION
}

/** The longest generated sitting: the student's own limit, never above the planner's ceiling. */
export function sittingCeiling(maxSittingMinutes?: number | null): number {
  return maxSittingMinutes && maxSittingMinutes >= FLOOR_TASK_MINUTES ? Math.min(MAX_TASK_MINUTES, Math.floor(maxSittingMinutes)) : MAX_TASK_MINUTES
}

export function planClassConsolidation(input: {
  items: LoggedItem[]
  days: OpenDay[]
  repairs: RepairIn[]
  minutesPerEffortUnit: number
  /** `${sessionId}:${outcomeId}` already planned (idempotent re-runs). */
  alreadyPlanned?: Set<string>
  dailyCapUnits?: number
  /** The student's configured longest comfortable sitting. */
  maxSittingMinutes?: number | null
}): ConsolidationPlan {
  const cap = input.dailyCapUnits ?? DAILY_ABSORPTION_CAP_UNITS
  const ceiling = sittingCeiling(input.maxSittingMinutes)
  const already = input.alreadyPlanned ?? new Set<string>()
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, gaps: [...(d.gaps ?? [d.capacityMinutes])].filter(g => g > 0).sort((x, y) => y - x), unitsLeft: cap }))

  const tasks: PlannedTask[] = []
  const carryover: Carryover[] = []
  const totalOf = (d: { gaps: number[] }) => d.gaps.reduce((s, g) => s + g, 0)

  /** Places `owed` minutes across days as linked sittings. Returns what is still owed. */
  const place = (
    earliest: string, owed: number, units: number, perSitting: number, make: (date: string, minutes: number) => PlannedTask,
  ): { left: number; placed: number } => {
    const total = Math.max(FLOOR_TASK_MINUTES, Math.round(owed))
    let need = total
    // A sitting is at least the usual minimum piece, unless the student's own limit is smaller than that.
    const minPiece = Math.min(MIN_TASK_MINUTES, ceiling)
    let sittingsLeft = Math.max(1, Math.min(Math.ceil(total / ceiling), Math.floor(total / minPiece)))
    if (sittingsLeft * ceiling < total) sittingsLeft = Math.ceil(total / ceiling)
    // Equal sittings only matter when everything fits: p-minute pieces, as many as the usable gaps can hold (a limit is per sitting, so one day may hold several).
    const piece = Math.min(ceiling, Math.ceil(total / sittingsLeft))
    const holdable = days.filter(d => d.date >= earliest).reduce((n, d) => n + d.gaps.reduce((k, g) => k + Math.floor(g / piece), 0), 0)
    const everythingFits = holdable >= sittingsLeft
    // Pass 0 spreads one sitting per day (spacing helps recall); later passes may add more sittings to a day that still has room.
    for (let pass = 0; pass < 4 && need > 0; pass++) {
      let progress = false
      for (const d of days) {
        if (d.date < earliest || need <= 0) continue
        let todays = 0
        while (need > 0 && d.gaps.length > 0 && (pass > 0 || todays === 0)) {
          const gap = d.gaps[0]
          const target = everythingFits ? Math.min(ceiling, Math.ceil(need / Math.max(1, sittingsLeft))) : ceiling
          const chunk = Math.min(need, target, gap)
          if (chunk < FLOOR_TASK_MINUTES || (chunk < minPiece && chunk < need)) break
          const unitShare = units * (chunk / Math.max(total, 1))
          if (d.unitsLeft < unitShare && units > 0) break
          d.gaps[0] -= chunk; d.gaps = d.gaps.filter(g => g > 0).sort((x, y) => y - x)
          d.unitsLeft -= units > 0 ? unitShare : 0
          tasks.push(make(d.date, chunk))
          need -= chunk; todays++; progress = true; sittingsLeft = Math.max(1, sittingsLeft - 1)
        }
      }
      if (!progress) break
    }
    return { left: need, placed: total - need }
  }

  // 1. Open repairs first — they need no class date.
  for (const r of input.repairs) {
    const r2 = place('0000-00-00', r.minutes, 0, ceiling, (date, minutes) => ({
      date, title: r.title, taskType: 'repair', minutes, sessionId: null, outcomeId: null, repairThreadId: r.id, lane: 'repair',
    }))
    if (r2.left > 0) carryover.push({ outcomeId: null, repairThreadId: r.id, title: r.title, reason: days.length === 0 ? 'no_open_day' : 'no_capacity', remainingMinutes: r2.left, placedMinutes: r2.placed })
  }

  // 2. Logged material: most recent class first; each item no earlier than the day after its class.
  const fresh = input.items.filter(i => i.requiredMinutes !== undefined || !already.has(`${i.sessionId}:${i.outcomeId}`))
  const ordered = [...fresh].sort((a, b) => b.classDate.localeCompare(a.classDate) || a.title.localeCompare(b.title))
  const owedOf = (i: LoggedItem) => i.requiredMinutes ?? coveredUnits(i) * input.minutesPerEffortUnit
  for (const item of ordered) {
    const units = coveredUnits(item)
    const owed = owedOf(item)
    if (owed <= 0) continue
    const after = new Date(new Date(`${item.classDate}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
    const lane = item.revision ? 'revision' : 'consolidation'
    const label = item.revision ? 'Revise' : 'Consolidate'
    const baseTitle = `${label}: ${item.title}${item.extent === 'part' ? ' (the part covered in class)' : ''}`
    const itemKey = `${item.sessionId}:${item.outcomeId}`
    const prior = item.existing ?? { groupId: null, count: 0, lastTaskKey: null }
    // Equal-sized sittings no longer than the limit: 88 minutes at a 45-minute limit is 44 + 44, not 45 + 43 + a stub.
    const perSitting = Math.ceil(Math.max(FLOOR_TASK_MINUTES, owed) / Math.ceil(Math.max(FLOOR_TASK_MINUTES, owed) / Math.min(ceiling, Math.max(FLOOR_TASK_MINUTES, owed))))
    const startAt = tasks.length
    const r = place(after, owed, units, perSitting, (date, minutes) => ({
      date, title: baseTitle, taskType: item.revision ? 'review' : 'study', minutes, sessionId: item.sessionId, outcomeId: item.outcomeId, repairThreadId: null, lane, itemKey,
    }))
    // Sittings are ordered by DATE, then linked: each declares the one before it (never inferred from a title or display order).
    const mine = tasks.splice(startAt).sort((x, y) => x.date.localeCompare(y.date))
    const count = prior.count + mine.length
    let previousKey = prior.lastTaskKey
    mine.forEach((t, i) => {
      t.key = `${itemKey}#${prior.count + i + 1}`; t.after = previousKey; previousKey = t.key
      t.sitting = { index: prior.count + i + 1, count: r.left > 0 ? null : count }
    })
    tasks.push(...mine)
    if (r.left > 0) carryover.push({ outcomeId: item.outcomeId, repairThreadId: null, title: item.title, reason: days.some(d => d.date >= after && totalOf(d) > 0) ? 'no_capacity' : (days.some(d => d.date >= after) ? 'no_capacity' : 'no_open_day'), remainingMinutes: r.left, placedMinutes: r.placed, sessionId: item.sessionId, itemKey })
  }

  const totalNeed = fresh.reduce((s, i) => s + owedOf(i), 0) + input.repairs.reduce((s, r) => s + r.minutes, 0)
  const totalCap = input.days.reduce((s, d) => s + d.capacityMinutes, 0)
  const pressure: Pressure = carryover.length > 0 ? 'over' : totalCap > 0 && totalNeed / totalCap > 0.8 ? 'tight' : 'comfortable'

  return { tasks: tasks.sort((a, b) => a.date.localeCompare(b.date)), carryover, pressure }
}
