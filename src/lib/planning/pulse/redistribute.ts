import { createAdminClient } from '../../supabase/admin'
import { NEW_CONTENT_DAILY_CAP_EFFORT_UNITS } from './generateWeek'

type RemainingDay = {
  date: string
  capacityMinutes: number
  alreadyPlannedContentUnits: number
  // The specific row a "small" redistribution would add minutes to (the
  // first day_preferred row on that date). plan_blocks.duration_minutes is
  // DB-constrained to [5, 180] per row — a day can have room in its overall
  // absorption cap while the one row absorbing the addition still can't
  // legally hold it, so this is checked separately from the day-level cap.
  targetRowDurationMinutes: number
}

const MAX_PORTION_MINUTES = 180

/**
 * The dividing line between "small" (absorb automatically) and "big"
 * (needs a real decision) isn't a task count — it's whether every remaining
 * day still fits inside its own absorption cap, AND every row that would
 * receive the addition stays within the DB's per-row duration range, after
 * absorbing the shortfall (spec §7). Pure, so the boundary condition is
 * directly testable without touching the database.
 */
export function classifyRedistribution(input: {
  remainingEffortToPlace: number
  remainingDays: RemainingDay[]
  minutesPerEffortUnit: number
}): { size: 'small' | 'big'; perDayAddition: number } {
  if (input.remainingDays.length === 0 || input.remainingEffortToPlace <= 0) {
    return { size: input.remainingEffortToPlace <= 0 ? 'small' : 'big', perDayAddition: 0 }
  }
  const perDayAddition = input.remainingEffortToPlace / input.remainingDays.length
  const additionMinutes = Math.round(perDayAddition * input.minutesPerEffortUnit)
  const fits = input.remainingDays.every(d => {
    const totalUnits = d.alreadyPlannedContentUnits + perDayAddition
    const minutesNeeded = totalUnits * input.minutesPerEffortUnit
    return totalUnits <= NEW_CONTENT_DAILY_CAP_EFFORT_UNITS
      && minutesNeeded <= d.capacityMinutes
      && d.targetRowDurationMinutes + additionMinutes <= MAX_PORTION_MINUTES
  })
  return { size: fits ? 'small' : 'big', perDayAddition }
}

/**
 * Applies a small redistribution: spreads the shortfall's effort evenly
 * across today-and-future day_preferred rows in the active cycle, as an
 * extra portion per day. Rows for days already past are never touched
 * (revision-guarded update on the untouched, still-not_started rows only).
 * Returns applied:false with a reason when the deviation classifies as
 * big — nothing is written in that case.
 */
export async function redistributeWeek(
  userId: string, cycleId: string, today: string
): Promise<{ applied: boolean; reason: string | null }> {
  const admin = createAdminClient()

  const { data: cycle } = await admin
    .from('planning_cycles').select('ends_at_local').eq('id', cycleId).eq('user_id', userId).maybeSingle()
  if (!cycle) return { applied: false, reason: 'Cycle not found.' }

  const { data: blocks } = await admin
    .from('plan_blocks')
    .select('id, local_date, execution, duration_minutes, task_type, revision')
    .eq('cycle_id', cycleId).eq('user_id', userId).eq('task_type', 'study')

  const rows = blocks ?? []
  const past = rows.filter(r => (r.local_date as string) < today)
  const future = rows.filter(r => (r.local_date as string) >= today && r.execution === 'not_started')
  const missed = past.filter(r => r.execution === 'skipped' || r.execution === 'deferred')

  if (missed.length === 0) return { applied: true, reason: null }

  const minutesPerEffortUnit = 85 // matches SEEDED_MINUTES_PER_EFFORT_UNIT fallback used elsewhere when unobserved
  const remainingEffortToPlace = missed.reduce((s, r) => s + (r.duration_minutes ?? 0), 0) / minutesPerEffortUnit

  const remainingDates = [...new Set(future.map(r => r.local_date as string))].sort()
  const remainingDays = remainingDates.map(date => ({
    date,
    capacityMinutes: 9999, // capacity was already respected when the row was generated; this pass only adds a bounded top-up
    alreadyPlannedContentUnits: future.filter(r => r.local_date === date)
      .reduce((s, r) => s + (r.duration_minutes ?? 0), 0) / minutesPerEffortUnit,
    targetRowDurationMinutes: future.find(r => r.local_date === date)?.duration_minutes ?? 0,
  }))

  const classification = classifyRedistribution({ remainingEffortToPlace, remainingDays, minutesPerEffortUnit })

  if (classification.size === 'big') {
    return { applied: false, reason: 'Absorbing the missed work would overload a remaining day.' }
  }

  const perDayMinutes = Math.round(classification.perDayAddition * minutesPerEffortUnit)
  for (const date of remainingDates) {
    const target = future.find(r => r.local_date === date)
    if (!target) continue
    // Defensive clamp even though classifyRedistribution already checked
    // this fits: a row's duration_minutes or revision can have moved
    // between the classify read above and this write.
    const newDuration = Math.min(180, (target.duration_minutes ?? 0) + perDayMinutes)
    const { error } = await admin.from('plan_blocks')
      .update({ duration_minutes: newDuration })
      .eq('id', target.id).eq('revision', target.revision)
    if (error) return { applied: false, reason: `Could not update the plan: ${error.message}` }
  }

  return { applied: true, reason: null }
}
