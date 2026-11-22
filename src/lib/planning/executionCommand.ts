/** Kept independent of Next and admin clients so failure/retry behaviour can be tested. */
export type ExecutionInput = {
  execution: 'not_started' | 'in_progress' | 'partial' | 'completed' | 'skipped' | 'deferred'
  expectedRevision: number
  actualDurationMinutes?: number
  note?: string
}

export class RevisionMismatchError extends Error {
  constructor(readonly current: any) {
    super('This task changed somewhere else while you were editing it.')
    this.name = 'RevisionMismatchError'
  }
}

export class ExecutionCommandError extends Error {
  constructor(message: string, readonly status: number, readonly code: string, readonly nextUrl?: string) {
    super(message)
    this.name = 'ExecutionCommandError'
  }
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: any; error: { code?: string; message: string } | null
  }>
}

export async function executeTaskCommand(client: RpcClient, userId: string, taskId: string, input: ExecutionInput) {
  const executions = ['not_started', 'in_progress', 'partial', 'completed', 'skipped', 'deferred']
  if (!executions.includes(input.execution) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1
    || (input.actualDurationMinutes !== undefined && (!Number.isInteger(input.actualDurationMinutes) || input.actualDurationMinutes < 0 || input.actualDurationMinutes > 1440))
    || (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 2000))) {
    throw new ExecutionCommandError('Check the task state, revision and actual minutes (0–1440 whole minutes).', 400, 'INVALID_INPUT')
  }
  let response: Awaited<ReturnType<RpcClient['rpc']>>
  try {
    response = await client.rpc('set_task_execution', {
      p_user_id: userId, p_task_id: taskId, p_expected_revision: input.expectedRevision,
      p_execution: input.execution, p_actual_duration_minutes: input.actualDurationMinutes ?? null, p_note: input.note ?? null,
    })
  } catch {
    // A lost response is not proof of rollback. Retrying the identical revision
    // and payload is safe, but do not claim the task was definitely unchanged.
    throw new ExecutionCommandError('Could not confirm the saved state. Refresh the task before retrying.', 503, 'SAVE_UNCONFIRMED')
  }
  const { data, error } = response
  if (error) {
    if (['PGRST202', '42883'].includes(error.code ?? '')) {
      throw new ExecutionCommandError('Task saving is temporarily unavailable while the database update is pending. Your change was not saved.', 503, 'MIGRATION_REQUIRED')
    }
    if (error.code === '42501') throw new ExecutionCommandError(error.message, 403, 'ACCESS_REQUIRED')
    if (error.code === 'P0002') throw new ExecutionCommandError('Task not found.', 404, 'NOT_FOUND')
    if (error.code === '22023' && /SYSTEM_ASSESSMENT/.test(error.message)) throw new ExecutionCommandError(error.message.replace(/^SYSTEM_ASSESSMENT:\s*/, '').replace(/^a /, 'A ') + '. Start or resume it from Tests.', 409, 'SYSTEM_ASSESSMENT')
    if (error.code === '22023') throw new ExecutionCommandError(error.message, 400, 'INVALID_INPUT')
    throw new ExecutionCommandError('Could not confirm the saved state. Refresh the task before retrying.', 503, 'SAVE_FAILED')
  }
  if (data?.code === 'REVISION_MISMATCH') throw new RevisionMismatchError(data.current)
  if (!data?.ok || !data.task || typeof data.replayed !== 'boolean') {
    throw new ExecutionCommandError('Could not confirm the saved state. Refresh the task before retrying.', 503, 'INVALID_RESPONSE')
  }
  return { task: data.task, replayed: data.replayed as boolean }
}
