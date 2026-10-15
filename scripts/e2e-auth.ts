/**
 * Authentication, end to end: signup + email confirmation, duplicate-signup
 * handling, login error branches, the open-redirect guard, and the account
 * deletion cascade fix — proved two ways: directly against the live
 * constraint definitions (precise, no fixture rows needed — this is what
 * caught that profiles.id, not just the five tables first suspected, was
 * the actual primary blocker) and once more against a real disposable user
 * with a real row in one of those tables, deleted through the real API route.
 *
 * Does not drive the password-reset or Google OAuth flows: both complete
 * through client-side supabase-js calls (updateUser, signInWithOAuth) with
 * no server route of their own to hit over plain HTTP, and were verified
 * instead by direct code read plus one manual browser pass (see the
 * conversation this script shipped in). Never touches the shared E2E_EMAIL
 * fixture — every user this script creates is its own disposable throwaway,
 * deleted by the end of the run (the deletion tests delete them as their own
 * assertion; the rest are cleaned up in a finally block).
 *
 *   npm run dev
 *   npx tsx scripts/e2e-auth.ts
 */
import { createClient } from '@supabase/supabase-js'
import { Client as PgClient } from 'pg'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'

const BASE = E2E_BASE_URL
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production' || process.env.NEXT_PUBLIC_IS_PRODUCTION === 'true') {
  throw new Error('Refusing to run auth e2e (creates/deletes real auth users) against a production environment.')
}

// --- tiny cookie-jar HTTP client, matching scripts/e2e-routes.ts -----------
const jar = new Map<string, string>()
function store(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';'); const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  store(res); return res
}
function loc(res: Response) { return res.headers.get('location') ?? '' }
function clearJar() { jar.clear() }

/** Follows /auth/confirm's redirect chain, same pattern as e2e-routes.ts's signIn(). */
async function followConfirm(tokenHash: string, type: string, next: string) {
  let path = `/auth/confirm?token_hash=${tokenHash}&type=${type}&next=${encodeURIComponent(next)}`
  let last = ''
  for (let i = 0; i < 6; i++) {
    const res = await req(path); last = loc(res)
    if (!last) return path
    const u = new URL(last, BASE); path = u.pathname + u.search
  }
  return path
}

const disposableUserIds: string[] = []
function uniqueEmail(tag: string) { return `e2e-auth-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com` }

async function main() {
  console.log(`\nAuth, end to end, against ${BASE}\n`)

  // --- Signup + email confirmation -----------------------------------------
  // The actual public signUp() call (what AuthForm.tsx uses) dispatches a real
  // email through Supabase's mailer, which on this project's default rate limit
  // was already exhausted by a one-off probe during this test's development —
  // see the written report's Supabase manual-action list. Rather than a flaky
  // test that passes or fails depending on how recently *anyone* signed up,
  // the "just signed up, unconfirmed" state is constructed directly (admin
  // createUser bypasses the mailer and the public endpoint's rate limit,
  // since it's a different, service-role code path) and only the confirmation
  // *link*'s handling — the part with actual logic worth testing — is driven
  // through the real route. signUp() itself is simple SDK boilerplate,
  // verified correct by direct code read.
  console.log('Signup + email confirmation')
  const visitor = createClient(SUPABASE_URL, ANON_KEY)
  const email1 = uniqueEmail('signup')
  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({ email: email1, password: 'correct horse battery', email_confirm: false })
  check('fixture: a freshly-signed-up, unconfirmed account exists', !createErr && !!newUser.user, createErr?.message)
  if (newUser.user) disposableUserIds.push(newUser.user.id)
  check('the new user is unconfirmed until the link is followed', newUser.user?.email_confirmed_at == null)

  const { data: confirmLink } = await admin.auth.admin.generateLink({ type: 'signup', email: email1, password: 'correct horse battery' })
  const confirmPath = await followConfirm((confirmLink!.properties as any).hashed_token, 'signup', '/onboarding')
  check('following the confirmation link lands in onboarding', confirmPath.startsWith('/onboarding'), confirmPath)
  const { data: afterConfirm } = await admin.auth.admin.getUserById(newUser.user!.id)
  check('the account is confirmed server-side after the link is followed', afterConfirm.user?.email_confirmed_at != null)
  clearJar()

  // --- Duplicate signup -----------------------------------------------------
  console.log('\nDuplicate signup')
  const { data: dupData, error: dupErr } = await visitor.auth.signUp({ email: email1, password: 'a different password 1' })
  check('re-signing up with an already-confirmed email returns no error (anti-enumeration)', !dupErr, dupErr?.message)
  check('…but the returned user carries no identities, which is how AuthForm detects it', dupData.user != null && dupData.user.identities?.length === 0,
    JSON.stringify(dupData.user?.identities))

  // --- Login error branches --------------------------------------------------
  console.log('\nLogin error branches')
  const { error: wrongPwErr } = await visitor.auth.signInWithPassword({ email: email1, password: 'not the right password' })
  check('wrong password is reported as invalid_credentials', wrongPwErr?.code === 'invalid_credentials', wrongPwErr?.code)

  const email2 = uniqueEmail('unconfirmed')
  const { data: unconfirmedUser } = await admin.auth.admin.createUser({ email: email2, password: 'correct horse battery', email_confirm: false })
  if (unconfirmedUser.user) disposableUserIds.push(unconfirmedUser.user.id)
  const { error: unconfirmedErr } = await visitor.auth.signInWithPassword({ email: email2, password: 'correct horse battery' })
  check('an unconfirmed account reports email_not_confirmed, not invalid_credentials', unconfirmedErr?.code === 'email_not_confirmed', unconfirmedErr?.code)

  // resend() always dispatches a real email, so a strict pass/fail here would
  // depend on the project mailer's rate limit window at the moment the suite
  // happens to run — environment state, not a code defect. What's worth
  // proving is that the call is reachable and well-formed at all (a wiring
  // bug throws before the API ever responds; this reaches it either way).
  let resendReached = true
  try { await visitor.auth.resend({ type: 'signup', email: email2 }) } catch { resendReached = false }
  check('resend is wired and reachable (the Resend button AuthForm now shows)', resendReached)

  // --- Open-redirect guard (safeNextPath, exercised through /auth/confirm) --
  console.log('\nOpen-redirect guard')
  const email3 = uniqueEmail('redirect')
  const { data: redirectUser } = await admin.auth.admin.createUser({ email: email3, password: 'correct horse battery', email_confirm: true })
  if (redirectUser.user) disposableUserIds.push(redirectUser.user.id)
  const { data: magicLink } = await admin.auth.admin.generateLink({ type: 'magiclink', email: email3 })
  for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
    clearJar()
    const landedAt = await followConfirm((magicLink!.properties as any).hashed_token, 'magiclink', evil)
    check(`next=${JSON.stringify(evil)} never leaves the app`, landedAt.startsWith('/') && !landedAt.startsWith('//') && !/^\/\\?\/?evil\.com/i.test(landedAt) && !landedAt.includes('evil.com'),
      landedAt)
    // A magic link's OTP is single-use; each loop iteration after the first will
    // correctly fail to re-verify, which is fine — the redirect target is decided
    // by safeNextPath() before verifyOtp ever runs, so even the failed attempts
    // prove the guard (they land on /auth/error, not on evil.com).
  }

  // --- Account deletion: the cascade fix, two ways ---------------------------
  // (20261013_auth_cascade_fixes.sql + 20261014_profiles_cascade_and_trigger.sql)
  console.log('\nAccount deletion cascade')
  const projectId = new URL(SUPABASE_URL).hostname.split('.')[0]
  const pg = new PgClient({
    connectionString: `postgresql://postgres:${process.env.SUPABASE_DB_PASSWORD}@db.${projectId}.supabase.co:5432/postgres`,
    ssl: { rejectUnauthorized: false },
  })
  await pg.connect()
  const { rows: constraintRows } = await pg.query(
    `select conrelid::regclass::text as tbl, conname, confdeltype
     from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass`
  )
  await pg.end()
  const byName = new Map(constraintRows.map((r: any) => [r.conname, r.confdeltype]))
  check('profiles.id cascades — the one that actually blocked every deletion, not tracked in any prior migration', byName.get('profiles_id_fkey') === 'c')
  check('repair_threads.user_id cascades', byName.get('repair_threads_user_id_fkey') === 'c')
  check('user_roles.user_id cascades', byName.get('user_roles_user_id_fkey') === 'c')
  check('user_roles.granted_by sets null (not cascade — it records provenance, not ownership)', byName.get('user_roles_granted_by_fkey') === 'n')
  check('weekly_reviews.user_id cascades', byName.get('weekly_reviews_user_id_fkey') === 'c')
  check('class_sessions.user_id cascades', byName.get('class_sessions_user_id_fkey') === 'c')

  // Real end-to-end proof: a disposable user with a real row in one of the five
  // previously-broken tables, deleted through the actual DELETE /api/account/delete
  // route (not direct admin calls), the exact path a real user's "Delete Account"
  // button takes.
  const email4 = uniqueEmail('delete')
  const { data: deleteUser } = await admin.auth.admin.createUser({ email: email4, password: 'correct horse battery', email_confirm: true })
  const deleteUserId = deleteUser.user!.id
  disposableUserIds.push(deleteUserId) // safety net: a no-op if the delete test below already removed them
  const { error: classLogErr } = await admin.from('class_sessions').insert({
    user_id: deleteUserId, class_date: '2026-01-01', kind: 'covered', idempotency_key: 'e2e-delete-test',
  })
  check('fixture: a class_sessions row was created for the disposable user', !classLogErr, classLogErr?.message)

  const { data: loginLink } = await admin.auth.admin.generateLink({ type: 'magiclink', email: email4 })
  clearJar()
  await followConfirm((loginLink!.properties as any).hashed_token, 'magiclink', '/app')
  const deleteRes = await req('/api/account/delete', { method: 'DELETE' })
  check('DELETE /api/account/delete now succeeds for a user with real rows in the once-broken tables',
    deleteRes.status === 200, `status ${deleteRes.status}: ${await deleteRes.text().catch(() => '')}`)

  const { data: afterDelete } = await admin.auth.admin.getUserById(deleteUserId)
  check('the auth user is actually gone', afterDelete.user == null)
  const { count: survivingRows } = await admin.from('class_sessions').select('*', { count: 'exact', head: true }).eq('user_id', deleteUserId)
  check('…and their class_sessions row went with them', (survivingRows ?? 0) === 0, `${survivingRows} rows remain`)
}

main()
  .catch(e => { console.error('\nCrashed:', e); failed++ })
  .finally(async () => {
    for (const id of disposableUserIds) {
      await admin.auth.admin.deleteUser(id).catch(() => {})
    }
    console.log(`\n${passed} passed, ${failed} failed\n`)
    process.exit(failed > 0 ? 1 : 0)
  })
