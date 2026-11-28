import assert from 'node:assert/strict'
import { assertRehearsalTarget } from './lib/rehearsalTarget'
const env = {
  E2E_CONFIRMED_DISPOSABLE_PROJECT_REF: 'mnlezctdqkdfgvmipmcj', NEXT_PUBLIC_SUPABASE_URL: 'https://mnlezctdqkdfgvmipmcj.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-only', HEALTHCHECK_SECRET: 'test-only',
}
let requests = 0
const send: typeof fetch = async (url, init) => {
  requests++
  assert.equal(new URL(String(url)).pathname, '/api/health')
  assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-only')
  return Response.json({ ok: true, databaseOrigin: env.NEXT_PUBLIC_SUPABASE_URL })
}
await assertRehearsalTarget(env, 'http://localhost:3141', send)
assert.equal(requests, 1)
for (const change of [
  { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' }, { E2E_CONFIRMED_DISPOSABLE_PROJECT_REF: 'other' },
  { SUPABASE_SECRET_KEY: '' }, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '' }, { HEALTHCHECK_SECRET: '' },
]) await assert.rejects(assertRehearsalTarget({ ...env, ...change }, 'http://localhost:3141', send))
assert.equal(requests, 1, 'invalid configuration must fail before any network request')
await assert.rejects(assertRehearsalTarget(env, 'http://localhost:3141', async () => Response.json({ ok: true, databaseOrigin: 'https://other.invalid' })))
await assert.rejects(assertRehearsalTarget(env, 'http://localhost:3141', async () => Response.json({ ok: false }, { status: 503 })))
await assertRehearsalTarget({ ...env, SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'alias', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: '', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'alias' }, 'http://localhost:3141', send)
console.log('PASS rehearsal target: app/runner binding, missing keys, aliases, readiness failure, wrong project')
const proxy = 'http://127.0.0.1:4144'
const proxySend: typeof fetch = async url => new URL(String(url)).pathname === '/api/health'
  ? Response.json({ ok: true, databaseOrigin: proxy })
  : Response.json({ role: 'private-disposable-proxy', targetOrigin: env.NEXT_PUBLIC_SUPABASE_URL })
await assert.rejects(assertRehearsalTarget(env, 'http://localhost:3141', proxySend))
await assertRehearsalTarget({ ...env, E2E_PRIVATE_PROXY_ORIGIN: proxy }, 'http://localhost:3141', proxySend)
for (const bad of ['https://remote.invalid', 'http://localhost:4144', 'http://127.0.0.1:4144/path']) {
  await assert.rejects(assertRehearsalTarget({ ...env, E2E_PRIVATE_PROXY_ORIGIN: bad }, 'http://localhost:3141', proxySend))
}
await assert.rejects(assertRehearsalTarget({ ...env, E2E_PRIVATE_PROXY_ORIGIN: proxy }, 'http://localhost:3141', async url =>
  new URL(String(url)).pathname === '/api/health' ? Response.json({ ok: true, databaseOrigin: proxy }) : Response.json({ role: 'private-disposable-proxy', targetOrigin: 'https://wrong.supabase.co' })))
console.log('PASS explicit private loopback proxy identity; implicit, remote and wrong-target proxies refused')
