/**
 * Scoped account proof on ordinary throwaway students (never the owner; no global admission change; no real email; no reminder worker run):
 * reminder atomic patches and load/save errors, name-only profile patch and no partial success, classes-completed, and account deletion
 * (confirmation, ownership, direct + parent-owned rows, access boundary afterwards, repeat click, other student untouched).
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/settings-account-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createHash } from 'node:crypto'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
import { OWNED_TABLES } from '../src/lib/account/export'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const put = (s: any, p: string, b: unknown) => s.json(p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })

;(async () => {
  await preflightServer()
  try {
    const A = await createStudent(admin, 'sa', { onboard: true, register: id => owned.push(id) })
    const B = await createStudent(admin, 'sb', { onboard: true, register: id => owned.push(id) })

    console.log('\nReminders')
    const g0 = await A.s.json('/api/reminders/prefs')
    check('first load: opt-in defaults, delivery state is reported honestly', g0.body.ok && g0.body.prefs.assessmentReminders === false && g0.body.prefs.weeklyReviewReminders === false && ['configured', 'not_configured'].includes(g0.body.delivery), JSON.stringify(g0.body))
    const race = await Promise.all([put(A.s, '/api/reminders/prefs', { assessmentReminders: true }), put(A.s, '/api/reminders/prefs', { weeklyReviewReminders: true }), put(A.s, '/api/reminders/prefs', { quietStart: '22:30' }), put(A.s, '/api/reminders/prefs', { quietEnd: '06:15' })])
    const g1 = (await A.s.json('/api/reminders/prefs')).body.prefs
    check('four concurrent patches to different fields all survive (no lost update)', race.every(r => r.body?.ok) && g1.assessmentReminders && g1.weeklyReviewReminders && g1.quietStart === '22:30' && g1.quietEnd === '06:15', JSON.stringify(g1))
    const bad = await put(A.s, '/api/reminders/prefs', { quietStart: '25:99' })
    check('an invalid time is a 400 and nothing changes', bad.status === 400 && JSON.stringify((await A.s.json('/api/reminders/prefs')).body.prefs) === JSON.stringify(g1))
    const off = await put(A.s, '/api/reminders/prefs', { assessmentReminders: false, weeklyReviewReminders: false })
    check('opting out saves, reports sync state and leaves quiet hours untouched', off.body.ok && off.body.sync === 'ok' && off.body.prefs.quietStart === '22:30')
    check('another student\'s preferences are independent', (await B.s.json('/api/reminders/prefs')).body.prefs.assessmentReminders === false)

    console.log('\nProfile and classes-completed')
    const nm = await put(A.s, '/api/profile', { name: 'Ada Lovelace' })
    const row = (await admin.from('profiles').select('display_name, max_session_minutes, prep_mode, exam_sitting').eq('id', A.id).single()).data!
    check('a name-only patch saves the name and changes nothing else', nm.body.ok && row.display_name === 'Ada Lovelace' && row.max_session_minutes === 45 && row.prep_mode === 'self_study')
    await admin.from('exam_attempts').update({ status: 'closed' }).eq('user_id', A.id)
    const before = (await admin.from('profiles').select('display_name').eq('id', A.id).single()).data!.display_name
    const part = await put(A.s, '/api/profile', { name: 'Should Not Stick', examDate: '2030-01-01' })
    check('a retired planning field (examDate) is refused explicitly BEFORE any write: the name does not change', part.status === 400 && part.body.code === 'RETIRED_FIELD' && (await admin.from('profiles').select('display_name').eq('id', A.id).single()).data!.display_name === before, JSON.stringify(part.body))
    check('the retired immediate-delete endpoint stays retired', (await A.s.json('/api/account/delete', { method: 'DELETE' })).status === 410)
    const notClass = await A.s.post('/api/profile/classes-completed', { done: true })
    check('a self-study student cannot mark classes finished (clear refusal, no write)', notClass.status === 400)

    console.log('\nAccount deletion')
    const tableCount = async (uid: string) => { let n = 0; for (const t of Object.keys(OWNED_TABLES)) n += (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0; return n }
    const bBefore = await tableCount(B.id)
    // parent-owned rows for A: a repair thread event needs a thread; a class_session item needs a session: use what onboarding produced plus a thread if any
    const cyA = (await admin.from('planning_cycles').select('starts_at_local').eq('user_id', A.id).eq('status', 'active').single()).data!
    const mkT = await A.s.post('/api/tasks', { title: 'Receipt cascade probe', date: String(cyA.starts_at_local).slice(0, 10) > new Date().toISOString().slice(0, 10) ? String(cyA.starts_at_local).slice(0, 10) : new Date().toISOString().slice(0, 10), durationMinutes: 30, startMinutes: null })
    const rcBefore = (await admin.from('task_create_receipts').select('key').eq('user_id', A.id)).data?.length ?? 0
    check('the student has a creation receipt before deletion', mkT.body?.ok === true && rcBefore === 1, JSON.stringify(mkT.body).slice(0, 160))
    const aBefore = await tableCount(A.id)
    check('the student owns data to delete', aBefore > 10, String(aBefore))
    const email = (await admin.auth.admin.getUserById(A.id)).data.user!.email!
    const wrong = await A.s.post('/api/account/delete', { confirmEmail: 'someone@else.example' })
    check('the wrong confirmation deletes nothing', wrong.status === 400 && !!(await admin.auth.admin.getUserById(A.id)).data.user && (await tableCount(A.id)) === aBefore)
    const del = await A.s.post('/api/account/delete', { confirmEmail: email.toUpperCase() })
    check('with the right confirmation and a freshly authenticated session the account is deleted', del.status === 200 && del.body.success === true && !(await admin.auth.admin.getUserById(A.id)).data.user, JSON.stringify(del.body))
    check('the creation receipt is gone with the account (Auth cascade)', ((await admin.from('task_create_receipts').select('key').eq('user_id', A.id)).data ?? []).length === 0)
    check('no row owned by that student remains, in direct or parent-owned tables', (await tableCount(A.id)) === 0 && (await admin.from('profiles').select('id').eq('id', A.id)).data!.length === 0)
    const audit = (await admin.from('account_deletions').select('user_hash, outcome').eq('user_hash', createHash('sha256').update(A.id).digest('hex'))).data ?? []
    check('only the documented pseudonymous audit row is retained', audit.length === 1 && audit[0].outcome === 'deleted')
    const after = await Promise.all(['/api/account/export', '/api/reminders/prefs', '/api/calendar/export', '/api/profile'].map(async p => (await A.s.req(p)).status))
    check('the old browser session no longer reaches any account route', after.every(s => s === 401 || s === 403 || s === 302 || s === 307), after.join())
    const again = await A.s.post('/api/account/delete', { confirmEmail: email })
    check('a repeated click / lost-response retry is a truthful "no longer signed in", never a contradictory success', again.status === 401, String(again.status))
    check('the other student is untouched', (await tableCount(B.id)) === bBefore && !!(await admin.auth.admin.getUserById(B.id)).data.user)
    const idx = owned.indexOf(A.id); if (idx >= 0) owned.splice(idx, 1)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
