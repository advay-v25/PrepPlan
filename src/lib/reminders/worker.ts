import { boundedStage } from '../ops/requestBudget'
import { createAdminClient } from '../supabase/admin'
import { syncReminders } from './service'

const SYNC_BUDGET_MS = 15_000
const SYNC_PARALLEL = 6

export async function syncReminderBatch() {
  const admin = createAdminClient()
  const { data, error } = await boundedStage('claim reminder sync', 4000, () => Promise.resolve(admin.rpc('claim_reminder_sync_batch')))
  if (error) throw error
  if (!data) return { status: 'busy' as const, students: 0, scheduled: 0, retryNextSweep: 0 }
  const { leaseId, userIds } = data as { leaseId: string; userIds: string[] }
  const end = Date.now() + SYNC_BUDGET_MS
  let students = 0, scheduled = 0, retryNextSweep = 0
  try {
    while (students < userIds.length && Date.now() + 100 < end) {
      const group = userIds.slice(students, students + SYNC_PARALLEL)
      const budget = Math.min(4000, end - Date.now())
      const results = await Promise.allSettled(group.map(userId => boundedStage('sync student reminders', budget, () => syncReminders(userId))))
      students += group.length
      for (const result of results) {
        if (result.status === 'fulfilled' && !result.value.unknown) scheduled += result.value.wanted
        else retryNextSweep++
      }
    }
  } finally {
    const last = userIds[students - 1] ?? null
    const { data: finished, error: finishError } = await boundedStage('save reminder cursor', 4000, () => Promise.resolve(
      admin.rpc('finish_reminder_sync_batch', { p_lease_id: leaseId, p_last_user: last }),
    ))
    if (finishError || !finished) throw finishError ?? new Error('Reminder sync lease expired.')
  }
  return { status: 'ok' as const, students, scheduled, retryNextSweep, deferred: userIds.length - students }
}
