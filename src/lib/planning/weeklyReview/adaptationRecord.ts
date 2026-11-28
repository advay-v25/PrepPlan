import type { WeekAdaptation } from '../pulse/generateWeek'
import { activeCycleRow, openingReviewRecap } from '../../ops/sharedReads'

/** What the accepted week rested on, as saved with the review that opened it. Every page reads this; none recomputes it. */
export type AdaptationRecord = {
  headline: string
  reasons: string[]
  mode: string
  lighter: boolean
  optionalMinutes: number
  waiting: number
  waitingWork?: WeekAdaptation['waiting']
  ahead: string | null
}

export async function getCurrentAdaptation(userId: string): Promise<AdaptationRecord | null> {
  const cycle = await activeCycleRow(userId)
  if (!cycle) return null
  const a = (await openingReviewRecap(userId, cycle.id as string) as { adaptation?: Partial<AdaptationRecord> & { headline?: string } } | null)?.adaptation
  if (!a?.headline || !Array.isArray(a.reasons)) return null   // a week opened before this was recorded makes no claim
  return { headline: a.headline, reasons: a.reasons, mode: String(a.mode ?? ''), lighter: a.lighter === true, optionalMinutes: Number(a.optionalMinutes ?? 0), waiting: Number(a.waiting ?? 0), waitingWork: a.waitingWork, ahead: a.ahead ?? null }
}
