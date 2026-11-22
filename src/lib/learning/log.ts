import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'

export const learningLogSchema = z.object({
  activity_type: z.enum(['class', 'independent_study', 'external_practice']),
  reading_id: z.string().min(1).max(180),
  outcome_ids: z.array(z.string().min(1).max(180)).min(1).max(40),
  duration_minutes: z.number().int().min(1).max(720).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,60}$/),
})
export type LearningLogInput = z.infer<typeof learningLogSchema>
export class LearningLogError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) { super(message) }
}

/** Both entry points use the same RPC, canonical request and saved receipt. */
export async function recordLearning(db: SupabaseClient, entry: LearningLogInput) {
  const ids = [...new Set(entry.outcome_ids)].sort()
  const kind = entry.activity_type === 'class' ? 'Class' : entry.activity_type === 'external_practice' ? 'Practice' : 'Study'
  const { data, error } = await db.rpc('record_learning_sitting', {
    p_activity_type: entry.activity_type, p_description: entry.note?.trim() || `${kind}: ${ids.length} outcome${ids.length === 1 ? '' : 's'}`,
    p_lm_id: entry.reading_id, p_outcome_ids: ids, p_duration_minutes: entry.duration_minutes ?? null,
    p_local_date: entry.date ?? null, p_idempotency_key: entry.idempotency_key,
  })
  if (error) {
    if (['22023', '22007', '22008'].includes(error.code)) throw new LearningLogError('Check the reading, covered outcomes, date and optional minutes (1–720).', 400, 'INVALID_INPUT')
    if (error.code === '42501') throw new LearningLogError('Verify your email and finish setup before logging learning.', 403, 'ACCESS_REQUIRED')
    throw new LearningLogError('Could not confirm the save. Retry the same log to check safely.', 503, 'SAVE_UNCONFIRMED')
  }
  if (data?.code === 'IDEMPOTENCY_CONFLICT') throw new LearningLogError('This save belongs to a different log. Check Calendar before starting another.', 409, data.code)
  if (data?.code === 'LOG_REMOVED') throw new LearningLogError('This log was removed. Start a new log if you need to record it again.', 409, data.code)
  if (!data?.ok || typeof data.taskId !== 'string') throw new LearningLogError('Could not confirm the save. Retry the same log to check safely.', 503, 'SAVE_UNCONFIRMED')
  return data
}
