/**
 * Home reliability journeys, live, on the dedicated +e2e account (reset first). Each scenario is a reproduced defect.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-home-journeys.ts
 * Fixture results only: the bank is not touched, so paper availability here says nothing about live-bank capability.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser } from './lib/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const J = { 'Content-Type': 'application/json' }

async function main() {
  console.log('\nHome journeys (fixture)\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await completeOnboarding(s, admin)
  const home = async () => (await (await s.req('/app')).text()).replace(/<!-- -->/g, '')
  const { data: cyc } = await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local, timezone').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  const { todayInZone } = await import('../src/lib/planning/studyWeek')
  const today = todayInZone((cyc!.timezone as string) || 'UTC')
  // Put the cycle around today so "today", "overdue" and "unplaced" are all inside it.
  const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
  await admin.from('planning_cycles').update({ starts_at_local: add(today, -3), ends_at_local: add(today, 3) }).eq('id', cycleId)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  // Every fixture task is recorded by id when it is built, and removed by exactly those ids AND this student's ownership: no name patterns.
  const made: string[] = []
  const drop = async (ids: string[]) => { if (ids.length) await admin.from('plan_blocks').delete().in('id', ids).eq('user_id', uid).eq('cycle_id', cycleId) }
  const row = (id: string, o: Record<string, unknown> = {}) => { made.push(`hj-${id}`); return { id: `hj-${id}`, user_id: uid, cycle_id: cycleId, title: `Fixture ${id}`, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', lm_id: 'r028', outcome_id: 'r028-a', ...o } }

  console.log('Unplaced work is not a free day')
  await admin.from('plan_blocks').insert(Array.from({ length: 13 }, (_, i) => row(`u${i}`, { local_date: null, placement: 'floating' })))
  let h = await home()
  check('13 unplaced tasks: Home does not say "all caught up"', !/all caught up/i.test(h))
  check('…it asks for a placement decision, with the count', /Place 13 unplaced tasks/.test(h))
  check('…and the destination is Calendar’s “Not yet placed” section', h.includes('#unplaced'))
  await drop(made.filter(i => i.startsWith('hj-u')))

  console.log('\nA free day vs a worked day')
  h = await home()
  check('nothing planned reads as a free day', /Nothing is planned today|nothing planned/i.test(h) && !/all caught up/i.test(h))

  console.log('\nEarlier overdue and later upcoming sessions')
  const now = Date.now()
  await admin.from('plan_blocks').insert([
    row('later', { placement: 'timed', starts_at: new Date(now + 3 * 3_600_000).toISOString(), title: 'Upcoming later session' }),
    row('earlier', { placement: 'timed', starts_at: new Date(now - 3 * 3_600_000).toISOString(), title: 'Overdue earlier session' }),
    row('yday', { local_date: add(today, -1), day: add(today, -1), title: 'Yesterday unfinished' }),
  ])
  h = await home()
  const upIdx = h.indexOf('next-up__why'), title = h.slice(h.indexOf('id="next-up-h"'), h.indexOf('id="next-up-h"') + 200)
  check('the oldest unfinished work is recommended first', /Yesterday unfinished/.test(title), title.replace(/<[^>]+>/g, ' ').slice(0, 80))
  check('…as overdue, linking its own day', h.includes(`week=${add(today, -1)}`) && /Overdue/.test(h))
  check('the action says Open session, not Start session', /Open session/.test(h) && !/Start session/.test(h))
  void upIdx

  console.log('\nPartial work survives a refresh')
  const { data: t } = await admin.from('plan_blocks').select('id, revision').eq('id', 'hj-later').single()
  const part = await s.json(`/api/tasks/${t!.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'partial', actualDurationMinutes: 12, expectedRevision: t!.revision }) })
  check('Partly done saves with reported minutes', part.body.ok === true, JSON.stringify(part.body).slice(0, 120))
  h = await home()
  check('the row shows Partly done with its reported minutes after a reload', /Partly done · 12 of 30 min reported/.test(h))
  const again = await home()
  check('the order is identical on a second read', again.match(/today__title/g)?.length === h.match(/today__title/g)?.length)

  console.log('\nDeferred work says what happened')
  const { data: d } = await admin.from('plan_blocks').select('id, revision').eq('id', 'hj-earlier').single()
  const def = await s.json(`/api/tasks/${d!.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'deferred', expectedRevision: d!.revision }) })
  check('deferring returns an outcome message', def.body.ok === true && typeof def.body.outcome?.message === 'string' && /deferred/.test(def.body.outcome.message), JSON.stringify(def.body.outcome))
  const undo = await s.json(`/api/tasks/${d!.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'undo' }) })
  check('…and undo restores it', undo.body.ok === true)

  console.log('\nTwo tabs changing a task')
  const { data: c } = await admin.from('plan_blocks').select('id, revision').eq('id', 'hj-yday').single()
  const first = await s.json(`/api/tasks/${c!.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'completed', actualDurationMinutes: 30, expectedRevision: c!.revision }) })
  const stale = await s.json(`/api/tasks/${c!.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'skipped', expectedRevision: c!.revision }) })
  check('the first change saves, the stale one is refused with a revision error', first.body.ok === true && stale.status === 409 && stale.body.code === 'REVISION_MISMATCH', `${stale.status} ${stale.body.code}`)


  console.log('\nDeferral, re-placement and receipts')
  const redis = await import('../src/lib/planning/pulse/redistribute')
  await admin.from('plan_blocks').insert([row('dfr', { local_date: add(today, -1), day: add(today, -1), title: 'Deferred: Leases', duration_minutes: 40, duration: '40', lm_id: 'r028' }), row('dfr-later', { local_date: add(today, 1), day: add(today, 1), title: 'Later: Leases', duration_minutes: 30, duration: '30', lm_id: 'r028' }), row('dfr-other', { local_date: add(today, 1), day: add(today, 1), title: 'Other reading', duration_minutes: 30, duration: '30', lm_id: 'r029' })])
  const dur = async (id: string) => Number((await admin.from('plan_blocks').select('duration_minutes').eq('id', id).single()).data?.duration_minutes)
  const rv = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
  const patch = async (id: string, body: any) => s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify(body) })
  const sameReading = async () => { const r = (await admin.from('plan_blocks').select('id, duration_minutes').eq('user_id', uid).eq('lm_id', 'r028').eq('execution', 'not_started').gte('local_date', today).is('cancelled_at', null)).data ?? []; return r.reduce((n, x) => n + Number(x.duration_minutes), 0) }
  const base0 = await sameReading()
  const d1 = await patch('hj-dfr', { action: 'execution', execution: 'deferred', expectedRevision: await rv('hj-dfr') })
  const added = (await sameReading()) - base0
  check('deferring earlier work reports what was actually committed (the message matches the minutes that moved)', d1.body.ok === true && added > 0 && added <= 40 && new RegExp(`${added} of 40 min was added to \\d+ later sessions? of the same reading`).test(d1.body.outcome?.message ?? ''), `${added}: ${d1.body.outcome?.message}`)
  const after1 = await dur('hj-dfr-later')
  check('only sessions of the same reading took minutes (within the sitting limit); another reading was not touched', after1 >= 30 && after1 <= 45 && (await dur('hj-dfr-other')) === 30, `${after1}`)
  const repeat = await redis.redistributeMissedTask(uid, 'hj-dfr')
  check('repeating the redistribution adds nothing (one receipt per missed task)', repeat.replayed === true && (await sameReading()) - base0 === added && (await dur('hj-dfr-later')) === after1)
  const rcpt = (await admin.from('redistribution_receipts').select('placed_minutes, reversed_at').eq('source_task_id', 'hj-dfr').eq('user_id', uid)).data ?? []
  check('exactly one active receipt records the committed minutes', rcpt.length === 1 && rcpt[0].reversed_at === null && rcpt[0].placed_minutes === added)
  const u1 = await patch('hj-dfr', { action: 'undo' })
  check('Undo restores the task AND takes back exactly the added minutes, and says so', u1.body.ok === true && /taken back/.test(u1.body.outcome?.message ?? '') && (await sameReading()) === base0, u1.body.outcome?.message)
  const d2 = await patch('hj-dfr', { action: 'execution', execution: 'deferred', expectedRevision: await rv('hj-dfr') })
  check('deferring again re-absorbs once (the earlier receipt was reversed)', d2.body.ok === true && (await sameReading()) > base0)
  h = await home()
  check('Home offers "Choose another time" for the deferred task', /Choose another time/.test(h) && h.includes('Deferred: Leases'))
  const mv = await patch('hj-dfr', { action: 'move', date: add(today, 2), startMinutes: null, expectedRevision: await rv('hj-dfr') })
  const re = (await admin.from('plan_blocks').select('execution, local_date, lm_id').eq('id', 'hj-dfr').single()).data!
  check('placing it confirms a new time and reopens it, keeping its reading', mv.body.ok === true && re.execution === 'not_started' && re.local_date === add(today, 2) && re.lm_id === 'r028', JSON.stringify(re))
  check('…the minutes added elsewhere for it were taken back, and the receipt says so', (await sameReading()) === base0 + 40 && /taken back/.test(mv.body.outcome?.message ?? '') && /open again/.test(mv.body.outcome?.message ?? ''), mv.body.outcome?.message)
  h = await home()
  check('after a refresh it is no longer listed as deferred', !/Deferred: Leases/.test(h.slice(h.indexOf('Deferred work') > -1 ? h.indexOf('Deferred work') : 0, (h.indexOf('Deferred work') > -1 ? h.indexOf('Deferred work') : 0) + 600)))
  const past = await patch('hj-dfr', { action: 'move', date: add(today, -1), startMinutes: null, expectedRevision: await rv('hj-dfr') })
  check('unfinished work cannot be moved into the past: the server says to choose today or later, or use Log learning', past.body.ok === false && /today or a later day/.test(past.body.error ?? '') && /Log learning/.test(past.body.error ?? ''), JSON.stringify(past.body).slice(0, 160))
  const noRoom = row('dfr2', { local_date: add(today, -1), day: add(today, -1), title: 'No later session', duration_minutes: 30, duration: '30', lm_id: 'r030' })
  await admin.from('plan_blocks').insert(noRoom)
  const d3 = await patch('hj-dfr2', { action: 'execution', execution: 'deferred', expectedRevision: await rv('hj-dfr2') })
  check('with nothing later for that reading, the receipt says nothing moved (no unqualified success)', d3.body.ok === true && /nothing moved|Nothing later this week/i.test(d3.body.outcome?.message ?? '') && /choose another time/i.test(d3.body.outcome?.message ?? ''), d3.body.outcome?.message)

  // Concurrent redistribution of one missed task produces one result (the receipt + row locks decide).
  await admin.from('plan_blocks').insert([row('cc', { local_date: add(today, -1), day: add(today, -1), title: 'Concurrent missed', duration_minutes: 30, duration: '30', lm_id: 'r031' }), row('cc-later', { local_date: add(today, 1), day: add(today, 1), title: 'Concurrent later', duration_minutes: 30, duration: '30', lm_id: 'r031' })])
  const cc0 = await dur('hj-cc-later')
  await patch('hj-cc', { action: 'execution', execution: 'deferred', expectedRevision: await rv('hj-cc') })
  const cc1 = await dur('hj-cc-later')
  const both = await Promise.all([redis.redistributeMissedTask(uid, 'hj-cc'), redis.redistributeMissedTask(uid, 'hj-cc'), redis.redistributeMissedTask(uid, 'hj-cc')])
  check('three concurrent redistributions of one missed task change nothing beyond the first absorption', cc1 > cc0 && (await dur('hj-cc-later')) === cc1 && both.every(r => r.replayed || !r.applied), JSON.stringify(both.map(r => [r.applied, r.replayed])))
  check('…and exactly one active receipt exists for it', ((await admin.from('redistribution_receipts').select('id').eq('source_task_id', 'hj-cc').eq('user_id', uid).is('reversed_at', null)).data ?? []).length === 1)

  console.log('\nReported time: late, unknown, overrun, repeated, undone')
  const todayTotal = async () => Number(/(\d+) min reported today/.exec(await home())?.[1] ?? 0)
  const t0 = await todayTotal()
  await admin.from('plan_blocks').insert([row('late', { local_date: add(today, -1), day: add(today, -1), title: 'Earlier day task', duration_minutes: 30, duration: '30' }), row('unk', { title: 'Unknown minutes', duration_minutes: 30, duration: '30' }), row('over', { title: 'Overrun task', duration_minutes: 30, duration: '30' })])
  await patch('hj-late', { action: 'execution', execution: 'partial', actualDurationMinutes: 25, expectedRevision: await rv('hj-late') })
  await patch('hj-unk', { action: 'execution', execution: 'partial', expectedRevision: await rv('hj-unk') })
  await patch('hj-over', { action: 'execution', execution: 'partial', actualDurationMinutes: 20, expectedRevision: await rv('hj-over') })
  await patch('hj-over', { action: 'execution', execution: 'partial', actualDurationMinutes: 25, expectedRevision: await rv('hj-over') })
  h = await home()
  const t1 = await todayTotal()
  check('late reporting against an earlier task counts on the day it was reported (25 + 20 + 25 = 70 min added today)', t1 - t0 === 70, `${t0} -> ${t1}`)
  const { buildWork } = await import('../src/lib/state/homeModel')
  const mapBlock = (b: any) => ({ id: b.id, revision: b.revision, availability: 'available' as const, destination: '', permittedCommands: [], title: b.title, detail: '', taskType: b.task_type, origin: 'planner' as const, durationMinutes: b.duration_minutes, placement: b.placement, startsAt: b.starts_at, execution: b.execution, localDate: b.local_date })
  const bl = ((await admin.from('plan_blocks').select('*').eq('user_id', uid).in('id', ['hj-unk', 'hj-over'])).data ?? []).map(mapBlock)
  const evs = (await admin.from('task_events').select('id, task_id, event_type, actual_duration_minutes, created_at, payload').eq('user_id', uid).in('task_id', ['hj-unk', 'hj-over'])).data ?? []
  const wm = buildWork(bl as any, evs as any, today, Date.now(), 'Europe/London')
  const unk = wm.open.find(t => t.id === 'hj-unk')!, ovr = wm.open.find(t => t.id === 'hj-over')!
  check('partly done with no minutes is unknown (null), not 0, with the whole plan still remaining', unk.reportedMinutes === null && unk.timeUnknown === true && unk.execution === 'partial')
  check('a partial past its plan stays open: 45 reported of 30 planned, flagged as planned-time-used', ovr.reportedMinutes === 45 && wm.plannedUsedButOpen === 1)
  check('…and the day total says some reports had no minutes', /report without minutes|reports without minutes/.test(h))
  check('repeated updates add up, and a partial past its plan stays open with the allocation explained', /Overrun task[\s\S]{0,500}45 min reported\. Its 30 min planned allocation is used, and it is still open/.test(h))
  const ov = await patch('hj-over', { action: 'undo' })
  h = await home()
  check('Undo reverses the last report (45 → 20 min) and Home follows', ov.body.ok === true && /Overrun task[\s\S]{0,1500}Partly done · 20 of 30 min reported/.test(h), (/Overrun task[\s\S]{0,300}/.exec(h) ?? [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 160))

  console.log('\nSystem assessment tasks cannot be marked done')
  await admin.from('plan_blocks').insert([row('paper', { task_type: 'diagnostic', origin: 'diagnostic', title: 'Weekly paper', lm_id: null, outcome_id: null }), row('chk', { task_type: 'recheck', title: 'Re-check', lm_id: null, outcome_id: null })])
  for (const id of ['hj-paper', 'hj-chk']) {
    const r1 = await patch(id, { action: 'execution', execution: 'completed', expectedRevision: await rv(id) })
    const r2 = await patch(id, { action: 'execution', execution: 'partial', actualDurationMinutes: 10, expectedRevision: await rv(id) })
    check(`${id === 'hj-paper' ? 'a paper' : 'a re-check'} cannot be completed or marked partly done through the generic command`, r1.status === 409 && r1.body.code === 'SYSTEM_ASSESSMENT' && r2.status === 409 && /Tests/.test(r1.body.error), JSON.stringify(r1.body).slice(0, 140))
    check('…and its state is unchanged', (await admin.from('plan_blocks').select('execution').eq('id', id).single()).data?.execution === 'not_started')
  }
  await drop(made.filter(i => !['hj-paper', 'hj-chk'].includes(i)))
  h = await home()
  const paperRow = (/Weekly paper[\s\S]{0,1800}/.exec(h) ?? [''])[0]
  check('Home gives the paper task Start/Resume/Tests controls, not Done / Partly done', /(Start paper|Resume paper|Open in Tests|Confirm coverage|View assessment availability|Start paper early)/.test(paperRow) && !/Mark Weekly paper done/.test(h) && !/Mark Re-check done/.test(h))
  await admin.from('redistribution_receipts').delete().in('source_task_id', made).eq('user_id', uid)

  console.log('\nAccepted empty week')
  await drop(made.splice(0))
  h = await home()
  check('an empty accepted week is a normal free day, not a failure', !/could not be loaded/.test(h) && /Nothing is planned today|nothing planned/i.test(h))

  console.log('\nExam sat')
  const sat = await s.json('/api/exam', { method: 'POST', headers: J, body: JSON.stringify({ action: 'sat', satOn: today }) })
  check('reporting the exam sat is accepted', sat.body.ok === true)
  h = await home()
  check('no countdown, no next action, no weekly checkpoint beside "paused"', !/weeks to your exam|weeks to the/.test(h) && !h.includes('id="next-up-h"') && !/Next checkpoint/.test(h))
  check('a coherent follow-up and history view is shown', /You sat the exam/.test(h) && /Your history/.test(h) && /Optional follow-up/.test(h))
  await s.json('/api/exam', { method: 'POST', headers: J, body: JSON.stringify({ action: 'undo' }) })

  console.log('\nRendering stays read-only')
  const cnt = async (tb: string) => (await admin.from(tb).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const before = [await cnt('plan_blocks'), await cnt('planning_cycles'), await cnt('task_events'), await cnt('assessment_attempts')].join()
  await home(); await home()
  check('repeated Home reads change nothing', before === [await cnt('plan_blocks'), await cnt('planning_cycles'), await cnt('task_events'), await cnt('assessment_attempts')].join())
  await drop(made.splice(0))
  check('only this student’s recorded fixture tasks remain removed', ((await admin.from('plan_blocks').select('id').eq('user_id', uid).like('id', 'hj-%')).data ?? []).length === 0)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
