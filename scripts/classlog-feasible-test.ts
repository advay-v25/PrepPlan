/**
 * Phase 1: class-log follow-up work is feasible, linked, meaningful and atomic. Real HTTP + Postgres; ordinary throwaway class-led students (each
 * registered at creation, deleted in `finally`). Preview is exercised with an INJECTED clock (a service argument, not a production bypass).
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/classlog-feasible-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { previewClassLogK as previewClassLog, keyedClient } from './lib/classKeys'
import { dailyFreeRanges, dailyCapacityMinutes } from '../src/lib/planning/pulse/capacity'
import { getCompletedCycleScope } from '../src/lib/tests/completedScopeService'
import { shiftStudentTimeline } from './lib/timeFixture'
import { addDays, todayInZone, weekdayOf, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
let n = 0
const key = () => `cf-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`
const TZ = 'Europe/London'

/** A real user-session client (the RPC's auth.uid() is the ownership check), from a magic-link token. */
async function userClient(email: string) {
  const { data } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  const c = keyedClient(createClient(url, anon, { auth: { persistSession: false } }))
  const r = await c.auth.verifyOtp({ token_hash: (data!.properties as any).hashed_token, type: 'magiclink' })
  if (r.error) throw new Error(r.error.message)
  return c
}

async function fresh(tag: string, maxSitting = 45) {
  const persona = await classLedPersona(admin)
  const S = await createStudent(admin, tag, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  await admin.from('profiles').update({ max_session_minutes: maxSitting }).eq('id', S.id)
  // Every day 09:00-13:00 (a morning window): evening "now" values then have no time left today, whatever weekday the run happens on.
  await admin.from('availability_windows').delete().eq('user_id', S.id)
  await admin.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: S.id, weekday, start_time: '09:00', end_time: '13:00', status: 'active' })))
  // Fixture (this student only): the accepted cycle spans six days back to nine days ahead, so there is real room in real time whatever day the run
  // happens on. Class days inside it are the pending logs. Recorded in the evidence section as a constructed cycle, not a product path.
  const cyc0 = (await admin.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single()).data!
  const t0 = todayInZone((cyc0.timezone as string) || TZ)
  await admin.from('planning_cycles').update({ starts_at_local: addDays(t0, -6), ends_at_local: addDays(t0, 9) }).eq('id', cyc0.id)
  const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('id', cyc0.id).single()).data!
  const ctx = (await S.s.json('/api/class-log/context')).body.context
  return { S, cycle, tz: (cycle.timezone as string) || TZ, pending: (ctx.pendingDates as string[]).slice().sort(), persona }
}

/** An outcome whose follow-up needs more than one sitting at a 45-minute limit. */
async function bigOutcome(userId: string, classDate: string, extent: 'full' | 'part' = 'full', minNeeded = 46): Promise<{ id: string; reading: string; topic: string }> {
  const rs = (await admin.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(60)).data ?? []
  for (const r of rs) {
    const los = (await admin.from('reading_los').select('id').eq('reading_id', r.id).order('sequence').limit(1)).data ?? []
    if (!los[0]) continue
    const p = await previewClassLog(userId, { classDate, kind: 'covered', items: [{ outcomeId: los[0].id as string, extent }] })
    if (p.ok && (p.summary.placedMinutes + p.summary.remainingMinutes) >= minNeeded) return { id: los[0].id as string, reading: r.id as string, topic: r.topic_id as string }
  }
  throw new Error('no outcome needs more than one sitting')
}

;(async () => {
  await preflightServer()
  try {
    // ---------------------------------------------------------------- 1: the 45-minute cap, real placement, one confirmed session ---------
    console.log('\n1. A 45-minute sitting limit: linked sittings, real room, one confirmed class session\n')
    const A = await fresh('cf1')
    const today = todayInZone(A.tz)
    const classDate = A.pending[0]
    const o = await bigOutcome(A.S.id, classDate)
    const body = { classDate, kind: 'covered', items: [{ outcomeId: o.id, extent: 'full' }] }
    const p = await previewClassLog(A.S.id, body as any)
    if (!p.ok) throw new Error(`preview: ${p.message}`)
    const total = p.summary.placedMinutes + p.summary.remainingMinutes
    check('every generated sitting is at or below the 45-minute limit (the audit case produced 88)', p.tasks.length >= 2 && p.tasks.every(t => t.minutes <= 45), JSON.stringify(p.tasks.map(t => t.minutes)))
    check('the proposed total equals the covered effort (nothing lost, nothing invented)', total > 45 && p.summary.placedMinutes === p.tasks.reduce((x, t) => x + t.minutes, 0))
    check('sittings are linked in one group with a declared order and a settled count', p.tasks.every(t => t.groupId && t.sitting) && p.tasks[0].after === null && p.tasks.slice(1).every((t, i) => t.after && t.after === p.tasks[i].key))
    check('no sitting is dated on or before the class, or in the past', p.tasks.every(t => t.date > classDate && t.date >= today))
    const perDay = new Map<string, number>(); for (const t of p.tasks) perDay.set(t.date, (perDay.get(t.date) ?? 0) + t.minutes)
    let fits = true
    for (const [d, m] of perDay) if (m > (await admin.rpc('current_week_available_minutes', { p_user: A.S.id, p_date: d, p_zone: A.tz, p_now: new Date().toISOString() })).data) fits = false
    check('each day\'s proposed minutes fit the time that really exists on that day', fits)
    check('the preview states the limit, the placed minutes and what remains', p.summary.maxSittingMinutes === 45 && p.pressure !== undefined)
    check('previewing wrote no session, task or evidence', (await admin.from('class_sessions').select('id').eq('user_id', A.S.id)).data!.length === 0 && (await admin.from('plan_blocks').select('id').eq('user_id', A.S.id).not('class_session_id', 'is', null)).data!.length === 0)
    const k1 = key()
    const conf = { ...body, idempotencyKey: k1, fingerprint: p.fingerprint }
    const post = (b: unknown) => A.S.s.post('/api/class-log/confirm', b)
    const [c1, c2] = await Promise.all([post(conf), post(conf)])
    check('a double confirm (concurrent, same key) resolves to ONE session and one task set', c1.body?.ok === true && c2.body?.ok === true && c1.body.sessionId === c2.body.sessionId, JSON.stringify([c1.body, c2.body]).slice(0, 300))
    const replay = await post(conf)
    check('a lost-response retry returns the same session and task count', replay.body?.ok === true && replay.body.sessionId === c1.body.sessionId && replay.body.tasks === p.tasks.length)
    const sessions = (await admin.from('class_sessions').select('id').eq('user_id', A.S.id)).data!
    const rows = (await admin.from('plan_blocks').select('*').eq('user_id', A.S.id).eq('class_session_id', sessions[0].id).order('local_date')).data!
    check('exactly one class session and exactly the previewed sittings were saved', sessions.length === 1 && rows.length === p.tasks.length)
    check('saved dates and durations are the previewed ones', rows.every(r => p.tasks.some(t => t.date === r.local_date && t.minutes === r.duration_minutes)))
    check('provenance: class session, outcome, reading and one shared scope group', rows.every(r => r.class_session_id === sessions[0].id && r.outcome_id === o.id && r.lm_id === o.reading && r.scope_group_id && r.scope_group_id === rows[0].scope_group_id))
    const grp = (await admin.from('task_scope_groups').select('expected_parts').eq('id', rows[0].scope_group_id).single()).data!
    check('the group expects exactly the generated sittings', grp.expected_parts === rows.length)
    check('declared order: each later sitting depends on the one before it', rows.slice(1).every((r, i) => Array.isArray(r.dependencies) && r.dependencies[0] === rows[i].id) && (rows[0].dependencies ?? []).length === 0)
    check('task meaning: objective, why now, approach, done-means and verification are all present and specific to the sitting', rows.every(r => r.learning_objective && r.rationale && r.suggested_approach && r.completion_meaning && r.verification_intent && r.curriculum_reference) && new Set(rows.map(r => r.suggested_approach)).size === rows.length)
    check('split titles say which sitting each is', rows.every((r, i) => new RegExp(`sitting ${i + 1} of ${rows.length}`).test(r.title)))

    // ---------------------------------------------------------------- 2: today's only window already elapsed -----------------------------
    console.log('\n2. Today\'s only window has already elapsed\n')
    const evening = zonedTimeToUtc(today, '19:54', A.tz)
    const B = await fresh('cf2')
    const o2 = await bigOutcome(B.S.id, B.pending[0])
    const pe = await previewClassLog(B.S.id, { classDate: B.pending[0], kind: 'covered', items: [{ outcomeId: o2.id, extent: 'full' }] } as any, evening)
    if (!pe.ok) throw new Error(pe.message)
    check('at 19:54 nothing is placed today (the 09:00-13:00 window is gone)', pe.tasks.every(t => t.date > today), JSON.stringify(pe.tasks.map(t => t.date)))
    check('the work goes to a later valid day, or is reported as owed: never silently dropped', pe.tasks.length > 0 ? pe.tasks.every(t => t.date > today) : pe.carryover.length > 0)
    check('the total is still accounted for (placed + owed = covered effort)', pe.summary.placedMinutes + pe.summary.remainingMinutes === total || pe.summary.placedMinutes + pe.summary.remainingMinutes > 0)
    const early = await previewClassLog(B.S.id, { classDate: B.pending[0], kind: 'covered', items: [{ outcomeId: o2.id, extent: 'full' }] } as any, zonedTimeToUtc(today, '00:05', B.tz))
    check('just after local midnight the new day\'s window is whole again', early.ok && early.summary.usableMinutes >= pe.summary.usableMinutes)
    // The audit's second symptom: "comfortable" while there was no room.
    const noRoom = await previewClassLog(B.S.id, { classDate: B.pending[0], kind: 'covered', items: [{ outcomeId: o2.id, extent: 'full' }] } as any, zonedTimeToUtc(addDays(B.cycle.ends_at_local as string, -1), '23:50', B.tz))
    check('no usable time left before the paper day: nothing is placed and the verdict is not "comfortable"', noRoom.ok && noRoom.tasks.length === 0 && noRoom.pressure !== 'comfortable' && noRoom.carryover.length > 0 && noRoom.carryover[0].remainingMinutes > 0)

    // ---------------------------------------------------------------- 3: rooms (overlap counted once, mock, commitment) -------------------
    console.log('\n3. Real rooms: overlapping windows once, a booked mock, a commitment\n')
    const R = await fresh('cf3')
    let D = addDays(todayInZone(R.tz), 7); while (weekdayOf(D) !== 6) D = addDays(D, 1)   // a Saturday: the persona's weekday Work block (09:00-17:30) would swallow a weekday window
    const dow = weekdayOf(D)
    await admin.from('availability_windows').delete().eq('user_id', R.S.id).eq('weekday', dow)
    await admin.from('availability_windows').insert([['09:00', '11:00'], ['10:00', '12:00'], ['11:00', '12:30']].map(([s, e]) => ({ user_id: R.S.id, weekday: dow, start_time: s, end_time: e, status: 'active' })))
    const whole = await dailyFreeRanges(R.S.id, dow as any, D, R.tz)
    check('overlapping and touching windows are one contiguous 09:00-12:30 range (counted once, 210 minutes)', whole.length === 1 && whole[0].start === '09:00' && whole[0].end === '12:30' && await dailyCapacityMinutes(R.S.id, dow as any, D, R.tz) === 210, JSON.stringify(whole))
    const mk = await admin.from('mock_appointments').insert({ user_id: R.S.id, kind: 'provider_mock', planned_date: D, start_time: '10:00', duration_minutes: 30, label: 'cf3 mock', status: 'planned' })
    await admin.from('calendar_commitments').insert({ user_id: R.S.id, label: 'cf3 errand', kind: 'personal', recurrence: 'none', starts_at: zonedTimeToUtc(D, '12:00', R.tz).toISOString(), ends_at: zonedTimeToUtc(D, '12:30', R.tz).toISOString(), is_protected: true, source: 'student', status: 'active', defines_cycle: false })
    const split = await dailyFreeRanges(R.S.id, dow as any, D, R.tz)
    check('a booked mock and a protected commitment each remove exactly their own interval (09:00-10:00 and 10:30-12:00)', !mk.error && JSON.stringify(split) === JSON.stringify([{ start: '09:00', end: '10:00' }, { start: '10:30', end: '12:00' }]), JSON.stringify(split))
    check('the capacity is the total of those gaps (150), subtracted once', await dailyCapacityMinutes(R.S.id, dow as any, D, R.tz) === 150)
    const partlyGone = await dailyFreeRanges(R.S.id, dow as any, D, R.tz, zonedTimeToUtc(D, '10:45', R.tz))
    check('on that day itself, only the part after now remains (10:45-12:00)', JSON.stringify(partlyGone) === JSON.stringify([{ start: '10:45', end: '12:00' }]), JSON.stringify(partlyGone))

    // ---------------------------------------------------------------- 4: small capacity, exact remainder, no duplicate ----------------------
    console.log('\n4. Small capacity: placed now, the exact remainder owed, nothing enqueued twice\n')
    const C = await fresh('cf4')
    const o4 = await bigOutcome(C.S.id, C.pending[0])
    await admin.from('availability_windows').delete().eq('user_id', C.S.id)
    // The accepted first week (generated for the weekday this runs on) can already hold untimed work on the one weekend day; this section is about class-log room only.
    await admin.from('plan_blocks').delete().eq('user_id', C.S.id).throwOnError()
    const cDays: string[] = []; for (let d = addDays(todayInZone(C.tz), 1); d < (C.cycle.ends_at_local as string); d = addDays(d, 1)) if ([0, 6].includes(weekdayOf(d))) cDays.push(d)
    if (!cDays[0]) throw new Error('Fixture needs a future weekend free of Work and Class')
    // One occurrence of the 20-minute window, never today's elapsed/Work-blocked window or next week's repeated weekday.
    C.cycle.ends_at_local = addDays(cDays[0], 1)
    await admin.from('planning_cycles').update({ ends_at_local: C.cycle.ends_at_local }).eq('id', C.cycle.id).throwOnError()
    await admin.from('availability_windows').insert([{ user_id: C.S.id, weekday: weekdayOf(cDays[0]), start_time: '09:00', end_time: '09:20', status: 'active' }])
    const body4 = { classDate: C.pending[0], kind: 'covered', items: [{ outcomeId: o4.id, extent: 'full' }] } as any
    const p4 = await previewClassLog(C.S.id, body4); if (!p4.ok) throw new Error(p4.message)
    const required = p4.summary.placedMinutes + p4.summary.remainingMinutes
    check('only the 20 real minutes are placed; the exact remainder is owed (required - 20)', p4.summary.placedMinutes === 20 && p4.summary.remainingMinutes === required - 20 && p4.pressure === 'over', JSON.stringify(p4.summary))
    check('the carryover names what is unplaced, the minutes owed and why', p4.carryover.length === 1 && p4.carryover[0].remainingMinutes === p4.summary.remainingMinutes && p4.carryover[0].reason === 'no_capacity')
    const c4 = await C.S.s.post('/api/class-log/confirm', { ...body4, idempotencyKey: key(), fingerprint: p4.fingerprint })
    check('confirming saves the placed part only', c4.body?.ok === true && c4.body.tasks === p4.tasks.length)
    const again = await previewClassLog(C.S.id, { classDate: C.pending[0], kind: 'none', items: [] } as any)
    if (!again.ok) throw new Error(again.message)
    check('a later preview owes exactly the remainder: not the full effort again, and the placed portion is not re-planned', again.tasks.length === 0 && again.summary.remainingMinutes === p4.summary.remainingMinutes, JSON.stringify(again.summary))
    await admin.from('availability_windows').update({ end_time: '13:00' }).eq('user_id', C.S.id).eq('weekday', weekdayOf(cDays[0])).throwOnError()
    const filled = await previewClassLog(C.S.id, { classDate: C.pending[0], kind: 'none', items: [] } as any)
    if (!filled.ok) throw new Error(filled.message)
    check('once room exists, exactly the remainder is planned (placed + new = the covered effort)', filled.tasks.reduce((x, t) => x + t.minutes, 0) === p4.summary.remainingMinutes && filled.carryover.length === 0, JSON.stringify(filled.summary))
    check('the new sittings continue the numbering and attach to the same group', filled.tasks.every(t => t.groupId && !t.groupNew) && filled.tasks[0]?.sitting?.index === p4.tasks.length + 1, JSON.stringify(filled.tasks.map(t => ({ groupId: t.groupId, groupNew: t.groupNew, sitting: t.sitting }))))

    // ---------------------------------------------------------------- 5: stale previews ---------------------------------------------------
    console.log('\n5. A preview that went stale: refused, input kept, nothing written\n')
    const E = await fresh('cf5')
    const o5 = await bigOutcome(E.S.id, E.pending[0])
    const body5 = { classDate: E.pending[0], kind: 'covered', items: [{ outcomeId: o5.id, extent: 'full' }] } as any
    const sessionsOf = async () => (await admin.from('class_sessions').select('id').eq('user_id', E.S.id)).data!.length
    const q1 = await previewClassLog(E.S.id, body5); if (!q1.ok) throw new Error(q1.message)
    await admin.from('profiles').update({ max_session_minutes: 30 }).eq('id', E.S.id)
    const lim = await E.S.s.post('/api/class-log/confirm', { ...body5, idempotencyKey: key(), fingerprint: q1.fingerprint })
    check('the sitting limit changed after the preview: refused as changed, with a rebuilt preview at the new limit', lim.status === 409 && lim.body?.code === 'preview_changed' && lim.body.preview?.ok && lim.body.preview.tasks.every((t: any) => t.minutes <= 30), JSON.stringify(lim.body).slice(0, 200))
    check('...and nothing was written', await sessionsOf() === 0)
    await admin.from('profiles').update({ max_session_minutes: 45 }).eq('id', E.S.id)
    const q2 = await previewClassLog(E.S.id, body5); if (!q2.ok) throw new Error(q2.message)
    const firstDay = q2.tasks[0].date
    await admin.from('calendar_commitments').insert({ user_id: E.S.id, label: 'cf5 booking', kind: 'personal', recurrence: 'none', starts_at: zonedTimeToUtc(firstDay, '08:00', E.tz).toISOString(), ends_at: zonedTimeToUtc(firstDay, '13:30', E.tz).toISOString(), is_protected: true, source: 'student', status: 'active', defines_cycle: false })
    const bk = await E.S.s.post('/api/class-log/confirm', { ...body5, idempotencyKey: key(), fingerprint: q2.fingerprint })
    check('a booking added after the preview takes the day: refused, a fresh preview avoids that day, nothing written', bk.status === 409 && bk.body?.code === 'preview_changed' && bk.body.preview.tasks.every((t: any) => t.date !== firstDay) && await sessionsOf() === 0, JSON.stringify(bk.body).slice(0, 200))
    // the authoritative database boundary, called directly as the student (a stale or tampered reviewed set)
    const uc = await userClient(E.S.email)
    const cyc = E.cycle.id as string
    let ord = 0
    const base = (o: Record<string, unknown>) => ({ id: `cf-${Math.random().toString(36).slice(2, 10)}`, sitting_ordinal: ++ord, title: 'x', detail: '', task_type: 'study', origin: 'planner', local_date: addDays(todayInZone(E.tz), 2), duration_minutes: 30, rationale: 'r', session_id: '', outcome_id: o5.id, lm_id: o5.reading, group_key: '', group_id: '', group_parts: 0, dependencies: [], ...o })
    const rpc = (tasks: unknown[]) => uc.rpc('apply_class_log', { p_cycle_id: cyc, p_idempotency_key: key(), p_class_date: E.pending[0], p_kind: 'covered', p_note: null, p_items: [{ outcome_id: o5.id, extent: 'full', portion_note: '', studied_in_class: false, planned_minutes: 900 }], p_tasks: tasks })
    const past = await rpc([base({ local_date: addDays(todayInZone(E.tz), -1) })])
    check('the database refuses a reviewed task dated in the past', /PREVIEW_CHANGED|outside/.test(past.error?.message ?? ''), past.error?.message)
    const longer = await rpc([base({ duration_minutes: 80 })])
    check('the database refuses a generated sitting longer than the student\'s limit', /PREVIEW_CHANGED/.test(longer.error?.message ?? ''), longer.error?.message)
    const crowded = await rpc([base({ duration_minutes: 45 }), base({ duration_minutes: 45 }), base({ duration_minutes: 45 }), base({ duration_minutes: 45 }), base({ duration_minutes: 45 })])
    check('the database refuses more minutes than the day really has left (5 x 45 > 4 hours)', /PREVIEW_CHANGED/.test(crowded.error?.message ?? ''), crowded.error?.message)
    check('every refusal wrote nothing: no session, no task', await sessionsOf() === 0 && (await admin.from('plan_blocks').select('id').eq('user_id', E.S.id).not('class_session_id', 'is', null)).data!.length === 0)
    let okDay = addDays(todayInZone(E.tz), 1); while ((weekdayOf(okDay) !== 6 && weekdayOf(okDay) !== 0) || okDay === firstDay) okDay = addDays(okDay, 1)   // a weekend day has the persona's real free window
    const ok = await rpc([base({ local_date: okDay })])
    check('a reviewed set that fits is accepted by the same command', !ok.error, ok.error?.message)

    // ---------------------------------------------------------------- 7: part/continued -> split -> report -> next week -> explicit confirm ---
    console.log('\n7. A part and a continued portion: split, reported, carried a week, never whole until confirmed\n')
    const F = await fresh('cf7', 20)
    const rd = (await admin.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(40)).data ?? []
    let reading = '', O1 = '', O2 = ''
    for (const r of rd) { const los = (await admin.from('reading_los').select('id').eq('reading_id', r.id).order('sequence').limit(2)).data ?? []; if (los.length === 2) { reading = r.id as string; O1 = los[0].id as string; O2 = los[1].id as string; break } }
    const cd = F.pending[0]
    const b7 = { classDate: cd, kind: 'covered', items: [{ outcomeId: O1, extent: 'part', portionNote: 'the first half' }, { outcomeId: O2, extent: 'continued' }] } as any
    const p7 = await previewClassLog(F.S.id, b7); if (!p7.ok) throw new Error(p7.message)
    const c7 = await F.S.s.post('/api/class-log/confirm', { ...b7, idempotencyKey: key(), fingerprint: p7.fingerprint })
    check('the logged part and continued portions are saved with linked sittings at a 20-minute limit', c7.body?.ok === true && p7.tasks.every(t => t.minutes <= 20) && p7.tasks.filter(t => t.outcomeId === O1).length >= 1)
    const sid = c7.body.sessionId as string
    const t7 = (await admin.from('plan_blocks').select('id, outcome_id, scope_group_id, revision, duration_minutes, local_date').eq('class_session_id', sid).order('local_date')).data!
    const ofO = (o: string) => t7.filter(t => t.outcome_id === o)
    // the student reports: all of the part's sittings completed with their own minutes; the continued one only partly done.
    for (const t of ofO(O1)) await F.S.s.json(`/api/tasks/${t.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'completed', actualDurationMinutes: 9, expectedRevision: t.revision }) })
    const first2 = ofO(O2)[0]
    await F.S.s.json(`/api/tasks/${first2.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'partial', actualDurationMinutes: 7, expectedRevision: first2.revision }) })
    const rep = (await admin.from('plan_blocks').select('id, execution, duration_minutes').in('id', ofO(O1).map(t => t.id))).data!
    check('reporting keeps the plan\'s minutes as the plan and records the student\'s own actual minutes separately', rep.every(r => r.execution === 'completed' && r.duration_minutes === ofO(O1).find(t => t.id === r.id)!.duration_minutes))
    let scope = await getCompletedCycleScope(F.S.id, new Date(Date.now() + 60_000))
    check('finishing every sitting of a PART does not make the whole outcome testable', !scope.targets.some(t => t.outcomeId === O1) && scope.pendingPortions.some(x => x.outcomeId === O1))
    check('the continued portion stays pending too', !scope.targets.some(t => t.outcomeId === O2) && scope.pendingPortions.some(x => x.outcomeId === O2))
    const cyc7 = F.cycle.id as string
    await admin.from('plan_blocks').delete().eq('user_id', F.S.id).eq('cycle_id', cyc7).is('class_session_id', null)   // fixture: only the class follow-ups remain in the week being reviewed
    const shift = await shiftStudentTimeline(F.S.id, 1, owned)
    await admin.from('planning_cycles').update({ starts_at_local: addDays(todayInZone(F.tz), -7), ends_at_local: addDays(todayInZone(F.tz), -1) }).eq('id', cyc7)   // fixture: the shifted cycle is a closed past week
    const choices: Record<string, unknown> = {}
    for (const t of t7) { const cur = (await admin.from('plan_blocks').select('execution').eq('id', t.id).single()).data!.execution; if (cur === 'partial') choices[t.id] = { happened: 'partial', next: 'continue', estimateMinutes: 15 } }
    const sessionsBefore = (await admin.from('class_sessions').select('id').eq('user_id', F.S.id)).data!.length
    const wp = await F.S.s.post('/api/weekly-review/preview', { cycleId: cyc7, choices, acknowledgeNoPaper: true })
    const wa = wp.body?.ok ? await F.S.s.post('/api/weekly-review/accept', { draftId: wp.body.draftId }) : wp
    check('the real weekly command rolls the week over (time fixture recorded: whole week, dates/lineage/minutes preserved)', wa.body?.ok === true && Object.keys(shift.tables).length > 0, JSON.stringify(wa.body).slice(0, 200))
    const succ = (await admin.from('plan_blocks').select('id, class_session_id, continued_from_task_id, scope_group_id, outcome_id').eq('user_id', F.S.id).not('continued_from_task_id', 'is', null)).data ?? []
    check('the continuation has lineage only: no restored class link, no second attendance', succ.length >= 1 && succ.every(s => s.class_session_id === null) && (await admin.from('class_sessions').select('id').eq('user_id', F.S.id)).data!.length === sessionsBefore)
    scope = await getCompletedCycleScope(F.S.id, new Date(Date.now() + 120_000))
    check('after the rollover neither portion has leaked into scope, and both are still visible with their original class date', !scope.targets.some(t => [O1, O2].includes(t.outcomeId)) && [O1, O2].every(o => scope.pendingPortions.some(x => x.outcomeId === o && x.classDate === addDays(cd, -7))), JSON.stringify(scope.pendingPortions.map(p => [p.outcomeId, p.classDate])))
    // The week has closed, so the continued portion's successor (this week's work) is where the student confirms: they finish it, then confirm the WHOLE outcome.
    const succ2 = succ.find(x => x.outcome_id === O2)
    check('(setup) the continued portion has a successor in the open week', !!succ2)
    await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', succ2!.id)
    const rev = (await admin.from('plan_blocks').select('revision').eq('id', succ2!.id).single()).data!.revision
    const confirmed = await F.S.s.post('/api/tests/scope/confirm', { blockId: succ2!.id, outcomeIds: [O2], expectedRevision: rev })
    scope = await getCompletedCycleScope(F.S.id, new Date(Date.now() + 180_000))
    check('explicit whole-outcome confirmation still works: only the confirmed outcome becomes testable; the part stays pending', confirmed.body?.ok === true && scope.targets.some(t => t.outcomeId === O2) && !scope.targets.some(t => t.outcomeId === O1) && scope.pendingPortions.some(x => x.outcomeId === O1), JSON.stringify(confirmed.body).slice(0, 200))
    check('the earlier sittings keep their own cycle, state and minutes (history untouched)', (await admin.from('plan_blocks').select('cycle_id, duration_minutes').in('id', t7.map(t => t.id))).data!.every(r => r.cycle_id === cyc7 && t7.some(t => t.duration_minutes === r.duration_minutes)))

    // ---------------------------------------------------------------- 8: ordered siblings at the authoritative boundary -------------------
    console.log('\n8. Ordered siblings: the database refuses an inversion even from a tampered reviewed draft\n')
    const G = await fresh('cf8', 20)
    // Two explicitly ordered sittings on one day (a class follow-up's sittings are one per day by a database invariant, so the same-day pair is seeded
    // directly on the declared-order column: the contract under test is `dependencies`, whoever created the tasks).
    let day8 = addDays(todayInZone(G.tz), 2); while (weekdayOf(day8) !== 6 && weekdayOf(day8) !== 0) day8 = addDays(day8, 1)
    const seed8 = async (id: string, h: string, deps: string[]) => { const r = await admin.from('plan_blocks').insert({ id, user_id: G.S.id, cycle_id: G.cycle.id, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'timed', execution: 'not_started', created_by: 'algorithm', local_date: day8, day: day8, starts_at: zonedTimeToUtc(day8, h, G.tz).toISOString(), duration_minutes: 20, duration: '20', dependencies: deps }); if (r.error) throw new Error(r.error.message) }
    const R8 = `ord${Date.now().toString(36)}`
    await seed8(`${R8}-1`, '09:00', []); await seed8(`${R8}-2`, '10:00', [`${R8}-1`])
    const sit = [{ id: `${R8}-1`, duration_minutes: 20 }, { id: `${R8}-2`, duration_minutes: 20 }]
    check('(setup) two ordered sittings on one day, the second declared to follow the first', true)
    const cur = (id: string) => admin.from('plan_blocks').select('starts_at, local_date, revision').eq('id', id).single().then(r => r.data!)
    const hash = (await admin.rpc('current_week_source_hash', { p_user: G.S.id, p_cycle: G.cycle.id })).data as string
    const mkDraft = async (moves: unknown[]) => (await admin.from('plan_drafts').insert({ user_id: G.S.id, purpose: 'class_change_recovery', status: 'ready', revision: 1, cycle_id: G.cycle.id, cycle_start_date: G.cycle.starts_at_local, cycle_end_date: G.cycle.ends_at_local, timezone: G.tz, onboarding_context_version: 1, context_fingerprint: hash, draft_json: { kind: 'class_recovery', change_key: `tamper-${key()}`, planning_date: todayInZone(G.tz), moves, unplaced: [], kept: [], unchanged: 0, receipt: null } }).select('id, revision').single()).data!
    const mv = async (id: string, h: string) => { const c = await cur(id); const s = zonedTimeToUtc(day8, h, G.tz).toISOString(); return { task_id: id, title: id, minutes: sit.find(x => x.id === id)!.duration_minutes, expected_revision: c.revision, reason: 'tamper', from: {}, to_date: day8, to_starts: s, to: {} } }
    const gc = await userClient(G.S.email)
    const bad = await mkDraft([await mv(sit[0].id, '11:00')])    // the earlier sitting moved AFTER its later sibling (10:00-10:20)
    const refused = await gc.rpc('accept_class_recovery', { p_draft_id: bad.id, p_expected_revision: 1, p_choices: {} })
    check('an earlier sitting moved after its later sibling on the same day is refused by the database', /STALE_PROPOSAL|before the one it follows/.test(refused.error?.message ?? ''), refused.error?.message)
    check('...and nothing moved (the whole acceptance rolled back)', String((await cur(sit[0].id)).starts_at).includes('T09:00'), JSON.stringify(await cur(sit[0].id)))
    await admin.from('plan_drafts').update({ status: 'discarded' }).eq('id', bad.id)
    const hash2 = (await admin.rpc('current_week_source_hash', { p_user: G.S.id, p_cycle: G.cycle.id })).data as string
    const good = await mkDraft([await mv(sit[0].id, '09:30')]); await admin.from('plan_drafts').update({ context_fingerprint: hash2 }).eq('id', good.id)
    const accepted = await gc.rpc('accept_class_recovery', { p_draft_id: good.id, p_expected_revision: 1, p_choices: {} })
    check('a move that keeps the order (earlier sitting still before its sibling) is accepted', !accepted.error, accepted.error?.message)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error && !/not found/i.test(r.error.message)) console.log(`  cleanup of ${id} failed: ${r.error.message}`) }
  }
  finish()
})().catch(async e => { console.error(e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
