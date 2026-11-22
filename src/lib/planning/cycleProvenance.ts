import { createAdminClient } from '../supabase/admin'

/**
 * How an active cycle came to be accepted. An accepted cycle with nothing in it is the student's own plan only if
 * someone accepted it: weekly review writes weekly_reviews.next_cycle_id, onboarding writes plan_drafts.accepted_cycle_id.
 * A cycle with neither is simply unplanned.
 */
export async function cycleAcceptedBy(userId: string, cycleId: string): Promise<'weekly_review' | 'onboarding' | null> {
  const admin = createAdminClient()
  const [review, draft] = await Promise.all([
    admin.from('weekly_reviews').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('next_cycle_id', cycleId),
    admin.from('plan_drafts').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'accepted').eq('accepted_cycle_id', cycleId),
  ])
  if (review.error) throw new Error(`Could not read weekly reviews: ${review.error.message}`)
  if (draft.error) throw new Error(`Could not read plan drafts: ${draft.error.message}`)
  return (review.count ?? 0) > 0 ? 'weekly_review' : (draft.count ?? 0) > 0 ? 'onboarding' : null
}
