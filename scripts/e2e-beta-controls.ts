/**
 * Phase 6 against the REAL development project and a running app (E2E_BASE_URL):
 *   A. admission at the API, page and database boundaries (temporarily switches admission to invite_only; ALWAYS restored in `finally`)
 *   B. export ownership and deliberate account deletion (confirmation, recent sign-in, what is removed, what stays)
 *   C. reminders: dedupe, reschedule, opt-out, exam-complete pause, quiet hours, uncertain delivery — with a CONTROLLED transport (no email is sent)
 * Ordinary throwaway students, deleted by recorded id.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { parse } from 'dotenv'
import { createStudent, makeCheck } from './lib/e2eSession'
import { E2E_BASE_URL } from './lib/e2eIdentity'
import { OWNED_TABLES } from '../src/lib/account/export'
import { createRequire } from 'node:module'
const { configuration } = createRequire(import.meta.url)('./lib/migrations.cjs')

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const made: string[] = []; const invEmails: string[] = []
const pgCfg = () => configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync(path.join(process.cwd(), '.env.staging.local'))))
const page = async (s: any, p: string) => { const r = await s.req(p); return { status: r.status, location: r.headers.get('location'), html: (await r.text()) } }

async function main() {
  const cfg = pgCfg(); const db = new Client(cfg.connection); await db.connect()
  const q = async (sql: string, p: unknown[] = []) => (await db.query(sql, p)).rows
  let restoreMode = false
  try {
    console.log('\nThe export list covers every table that holds a student’s rows')
    const owned = (await q("select distinct c.table_name from information_schema.columns c join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema and t.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='user_id' order by 1")).map(r => r.table_name as string)
    check('OWNED_TABLES equals the live schema (a new owned table cannot be forgotten by export or deletion)', JSON.stringify(Object.keys(OWNED_TABLES).sort()) === JSON.stringify(owned), JSON.stringify(owned.filter(t => !Object.keys(OWNED_TABLES).includes(t))))

    console.log('\nB. Export ownership and deletion')
    const a = await createStudent(admin, 'bca', { onboard: true }); made.push(a.id)
    const b = await createStudent(admin, 'bcb', { onboard: true }); made.push(b.id)
    const K = (s: any, body: any) => s.json('/api/checkpoints', { method: body.action ? 'POST' : 'PUT', headers: J, body: JSON.stringify({ key: `k-${crypto.randomUUID()}`, ...body }) })
    await K(a.s, { date: addDays(today, 3), kind: 'provider_mock', label: 'MARKER-ALPHA-MOCK' }); await K(b.s, { date: addDays(today, 4), kind: 'provider_mock', label: 'MARKER-BRAVO-MOCK' })
    const noAuth = await fetch(`${E2E_BASE_URL}/api/account/export`)
    check('the export needs a signed-in account', noAuth.status === 401)
    const exA = await a.s.json('/api/account/export'); const txtA = JSON.stringify(exA.body)
    check('the export is a download of the student’s own setup, plan and assessment records', exA.status === 200 && exA.body.schema === 'roadmap-export-1' && exA.body.account.id === a.id && Array.isArray(exA.body.tables.plan_blocks) && exA.body.tables.plan_blocks.length > 0 && !!exA.body.profile)
    check('it contains their own records and NONE of another student’s', txtA.includes('MARKER-ALPHA-MOCK') && !txtA.includes('MARKER-BRAVO-MOCK') && !txtA.includes(b.id))
    check('it says what is not included (question wording, provider backups)', exA.body.notIncluded.some((x: string) => /Question wording/.test(x)))
    const hdr = await a.s.req('/api/account/export'); check('it is served as an attachment and never cached', /attachment/.test(hdr.headers.get('content-disposition') ?? '') && hdr.headers.get('cache-control') === 'no-store')

    // reminders data to prove cleanup
    await admin.from('reminder_prefs').upsert({ user_id: a.id, assessment_reminders: true })
    await admin.from('reminder_jobs').insert({ user_id: a.id, kind: 'assessment_upcoming', ref_id: 'x', job_key: `del-${a.id}`, send_at: new Date(Date.now() + 3600_000).toISOString(), link: '/app' })
    const email = (await admin.auth.admin.getUserById(a.id)).data.user!.email!
    const wrong = await a.s.post('/api/account/delete', { confirmEmail: 'someone@else.com' })
    check('deletion without the right confirmation is refused and deletes nothing', wrong.status === 400 && wrong.body.code === 'CONFIRMATION_REQUIRED' && !!(await admin.auth.admin.getUserById(a.id)).data.user)
    check('the old immediate-delete endpoint is retired', (await a.s.json('/api/account/delete', { method: 'DELETE' })).status === 410)
    await db.query("update auth.users set last_sign_in_at = now() - interval '2 hours' where id = $1", [a.id])
    const stale = await a.s.post('/api/account/delete', { confirmEmail: email })
    check('a sign-in that is not recent is refused with plain instructions, and nothing is deleted', stale.status === 403 && stale.body.code === 'RECENT_SIGN_IN_REQUIRED' && /sign in again/i.test(stale.body.error) && !!(await admin.auth.admin.getUserById(a.id)).data.user)
    await db.query("update auth.users set last_sign_in_at = now() where id = $1", [a.id])
    const before = Number((await q('select count(*)::int n from public.account_deletions'))[0].n)
    const del = await a.s.post('/api/account/delete', { confirmEmail: email.toUpperCase() })
    check('with the right confirmation and a recent sign-in the account is deleted', del.status === 200 && del.body.success === true && !(await admin.auth.admin.getUserById(a.id)).data.user)
    let left = 0; for (const t of Object.keys(OWNED_TABLES)) left += Number((await q(`select count(*)::int n from public.${t} where user_id = $1`, [a.id]))[0].n)
    left += Number((await q('select count(*)::int n from public.profiles where id = $1', [a.id]))[0].n)
    check('no row owned by that student remains in any owned table (including reminders and pending jobs)', left === 0, `${left} rows left`)
    check('the other student is untouched', Number((await q('select count(*)::int n from public.plan_blocks where user_id = $1', [b.id]))[0].n) > 0)
    const audit = await q('select user_hash, outcome from public.account_deletions order by deleted_at desc limit 1')
    check('only a one-way hash and a timestamp remain as the deletion audit (never the id or email)', Number((await q('select count(*)::int n from public.account_deletions'))[0].n) === before + 1 && audit[0].outcome === 'deleted' && audit[0].user_hash.length === 64 && audit[0].user_hash !== a.id)
    check('the deleted student’s session no longer works', (await a.s.json('/api/account/export')).status === 401)
    made.splice(made.indexOf(a.id), 1)

    console.log('\nC. Reminders with a controlled transport')
    const { syncReminders, runDueReminders, savePrefs, UncertainDelivery } = await import('../src/lib/reminders/service') as any
    const c = await createStudent(admin, 'bcc', { onboard: true }); made.push(c.id)
    await admin.from('profiles').update({ timezone: 'UTC' }).eq('id', c.id)
    const mk = await K(c.s, { date: addDays(today, 1), kind: 'provider_mock', label: 'Reminder mock' })
    const apptId = mk.body.checkpoint.checkpointId as string
    const sent: any[] = []; const okTransport = { send: async (m: any) => { sent.push(m); return { id: `fake-${sent.length}` } } }
    const noon = new Date(`${today}T12:00:00Z`)
    await syncReminders(c.id, noon)
    check('nothing is scheduled until the student opts in', Number((await q("select count(*)::int n from public.reminder_jobs where user_id=$1", [c.id]))[0].n) === 0)
    await savePrefs(c.id, { assessmentReminders: true, quietStart: '22:00', quietEnd: '07:00' })
    await syncReminders(c.id, noon); await syncReminders(c.id, noon)
    const jobs = await q("select job_key, status, link, send_at from public.reminder_jobs where user_id=$1", [c.id])
    check('opting in schedules ONE reminder, and repeating the sync does not duplicate it', jobs.length === 1 && jobs[0].status === 'pending' && jobs[0].job_key === `assessment_upcoming:${apptId}:${addDays(today, 1)}`)
    check('its link goes to the exact appointment', jobs[0].link.includes(`appointment=${apptId}`))
    // move the appointment: the old job is obsolete, a new one exists
    const v = (await c.s.json(`/api/checkpoints?appointment=${apptId}`)).body.checkpoint
    await c.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: JSON.stringify({ key: `k-${crypto.randomUUID()}`, checkpointId: apptId, expectedVersion: v.version, date: addDays(today, 2), kind: 'provider_mock', label: 'Reminder mock' }) })
    await syncReminders(c.id, noon)
    const moved = await q("select job_key, status, cancelled_reason from public.reminder_jobs where user_id=$1 order by created_at", [c.id])
    check('moving the appointment cancels the obsolete reminder and schedules the new date', moved.length === 2 && moved[0].status === 'cancelled' && moved[0].cancelled_reason === 'obsolete' && moved[1].status === 'pending' && moved[1].job_key.endsWith(addDays(today, 2)))
    // make the current job due and send it
    await db.query("update public.reminder_jobs set send_at = now() - interval '1 minute' where user_id=$1 and status='pending'", [c.id])
    const inDay = new Date(`${addDays(today, 1)}T18:30:00Z`)
    const t1 = await runDueReminders(okTransport, inDay)
    check('a due reminder is sent exactly once, with the exact link, and recorded as sent', sent.length === 1 && t1.sent === 1 && sent[0].link.includes(`appointment=${apptId}`) && sent[0].idempotencyKey.startsWith('assessment_upcoming'))
    const t2 = await runDueReminders(okTransport, inDay)
    check('a second worker pass (a retry) sends nothing more', sent.length === 1 && t2.sent === 0)
    // uncertain delivery is recorded and never auto-retried (the sent job is put back to pending only to exercise the failure path)
    const key2 = `assessment_upcoming:${apptId}:${addDays(today, 2)}`
    await db.query("update public.reminder_jobs set status='pending', send_at = now() - interval '1 minute', attempts=0, sent_at=null where user_id=$1 and job_key=$2", [c.id, key2])
    const flaky = { send: async () => { throw new UncertainDelivery('timeout after send') } }
    const tU = await runDueReminders(flaky, inDay)
    const stU = (await q("select status, last_error from public.reminder_jobs where user_id=$1 and job_key=$2", [c.id, key2]))[0]
    check('a delivery that cannot be confirmed is recorded as uncertain (not sent, not auto-retried)', tU.uncertain === 1 && stU.status === 'uncertain' && /not retried/.test(stU.last_error))
    const tU2 = await runDueReminders(okTransport, inDay)
    check('and a later worker pass does not pick it up again', tU2.sent === 0 && sent.length === 1)
    // quiet hours: a due job inside quiet hours is deferred, not sent
    await db.query("update public.reminder_jobs set status='pending', send_at = now() - interval '1 minute', attempts=0 where user_id=$1 and job_key = $2", [c.id, key2])
    const before2 = sent.length
    const quiet = await runDueReminders(okTransport, new Date(`${addDays(today, 1)}T23:00:00Z`))
    check('inside the student’s quiet hours nothing is sent; it is rescheduled', sent.length === before2 && quiet.later >= 1)
    // exam complete and opt-out
    await db.query("update public.reminder_jobs set status='pending', send_at = now() - interval '1 minute', attempts=0 where user_id=$1 and job_key = $2", [c.id, key2])
    await admin.from('exam_completion').upsert({ user_id: c.id, sat_on: today })
    const done = await runDueReminders(okTransport, new Date(`${addDays(today, 1)}T18:30:00Z`))
    check('once the student has said they sat the exam, a due reminder is cancelled instead of sent', sent.length === before2 && done.cancelled >= 1)
    await admin.from('exam_completion').delete().eq('user_id', c.id)
    await syncReminders(c.id, noon)
    await savePrefs(c.id, { assessmentReminders: false, weeklyReviewReminders: false })
    check('opting out cancels every pending reminder', Number((await q("select count(*)::int n from public.reminder_jobs where user_id=$1 and status in ('pending','sending')", [c.id]))[0].n) === 0)
    const cron = await fetch(`${E2E_BASE_URL}/api/reminders/run`, { method: 'POST' })
    check('the worker endpoint refuses a caller without the secret', cron.status === 401)
    const prefsApi = await c.s.json('/api/reminders/prefs', { method: 'PUT', headers: J, body: JSON.stringify({ quietStart: '25:00' }) })
    check('invalid quiet hours are refused', prefsApi.status === 400)

    console.log('\nA. Admission at the API, page and database boundaries (invite-only is switched on, then ALWAYS restored)')
    const u1 = await createStudent(admin, 'bcu', { onboard: true }); made.push(u1.id)      // created in open mode: has NO invitation
    restoreMode = true
    await db.query("update public.beta_settings set value='invite_only' where key='admission'")
    const api = await u1.s.json('/api/rehearsal')
    check('an account with no invitation is refused at the API (403 NOT_ADMITTED, with where to go)', api.status === 403 && api.body.code === 'NOT_ADMITTED' && api.body.nextUrl === '/not-invited')
    const pg1 = await page(u1.s, '/app')
    check('and redirected from the app pages to plain instructions', pg1.status >= 300 && pg1.status < 400 && pg1.location === '/not-invited')
    check('the onboarding API refuses it too', (await u1.s.json('/api/onboarding/state')).status === 403)
    const ni = await page(u1.s, '/not-invited')
    check('the instructions page explains expired, used and wrong-address cases', ni.status === 200 && /expired or already used/.test(ni.html) && /different email/.test(ni.html))
    const strangerErr = await admin.auth.admin.createUser({ email: `integ+stranger${Date.now()}@example.com`, email_confirm: true })
    check('the DATABASE refuses an account for an uninvited email (no page or API can bypass it)', !!strangerErr.error && /database|invited/i.test(strangerErr.error.message), JSON.stringify(strangerErr.error?.message))
    const invEmail = `integ+invited${Date.now()}@example.com`
    invEmails.push(invEmail); await db.query("select public.create_beta_invitation($1,'candidate',7)", [invEmail])
    const inv = await admin.auth.admin.createUser({ email: invEmail, email_confirm: true })
    if (inv.data.user) made.push(inv.data.user.id)
    check('an invited email can create the account and, once verified, is admitted', !inv.error && (await db.query('select public.is_beta_admitted($1) a', [inv.data.user?.id])).rows[0].a === true, inv.error?.message)
    const unverified = await admin.auth.admin.createUser({ email: `integ+unver${Date.now()}@example.com`, email_confirm: false }).catch((e: any) => ({ error: e, data: { user: null } }))
    check('an uninvited address cannot get a pending account either', !!(unverified as any).error)
    await db.query("update public.beta_settings set value='open' where key='admission'"); restoreMode = false
    check('admission is back to open (the development default)', (await q("select value from public.beta_settings where key='admission'"))[0].value === 'open')
  } finally {
    if (restoreMode) await db.query("update public.beta_settings set value='open' where key='admission'").catch(() => {})
    for (const id of made) {
      const att = (await q('select id, form_id from public.assessment_attempts where user_id=$1', [id]).catch(() => [])) as any[]
      if (att.length) { await db.query('delete from public.assessment_attempts where user_id=$1', [id]).catch(() => {}) }
      await admin.auth.admin.deleteUser(id).catch(() => {})
    }
    if (invEmails.length) await db.query('delete from public.beta_invitations where email = any($1)', [invEmails]).catch(() => {})
    await db.end()
  }
}
main().then(() => finish()).catch(e => { console.error('\nFAILED:', e?.message ?? e); process.exit(1) })
