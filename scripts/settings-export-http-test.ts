/**
 * Scoped HTTP/database proof (ordinary throwaway students, removed by recorded id; no global admission or reminder side effects):
 *  - calendar .ics export: parsed by an independent parser, matches the accepted schedule, follows a confirmed move, excludes unplaced work and weakness titles
 *  - personal-data export: > 1,000 rows page deterministically (no loss/duplication), another student's rows and answer keys never appear
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/settings-export-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import ICAL from 'ical.js'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
import { zonedTimeToUtc, addDays, todayInZone } from '../src/lib/planning/studyWeek'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const J = { 'Content-Type': 'application/json' }
const events = (ics: string): any[] => new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent')
const get = async (s: any, q: string) => { const r = await s.req(`/api/calendar/export${q}`); return { status: r.status, type: r.headers.get('content-type') ?? '', cache: r.headers.get('cache-control') ?? '', disp: r.headers.get('content-disposition') ?? '', text: await r.text() } }

;(async () => {
  await preflightServer()
  try {
    const A = await createStudent(admin, 'sxa', { onboard: true, register: id => owned.push(id) })
    const B = await createStudent(admin, 'sxb', { onboard: true, register: id => owned.push(id) })
    const tz = (await admin.from('profiles').select('timezone').eq('id', A.id).single()).data!.timezone as string
    const cyc = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', A.id).eq('status', 'active').single()).data!
    const first = cyc.ends_at_local > cyc.starts_at_local ? addDays(cyc.starts_at_local as string, 1) : cyc.starts_at_local as string
    const day = first < todayInZone(tz) ? todayInZone(tz) : first // a new manual task cannot be in the past

    console.log('\nCalendar export')
    const anon = await fetch(`${process.env.E2E_BASE_URL}/api/calendar/export`, { redirect: 'manual' })
    check('signed-out callers get nothing', anon.status === 401 || anon.status === 403 || anon.status === 307 || anon.status === 302, String(anon.status))
    check('an invalid range is a clear 400, never a calendar file', (await get(A.s, '?from=nope')).status === 400 && (await get(A.s, '?from=2026-01-01&to=2026-12-31')).status === 400)
    const mk = async (title: string, startMinutes: number | null) => (await A.s.post('/api/tasks', { title, date: day, durationMinutes: 45, startMinutes })).body
    const timed = await mk('Étude; ñ, “quotes”\nline two', 19 * 60 + 30), dayOnly = await mk('Day-preferred reminder', null), toDefer = await mk('Deferred, so unplaced', null)
    check('fixture tasks were created', timed.ok && dayOnly.ok && toDefer.ok, JSON.stringify([timed, dayOnly, toDefer]).slice(0, 200))
    const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data!.revision)
    await A.s.json(`/api/tasks/${toDefer.task.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'deferred', expectedRevision: await rev(toDefer.task.id) }) })
    const q = `?from=${cyc.starts_at_local}&to=${cyc.ends_at_local}`
    const pre = (await A.s.json(`/api/calendar/export${q}&preview=1`)).body.preview
    const r1 = await get(A.s, q)
    check('text/calendar, safe attachment name, private no-store', r1.status === 200 && /^text\/calendar/.test(r1.type) && /attachment; filename="roadmap-schedule-[\d-]+-to-[\d-]+\.ics"/.test(r1.disp) && /no-store/.test(r1.cache))
    const ev1 = events(r1.text)
    check('the preview count equals the parsed events (no more, no fewer)', pre.events === ev1.length && pre.timed + pre.allDay === pre.events, JSON.stringify(pre))
    const find = (evs: any[], s: string) => evs.find(e => String(e.getFirstPropertyValue('summary')).startsWith(s))
    const t1 = find(ev1, 'Étude')
    check('Unicode/punctuation/newline title round-trips and the instant is the correct UTC for the student\'s zone', !!t1 && t1.getFirstPropertyValue('summary') === 'Étude; ñ, “quotes”\nline two' && t1.getFirstPropertyValue('dtstart').toJSDate().toISOString() === zonedTimeToUtc(day, '19:30', tz).toISOString() && (t1.getFirstPropertyValue('dtend').toJSDate().getTime() - t1.getFirstPropertyValue('dtstart').toJSDate().getTime()) === 45 * 60_000)
    check('a day-preferred task is an all-day, non-blocking reminder with no invented time', find(ev1, 'Day-preferred')?.getFirstProperty('dtstart').type === 'date' && find(ev1, 'Day-preferred')?.getFirstPropertyValue('transp') === 'TRANSPARENT')
    check('a deferred (unplaced) task is excluded and counted with a reason', !find(ev1, 'Deferred') && pre.excludedUnplaced >= 1)
    check('events carry a link to the normal authenticated object and no session or token', /\/app\/calendar\?/.test(t1.getFirstPropertyValue('url')) && !/token|access_token|sb-/.test(r1.text))
    check('no event title or description leaks a weakness label, key, score or note', !/needs_repair|Repair:|score|confidence/i.test(r1.text))
    check('UIDs are unique and never contain the account id or email', new Set(ev1.map(e => e.getFirstPropertyValue('uid'))).size === ev1.length && !r1.text.includes(A.id))
    const withClasses = events((await get(A.s, `${q}&classes=1`)).text)
    check('fixed commitments appear only when chosen, as dated occurrences', withClasses.length > ev1.length && withClasses.some(e => /Work/.test(String(e.getFirstPropertyValue('summary')))) && !ev1.some(e => /^Work/.test(String(e.getFirstPropertyValue('summary')))))
    // a confirmed move is followed; the old file stays a snapshot
    const uid1 = t1.getFirstPropertyValue('uid')
    const mv = await A.s.json(`/api/tasks/${timed.task.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'move', date: day, startMinutes: 20 * 60, expectedRevision: await rev(timed.task.id) }) })
    const t2 = find(events((await get(A.s, q)).text), 'Étude')
    check('after a confirmed move a re-export has the new time and the SAME uid; the earlier file is unchanged', mv.body?.ok === true && t2.getFirstPropertyValue('dtstart').toJSDate().toISOString() === zonedTimeToUtc(day, '20:00', tz).toISOString() && t2.getFirstPropertyValue('uid') === uid1 && t1.getFirstPropertyValue('dtstart').toJSDate().toISOString() === zonedTimeToUtc(day, '19:30', tz).toISOString())
    const empty = await get(A.s, '?from=2031-01-01&to=2031-01-07')
    check('an empty range is a valid empty calendar', empty.status === 200 && events(empty.text).length === 0 && empty.text.startsWith('BEGIN:VCALENDAR'))
    const other = events((await get(B.s, q)).text)
    check('another student\'s export never contains this student\'s tasks', !find(other, 'Étude') && !find(other, 'Day-preferred'))

    console.log('\nCalendar export: source-to-file correctness')
    const win2 = async (from: string, to: string, extra = '') => events((await get(A.s, `?from=${from}&to=${to}${extra}`)).text)
    const sumOf = (e: any) => String(e.getFirstPropertyValue('summary'))
    // a booked mock appointment with NO task still exports, even with classes switched off, and a mock task on the same date is not a second event
    const apptDay = addDays(day, 2)
    const apIns = await admin.from('mock_appointments').insert({ user_id: A.id, kind: 'provider_mock', planned_date: apptDay, start_time: '06:00', duration_minutes: 120, label: 'Booked mock', status: 'planned' }).select('id').single(); if (apIns.error) throw new Error('appointment fixture: ' + apIns.error.message); const ap = apIns.data!
    const e3 = await win2(day, addDays(day, 3))
    const m = e3.filter(e => sumOf(e).includes('Booked mock'))
    check('a booked appointment with no task is exported once, timed from its stored start and duration', m.length === 1 && m[0].getFirstPropertyValue('dtstart').toJSDate().toISOString() === zonedTimeToUtc(apptDay, '06:00', tz).toISOString() && (m[0].getFirstPropertyValue('dtend').toJSDate().getTime() - m[0].getFirstPropertyValue('dtstart').toJSDate().getTime()) === 120 * 60_000)
    // No stored relationship links a mock TASK to an appointment, so sharing a date merges nothing: two appointments on one date and an unrelated mock task on that date are three events.
    const ap2 = await admin.from('mock_appointments').insert({ user_id: A.id, kind: 'provider_mock', planned_date: apptDay, start_time: '03:00', duration_minutes: 90, label: 'Second booked mock', status: 'planned' }).select('id').single(); if (ap2.error) throw new Error('appointment 2 fixture: ' + ap2.error.message)
    // the route no longer creates mocks by hand (system type), so the unrelated mock task is a seeded fixture row
    const cycId = (await admin.from('planning_cycles').select('id').eq('user_id', A.id).eq('status', 'active').single()).data!.id
    const mockIns = await admin.from('plan_blocks').insert({ id: `task-${crypto.randomUUID()}`, user_id: A.id, cycle_id: cycId, title: 'Unrelated mock practice', detail: 'fixture', task_type: 'mock', origin: 'planner', priority: 'core', placement: 'timed', execution: 'not_started', local_date: apptDay, day: apptDay, starts_at: zonedTimeToUtc(apptDay, '19:00', tz).toISOString(), duration_minutes: 45, duration: '45', rationale: 'fixture', is_protected_commitment: false, created_by: 'algorithm' }); if (mockIns.error) throw new Error('mock task fixture: ' + mockIns.error.message)
    const mockTask = { body: { ok: true } }
    const e3b = await win2(day, addDays(day, 3))
    check('two appointments on one date and an unrelated mock task on that date export as three separate events, each with its own UID', e3b.filter(e => /mock/i.test(sumOf(e))).length === 3 && new Set(e3b.filter(e => /mock/i.test(sumOf(e))).map(e => e.getFirstPropertyValue('uid'))).size === 3, JSON.stringify(e3b.map(sumOf)))
    const pv3 = (await A.s.json(`/api/calendar/export?from=${day}&to=${addDays(day, 3)}&preview=1`)).body.preview
    check('the preview count agrees with the parsed events', pv3?.events === e3b.length, JSON.stringify(pv3))
    await admin.from('mock_appointments').delete().eq('id', ap2.data!.id)
    // moved recurring occurrences keep their original identity; two moved onto one date stay two events
    const serIns = await admin.from('calendar_commitments').insert({ user_id: A.id, label: 'Evening class', kind: 'class', recurrence: 'weekly', weekdays: [2, 4], start_time: '18:00', end_time: '20:00', starts_on: '2026-09-01', status: 'active', is_protected: true, starts_at: '2026-09-01T18:00:00Z', ends_at: '2026-09-01T20:00:00Z' }).select('id').single(); if (serIns.error) throw new Error('series fixture: ' + serIns.error.message); const series = serIns.data!
    const tuesday = (() => { let d = addDays(day, 0); while (new Date(`${d}T12:00:00Z`).getUTCDay() !== 2) d = addDays(d, 1); return d })()
    const thursday = addDays(tuesday, 2), sat = addDays(tuesday, 4)
    const beforeMove = (await win2(tuesday, addDays(tuesday, 6), '&classes=1')).filter(e => sumOf(e).startsWith('Evening class'))
    const uidTue = beforeMove.find(e => e.getFirstPropertyValue('dtstart').toJSDate().toISOString() === zonedTimeToUtc(tuesday, '18:00', tz).toISOString())!.getFirstPropertyValue('uid')
    await admin.from('commitment_exceptions').insert([{ user_id: A.id, commitment_id: series.id, occurrence_date: tuesday, kind: 'moved', new_date: sat, new_start_time: '10:00', new_end_time: '12:00' }, { user_id: A.id, commitment_id: series.id, occurrence_date: thursday, kind: 'moved', new_date: sat, new_start_time: '10:00', new_end_time: '12:00' }])
    const afterMove = (await win2(tuesday, addDays(tuesday, 6), '&classes=1')).filter(e => sumOf(e).startsWith('Evening class'))
    const satEvents = afterMove.filter(e => sumOf(e).includes('(moved)'))
    check('two occurrences moved onto the same date stay two distinct events', satEvents.length === 2 && new Set(satEvents.map(e => e.getFirstPropertyValue('uid'))).size === 2)
    check('a moved occurrence keeps the UID of its ORIGINAL slot (the Tuesday event is the same event after it moves)', satEvents.some(e => e.getFirstPropertyValue('uid') === uidTue))
    // exact instants: an overnight one-off and the repeated DST hour (London, 25 Oct 2026: 01:30 happens at 00:30Z and again at 01:30Z)
    await admin.from('calendar_commitments').insert([
      { user_id: A.id, label: 'Night shift', kind: 'work', recurrence: 'none', starts_at: '2026-10-20T21:00:00Z', ends_at: '2026-10-21T05:00:00Z', status: 'active', is_protected: true },
      { user_id: A.id, label: 'DST first 01:30', kind: 'personal', recurrence: 'none', starts_at: '2026-10-25T00:30:00Z', ends_at: '2026-10-25T00:50:00Z', status: 'active', is_protected: true },
      { user_id: A.id, label: 'DST second 01:30', kind: 'personal', recurrence: 'none', starts_at: '2026-10-25T01:30:00Z', ends_at: '2026-10-25T01:50:00Z', status: 'active', is_protected: true }])
    const inst = await win2('2026-10-20', '2026-10-26', '&classes=1')
    const at = (n: string) => inst.find(e => sumOf(e) === n)
    const iso = (e: any, k: string) => e.getFirstPropertyValue(k).toJSDate().toISOString()
    check('an overnight one-off keeps its REAL end (08 hours, not clipped to midnight)', !!at('Night shift') && iso(at('Night shift'), 'dtstart') === '2026-10-20T21:00:00.000Z' && iso(at('Night shift'), 'dtend') === '2026-10-21T05:00:00.000Z')
    check('both occurrences of the repeated DST hour export as their two distinct absolute instants', !!at('DST first 01:30') && !!at('DST second 01:30') && iso(at('DST first 01:30'), 'dtstart') === '2026-10-25T00:30:00.000Z' && iso(at('DST second 01:30'), 'dtstart') === '2026-10-25T01:30:00.000Z')
    check('removing the appointment removes it from the next export (snapshots follow accepted state)', await (async () => { await admin.from('mock_appointments').delete().eq('id', ap.id); return !(await win2(day, addDays(day, 3))).some(e => sumOf(e).includes('Booked mock')) })())

    console.log('\nPersonal-data export')
    const task = (await admin.from('plan_blocks').select('id').eq('user_id', A.id).limit(1).single()).data!.id as string
    const taskB = (await admin.from('plan_blocks').select('id').eq('user_id', B.id).limit(1).single()).data!.id as string
    const rows = (uid: string, tid: string, m: string) => Array.from({ length: 1200 }, (_, i) => ({ user_id: uid, task_id: tid, event_type: 'details_changed', payload: { marker: m, i }, previous: {}, notes: m }))
    for (const [u, t, m] of [[A.id, task, 'MARK-A-7f3'], [B.id, taskB, 'MARK-B-9c1']] as const) { const ins = await admin.from('task_events').insert(rows(u, t, m)); if (ins.error) throw new Error(ins.error.message) }
    const bTask = (await B.s.post('/api/tasks', { title: 'MARK-B-receipt', date: day, durationMinutes: 30, startMinutes: null })).body
    check('the other student also has a creation receipt', bTask.ok === true, JSON.stringify(bTask).slice(0, 160))
    const ex = await A.s.req('/api/account/export'); const exText = await ex.text(); const j = JSON.parse(exText)
    const ids = (j.tables.task_events as any[]).map(r => r.id)
    const markerRows = (j.tables.task_events as any[]).filter(r => r.notes === 'MARK-A-7f3')
    check('the download is versioned, timed and states its consistency honestly', j.schema === 'roadmap-export-2' && !!j.startedAt && !!j.finishedAt && /not a single point-in-time/.test(j.consistency))
    check('1,200 rows page without loss or duplication (more than two pages)', markerRows.length === 1200 && new Set(ids).size === ids.length && new Set(markerRows.map(r => r.payload.i)).size === 1200)
    check('counts match the tables and cover the previously missing tables', Object.entries(j.counts).every(([k, n]) => (j.tables[k] as unknown[]).length === n) && ['practice_runs', 'practice_run_receipts', 'practice_run_sets', 'coach_model_calls', 'attempt_score_adjustments', 'redistribution_receipts', 'class_session_items', 'source_mappings'].every(k => k in j.tables))
    const rc = (j.tables.task_create_receipts as any[]) ?? [], aRc = (await admin.from('task_create_receipts').select('key, request, result').eq('user_id', A.id)).data ?? []
    check('the export carries this student\'s creation receipts with their original request and result, and none of the other student\'s', aRc.length >= 3 && rc.length === aRc.length && rc.every(r => aRc.some(x => x.key === r.key && JSON.stringify(x.request) === JSON.stringify(r.request) && JSON.stringify(x.result) === JSON.stringify(r.result))) && !JSON.stringify(rc).includes('MARK-B-receipt') && !!rc.find(r => r.request?.title?.startsWith('Day-preferred')), String(rc.length))
    check('another student\'s marker, answer keys and auth tokens are absent', !exText.includes('MARK-B-9c1') && !/key_index|access_token|refresh_token/.test(exText))
    check('the response is private, no-store, an attachment', /no-store/.test(ex.headers.get('cache-control') ?? '') && /attachment/.test(ex.headers.get('content-disposition') ?? ''))
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
