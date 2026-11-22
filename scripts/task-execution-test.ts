import { test } from 'node:test'
import assert from 'node:assert/strict'
import { executeTaskCommand, ExecutionCommandError, RevisionMismatchError } from '../src/lib/planning/executionCommand'

const input = { execution: 'completed' as const, expectedRevision: 1 }

test('one RPC saves the task and history; unknown time is explicitly null', async () => {
  let calls = 0
  const result = await executeTaskCommand({ async rpc(name, args) {
    calls++
    assert.equal(name, 'set_task_execution')
    assert.equal(args.p_actual_duration_minutes, null)
    assert.equal(args.p_user_id, 'owner')
    return { data: { ok: true, task: { id: 'task', revision: 2 }, replayed: false }, error: null }
  } }, 'owner', 'task', input)
  assert.equal(calls, 1)
  assert.equal(result.task.revision, 2)
})

test('invalid minutes and revisions are rejected, never rounded or clamped', async () => {
  const client = { async rpc() { throw Error('Must not call database') } }
  for (const actualDurationMinutes of [-1, 1441, NaN, Infinity, 3.5, '30' as any]) {
    await assert.rejects(executeTaskCommand(client, 'u', 't', { ...input, actualDurationMinutes }), ExecutionCommandError)
  }
  for (const expectedRevision of [0, -1, NaN, 1.5]) {
    await assert.rejects(executeTaskCommand(client, 'u', 't', { ...input, expectedRevision }), ExecutionCommandError)
  }
})

test('a recognised replay is returned for the service to skip repeat side effects', async () => {
  const result = await executeTaskCommand({ async rpc() {
    return { data: { ok: true, replayed: true, task: { revision: 4 } }, error: null }
  } }, 'u', 't', input)
  assert.equal(result.replayed, true)
})

test('revision mismatch carries current state; missing migration has no non-atomic fallback', async () => {
  await assert.rejects(executeTaskCommand({ async rpc() {
    return { data: { code: 'REVISION_MISMATCH', current: { revision: 5 } }, error: null }
  } }, 'u', 't', input), error => error instanceof RevisionMismatchError && error.current.revision === 5)
  for (const code of ['PGRST202', '42883', '23514']) {
    await assert.rejects(executeTaskCommand({ async rpc() {
      return { data: null, error: { code, message: 'internal error should not leak' } }
    } }, 'u', 't', input), error => error instanceof ExecutionCommandError && error.status === 503 && !error.message.includes('internal error'))
  }
  await assert.rejects(executeTaskCommand({ async rpc() {
    throw Error('private transport details')
  } }, 'u', 't', input), error => error instanceof ExecutionCommandError && error.status === 503 && error.code === 'SAVE_UNCONFIRMED' && !error.message.includes('private'))
})
