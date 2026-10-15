import { createAdminClient } from '../supabase/admin'
import { getStudyWeekContext } from '../planning/schedule'
import { dailyCapacityMinutes } from '../planning/pulse/capacity'
import { weekdayOf, type Weekday } from '../planning/studyWeek'

/**
 * What changes for the days ahead when a completed student edits their setup.
 *
 * This is deliberately not a rewrite of anything: it only reads. It never touches `plan_blocks`, the active
 * roadmap or any cycle — editing setup must never rewrite committed history (the onboarding spec is explicit
 * about this), so the "impact" is informational, shown once, and acted on afterwards through Calendar's own
 * redistribution the normal way. It also only looks ahead: today and later, never the past.
 */
export type PlanImpact = {
  cycleChanged: boolean
  before: { start: string; end: string; paperDay: Weekday }
  after: { start: string; end: string; paperDay: Weekday }
  /** Sum, over today..cycle end, of (new daily capacity − old daily capacity), in minutes. Negative = less room. */
  capacityDeltaMinutes: number
  /** Days, among those still ahead, where what is already scheduled no longer fits the new capacity. */
  overflowDays: { date: string; scheduledMinutes: number; newCapacityMinutes: number }[]
}

type Snapshot = {
  today: string
  week: { start: string; end: string; paperDay: Weekday; days: string[] }
  timezone: string
  capacityByDate: Record<string, number>
}

/** Everything needed for a before/after comparison, from live data at the moment it is called. */
async function snapshot(userId: string): Promise<Snapshot> {
  const ctx = await getStudyWeekContext(userId)
  const days = ctx.week.days.filter(d => d >= ctx.today)
  const capacityByDate: Record<string, number> = {}
  for (const d of days) capacityByDate[d] = await dailyCapacityMinutes(userId, weekdayOf(d), d, ctx.timezone)
  return { today: ctx.today, week: { start: ctx.week.startDate, end: ctx.week.endDate, paperDay: ctx.week.anchorDay, days }, timezone: ctx.timezone, capacityByDate }
}

/** Minutes already scheduled (not completed or skipped) on each of today's-remaining days in the given week. */
async function scheduledMinutesByDate(userId: string, dates: string[]): Promise<Record<string, number>> {
  if (dates.length === 0) return {}
  const admin = createAdminClient()
  const { data } = await admin.from('plan_blocks')
    .select('local_date, duration_minutes, execution')
    .eq('user_id', userId).in('local_date', dates)
  const out: Record<string, number> = {}
  for (const d of dates) out[d] = 0
  for (const row of data ?? []) {
    if (row.execution === 'completed' || row.execution === 'skipped') continue
    const d = row.local_date as string
    if (d in out) out[d] += Number(row.duration_minutes ?? 0)
  }
  return out
}

function diff(before: Snapshot, after: Snapshot, scheduled: Record<string, number>): PlanImpact {
  const cycleChanged = before.week.start !== after.week.start || before.week.end !== after.week.end || before.week.paperDay !== after.week.paperDay
  let capacityDeltaMinutes = 0
  const overflowDays: PlanImpact['overflowDays'] = []
  for (const d of after.week.days) {
    const oldCap = before.capacityByDate[d] ?? 0
    const newCap = after.capacityByDate[d] ?? 0
    capacityDeltaMinutes += newCap - oldCap
    const used = scheduled[d] ?? 0
    if (used > newCap) overflowDays.push({ date: d, scheduledMinutes: used, newCapacityMinutes: newCap })
  }
  return {
    cycleChanged,
    before: { start: before.week.start, end: before.week.end, paperDay: before.week.paperDay },
    after: { start: after.week.start, end: after.week.end, paperDay: after.week.paperDay },
    capacityDeltaMinutes,
    overflowDays,
  }
}

/**
 * Runs `save` (an onboarding step's own save function) and reports its effect on the days ahead. Read-only
 * around a write it does not control: it snapshots before, lets `save` do its normal atomic write, then
 * snapshots after and diffs. Only meaningful for a student who already has committed days ahead — a student
 * still completing onboarding for the first time has nothing yet to impact.
 */
export async function saveWithPlanImpact(userId: string, save: () => Promise<void>): Promise<PlanImpact | null> {
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('onboarding_status').eq('id', userId).maybeSingle()
  if (profile?.onboarding_status !== 'complete') { await save(); return null }

  const before = await snapshot(userId)
  await save()
  const after = await snapshot(userId)
  const scheduled = await scheduledMinutesByDate(userId, after.week.days)
  return diff(before, after, scheduled)
}
