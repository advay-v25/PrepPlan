import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requireApplicationAccess as gate, type AccessClient } from '../src/lib/auth/applicationAccess'
const requireApplicationAccess = (c: AccessClient) => gate(c, async () => true)   // admission is tested separately below

function client(options: { user?: any; status?: string | null; profileError?: boolean; authError?: any } = {}) {
  return {
    auth: { async getUser() { return { data: { user: options.user === undefined ? { id: 'owner', email_confirmed_at: '2026-10-28' } : options.user }, error: options.authError ?? null } } },
    from(table: string) {
      assert.equal(table, 'profiles')
      return { select(columns: string) {
        assert.equal(columns, 'onboarding_status')
        return { eq(column: string, id: string) {
          assert.equal(column, 'id'); assert.equal(id, 'owner')
          return { async maybeSingle() { return { data: options.status === null ? null : { onboarding_status: options.status ?? 'complete' }, error: options.profileError ? Error('database unavailable') : null } } }
        } }
      } }
    },
  } as unknown as AccessClient
}

test('verified user with completed setup enters the app API', async () => {
  const result = await requireApplicationAccess(client())
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.user.id, 'owner')
})

test('signed-out and unverified users receive distinct recovery links', async () => {
  for (const [user, status, next] of [[null, 401, '/login'], [{ id: 'owner' }, 403, '/check-email']] as const) {
    const result = await requireApplicationAccess(client({ user }))
    assert.equal(result.ok, false)
    if (!result.ok) { assert.equal(result.response.status, status); assert.equal((await result.response.json()).nextUrl, next) }
  }
})

test('all incomplete setup states return onboarding, never task data', async () => {
  for (const status of [null, 'not_started', 'in_progress', 'review_ready']) {
    const result = await requireApplicationAccess(client({ status }))
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.response.status, 403)
      assert.equal((await result.response.json()).code, 'ONBOARDING_REQUIRED')
    }
  }
})

test('service failures stay unavailable rather than pretending setup is missing', async () => {
  for (const c of [client({ profileError: true }), client({ authError: { status: 503 } })]) {
    const result = await requireApplicationAccess(c)
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.response.status, 503)
      assert.equal((await result.response.json()).nextUrl, undefined)
    }
  }
})

test('a verified account with no beta invitation is refused with where to go, before any setup data is read', async () => {
  const result = await gate(client(), async () => false)
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.response.status, 403); const b = await result.response.json(); assert.equal(b.code, 'NOT_ADMITTED'); assert.equal(b.nextUrl, '/not-invited') }
})

test('an application failure returns a support reference and safe text', async () => {
  const { routeFailure } = await import('../src/lib/ops/routeFailure')
  const response = routeFailure('test.read', 'Could not load the section.', { code: 'XX000', message: 'private database fixture detail' }, 503)
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.error, 'Could not load the section.')
  assert.match(body.requestId, /^[a-f0-9-]{36}$/)
  assert.doesNotMatch(JSON.stringify(body), /XX000|private database fixture detail/)
})
