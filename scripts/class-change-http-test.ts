/**
 * B3: changing a class through the previewed, keyed, atomic protocol (POST /api/commitments/[id]/preview, PATCH /api/commitments/[id] with an action).
 * Real HTTP + Postgres, one class-led throwaway student (Tuesday/Thursday evening classes). Owned data only.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/class-change-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
const next = (from: string, dow: number) => { let d = from; while (wd(d) !== dow) d = addDays(d, 1); return d }
let n = 0
const key = () => `cc-${Date.now()}-${++n}-${Math.random().toString(36).slice(2, 8)}`

;(async () => {
  await preflightServer()
  try {
    const persona = await classLedPersona(admin)
    const S = await createStudent(admin, 'cc', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
    const tz = 'Europe/London', today = todayInZone(tz)
    const tue = (await admin.from('calendar_commitments').select('id, weekdays').eq('user_id', S.id).eq('kind', 'class').eq('status', 'active')).data!.find(r => (r.weekdays as number[]).includes(2))!
    const id = tue.id as string
    const t1 = next(addDays(today, 2), 2), t2 = addDays(t1, 7), t3 = addDays(t1, 14), wed = addDays(t1, 1)
    const exc = async () => (await admin.from('commitment_exceptions').select('occurrence_date, kind, new_date, new_start_time, new_end_time').eq('commitment_id', id).order('occurrence_date')).data ?? []
    const ver = async () => (await admin.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version as number
    const pv = (body: Record<string, unknown>, cid = id) => S.s.post(`/api/commitments/${cid}/preview`, body)
    const cf = (body: Record<string, unknown>, cid = id) => S.s.json(`/api/commitments/${cid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const mv = (occ: string, to: string, s = '18:30', e = '19:30') => ({ action: 'occurrence_move', occurrenceDate: occ, newDate: to, newStartTime: s, newEndTime: e })
    const mkMock = (date: string, start: string, label: string) => admin.from('mock_appointments').insert({ user_id: S.id, kind: 'provider_mock', planned_date: date, start_time: start, duration_minutes: 60, label, status: 'planned' }).select('id').single()

    console.log('\nStrict validation: refused with nothing written\n')
    const rowsBefore = JSON.stringify(await exc()), v0 = await ver()
    const bad: [string, Record<string, unknown>, string][] = [
      ['an unknown action', { action: 'delete_everything' }, 'INVALID_INPUT'],
      ['an impossible date', mv('2027-02-30', t1), 'INVALID_DATE'],
      ['a date that is not one of this class\'s sessions (a Wednesday)', mv(wed, t2), 'NOT_AN_OCCURRENCE'],
      ['an invalid local time', mv(t1, wed, '25:00', '26:00'), 'INVALID_TIME'],
      ['a reversed range', mv(t1, wed, '19:30', '18:30'), 'INVALID_RANGE'],
      ['a past occurrence', mv(addDays(today, -7 - ((wd(today) + 5) % 7)), t1), 'PAST_OCCURRENCE'],
      ['a restore with nothing to restore', { action: 'occurrence_restore', occurrenceDate: t1 }, 'NO_CHANGE'],
      ['invalid weekdays', { action: 'series_from', effectiveFrom: t2, weekdays: [9] }, 'INVALID_WEEKDAYS'],
      ['an empty weekday list', { action: 'series_from', effectiveFrom: t2, weekdays: [] }, 'INVALID_WEEKDAYS'],
      ['a series start in the past', { action: 'series_from', effectiveFrom: addDays(today, -3), startTime: '17:00', endTime: '18:00' }, 'PAST_DATE'],
      ['a series change that changes nothing', { action: 'series_from', effectiveFrom: t2, weekdays: [2], startTime: '18:00', endTime: '20:00' }, 'NO_CHANGE'],
    ]
    for (const [name, body, code] of bad) {
      const r = await pv(body)
      check(`preview refuses ${name}`, r.status >= 400 && r.body?.code === code, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`)
    }
    const stray = await cf({ ...mv(t1, wed), operationKey: key(), fingerprint: 'x'.repeat(32) })
    check('confirm with a wrong fingerprint is refused as stale, writes nothing', stray.status === 409 && stray.body?.code === 'STALE_PREVIEW' && JSON.stringify(await exc()) === rowsBefore)
    check('a foreign or malformed commitment id is "not available", never another class', (await pv(mv(t1, wed), '00000000-0000-4000-8000-000000000000')).status === 404 && (await pv(mv(t1, wed), 'not-a-uuid')).status === 404)
    check('the legacy unchecked occurrence path is retired', (await cf({ scope: 'occurrence', occurrenceDate: t1, kind: 'skipped' })).body?.code === 'USE_CHANGE_PROTOCOL' && JSON.stringify(await exc()) === rowsBefore)
    check('a class\'s days/times cannot be rewritten for ALL classes any more (earlier classes keep their record)', (await cf({ startTime: '17:00', endTime: '18:00' })).body?.code === 'USE_FUTURE_EDIT')
    check('a malformed series body is refused, not silently filtered', (await cf({ weekdays: [1, 'x'] })).status === 400 && (await cf({ startTime: '9am' })).status === 400)
    check('none of that wrote anything or moved the setup version', JSON.stringify(await exc()) === rowsBefore && (await ver()) === v0)

    console.log('\nThis class only: preview, confirm, replay\n')
    const p1 = await pv(mv(t1, wed, '18:30', '19:30'))
    check('preview is read-only and shows the old and new session', p1.body?.ok === true && p1.body.preview.changes[0].to.date === wed && p1.body.preview.changes[0].from.date === t1 && JSON.stringify(await exc()) === rowsBefore, JSON.stringify(p1.body).slice(0, 200))
    const k1 = key(), req1 = { ...mv(t1, wed, '18:30', '19:30'), operationKey: k1, fingerprint: p1.body.fingerprint, expectedToken: p1.body.token }
    const [a, b] = await Promise.all([cf(req1), cf(req1)])
    check('a double click (same key, concurrently) resolves to ONE durable outcome', a.body?.ok === true && b.body?.ok === true && (await exc()).length === 1, JSON.stringify([a.body, b.body]).slice(0, 220))
    const lost = await cf(req1)
    check('retrying after a lost response replays the stored receipt (no second write, not a stale error)', lost.body?.ok === true && lost.body.replayed === true && (await exc()).length === 1)
    const reuse = await cf({ ...req1, newStartTime: '19:00', newEndTime: '20:00' })
    check('the same key with a DIFFERENT payload is refused, never replaying the wrong change', reuse.status === 409 && reuse.body?.code === 'KEY_REUSED')
    const e1 = (await exc())[0]
    check('exactly the previewed exception was saved for that one occurrence', e1.occurrence_date === t1 && e1.kind === 'moved' && e1.new_date === wed && String(e1.new_start_time).startsWith('18:30'))
    check('a single occurrence change does not move the setup version', (await ver()) === v0)

    console.log('\nStaleness and bookings\n')
    const p2 = await pv({ action: 'occurrence_cancel', occurrenceDate: t3 })
    await cf({ action: 'occurrence_cancel', occurrenceDate: t3, operationKey: key(), fingerprint: p2.body.fingerprint })   // someone else cancels it first
    const staleCancel = await cf({ action: 'occurrence_cancel', occurrenceDate: t3, operationKey: key(), fingerprint: p2.body.fingerprint, expectedToken: p2.body.token })
    check('a preview made before another change is refused (stale source) and the form can ask for a fresh preview', staleCancel.status === 409 && ['STALE_SOURCE', 'STALE_PREVIEW'].includes(staleCancel.body?.code))
    // a booking made after the preview
    const p3 = await pv(mv(t3, addDays(t3, 1), '18:00', '19:00'))
    const mk = await mkMock(addDays(t3, 1), '18:30', 'Booked after preview'); if (mk.error) throw new Error(mk.error.message)
    const snap = JSON.stringify(await exc())
    const late = await cf({ ...mv(t3, addDays(t3, 1), '18:00', '19:00'), operationKey: key(), fingerprint: p3.body.fingerprint })
    check('a mock booked after the preview refuses the confirm; nothing changed; the fresh preview names it', late.status === 409 && JSON.stringify(await exc()) === snap, JSON.stringify(late.body).slice(0, 200))
    const p3b = await pv(mv(t3, addDays(t3, 1), '18:00', '19:00'))
    const refused = await cf({ ...mv(t3, addDays(t3, 1), '18:00', '19:00'), operationKey: key(), fingerprint: p3b.body.fingerprint })
    check('a fresh preview reports the conflict and its confirm is refused with CONFLICT (booking named)', p3b.body.preview.conflicts.length === 1 && refused.status === 409 && refused.body?.code === 'CONFLICT' && JSON.stringify(refused.body).includes('Booked after preview') && JSON.stringify(await exc()) === snap)
    await admin.from('mock_appointments').delete().eq('id', mk.data!.id)

    // restore versus a newly booked original slot
    const orig = (await exc()).find(e => e.occurrence_date === t1)!
    const mk2 = await mkMock(t1, '18:30', 'Booked in original slot'); if (mk2.error) throw new Error(mk2.error.message)
    const pr = await pv({ action: 'occurrence_restore', occurrenceDate: t1 })
    check('restore preview names the booked mock in the original slot', pr.body?.preview?.conflicts?.some((c: any) => /original slot/.test(c.title)) === true)
    const rr = await cf({ action: 'occurrence_restore', occurrenceDate: t1, operationKey: key(), fingerprint: pr.body.fingerprint })
    check('restore over a newly booked slot is refused and the exception is intact', rr.status === 409 && rr.body?.code === 'CONFLICT' && (await exc()).some(e => e.occurrence_date === t1 && e.kind === 'moved' && e.new_date === orig.new_date))
    await admin.from('mock_appointments').delete().eq('id', mk2.data!.id)
    const pr2 = await pv({ action: 'occurrence_restore', occurrenceDate: t1 })
    const rr2 = await cf({ action: 'occurrence_restore', occurrenceDate: t1, operationKey: key(), fingerprint: pr2.body.fingerprint })
    check('once the slot is free, restore returns the class to its original time', rr2.body?.ok === true && !(await exc()).some(e => e.occurrence_date === t1))

    console.log('\nRaces: confirming a change while a mock is booked (both orders)\n')
    let viol = 0, applied = 0, refusedN = 0
    for (let round = 0; round < 6; round++) {
      const occ = addDays(t1, 7 * (round + 1)), dest = addDays(occ, 1)
      const p = await pv(mv(occ, dest, '18:00', '19:00')); if (!p.body?.ok) continue
      const book = async () => { await admin.from('mock_appointments').delete().eq('user_id', S.id).eq('label', `race-${round}`); return mkMock(dest, '18:30', `race-${round}`) }
      const change = () => cf({ ...mv(occ, dest, '18:00', '19:00'), operationKey: key(), fingerprint: p.body.fingerprint })
      // The booking starts at staggered offsets so the two writers genuinely overlap at different points; a mock that lands first is a stale preview.
      const lag = (ms: number) => new Promise(r => setTimeout(r, ms))
      const [x] = round % 2 === 0 ? await Promise.all([change(), lag(round * 90).then(book)]) : await Promise.all([lag(round * 90).then(change), book()])
      const moved = (await exc()).some(e => e.occurrence_date === occ && e.kind === 'moved')
      const mocked = !!(await admin.from('mock_appointments').select('id').eq('user_id', S.id).eq('label', `race-${round}`).maybeSingle()).data
      if (moved && mocked) viol++
      if (moved) applied++; else refusedN++
      if (x.status >= 500) viol++
      await admin.from('mock_appointments').delete().eq('user_id', S.id).eq('label', `race-${round}`)
      await admin.from('commitment_exceptions').delete().eq('commitment_id', id).eq('occurrence_date', occ)
    }
    check(`edit-versus-book, six staggered rounds in alternating order: never both, never a 5xx (change applied in ${applied}, refused in ${refusedN})`, viol === 0)
    // The other order, deterministically: the change is committed first, then the booking is refused by the database guard.
    const dOcc = addDays(t1, 7), dDest = addDays(dOcc, 1)
    const pd = await pv(mv(dOcc, dDest, '18:00', '19:00'))
    check('(setup) a change is committed first', (await cf({ ...mv(dOcc, dDest, '18:00', '19:00'), operationKey: key(), fingerprint: pd.body.fingerprint })).body?.ok === true)
    const late2 = await mkMock(dDest, '18:30', 'after the change')
    check('...then a booking onto the moved class is refused by the database (BK409), not by a UI precheck', late2.error?.code === 'BK409', JSON.stringify(late2.error))
    await admin.from('commitment_exceptions').delete().eq('commitment_id', id).eq('occurrence_date', dOcc)

    console.log('\nRaces: restoring a moved class while its ORIGINAL slot is being booked (both lock orders)\n')
    {
      let rviol = 0, rRestored = 0, rRefused = 0, rounds = 0
      const lag = (ms: number) => new Promise(r => setTimeout(r, ms))
      for (let round = 0; round < 6; round++) {
        const occ = addDays(t1, 7 * (round + 1)), dest = addDays(occ, 1)
        const pm = await pv(mv(occ, dest, '18:00', '19:00')); if (!pm.body?.ok) continue
        if (!(await cf({ ...mv(occ, dest, '18:00', '19:00'), operationKey: key(), fingerprint: pm.body.fingerprint })).body?.ok) continue
        const pr = await pv({ action: 'occurrence_restore', occurrenceDate: occ }); if (!pr.body?.ok) continue
        rounds++
        const book = () => mkMock(occ, '18:30', `rrace-${round}`)
        const restore = () => cf({ action: 'occurrence_restore', occurrenceDate: occ, operationKey: key(), fingerprint: pr.body.fingerprint })
        // alternating order with staggered starts: the booking first / the restore first
        const [x, y] = round % 2 === 0 ? await Promise.all([restore(), lag(round * 90).then(book)]) : await Promise.all([lag(round * 90).then(restore), book()])
        const restored = !(await exc()).some(e => e.occurrence_date === occ && e.kind === 'moved')
        const mocked = !!(await admin.from('mock_appointments').select('id').eq('user_id', S.id).eq('label', `rrace-${round}`).maybeSingle()).data
        if (restored && mocked) rviol++            // both can never stand: the class would sit on a booked mock
        if (!restored && !mocked) rviol++          // an overlap must resolve one way: either the restore or the booking happened
        if (restored) rRestored++; else rRefused++
        if ((x as any).status >= 500) rviol++        // x is always the restore reply
        void y
        await admin.from('mock_appointments').delete().eq('user_id', S.id).eq('label', `rrace-${round}`)
        await admin.from('commitment_exceptions').delete().eq('commitment_id', id).eq('occurrence_date', occ)
      }
      check(`restore-versus-book, ${rounds} staggered rounds in alternating order: exactly one wins, never both, never a 5xx (restored ${rRestored}, refused ${rRefused})`, rounds >= 4 && rviol === 0, JSON.stringify({ rounds, rviol }))
      // the two orders, deterministically
      const o2 = addDays(t1, 7), d2 = addDays(o2, 1)
      const pm2 = await pv(mv(o2, d2, '18:00', '19:00')); await cf({ ...mv(o2, d2, '18:00', '19:00'), operationKey: key(), fingerprint: pm2.body.fingerprint })
      const pr2 = await pv({ action: 'occurrence_restore', occurrenceDate: o2 })
      const first = await mkMock(o2, '18:30', 'book-first')
      const lateRestore = await cf({ action: 'occurrence_restore', occurrenceDate: o2, operationKey: key(), fingerprint: pr2.body.fingerprint })
      check('order 1 (booking first): the restore is refused and the class stays where it was moved', !first.error && lateRestore.status === 409 && (await exc()).some(e => e.occurrence_date === o2 && e.kind === 'moved'), JSON.stringify([first.error, lateRestore.status]))
      await admin.from('mock_appointments').delete().eq('user_id', S.id).eq('label', 'book-first')
      const pr3 = await pv({ action: 'occurrence_restore', occurrenceDate: o2 })
      const okRestore = await cf({ action: 'occurrence_restore', occurrenceDate: o2, operationKey: key(), fingerprint: pr3.body.fingerprint })
      const lateBook = await mkMock(o2, '18:30', 'book-after')
      check('order 2 (restore first): the booking onto the restored class is refused by the database guard (BK409)', okRestore.body?.ok === true && lateBook.error?.code === 'BK409', JSON.stringify([okRestore.status, lateBook.error]))
      await admin.from('commitment_exceptions').delete().eq('commitment_id', id).eq('occurrence_date', o2)
    }

    console.log('\nThis and future classes\n')
    await admin.from('commitment_exceptions').delete().eq('commitment_id', id)
    const eff = addDays(t1, 14), effTue = eff
    await admin.from('commitment_exceptions').insert([
      { user_id: S.id, commitment_id: id, occurrence_date: addDays(effTue, 7), kind: 'skipped' },          // a Tuesday: stays a real session of Mon/Tue
      { user_id: S.id, commitment_id: id, occurrence_date: addDays(effTue, 14), kind: 'skipped' }])
    const spec = { action: 'series_from', effectiveFrom: eff, weekdays: [1], startTime: '17:00', endTime: '18:30' }       // Tuesday -> Monday: the later skips no longer match
    const ps = await pv(spec)
    check('series preview shows old versus new sessions, the earlier end date, and names exceptions that no longer match', ps.body?.ok === true && ps.body.preview.changes[0].earlierEndsOn === addDays(eff, -1) && ps.body.preview.inertExceptions.length === 2 && ps.body.preview.changes[0].new.length > 0, JSON.stringify(ps.body).slice(0, 240))
    const noAck = await cf({ ...spec, operationKey: key(), fingerprint: ps.body.fingerprint })
    check('confirming without resolving those exceptions is refused (EXCEPTIONS_UNRESOLVED), nothing written', noAck.status === 409 && noAck.body?.code === 'EXCEPTIONS_UNRESOLVED' && (await ver()) === v0)
    const vBefore = await ver()
    const ok = await cf({ ...spec, acknowledgeExceptions: true, operationKey: key(), fingerprint: ps.body.fingerprint })
    check('with the exceptions acknowledged the change is saved', ok.body?.ok === true && !!ok.body.successorId, JSON.stringify(ok.body).slice(0, 200))
    const oldRow = (await admin.from('calendar_commitments').select('ends_on, starts_on, status, weekdays, start_time').eq('id', id).single()).data!
    const succ = (await admin.from('calendar_commitments').select('starts_on, ends_on, weekdays, start_time, end_time, status, is_protected, kind').eq('id', ok.body.successorId).single()).data!
    check('earlier classes keep their pattern: the old series ends the day before, its days and times untouched', oldRow.ends_on === addDays(eff, -1) && oldRow.status === 'active' && (oldRow.weekdays as number[]).join() === '2' && String(oldRow.start_time).startsWith('18:00'))
    check('the successor carries the new pattern from the effective date, same kind and protection', succ.starts_on === eff && succ.ends_on === '2027-01-01' && (succ.weekdays as number[]).join() === '1' && String(succ.start_time).startsWith('17:00') && succ.kind === 'class' && succ.is_protected === true)
    check('the setup version moved (a stale Settings editor is refused)', (await ver()) === vBefore + 1)
    check('the old series\' later exceptions are kept (inert, not deleted)', (await exc()).length === 2)
    const redo = await cf({ ...spec, acknowledgeExceptions: true, operationKey: key(), fingerprint: ps.body.fingerprint })
    check('a series change cannot be applied twice by reusing the old preview with a new key', redo.status >= 400 && (await admin.from('calendar_commitments').select('id', { count: 'exact', head: true }).eq('user_id', S.id).eq('label', 'Class')).count === 3)
    const hist = await pv({ action: 'series_from', effectiveFrom: addDays(eff, 5), startTime: '16:00', endTime: '17:00' })
    check('the old series cannot be re-edited from after its own end (those sessions belong to the successor)', hist.body?.code === 'AFTER_END')
  } finally {
    for (const id of owned) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  finish()
})().catch(async e => { console.error(e); for (const id of owned) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
