/**
 * Setup saves, versions and acceptance under real concurrency, on the development database with ONE throwaway student (deleted by id).
 *   npx tsx scripts/setup-concurrency-db-test.ts
 * Each scenario holds one transaction open on a dedicated connection, so the interleaving is controlled, not timed.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
const require = createRequire(import.meta.url)
const { Client } = require('pg'); const { parse } = require('dotenv'); const { configuration } = require('./lib/migrations.cjs')

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const pending = async (p: Promise<unknown>, ms = 1500) => Promise.race([p.then(() => 'done', () => 'done'), sleep(ms).then(() => 'waiting')])

async function main() {
  const cfg = configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync('.env.staging.local')))
  const conn = async () => { const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 30000 }); await c.connect(); await c.query("set statement_timeout='60s'"); return c }
  const email = `integ+conc${Date.now()}@example.com`, password = `Pw-${crypto.randomUUID()}`
  const uid = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id
  const conns: any[] = []
  console.log(`\nSetup concurrency (student ${uid.slice(0, 8)}…)\n`)
  try {
    const { saveExam, saveRoute, savePosition, saveWeek } = await import('../src/lib/onboarding/service')
    const { getOrCreateReadyDraft } = await import('../src/lib/planning/activation/draftService')
    const { data: feb } = await admin.from('exam_windows').select('id').eq('year', 2027).eq('sitting', 'february').single()
    const windows = (days: number[]) => days.map(weekday => ({ weekday, start_time: '18:00', end_time: '20:00' }))
    const weekArgs = (days: number[], max = 60) => ({ max_session: max, mode: 'windows', windows: windows(days), commitments: [] })
    await saveExam(uid, { examWindowId: feb!.id, registered: false, timezone: 'Europe/London' })
    await saveRoute(uid, { prepMode: 'self_study', classPattern: 'none', recurringClasses: [], nextClass: null })
    await savePosition(uid, { stage: 'starting_fresh', topicExposure: {} })
    await saveWeek(uid, { availabilityMode: 'windows', windows: [1, 2, 3].map(weekday => ({ weekday, startTime: '18:00', endTime: '20:00' })), commitments: [], maxSessionMinutes: 60 })
    const version = async () => ((await admin.from('profiles').select('onboarding_context_version').eq('id', uid).single()).data!.onboarding_context_version as number)
    const signedIn = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
    await signedIn.auth.signInWithPassword({ email, password })
    const jwt = (await signedIn.auth.getSession()).data.session!.access_token
    /** Runs acceptance on its own connection as the student (JWT claims set for auth.uid()). */
    const acceptOn = async (c: any, draft: string, rev: number) => {
      await c.query('begin'); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]); await c.query('set local role authenticated')
      try { const r = await c.query('select public.accept_onboarding_preview($1,$2) as r', [draft, rev]); await c.query('commit'); return { ok: true, r: r.rows[0].r } }
      catch (e: any) { await c.query('rollback'); return { ok: false, error: e.message as string } }
    }

    console.log('1. Edit paused after changing inputs; acceptance attempted meanwhile')
    const draftN = await getOrCreateReadyDraft(uid); const N = await version()
    const edit = await conn(), acc = await conn(); conns.push(edit, acc)
    await edit.query('begin'); const bumped = await edit.query("select public.onboarding_commit_step($1,'week',$2::jsonb) as v", [uid, JSON.stringify(weekArgs([1, 2, 3, 4, 5]))])
    check('inside the edit the version already advanced (one transaction)', bumped.rows[0].v === N + 1, `${N} -> ${bumped.rows[0].v}`)
    check('…and nothing is visible to others yet', (await version()) === N && ((await admin.from('availability_windows').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('status', 'active')).count ?? 0) === 3)
    const racing = acceptOn(acc, draftN.draftId, draftN.revision)
    check('acceptance waits for the edit instead of reading half of it', (await pending(racing)) === 'waiting')
    await edit.query('commit')
    const out = await racing
    check('after the edit commits, acceptance refuses the draft built under version N (consistent order: edit, then accept)', !out.ok && /STALE_PREVIEW/.test(out.error ?? ''), JSON.stringify(out))
    check('…nothing was accepted, the draft is still ready, and the version is N+1', ((await admin.from('planning_cycles').select('id').eq('user_id', uid)).data ?? []).length === 0 && (await version()) === N + 1)

    console.log('\n2. Acceptance first; the edit queues behind it')
    const draft2 = await getOrCreateReadyDraft(uid); const N2 = await version()
    const acc2 = await conn(), edit2 = await conn(); conns.push(acc2, edit2)
    await acc2.query('begin'); await acc2.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: 'authenticated' })]); await acc2.query('set local role authenticated')
    const accepted = await acc2.query('select public.accept_onboarding_preview($1,$2) as r', [draft2.draftId, draft2.revision])
    const queuedEdit = edit2.query("select public.onboarding_commit_step($1,'week',$2::jsonb) as v", [uid, JSON.stringify(weekArgs([1, 2, 3, 4, 5, 6], 45))])
    check('the edit waits while acceptance holds the setup', (await pending(queuedEdit)) === 'waiting')
    await acc2.query('commit')
    const editDone = await queuedEdit
    check('acceptance used version N2 and the edit advanced it afterwards (one order, no lost bump)', !!accepted.rows[0].r.cycle_id && editDone.rows[0].v === N2 + 1)

    console.log('\n3. Two concurrent setup edits keep version progression')
    const V = await version()
    const a = await conn(), b = await conn(); conns.push(a, b)
    await a.query('begin'); const ra = await a.query("select public.onboarding_commit_step($1,'week',$2::jsonb) as v", [uid, JSON.stringify(weekArgs([1], 30))])
    const second = b.query("select public.onboarding_commit_step($1,'exam',$2::jsonb) as v", [uid, JSON.stringify({ timezone: 'Europe/London', registered: false, exam_window_id: feb!.id, exam_sitting: 'february', exam_year: 2027, exam_date: '' })])
    check('the second edit waits for the first', (await pending(second)) === 'waiting')
    await a.query('commit'); const rb = await second
    check('versions advance one by one, none lost', ra.rows[0].v === V + 1 && rb.rows[0].v === V + 2 && (await version()) === V + 2, `${V} -> ${ra.rows[0].v}, ${rb.rows[0].v}`)

    console.log('\n4. A failed save changes nothing, including the version')
    const before = { v: await version(), prep: (await admin.from('profiles').select('prep_mode').eq('id', uid).single()).data!.prep_mode }
    const bad = await admin.rpc('onboarding_commit_step', { p_user: uid, p_step: 'route', p_args: { prep_mode: 'hybrid', class_pattern: 'fixed', classes: [{ label: 'ok', weekdays: [1], start_time: '09:00', end_time: '10:00', ends_on: '' }, { label: 'broken', weekdays: [3], start_time: '15:00', end_time: '14:00', ends_on: '' }], next_class: null } })
    check('the broken save raises', !!bad.error, bad.error?.message)
    check('…the profile and the version are exactly as before', (await version()) === before.v && (await admin.from('profiles').select('prep_mode').eq('id', uid).single()).data!.prep_mode === before.prep)

    console.log('\n5. Retrying an accepted draft returns the original receipt')
    const retry = await acceptOn(await (async () => { const c = await conn(); conns.push(c); return c })(), draft2.draftId, draft2.revision)
    check('the retry returns the same cycle, not a new one', retry.ok && retry.r.cycle_id === accepted.rows[0].r.cycle_id && ((await admin.from('planning_cycles').select('id').eq('user_id', uid)).data ?? []).length === 1)
  } finally {
    for (const c of conns) await c.end().catch(() => {})
    const del = await admin.auth.admin.deleteUser(uid)
    check('the throwaway student is removed by recorded id', !del.error, del.error?.message)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
