import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LearningLogError } from './log'

export const plannedLogSchema = z.object({
  task_id: z.string().min(1).max(180),
  expected_revision: z.number().int().min(1),
  execution: z.enum(['completed', 'partial']),
  duration_minutes: z.number().int().min(1).max(720).nullish(),
  outcome_ids: z.array(z.string().min(1).max(180)).max(40).default([]),
  note: z.string().max(1000).optional(),
  idempotency_key: z.string().regex(/^[A-Za-z0-9_-]{8,60}$/),
})
export type PlannedLogInput = z.infer<typeof plannedLogSchema>

export class PlannedLogError extends LearningLogError {
  constructor(message: string, status: number, code: string, readonly current?: unknown) { super(message, status, code) }
}

/** One owned RPC: minutes, status, explicit coverage and history commit together or not at all. */
export async function recordPlannedLog(db: SupabaseClient, userId: string, entry: PlannedLogInput) {
  const { data, error } = await db.rpc('log_planned_session', {
    p_user_id: userId, p_task_id: entry.task_id, p_expected_revision: entry.expected_revision, p_execution: entry.execution,
    p_minutes: entry.duration_minutes ?? null, p_outcome_ids: entry.outcome_ids, p_note: entry.note?.trim() || null,
    p_idempotency_key: entry.idempotency_key,
  })
  if (error) {
    if (['PGRST202', '42883'].includes(error.code)) throw new PlannedLogError('Logging is temporarily unavailable while a database update is pending. Nothing was saved.', 503, 'MIGRATION_REQUIRED')
    if (error.code === '42501') throw new PlannedLogError('Verify your email and finish setup before logging learning.', 403, 'ACCESS_REQUIRED')
    if (error.code === 'P0002') throw new PlannedLogError('That block was not found.', 404, 'NOT_FOUND')
    if (error.code === '22023') throw new PlannedLogError('Check the block, status, minutes (1–720) and covered outcomes. Nothing was saved.', 400, 'INVALID_INPUT')
    if (error.code === '40001') throw new PlannedLogError('The block changed while saving. Nothing was saved; reload it and try again.', 409, 'REVISION_MISMATCH')
    throw new PlannedLogError('Could not confirm the save. Retry the same log to check safely.', 503, 'SAVE_UNCONFIRMED')
  }
  if (data?.code === 'REVISION_MISMATCH') throw new PlannedLogError('This block changed somewhere else. Reload it before logging.', 409, 'REVISION_MISMATCH', data.current)
  if (data?.code === 'IDEMPOTENCY_CONFLICT') throw new PlannedLogError('This save belongs to a different log. Check Calendar before starting another.', 409, data.code)
  if (['RECORDED_LEARNING', 'CONTINUED', 'HISTORY_CLOSED'].includes(data?.code)) throw new PlannedLogError(data.error, 409, data.code)
  if (!data?.ok || typeof data.taskId !== 'string') throw new PlannedLogError('Could not confirm the save. Retry the same log to check safely.', 503, 'SAVE_UNCONFIRMED')
  return data as {
    ok: true; action: 'planned'; taskId: string; title: string; execution: 'completed' | 'partial'; minutes: number | null; date: string
    revision: number; scope: { state: 'confirmed' | 'time_only'; confirmed: number }; replayed: boolean
  }
}
