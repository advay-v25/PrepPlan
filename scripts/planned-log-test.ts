import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plannedLogSchema, recordPlannedLog, PlannedLogError } from '../src/lib/learning/plannedLog'

const input = { task_id: 'task', expected_revision: 3, execution: 'partial' as const, duration_minutes: 25, outcome_ids: ['a'], idempotency_key: 'key-12345678' }
const db = (reply: { data?: any; error?: any }) => ({ async rpc() { return { data: null, error: null, ...reply } } }) as any

test('the schema bounds minutes, status, outcomes and the key', () => {
  assert.equal(plannedLogSchema.safeParse(input).success, true)
  assert.equal(plannedLogSchema.parse({ ...input, outcome_ids: undefined }).outcome_ids.length, 0)
  for (const bad of [{ duration_minutes: 0 }, { duration_minutes: 721 }, { duration_minutes: 2.5 }, { execution: 'skipped' }, { expected_revision: 0 }, { idempotency_key: 'short' }, { outcome_ids: Array(41).fill('a') }]) {
    assert.equal(plannedLogSchema.safeParse({ ...input, ...bad }).success, false, JSON.stringify(bad))
  }
})

test('one RPC carries the exact task, revision, minutes, coverage and key', async () => {
  let args: any
  const receipt = { ok: true, action: 'planned', taskId: 'task', scope: { state: 'confirmed', confirmed: 1 }, replayed: false }
  const r = await recordPlannedLog({ async rpc(n: string, a: any) { assert.equal(n, 'log_planned_session'); args = a; return { data: receipt, error: null } } } as any, 'owner', input)
  assert.deepEqual(args, { p_user_id: 'owner', p_task_id: 'task', p_expected_revision: 3, p_execution: 'partial', p_minutes: 25, p_outcome_ids: ['a'], p_note: null, p_idempotency_key: 'key-12345678' })
  assert.equal(r.scope.state, 'confirmed')
})

test('refusals are specific, and an unknown outcome is never reported as saved', async () => {
  const cases: [any, number, string][] = [
    [{ data: { ok: false, code: 'REVISION_MISMATCH', current: { revision: 5 } } }, 409, 'REVISION_MISMATCH'],
    [{ data: { ok: false, code: 'IDEMPOTENCY_CONFLICT' } }, 409, 'IDEMPOTENCY_CONFLICT'],
    [{ data: { ok: false, code: 'HISTORY_CLOSED', error: 'earlier week' } }, 409, 'HISTORY_CLOSED'],
    [{ data: { ok: false, code: 'CONTINUED', error: 'later week' } }, 409, 'CONTINUED'],
    [{ error: { code: '42501', message: 'x' } }, 403, 'ACCESS_REQUIRED'],
    [{ error: { code: 'P0002', message: 'x' } }, 404, 'NOT_FOUND'],
    [{ error: { code: '22023', message: 'x' } }, 400, 'INVALID_INPUT'],
    [{ error: { code: '40001', message: 'x' } }, 409, 'REVISION_MISMATCH'],
    [{ error: { code: 'PGRST202', message: 'x' } }, 503, 'MIGRATION_REQUIRED'],
    [{ error: { code: '57014', message: 'x' } }, 503, 'SAVE_UNCONFIRMED'],
    [{ data: { ok: true } }, 503, 'SAVE_UNCONFIRMED'],
  ]
  for (const [reply, status, code] of cases) {
    await assert.rejects(recordPlannedLog(db(reply), 'owner', input), (e: any) => e instanceof PlannedLogError && e.status === status && e.code === code, code)
  }
})
