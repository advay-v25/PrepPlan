/**
 * COMBINED deletion failure on ordinary throwaway students, real server + Storage + Auth + Postgres (fast: a fresh sign-in is inside the recent window).
 * Owned files (nested, more than one page) are removed, then a REAL database failure in the Auth cascade (temporary trigger) makes deletion fail:
 * the response must say the account is still there AND that files were already removed; retry then finishes; another student's object stays.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/settings-delete-combined-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createRequire } from 'node:module'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = [], bucket = `settings-comb-${Date.now().toString(36)}`
const up = (p: string) => admin.storage.from(bucket).upload(p, new Blob(['x']))
const listAll = async (dir: string): Promise<string[]> => { const out: string[] = []; for (let o = 0; ; o += 100) { const r = await admin.storage.from(bucket).list(dir, { limit: 100, offset: o }); for (const x of r.data ?? []) { if (x.id) out.push(`${dir}/${x.name}`); else out.push(...await listAll(`${dir}/${x.name}`)) } if ((r.data ?? []).length < 100) return out } }

;(async () => {
  await preflightServer()
  const pg = connect(); await pg.connect(); let trigger = false
  try {
    const S = await createStudent(admin, 'dc', { onboard: true, register: id => owned.push(id) })
    const T = await createStudent(admin, 'dd', { onboard: true, register: id => owned.push(id) })
    await admin.from('reminder_prefs').upsert({ user_id: S.id, assessment_reminders: true })
    const bk = await admin.storage.createBucket(bucket, { public: false }); if (bk.error) throw new Error(bk.error.message)
    const mine = [`${S.id}/a.txt`, `${S.id}/docs/b.txt`, `${S.id}/docs/deep/c.txt`, ...Array.from({ length: 105 }, (_, i) => `${S.id}/bulk/f${String(i).padStart(3, '0')}.txt`)]
    for (let i = 0; i < mine.length; i += 20) await Promise.all(mine.slice(i, i + 20).map(up))
    await up(`${T.id}/keep.txt`)
    check('setup: nested files over more than one page exist under the student\'s prefix', (await listAll(S.id)).length === mine.length)
    const hash = createHash('sha256').update(S.id).digest('hex')

    await pg.query(`create or replace function public.settings_comb_block() returns trigger language plpgsql as $f$ begin if old.user_id = '${S.id}'::uuid then raise exception 'settings combined test: blocked'; end if; return old; end $f$`)
    await pg.query('create trigger settings_comb_block before delete on public.reminder_prefs for each row execute function public.settings_comb_block()'); trigger = true
    const failed = await S.s.post('/api/account/delete', { confirmEmail: S.email })
    check('files removed, then a real Auth/cascade failure: 500 DELETE_FAILED with accountDeleted:false and the count of files already removed', failed.status === 500 && failed.body.code === 'DELETE_FAILED' && failed.body.accountDeleted === false && failed.body.filesRemoved === mine.length, JSON.stringify(failed.body))
    check('the message says the account is still there AND that removed files cannot be restored (no "nothing was removed" claim)', /still there/.test(failed.body.error) && /already removed/.test(failed.body.error) && !/nothing was removed/i.test(failed.body.error), failed.body.error)
    check('the account and its rows are intact; the files are really gone', !!(await admin.auth.admin.getUserById(S.id)).data.user && ((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0) > 0 && (await listAll(S.id)).length === 0)
    await pg.query('drop trigger settings_comb_block on public.reminder_prefs'); trigger = false
    const retry = await S.s.post('/api/account/delete', { confirmEmail: S.email })
    check('retry (nothing left to clean) deletes the account', retry.status === 200 && retry.body.success === true && !(await admin.auth.admin.getUserById(S.id)).data.user, JSON.stringify(retry.body))
    const audit = (await admin.from('account_deletions').select('outcome').eq('user_hash', hash)).data ?? []
    check('the audit records one failed attempt and one deletion', audit.map(a => a.outcome).sort().join() === 'deleted,failed')
    check("the other student's object and account are untouched", (await listAll(T.id)).length === 1 && !!(await admin.auth.admin.getUserById(T.id)).data.user)
    owned.splice(owned.indexOf(S.id), 1)
  } finally {
    if (trigger) await pg.query('drop trigger if exists settings_comb_block on public.reminder_prefs').catch(() => {})
    await pg.query('drop function if exists public.settings_comb_block()').catch(() => {}); await pg.end().catch(() => {})
    await admin.storage.emptyBucket(bucket).catch(() => {}); await admin.storage.deleteBucket(bucket).catch(() => {})
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
