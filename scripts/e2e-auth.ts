/** Disposable-project proof of the app's actual auth commands. Admin-generated links never send an email. */
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { createSession } from './lib/e2eSession'
import { E2E_BASE_URL } from './lib/e2eIdentity'
import { makeRecoveryIntent } from '../src/lib/auth/securityServer'

config({ path: '.env.local', quiet: true })
const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
const app = new URL(E2E_BASE_URL)
if (project.hostname !== 'mnlezctdqkdfgvmipmcj.supabase.co' || !['localhost', '127.0.0.1'].includes(app.hostname)
  || process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production') {
  throw new Error('Use the confirmed disposable project and a local PrepPlan server.')
}

const admin = createClient(project.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const owned = new Set<string>()
const stamp = crypto.randomUUID().slice(0, 12)
const initial = 'Original fixture passphrase 101'
const replacement = 'Reset fixture passphrase 342'
const json = { 'Content-Type': 'application/json' }
let passes = 0
function check(name: string, value: unknown) {
  assert.ok(value, name)
  console.log('  pass ' + name)
  passes++
}

async function fixture(tag: string, confirmed: boolean) {
  const email = 'security+' + tag + '-' + stamp + '@example.com'
  const { data, error } = await admin.auth.admin.createUser({ email, password: initial, email_confirm: confirmed })
  if (error || !data.user) throw new Error('Could not create an owned auth fixture.')
  owned.add(data.user.id)
  return { id: data.user.id, email, session: createSession(admin, email) }
}

async function generated(type: 'signup' | 'recovery' | 'magiclink', email: string) {
  const { data, error } = await admin.auth.admin.generateLink(type === 'signup' ? { type, email, password: initial } : { type, email })
  if (error || !data.properties?.hashed_token) throw new Error('Could not generate an owned email-link fixture.')
  return data.properties.hashed_token
}

async function main() {
  const student = await fixture('signup', false)
  const anonymous = createSession(admin, 'nobody@example.com')
  const locked = await anonymous.req('/app/calendar?week=2027-01-04')
  check('signed-out Calendar preserves its in-app return path', locked.status === 307
    && new URL(locked.headers.get('location')!, app).searchParams.get('next') === '/app/calendar?week=2027-01-04')

  const wrong = await anonymous.post('/api/auth', { action: 'login', email: student.email, password: 'A wrong passphrase' })
  const unverified = await anonymous.post('/api/auth', { action: 'login', email: student.email, password: initial })
  check('wrong credentials and unverified email have the same outward response', wrong.status === 401 && unverified.status === 401
    && JSON.stringify(wrong.body) === JSON.stringify(unverified.body))

  const signup = await generated('signup', student.email)
  const showedLink = await student.session.req('/auth/confirm?' + new URLSearchParams({ token_hash: signup, type: 'signup' }))
  check('reading an older link only opens the confirmation screen', showedLink.status === 307
    && new URL(showedLink.headers.get('location')!, app).pathname === '/auth/verify' && !showedLink.headers.has('set-cookie'))
  check('link preview did not confirm the account', !(await admin.auth.admin.getUserById(student.id)).data.user?.email_confirmed_at)
  const confirmation = await student.session.post('/api/auth', { action: 'verify', type: 'signup', tokenHash: signup })
  check('explicit confirmation creates a session and sends signup to setup', confirmation.status === 200 && confirmation.body?.next === '/onboarding'
    && !!(await admin.auth.admin.getUserById(student.id)).data.user?.email_confirmed_at)
  check('a confirmation link is single-use', (await anonymous.post('/api/auth', { action: 'verify', type: 'signup', tokenHash: signup })).status === 400)
  const noRecovery = await student.session.req('/update-password')
  check('ordinary session reaches the recovery request screen', noRecovery.status === 307 && noRecovery.headers.get('location') === '/forgot-password')
  check('ordinary session cannot update via recovery', (await student.session.post('/api/auth', { action: 'update', password: replacement })).status === 403)
  check('the account page is available before completing setup', (await student.session.req('/account')).status === 200)
  check('the retired reservation makes no attempt', (await student.session.post('/api/diagnostic/attempt')).status === 410)
  check('Tests start still requires completed setup', (await student.session.post('/api/tests/start', { kind: 'weekly' })).status === 403)

  const login = await student.session.post('/api/auth', { action: 'login', email: student.email, password: initial, next: '/account' })
  check('the existing password still works and returns to the account page', login.status === 200 && login.body?.next === '/account')
  const originDenied = await student.session.req('/api/auth', {
    method: 'POST', headers: { ...json, Origin: 'https://unrelated.example', 'Sec-Fetch-Site': 'cross-site' },
    body: JSON.stringify({ action: 'signout' }),
  })
  check('an off-site browser request is rejected and does not sign out the student', originDenied.status === 403 && (await student.session.req('/account')).status === 200)

  const reset = await generated('recovery', student.email)
  check('an email link without a PrepPlan recovery intent cannot use the reset form', (await anonymous.post('/api/auth', {
    action: 'verify', type: 'recovery', tokenHash: reset,
  })).status === 400)
  const recovery = createSession(admin, student.email)
  const opened = await recovery.post('/api/auth', {
    action: 'verify', type: 'recovery', tokenHash: reset, intent: makeRecoveryIntent(student.email),
  })
  check('a provider-verified link with the matching intent opens recovery', opened.status === 200 && opened.body?.next === '/update-password')
  check('the recovery form can render and refresh', (await recovery.req('/update-password')).status === 200 && (await recovery.req('/update-password')).status === 200)
  check('a second session on the same account does not inherit the recovery proof', (await student.session.post('/api/auth', { action: 'update', password: replacement })).status === 403)
  const two = await Promise.all([1, 2].map(() => recovery.post('/api/auth', { action: 'update', password: replacement })))
  check('two simultaneous submissions use the proof exactly once', two.filter(response => response.status === 200).length === 1 && two.filter(response => response.status === 403).length === 1)
  check('the old password stops working', (await recovery.post('/api/auth', { action: 'login', email: student.email, password: initial })).status === 401)
  check('the new password works and cannot reuse recovery', (await recovery.post('/api/auth', { action: 'login', email: student.email, password: replacement })).status === 200
    && (await recovery.post('/api/auth', { action: 'update', password: initial })).status === 403)

  const addressBound = await fixture('address', true)
  const mismatch = await generated('recovery', addressBound.email)
  const mismatched = await addressBound.session.post('/api/auth', { action: 'verify', type: 'recovery', tokenHash: mismatch, intent: makeRecoveryIntent(student.email) })
  check('a recovery intent is bound to the email it was sent for', mismatched.status === 400 && (await addressBound.session.req('/account')).status === 307)

  const second = createSession(admin, student.email)
  check('a separate device can sign in', (await second.post('/api/auth', { action: 'login', email: student.email, password: replacement })).status === 200)
  check('normal sign-out clears just this browser', (await second.post('/api/auth', { action: 'signout' })).status === 200
    && (await second.req('/account')).status === 307 && (await recovery.req('/account')).status === 200)
  const deletion = await recovery.post('/api/account/delete', { confirmEmail: student.email })
  check('recent sign-in still allows deliberate deletion before setup', deletion.status === 200
    && !(await admin.auth.admin.getUserById(student.id)).data.user && (await recovery.req('/account')).status === 307)

  const health = await anonymous.json('/api/health')
  check('public liveness reveals only whether PrepPlan is running', health.status === 200 && JSON.stringify(health.body) === '{"ok":true}')
  check('readiness requires its dedicated credential', (await anonymous.json('/api/health?ready=1')).status === 401)
  check('reminder worker requires its own credential', (await anonymous.post('/api/reminders/run')).status === 401)
  const oversized = await anonymous.req('/api/auth', { method: 'POST', headers: json, body: JSON.stringify({ action: 'signout', extra: 'a'.repeat(13_000) }) })
  check('oversized auth bodies are refused before signing in', oversized.status === 413)
  check('signup consent is validated without contacting the email provider', (await anonymous.post('/api/auth', {
    action: 'signup', name: 'Fixture', email: addressBound.email, password: initial, accepted: false,
  })).status === 400)
}

main().catch(error => {
  console.error('Auth suite stopped:', error instanceof Error ? error.message : 'unexpected failure')
  process.exitCode = 1
}).finally(async () => {
  for (const id of owned) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error && error.status !== 404) { console.error('Could not remove an owned authentication fixture.'); process.exitCode = 1 }
  }
  console.log(passes + ' auth checks passed')
})
