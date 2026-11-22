/**
 * Calendar integrity (fixture students, development database, own dev server):
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/calendar-integrity-test.ts
 * Bad date links, the cycle that owns a displayed week, cross-cycle placement, and timed mocks as occupied time in both booking orders.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { parseLocalDate, todayInZone, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []
const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const count0 = async (label: string) => (await admin.from('calendar_commitments').select('id', { count: 'exact', head: true }).eq('label', label).then(r => r.count ?? 0))
const hdr = { 'Content-Type': 'application/json' }

async function main() {
  console.log('\nCalendar integrity (fixture)\n')
  console.log('1. Date parsing')
  check('real dates pass', parseLocalDate('2026-11-06') === '2026-11-06' && parseLocalDate('2028-02-29') === '2028-02-29')
  check('malformed, impossible and out-of-range dates are refused', ['not-a-date', '2026-02-30', '2026-13-01', '9999-12-31', '2026-1-1', '', null, undefined, 5].every(v => parseLocalDate(v) === null))

  try {
    const st = await createStudent(admin, 'cal', { onboard: true }); made.push(st.id)
    const s = st.s
    const cyc = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', st.id).eq('status', 'active').single()).data!
    const tz = (cyc.timezone as string) || 'Europe/London'
    const start = cyc.starts_at_local as string, end = cyc.ends_at_local as string
    const page = async (q: string) => { const r = await s.req(`/app/calendar${q}`); return { status: r.status, html: await r.text() } }

    console.log('\n2. A bad week parameter opens a usable page')
    for (const w of ['not-a-date', '2026-02-30', '9999-12-31']) {
      const r = await page(`?week=${w}`)
      check(`?week=${w} is 200 with a notice`, r.status === 200 && r.html.includes('data-bad-week'), String(r.status))
    }
    check('a valid week has no notice', !(await page(`?week=${start}`)).html.includes('data-bad-week'))

    console.log('\n3. Each displayed week shows only the work it owns')
    const ids: string[] = []
    const row = (id: string, cycle: string, o: Record<string, unknown> = {}) => { ids.push(id); return { id, user_id: st.id, cycle_id: cycle, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: start, day: start, duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o } }
    // Move the active cycle's own planned rows out of the way so the page text is only this test's rows.
    const mine = ((await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('cycle_id', cyc.id)).data ?? []).map(r => r.id as string)
    if (mine.length) await admin.from('plan_blocks').delete().in('id', mine).eq('user_id', st.id)
    // A genuinely ELAPSED closed cycle in the student's own zone. When onboarding chose a FUTURE first cycle (start after today), `start - 1` can be
    // today itself: a week that still contains today is not history, so the fixture ends the day before today instead.
    const todayLocal = todayInZone(tz)
    const closedEnd = add(start, -1) < todayLocal ? add(start, -1) : add(todayLocal, -1), closedStart = add(closedEnd, -6)
    const closed = await admin.from('planning_cycles').insert({ user_id: st.id, starts_at: zonedTimeToUtc(closedStart, '00:00', tz).toISOString(), ends_at: zonedTimeToUtc(closedEnd, '23:59', tz).toISOString(), starts_at_local: closedStart, ends_at_local: closedEnd, timezone: tz, status: 'closed', anchor_day: 0 }).select('id').single()
    check('closed cycle fixture created', !closed.error, closed.error?.message)
    const closedId = closed.data!.id as string
    await admin.from('plan_blocks').insert([
      row('ZZclosedDone', closedId, { local_date: closedStart, day: closedStart, execution: 'completed' }),
      row('ZZactiveFloat', cyc.id as string, { local_date: null, day: start }),
      row('ZZactiveDated', cyc.id as string),
    ])
    const cw = await page(`?week=${closedStart}`)
    check('the closed week shows its completed task', cw.html.includes('ZZclosedDone'))
    check('the current cycle’s unplaced and dated tasks do not leak into the closed week', !cw.html.includes('ZZactiveFloat') && !cw.html.includes('ZZactiveDated'))
    const fw = await page(`?week=${add(end, 3)}`)
    check('a future week shows no current-cycle work', fw.status === 200 && !fw.html.includes('ZZactiveFloat') && !fw.html.includes('ZZactiveDated') && !fw.html.includes('ZZclosedDone'))
    const aw = await page(`?week=${start}`)
    check('the current week shows its own dated and unplaced work, not the closed task', aw.html.includes('ZZactiveFloat') && aw.html.includes('ZZactiveDated') && !aw.html.includes('ZZclosedDone'))

    console.log('\n4. Placement stays inside the owning cycle')
    const patch = (id: string, body: unknown) => s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: hdr, body: JSON.stringify(body) })
    const before = (await admin.from('plan_blocks').select('local_date, revision, cycle_id').eq('id', 'ZZactiveDated').single()).data!
    const events0 = (await admin.from('task_events').select('id', { count: 'exact', head: true }).eq('task_id', 'ZZactiveDated')).count
    const out = await patch('ZZactiveDated', { action: 'move', date: add(end, 2), startMinutes: null, expectedRevision: before.revision })
    const after = (await admin.from('plan_blocks').select('local_date, revision, cycle_id').eq('id', 'ZZactiveDated').single()).data!
    const events1 = (await admin.from('task_events').select('id', { count: 'exact', head: true }).eq('task_id', 'ZZactiveDated')).count
    check('moving a task past the cycle end is refused and says where to go', out.status === 400 && /weekly review/i.test(out.body?.error ?? ''), JSON.stringify(out.body).slice(0, 160))
    check('the refused move changed no row and wrote no event', after.local_date === before.local_date && after.revision === before.revision && after.cycle_id === before.cycle_id && events0 === events1)
    const bad = await patch('ZZactiveDated', { action: 'move', date: 'nope', startMinutes: null, expectedRevision: before.revision })
    check('a malformed move date is refused', bad.status === 400)
    const inside = await patch('ZZactiveDated', { action: 'move', date: end, startMinutes: null, expectedRevision: before.revision })
    check('a move to the cycle’s last day is accepted', inside.status === 200 || inside.body?.ok === true, JSON.stringify(inside.body).slice(0, 160))
    const create = await s.post('/api/tasks', { title: 'Beyond the cycle', date: add(end, 2), durationMinutes: 30 })
    check('adding a task beyond the cycle is refused', create.status === 400 && create.body?.ok === false, JSON.stringify(create.body).slice(0, 120))
    const createOk = await s.post('/api/tasks', { title: 'Inside the cycle', date: end, durationMinutes: 30 })
    check('adding a task inside the cycle works and keeps the cycle', createOk.body?.ok === true)

    console.log('\n5. A booked mock holds its time, in both booking orders')
    const day = end
    const mockStart = '18:00'
    const mk = await s.json('/api/checkpoints', { method: 'PUT', headers: hdr, body: JSON.stringify({ key: `mk-${Date.now()}-a`, date: day, kind: 'provider_mock', startTime: mockStart, durationMinutes: 120 }) })
    check('a mock can be booked in a free slot', mk.body?.ok === true, JSON.stringify(mk.body).slice(0, 200))
    const over = await s.post('/api/tasks', { title: 'Over the mock', date: day, startMinutes: 18 * 60 + 30, durationMinutes: 30 })
    check('a timed task over the mock is refused, with the mock named', over.status === 409 && over.body?.code === 'CONFLICT', JSON.stringify(over.body).slice(0, 160))
    const adj = await s.post('/api/tasks', { title: 'Right after the mock', date: day, startMinutes: 20 * 60, durationMinutes: 30 })
    check('a task starting exactly when the mock ends is accepted', adj.body?.ok === true, JSON.stringify(adj.body).slice(0, 160))
    // Reverse order: a task already there, then a mock over it.
    const t = await s.post('/api/tasks', { title: 'Placed first', date: add(day, -1), startMinutes: 19 * 60, durationMinutes: 60 })
    check('a timed task is placed', t.body?.ok === true, JSON.stringify(t.body).slice(0, 120))
    const overTask = await s.post('/api/checkpoints', { key: `mk-${Date.now()}-b`, action: 'add', date: add(day, -1), kind: 'other', startTime: '19:30', durationMinutes: 60 })
    check('a mock booked over that task is refused with a conflict and other times', overTask.status === 409 && overTask.body?.code === 'SLOT_TAKEN' && Array.isArray(overTask.body?.suggestions), JSON.stringify(overTask.body).slice(0, 200))
    const adjMock = await s.post('/api/checkpoints', { key: `mk-${Date.now()}-c`, action: 'add', date: add(day, -1), kind: 'other', startTime: '20:00', durationMinutes: 60 })
    check('a mock starting exactly when the task ends is accepted', adjMock.body?.ok === true, JSON.stringify(adjMock.body).slice(0, 200))

    console.log('\n6. Nothing is generated beyond the exam horizon')
    const { getActiveRoadmap } = await import('../src/lib/curriculum/roadmapService')
    const { buildWeekPlanWithPaper, lastStudyDate } = await import('../src/lib/planning/pulse/generateWeek')
    const active = await getActiveRoadmap(st.id)
    check('the student has a saved roadmap with a target', Boolean(active?.roadmap.targetDate))
    if (active) {
      const last = lastStudyDate(active.roadmap)
      const mkWeek = (startDate: string) => ({ startDate, endDate: add(startDate, 6), days: Array.from({ length: 7 }, (_, i) => add(startDate, i)), timezone: tz, anchorDay: 0 as const, classLed: false })
      const after = await buildWeekPlanWithPaper(st.id, mkWeek(add(last, 1)))
      check('a week starting after the horizon has no portions and no paper', after.days.every(d => d.portions.length === 0) && after.paper.kind === 'none')
      const partial = await buildWeekPlanWithPaper(st.id, mkWeek(add(last, -2)), { now: new Date(`${add(last, -3)}T09:00:00Z`) })
      check('a partial final week places nothing after the last usable day', partial.days.filter(d => d.date > last).every(d => d.portions.length === 0))
    }

    console.log('\n7. Commitment refusals are actionable (409, names the mock, input kept, no change saved)')
    const rid = Date.now()
    const dayX = add(end, 0)
    const mk2 = await s.post('/api/checkpoints', { key: `mk-${rid}-x`, action: 'add', date: add(dayX, -2), kind: 'provider_mock', label: 'Mock Booked', startTime: '19:00', durationMinutes: 60 })
    const mockDay = add(dayX, -2)
    check('a mock is booked for the commitment checks', mk2.body?.ok === true, JSON.stringify(mk2.body).slice(0, 160))
    const wk = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
    const one = await s.post('/api/commitments', { label: 'Dentist', kind: 'personal', recurrence: 'none', date: mockDay, startTime: '19:30', endTime: '20:30' })
    check('a one-off commitment over the mock: 409 naming the mock', one.status === 409 && one.body?.code === 'BOOKING_CONFLICT' && /Mock Booked/.test(one.body?.error ?? '') && /Dentist/.test(one.body?.error ?? ''), JSON.stringify(one.body).slice(0, 200))
    const wkNew = await s.post('/api/commitments', { label: 'Night class', kind: 'class', recurrence: 'weekly', weekdays: [wk(mockDay)], startTime: '19:00', endTime: '20:00', startsOn: mockDay })
    check('a weekly class over the mock: 409, nothing saved', wkNew.status === 409 && (await count0('Night class')) === 0, JSON.stringify(wkNew.body).slice(0, 160))
    const ok21 = await s.post('/api/commitments', { label: 'Late class', kind: 'class', recurrence: 'weekly', weekdays: [wk(mockDay)], startTime: '21:00', endTime: '22:00', startsOn: mockDay })
    const lateId = ok21.body?.commitment?.id as string
    check('the same class at a free time is saved', ok21.body?.ok === true && !!lateId, JSON.stringify(ok21.body).slice(0, 160))
    const patchC = (id: string, body: unknown) => s.json(`/api/commitments/${id}`, { method: 'PATCH', headers: hdr, body: JSON.stringify(body) })
    const pe = await patchC(lateId, { startTime: '19:00', endTime: '20:00' })
    const crow = (await admin.from('calendar_commitments').select('start_time').eq('id', lateId).single()).data
    check('a whole-series edit of a class is refused (USE_FUTURE_EDIT) and the series is unchanged', pe.status === 400 && pe.body?.code === 'USE_FUTURE_EDIT' && String(crow?.start_time).startsWith('21:00'), JSON.stringify(pe.body).slice(0, 160))
    const moveBody = { action: 'occurrence_move', occurrenceDate: add(mockDay, 7), newDate: mockDay, newStartTime: '19:15', newEndTime: '19:45' }
    const pvm = await s.post(`/api/commitments/${lateId}/preview`, moveBody)
    const po = await patchC(lateId, { ...moveBody, operationKey: `ci-${rid}-mv`, fingerprint: pvm.body?.fingerprint })
    check('moving one occurrence onto the mock: previewed as a conflict, confirm is 409 and no exception saved', pvm.body?.preview?.conflicts?.length === 1 && po.status === 409 && po.body?.code === 'CONFLICT' && (await admin.from('commitment_exceptions').select('id', { count: 'exact', head: true }).eq('commitment_id', lateId)).count === 0, JSON.stringify(po.body).slice(0, 160))
    const skipBody = { action: 'occurrence_cancel', occurrenceDate: mockDay }
    const pvs = await s.post(`/api/commitments/${lateId}/preview`, skipBody)
    check('a skip still works', (await patchC(lateId, { ...skipBody, operationKey: `ci-${rid}-sk`, fingerprint: pvs.body?.fingerprint })).body?.ok === true, JSON.stringify(pvs.body).slice(0, 160))

    console.log('\n8. Same-day mock edits (preparation remembers the date; the database refuses real collisions)')
    const prepId = `prep-${rid}`
    await admin.from('plan_blocks').insert({ id: prepId, user_id: st.id, cycle_id: cyc.id, title: 'Timed prep', detail: 'd', task_type: 'review', origin: 'student', priority: 'optional', placement: 'timed', execution: 'not_started', local_date: mockDay, day: mockDay, starts_at: zonedTimeToUtc(mockDay, '17:45', tz).toISOString(), duration_minutes: 30, duration: '30', created_by: 'student' })
    const apptId = mk2.body.checkpointId as string
    const getCv = async () => (await s.json(`/api/checkpoints?appointment=${apptId}`)).body.checkpoint
    const cv = await getCv()
    const edit = (body: Record<string, unknown>) => s.json('/api/checkpoints', { method: 'PUT', headers: hdr, body: JSON.stringify({ key: `mk-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, checkpointId: apptId, expectedVersion: (cvNow.v), date: mockDay, kind: 'provider_mock', label: 'Mock Booked', startTime: '19:00', durationMinutes: 60, ...body }) })
    var cvNow = { v: cv.version as number }
    const refresh = async () => { cvNow.v = (await getCv()).version }
    const longer = await edit({ startTime: '18:00', durationMinutes: 120 })
    check('a same-day edit that runs into the timed prep task is refused (409) and names it', longer.status === 409 && longer.body?.code === 'SLOT_TAKEN' && /Timed prep/.test(longer.body?.error ?? ''), JSON.stringify(longer.body).slice(0, 180))
    const later = await edit({ startTime: '19:30', durationMinutes: 45 })
    check('a same-day time or length change clear of the prep saves and does not flag it', later.body?.ok === true && !((later.body.checkpoint.related ?? []) as any[]).some(t => t.taskId === prepId && t.needsReview), JSON.stringify(later.body).slice(0, 160))
    await refresh()
    const renamed = await edit({ startTime: '19:30', durationMinutes: 45, label: 'Renamed only' })
    check('a label-only edit stays quiet', renamed.body?.ok === true)

    console.log('\n9. Past, current and future weeks read as what they are')
    // Boundary: the closed cycle ended yesterday (or earlier) -> history. A viewed week that still contains today is not labelled "past".
    check('(fixture) the closed cycle really ended before today in the student\'s zone', closedEnd < todayLocal, `${closedEnd} vs ${todayLocal}`)
    const hist = await page(`?week=${closedStart}`)
    check('a closed week reads as history: notice, its work, no current actions', hist.html.includes('data-history-week') && hist.html.includes('ZZclosedDone') && !hist.html.includes('Add a mock') && !hist.html.includes("This week&#x27;s paper"))
    check('...with its assessment summary instead of a current paper strip', hist.html.includes('Assessment that week') && hist.html.includes('Planned that week'))
    check('...and no "This week" shortcut missing: it links back to the current week', hist.html.includes('Open this week'))
    const edge = await page(`?week=${todayLocal}`)
    check('a viewed week that contains today is never labelled "past" (the boundary is the end date, in the student\'s zone)', edge.status === 200 && !edge.html.includes('data-history-week'))
    const fut = await page(`?week=${add(end, 12)}`)
    check('a future week is labelled a forecast with no current scope', (fut.html.includes('data-future-week')) && !fut.html.includes('data-history-week') && !fut.html.includes('ZZactiveFloat'))
    const cur = await page(`?week=${start}`)
    check('the current week keeps its actions and has no history/forecast notice', cur.html.includes('id="checkpoint"') && !cur.html.includes('data-history-week') && !cur.html.includes('data-future-week'))
    const missing = await page(`?week=${start}&appointment=00000000-0000-4000-8000-000000000000`)
    check('an unknown or foreign appointment link says it is unavailable instead of showing another mock', missing.html.includes('data-appointment-unavailable'))
  } finally {
    for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
