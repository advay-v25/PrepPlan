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
}

export type OpenDay = { date: string; capacityMinutes: number }

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
}

export type Carryover = { outcomeId: string | null; repairThreadId: string | null; title: string; reason: 'no_capacity' | 'no_open_day' }

export type Pressure = 'comfortable' | 'tight' | 'over'

export type ConsolidationPlan = { tasks: PlannedTask[]; carryover: Carryover[]; pressure: Pressure }

export const PART_FRACTION = 0.5
export const MIN_TASK_MINUTES = 15
export const MAX_TASK_MINUTES = 90
export const DAILY_ABSORPTION_CAP_UNITS = 6

/** Effort of what was actually covered: a part is half an outcome. */
export function coveredUnits(i: Pick<LoggedItem, 'extent' | 'outcomeEffortUnits'>): number {
  return i.extent === 'full' ? i.outcomeEffortUnits : i.outcomeEffortUnits * PART_FRACTION
}

export function planClassConsolidation(input: {
  items: LoggedItem[]
  days: OpenDay[]
  repairs: RepairIn[]
  minutesPerEffortUnit: number
  /** `${sessionId}:${outcomeId}` already planned (idempotent re-runs). */
  alreadyPlanned?: Set<string>
  dailyCapUnits?: number
}): ConsolidationPlan {
  const cap = input.dailyCapUnits ?? DAILY_ABSORPTION_CAP_UNITS
  const already = input.alreadyPlanned ?? new Set<string>()
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date))
    .map(d => ({ date: d.date, minutesLeft: d.capacityMinutes, unitsLeft: cap }))

  const tasks: PlannedTask[] = []
  const carryover: Carryover[] = []

  const place = (
    earliest: string, minutes: number, units: number, make: (date: string, minutes: number) => PlannedTask,
  ): boolean => {
    let need = Math.max(MIN_TASK_MINUTES, Math.round(minutes))
    let placedAny = false
    for (const d of days) {
      if (d.date < earliest || need <= 0) continue
      const chunk = Math.min(need, MAX_TASK_MINUTES, d.minutesLeft)
      if (chunk < MIN_TASK_MINUTES && chunk < need) continue
      const unitShare = units * (chunk / Math.max(minutes, 1))
      if (d.unitsLeft < unitShare && units > 0) continue
      if (chunk <= 0) continue
      d.minutesLeft -= chunk
      d.unitsLeft -= units > 0 ? unitShare : 0
      tasks.push(make(d.date, chunk))
      placedAny = true
      need -= chunk
    }
    return placedAny && need <= 0
  }

  // 1. Open repairs first — they need no class date.
  for (const r of input.repairs) {
    const ok = place('0000-00-00', r.minutes, 0, (date, minutes) => ({
      date, title: r.title, taskType: 'repair', minutes, sessionId: null, outcomeId: null, repairThreadId: r.id, lane: 'repair',
    }))
    if (!ok) carryover.push({ outcomeId: null, repairThreadId: r.id, title: r.title, reason: days.length === 0 ? 'no_open_day' : 'no_capacity' })
  }

  // 2. Logged material: most recent class first; each item no earlier than the day after its class.
  const fresh = input.items.filter(i => !already.has(`${i.sessionId}:${i.outcomeId}`))
  const ordered = [...fresh].sort((a, b) => b.classDate.localeCompare(a.classDate) || a.title.localeCompare(b.title))
  for (const item of ordered) {
    const units = coveredUnits(item)
    const minutes = units * input.minutesPerEffortUnit
    const after = new Date(new Date(`${item.classDate}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
    const lane = item.revision ? 'revision' : 'consolidation'
    const label = item.revision ? 'Revise' : 'Consolidate'
    const detailTitle = `${label}: ${item.title}${item.extent === 'part' ? ' (the part covered in class)' : ''}`
    const ok = place(after, minutes, units, (date, m) => ({
      date, title: detailTitle, taskType: item.revision ? 'review' : 'study', minutes: m,
      sessionId: item.sessionId, outcomeId: item.outcomeId, repairThreadId: null, lane,
    }))
    if (!ok) carryover.push({ outcomeId: item.outcomeId, repairThreadId: null, title: item.title, reason: days.some(d => d.date >= after) ? 'no_capacity' : 'no_open_day' })
  }

  const totalNeed = fresh.reduce((s, i) => s + coveredUnits(i) * input.minutesPerEffortUnit, 0) + input.repairs.reduce((s, r) => s + r.minutes, 0)
  const totalCap = input.days.reduce((s, d) => s + d.capacityMinutes, 0)
  const pressure: Pressure = carryover.length > 0 ? 'over' : totalCap > 0 && totalNeed / totalCap > 0.8 ? 'tight' : 'comfortable'

  return { tasks: tasks.sort((a, b) => a.date.localeCompare(b.date)), carryover, pressure }
}
