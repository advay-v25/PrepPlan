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
  const { data, error } = await admin.from('plan_blocks')
    .select('local_date, duration_minutes, execution')
    .eq('user_id', userId).in('local_date', dates)
  if (error) throw new Error(`scheduled minutes unreadable: ${error.message}`)   // never an authoritative "nothing scheduled"
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
/** `{ unavailable: true }`: the setup COMMITTED but its impact could not be read afterwards. That is "saved, impact unavailable", never a failed save. */
export type ImpactUnavailable = { unavailable: true }
export async function saveWithPlanImpact(userId: string, save: () => Promise<void>, receipt: { version?: number } = {}): Promise<PlanImpact | ImpactUnavailable | null> {
  const admin = createAdminClient()
  const version = async () => { const r = await admin.from('profiles').select('onboarding_context_version').eq('id', userId).maybeSingle(); if (r.error) throw new Error(r.error.message); return Number(r.data?.onboarding_context_version ?? NaN) }
  const { data: profile } = await admin.from('profiles').select('onboarding_status').eq('id', userId).maybeSingle()
  if (profile?.onboarding_status !== 'complete') { await save(); return null }
  // An accepted week with nothing planned has no committed days for a change to disturb: saving study times is just setup,
  // and the student goes straight back to Calendar, where a plan can be reviewed.
  const planned = await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('cancelled_at', null).is('learning_activity_id', null).neq('execution', 'cancelled')
  if (!planned.error && !planned.count) { await save(); return null }

  // The comparison is BOUND to this save's version: the before-snapshot must belong to the version just before the commit, and the after-snapshot to the committed one.
  // Another edit in between (before the commit or after it) makes this save's "impact" someone else's, so it is reported unavailable rather than misattributed.
  let before: Snapshot | null = null, v0 = NaN
  try { if (!planned.error) { v0 = await version(); before = await snapshot(userId) } } catch (e) { console.error('[setup] impact read before save failed', (e as Error).message); before = null }
  await save()
  try {
    if (!before) return { unavailable: true }
    const committed = receipt.version
    if (committed === undefined || v0 !== committed - 1) return { unavailable: true }   // an edit landed between the read and this commit
    const after = await snapshot(userId)
    const scheduled = await scheduledMinutesByDate(userId, after.week.days)
    if ((await version()) !== committed) return { unavailable: true }                    // an edit landed after this commit
    return diff(before, after, scheduled)
  } catch (e) { console.error('[setup] impact read after commit failed', (e as Error).message); return { unavailable: true } }
}
