/**
 * Version-aware setup saves for a completed student (ordinary throwaway students, no global side effects):
 *   - two overlapping edits with the SAME read version: exactly one commits, the other is refused with nothing written and the current version returned
 *   - a cosmetic (name) edit does not change the setup version; a planning edit changes it exactly once
 *   - first-time setup (no version) is unaffected
 *   - a stale retry of a committed save is refused (the client must reload and compare), never double-applied
 *   - what the app reads after an exam change (Home, Calendar, Curriculum, Tests, Coach) agrees with the saved date
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/settings-setup-version-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createRequire } from 'node:module'
import path from 'node:path'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
import { loadExamStatus } from '../src/lib/exam/status'

const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs')
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const ver = async (id: string) => Number((await admin.from('profiles').select('onboarding_context_version').eq('id', id).single()).data!.onboarding_context_version)
const win = (weekday: number, a: string, b: string) => ({ weekday, startTime: a, endTime: b })
const week = (windows: unknown[], max = 45) => ({ availabilityMode: 'windows', windows, commitments: [], maxSessionMinutes: max })

;(async () => {
  await preflightServer()
  try {
    const A = await createStudent(admin, 'sv', { onboard: true, register: id => owned.push(id) })
    const v0 = await ver(A.id)
    console.log('Overlapping edits')
    const [r1, r2] = await Promise.all([
      A.s.post('/api/onboarding/week', { ...week([win(1, '19:00', '21:00')]), expectedVersion: v0 }),
      A.s.post('/api/onboarding/week', { ...week([win(2, '19:00', '21:00')]), expectedVersion: v0 }),
    ])
    const oks = [r1, r2].filter(r => r.body?.ok), stale = [r1, r2].filter(r => r.status === 409 && r.body?.code === 'setup_changed')
    check('exactly one of two same-version edits commits; the other is refused as stale', oks.length === 1 && stale.length === 1, JSON.stringify([r1.body, r2.body]).slice(0, 300))
    check('the version moved exactly once and the refusal reports the current version', (await ver(A.id)) === v0 + 1 && stale[0].body.currentVersion === v0 + 1 && oks[0].body.version === v0 + 1)
    const wins = ((await admin.from('availability_windows').select('weekday').eq('user_id', A.id).eq('status', 'active')).data ?? []).map(w => w.weekday)
    check('the stored windows are exactly the winner\'s (no merge, no loss)', wins.length === 1 && (wins[0] === 1 || wins[0] === 2))
    const retry = await A.s.post('/api/onboarding/week', { ...week([win(1, '19:00', '21:00')]), expectedVersion: v0 })
    check('a stale retry of an already-committed save is refused, never applied twice', retry.status === 409 && (await ver(A.id)) === v0 + 1)
    const fresh = await A.s.post('/api/onboarding/week', { ...week([win(3, '18:00', '20:00')], 30), expectedVersion: await ver(A.id) })
    check('with the version it just read, the next edit commits (one more version)', fresh.body?.ok === true && (await ver(A.id)) === v0 + 2)
    check('the sitting-limit edit reached the profile (new previews use the changed boundary)', (await admin.from('profiles').select('max_session_minutes').eq('id', A.id).single()).data!.max_session_minutes === 30)

    console.log('\nCosmetic versus planning edits')
    const before = await ver(A.id)
    const nm = await A.s.json('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Version Test' }) })
    check('a name-only edit does not change the setup version (no stale proposal from a cosmetic edit)', nm.body.ok && (await ver(A.id)) === before)
    const winsBefore = JSON.stringify((await admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', A.id).eq('status', 'active').order('weekday')).data)
    const noVer = await A.s.post('/api/onboarding/week', week([win(4, '18:00', '20:00')]))
    check('a completed student\'s planning edit WITHOUT a version is refused by the server (400 version_required): nothing written, version unchanged', noVer.status === 400 && noVer.body?.code === 'version_required' && (await ver(A.id)) === before && JSON.stringify((await admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', A.id).eq('status', 'active').order('weekday')).data) === winsBefore, JSON.stringify(noVer.body))
    for (const bad of ['7', 1.5, -1, 0, null, {}, true]) {
      const r = await A.s.post('/api/onboarding/week', { ...week([win(4, '18:00', '20:00')]), expectedVersion: bad })
      check(`malformed expectedVersion ${JSON.stringify(bad)} is refused (version_required/version_invalid), changing nothing`, r.status === 400 && /^version_(required|invalid)$/.test(r.body?.code) && (await ver(A.id)) === before, JSON.stringify(r.body))
    }
    const stale0 = await A.s.post('/api/onboarding/week', { ...week([win(4, '18:00', '20:00')]), expectedVersion: before - 1 })
    check('a stale numeric version is still refused as setup_changed (409)', stale0.status === 409 && stale0.body.code === 'setup_changed' && (await ver(A.id)) === before)
    const retired = await A.s.json('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nope', maxSessionMinutes: 20, prepMode: 'self_study' }) })
    check('/api/profile refuses retired planning fields explicitly and changes nothing (name included)', retired.status === 400 && retired.body.code === 'RETIRED_FIELD' && (await ver(A.id)) === before && (await admin.from('profiles').select('display_name').eq('id', A.id).single()).data!.display_name !== 'Nope')
    const prof = await A.s.json('/api/profile')
    check('GET /api/profile no longer returns legacy planning values', prof.status === 200 && Object.keys(prof.body.profile).join() === 'name', JSON.stringify(prof.body))

    console.log('\nLock order: a checked edit racing ordinary planning writers (no deadlock, no lost or partial write)')
    const t0 = Date.now(); let deadlocks = 0, lost = 0
    for (let round = 0; round < 4; round++) {
      const v = await ver(A.id)
      const day = new Date(Date.now() + (round + 3) * 86_400_000).toISOString().slice(0, 10)
      const [chk, comm, cl] = await Promise.all([
        A.s.post('/api/onboarding/week', { ...week([win(1 + round, '19:00', '20:30')]), expectedVersion: v }),
        A.s.post('/api/commitments', { kind: 'personal', label: `Race ${round}`, date: day, startTime: '05:00', endTime: '05:30', isProtected: true }),
        A.s.post('/api/profile/classes-completed', { done: false }),
      ])
      for (const r of [chk, comm, cl]) if (r.status >= 500) deadlocks++
      if (!(chk.body?.ok || chk.status === 409) || !(comm.body?.ok || comm.status < 500)) lost++
    }
    check('four rounds of checked edit + commitment write + class transition: no 5xx/deadlock, each request resolved (committed or cleanly refused)', deadlocks === 0 && lost === 0 && Date.now() - t0 < 60_000, `${deadlocks} deadlocks ${lost} unresolved in ${Date.now() - t0}ms`)
    const vNow = await ver(A.id)
    const goOn = await A.s.post('/api/onboarding/week', { ...week([win(4, '18:00', '20:00')]), expectedVersion: vNow })
    check('the setup is still editable after the races (the version moves exactly once for a committed edit)', goOn.body?.ok === true && (await ver(A.id)) === vNow + 1)

    // Two-connection proof of the lock ORDER: a planning writer takes scope_lock and then the profile row (what every other writer does); the checked command must not
    // take them the other way round. Repeated with overlapping timing under a deadline: a deadlock would surface as SQLSTATE 40P01.
    const pg = connect(); await pg.connect()
    try {
      let dead = 0, done = 0
      for (let i = 0; i < 6; i++) {
        const v = await ver(A.id)
        const writer = (async () => { const c = connect(); await c.connect(); try { await c.query('begin'); await c.query('select public.scope_lock($1)', [A.id]); await c.query('select pg_sleep(0.15)'); await c.query('select 1 from public.profiles where id = $1 for update', [A.id]); await c.query('commit'); done++ } catch (e: any) { if (e.code === '40P01') dead++; await c.query('rollback').catch(() => {}) } finally { await c.end() } })()
        const checked = (async () => { await new Promise(r => setTimeout(r, 40)); const r = await admin.rpc('onboarding_commit_step_checked', { p_user: A.id, p_step: 'week', p_args: { max_session: 45, mode: 'windows', windows: [{ weekday: 2, startTime: '19:00', endTime: '20:00' }], commitments: [] }, p_expected: v }); if (r.error?.code === '40P01') dead++; else done++ })()
        await Promise.race([Promise.all([writer, checked]), new Promise((_, rej) => setTimeout(() => rej(new Error('lock-order race exceeded its deadline')), 30_000))])
      }
      check('checked edit vs a scope_lock-then-row-lock writer, six overlapping rounds on two connections: no deadlock and both complete', dead === 0 && done === 12, `deadlocks ${dead}, completed ${done}`)
    } finally { await pg.end().catch(() => {}) }

    console.log('\nExam change and what the app reads afterwards')
    const wins2 = (await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens')).data!
    const target = wins2[1]
    const ex = await A.s.post('/api/onboarding/exam', { examWindowId: target.id, registered: true, examDate: `${String(target.window_opens).slice(0, 7)}-20`, timezone: 'Europe/London', expectedVersion: await ver(A.id) })
    check('the exam edit commits and returns its version and a plan impact (or an explicit "unavailable")', ex.body?.ok === true && typeof ex.body.version === 'number' && ('impact' in ex.body), JSON.stringify(ex.body).slice(0, 200))
    const date = `${String(target.window_opens).slice(0, 7)}-20`
    const status = await loadExamStatus(A.id, new Date())
    check('the exam read model (Home, roadmap, Coach all read it) reports the saved booked date', JSON.stringify(status).includes(date), JSON.stringify(status).slice(0, 200))
    const pages = await Promise.all(['/app', '/app/calendar', '/app/curriculum', '/app/tests', '/app/coach'].map(async p => (await A.s.req(p)).status))
    check('Home, Calendar, Curriculum, Tests and Coach all render after the change', pages.every(s => s === 200), pages.join())
    const ctx = await A.s.json('/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'when is my exam?', turnKey: `sv${Date.now()}` }) })
    check('Coach answers from the same saved exam (link to the exam page; no stale date)', ctx.status === 200 && (ctx.body.links ?? []).some((l: any) => String(l.href) === '/app/exam'))
    check('stored attempts and reserved forms were not touched by a setup edit', ((await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', A.id)).count ?? 0) === 0)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
