/** Phase 7B §2A: a class can be reported while it is still going, continued in the SAME session, corrected and then explicitly finished.
 *  Real HTTP + Postgres; ordinary throwaway class-led students, registered by id and deleted in finally. Occurrence identity is ALWAYS explicit here.
 *    E2E_BASE_URL=http://localhost:3172 npx tsx scripts/class-in-progress-test.ts */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, classLedPersona, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { confirmClassLog, confirmClassLogUpdate, previewClassLog } from '../src/lib/planning/classlog/service'

const db = createAdminClient(), { check, finish } = makeCheck(), owned: string[] = []
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function main() {
  await preflightServer()
  const persona = await classLedPersona(db)
  const S = await createStudent(db, 'p7ip', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const X = await createStudent(db, 'p7ipx', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  await db.from('profiles').update({ max_session_minutes: 45 }).eq('id', S.id)
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cyc.timezone as string)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: addDays(today, 9) }).eq('id', cyc.id).throwOnError()
  await db.from('plan_blocks').delete().eq('user_id', S.id).eq('cycle_id', cyc.id).throwOnError()
  await db.from('availability_windows').delete().eq('user_id', S.id)
  await db.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: S.id, weekday, start_time: '09:00', end_time: '13:00', status: 'active' }))).throwOnError()
  // A deterministic timetable (the persona's own classes depend on the time of day): two NAMED classes on the same finished day, 09:00 and 11:00.
  await db.from('calendar_commitments').delete().eq('user_id', S.id).eq('kind', 'class').throwOnError()
  const D = addDays(today, -2), wd = new Date(`${D}T12:00:00Z`).getUTCDay()
  for (const [label, st, en] of [['Financial reporting', '09:00', '10:00'], ['Economics', '11:00', '12:00']] as const)
    await db.from('calendar_commitments').insert({ user_id: S.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [wd], start_time: st, end_time: en, starts_on: addDays(today, -8), starts_at: `${addDays(today, -8)}T${st}:00Z`, ends_at: `${addDays(today, -8)}T${en}:00Z` }).throwOnError()
  const ctx = async () => (await S.s.json('/api/class-log/context')).body.context
  const c0 = await ctx(), pend = (c0.occurrences as any[]).filter(o => o.status === 'pending')
  if (pend.length < 2) throw new Error('fixture needs two ended classes')
  const A = pend[0], B = pend[1]
  const outs: string[] = []
  for (const r of (await db.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(40)).data ?? []) {
    const lo = (await db.from('reading_los').select('id').eq('reading_id', r.id).order('sequence').limit(1)).data?.[0]; if (lo) outs.push(lo.id as string); if (outs.length === 3) break
  }
  const [O1, O2, O3] = outs
  const sess = async () => (await db.from('class_sessions').select('id, version, completed_at, class_date, occurrence_key, kind').eq('user_id', S.id)).data ?? []
  const items = async (sid: string) => (await db.from('class_session_items').select('outcome_id, extent, studied_in_class, planned_minutes').eq('session_id', sid)).data ?? []
  const tasks = async (sid: string) => (await db.from('plan_blocks').select('id, outcome_id, duration_minutes, execution').eq('class_session_id', sid).is('cancelled_at', null)).data ?? []
  const evidence = async () => (await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count
  const body = (occ: any, its: any[], extra: Record<string, unknown> = {}) => ({ classDate: occ.date, kind: 'covered', occurrenceKey: occ.key, items: its, ...extra })
  const prev = async (b: any) => (await S.s.post('/api/class-log/preview', b)).body
  const conf = async (b: any, pv: any, key: string, extra: Record<string, unknown> = {}) => S.s.post('/api/class-log/confirm', { ...b, idempotencyKey: key, fingerprint: pv.fingerprint, ...extra })

  // 1. save coverage so far (class A, in progress: not finished)
  const b1 = body(A, [{ outcomeId: O1, extent: 'part' }]), p1 = await prev(b1), k1 = `ip-${randomUUID()}`
  const c1 = await conf(b1, p1, k1)
  const [sA] = (await sess()).filter(s => s.occurrence_key === A.key)
  check('coverage so far is saved as ONE session, version 1, NOT finished by saving', c1.body.ok && !!sA && sA.version === 1 && sA.completed_at === null && c1.body.tasks > 0)
  const ctx1 = await ctx(), occA = ctx1.occurrences.find((o: any) => o.key === A.key), sessA = ctx1.sessions.find((x: any) => x.id === sA.id)
  check('the context shows it as logged, in progress (not finished), with the saved coverage', occA.status === 'logged' && occA.completed === false && occA.version === 1 && sessA.items.length === 1 && sessA.items[0].outcomeId === O1 && sessA.items[0].extent === 'part')
  check('the other class on the same day is untouched and still pending', ctx1.occurrences.find((o: any) => o.key === B.key).status === 'pending')
  const t1 = await tasks(sA.id), ev0 = await evidence()

  // 2. continue the SAME session: add an explicitly whole outcome; only the additional work is previewed
  const b2 = body(A, [{ outcomeId: O1, extent: 'part' }, { outcomeId: O2, extent: 'full' }], { sessionId: sA.id }), p2 = await prev(b2)
  check('the continue-preview reports one changed item and plans nothing for the saved part item again', p2.ok && p2.update?.changedItems === 1 && p2.update.sessionId === sA.id && p2.tasks.every((t: any) => t.outcomeId === O2 || t.sessionId === sA.id))
  const k2 = `ip-${randomUUID()}`
  const c2 = await conf(b2, p2, k2, { expectedVersion: 1, finalise: false })
  const afterC2 = await tasks(sA.id)
  check('the update saves into the same session (still one), version 2, still not finished, added=1', c2.body.ok && c2.body.version === 2 && c2.body.added === 1 && (await sess()).filter(s => s.occurrence_key === A.key).length === 1 && (await sess()).find(s => s.id === sA.id)!.completed_at === null)
  check('the first outcome\'s tasks are exactly as before; the new outcome has its own tasks', t1.every(t => afterC2.some(x => x.id === t.id)) && afterC2.some(t => t.outcome_id === O2) && (await items(sA.id)).length === 2)

  // 3. a lost reply retried with the same key, then a different request under that key
  const retry = await conf(b2, p2, k2, { expectedVersion: 1, finalise: false })
  check('the same key and request replays the first result: no new tasks, same version', retry.body.ok && retry.body.alreadyApplied === true && retry.body.version === 2 && (await tasks(sA.id)).length === afterC2.length)
  const diff = await conf(body(A, [{ outcomeId: O1, extent: 'full' }], { sessionId: sA.id }), p2, k2, { expectedVersion: 1, finalise: false })
  check('a different request under that key is refused and writes nothing', diff.status === 400 && (await items(sA.id)).find(i => i.outcome_id === O1)!.extent === 'part')

  // 4. saving the same outcomes again counts once
  const p3 = await prev(b2)
  check('the same report previewed again has no changed items and no new work', p3.ok && p3.update.changedItems === 0 && p3.tasks.length === 0)
  const c3 = await conf(b2, p3, `ip-${randomUUID()}`, { expectedVersion: 2, finalise: false })
  check('confirming it changes nothing: version stays 2, same tasks', c3.body.ok && c3.body.version === 2 && c3.body.tasks === 0 && (await tasks(sA.id)).length === afterC2.length)

  // 5. two tabs on the same version cannot both write
  const stale = await conf(b2, p3, `ip-${randomUUID()}`, { expectedVersion: 1, finalise: false })
  check('a stale tab (version 1) is refused as version_changed and writes nothing', stale.status === 409 && stale.body.code === 'version_changed' && (await sess()).find(s => s.id === sA.id)!.version === 2)
  const b3 = body(A, [{ outcomeId: O1, extent: 'part' }, { outcomeId: O2, extent: 'full' }, { outcomeId: O3, extent: 'part' }], { sessionId: sA.id })
  const [tabA, tabB] = await Promise.all([0, 1].map(async () => { const pv = await prev(b3); return conf(b3, pv, `ip-${randomUUID()}`, { expectedVersion: 2, finalise: false }) }))
  check('two tabs saving at once on version 2: exactly one wins, the other is told the log changed', [tabA, tabB].filter(r => r.body.ok).length === 1 && [tabA, tabB].filter(r => r.body.code === 'version_changed').length === 1, JSON.stringify([tabA.body.code, tabB.body.code]))
  const v3 = (await sess()).find(s => s.id === sA.id)!.version
  check('the log is at version 3 with the three outcomes', v3 === 3 && (await items(sA.id)).length === 3)

  // 6. correction: part -> whole; history keeps the earlier report; accepted work stays
  const b4 = body(A, [{ outcomeId: O1, extent: 'full' }, { outcomeId: O2, extent: 'full' }, { outcomeId: O3, extent: 'part' }], { sessionId: sA.id }), p4 = await prev(b4)
  const before4 = await tasks(sA.id)
  const k4 = `ip-${randomUUID()}`, c4 = await conf(b4, p4, k4, { expectedVersion: 3, finalise: false })
  const hist = (await db.from('class_log_updates').select('before, from_version, to_version').eq('user_id', S.id).eq('idempotency_key', k4).single()).data
  check('a correction changes the extent in place (one item row), version 4, and keeps what it replaced', c4.body.ok && c4.body.corrected === 1 && (await items(sA.id)).find(i => i.outcome_id === O1)!.extent === 'full' && hist?.to_version === 4 && JSON.stringify(hist?.before).includes('"extent":"part"'), JSON.stringify([c4.body, hist]).slice(0, 400))
  check('work already accepted is never removed by a correction', (await tasks(sA.id)).filter(t => before4.some(b => b.id === t.id)).length === before4.length)

  // 7. finishing: explicit, no extra coverage, evidence or tasks; finishing twice changes nothing
  const evBefore = await evidence(), taskCountBefore = (await tasks(sA.id)).length, itemsBefore = JSON.stringify(await items(sA.id))
  const b5 = body(A, [{ outcomeId: O1, extent: 'full' }, { outcomeId: O2, extent: 'full' }, { outcomeId: O3, extent: 'part' }], { sessionId: sA.id }), p5 = await prev(b5)
  const c5 = await conf(b5, p5, `ip-${randomUUID()}`, { expectedVersion: 4, finalise: true })
  const fin = (await sess()).find(s => s.id === sA.id)!
  check('Finish class log sets completion explicitly (version 5) and adds no tasks, coverage or evidence', c5.body.ok && c5.body.completed === true && fin.completed_at !== null && fin.version === 5 && (await tasks(sA.id)).length === taskCountBefore && JSON.stringify(await items(sA.id)) === itemsBefore && (await evidence()) === evBefore, JSON.stringify([c5.body, fin]).slice(0, 400))
  const c6 = await conf(b5, p5, `ip-${randomUUID()}`, { expectedVersion: 5, finalise: true })
  check('finishing again changes nothing (version stays 5)', c6.body.ok && c6.body.version === 5 && (await sess()).find(s => s.id === sA.id)!.version === 5)
  check('an earlier save is still replayed after later updates (the original result, not the new state)', (await conf(b1, p1, k1)).body.alreadyApplied === true && (await sess()).filter(s => s.occurrence_key === A.key).length === 1)
  check('the clock alone never completed anything: class B (no log) has no session', (await sess()).every(s => s.occurrence_key !== B.key))

  // 8. the class later moves/is cancelled: history stays editable and keeps its identity and dates
  const original = (await sess()).find(s => s.id === sA.id)!
  if (A.key.startsWith('series:')) await db.from('commitment_exceptions').insert({ user_id: S.id, commitment_id: A.commitmentId, occurrence_date: A.originalDate, kind: 'skipped' }).throwOnError()
  const b6 = body(A, [{ outcomeId: O1, extent: 'full' }, { outcomeId: O2, extent: 'full' }, { outcomeId: O3, extent: 'full' }], { sessionId: sA.id }), p6 = await prev(b6)
  const c7 = await conf(b6, p6, `ip-${randomUUID()}`, { expectedVersion: 5, finalise: false })
  const after = (await sess()).find(s => s.id === sA.id)!
  check('after the class was cancelled, saved history can still be corrected and keeps its identity, day and finished state', c7.body.ok && after.occurrence_key === original.occurrence_key && after.class_date === original.class_date && after.completed_at !== null)
  const again = await prev(body(A, [{ outcomeId: O1, extent: 'part' }]))
  check('...but a NEW log for that cancelled class is still refused (a cancelled class cannot be re-created by name)', again.ok === false || (await conf(body(A, [{ outcomeId: O1, extent: 'part' }]), again.ok ? again : { fingerprint: 'x' }, `ip-${randomUUID()}`)).body.ok !== true)

  // 9. another student cannot read, update or finish this session
  const foreign = await X.s.post('/api/class-log/preview', body(A, [{ outcomeId: O1, extent: 'full' }], { sessionId: sA.id }))
  check('another student cannot preview an update to this session', foreign.status !== 200 && foreign.body.ok === false)
  const xe = (await db.auth.admin.getUserById(X.id)).data.user!.email!, link = await db.auth.admin.generateLink({ type: 'magiclink', email: xe })
  const xc = createClient(url, anon, { auth: { persistSession: false } })
  await xc.auth.verifyOtp({ token_hash: (link.data!.properties as any).hashed_token, type: 'magiclink' })
  const xcyc = (await db.from('planning_cycles').select('id').eq('user_id', X.id).eq('status', 'active').single()).data!.id
  const vBefore = (await sess()).find(s => s.id === sA.id)!.version
  const direct = await xc.rpc('apply_class_log_update', { p_cycle_id: xcyc, p_session_id: sA.id, p_idempotency_key: `x-${randomUUID()}`, p_expected_version: 6, p_finalise: true, p_items: [], p_tasks: [] })
  check('a direct signed-in call by another student is refused and changes nothing', !!direct.error && /Unauthorized/.test(direct.error.message) && (await sess()).find(s => s.id === sA.id)!.version === vBefore)
  const noAuth = await createClient(url, anon, { auth: { persistSession: false } }).rpc('apply_class_log_update', { p_cycle_id: null, p_session_id: sA.id, p_idempotency_key: 'x', p_expected_version: 1, p_finalise: true, p_items: [], p_tasks: [] })
  check('an unauthenticated call is refused', !!noAuth.error)

  // 10. class B on the same day: a clean create that is finished at once; and a no-coverage kind is complete by definition
  const bB = body(B, [{ outcomeId: O2, extent: 'part' }]), pB = await prev(bB)
  const cB = await conf(bB, pB, `ip-${randomUUID()}`, { finalise: true })
  const sB = (await sess()).find(s => s.occurrence_key === B.key)!
  check('a class created with Finish is complete in one command; the other session is untouched', cB.body.ok && sB.completed_at !== null && (await sess()).find(s => s.id === sA.id)!.occurrence_key === A.key)

  const why = async (sid: string) => ((await db.from('plan_blocks').select('rationale').eq('class_session_id', sid).is('cancelled_at', null)).data ?? []).map(r => String(r.rationale))
  const whyA = await why(sA.id), whyB = await why(sB.id)
  check('two classes on one day are told apart in their follow-up work: each task says which class it came from', whyA.length > 0 && whyB.length > 0 && whyA.every(r => r.includes(`(${A.label})`)) && whyB.every(r => r.includes(`(${B.label})`)) && A.label !== B.label, JSON.stringify([whyA[0], whyB[0]]).slice(0, 300))

  // 11. lost replies at the service layer: the database commits, the answer never arrives
  const real = globalThis.fetch, userClient = (await (async () => { const c = createClient(url, anon, { auth: { persistSession: false } }); const e = (await db.auth.admin.getUserById(S.id)).data.user!.email!; const l = await db.auth.admin.generateLink({ type: 'magiclink', email: e }); await c.auth.verifyOtp({ token_hash: (l.data!.properties as any).hashed_token, type: 'magiclink' }); return c })())
  const lose = (re: RegExp) => { let hit = 0; globalThis.fetch = (async (i: any, init: any) => { const u = typeof i === 'string' ? i : i?.url ?? String(i); const r = await real(i, init); if (re.test(u) && hit++ === 0) { await r.text(); throw new TypeError('fetch failed') } return r }) as typeof fetch }
  const sBefore = (await sess()).length
  // (a) a new class log
  const pend2 = (await ctx()).occurrences.filter((o: any) => o.status === 'pending')
  const manualKey = `manual:${randomUUID()}`, newInput = { classDate: today, kind: 'covered' as const, occurrenceKey: manualKey, items: [{ outcomeId: O3, extent: 'part' as const }] }
  const pvN = await previewClassLog(S.id, newInput) as any, kN = `ip-${randomUUID()}`
  lose(/rpc\/apply_class_log$/)
  const lost1 = await confirmClassLog(userClient, S.id, { ...newInput, idempotencyKey: kN, fingerprint: pvN.fingerprint }).finally(() => { globalThis.fetch = real })
  check('a committed class log whose reply was lost is reported as UNKNOWN, not as "nothing was changed"', lost1.ok === false && lost1.code === 'unknown' && !/nothing was changed/i.test(lost1.message) && (await sess()).length === sBefore + 1)
  const retried = await confirmClassLog(userClient, S.id, { ...newInput, idempotencyKey: kN, fingerprint: pvN.fingerprint })
  const mine = (await sess()).filter(s => s.occurrence_key === manualKey)
  check('the retry with the same key and the SAME manual identity returns the original session (never a new manual identity)', retried.ok === true && retried.alreadyApplied === true && mine.length === 1 && retried.sessionId === mine[0].id)
  // (b) an update
  const upIn = { ...newInput, sessionId: mine[0].id, items: [{ outcomeId: O3, extent: 'full' as const }] }
  const pvU = await previewClassLog(S.id, upIn) as any, kU = `ip-${randomUUID()}`
  lose(/rpc\/apply_class_log_update$/)
  const lost2 = await confirmClassLogUpdate(userClient, S.id, { ...upIn, sessionId: mine[0].id, idempotencyKey: kU, fingerprint: pvU.fingerprint, expectedVersion: 1, finalise: false }).finally(() => { globalThis.fetch = real })
  check('a committed update whose reply was lost is UNKNOWN; the database has the new version', lost2.ok === false && lost2.code === 'unknown' && (await sess()).find(s => s.id === mine[0].id)!.version === 2)
  const re2 = await confirmClassLogUpdate(userClient, S.id, { ...upIn, sessionId: mine[0].id, idempotencyKey: kU, fingerprint: pvU.fingerprint, expectedVersion: 1, finalise: false })
  check('retrying the update with the same key replays it (even though the version has since moved on)', re2.ok === true && re2.alreadyApplied === true && re2.version === 2)
  void pend2

  // 12. a closed week: late finishing is allowed (no cycle needed) and never reopens it; new work needs the open week
  await db.from('planning_cycles').update({ status: 'closed' }).eq('id', cyc.id)
  const late = await userClient.rpc('apply_class_log_update', { p_cycle_id: null, p_session_id: mine[0].id, p_idempotency_key: `ip-${randomUUID()}`, p_expected_version: 2, p_finalise: true, p_items: [], p_tasks: [] })
  const lateRow = (await sess()).find(s => s.id === mine[0].id)!
  check('after the week closed, a saved class can still be finished; the cycle stays closed', !late.error && lateRow.completed_at !== null && (await db.from('planning_cycles').select('status').eq('id', cyc.id).single()).data!.status === 'closed', late.error?.message)
  const lateWork = await userClient.rpc('apply_class_log_update', { p_cycle_id: cyc.id, p_session_id: mine[0].id, p_idempotency_key: `ip-${randomUUID()}`, p_expected_version: 3, p_finalise: false, p_items: [], p_tasks: [{ id: 'x' }] })
  check('...but new work cannot be placed into the closed week', !!lateWork.error)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
