import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { perRequest } from '../ops/perRequest'

const loggedEvents = perRequest((userId: string) => readAll<{ task_id: string; actual_duration_minutes: number }>((a, z) => createAdminClient().from('task_events').select('id,task_id,actual_duration_minutes')
  .eq('user_id', userId).not('actual_duration_minutes', 'is', null).order('id').range(a, z)), (userId: string) => userId)

/** Minutes actually logged per task, from its own history. A task with no reported minutes is absent, never zero. One read for any number of tasks. */
export async function loggedMinutesByTask(userId: string, taskIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!taskIds.length) return out
  const wanted = new Set(taskIds)
  for (const e of await loggedEvents(userId)) if (wanted.has(e.task_id)) out.set(e.task_id, (out.get(e.task_id) ?? 0) + Number(e.actual_duration_minutes))
  return out
}
