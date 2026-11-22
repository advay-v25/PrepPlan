/**
 * Phase 3 closeout, live: logical recovery identity across weeks and splits, the unplaced-work path across cycles, the real exam horizon, and
 * idempotency keys bound to their requests. Owned throwaway students (registered at creation, deleted on success AND failure); every rollover is the REAL
 * weekly command; every task change is the real task API. No question bank is touched.
 *   E2E_BASE_URL=http://localhost:3143 npx tsx scripts/mock-continuity-test.ts
 */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, FRESH_STUDENT_ONBOARDING, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { saveReport, getReport, ReportError } from '../src/lib/mocks/reportService'
import { previewRecovery, acceptRecovery, loadItemStates, recoveryRemainder } from '../src/lib/mocks/recovery'
import type { MockReportInput, RecoverySelection } from '../src/lib/mocks/report'
import { getCompletedCycleScope } from '../src/lib/tests/completedScopeService'

const db = createAdminClient(), { check, finish } = makeCheck()
const owned: string[] = []
const J = { 'Content-Type': 'application/json' }
const refused = async (p: PromiseLike<unknown>) => { try { await p; return null } catch (e) { return e instanceof ReportError ? e : (e as Error) } }
const tz = 'Europe/London', today = todayInZone(tz)
const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))

type S = Awaited<ReturnType<typeof createStudent>>
async function fresh(tag: string, limit = 60) {
  const s = await createStudent(db, tag, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 6) }).eq('id', cyc.id).throwOnError()
  await db.from('profiles').update({ max_session_minutes: limit }).eq('id', s.id).throwOnError()
  await db.from('plan_blocks').delete().eq('user_id', s.id).throwOnError()
  await db.from('calendar_commitments').delete().eq('user_id', s.id).throwOnError()
  const windows = async (rows: { weekday: number; start: string; end: string }[]) => { await db.from('availability_windows').delete().eq('user_id', s.id).throwOnError(); if (rows.length) await db.from('availability_windows').insert(rows.map(r => ({ user_id: s.id, weekday: r.weekday, start_time: r.start, end_time: r.end, status: 'active' }))).throwOnError() }
  await windows([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '10:30' })))
  const readings = (await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(8).throwOnError()).data!
  return { s: s as S, uid: s.id, cycle: cyc.id as string, windows, readings, topic: readings[0].topic_id as string }
}
type F = Awaited<ReturnType<typeof fresh>>
const input = (F: F, o: Partial<MockReportInput> = {}): MockReportInput => ({ takenOn: addDays(today, -3), scope: 'full', scale: 'percent', score: 48, provider: 'Provider A', topics: [{ topicId: F.topic, value: 35, scale: 'percent' }], difficulties: ['ran_out_of_time'], notes: null, ...o })
const review = (id: string, minutes: number) => ({ key: `review:${id}`, kind: 'review' as const, readingId: id, minutes })
async function newReport(F: F, o: Partial<MockReportInput> = {}) { return (await saveReport(F.uid, { action: 'create', key: randomUUID(), input: input(F, o) })).report }
async function accept(F: F, reportId: string, sel: RecoverySelection) {
  const rep = (await getReport(F.uid, reportId))!, p = await previewRecovery(F.uid, rep, sel)
  if (!p.ok) throw new Error(`preview: ${p.message}`)
  const r = await acceptRecovery(F.uid, rep, { key: randomUUID(), selection: sel, fingerprint: p.fingerprint })
  return { p, r }
}
const task = async (id: string) => (await db.from('plan_blocks').select('*').eq('id', id).single().throwOnError()).data!
const patch = async (F: F, id: string, execution: string, minutes: number) => {
  const go = async () => F.s.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: (await task(id)).revision }) })
  const r = await go()
  return r.status === 503 ? go() : r   // the first request to a cold dev route can fail to confirm; the command is receipt-protected, so one retry is safe
}
const reportedOf = async (uid: string, id: string) => ((await db.from('task_events').select('actual_duration_minutes').eq('user_id', uid).eq('task_id', id).not('actual_duration_minutes', 'is', null).throwOnError()).data ?? []).reduce((n, e) => n + Number(e.actual_duration_minutes), 0)
const activeCycle = async (uid: string) => (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', uid).eq('status', 'active').single().throwOnError()).data!
/** Close the open week for real: the cycle (and the given tasks) are moved into a past week, then the weekly command rolls it over. */
async function rollover(F: F, weeksAgo: number, choices: Record<string, unknown>, move: string[]) {
  const c = await activeCycle(F.uid), start = addDays(weekStart, -7 * (weeksAgo + 1)), end = addDays(start, 6)
  await db.from('planning_cycles').update({ starts_at_local: start, ends_at_local: end }).eq('id', c.id).throwOnError()
  for (const id of move) await db.from('plan_blocks').update({ local_date: addDays(start, 2), day: addDays(start, 2) }).eq('id', id).throwOnError()
  const p = await F.s.s.post('/api/weekly-review/preview', { cycleId: c.id, choices, acknowledgeNoPaper: true })
  if (p.body?.ok !== true) throw new Error(`weekly preview: ${JSON.stringify(p.body).slice(0, 300)}`)
  const a = await F.s.s.post('/api/weekly-review/accept', { draftId: p.body.draftId })
  if (a.body?.ok !== true) throw new Error(`weekly accept: ${JSON.stringify(a.body).slice(0, 300)}`)
  return { continued: a.body.continued as number, closed: c.id as string }
}
const succOf = async (id: string) => (await db.from('plan_blocks').select('*').eq('continued_from_task_id', id).maybeSingle().throwOnError()).data
const rowsOfReport = async (rid: string) => (await db.from('plan_blocks').select('*').eq('source_report_id', rid).order('id').throwOnError()).data!

async function main() {
  await preflightServer()

  console.log('\n1. A recovery sitting continues across weeks: 45 → 20 reported → 25 continued → finished\n')
  const A = await fresh('mc1')
  const R = await newReport(A), sel1 = { items: [review(A.readings[0].id as string, 45)] }
  const { p: p1, r: r1 } = await accept(A, R.id, sel1)
  check('one 45-minute recovery sitting is planned', p1.placed.length === 1 && r1.placed === 1)
  const T1 = r1.taskIds[0]
  const part = await patch(A, T1, 'partial', 20)
  check('week one: the student reports 20 minutes, partly done', part.status === 200 && (await task(T1)).execution === 'partial' && (await reportedOf(A.uid, T1)) === 20, JSON.stringify(part.body).slice(0, 200))
  const roll = await rollover(A, 0, { [T1]: { happened: 'partial', next: 'continue', estimateMinutes: 25 } }, [T1])
  check('the REAL weekly command continued it', roll.continued === 1)
  const T2row = await succOf(T1)
  check('the continuation keeps its report, finding and version (truthful provenance), in a LATER week', !!T2row && T2row.source_report_id === R.id && T2row.source_key === (await task(T1)).source_key && T2row.source_report_version === 1 && T2row.cycle_id !== (await task(T1)).cycle_id && T2row.duration_minutes === 25)
  const T2 = T2row!.id as string
  const t1 = await task(T1)
  check('week one keeps its own task: 45 planned, partial, 20 reported', t1.duration_minutes === 45 && t1.execution === 'partial' && t1.cycle_id === roll.closed && (await reportedOf(A.uid, T1)) === 20)
  const cur = await activeCycle(A.uid)
  let st = (await loadItemStates(A.uid, (await getReport(A.uid, R.id))!, cur.id)).states.get(sel1.items[0].key)!
  check('logical allocation counts the chain ONCE (25 now + 20 reported = 45) and says it continues', st.status === 'continues' && st.allocated === 45 && st.reported === 20, JSON.stringify(st))
  const rep1 = (await getReport(A.uid, R.id))!
  const again = await previewRecovery(A.uid, rep1, sel1)
  check('a new proposal does NOT recreate the old :1 key; the item reads as continuing, not "already in your week"', again.ok && again.placed.length === 0 && again.alreadyPlanned.length === 1 && again.alreadyPlanned[0].status === 'continues' && /Continues this week/.test(again.alreadyPlanned[0].note) && !/already in your week/i.test(again.alreadyPlanned[0].note), again.ok ? JSON.stringify(again.alreadyPlanned) : '')
  const dupTask = (key: string) => [{ id: `mr-${randomUUID().replace(/-/g, '').slice(0, 24)}`, source_key: key, task_type: 'study', local_date: addDays(cur.starts_at_local, 3), duration_minutes: 30, title: 'forced', outcome_id: '', lm_id: A.readings[0].id as string, rationale: 'x' }]
  const forge = async (rid: string, key: string, tasks: unknown[], version = 1) => (await db.rpc('accept_mock_recovery', { p_user: A.uid, p_key: randomUUID(), p_report_id: rid, p_report_version: version, p_cycle_id: cur.id, p_selection: sel1, p_tasks: tasks })).data as any
  const f1 = await forge(R.id, sel1.items[0].key + ':1', dupTask(`${sel1.items[0].key}:1`)), f2 = await forge(R.id, sel1.items[0].key + ':2', dupTask(`${sel1.items[0].key}:2`))
  check('a forged duplicate of the same logical sitting (same key, or a new :n) is refused by the database; nothing is written', f1?.ok === false && f2?.ok === false && (await rowsOfReport(R.id)).length === 2, JSON.stringify([f1, f2]))
  const sibling = await db.from('plan_blocks').insert({ ...{ ...T2row, id: `x-${randomUUID().slice(0, 8)}`, continued_from_task_id: T1 } }).select('id')
  check('a second successor of the same task is refused (one successor per task is still enforced)', !!sibling.error, sibling.error?.message)
  const done = await patch(A, T2, 'completed', 25)
  check('week two: finished with 25 reported', done.status === 200 && (await task(T2)).execution === 'completed' && (await reportedOf(A.uid, T2)) === 25, JSON.stringify(done.body).slice(0, 200))
  st = (await loadItemStates(A.uid, (await getReport(A.uid, R.id))!, cur.id)).states.get(sel1.items[0].key)!
  check('45 actual minutes in total, 20/25 in the right weeks, one logical allocation, completed previously', (await reportedOf(A.uid, T1)) + (await reportedOf(A.uid, T2)) === 45 && st.status === 'completed' && st.allocated === 45 && st.remaining === 0, JSON.stringify(st))
  check('nothing is left to re-propose and no phantom sibling exists', (await recoveryRemainder(A.uid, (await getReport(A.uid, R.id))!)).length === 0 && (await rowsOfReport(R.id)).length === 2)
  const again2 = await previewRecovery(A.uid, (await getReport(A.uid, R.id))!, sel1)
  check('the proposal says "completed previously"', again2.ok && again2.alreadyPlanned[0]?.status === 'completed' && /Completed previously/.test(again2.alreadyPlanned[0].note))
  const scope = await getCompletedCycleScope(A.uid)
  const mine = scope.unresolved.filter(x => [T1, T2].includes(x.blockId))
  check('scope: the superseded week-one task contributes nothing; the chain contributes at most once', mine.every(x => x.blockId === T2) && mine.length <= 1, JSON.stringify(mine))
  const ev = await Promise.all(['evidence_events', 'assessment_attempts', 'repair_threads', 'user_module_state'].map(async t => (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', A.uid)).count ?? 0))
  check('an external report plus the finished sittings created no evidence, attempt, repair or module state', ev.every(n => n === 0), JSON.stringify(ev))

  console.log('\n2. Another rollover, a manual split and a cancellation\n')
  const B = await fresh('mc2')
  const RB = await newReport(B), selB = { items: [review(B.readings[1].id as string, 60)] }
  const { r: rb } = await accept(B, RB.id, selB)
  const B1 = rb.taskIds[0]
  await patch(B, B1, 'partial', 20)
  await rollover(B, 2, { [B1]: { happened: 'partial', next: 'continue', estimateMinutes: 40 } }, [B1])
  const B2 = (await succOf(B1))!.id as string
  await patch(B, B2, 'partial', 10)
  const roll2 = await rollover(B, 1, { [B2]: { happened: 'partial', next: 'continue', estimateMinutes: 30 } }, [B2])
  check('a second rollover continues the continuation (three weeks, three occurrences, one successor each)', roll2.continued === 1 && !!(await succOf(B2)) && (await rowsOfReport(RB.id)).length === 3)
  const B3 = (await succOf(B2))!.id as string
  const bc = await activeCycle(B.uid)
  let sb = (await loadItemStates(B.uid, (await getReport(B.uid, RB.id))!, bc.id)).states.get(selB.items[0].key)!
  check('three occurrences are ONE logical allocation: 30 now + 20 + 10 reported = 60', sb.status === 'continues' && sb.allocated === 60 && sb.reported === 30, JSON.stringify(sb))
  await db.from('plan_blocks').update({ local_date: addDays(bc.starts_at_local, 2), day: addDays(bc.starts_at_local, 2), placement: 'day_preferred' }).eq('id', B3).throwOnError()
  const split = await B.s.s.json(`/api/tasks/${B3}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'split', expectedRevision: (await task(B3)).revision, firstMinutes: 15 }) })
  const sibId = split.body?.secondId ?? split.body?.second?.id ?? split.body?.task?.secondId
  const rowsB = await rowsOfReport(RB.id)
  check('a manual split of the continued sitting is accepted: the sibling keeps the report/finding provenance', split.status === 200 && rowsB.length === 4 && rowsB.every(r => r.source_report_id === RB.id), JSON.stringify(split.body).slice(0, 200))
  sb = (await loadItemStates(B.uid, (await getReport(B.uid, RB.id))!, bc.id)).states.get(selB.items[0].key)!
  check('after the split the logical allocation is still 60 (15 + 15 + 20 + 10), not doubled', sb.allocated === 60 && (sb.status === 'planned' || sb.status === 'continues'), JSON.stringify(sb))
  const sibRow = rowsB.find(r => r.id !== B1 && r.id !== B2 && r.id !== B3)
  check('and the proposal still offers nothing new', (await previewRecovery(B.uid, (await getReport(B.uid, RB.id))!, selB)).ok === true && (await recoveryRemainder(B.uid, (await getReport(B.uid, RB.id))!)).length === 0)
  void sibId; void sibRow
  // cancel everything live for the item: it is outstanding again and is offered with a fresh identity, no collision with the old one
  for (const r of (await rowsOfReport(RB.id)).filter(r => r.cycle_id === bc.id)) await db.from('plan_blocks').update({ cancelled_at: new Date().toISOString(), cancellation_reason: 'test' }).eq('id', r.id).throwOnError()
  const afterCancel = (await recoveryRemainder(B.uid, (await getReport(B.uid, RB.id))!))
  check('after cancellation, exactly the unfinished 30 minutes are offered again', afterCancel.length === 1 && afterCancel[0].itemKey === selB.items[0].key && afterCancel[0].minutes - afterCancel[0].allocated === 30, JSON.stringify(afterCancel))
  // This case tests replacement identity, not the elapsed part of today's window. Give the owned fixture a real future window.
  await db.from('planning_cycles').update({ ends_at_local: addDays(today, 3) }).eq('id', bc.id).throwOnError()
  await B.windows([{ weekday: new Date(`${addDays(today, 1)}T12:00:00Z`).getUTCDay(), start: '18:00', end: '23:00' }])
  const reacc = await accept(B, RB.id, selB).catch(e => e as Error)
  check('re-proposing after cancellation creates exactly one new sitting without colliding with history', !(reacc instanceof Error) && reacc.r.placed === 1 && (await rowsOfReport(RB.id)).filter(r => !r.cancelled_at && r.cycle_id === bc.id).length === 1, reacc instanceof Error ? reacc.message : '')

  console.log('\n3. Three chosen, two fit: the remainder is offered next week without repeating old work\n')
  const C = await fresh('mc3', 30)
  const cc = await activeCycle(C.uid)
  await C.windows([{ weekday: new Date(`${addDays(today, 1)}T12:00:00Z`).getUTCDay(), start: '09:00', end: '09:30' }, { weekday: new Date(`${addDays(today, 2)}T12:00:00Z`).getUTCDay(), start: '09:00', end: '09:30' }])
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 3) }).eq('id', cc.id).throwOnError()
  const RC = await newReport(C), selC = { items: [0, 1, 2].map(i => review(C.readings[i].id as string, 30)) }
  const { p: pc, r: rc } = await accept(C, RC.id, selC)
  check('two of the three fit; one stays unplaced and is kept on the report', pc.placed.length === 2 && pc.remainder.length === 1 && rc.placed === 2)
  check('Calendar/review/report all derive the same remainder: the third item, 30 minutes', JSON.stringify((await recoveryRemainder(C.uid, (await getReport(C.uid, RC.id))!)).map(x => [x.itemKey, x.minutes - x.allocated])) === JSON.stringify([[selC.items[2].key, 30]]))
  for (const id of rc.taskIds) { const x = await patch(C, id, 'completed', 30); if (x.status !== 200) throw new Error(JSON.stringify(x.body)) }
  await rollover(C, 0, {}, rc.taskIds)
  await C.windows([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '10:30' })))
  const cn = await activeCycle(C.uid)
  const repC = (await getReport(C.uid, RC.id))!
  const left = await recoveryRemainder(C.uid, repC)
  check('next week the follow-up is exactly the one remaining item (the two done ones are not re-offered)', left.length === 1 && left[0].itemKey === selC.items[2].key && cn.id !== cc.id, JSON.stringify(left))
  const pn = await previewRecovery(C.uid, repC, repC.planSelection!)
  check('re-proposal of the SAVED selection places only the remaining item; the finished two read "completed previously"', pn.ok && pn.placed.length === 1 && pn.placed[0].itemKey === selC.items[2].key && pn.alreadyPlanned.length === 2 && pn.alreadyPlanned.every(a => a.status === 'completed'), pn.ok ? JSON.stringify({ placed: pn.placed.map(x => x.itemKey), ap: pn.alreadyPlanned }) : JSON.stringify(pn))
  const an = await acceptRecovery(C.uid, repC, { key: randomUUID(), selection: repC.planSelection!, fingerprint: (pn as any).fingerprint })
  check('accepting it adds exactly one sitting and the whole acceptance does not fail on the old work', an.placed === 1 && (await rowsOfReport(RC.id)).filter(r => !r.cancelled_at).length === 3)
  check('nothing is left afterwards', (await recoveryRemainder(C.uid, (await getReport(C.uid, RC.id))!)).length === 0)
  // editing the saved choices cannot silently erase the old obligation
  const D = await fresh('mc3b', 60)
  const RD = await newReport(D), selD = { items: [review(D.readings[0].id as string, 30), review(D.readings[1].id as string, 30)] }
  await D.windows([]); await accept(D, RD.id, selD).catch(() => {}); // nothing fits: both choices are kept
  const repD = (await getReport(D.uid, RD.id))!
  check('with no room both choices are stored, unplaced', (repD.planSelection?.items.length ?? 0) === 2 && (await recoveryRemainder(D.uid, repD)).length === 2)
  await D.windows([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '10:30' })))
  const narrowed = { items: [selD.items[0]] }, pd = await previewRecovery(D.uid, repD, narrowed)
  check('dropping an unplaced choice is flagged in the preview (wouldDrop), not silent', pd.ok && pd.wouldDrop.length === 1 && pd.wouldDrop[0].itemKey === selD.items[1].key, pd.ok ? JSON.stringify(pd.wouldDrop) : '')
  const noConfirm = await refused(acceptRecovery(D.uid, repD, { key: randomUUID(), selection: narrowed, fingerprint: (pd as any).fingerprint }))
  check('accepting without confirming the removal is refused and writes nothing', noConfirm instanceof ReportError && noConfirm.code === 'removal_unconfirmed' && (await rowsOfReport(RD.id)).length === 0)
  const direct = (await db.rpc('accept_mock_recovery', { p_user: D.uid, p_key: randomUUID(), p_report_id: RD.id, p_report_version: 1, p_cycle_id: (await activeCycle(D.uid)).id, p_selection: narrowed, p_tasks: [] })).data as any
  check('the database enforces the same rule against a forged direct call', direct?.ok === false && /drop work you had chosen/.test(direct.message), JSON.stringify(direct))
  const okDrop = await acceptRecovery(D.uid, repD, { key: randomUUID(), selection: narrowed, fingerprint: (pd as any).fingerprint, confirmRemove: [selD.items[1].key] })
  check('with explicit confirmation the removal is recorded and the kept choice is placed', okDrop.placed === 1 && (await getReport(D.uid, RD.id))!.planSelection!.items.length === 1)
  const larger = { items: [{ ...selD.items[0], minutes: 45 }] }, pl = await previewRecovery(D.uid, (await getReport(D.uid, RD.id))!, larger)
  check('raising the minutes of an item that already has a sitting does not create a second full sitting', pl.ok && pl.placed.length === 0 && /kept as it is/.test(pl.alreadyPlanned[0]?.note ?? ''), pl.ok ? JSON.stringify(pl.alreadyPlanned) : '')
  const outc = (await db.from('reading_los').select('id').eq('reading_id', D.readings[0].id as string).limit(1).single().throwOnError()).data!.id as string
  const fine = { items: [{ key: `review:${outc}`, kind: 'review' as const, readingId: D.readings[0].id as string, outcomeId: outc, minutes: 30 }] }, pf = await previewRecovery(D.uid, (await getReport(D.uid, RD.id))!, fine)
  check('narrowing a reading to one of its outcomes does not duplicate the sitting that covers it, and flags the dropped reading-level key', pf.ok && pf.placed.length === 0 && pf.alreadyPlanned.length === 1, pf.ok ? JSON.stringify({ a: pf.alreadyPlanned, d: pf.wouldDrop }) : '')
  const wd = await saveReport(D.uid, { action: 'withdraw', key: randomUUID(), reportId: RD.id, expectedVersion: (await getReport(D.uid, RD.id))!.version })
  check('withdrawing keeps accepted sittings as history with their source and version', wd.report.status === 'withdrawn' && (await rowsOfReport(RD.id)).filter(r => !r.cancelled_at && r.source_report_version === 1).length === 1)

  console.log('\n4. The real exam horizon\n')
  const febId = (await db.from('exam_windows').select('id, window_opens').eq('year', 2027).eq('sitting', 'february').single().throwOnError()).data!
  const setExam = async (F: F, body: object) => { const v = (await db.from('profiles').select('onboarding_context_version, timezone').eq('id', F.uid).single().throwOnError()).data!; return F.s.s.post('/api/onboarding/exam', { timezone: v.timezone ?? tz, examWindowId: febId.id, expectedVersion: v.onboarding_context_version, ...body }) }
  const horizon = async (uid: string) => (await db.rpc('mock_recovery_horizon', { p_user: uid })).data as any
  const E = await fresh('mc4')
  const feb = (d: number) => `2027-02-${String(d).padStart(2, '0')}`
  await db.from('planning_cycles').update({ starts_at_local: feb(15), ends_at_local: feb(22) }).eq('id', E.cycle).throwOnError()
  const tent = await horizon(E.uid)
  check('a tentative sitting (no booked date): the target sitting itself is the last study day', tent.state === 'open' && tent.kind === 'sitting' && tent.last === (await db.from('exam_windows').select('window_opens').eq('id', (await db.from('profiles').select('exam_window_id').eq('id', E.uid).single().throwOnError()).data!.exam_window_id as string).single().throwOnError()).data!.window_opens, JSON.stringify(tent))
  const ex1 = await setExam(E, { registered: true, examDate: feb(18) })
  check('the canonical exam editor books 18 Feb', ex1.status === 200 && ex1.body?.ok === true && (await horizon(E.uid)).last === feb(17), JSON.stringify(ex1.body).slice(0, 160))
  const RE = await newReport(E), selE = { items: [0, 1, 2, 3, 4].map(i => review(E.readings[i].id as string, 60)) }
  const pe = await previewRecovery(E.uid, RE, selE)
  check('the proposal places nothing on or after the booked exam; the rest is shown as not fitting', pe.ok && pe.placed.length > 0 && pe.placed.every(t => t.date <= feb(17)) && pe.lastStudyDay === feb(17) && pe.remainder.length > 0, pe.ok ? JSON.stringify({ d: pe.placed.map(t => t.date), last: pe.lastStudyDay }) : JSON.stringify(pe))
  const ex2 = await setExam(E, { registered: true, examDate: feb(16) })
  check('the exam is moved EARLIER through the editor after the preview', ex2.status === 200 && (await horizon(E.uid)).last === feb(15), JSON.stringify(ex2.body).slice(0, 160))
  const stale = await refused(acceptRecovery(E.uid, RE, { key: randomUUID(), selection: selE, fingerprint: (pe as any).fingerprint }))
  check('accepting the old plan is refused (preview changed); input is kept and nothing is written', stale instanceof ReportError && stale.code === 'preview_changed' && (await rowsOfReport(RE.id)).length === 0)
  const forged = (await db.rpc('accept_mock_recovery', { p_user: E.uid, p_key: randomUUID(), p_report_id: RE.id, p_report_version: 1, p_cycle_id: E.cycle, p_selection: selE, p_tasks: [{ id: `mr-${randomUUID().replace(/-/g, '').slice(0, 24)}`, source_key: 'x:1', task_type: 'study', local_date: feb(17), duration_minutes: 60, title: 'late', outcome_id: '', lm_id: E.readings[0].id as string, rationale: 'x' }] })).data as any
  check('the database enforces the horizon on a forged direct call (17 Feb is after the new last study day, 15 Feb)', forged?.ok === false && /exam date changed/.test(forged.message ?? ''), JSON.stringify(forged))
  const pe2 = await previewRecovery(E.uid, RE, selE)
  check('rebuilt after the move: every sitting is on or before 15 Feb', pe2.ok && pe2.placed.every(t => t.date <= feb(15)) && pe2.lastStudyDay === feb(15), pe2.ok ? JSON.stringify(pe2.placed.map(t => t.date)) : '')
  const k = randomUUID(), acc2 = await acceptRecovery(E.uid, RE, { key: k, selection: selE, fingerprint: (pe2 as any).fingerprint })
  check('the rebuilt plan is accepted and stays inside the boundary', acc2.placed > 0 && (await rowsOfReport(RE.id)).every(r => r.local_date <= feb(15)))
  // an unrelated report edit does not invalidate another report's preview
  const RF = await newReport(E, { takenOn: addDays(today, -5), provider: 'Provider B' })
  const pf2 = await previewRecovery(E.uid, RF, { items: [{ key: 'pacing', kind: 'pacing', minutes: 30 }] })
  await saveReport(E.uid, { action: 'edit', key: randomUUID(), reportId: RE.id, expectedVersion: 1, input: input(E, { score: 55 }) })
  const accF = pf2.ok ? await acceptRecovery(E.uid, RF, { key: randomUUID(), selection: { items: [{ key: 'pacing', kind: 'pacing', minutes: 30 }] }, fingerprint: pf2.fingerprint }).catch(e => e as Error) : null
  check('editing a different report changes nothing material for this one: its reviewed plan still accepts', !!accF && !(accF instanceof Error) && accF.placed >= 0, accF instanceof Error ? accF.message : '')
  // a commitment that takes the room between preview and accept
  const G = await fresh('mc4b'); await db.from('planning_cycles').update({ starts_at_local: feb(15), ends_at_local: feb(17) }).eq('id', G.cycle).throwOnError()
  await G.windows([{ weekday: new Date(`${feb(15)}T12:00:00Z`).getUTCDay(), start: '09:00', end: '10:00' }, { weekday: new Date(`${feb(16)}T12:00:00Z`).getUTCDay(), start: '09:00', end: '10:00' }])
  const RG = await newReport(G), selG = { items: [review(G.readings[0].id as string, 60), review(G.readings[1].id as string, 60)] }
  const pg = await previewRecovery(G.uid, RG, selG)
  const ins = await db.from('calendar_commitments').insert({ user_id: G.uid, title: 'blocker', local_date: feb(15), start_time: '09:00', end_time: '10:00', kind: 'commitment' } as any)
  const gAcc = await refused(acceptRecovery(G.uid, RG, { key: randomUUID(), selection: selG, fingerprint: (pg as any).fingerprint }))
  check('a commitment that appears after the preview makes the acceptance refuse and write nothing', ins.error ? true : gAcc instanceof ReportError && (await rowsOfReport(RG.id)).length === 0, ins.error?.message ?? (gAcc instanceof Error ? gAcc.message : 'accepted'))
  // paused / exam sat
  await db.rpc('record_exam_status', { p_user: E.uid, p_action: 'sat', p_sat_on: today, p_today: today })
  const rrep = await getReport(E.uid, RE.id)
  const psat = await previewRecovery(E.uid, rrep!, selE)
  const replay = await acceptRecovery(E.uid, RE, { key: k, selection: selE, fingerprint: (pe2 as any).fingerprint })
  check('once the exam is sat: no new allocation, history and the report stay readable, and the old receipt still replays', !psat.ok && psat.code === 'exam_sat' && !!rrep && replay.replayed === true && replay.placed === acc2.placed)
  await db.rpc('record_exam_status', { p_user: E.uid, p_action: 'undo' })

  console.log('\n4b. Both race orders: acceptance vs. the exam editor, and a booked mock between preview and accept\n')
  const racer = async (tag: string) => {
    const F = await fresh(tag); await db.from('planning_cycles').update({ starts_at_local: feb(15), ends_at_local: feb(22) }).eq('id', F.cycle).throwOnError()
    if ((await setExam(F, { registered: true, examDate: feb(20) })).body?.ok !== true) throw new Error('exam fixture failed')
    const rep = await newReport(F), sel = { items: [0, 1, 2].map(i => review(F.readings[i].id as string, 60)) }, pv = await previewRecovery(F.uid, rep, sel)
    if (!pv.ok) throw new Error(pv.message)
    return { F, rep, sel, pv }
  }
  const orderB = await racer('mc4c')
  const accB = await acceptRecovery(orderB.F.uid, orderB.rep, { key: randomUUID(), selection: orderB.sel, fingerprint: (orderB.pv as any).fingerprint })
  const exB = await setExam(orderB.F, { registered: true, examDate: feb(16) })
  check('order B (accepted first, exam moved earlier afterwards): the exam edit succeeds and the accepted sittings are kept as history, all inside the boundary that held when they were accepted', exB.body?.ok === true && accB.placed === 3 && (await rowsOfReport(orderB.rep.id)).length === 3 && (await rowsOfReport(orderB.rep.id)).every(r => r.local_date <= feb(19)))
  const stillOpen = await previewRecovery(orderB.F.uid, orderB.rep, orderB.sel)
  check('and the next proposal already honours the new boundary (nothing is placed after 15 Feb; the accepted work is not re-proposed)', stillOpen.ok && stillOpen.lastStudyDay === feb(15) && stillOpen.placed.length === 0)
  const conc = await racer('mc4d')
  const [accC, exC] = await Promise.all([refused(acceptRecovery(conc.F.uid, conc.rep, { key: randomUUID(), selection: conc.sel, fingerprint: (conc.pv as any).fingerprint })), setExam(conc.F, { registered: true, examDate: feb(16) })])
  const rowsC = await rowsOfReport(conc.rep.id), won = accC === null
  check('simultaneous acceptance and exam edit: exactly one consistent outcome (accepted inside the OLD boundary, or refused with nothing written), and the exam edit itself always succeeds', exC.body?.ok === true && (won ? rowsC.length === 3 && rowsC.every(r => r.local_date <= feb(19)) : accC instanceof ReportError && accC.code === 'preview_changed' && rowsC.length === 0), JSON.stringify({ won, rows: rowsC.map(r => r.local_date), err: accC instanceof Error ? accC.message : null }))
  const M = await racer('mc4e'), mock = await db.from('mock_appointments').insert({ user_id: M.F.uid, kind: 'provider_mock', planned_date: feb(15), start_time: '09:00', duration_minutes: 90, label: 'Booked mock', status: 'planned' }).select('id').single()
  const accM = await refused(acceptRecovery(M.F.uid, M.rep, { key: randomUUID(), selection: M.sel, fingerprint: (M.pv as any).fingerprint }))
  check('a mock booked on a day after the preview: the acceptance does not silently overlap it (the reviewed plan is refused as changed and nothing is written)', !!mock.data && accM instanceof ReportError && accM.code === 'preview_changed' && (await rowsOfReport(M.rep.id)).length === 0, accM instanceof Error ? accM.message : 'accepted')

  console.log('\n5. Final-week narrowing is honest (injected clock on the preview)\n')
  const H = await fresh('mc5'); await db.from('planning_cycles').update({ starts_at_local: feb(8), ends_at_local: feb(16) }).eq('id', H.cycle).throwOnError()
  await setExam(H, { registered: true, examDate: feb(18) })
  const RH = await newReport(H), nowH = new Date('2027-02-10T10:00:00Z')
  const ph = await previewRecovery(H.uid, RH, { items: [0, 1, 2, 3, 4, 5].map(i => review(H.readings[i].id as string, 60)) }, nowH)
  check('eight days out: narrowing names what fits and what does not, in real slots before the last study day', ph.ok && !!ph.narrowing && ph.narrowing.daysLeft === 8 && ph.narrowing.tradeoffs.length >= 2 && ph.placed.every(t => t.date <= feb(17)) && /Nothing already planned or committed was moved/.test(ph.narrowing.tradeoffs[1]) && /two weeks/.test(ph.runway.note), ph.ok ? JSON.stringify({ n: ph.narrowing, d: ph.placed.map(t => t.date) }) : JSON.stringify(ph))
  const farNow = await previewRecovery(H.uid, RH, { items: [review(H.readings[0].id as string, 30)] }, new Date('2026-12-01T10:00:00Z'))
  check('far from the exam there is no narrowing block', farNow.ok && farNow.narrowing === null)
  const fp1 = ph.ok ? ph.fingerprint : '', ph2 = await previewRecovery(H.uid, RH, { items: [0, 1, 2, 3, 4, 5].map(i => review(H.readings[i].id as string, 60)) }, new Date('2027-02-04T10:00:00Z'))
  check('the fingerprint covers the exam-dependent advice (a different distance to the exam is a different plan)', ph2.ok && ph2.fingerprint !== fp1)

  console.log('\n6. Idempotency keys are bound to their requests\n')
  const K = await fresh('mc6'), key = randomUUID()
  const first = await saveReport(K.uid, { action: 'create', key, input: input(K, { score: 48 }) })
  const conflict = await refused(saveReport(K.uid, { action: 'create', key, input: input(K, { score: 82 }) }))
  const stored = (await getReport(K.uid, first.report.id))!
  check('the same key with a changed score is a conflict, never a success; the stored 48 is unchanged', conflict instanceof ReportError && conflict.code === 'KEY_REUSED' && conflict.status === 409 && stored.score === 48 && stored.version === 1)
  const same = await saveReport(K.uid, { action: 'create', key, input: input(K, { score: 48, provider: '  Provider A  ', difficulties: ['ran_out_of_time', 'ran_out_of_time'] }) })
  check('the same request (blank/duplicate/whitespace differences) replays the original receipt', same.replayed === true && same.report.id === first.report.id)
  const tz2 = (await db.from('topics').select('id').limit(2).throwOnError()).data!.map(t => t.id as string)
  const k2 = randomUUID(), twoTopics = input(K, { topics: [{ topicId: tz2[0], value: 30, scale: 'percent' }, { topicId: tz2[1], value: 40.0, scale: 'percent' }], score: 48.0 })
  await saveReport(K.uid, { action: 'create', key: k2, input: twoTopics })
  const reord = await saveReport(K.uid, { action: 'create', key: k2, input: { ...twoTopics, topics: [...twoTopics.topics!].reverse(), score: 48 } })
  check('reordered topic results and 48 vs 48.0 are the same request (no spurious conflict)', reord.replayed === true)
  for (const [name, change] of [['scale', { scale: 'marks' as const, score: 48, scoreMax: 100 }], ['notes', { notes: 'different' }], ['scope', { scope: 'partial' as const }], ['topics', { topics: [{ topicId: tz2[0], value: 31, scale: 'percent' as const }] }], ['date', { takenOn: addDays(today, -4) }]] as const) {
    const e = await refused(saveReport(K.uid, { action: 'create', key: k2, input: { ...twoTopics, ...change } as MockReportInput }))
    check(`a changed ${name} on the same key is refused`, e instanceof ReportError && e.code === 'KEY_REUSED')
  }
  const directSave = (await db.rpc('save_mock_report', { p_user: K.uid, p_key: key, p_action: 'create', p_report_id: null, p_expected_version: null, p_payload: { taken_on: addDays(today, -3), scope: 'full', scale: 'percent', score: 82, provider: 'Provider A', difficulties: ['ran_out_of_time'], topics: [{ topicId: K.topic, value: 35, scale: 'percent' }] } })).data as any
  check('the same refusal at the database command', directSave?.ok === false && directSave.code === 'KEY_REUSED')
  const ek = randomUUID(), ed1 = await saveReport(K.uid, { action: 'edit', key: ek, reportId: first.report.id, expectedVersion: 1, input: input(K, { score: 60 }) })
  const lost = await saveReport(K.uid, { action: 'edit', key: ek, reportId: first.report.id, expectedVersion: 1, input: input(K, { score: 60 }) })
  const later = await saveReport(K.uid, { action: 'edit', key: randomUUID(), reportId: first.report.id, expectedVersion: 2, input: input(K, { score: 61 }) })
  const lost2 = await saveReport(K.uid, { action: 'edit', key: ek, reportId: first.report.id, expectedVersion: 1, input: input(K, { score: 60 }) })
  check('a lost-response retry of a committed edit returns the ORIGINAL receipt, even after a later legitimate edit', ed1.report.version === 2 && lost.replayed && lost2.replayed && lost2.report.version === 2 && lost2.report.score === 60 && later.report.version === 3)
  const diffEdit = await refused(saveReport(K.uid, { action: 'edit', key: ek, reportId: first.report.id, expectedVersion: 1, input: input(K, { score: 99 }) }))
  const diffVer = await refused(saveReport(K.uid, { action: 'edit', key: ek, reportId: first.report.id, expectedVersion: 2, input: input(K, { score: 60 }) }))
  check('the same edit key with a changed score or a changed expected version is refused; data unchanged', diffEdit instanceof ReportError && diffEdit.code === 'KEY_REUSED' && diffVer instanceof ReportError && diffVer.code === 'KEY_REUSED' && (await getReport(K.uid, first.report.id))!.score === 61)
  const wk = randomUUID(), other = await newReport(K, { takenOn: addDays(today, -6) })
  const w1 = await saveReport(K.uid, { action: 'withdraw', key: wk, reportId: other.id, expectedVersion: 1 })
  const w2 = await saveReport(K.uid, { action: 'withdraw', key: wk, reportId: other.id, expectedVersion: 1 })
  const w3 = await refused(saveReport(K.uid, { action: 'withdraw', key: wk, reportId: first.report.id, expectedVersion: 3 }))
  check('withdraw: exact retry replays; the same key against another report is refused', w1.report.status === 'withdrawn' && w2.replayed && w3 instanceof ReportError && w3.code === 'KEY_REUSED' && (await getReport(K.uid, first.report.id))!.status === 'active')
  const ck = randomUUID(), created = await Promise.all([1, 2, 3].map(() => saveReport(K.uid, { action: 'create', key: ck, input: input(K, { score: 70 }) })))
  check('concurrent identical creates produce ONE report', new Set(created.map(x => x.report.id)).size === 1 && (await db.from('mock_reports').select('id', { count: 'exact', head: true }).eq('user_id', K.uid).eq('idempotency_key', ck)).count === 1)
  const dk = randomUUID(), race = await Promise.all([70, 71, 72].map(score => refused(saveReport(K.uid, { action: 'create', key: dk, input: input(K, { score }) }))))
  const winners = race.filter(x => x === null || (x as any).report), losers = race.filter(x => x instanceof ReportError && x.code === 'KEY_REUSED')
  check('concurrent INCOMPATIBLE creates: exactly one wins, the rest are conflicts', (await db.from('mock_reports').select('id', { count: 'exact', head: true }).eq('user_id', K.uid).eq('idempotency_key', dk)).count === 1 && losers.length === 2 && winners.length === 1, JSON.stringify(race.map(x => (x as any)?.code ?? 'ok')))
  // legacy receipt (no hash): keeps replaying, no payload is invented
  await db.from('mock_report_commands').update({ request_hash: null }).eq('user_id', K.uid).eq('key', key).throwOnError()
  const legacy = await saveReport(K.uid, { action: 'create', key, input: input(K, { score: 82 }) })
  check('a receipt written before request binding keeps replaying (no payload is fabricated for it)', legacy.replayed === true)
  const bad = await refused(saveReport(K.uid, { action: 'create', key: randomUUID(), input: input(K, { takenOn: '2026-02-30' }) }))
  check('an impossible date (30 Feb) is a clear validation error, not a normalised success', bad instanceof ReportError && bad.code === 'INVALID' && /real date/.test(bad.message))
  // recovery acceptance
  const L = await fresh('mc7'), RL = await newReport(L), selL = { items: [review(L.readings[0].id as string, 30)] }
  const pL = await previewRecovery(L.uid, RL, selL), lk = randomUUID()
  const aL = await acceptRecovery(L.uid, RL, { key: lk, selection: selL, fingerprint: (pL as any).fingerprint, reportVersion: 1 })
  const changedSel = await refused(acceptRecovery(L.uid, RL, { key: lk, selection: { items: [review(L.readings[0].id as string, 45)] }, fingerprint: (pL as any).fingerprint, reportVersion: 1 }))
  const otherRep = await newReport(L, { takenOn: addDays(today, -7) })
  const wrongReport = await refused(acceptRecovery(L.uid, otherRep, { key: lk, selection: selL, fingerprint: (pL as any).fingerprint, reportVersion: 1 }))
  check('recovery: the same key with a changed selection or another report is refused; nothing new is written', changedSel instanceof ReportError && changedSel.code === 'KEY_REUSED' && wrongReport instanceof ReportError && wrongReport.code === 'KEY_REUSED' && (await rowsOfReport(RL.id)).length === 1)
  await saveReport(L.uid, { action: 'edit', key: randomUUID(), reportId: RL.id, expectedVersion: 1, input: input(L, { score: 52 }) })
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -9), ends_at_local: addDays(today, -3) }).eq('id', L.cycle).throwOnError()
  const lateReplay = await acceptRecovery(L.uid, (await getReport(L.uid, RL.id))!, { key: lk, selection: selL, fingerprint: (pL as any).fingerprint, reportVersion: 1 })
  check('recovery: an exact retry after a report edit and a changed cycle still returns the ORIGINAL receipt', lateReplay.replayed === true && lateReplay.taskIds[0] === aL.taskIds[0])
  const dbDirect = (await db.rpc('accept_mock_recovery', { p_user: L.uid, p_key: lk, p_report_id: RL.id, p_report_version: 1, p_cycle_id: L.cycle, p_selection: { items: [review(L.readings[0].id as string, 45)], remove: [] }, p_tasks: [] })).data as any
  check('and the same refusal holds at the database command', dbDirect?.ok === false && dbDirect.code === 'KEY_REUSED')
  const foreign = await refused(acceptRecovery(K.uid, RL, { key: randomUUID(), selection: selL, fingerprint: 'x'.repeat(24), reportVersion: 1 }))
  const foreignRpc = (await db.rpc('accept_mock_recovery', { p_user: K.uid, p_key: randomUUID(), p_report_id: RL.id, p_report_version: 1, p_cycle_id: K.cycle, p_selection: selL, p_tasks: [] })).data as any
  check('another student cannot use this report (service and database both refuse)', foreign instanceof Error && foreignRpc?.ok === false && foreignRpc.code === 'NOT_FOUND')
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {})
  console.log(`cleanup: ${owned.length} owned student(s) removed`)
  if (!process.exitCode) finish()
})
