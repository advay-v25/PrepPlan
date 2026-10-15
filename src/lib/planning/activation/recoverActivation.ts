import { createAdminClient } from '../../supabase/admin'
import { getStudyWeekContext } from '../schedule'
import { getOrCreateReadyDraft } from './draftService'

/** The existing review-and-accept step. Acceptance stays an explicit, atomic action there. */
export const ACTIVATION_REVIEW_URL = '/onboarding/plan'

export type RecoveryResult =
  | { status: 'onboarding_incomplete'; nextUrl: string }
  | { status: 'already_active'; cycleId: string; plannedTasks: number }
  | { status: 'draft_ready'; draftId: string; revision: number; reused: boolean; taskCount: number; reviewUrl: string }

/**
 * User-triggered activation recovery. Restores the current week's ready draft
 * or regenerates one; never commits tasks. Safe to call repeatedly.
 */
export async function recoverActivation(userId: string): Promise<RecoveryResult> {
  const admin = createAdminClient()
  const { data: profile } = await admin.from('profiles').select('onboarding_status').eq('id', userId).maybeSingle()
  if (profile?.onboarding_status !== 'complete') return { status: 'onboarding_incomplete', nextUrl: '/onboarding' }

  const ctx = await getStudyWeekContext(userId)

  // Already running this week? Then there is nothing to recover — and nothing is written.
  const { data: cycle } = await admin.from('planning_cycles')
    .select('id, ends_at_local').eq('user_id', userId).eq('status', 'active').maybeSingle()
  if (cycle && cycle.ends_at_local === ctx.week.endDate) {
    const { count } = await admin.from('plan_blocks')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('cycle_id', cycle.id)
      .gte('local_date', ctx.week.startDate).lte('local_date', ctx.week.endDate)
      .neq('execution', 'cancelled')
    if ((count ?? 0) > 0) return { status: 'already_active', cycleId: cycle.id as string, plannedTasks: count ?? 0 }
  }

  const draft = await getOrCreateReadyDraft(userId)
  return {
    status: 'draft_ready', draftId: draft.draftId, revision: draft.revision, reused: draft.reused,
    taskCount: draft.tasks.length, reviewUrl: ACTIVATION_REVIEW_URL,
  }
}
