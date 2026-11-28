import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { DEFAULT_ESTIMATES, parseEstimates, type MockEstimates } from '../exam/mockTransition'
import type { ForecastDay, Reserved } from '../exam/runwayForecast'
import { freeRangesForDates } from './pulse/capacity'
import { busyFromTimed, gapsAfterAccepted, gapsFromRanges } from './pulse/gaps'
import { permitsStudyPortions } from './pulse/weekBoundary'
import { addDays, daysBetween, weekdayOf } from './studyWeek'

/**
 * The study time really usable in a stretch of future days, on Calendar's terms: availability less protected commitments and timed mock bookings, less
 * accepted work (timed work holds its hours, untimed work packs into the gaps), on study days only. The mock forecast and the catch-up status both read
 * this, so they cannot disagree about capacity.
 */
export async function usableDays(userId: string, o: { from: string; end: string; today: string; now: Date; timezone: string; route: string; horizon: string; excludeCycleId?: string }) {
  const dates = Array.from({ length: Math.max(0, Math.min(366, daysBetween(o.from, o.end) + 1)) }, (_, i) => addDays(o.from, i))
    .filter(d => d >= o.today && d <= o.horizon && permitsStudyPortions(o.route as 'self_study' | 'coaching' | 'hybrid', weekdayOf(d)))
  if (!dates.length) return { days: [] as ForecastDay[], accepted: [] as Accepted[], mocks: [] as string[] }
  const [free, rows] = await Promise.all([
    freeRangesForDates(userId, dates, o.timezone, o.now),
    readAll<Accepted & { cycle_id: string | null }>((a, z) => createAdminClient().from('plan_blocks').select('id, cycle_id, title, local_date, starts_at, duration_minutes, placement, execution')
      .eq('user_id', userId).is('cancelled_at', null).gte('local_date', o.from).lte('local_date', o.end).order('id').range(a, z)),
  ])
  const accepted = rows.filter(b => !o.excludeCycleId || b.cycle_id !== o.excludeCycleId)
  const open = accepted.filter(b => !['completed', 'skipped', 'deferred', 'cancelled'].includes(b.execution))
  const timed = busyFromTimed(open.filter(b => b.placement === 'timed' && b.starts_at) as { local_date: string; starts_at: string; duration_minutes: number | null }[], o.timezone)
  const flexible: Record<string, number[]> = {}
  for (const b of open) if (!(b.placement === 'timed' && b.starts_at)) (flexible[b.local_date] ??= []).push(Number(b.duration_minutes ?? 30))
  const days: ForecastDay[] = dates.map(date => ({ date, week: Math.floor(daysBetween(o.from, date) / 7) + 1, gaps: gapsAfterAccepted(gapsFromRanges(free.ranges[date] ?? []), timed[date] ?? [], flexible[date] ?? []) }))
  return { days, accepted, mocks: free.mocks.map(m => m.date).filter(d => d >= o.from && d <= o.end) }
}
export type Accepted = { title: string; local_date: string; starts_at: string | null; duration_minutes: number | null; placement: string; execution: string }

/** A booked mock's debrief and follow-up need time on later days, unless they are already accepted work. */
export function bookedMockDemands(mocks: string[], accepted: Accepted[], estimates: MockEstimates): Reserved[] {
  return mocks.flatMap(date => ([['Debrief the mock', estimates.debrief], ['Follow up on what the mock found', estimates.followUp]] as const)
    .filter(([title]) => !accepted.some(b => b.local_date > date && b.title.startsWith(title)))
    .map(([title, minutes]) => ({ title: `${title} (booked mock ${date})`, minutes, notBefore: addDays(date, 1) })))
    .sort((a, b) => a.notBefore.localeCompare(b.notBefore))
}

/** The estimates saved with the latest accepted proposal that carried any; the defaults before that. */
export async function savedEstimates(userId: string): Promise<MockEstimates> {
  const { data } = await createAdminClient().from('weekly_reviews').select('recap').eq('user_id', userId).order('created_at', { ascending: false }).limit(8).throwOnError()
  for (const r of data ?? []) { const e = parseEstimates((r.recap as { mock?: { estimates?: unknown } } | null)?.mock?.estimates); if (e) return e }
  return DEFAULT_ESTIMATES
}
