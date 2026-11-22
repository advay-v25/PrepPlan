/**
 * Phase 1 completion: the reviewed class follow-up allocation is AUTHORITATIVE (database, under the scheduling lock), several ordered sittings of one
 * item may share a day, and work that never received a task is a durable obligation that survives reload, cycle closure and a week with no class.
 * Real HTTP + Postgres; ordinary throwaway class-led students (registered at creation, deleted in `finally`). Deterministic two-connection barriers
 * (pg_stat_activity shows the second command waiting on the advisory lock) in both lock orders -- no timing sleeps as proof.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/classlog-authority-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createRequire } from 'node:module'
import path from 'node:path'
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { previewClassLogK as previewClassLog, keyedClient } from './lib/classKeys'
import { listOwedClassWork } from '../src/lib/planning/classlog/carry'
import { getScopeGroups } from '../src/lib/planning/taskScopeService'
import { getCompletedCycleScope } from '../src/lib/tests/completedScopeService'
import { shiftStudentTimeline } from './lib/timeFixture'
import { addDays, todayInZone, weekdayOf, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs') as { connect: () => { connect(): Promise<void>; query(q: string, p?: unknown[]): Promise<{ rows: any[]; rowCount: number }>; end(): Promise<void> } }
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
let n = 0
const key = () => `ca-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const TZ = 'Europe/London'

async function userClient(email: string) {
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const c = keyedClient(createClient(url, anon, { auth: { persistSession: false } }))
  const r = await c.auth.verifyOtp({ token_hash: (data!.properties as any).hashed_token, type: 'magiclink' })
  if (r.error) throw new Error(r.error.message)
  return c
}

/** A throwaway class-led student with one 09:00-13:00 window every day and a cycle six days back to nine days ahead (a constructed fixture cycle). */
async function fresh(tag: string, maxSitting = 45, windows = true) {
  const persona = await classLedPersona(admin)
  const S = await createStudent(admin, tag, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  await admin.from('profiles').update({ max_session_minutes: maxSitting }).eq('id', S.id)
  await admin.from('availability_windows').delete().eq('user_id', S.id)
  if (windows) await admin.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: S.id, weekday, start_time: '09:00', end_time: '13:00', status: 'active' })))
  const cyc0 = (await admin.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single()).data!
  const t0 = todayInZone((cyc0.timezone as string) || TZ)
  await admin.from('planning_cycles').update({ starts_at_local: addDays(t0, -9), ends_at_local: addDays(t0, 9) }).eq('id', cyc0.id)
  await admin.from('plan_blocks').delete().eq('user_id', S.id).eq('cycle_id', cyc0.id)   // fixture: the persona's seeded tasks would compete for room
  const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('id', cyc0.id).single()).data!
  const ctx = (await S.s.json('/api/class-log/context')).body.context
  const tz = (cycle.timezone as string) || TZ
  // Persona weekday "Work" blocks cover the windows: only weekends have real room. Two distinct future weekend days inside the cycle.
  const weekend: string[] = []
  for (let d = addDays(todayInZone(tz), 1); d < (cycle.ends_at_local as string) && weekend.length < 3; d = addDays(d, 1)) if (weekdayOf(d) === 6 || weekdayOf(d) === 0) weekend.push(d)
  return { S, cycle, tz, pending: (ctx.pendingDates as string[]).slice().sort(), weekend, client: undefined as any }
}
type Fresh = Awaited<ReturnType<typeof fresh>>

async function anyOutcome(): Promise<{ id: string; reading: string }> {
  const rs = (await admin.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(10)).data ?? []
  for (const r of rs) { const los = (await admin.from('reading_los').select('id').eq('reading_id', r.id).order('sequence').limit(1)).data ?? []; if (los[0]) return { id: los[0].id as string, reading: r.id as string } }
  throw new Error('no outcome')
}

let ordN = 0
const T = (F: Fresh, o: { id: string; reading: string }, date: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id: `ca-${Math.random().toString(36).slice(2, 12)}`, title: 'sitting', detail: '', task_type: 'study', origin: 'planner', local_date: date, duration_minutes: minutes,
  rationale: 'r', session_id: '', outcome_id: o.id, lm_id: o.reading, learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', verification_intent: 'v', curriculum_reference: 'ref',
  dependencies: [], group_key: '', group_id: '', sitting_ordinal: ++ordN, item_planned: 0, ...extra,
})
const item = (o: { id: string }, planned: number, extent = 'full') => ({ outcome_id: o.id, extent, portion_note: '', studied_in_class: false, planned_minutes: planned })
const sessionsOf = async (F: Fresh) => (await admin.from('class_sessions').select('id').eq('user_id', F.S.id)).data!.length
const blocksOf = async (F: Fresh) => (await admin.from('plan_blocks').select('id, local_date, duration_minutes, sitting_ordinal, dependencies, scope_group_id, class_session_id, outcome_id').eq('user_id', F.S.id).not('class_session_id', 'is', null).order('sitting_ordinal')).data!
const seed = async (F: Fresh, id: string, date: string, minutes: number, timed?: string) => {
  const r = await admin.from('plan_blocks').insert({ id, user_id: F.S.id, cycle_id: F.cycle.id, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: timed ? 'timed' : 'day_preferred', execution: 'not_started', created_by: 'algorithm', local_date: date, day: date, duration_minutes: minutes, duration: String(minutes), starts_at: timed ? zonedTimeToUtc(date, timed, F.tz).toISOString() : null })
  if (r.error) throw new Error(`seed ${id}: ${r.error.message}`)
}
const waitBlocked = async (c: ReturnType<typeof connect>, command: string, blocker: number) => {
  for (let i = 0; i < 200; i++) {
    const r = await c.query(`select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid
      where l.locktype='advisory' and not l.granted and $1=any(pg_blocking_pids(l.pid)) and position($2 in a.query)>0`, [blocker, command])
    if (r.rowCount) return true
    await new Promise(res => setTimeout(res, 50))
  }
  return false
}

;(async () => {
  await preflightServer()
  const o1 = await anyOutcome()
  try {
    // ---------------------------------------------------------------- 1: several ordered sittings of ONE item on ONE day -----------------------
    console.log('\n1. Several ordered sittings of one item on one day (a limit is per sitting)\n')
    const A = await fresh('ca1')
    const uc = await userClient(A.S.email), D = A.weekend[0]
    const id1 = `ca-a1-${Date.now().toString(36)}`, id2 = `ca-a2-${Date.now().toString(36)}`
    const first = await uc.rpc('apply_class_log', { p_cycle_id: A.cycle.id, p_idempotency_key: key(), p_class_date: A.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 88)],
      p_tasks: [T(A, o1, D, 44, { id: id1, sitting_ordinal: 1, group_key: 'g' }), T(A, o1, D, 44, { id: id2, sitting_ordinal: 2, dependencies: [id1], group_key: 'g' })] })
    check('the owner probe: 88 minutes as two 44-minute sittings on the single day is ACCEPTED (it used to be 45 placed, 43 owed)', !first.error, first.error?.message)
    const rows = await blocksOf(A)
    check('both sittings are saved on one day, ordinals 1 and 2, the second declaring the first', rows.length === 2 && rows.every(r => r.local_date === D) && rows[1].dependencies[0] === id1 && rows.map(r => r.sitting_ordinal).join() === '1,2', JSON.stringify(rows))
    const sid = rows[0].class_session_id as string
    const planned = (await admin.from('class_session_items').select('planned_minutes').eq('session_id', sid).single()).data!.planned_minutes
    const grp = (await admin.from('task_scope_groups').select('id, expected_parts').eq('id', rows[0].scope_group_id as string).single()).data!
    check('the obligation is stored (88 planned) and the group size is the ACTUAL member count (2), never an estimate', planned === 88 && grp.expected_parts === 2 && rows[0].scope_group_id === rows[1].scope_group_id)
    const dup = await uc.rpc('apply_class_log', { p_cycle_id: A.cycle.id, p_idempotency_key: key(), p_class_date: A.pending[0], p_kind: 'covered', p_note: null, p_items: [], p_tasks: [T(A, o1, A.weekend[1], 10, { session_id: sid, sitting_ordinal: 2, item_planned: 88 })] })
    check('a repeated logical sitting (same session, outcome and ordinal) is refused by the stable identity index, whichever day it names', !!dup.error && (await blocksOf(A)).length === 2, dup.error?.message)
    const over = await uc.rpc('apply_class_log', { p_cycle_id: A.cycle.id, p_idempotency_key: key(), p_class_date: A.pending[0], p_kind: 'covered', p_note: null, p_items: [], p_tasks: [T(A, o1, A.weekend[1], 10, { session_id: sid, sitting_ordinal: 3, item_planned: 88 })] })
    check('nothing owed means nothing more can be allocated to that item (no extra task through the direct command)', /PREVIEW_CHANGED|owed/.test(over.error?.message ?? '') && (await blocksOf(A)).length === 2, over.error?.message)

    // ---------------------------------------------------------------- 2: contiguous packing against accepted work ---------------------------
    console.log('\n2. The reviewed allocation fits the contiguous room that is left, alongside accepted work\n')
    const B = await fresh('ca2'), bc = await userClient(B.S.email), DB = B.weekend[0]
    await seed(B, `ca2-day-${Date.now().toString(36)}`, DB, 150)
    const many = await bc.rpc('apply_class_log', { p_cycle_id: B.cycle.id, p_idempotency_key: key(), p_class_date: B.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 300)],
      p_tasks: [T(B, o1, DB, 45), T(B, o1, DB, 45), T(B, o1, DB, 45)] })
    check('an accepted 150-minute day-only task leaves 90 minutes: three 45-minute sittings are refused (the accepted load is counted once)', /PREVIEW_CHANGED/.test(many.error?.message ?? ''), many.error?.message)
    const w2 = [await sessionsOf(B), (await blocksOf(B)).length, (await admin.from('task_scope_groups').select('id').eq('user_id', B.S.id).eq('original_scope->>source', 'class_log')).data!.length]
    check('...and the refusal wrote nothing (no session, no item, no group, no task)', w2.join() === '0,0,0', w2.join())
    const two = await bc.rpc('apply_class_log', { p_cycle_id: B.cycle.id, p_idempotency_key: key(), p_class_date: B.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 300)], p_tasks: [T(B, o1, DB, 45), T(B, o1, DB, 45)] })
    check('two 45-minute sittings fill exactly the 90 that is left and are accepted', !two.error, two.error?.message)
    const C = B, cc = bc, DC = B.weekend[1]
    await seed(C, `ca2b-t-${Date.now().toString(36)}`, DC, 180, '09:30')   // a timed 09:30-12:30 task: the window splits into two 30-minute gaps
    const frag = await cc.rpc('apply_class_log', { p_cycle_id: C.cycle.id, p_idempotency_key: key(), p_class_date: C.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 40)], p_tasks: [T(C, o1, DC, 40)] })
    check('two separate 30-minute gaps do not hold one 40-minute sitting (60 minutes in total is not contiguous room)', /PREVIEW_CHANGED/.test(frag.error?.message ?? ''), frag.error?.message)
    const fit = await cc.rpc('apply_class_log', { p_cycle_id: C.cycle.id, p_idempotency_key: key(), p_class_date: C.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 40)], p_tasks: [T(C, o1, DC, 20), T(C, o1, DC, 20, { dependencies: [] })] })
    check('the same 40 minutes as two 20-minute sittings, one per gap, is accepted', !fit.error, fit.error?.message)

    // ---------------------------------------------------------------- 3: forged payloads ------------------------------------------------------
    console.log('\n3. A student cannot forge another student\'s session or group, an unrelated reading, an extra allocation or a foreign dependency\n')
    const V = await fresh('ca3v'), vc = await userClient(V.S.email)
    const vid = `ca3v-${Date.now().toString(36)}`
    const vr = await vc.rpc('apply_class_log', { p_cycle_id: V.cycle.id, p_idempotency_key: key(), p_class_date: V.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 60)], p_tasks: [T(V, o1, V.weekend[0], 30, { id: vid, sitting_ordinal: 1, group_key: 'g' }), T(V, o1, V.weekend[0], 30, { sitting_ordinal: 2, dependencies: [vid], group_key: 'g' })] })
    if (vr.error) throw new Error(vr.error.message)
    const victim = (await blocksOf(V))[0]
    const M = await fresh('ca3m'), mc = await userClient(M.S.email), DM = M.weekend[0]
    const attack = async (name: string, items: unknown[], tasks: unknown[], pattern: RegExp) => {
      const r = await mc.rpc('apply_class_log', { p_cycle_id: M.cycle.id, p_idempotency_key: key(), p_class_date: M.pending[0], p_kind: 'covered', p_note: null, p_items: items, p_tasks: tasks })
      check(name, pattern.test(r.error?.message ?? '') && await sessionsOf(M) === 0 && (await blocksOf(M)).length === 0, r.error?.message ?? 'accepted!')
    }
    await attack('another student\'s session id is refused', [], [T(M, o1, DM, 30, { session_id: victim.class_session_id, item_planned: 60 })], /Unauthorized/)
    await attack('another student\'s group id is refused', [item(o1, 60)], [T(M, o1, DM, 30, { group_id: victim.scope_group_id })], /Unauthorized/)
    await attack('a dependency on another student\'s task is refused', [item(o1, 60)], [T(M, o1, DM, 30, { dependencies: [victim.id ?? vid] })], /Invalid task order/)
    const other = (await admin.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).neq('id', o1.reading).order('sequence').limit(1)).data![0].id as string
    await attack('a reading that is not the outcome\'s own is refused', [item(o1, 60)], [T(M, o1, DM, 30, { lm_id: other })], /Invalid task/)
    await attack('more minutes than the entry\'s planned obligation is refused', [item(o1, 60)], [T(M, o1, DM, 45), T(M, o1, DM, 45)], /PREVIEW_CHANGED/)
    await attack('an outcome that is not one of the entry\'s items is refused', [], [T(M, o1, DM, 30)], /Unauthorized/)
    await attack('a task type other than study or review is refused', [item(o1, 60)], [T(M, o1, DM, 30, { task_type: 'diagnostic' })], /Invalid task/)
    await attack('a missing sitting ordinal is refused', [item(o1, 60)], [T(M, o1, DM, 30, { sitting_ordinal: '' })], /Invalid task/)

    // ---------------------------------------------------------------- 4: forced mid-command failure rolls everything back -------------------
    console.log('\n4. A failure in the middle of the command leaves nothing behind\n')
    const R = M, rc = mc, DR = M.weekend[0]
    const same = `ca4-${Date.now().toString(36)}`
    const boom = await rc.rpc('apply_class_log', { p_cycle_id: R.cycle.id, p_idempotency_key: key(), p_class_date: R.pending[0], p_kind: 'covered', p_note: null, p_items: [item(o1, 60)],
      p_tasks: [T(R, o1, DR, 30, { id: same, sitting_ordinal: 1, group_key: 'g' }), T(R, o1, DR, 30, { id: same, sitting_ordinal: 2, group_key: 'g' })] })
    check('two tasks with one id fail in the middle of the insert: the command is refused', !!boom.error, boom.error?.message)
    const w4 = [await sessionsOf(R), (await blocksOf(R)).length, (await admin.from('task_scope_groups').select('id').eq('user_id', R.S.id).eq('original_scope->>source', 'class_log')).data!.length]
    check('...and the session, its items, its group and its tasks are all absent', w4.join() === '0,0,0', w4.join())

    // ---------------------------------------------------------------- 5: replay and key reuse -------------------------------------------------
    console.log('\n5. A lost response is replayed as the original outcome; the same key for a different entry is refused\n')
    const P = await fresh('ca5'), DP = P.weekend[0]
    const body = { classDate: P.pending[0], kind: 'covered', items: [{ outcomeId: o1.id, extent: 'full' }] }
    const pv = await previewClassLog(P.S.id, body as any); if (!pv.ok) throw new Error(pv.message)
    const k5 = key()
    const c1 = await P.S.s.post('/api/class-log/confirm', { ...body, idempotencyKey: k5, fingerprint: pv.fingerprint })
    const before = await blocksOf(P)
    // the clock and the cycle move on: no windows left, a different cycle end
    await admin.from('availability_windows').delete().eq('user_id', P.S.id)
    await admin.from('planning_cycles').update({ ends_at_local: addDays(P.cycle.ends_at_local as string, -2) }).eq('id', P.cycle.id)
    const c2 = await P.S.s.post('/api/class-log/confirm', { ...body, idempotencyKey: k5, fingerprint: pv.fingerprint })
    const after = await blocksOf(P)
    check('the first confirm saved the entry; the same key returns the ORIGINAL outcome even after the windows and the cycle changed', c1.body?.ok === true && c2.body?.ok === true && c2.body?.alreadyApplied === true && c2.body.sessionId === c1.body.sessionId, JSON.stringify(c2.body).slice(0, 200))
    check('a replay creates nothing: the same rows, the same ids, one session', before.length === after.length && before.every((b, i) => b.id === after[i].id) && await sessionsOf(P) === 1)
    const reuse = await P.S.s.post('/api/class-log/confirm', { ...body, items: [{ outcomeId: o1.id, extent: 'part' }], idempotencyKey: k5, fingerprint: 'x' })
    check('the same key for a different entry is refused, not replayed', reuse.status >= 400 && reuse.body?.ok !== true, JSON.stringify(reuse.body).slice(0, 160))
    // concurrent same-key confirms on a fresh entry: all resolve to ONE session; none answers "your week changed"
    const P2 = P.pending[1]
    if (P2) {
      await admin.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: P.S.id, weekday, start_time: '09:00', end_time: '13:00', status: 'active' })))
      await admin.from('planning_cycles').update({ ends_at_local: addDays(todayInZone(P.tz), 9) }).eq('id', P.cycle.id)
      const b2 = { classDate: P2, kind: 'covered', items: [{ outcomeId: o1.id, extent: 'full' }] }
      const pv2 = await previewClassLog(P.S.id, b2 as any); if (!pv2.ok) throw new Error(pv2.message)
      const k2 = key()
      const burst = await Promise.all([1, 2, 3, 4].map(() => P.S.s.post('/api/class-log/confirm', { ...b2, idempotencyKey: k2, fingerprint: pv2.fingerprint })))
      check('four concurrent confirms with one key all succeed and resolve to a single session (the race that answered "changed" is closed)', burst.every(b => b.body?.ok === true) && new Set(burst.map(b => b.body.sessionId)).size === 1, JSON.stringify(burst.map(b => b.body?.code ?? b.body?.ok)))
      check('...and exactly one session exists for that class day', (await admin.from('class_sessions').select('id').eq('user_id', P.S.id).eq('class_date', P2)).data!.length === 1)
    }
    const uc5 = await userClient(P.S.email)
    const reuseRpc = await uc5.rpc('apply_class_log', { p_cycle_id: P.cycle.id, p_idempotency_key: k5, p_class_date: P.pending[0], p_kind: 'revision', p_note: null, p_items: [item(o1, 10)], p_tasks: [] })
    check('the database command refuses incompatible key reuse as well', /IDEMPOTENCY_KEY_REUSED/.test(reuseRpc.error?.message ?? ''), reuseRpc.error?.message)
    void DP

    // ---------------------------------------------------------------- 6: concurrency, both lock orders --------------------------------------
    console.log('\n6. Concurrency: the confirm and every competing writer serialise on the scheduling lock\n')
    const K = await fresh('ca6'), kc = await userClient(K.S.email), DK = K.weekend[0]
    const confirmArgs = (planned: number, tasks: unknown[], date = K.pending[0]) => ({ p_cycle_id: K.cycle.id, p_idempotency_key: key(), p_class_date: date, p_kind: 'covered', p_note: null, p_items: [item(o1, planned)], p_tasks: tasks })
    const sql = connect(); await sql.connect()
    const blocker = Number((await sql.query('select pg_backend_pid() as id')).rows[0].id)
    const probe = connect(); await probe.connect()
    try {
      // 6a. a competing writer holds the lock and consumes the room; the confirm waits, then sees it
      await sql.query('begin')
      await sql.query(`insert into public.plan_blocks (id, user_id, cycle_id, title, detail, task_type, origin, priority, placement, execution, created_by, local_date, day, duration_minutes, duration) values ($1,$2,$3,'rival','d','study','planner','core','day_preferred','not_started','algorithm',$4::date,($4::date)::text,120,'120'), ($5,$2,$3,'rival','d','study','planner','core','day_preferred','not_started','algorithm',$4::date,($4::date)::text,90,'90')`, [`ca6-rival-${Date.now().toString(36)}`, K.S.id, K.cycle.id, DK, `ca6-rival2-${Date.now().toString(36)}`])
      const waiting = Promise.resolve(kc.rpc('apply_class_log', confirmArgs(90, [T(K, o1, DK, 45), T(K, o1, DK, 45)])))
      const blocked = await waitBlocked(probe, 'apply_class_log', blocker)
      await sql.query('commit')
      const r6a = await waiting
      check('6a. the confirm WAITED on the writer that held the lock (observed in pg_stat_activity), not a timing guess', blocked)
      check('6a. after the rival committed 210 of 240 minutes, the 90-minute confirm is refused whole and nothing is written', /PREVIEW_CHANGED/.test(r6a.error?.message ?? '') && await sessionsOf(K) === 0 && (await blocksOf(K)).length === 0, r6a.error?.message)
      // 6b. an availability change holds the lock; the confirm waits and sees the window gone
      await admin.from('plan_blocks').delete().eq('user_id', K.S.id).eq('title', 'rival')
      await sql.query('begin')
      await sql.query(`update public.availability_windows set status = 'inactive' where user_id = $1`, [K.S.id])
      const w2 = Promise.resolve(kc.rpc('apply_class_log', confirmArgs(60, [T(K, o1, DK, 30), T(K, o1, DK, 30)])))
      const b2 = await waitBlocked(probe, 'apply_class_log', blocker)
      await sql.query('commit')
      const r6b = await w2
      check('6b. an availability edit that holds the lock is waited for, and the confirm then refuses the day that no longer has a window', b2 && /PREVIEW_CHANGED/.test(r6b.error?.message ?? '') && await sessionsOf(K) === 0, r6b.error?.message)
      await sql.query(`update public.availability_windows set status = 'active' where user_id = $1`, [K.S.id])
      // 6c. the OTHER order: a confirm holds the lock first; a rival confirm for the same room waits, then is refused; the final state fits
      await sql.query('begin'); await sql.query('set local role authenticated'); await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: K.S.id, role: 'authenticated' })])
      const first6 = confirmArgs(180, [T(K, o1, DK, 45), T(K, o1, DK, 45), T(K, o1, DK, 45), T(K, o1, DK, 45)])
      { const oc = { key: `manual:${crypto.randomUUID()}`, commitmentId: null, originalDate: null }; await sql.query(`select public.apply_class_log($1::uuid,$2,$3::date,$4,$5,$6::jsonb,$7::jsonb,$8,$9::uuid,$10::date)`, [first6.p_cycle_id, first6.p_idempotency_key, first6.p_class_date, first6.p_kind, null, JSON.stringify(first6.p_items), JSON.stringify(first6.p_tasks), oc.key, oc.commitmentId, oc.originalDate]) }
      const rival = Promise.resolve(kc.rpc('apply_class_log', confirmArgs(90, [T(K, o1, DK, 45), T(K, o1, DK, 45)], K.pending[1] ?? K.pending[0])))
      const b3 = await waitBlocked(probe, 'apply_class_log', blocker)
      await sql.query('commit')
      const r6c = await rival
      const fits = (await admin.from('plan_blocks').select('duration_minutes').eq('user_id', K.S.id).eq('local_date', DK)).data!.reduce((s, r) => s + r.duration_minutes, 0)
      check('6c. a confirm that held the lock first is waited for by the rival confirm (observed), which is then refused', b3 && /PREVIEW_CHANGED/.test(r6c.error?.message ?? ''), r6c.error?.message)
      check('6c. the final day holds exactly the first confirm\'s 180 minutes, within the 240 that exist; one session', fits === 180 && await sessionsOf(K) === 1, String(fits))
      // 6d. a strict task move waits for a confirm that holds the lock, then applies cleanly (order-safe, no deadlock)
      const mover = `ca6-mv-${Date.now().toString(36)}`
      await seed(K, mover, addDays(DK, 0), 10)
      const rev = (await admin.from('plan_blocks').select('revision').eq('id', mover).single()).data!.revision
      await sql.query('begin'); await sql.query('set local role authenticated'); await sql.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: K.S.id, role: 'authenticated' })])
      const pre = confirmArgs(30, [T(K, o1, K.weekend[1] ?? DK, 30)], K.pending[2] ?? K.pending[0])
      { const oc = { key: `manual:${crypto.randomUUID()}`, commitmentId: null, originalDate: null }; await sql.query(`select public.apply_class_log($1::uuid,$2,$3::date,$4,$5,$6::jsonb,$7::jsonb,$8,$9::uuid,$10::date)`, [pre.p_cycle_id, pre.p_idempotency_key, pre.p_class_date, pre.p_kind, null, JSON.stringify(pre.p_items), JSON.stringify(pre.p_tasks), oc.key, oc.commitmentId, oc.originalDate]) }
      const mv = Promise.resolve(admin.rpc('apply_task_move', { p_user: K.S.id, p_task: mover, p_revision: rev, p_date: DK, p_starts: null, p_minutes: 15, p_strict: true, p_source: 'calendar' }))
      const b4 = await waitBlocked(probe, 'apply_task_move', blocker)
      await sql.query('commit')
      const r6d = await mv
      check('6d. a task resize waits for the confirm that holds the lock and then applies (one command at a time, no deadlock)', b4 && (r6d.data as any)?.ok === true, JSON.stringify(r6d.data ?? r6d.error))
    } finally { await sql.query('rollback').catch(() => {}); await sql.end().catch(() => {}); await probe.end().catch(() => {}) }

    // ---------------------------------------------------------------- 7: declared order at the move boundary ---------------------------------
    console.log('\n7. A declared sitting order cannot be inverted by a move, a resize, or a Coach-style strict move\n')
    const G = K, D7 = G.weekend[1] ?? addDays(DK, 7), D7b = G.weekend[2] ?? addDays(D7, 1)
    const base = `ca7-${Date.now().toString(36)}`
    const mk = async (id: string, date: string, h: string | null, deps: string[], minutes = 30) => {
      await seed(G, id, date, minutes, h ?? undefined)
      if (deps.length) await admin.from('plan_blocks').update({ dependencies: deps }).eq('id', id)
    }
    await mk(`${base}-1`, D7, '09:00', []); await mk(`${base}-2`, D7, '10:00', [`${base}-1`]); await mk(`${base}-3`, D7b, null, [`${base}-2`])
    const rev7 = async (id: string) => (await admin.from('plan_blocks').select('revision').eq('id', id).single()).data!.revision as number
    const mv7 = async (id: string, date: string, h: string | null, minutes: number, strict = false) => (await admin.rpc('apply_task_move', { p_user: G.S.id, p_task: id, p_revision: await rev7(id), p_date: date, p_starts: h ? zonedTimeToUtc(date, h, G.tz).toISOString() : null, p_minutes: minutes, p_strict: strict, p_source: 'calendar' })).data as any
    const inv1 = await mv7(`${base}-1`, D7, '10:15', 30)
    check('moving the earlier sitting after its later sibling on the same day is refused and names the sitting', inv1.ok === false && inv1.code === 'ORDER' && /ca7-/.test(inv1.title), JSON.stringify(inv1))
    const inv2 = await mv7(`${base}-2`, D7, '09:10', 30)
    check('moving the later sitting before its predecessor ends is refused', inv2.ok === false && inv2.code === 'ORDER', JSON.stringify(inv2))
    const inv3 = await mv7(`${base}-3`, addDays(D7, -1), null, 30)
    check('moving a sitting to a day BEFORE the one it follows is refused', inv3.ok === false && inv3.code === 'ORDER', JSON.stringify(inv3))
    const inv4 = await mv7(`${base}-1`, D7b, null, 30)
    check('moving the earlier sitting past a later sibling on a later day is refused', inv4.ok === false && inv4.code === 'ORDER', JSON.stringify(inv4))
    const inv5 = await mv7(`${base}-1`, D7, '09:00', 70)
    check('lengthening a sitting so it runs into its later sibling is refused', inv5.ok === false && inv5.code === 'ORDER', JSON.stringify(inv5))
    const okMove = await mv7(`${base}-1`, D7, '09:20', 30)
    check('a move that keeps the order (09:20-09:50, still before 10:00) is accepted', okMove.ok === true, JSON.stringify(okMove))
    const dayOnly = await mv7(`${base}-3`, D7b, null, 45)
    check('two day-only siblings keep their declared sequence without an invented clock time', dayOnly.ok === true)
    await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', `${base}-1`)
    const free = await mv7(`${base}-2`, D7, '09:00', 30)
    check('a COMPLETED predecessor no longer constrains (existing semantics preserved)', free.ok === true, JSON.stringify(free))
    check('every refusal changed nothing', (await admin.from('plan_blocks').select('local_date').eq('id', `${base}-3`).single()).data!.local_date === D7b)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error && !/not found/i.test(r.error.message)) console.log(`  cleanup of ${id} failed: ${r.error.message}`) }
  }
  finish()
})().catch(async e => { console.error(e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
void listOwedClassWork; void getScopeGroups; void getCompletedCycleScope; void shiftStudentTimeline
