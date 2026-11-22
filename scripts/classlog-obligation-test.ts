/**
 * Phase 1 completion: follow-up work that never received a task is a DURABLE obligation. Real HTTP + Postgres; ordinary throwaway class-led students
 * (registered at creation, deleted in `finally`); the weekly rollover uses the recorded time fixture (whole weeks, run-owned students only).
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/classlog-obligation-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { previewClassLogK as previewClassLog } from './lib/classKeys'
import { listOwedClassWork } from '../src/lib/planning/classlog/carry'
import { getScopeGroups } from '../src/lib/planning/taskScopeService'
import { getCompletedCycleScope } from '../src/lib/tests/completedScopeService'
import { shiftStudentTimeline } from './lib/timeFixture'
import { addDays, todayInZone, weekdayOf } from '../src/lib/planning/studyWeek'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
let n = 0
const key = () => `co-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const TZ = 'Europe/London'
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3141'

async function fresh(tag: string, maxSitting = 45) {
  const persona = await classLedPersona(admin)
  const S = await createStudent(admin, tag, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  await admin.from('profiles').update({ max_session_minutes: maxSitting }).eq('id', S.id)
  const cyc0 = (await admin.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single()).data!
  const t0 = todayInZone((cyc0.timezone as string) || TZ)
  await admin.from('planning_cycles').update({ starts_at_local: addDays(t0, -9), ends_at_local: addDays(t0, 9) }).eq('id', cyc0.id)
  await admin.from('plan_blocks').delete().eq('user_id', S.id).eq('cycle_id', cyc0.id)
  const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('id', cyc0.id).single()).data!
  const ctx = (await S.s.json('/api/class-log/context')).body.context
  return { S, cycle, tz: (cycle.timezone as string) || TZ, pending: (ctx.pendingDates as string[]).slice().sort() }
}
type Fresh = Awaited<ReturnType<typeof fresh>>
/** Windows: `perDay` minutes from 09:00 on every day (0 = none). */
const windows = async (F: Fresh, perDay: number, only?: number[]) => {
  await admin.from('availability_windows').delete().eq('user_id', F.S.id)
  if (perDay > 0) {
    const end = `${String(9 + Math.floor(perDay / 60)).padStart(2, '0')}:${String(perDay % 60).padStart(2, '0')}`
    await admin.from('availability_windows').insert((only ?? [0, 1, 2, 3, 4, 5, 6]).map(weekday => ({ user_id: F.S.id, weekday, start_time: '09:00', end_time: end, status: 'active' })))
  }
}
const log = async (F: Fresh, classDate: string, outcomeId: string, extent: 'full' | 'part' = 'full', note?: string) => {
  const body = { classDate, kind: 'covered', items: [{ outcomeId, extent, ...(note ? { portionNote: note } : {}) }] } as any
  const pv = await previewClassLog(F.S.id, body); if (!pv.ok) throw new Error(pv.message)
  const c = await F.S.s.post('/api/class-log/confirm', { ...body, idempotencyKey: key(), fingerprint: pv.fingerprint })
  return { pv, c, sid: c.body?.sessionId as string }
}
const bigOutcome = async (F: Fresh, minTotal = 90): Promise<string> => {
  await windows(F, 240)
  const rs = (await admin.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(60)).data ?? []
  for (const r of rs) {
    const los = (await admin.from('reading_los').select('id').eq('reading_id', r.id).order('sequence').limit(1)).data ?? []
    if (!los[0]) continue
    const p = await previewClassLog(F.S.id, { classDate: F.pending[0], kind: 'covered', items: [{ outcomeId: los[0].id as string, extent: 'full' }] })
    if (p.ok && p.summary.placedMinutes + p.summary.remainingMinutes >= minTotal) return los[0].id as string
  }
  throw new Error('no outcome of that size')
}
const itemOf = async (sid: string, o: string) => (await admin.from('class_session_items').select('planned_minutes, extent').eq('session_id', sid).eq('outcome_id', o).single()).data!
const tasksOf = async (sid: string, o: string) => (await admin.from('plan_blocks').select('id, cycle_id, local_date, duration_minutes, sitting_ordinal, dependencies, scope_group_id, class_session_id, execution, continued_from_task_id, cancelled_at').eq('class_session_id', sid).eq('outcome_id', o).order('sitting_ordinal')).data!
const sum = (rows: { duration_minutes: number }[]) => rows.reduce((s, r) => s + r.duration_minutes, 0)

/** Closes the student's active cycle through the real weekly command: every sitting is marked done first (a fixture), the cycle is a closed past week. */
async function rollOver(F: Fresh, shifted: { n: number }) {
  const cyc = (await admin.from('planning_cycles').select('id').eq('user_id', F.S.id).eq('status', 'active').single()).data!.id as string
  await admin.from('plan_blocks').update({ execution: 'completed' }).eq('cycle_id', cyc).is('cancelled_at', null)
  const shift = await shiftStudentTimeline(F.S.id, 1, owned); shifted.n++
  await admin.from('planning_cycles').update({ starts_at_local: addDays(todayInZone(F.tz), -7), ends_at_local: addDays(todayInZone(F.tz), -1) }).eq('id', cyc)
  const pv = await F.S.s.post('/api/weekly-review/preview', { cycleId: cyc, choices: {}, acknowledgeNoPaper: true })
  const ac = pv.body?.ok ? await F.S.s.post('/api/weekly-review/accept', { draftId: pv.body.draftId }) : pv
  return { pv, ac, shift }
}

;(async () => {
  await preflightServer()
  try {
    // ---------------------------------------------------------------- 1: zero room -> reload -> rollover with NO further class log ------------
    console.log('\n1. No room at all: the obligation is saved, stays visible after reload, and is placed by the weekly review without another class log\n')
    const Z = await fresh('co1', 45)
    const O = await bigOutcome(Z, 60)
    await windows(Z, 0)
    const z = await log(Z, Z.pending[0], O)
    check('with no free time at all the class entry is still saved (the student reported real work), with no task', z.c.body?.ok === true && z.pv.tasks.length === 0 && z.pv.summary.remainingMinutes > 0, JSON.stringify(z.c.body).slice(0, 200))
    const planned = (await itemOf(z.sid, O)).planned_minutes as number
    check('the planned obligation is stored on the item, equal to the minutes owed (nothing lost)', planned > 0 && planned === z.pv.summary.remainingMinutes, `${planned}/${z.pv.summary.remainingMinutes}`)
    let owed = await listOwedClassWork(Z.S.id)
    check('it is discoverable without logging another class: the follow-up reader lists the exact minutes, 0 allocated', owed.length === 1 && owed[0].remainingMinutes === planned && owed[0].allocatedMinutes === 0, JSON.stringify(owed))
    const page = async (path: string) => (await (await Z.S.s.req(path)).text()).replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '')
    const cal = { text: await page('/app/calendar') }, home = { text: await page('/app') }
    check('Calendar names the waiting minutes (reload-safe: a fresh request)', /calendar-owed-class-work/.test(String(cal.text ?? '')) && new RegExp(`${planned} min of class follow-up`).test(String(cal.text ?? '')))
    check('Home does not say "nothing is planned" while an actionable obligation is waiting', /class follow-up/i.test(String(home.text ?? '')) && !/Nothing is planned today/.test(String(home.text ?? '')))
    const g0 = (await admin.from('plan_blocks').select('id').eq('class_session_id', z.sid)).data!.length
    check('(setup) zero tasks exist for the item', g0 === 0)

    await windows(Z, 240)
    const shifted = { n: 0 }
    const r1 = await rollOver(Z, shifted)
    check('the real weekly command closes the week', r1.pv.body?.ok === true && r1.ac.body?.ok === true, JSON.stringify(r1.pv.body).slice(0, 300))
    check('the weekly review proposed the owed class work as next-week sittings (reviewed, then accepted)', (r1.pv.body.classFollowUp?.placed ?? []).length >= 1, JSON.stringify(r1.pv.body.classFollowUp))
    const placed1 = await tasksOf(z.sid, O)
    check('the sittings exist in the NEXT cycle, each at or below the 45-minute limit, summing to exactly the obligation', placed1.length >= 1 && placed1.every(t => t.duration_minutes <= 45 && t.cycle_id !== Z.cycle.id) && sum(placed1 as any) === planned, `${sum(placed1 as any)}/${planned}`)
    check('their order is declared (ordinals 1..n, each depending on the one before) and they share one scope group', placed1.every((t, i) => t.sitting_ordinal === i + 1 && (i === 0 ? t.dependencies.length === 0 : t.dependencies[0] === placed1[i - 1].id)) && new Set(placed1.map(t => t.scope_group_id)).size === 1 && !!placed1[0].scope_group_id)
    owed = await listOwedClassWork(Z.S.id)
    check('nothing is owed any more, and no continuation duplicated the original obligation', owed.length === 0 && placed1.every(t => t.continued_from_task_id === null))
    check('no second attendance: still exactly one class session', (await admin.from('class_sessions').select('id').eq('user_id', Z.S.id)).data!.length === 1)
    const grp = (await getScopeGroups(Z.S.id, [placed1[0].scope_group_id as string])).get(placed1[0].scope_group_id as string)!
    check('finishing NONE of the sittings leaves the scope incomplete; the group counts the ACTUAL members', grp.expected === Math.max(2, placed1.length) && grp.complete === false && grp.owedMinutes === 0, JSON.stringify(grp))

    // ---------------------------------------------------------------- 2: partial room, two successive rollovers, a changed limit ------------
    console.log('\n2. Partial room, then two successive rollovers, with the sitting limit changed between placements\n')
    const P = await fresh('co2', 45)
    const OP = await bigOutcome(P, 100)
    await windows(P, 15, [6])   // only Saturdays, 15 minutes: little room
    const first = await log(P, P.pending[0], OP, 'part', 'the first half')
    const plannedP = (await itemOf(first.sid, OP)).planned_minutes as number
    let have = await tasksOf(first.sid, OP)
    check('partial room: some sittings placed now, the exact remainder owed (placed + owed = planned)', have.length >= 1 && sum(have as any) > 0 && sum(have as any) < plannedP && (await listOwedClassWork(P.S.id))[0]?.remainingMinutes === plannedP - sum(have as any), `${sum(have as any)}/${plannedP}`)
    const firstPlaced = sum(have as any)
    await windows(P, 25, [6])
    await admin.from('profiles').update({ max_session_minutes: 20 }).eq('id', P.S.id)   // the pace/limit changes between placements
    const r2 = await rollOver(P, shifted)
    const afterFirst = await tasksOf(first.sid, OP)
    const second = afterFirst.filter(t => !have.some(h => h.id === t.id))
    check('first rollover (no new class log): places what the 25-minute window allows, every sitting at the NEW 20-minute limit', r2.ac.body?.ok === true && second.length >= 1 && second.every(t => t.duration_minutes <= 20), JSON.stringify(r2.pv.body?.classFollowUp))
    const stillOwed = (await listOwedClassWork(P.S.id))[0]
    check('the changed limit did not rewrite the obligation: planned stays, owed = planned - allocated exactly', (await itemOf(first.sid, OP)).planned_minutes === plannedP && stillOwed?.remainingMinutes === plannedP - sum(afterFirst as any), JSON.stringify(stillOwed))
    check('ordinals continue 1..n across the weeks with a declared chain, never reusing a number', afterFirst.every((t, i) => t.sitting_ordinal === i + 1) && afterFirst.slice(1).every((t, i) => t.dependencies[0] === afterFirst[i].id))
    await windows(P, 240)
    const r3 = await rollOver(P, shifted)
    const all = await tasksOf(first.sid, OP)
    check('second rollover places the rest: the allocation now equals the planned obligation EXACTLY (no work disappeared, none doubled)', r3.ac.body?.ok === true && sum(all as any) === plannedP && (await listOwedClassWork(P.S.id)).length === 0, `${sum(all as any)}/${plannedP}`)
    check('(setup) the obligation took three placements: now, rollover one, rollover two', firstPlaced > 0 && second.length >= 1 && all.length > afterFirst.length)
    // completion: finishing every sitting finishes the group only now that nothing is owed
    await admin.from('plan_blocks').update({ execution: 'completed' }).eq('class_session_id', first.sid).eq('outcome_id', OP)
    const gid = all[0].scope_group_id as string
    const done = (await getScopeGroups(P.S.id, [gid])).get(gid)!
    check('all sittings done AND nothing owed: the sittings group is complete', done.complete === true && done.owedMinutes === 0, JSON.stringify(done))
    const scope = await getCompletedCycleScope(P.S.id, new Date(Date.now() + 60_000))
    check('...but a PART stays pending: completing its consolidation never unlocks the whole outcome', !scope.targets.some(t => t.outcomeId === OP) && scope.pendingPortions.some(x => x.outcomeId === OP))

    // ---------------------------------------------------------------- 3: finishing every placed sitting while remainder exists ---------------
    console.log('\n3. Finishing every PLACED sitting while some work still has no task must not finish the obligation\n')
    const Q = await fresh('co3', 45)
    const OQ = await bigOutcome(Q, 100)
    await windows(Q, 15, [6])
    const q = await log(Q, Q.pending[0], OQ, 'part', 'the first half')
    const qp = (await itemOf(q.sid, OQ)).planned_minutes as number, qt = await tasksOf(q.sid, OQ)
    await admin.from('plan_blocks').update({ execution: 'completed' }).eq('class_session_id', q.sid)
    const qg = qt[0]?.scope_group_id as string
    const qs = qg ? (await getScopeGroups(Q.S.id, [qg])).get(qg)! : null
    check('every placed sitting is completed, yet work is still owed: the scope is NOT complete (owed minutes reported)', !!qs && qs.complete === false && qs.owedMinutes === qp - sum(qt as any) && qs.owedMinutes > 0, JSON.stringify(qs))
    const sc = await getCompletedCycleScope(Q.S.id, new Date(Date.now() + 60_000))
    check('...and the PART is not testable from that alone (pending until the whole outcome is explicitly confirmed)', !sc.targets.some(t => t.outcomeId === OQ) && sc.pendingPortions.some(x => x.outcomeId === OQ))
    // a removed (cancelled) sitting does not silently assert coverage: its minutes are owed again
    if (qt.length) {
      await admin.from('plan_blocks').update({ execution: 'not_started' }).eq('id', qt[0].id)
      await admin.from('plan_blocks').update({ cancelled_at: new Date().toISOString(), execution: 'cancelled' }).eq('id', qt[0].id)
      const again = (await listOwedClassWork(Q.S.id))[0]
      check('cancelling a sitting returns its minutes to the obligation (it is never counted as covered)', again?.remainingMinutes === qp - sum(qt.slice(1) as any), JSON.stringify(again))
    }

    // ---------------------------------------------------------------- 4: two classes, one outcome ---------------------------------------------
    console.log('\n4. Two classes covering the same outcome are two events\n')
    const W = await fresh('co4', 45)
    const OW = await bigOutcome(W, 60)
    await windows(W, 0)
    const a = await log(W, W.pending[0], OW), b = W.pending[1] ? await log(W, W.pending[1], OW) : null
    const ow = await listOwedClassWork(W.S.id)
    check('each class keeps its own obligation: two distinguishable items for one outcome (session plus outcome identity)', !!b && ow.length === 2 && new Set(ow.map(o => o.sessionId)).size === 2 && ow.every(o => o.outcomeId === OW), JSON.stringify(ow))
    const retry = b ? await W.S.s.post('/api/class-log/confirm', { classDate: W.pending[1], kind: 'covered', items: [{ outcomeId: OW, extent: 'full' }], idempotencyKey: 'x', fingerprint: 'stale' }) : null
    check('a stale or repeated request never turns one event into two', (await admin.from('class_sessions').select('id').eq('user_id', W.S.id)).data!.length === 2 && retry?.body?.ok !== true)
    await windows(W, 240)
    const r4 = await rollOver(W, shifted)
    const ta = await tasksOf(a.sid, OW), tb = await tasksOf(b!.sid, OW)
    check('the weekly review places BOTH, each against its own session and its own planned minutes', r4.ac.body?.ok === true && sum(ta as any) === (await itemOf(a.sid, OW)).planned_minutes && sum(tb as any) === (await itemOf(b!.sid, OW)).planned_minutes && !ta.some(t => tb.some(u => u.id === t.id)))
    // A pre-upgrade item still in the open cycle must survive its first rollover. Its reviewed estimate is stamped only on acceptance.
    const L = await fresh('colegacy', 45)
    const OL = await bigOutcome(L, 60)
    await windows(L, 0)
    const legacy = await log(L, L.pending[0], OL)
    await admin.from('class_session_items').update({ planned_minutes: null }).eq('session_id', legacy.sid).eq('outcome_id', OL).throwOnError()
    const legacyOwed = (await listOwedClassWork(L.S.id))[0]
    check('an open-cycle pre-upgrade item has a visible estimate without a read writing it', !!legacyOwed && (await itemOf(legacy.sid, OL)).planned_minutes === null)
    await windows(L, 240)
    const legacyTransition = await rollOver(L, shifted)
    const legacyTasks = await tasksOf(legacy.sid, OL)
    check('a reviewed legacy obligation can cross its first week boundary and is stamped atomically', legacyTransition.ac.body?.ok === true
      && (await itemOf(legacy.sid, OL)).planned_minutes === legacyOwed.plannedMinutes
      && sum(legacyTasks as any) === legacyOwed.plannedMinutes, JSON.stringify(legacyTransition.ac.body))
    check('(proof of the shifts used)', shifted.n >= 4)
    void weekdayOf; void home
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error && !/not found/i.test(r.error.message)) console.log(`  cleanup of ${id} failed: ${r.error.message}`) }
  }
  finish()
})().catch(async e => { console.error(e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
void BASE
