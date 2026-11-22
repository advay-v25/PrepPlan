import { createAdminClient } from '../../supabase/admin'

/** What the accepted week rested on, as saved with the review that opened it. Every page reads this; none recomputes it. */
export type AdaptationRecord = {
  headline: string
  reasons: string[]
  mode: string
  lighter: boolean
  optionalMinutes: number
  waiting: number
  ahead: string | null
}

export async function getCurrentAdaptation(userId: string): Promise<AdaptationRecord | null> {
  const admin = createAdminClient()
  const { data: cycle } = await admin.from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (!cycle) return null
  const { data } = await admin.from('weekly_reviews').select('recap').eq('user_id', userId).eq('next_cycle_id', cycle.id as string).maybeSingle()
  const a = (data?.recap as { adaptation?: Partial<AdaptationRecord> & { headline?: string } } | null)?.adaptation
  if (!a?.headline || !Array.isArray(a.reasons)) return null   // a week opened before this was recorded makes no claim
  return { headline: a.headline, reasons: a.reasons, mode: String(a.mode ?? ''), lighter: a.lighter === true, optionalMinutes: Number(a.optionalMinutes ?? 0), waiting: Number(a.waiting ?? 0), ahead: a.ahead ?? null }
}
