import { ExecutionCommandError, RevisionMismatchError } from './executionCommand'
import type { createClient } from '../supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

export async function taskScopeCommand(client: Client, name: 'split_study_task' | 'confirm_task_scope', args: Record<string, unknown>) {
  let response: { data: any; error: any }
  try { response = await client.rpc(name, args) }
  catch { throw new ExecutionCommandError('Could not confirm the change. Refresh before retrying.', 503, 'SAVE_UNCONFIRMED') }
  const { data, error } = response
  if (error) {
    if (error.code === '42501') throw new ExecutionCommandError(error.message, 403, 'ACCESS_REQUIRED')
    if (error.code === 'P0002') throw new ExecutionCommandError('Task not found.', 404, 'NOT_FOUND')
    if (error.code === '22023') throw new ExecutionCommandError(error.message, 400, 'INVALID_INPUT')
    throw new ExecutionCommandError('This change could not be confirmed. Refresh before retrying.', 503, 'SAVE_FAILED')
  }
  if (data?.code === 'REVISION_MISMATCH') throw new RevisionMismatchError(data.current)
  if (!data?.ok) throw new ExecutionCommandError('Could not confirm the change. Refresh before retrying.', 503, 'INVALID_RESPONSE')
  return data
}
