/**
 * REAL session aging and deletion failure/recovery on ordinary throwaway students (takes about 12 minutes: it waits out the ten-minute window with real clocks).
 *  - session A signs in at the start; after the window another device B signs in; A's deletion request must be REFUSED (no deletion)
 *  - a per-device sign-out leaves the other device signed in
 *  - A re-authenticates; a REAL database-level failure (a test trigger that raises while the cascade runs) fails the delete with the account, preferences, jobs and history intact; the trigger is dropped and the retry succeeds
 *  - owned Storage objects under the student's prefix are removed through the Storage API; another student's object is untouched
 *  - after deletion: app routes, direct REST with a still-unexpired token, refresh and a repeated request are all denied
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/account-session-aging-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createRequire } from 'node:module'
import path from 'node:path'
import { createStudent, createSession, preflightServer, makeCheck } from './lib/e2eSession'
import { RECENT_AUTH_MINUTES } from '../src/lib/auth/recentAuth'
const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs')

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const device = async (email: string) => {   // a browser-like device that holds its own Supabase session
  const c = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const v = await c.auth.verifyOtp({ token_hash: (link.data.properties as any).hashed_token, type: 'magiclink' }); if (v.error) throw new Error(v.error.message)
  return c
}
const bucket = `settings-aging-${Date.now().toString(36)}`

;(async () => {
  await preflightServer()
  let trigger = false
  const pg = connect(); await pg.connect()
  try {
    const S = await createStudent(admin, 'sg', { onboard: true, register: id => owned.push(id) })
    const T = await createStudent(admin, 'sh', { onboard: true, register: id => owned.push(id) })
    const email = S.email
    const t0 = Date.now()
    const C1 = await device(email), C2 = await device(email)
    await admin.from('reminder_prefs').upsert({ user_id: S.id, assessment_reminders: true })
    await admin.from('reminder_jobs').insert({ user_id: S.id, kind: 'assessment_upcoming', ref_id: 'x', job_key: `aging:${S.id}`, send_at: new Date(Date.now() + 86_400_000).toISOString(), link: '/app/calendar' })
    const bk = await admin.storage.createBucket(bucket, { public: false }); if (bk.error) throw new Error(bk.error.message)
    await admin.storage.from(bucket).upload(`${S.id}/one.txt`, new Blob(['a'])); await admin.storage.from(bucket).upload(`${T.id}/keep.txt`, new Blob(['b']))
    const counts = async () => ({ blocks: (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count, prefs: (await admin.from('reminder_prefs').select('user_id', { count: 'exact', head: true }).eq('user_id', S.id)).count, jobs: (await admin.from('reminder_jobs').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count })
    const before = await counts()
    console.log(`Waiting out the ${RECENT_AUTH_MINUTES}-minute window (session A signed in at the start)…`)
    while (Date.now() - t0 < (RECENT_AUTH_MINUTES * 60 + 45) * 1000) { await S.s.req('/app'); await sleep(60_000); console.log(`  ${Math.round((Date.now() - t0) / 60000)} min`) }

    console.log('\nStale session versus another recent device')
    const B = createSession(admin, email); await B.signIn()      // another device signs in just now: the ACCOUNT's last sign-in is fresh
    const stale = await S.s.post('/api/account/delete', { confirmEmail: email })
    check('session A (older than the window) is REFUSED even though device B just signed in; nothing was deleted', stale.status === 403 && stale.body.code === 'RECENT_SIGN_IN_REQUIRED' && !!(await admin.auth.admin.getUserById(S.id)).data.user && JSON.stringify(await counts()) === JSON.stringify(before), JSON.stringify(stale.body))
    await C1.auth.signOut({ scope: 'local' })
    check('an ordinary per-device sign-out leaves the other device signed in', !!(await C2.auth.getUser()).data.user)

    console.log('\nReauthentication, a real backend failure, then success')
    check('session A signs in again (fresh authentication evidence)', await S.s.signIn())
    await pg.query(`create or replace function public.settings_aging_block() returns trigger language plpgsql as $f$ begin if old.user_id = '${S.id}'::uuid then raise exception 'settings aging test: blocked'; end if; return old; end $f$`)
    await pg.query('create trigger settings_aging_block before delete on public.reminder_prefs for each row execute function public.settings_aging_block()'); trigger = true
    const failed = await S.s.post('/api/account/delete', { confirmEmail: email })
    check("a REAL failure while the cascade runs returns DELETE_FAILED with accountDeleted:false", failed.status === 500 && failed.body.code === 'DELETE_FAILED', JSON.stringify(failed.body))
    check('and the account, preferences, jobs and history are intact', !!(await admin.auth.admin.getUserById(S.id)).data.user && JSON.stringify(await counts()) === JSON.stringify(before))
    const filesAfterFailure = await admin.storage.from(bucket).list(S.id)
    check('owned files were removed before the failed attempt and stay removed (progress is real, the account is not)', (filesAfterFailure.data ?? []).length === 0)
    await pg.query('drop trigger settings_aging_block on public.reminder_prefs'); trigger = false
    const del = await S.s.post('/api/account/delete', { confirmEmail: email })
    check('after the cause is gone, the retry deletes the account', del.status === 200 && del.body.success === true && !(await admin.auth.admin.getUserById(S.id)).data.user, JSON.stringify(del.body))

    console.log('\nAccess after deletion')
    check('storage: the deleted student\'s files are gone through the Storage API, another student\'s object is untouched', (await admin.storage.from(bucket).list(S.id)).data!.length === 0 && (await admin.storage.from(bucket).list(T.id)).data!.length === 1)
    const routes = await Promise.all(['/api/account/export', '/api/reminders/prefs', '/api/calendar/export', '/api/profile'].map(async p => (await S.s.req(p)).status))
    check('the old browser session reaches no account route', routes.every(c => [401, 403, 302, 307].includes(c)), routes.join())
    const bRoutes = await Promise.all(['/api/account/export', '/api/reminders/prefs'].map(async p => (await B.req(p)).status))
    check('the other device\'s browser session is denied too', bRoutes.every(c => [401, 403, 302, 307].includes(c)), bRoutes.join())
    const jwt = (await C2.auth.getSession()).data.session?.access_token
    check('device C2 still holds an UNEXPIRED token (deletion does not revoke it), but the auth server no longer knows the user', !!jwt && !!(await C2.auth.getUser()).error)
    const rest = await C2.from('reminder_prefs').select('*').eq('user_id', S.id)
    check('direct REST with that token reads nothing (the rows are gone)', (rest.data ?? []).length === 0)
    const ins = await C2.from('reminder_prefs').insert({ user_id: S.id, assessment_reminders: true })
    check('direct REST cannot write a row for the deleted account (no resurrection by a still-valid token)', !!ins.error)
    check('refreshing the session fails', !!(await C2.auth.refreshSession()).error)
    const again = await S.s.post('/api/account/delete', { confirmEmail: email })
    check('a repeated deletion request is "no longer signed in", never a contradictory success', again.status === 401)
    const hash = (await import('node:crypto')).createHash('sha256').update(S.id).digest('hex')
    const audit = (await admin.from('account_deletions').select('outcome').eq('user_hash', hash)).data ?? []
    check('the audit holds one failed attempt and one deletion, pseudonymous hash only', audit.map(a => a.outcome).sort().join() === 'deleted,failed')
    check('the other student is untouched', !!(await admin.auth.admin.getUserById(T.id)).data.user && ((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', T.id)).count ?? 0) > 0)
    owned.splice(owned.indexOf(S.id), 1)
  } finally {
    if (trigger) await pg.query('drop trigger if exists settings_aging_block on public.reminder_prefs').catch(() => {})
    await pg.query('drop function if exists public.settings_aging_block()').catch(() => {}); await pg.end().catch(() => {})
    await admin.storage.emptyBucket(bucket).catch(() => {}); await admin.storage.deleteBucket(bucket).catch(() => {})
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
