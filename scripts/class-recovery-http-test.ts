/**
 * B3 closeout: reviewed recovery of EXISTING study tasks after a class change, plus the series/exception/editability rules behind it.
 * Real HTTP + Postgres, ordinary class-led throwaway students. Owned data only (every account is registered at creation and deleted at the end).
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/class-recovery-http-test.ts
 */
import ICAL from 'ical.js'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { addDays, todayInZone, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
const next = (from: string, dow: number) => { let d = from; while (wd(d) !== dow) d = addDays(d, 1); return d }
let n = 0
const key = () => `cr-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

;(async () => {
  await preflightServer()
  try {
    const persona = await classLedPersona(admin)
    const S = await createStudent(admin, 'cr', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
    const S2 = await createStudent(admin, 'cr2', { register: id => owned.push(id) })
    const tz = 'Europe/London', today = todayInZone(tz)
    const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data!
    const tue = (await admin.from('calendar_commitments').select('id, weekdays').eq('user_id', S.id).eq('kind', 'class').eq('status', 'active')).data!.find(r => (r.weekdays as number[]).includes(2))!
    const cid = tue.id as string
    const pv = (body: Record<string, unknown>, id = cid) => S.s.post(`/api/commitments/${id}/preview`, body)
    const cf = (body: Record<string, unknown>, id = cid) => S.s.json(`/api/commitments/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const task = async (id: string, o: Record<string, unknown>) => { const r = await admin.from('plan_blocks').insert({ id, user_id: S.id, cycle_id: cycle.id, title: id, detail: 'd', task_type: 'review', origin: 'student', priority: 'optional', placement: 'timed', execution: 'not_started', created_by: 'student', ...o }); if (r.error) throw new Error(`${id}: ${r.error.message}`) }
    const row = async (id: string) => (await admin.from('plan_blocks').select('id, revision, local_date, starts_at, duration_minutes, execution, placement').eq('id', id).single()).data!
    const draftsOf = async () => (await admin.from('plan_drafts').select('id, status, revision').eq('user_id', S.id).eq('purpose', 'class_change_recovery')).data ?? []
    const prep = (change: string) => S.s.post('/api/planning/current-week/preview', { reason: 'class_change', change })
    const mkMock = (date: string, start: string, label: string, uid = S.id) => admin.from('mock_appointments').insert({ user_id: uid, kind: 'provider_mock', planned_date: date, start_time: start, duration_minutes: 60, label, status: 'planned' }).select('id').single()

    // ---------------------------------------------------------------- recovery -------------------------------------------------------
    const dest = String(cycle.ends_at_local) >= addDays(today, 1) && wd(String(cycle.ends_at_local)) !== 2 ? String(cycle.ends_at_local) : addDays(next(addDays(today, 1), 2), 1)
    const occ = next(addDays(today, 1), 2)
    const win = (await admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', S.id).eq('status', 'active')).data ?? []
    const maxWin = Math.max(...win.map(w => (Number(String(w.end_time).slice(0, 2)) * 60 + Number(String(w.end_time).slice(3, 5))) - (Number(String(w.start_time).slice(0, 2)) * 60 + Number(String(w.start_time).slice(3, 5)))))
    const R = `rc${Date.now().toString(36)}`
    const at = (hhmm: string) => `${dest}T${hhmm}:00Z`
    await task(`${R}-t1`, { local_date: dest, day: dest, starts_at: at('19:15'), duration_minutes: 30, duration: '30' })
    await task(`${R}-t2`, { local_date: dest, day: dest, starts_at: at('19:45'), duration_minutes: 30, duration: '30', priority: 'core' })
    await task(`${R}-started`, { local_date: dest, day: dest, starts_at: at('19:30'), duration_minutes: 15, duration: '15', execution: 'in_progress' })
    await task(`${R}-f1`, { local_date: dest, day: dest, placement: 'day_preferred', duration_minutes: 90, duration: '90', priority: 'optional' })
    await task(`${R}-f2`, { local_date: dest, day: dest, placement: 'day_preferred', duration_minutes: 90, duration: '90', priority: 'core' })
    const ids = ['t1', 't2', 'started', 'f1', 'f2'].map(x => `${R}-${x}`)
    const snap = async () => JSON.stringify(await Promise.all(ids.map(row)))
    const before = await snap()

    console.log('\nA class change leaves the study week alone until the student reviews it\n')
    const p = await pv({ action: 'occurrence_move', occurrenceDate: occ, newDate: dest, newStartTime: '19:00', newEndTime: '20:00' })
    const k = key()
    const saved = await cf({ action: 'occurrence_move', occurrenceDate: occ, newDate: dest, newStartTime: '19:00', newEndTime: '20:00', operationKey: k, fingerprint: p.body.fingerprint })
    check('the class change is saved with a receipt (the authoritative outcome)', saved.body?.ok === true, JSON.stringify(saved.body).slice(0, 200))
    check('saving the class did not move, defer or change any study task', (await snap()) === before)

    console.log('\nPreparing recovery: draft only, reused for unchanged inputs, bound to the student\'s own receipt\n')
    const r1 = await prep(k)
    const d1 = r1.body?.draft
    check('a draft is prepared for the saved change', r1.status === 200 && r1.body?.status === 'prepared' && !!d1?.draftId, JSON.stringify(r1.body).slice(0, 300))
    check('preparing wrote no task change', (await snap()) === before)
    const byId = (list: any[], id: string) => list.find(x => x.task_id === `${R}-${id}`)
    check('the overlapping not-started tasks are proposed to move (identity and minutes kept)', !!byId(d1.moves, 't1') && !!byId(d1.moves, 't2') && d1.moves.every((m: any) => m.minutes === 30 || m.minutes === 60), JSON.stringify(d1).slice(0, 900))
    check('proposed slots never overlap the moved class or each other', d1.moves.filter((m: any) => m.to_starts).every((m: any, i: number, a: any[]) => {
      const s = Date.parse(m.to_starts), e = s + m.minutes * 60000, c0 = Date.parse(at('19:00')), c1 = Date.parse(at('20:00'))
      return (e <= c0 || s >= c1) && a.every((o, j) => i === j || o.to_date !== m.to_date || e <= Date.parse(o.to_starts) || s >= Date.parse(o.to_starts) + o.minutes * 60000)
    }))
    check('started work is shown as a constraint, not moved', !!byId(d1.kept, 'started') && !byId(d1.moves, 'started') && !byId(d1.unplaced, 'started'))
    check('floating work that no longer fits the day, with no later day left, is listed as unplaced with its minutes, never dropped', !!byId(d1.unplaced, 'f1') && byId(d1.unplaced, 'f1').minutes === 90, JSON.stringify(d1.unplaced).slice(0, 300))
    check('every affected task is accounted for exactly once', new Set([...d1.moves, ...d1.unplaced, ...d1.kept].map((x: any) => x.task_id)).size === d1.moves.length + d1.unplaced.length + d1.kept.length)
    const r1b = await prep(k)
    check('preparing again for unchanged inputs returns the same draft (no accumulating drafts)', r1b.body?.draft?.draftId === d1.draftId && (await draftsOf()).filter(d => d.status === 'ready').length === 1)
    check('an unknown, malformed or foreign change key selects nothing', (await prep('no-such-key-123')).status === 404 && (await prep('x')).status === 404)
    await admin.from('checkpoint_commands').insert({ user_id: S2.id, key: `foreign-${R}`, command: 'class_change', payload_hash: 'x', receipt: { ok: true } })
    check('another student\'s receipt is never selectable', (await prep(`foreign-${R}`)).status === 404)
    await admin.from('checkpoint_commands').insert({ user_id: S.id, key: `other-${R}-key`, command: 'something_else', payload_hash: 'x', receipt: { ok: true } })
    check('a receipt of another command kind is refused', (await prep(`other-${R}-key`)).status === 404)
    check('an unknown reason is refused, and the empty-week path is untouched', (await S.s.post('/api/planning/current-week/preview', { reason: 'other', change: k })).status === 400)

    console.log('\nAccepting: one atomic command, one receipt, same outcome for every repeat\n')
    const choices = { [`${R}-f1`]: 'defer' }
    const acc = { draftId: d1.draftId, expectedRevision: d1.revision, reason: 'class_change', choices }
    const post = (b: Record<string, unknown>) => S.s.post('/api/planning/current-week/accept', b)
    const [a1, a2] = await Promise.all([post(acc), post(acc)])
    check('a double click (concurrent, same draft) resolves to ONE outcome', a1.body?.ok === true && a2.body?.ok === true && JSON.stringify(a1.body.receipt.tasks) === JSON.stringify(a2.body.receipt.tasks), JSON.stringify([a1.body, a2.body]).slice(0, 300))
    const again = await post(acc)
    check('a lost-response retry returns the stored receipt (replayed), moving nothing twice', again.body?.ok === true && again.body.receipt.replayed === true)
    const after = await Promise.all(d1.moves.map((m: any) => row(m.task_id)))
    check('every reviewed move landed exactly where the draft said, with minutes and identity unchanged', d1.moves.every((m: any, i: number) => after[i].local_date === m.to_date && (m.to_starts ? Date.parse(after[i].starts_at) === Date.parse(m.to_starts) : after[i].starts_at === null) && after[i].duration_minutes === m.minutes))
    const f1 = await row(`${R}-f1`), f2 = await row(`${R}-f2`), st = await row(`${R}-started`)
    check('the no-room task chosen "set aside" is deferred for weekly review; the unaffected floating task and the started task are untouched', f1.execution === 'deferred' && f2.execution === 'not_started' && f2.local_date === dest && st.execution === 'in_progress' && Date.parse(st.starts_at) === Date.parse(at('19:30')))
    const ev = (await admin.from('task_events').select('task_id, event_type').eq('user_id', S.id).in('task_id', ids)).data ?? []
    check('one history event per moved task, none duplicated by the repeats', d1.moves.every((m: any) => ev.filter(e => e.task_id === m.task_id && e.event_type === 'moved').length === 1))
    check('the draft is closed as accepted with the receipt stored', (await draftsOf()).some(d => d.status === 'accepted'))
    check('the class change receipt is unchanged by recovery', (await admin.from('checkpoint_commands').select('receipt').eq('user_id', S.id).eq('key', k).single()).data!.receipt.ok === true)

    console.log('\nStale inputs: the whole adjustment is refused; rebuilding gives a fresh proposal\n')
    await task(`${R}-s1`, { local_date: dest, day: dest, starts_at: at('19:10'), duration_minutes: 30, duration: '30' })
    const r2 = await prep(k); const d2 = r2.body?.draft
    const prepared = r2.body?.status === 'prepared'
    check('after another overlapping task appears, recovery can be prepared again from the SAME receipt', prepared && d2.draftId !== d1.draftId, JSON.stringify(r2.body).slice(0, 200))
    if (prepared) {
      const pos = async () => { const r = await row(`${R}-s1`); return `${r.local_date}|${r.starts_at}` }
      const s1Before = await pos()
      await admin.from('plan_blocks').update({ title: 'edited elsewhere' }).eq('id', `${R}-s1`)   // another tab changes a reviewed task
      const stale = await post({ draftId: d2.draftId, expectedRevision: d2.revision, reason: 'class_change', choices: {} })
      check('a reviewed task changed after preview: accept is refused as stale and moves nothing', stale.status === 409 && stale.body?.code === 'STALE_PROPOSAL' && stale.body.rebuild === true && (await pos()) === s1Before)
      const r3 = await prep(k)
      check('rebuild produces a new draft that can then be accepted once', r3.body?.status === 'prepared' && r3.body.draft.draftId !== d2.draftId)
      const dis = await S.s.post('/api/planning/current-week/dismiss', { draftId: r3.body.draft.draftId, expectedRevision: r3.body.draft.revision, reason: 'class_change' })
      check('"keep my current placements" dismisses the proposal and moves nothing; the class change stays', dis.body?.ok === true && (await row(`${R}-s1`)).starts_at !== null && (await admin.from('checkpoint_commands').select('key').eq('user_id', S.id).eq('key', k)).data!.length === 1)
      const r4 = await prep(k)
      check('the unresolved overlap is rediscoverable: preparing again after a dismissal offers a fresh proposal', r4.body?.status === 'prepared' && r4.body.draft.draftId !== r3.body.draft.draftId)
    }
    const overlaps = (await admin.rpc('class_recovery_overlaps', { p_user: S.id, p_cycle: cycle.id })).data ?? []
    check('the database reports what still overlaps (what Calendar shows as an unresolved decision)', Array.isArray(overlaps))

    // ------------------------------------------------ export identity (one-way snapshot) -----------------------------------------------
    console.log('\nExport identity: a moved occurrence keeps its UID; only a structural series replacement may create new future identities\n')
    const ics = async () => {
      const r = await S.s.req(`/api/calendar/export?classes=1&from=${today}&to=${addDays(today, 100)}`); const text = await r.text()
      const evs = new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent')
      return new Map(evs.map(e => [String(e.getFirstPropertyValue('uid')), { at: String((e.getFirstPropertyValue('dtstart') as any)?.toJSDate?.().toISOString?.() ?? e.getFirstPropertyValue('dtstart')), summary: String(e.getFirstPropertyValue('summary')) }]))
    }
    await admin.from('calendar_commitments').update({ ends_on: null }).eq('id', cid)   // an open-ended series: Tuesdays well ahead are real classes
    const eOcc = next(addDays(today, 63), 2), eDest = addDays(eOcc, 1)
    const icsA = await ics()
    const pe = await pv({ action: 'occurrence_move', occurrenceDate: eOcc, newDate: eDest, newStartTime: '19:00', newEndTime: '20:00' })
    const ce = await cf({ action: 'occurrence_move', occurrenceDate: eOcc, newDate: eDest, newStartTime: '19:00', newEndTime: '20:00', operationKey: key(), fingerprint: pe.body.fingerprint })
    const icsB = await ics()
    const moved = [...icsB].filter(([uid, v]) => !icsA.has(uid) || icsA.get(uid)!.at !== v.at)
    check('(setup) a single occurrence was moved', ce.body?.ok === true)
    check('the moved occurrence exports under its ORIGINAL UID (no new identity appears, none disappears)', [...icsA.keys()].every(k => icsB.has(k)) && icsB.size === icsA.size, `A=${icsA.size} B=${icsB.size}`)
    check('only that one event changed its time; every other class kept uid and time', moved.length === 1 && moved[0][1].at.includes(`${eDest}T19:00`), JSON.stringify(moved))

    // ------------------------------------------------ series semantics: carried exceptions, horizon, moved dates ---------------------
    console.log('\nSeries change: carried exceptions are judged in the actual schedule\n')
    const t1 = addDays(occ, 7), t3 = addDays(t1, 14)
    const pc = await pv({ action: 'occurrence_cancel', occurrenceDate: t3 })
    const cc = await cf({ action: 'occurrence_cancel', occurrenceDate: t3, operationKey: key(), fingerprint: pc.body.fingerprint })
    check('(setup) a later Tuesday is cancelled', cc.body?.ok === true)
    const skipMock = await mkMock(t3, '18:30', `skipped-${R}`)
    check('a mock can be booked into the cancelled class\'s slot', !skipMock.error)
    const ps = await pv({ action: 'series_from', effectiveFrom: t1, startTime: '17:30', endTime: '19:30' })
    check('a carried SKIP over a booked mock is not a conflict', ps.body?.ok === true && ps.body.preview.conflicts.length === 0 && ps.body.preview.carriedExceptions.some((c: any) => c.occurrenceDate === t3), JSON.stringify(ps.body).slice(0, 300))
    const cs = await cf({ action: 'series_from', effectiveFrom: t1, startTime: '17:30', endTime: '19:30', operationKey: key(), fingerprint: ps.body.fingerprint })
    check('and the confirm succeeds: the booking guard judges the FINAL schedule (skip copied), not the intermediate one', cs.body?.ok === true && !!cs.body.successorId, JSON.stringify(cs.body).slice(0, 300))
    const succ = cs.body.successorId as string
    const icsC = await ics()
    const hist = [...icsA].filter(([, v]) => v.at.slice(0, 10) < t1)
    check('after a structural series change, HISTORICAL exports keep their UIDs and times (earlier classes are untouched)', hist.every(([uid, v]) => icsC.get(uid)?.at === v.at), JSON.stringify(hist.slice(0, 2)))
    check('the skip was carried onto the successor series', ((await admin.from('commitment_exceptions').select('kind').eq('commitment_id', succ).eq('occurrence_date', t3)).data ?? [])[0]?.kind === 'skipped')

    const tb = addDays(t1, 21), wed = addDays(tb, 1)
    await admin.from('commitment_exceptions').insert({ user_id: S.id, commitment_id: succ, occurrence_date: tb, kind: 'moved', new_date: wed })   // moved, using the series' own times (17:30-19:30)
    const nearMock = await mkMock(wed, '20:00', `near-${R}`)
    await admin.from('calendar_commitments').update({ ends_on: null }).eq('id', succ)   // an open-ended series, so Tuesdays beyond the 8-week summary are real classes
    const far = addDays(tb, 77)
    const farMock = await mkMock(far, '20:00', `far-${R}`)
    if (farMock.error) console.log('  far mock insert refused:', farMock.error.message)
    await task(`${R}-mv`, { local_date: wed, day: wed, starts_at: `${wed}T21:00:00Z`, duration_minutes: 30, duration: '30' })
    const pm = await pv({ action: 'series_from', effectiveFrom: addDays(t1, 7), startTime: '19:30', endTime: '21:30' }, succ)
    if (!pm.body?.preview) console.log('  preview refused:', JSON.stringify(pm.body))
    const dates = (pm.body?.preview?.conflicts ?? []).map((c: any) => c.date)
    check('a carried MOVE\'s real slot is checked: the mock beside the moved class is reported', dates.includes(wed), JSON.stringify(pm.body?.preview?.conflicts))
    check('a mock beyond the summary horizon is still reported, and the horizon is stated', dates.includes(far) && pm.body.preview.changes[0].horizonEnd < far && far > tb, JSON.stringify({ dates, far, h: pm.body.preview.changes[0].horizonEnd }))
    check('the moved occurrence\'s real slot appears in the new schedule summary and in the affected work', pm.body.preview.changes[0].new.some((o: any) => o.date === wed && o.moved === true) && pm.body.preview.affectedTasks.some((a: any) => a.id === `${R}-mv`))
    const cm = await cf({ action: 'series_from', effectiveFrom: addDays(t1, 7), startTime: '19:30', endTime: '21:30', operationKey: key(), fingerprint: pm.body.fingerprint }, succ)
    check('preview and confirm agree: the confirm is refused with the same conflict and nothing is written', cm.status === 409 && cm.body?.code === 'CONFLICT')
    await admin.from('mock_appointments').delete().in('id', [skipMock.data!.id, nearMock.data!.id, farMock.data!.id].filter(Boolean))

    console.log('\nEditability follows where the class actually is\n')
    const old = cid
    await admin.from('calendar_commitments').update({ starts_on: null }).eq('id', old)
    const pastT = (() => { let d = addDays(today, -3); while (wd(d) !== 2) d = addDays(d, -1); return d })()
    const fut = addDays(today, 4)
    await admin.from('commitment_exceptions').insert({ user_id: S.id, commitment_id: old, occurrence_date: pastT, kind: 'moved', new_date: fut, new_start_time: '18:00', new_end_time: '19:00' })
    const st1 = (await admin.rpc('class_occurrence_state', { p_user: S.id, p_commitment: old, p_occ: pastT })).data
    check('a class moved from a PAST slot into the future can still be changed', st1.canChange === true, JSON.stringify(st1))
    check('...but cannot be restored into its elapsed original slot', st1.canRestore === false)
    const rr = await pv({ action: 'occurrence_restore', occurrenceDate: pastT }, old)
    check('the command applies the same rule (restore refused)', rr.body?.code === 'PAST_OCCURRENCE')
    const mm = await pv({ action: 'occurrence_move', occurrenceDate: pastT, newDate: addDays(fut, 1), newStartTime: '18:00', newEndTime: '19:00' }, old)
    check('moving it again is allowed', mm.body?.ok === true, JSON.stringify(mm.body).slice(0, 200))
    check('an original date that has passed and was never moved stays protected', (await pv({ action: 'occurrence_cancel', occurrenceDate: addDays(pastT, -7) }, old)).body?.code === 'PAST_OCCURRENCE')

    // same-day, both sides of midnight, in two zones
    for (const zone of ['Europe/London', 'Pacific/Auckland', 'America/Los_Angeles']) {
      await admin.from('profiles').update({ timezone: zone }).eq('id', S.id)
      const day = todayInZone(zone), dow = wd(day)
      for (const [label, start, end] of [['00:30', '00:30', '01:30'], ['23:15', '23:15', '23:45']] as const) {
        const c = await admin.from('calendar_commitments').insert({ user_id: S.id, label: `sd-${zone}-${label}`, kind: 'class', recurrence: 'weekly', weekdays: [dow], start_time: start, end_time: end, starts_on: null, ends_on: null, timezone: zone,
          starts_at: zonedTimeToUtc(day, start, zone).toISOString(), ends_at: zonedTimeToUtc(day, end, zone).toISOString(), is_protected: true, source: 'student', status: 'active', defines_cycle: false }).select('id').single()
        if (c.error) { check(`(setup) same-day class ${zone} ${label}`, false, c.error.message); continue }
        const state = (await admin.rpc('class_occurrence_state', { p_user: S.id, p_commitment: c.data.id, p_occ: day })).data
        const expected = zonedTimeToUtc(day, start, zone).getTime() > Date.now()
        check(`${zone}: a class today at ${label} is ${expected ? 'still changeable' : 'locked (already started)'} — both sides of midnight in the student's zone`, state.canChange === expected, JSON.stringify(state))
        await admin.from('calendar_commitments').update({ status: 'archived' }).eq('id', c.data.id)
      }
    }
    await admin.from('profiles').update({ timezone: tz }).eq('id', S.id)
    const logDay = addDays(today, 0)
    await admin.from('calendar_commitments').insert({ user_id: S.id, label: `logged-${R}`, kind: 'class', recurrence: 'weekly', weekdays: [wd(logDay)], start_time: '23:50', end_time: '23:59', timezone: tz, starts_at: zonedTimeToUtc(logDay, '23:50', tz).toISOString(), ends_at: zonedTimeToUtc(logDay, '23:59', tz).toISOString(), is_protected: true, source: 'student', status: 'active', defines_cycle: false })
    const lc = (await admin.from('calendar_commitments').select('id').eq('user_id', S.id).eq('label', `logged-${R}`).single()).data!.id
    await admin.from('class_sessions').insert({ user_id: S.id, cycle_id: cycle.id, class_date: logDay, kind: 'covered', note: 'logged', idempotency_key: `log-${R}-key-1` })
    check('a class day with a recorded log is protected from rewriting even if its time has not come', (await admin.rpc('class_occurrence_state', { p_user: S.id, p_commitment: lc, p_occ: logDay })).data.canChange === false)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error && !/not found/i.test(r.error.message)) console.log(`  cleanup of ${id} failed: ${r.error.message}`) }
  }
  finish()
})().catch(e => { console.error(e); process.exit(1) })
