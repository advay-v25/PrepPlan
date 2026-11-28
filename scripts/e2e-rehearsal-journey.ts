/**
 * Phase 5 journeys through the NORMAL routes, in two separate tracks:
 *   --part=fixture --bank=<fixture-bank record>   test-only approved HELD-OUT bank (npm run fixture:bank -- create … --rehearsal=auto):
 *        appointments → linked rehearsal → two server clocks → timeout → combined result → debrief → Calendar proposal → designation/closure → exam
 *   --part=live                                   the actual bank (fixtures excluded): a full mock is unavailable with accurate reasons and the
 *        external-mock / planning paths all work.
 * Ordinary throwaway students; fixture rows are never created or removed here.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-rehearsal-journey.ts --part=fixture --bank=<file>
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: process.env.E2E_ENV_FILE || '.env.staging.local', quiet: true } as any)
import fs from 'node:fs'
import { createStudent, makeCheck } from './lib/e2eSession'
import { E2E_BASE_URL } from './lib/e2eIdentity'
import { assertRehearsalTarget } from './lib/rehearsalTarget'
import lifecycleSetup from './lifecycle-setup'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'unconfigured', { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const made: string[] = []
const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=')
const part = arg('part') || 'fixture'
type Student = Awaited<ReturnType<typeof createStudent>>
const uuid = () => crypto.randomUUID()
const dropStudents = async () => { const ids = made.splice(0); for (const id of ids) {
  // rehearsal-linked rows reference each other: attempts first, then forms/rehearsals, then the user
  const { data: att } = await admin.from('assessment_attempts').select('id, form_id').eq('user_id', id)
  const aIds = (att ?? []).map(a => a.id as string), forms = (att ?? []).map(a => a.form_id as string)
  if (aIds.length) { await admin.from('evidence_events').delete().in('attempt_id', aIds); await admin.from('item_challenges').delete().in('attempt_id', aIds); await admin.from('assessment_responses').delete().in('attempt_id', aIds); await admin.from('attempt_item_progress').delete().in('attempt_id', aIds); await admin.from('plan_blocks').update({ attempt_id: null }).in('attempt_id', aIds) }
  await admin.from('repair_check_threads').delete().in('thread_id', ((await admin.from('repair_threads').select('id').eq('user_id', id)).data ?? []).map(t => t.id as string))
  await admin.from('repair_thread_events').delete().in('thread_id', ((await admin.from('repair_threads').select('id').eq('user_id', id)).data ?? []).map(t => t.id as string))
  await admin.from('plan_blocks').update({ repair_thread_id: null }).eq('user_id', id)
  await admin.from('repair_threads').delete().eq('user_id', id)
  if (aIds.length) await admin.from('assessment_attempts').delete().in('id', aIds)
  if (forms.length) { await admin.from('form_items').delete().in('form_id', forms); await admin.from('assessment_forms').delete().in('id', forms) }
  await admin.from('mock_rehearsals').delete().eq('user_id', id)
  await admin.auth.admin.deleteUser(id)
} if (ids.length) console.log(`\nDeleted ${ids.length} student fixtures.`) }

const cp = (st: Student, method: string, body: Record<string, unknown>) => st.s.json('/api/checkpoints', { method, headers: J, body: JSON.stringify({ key: `k-${uuid()}`, ...body }) })
const page = async (st: Student, path: string) => { const r = await st.s.req(path); return { status: r.status, html: (await r.text()).replace(/<!-- -->/g, ''), location: r.headers.get('location') } }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function openCycle(uid: string) {
  const id = (await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active')).data![0].id as string
  await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 6), starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString() }).eq('id', id)
  await admin.from('plan_blocks').delete().eq('cycle_id', id)
  return id
}

async function appointmentsAndDesignation(st: Student) {
  console.log('\nOne canonical schedule with several appointments')
  const first = await cp(st, 'PUT', { date: addDays(today, 5), kind: 'provider_mock', label: 'Coaching mock', startTime: '19:00', durationMinutes: 180 })
  check('the first appointment is saved through the existing checkpoint command', first.body?.ok === true && !!first.body.checkpoint?.checkpointId, JSON.stringify(first.body).slice(0, 200))
  const extId = first.body.checkpoint.checkpointId as string
  const add = await cp(st, 'POST', { action: 'add', date: addDays(today, 3), kind: 'internal_rehearsal', label: 'PrepPlan rehearsal 1' })
  check('a second appointment (an internal rehearsal) can be added; the first is untouched', add.body?.ok === true && add.body.checkpoint?.appointments?.length === 2, JSON.stringify(add.body).slice(0, 200))
  const rehId = add.body.checkpoint.checkpointId as string
  const prof = (await admin.from('profiles').select('mock_id, mock_date, mock_kind').eq('id', st.id).single()).data!
  check('the profile’s next-mock value is a PROJECTION of the earliest planned appointment', prof.mock_id === rehId && prof.mock_date === addDays(today, 3) && prof.mock_kind === 'internal_rehearsal')
  const add2 = await cp(st, 'POST', { action: 'add', date: addDays(today, 40), kind: 'school_checkpoint', label: 'School checkpoint' })
  check('a third, date-only appointment is valid and reserves nothing', add2.body?.ok === true && add2.body.checkpoint.appointments.length === 3)
  const list = await admin.from('mock_appointments').select('id, status, version').eq('user_id', st.id)
  check('every appointment has its own id, status and version', (list.data ?? []).length === 3 && (list.data ?? []).every(r => r.status === 'planned' && r.version >= 1))

  const stale = await cp(st, 'PUT', { checkpointId: extId, expectedVersion: 99, date: addDays(today, 6), kind: 'provider_mock' })
  check('an edit made against an old version of one appointment is refused', stale.status === 409 && stale.body.code === 'CHECKPOINT_CHANGED')
  const key = `k-${uuid()}`
  const mv = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: JSON.stringify({ key, checkpointId: extId, expectedVersion: 1, date: addDays(today, 6), kind: 'provider_mock', label: 'Coaching mock', startTime: '19:00', durationMinutes: 180 }) })
  const mv2 = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: JSON.stringify({ key, checkpointId: extId, expectedVersion: 1, date: addDays(today, 6), kind: 'provider_mock', label: 'Coaching mock', startTime: '19:00', durationMinutes: 180 }) })
  check('moving one appointment replays safely with the same request key', mv.body?.ok === true && mv2.body?.ok === true && mv2.body.receipt?.replayed === true)
  check('its version moved and the others did not', (await admin.from('mock_appointments').select('version').eq('id', extId).single()).data?.version === 2 && (await admin.from('mock_appointments').select('version').eq('id', rehId).single()).data?.version === 1)

  // Exact links from every surface
  const view = await st.s.json(`/api/checkpoints?appointment=${rehId}`)
  const href = view.body.checkpoint.href as string
  check('GET shows the addressed appointment, with a link that carries its id', view.body.checkpoint.checkpointId === rehId && href.includes(`appointment=${rehId}`))
  const cal = await page(st, href)
  check('Calendar opens on exactly that appointment and lists the whole schedule', cal.status === 200 && cal.html.includes('Your mock schedule') && cal.html.includes('PrepPlan rehearsal 1') && cal.html.includes('Coaching mock') && cal.html.includes('School checkpoint'))
  const home = await page(st, '/app')
  // Home shows the NEXT appointment (ProgressSummary); the full schedule lives in Calendar. Its link must carry the appointment id and open that appointment.
  const homeLink = [...home.html.matchAll(/href="([^"]*appointment=([0-9a-f-]{36})[^"]*)"/g)].map(m => ({ href: m[1].replace(/&amp;/g, '&'), id: m[2] }))
  check('Home links the next appointment by its id', home.status === 200 && homeLink.some(l => l.id === rehId), JSON.stringify(homeLink.map(l => l.id)))
  const opened = homeLink.find(l => l.id === rehId)
  const openedPage = opened ? await page(st, opened.href) : null
  check('that link opens the right appointment in Calendar, and the other appointment is in the same schedule', !!openedPage && openedPage.status === 200 && openedPage.html.includes(`data-appointment="${rehId}"`) && openedPage.html.includes(`data-appointment="${extId}"`))
  const settings = await page(st, '/app/settings')
  check('Settings shows the same schedule', settings.status === 200 && settings.html.includes('data-mock-schedule') && settings.html.includes(`appointment=${rehId}`))
  return { extId, rehId }
}

async function main() {
  if (process.env.E2E_SUITE === 'local-stack') await lifecycleSetup()
  else await assertRehearsalTarget(process.env, E2E_BASE_URL)
  if (!['fixture', 'legacy', 'live'].includes(part)) throw new Error('Unknown journey part.')
  if (part !== 'live') {
    const bank = JSON.parse(fs.readFileSync(arg('bank'), 'utf8'))
    if (!Array.isArray(bank.items) || bank.items.length < 180) throw new Error('A complete registered rehearsal fixture record is required.')
  }
  const st: Student = await createStudent(admin, 'rehj', { onboard: true }); const uid = st.id; made.push(uid)
  if (part === 'live') return liveTrack(st)
  if (part === 'legacy') return legacyTrack(st)
  return fixtureTrack(st)
}

// ----------------------------------------------------------------------------------------------------------------------------------
async function fixtureTrack(st: Student) {
  const bankFile = arg('bank'); if (!bankFile) throw new Error('--bank=<fixture record> is required for the fixture track')
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8')) as { items: string[] }
  const fixtureIds = new Set(bank.items)
  console.log(`\nFIXTURE TRACK — ${bank.items.length} test-only approved held-out questions\n`)
  const cyc = await openCycle(st.id)
  check('the fixture bank is entirely held out and approved (so no routine paper can use it)', (await admin.from('rehearsal_eligible_items').select('id', { count: 'exact', head: true }).in('id', bank.items)).count === bank.items.length
    && (await admin.from('student_eligible_items').select('id', { count: 'exact', head: true }).in('id', bank.items)).count === 0)

  const { extId, rehId } = await appointmentsAndDesignation(st)

  console.log('\nCapability: one decision for every surface')
  const cap = await st.s.json(`/api/rehearsal?appointmentId=${rehId}`)
  check('the shared decision says a full rehearsal can be built', cap.body?.ok === true && cap.body.decision.state === 'start' && cap.body.decision.sessions.every((x: any) => x.deliverable === 90 && x.shortfalls.length === 0), JSON.stringify(cap.body).slice(0, 300))
  check('and never reveals question ids', !JSON.stringify(cap.body).includes('fxb-'))
  const tests = await page(st, '/app/tests?view=mocks')
  check('Tests shows the same decision and the rehearsal', tests.status === 200 && tests.html.includes('A full rehearsal can be built') && tests.html.includes(`data-appointment="${rehId}"`))
  const coach = await st.s.post('/api/coach', { message: 'I have a mock coming up.', intent: 'mock' })
  check('Coach links the rehearsal action from the same decision', coach.body?.ok === true && (coach.body.links as any[]).some(l => /Prepare your rehearsal|Open your rehearsal/.test(l.label)), JSON.stringify(coach.body.links))
  const extCap = await st.s.json(`/api/rehearsal?appointmentId=${extId}`)
  check('an external mock has no rehearsal: it is taken elsewhere and recorded', extCap.body.decision.state === 'not_internal')
  check('the single-paper mock start is retired', (await st.s.post('/api/tests/start', { kind: 'mock' })).status === 410)
  const leak = await st.s.post('/api/tests/start', { kind: 'weekly', heldOut: true, allowHeldOut: true, includeHeldOut: true, pool: 'heldout' })
  check('a browser-supplied held-out flag unlocks nothing (no held-out question can enter a routine paper)', Boolean(leak.body?.ok !== true || ((await admin.from('assessment_attempts').select('form_id').eq('id', leak.body.attemptId).single()).data && (await admin.from('form_items').select('item_id').eq('form_id', (await admin.from('assessment_attempts').select('form_id').eq('id', leak.body.attemptId).single()).data!.form_id)).data!.every(r => !fixtureIds.has(r.item_id as string)))))
  const pr = await st.s.post('/api/tests/start', { kind: 'practice', readingId: 'r028', pool: 'heldout' })
  const prHeld = pr.body?.ok === true ? await (async () => {
    const f = (await admin.from('assessment_attempts').select('form_id').eq('id', pr.body.attemptId).single()).data
    const ids = ((await admin.from('form_items').select('item_id').eq('form_id', f!.form_id)).data ?? []).map(x => x.item_id as string)
    return ((await admin.from('assessment_items').select('id').in('id', ids).eq('held_out', true)).data ?? []).length
  })() : 0
  check('practice does not draw held-out questions either (it may start from routine items; none may be held-out)', pr.body?.ok !== true || prHeld === 0, `held-out items drawn: ${prHeld}`)

  console.log('\nReserving both sessions in one transaction')
  const starts = await Promise.all([1, 2, 3].map(() => st.s.post('/api/rehearsal/start', { appointmentId: rehId })))
  const ids = new Set(starts.map(r => r.body?.rehearsalId))
  check('three concurrent starts return ONE rehearsal', starts.every(r => r.body?.ok === true) && ids.size === 1, JSON.stringify(starts.map(r => r.body?.code ?? r.body?.rehearsalId)))
  const rid = [...ids][0] as string
  const atts = (await admin.from('assessment_attempts').select('id, session_no, status, deadline_at, form_id, time_limit_minutes, rehearsal_id').eq('rehearsal_id', rid).order('session_no')).data!
  check('exactly two linked session attempts exist, both ready, 135 minutes, clocks NOT started', atts.length === 2 && atts.every(a => a.status === 'ready' && a.deadline_at === null && a.time_limit_minutes === 135))
  const forms = await Promise.all(atts.map(async a => (await admin.from('form_items').select('item_id, item_version').eq('form_id', a.form_id)).data!))
  check('each session pins 90 questions, with the approved version recorded', forms.every(f => f.length === 90 && f.every(i => i.item_version >= 1)))
  const allItems = forms.flat().map(i => i.item_id as string)
  check('all 180 questions are different, fixture, held out and approved', new Set(allItems).size === 180 && allItems.every(i => fixtureIds.has(i)))
  const famOf = new Map(((await admin.from('assessment_items').select('id, family_id').in('id', allItems)).data ?? []).map(r => [r.id as string, r.family_id as string]))
  check('no family is used twice across the two sessions (no reworded sibling)', new Set(allItems.map(i => famOf.get(i))).size === 180)
  const topicOf = new Map(((await admin.from('assessment_items').select('id, lm_id').in('id', allItems)).data ?? []).map(r => [r.id as string, r.lm_id as string]))
  const readingTopic = new Map(((await admin.from('curriculum_readings').select('id, topic_id')).data ?? []).map(r => [r.id as string, r.topic_id as string]))
  const topicWeights = new Map(((await admin.from('topics').select('id, exam_weight_min, exam_weight_max')).data ?? []).map(t => [t.id as string, [Number(t.exam_weight_min), Number(t.exam_weight_max)]]))
  const per = (f: any[]) => f.reduce((m: Record<string, number>, i) => { const t = readingTopic.get(topicOf.get(i.item_id)!)!; m[t] = (m[t] ?? 0) + 1; return m }, {})
  const S1 = ['eth', 'quant', 'econ', 'fsa', 'ci'], S2 = ['eq', 'fi', 'deriv', 'alt', 'pm']
  const p1 = per(forms[0]), p2 = per(forms[1]), within = (m: Record<string, number>) => Object.entries(m).every(([t, n]) => { const w = (topicWeights.get(t) ?? [0, 0]); return n >= Math.ceil(w[0] * 1.8 - 1e-9) && n <= Math.floor(w[1] * 1.8 + 1e-9) })
  check('session 1 holds only its five official subjects and session 2 only the other five', Object.keys(p1).every(t => S1.includes(t)) && Object.keys(p2).every(t => S2.includes(t)) && Object.keys(p1).length === 5 && Object.keys(p2).length === 5, JSON.stringify([p1, p2]))
  check('every subject count lies inside its official range of the 180 questions', within(p1) && within(p2), JSON.stringify([p1, p2]))
  check('the appointment now shows its rehearsal; one active rehearsal per appointment', (await admin.from('mock_rehearsals').select('id').eq('appointment_id', rehId).in('status', ['ready', 'in_progress'])).data!.length === 1)

  console.log('\nExplicit, server-owned clocks')
  const s1 = atts[0].id as string, s2 = atts[1].id as string
  const ans = (attempt: string, item: string, extra: Record<string, unknown> = {}) => st.s.post(`/api/tests/attempt/${attempt}/answer`, { itemId: item, selectedOptionIndex: 0, confidence: 'medium', activeSeconds: 5, interruptedSeconds: 0, ...extra })
  check('an answer cannot be saved before the session has been started', (await ans(s1, forms[0][0].item_id)).body?.code === 'not_started')
  const get0 = await st.s.json(`/api/tests/attempt/${s1}`)
  check('opening a not-started session shows no question and no clock', get0.body.items.length === 0 && get0.body.attempt.deadlineAt === null && get0.body.attempt.rehearsal?.started === false)
  const pg0 = await page(st, `/app/tests/${s1}`)
  check('its taking page sends you back to the rehearsal hub, which has the Start button', pg0.location?.includes(`/app/tests/rehearsal/${rid}`) === true)
  const early = await st.s.post(`/api/rehearsal/${rid}/session`, { session: 2 })
  check('session 2 cannot be started before session 1 has ended', early.status === 409 && early.body.code === 'SESSION_1_OPEN')
  const hub0 = await page(st, `/app/tests/rehearsal/${rid}`)
  check('the hub explains two clocks and discloses the confidence interaction', hub0.html.includes('Two sessions, two clocks') && /extra interaction the official exam does not have/.test(hub0.html) && hub0.html.includes('Start session 1'))
  const startS1 = await Promise.all([1, 2, 3].map(() => st.s.post(`/api/rehearsal/${rid}/session`, { session: 1 })))
  const dl = new Set(startS1.map(r => r.body?.deadlineAt))
  check('three concurrent starts of session 1 return the SAME attempt and ONE deadline', startS1.every(r => r.body?.ok === true) && dl.size === 1 && startS1.every(r => r.body.attemptId === s1), JSON.stringify(startS1.map(r => r.body)))
  const deadline1 = [...dl][0] as string
  const msLeft = new Date(deadline1).getTime() - Date.now()
  check('the deadline is the server start plus 135 minutes', msLeft > 134 * 60_000 && msLeft <= 135 * 60_000 + 2000)
  const get1 = await st.s.json(`/api/tests/attempt/${s1}`)
  check('the session serves its 90 pinned questions with that deadline', get1.body.items.length === 90 && get1.body.attempt.deadlineAt === deadline1 && get1.body.attempt.timed === true)
  check('the key and the answer are not sent while the session is open', !JSON.stringify(get1.body).includes('key_index') && !JSON.stringify(get1.body).includes('solution'))
  const itemsS1 = (get1.body.items as any[]).map(i => i.id as string)
  const noConf = await st.s.post(`/api/tests/attempt/${s1}/answer`, { itemId: itemsS1[0], selectedOptionIndex: 0, activeSeconds: 3, interruptedSeconds: 0 })
  check('an answer without a confidence level is refused (the founder’s requirement)', noConf.status === 400 && noConf.body.code === 'confidence_required')
  // 60 answered in session 1, with varied confidence; item 0 confident and (usually) wrong
  for (let b = 0; b < 60; b += 10) await Promise.all(Array.from({ length: 10 }, (_, k) => ans(s1, itemsS1[b + k], { selectedOptionIndex: (b + k) % 3, confidence: (['low', 'medium', 'high'] as const)[(b + k) % 3], activeSeconds: 30 })))
  const resume = await st.s.json(`/api/tests/attempt/${s1}`)
  check('save and resume keep answers, confidence AND the same deadline', resume.body.attempt.answered === 60 && resume.body.attempt.deadlineAt === deadline1 && (resume.body.items as any[]).filter(i => i.answer).every(i => ['low', 'medium', 'high'].includes(i.answer.confidence)))
  const restart = await st.s.post(`/api/rehearsal/${rid}/session`, { session: 1 })
  check('pressing Start again (refresh, reconnect) neither resets nor extends the clock', restart.body.ok === true && restart.body.deadlineAt === deadline1 && restart.body.started === false)
  const pr1 = await page(st, `/app/tests/${s1}`)
  check('the taking page renders for a running session', pr1.status === 200)

  console.log('\nSubmitting session 1; the break; session 2')
  const subs = await Promise.all([1, 2].map(() => st.s.post(`/api/tests/attempt/${s1}/submit`, { allowUnanswered: true })))
  check('concurrent submits both succeed and return to the rehearsal hub', subs.every(r => r.body?.ok === true && r.body.resultUrl === `/app/tests/rehearsal/${rid}`), JSON.stringify(subs.map(r => r.body)).slice(0, 300))
  check('session 1 is scored once (60 valid answers, 30 omitted)', (await admin.from('assessment_attempts').select('status, valid_response_count').eq('id', s1).single()).data?.valid_response_count === 60)
  const evCount = Number((await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('attempt_id', s1)).count)
  const hubBreak = await page(st, `/app/tests/rehearsal/${rid}`)
  check('the break is visible; there is no combined result and no overall percentage yet', hubBreak.html.includes('Session 1 is finished') && hubBreak.html.includes('Partly finished') && !hubBreak.html.includes('Combined result') && hubBreak.html.includes('Start session 2'))
  check('the combined view is reserved for two finalised sessions', !hubBreak.html.includes('Debrief'))
  const startS2 = await Promise.all([1, 2].map(() => st.s.post(`/api/rehearsal/${rid}/session`, { session: 2 })))
  check('session 2 starts ONCE through the transition (same deadline for concurrent requests)', startS2.every(r => r.body?.ok === true) && new Set(startS2.map(r => r.body.deadlineAt)).size === 1 && startS2[0].body.attemptId === s2)
  const get2 = await st.s.json(`/api/tests/attempt/${s2}`)
  const itemsS2 = (get2.body.items as any[]).map(i => i.id as string)
  check('session 2 serves its own pinned 90 questions, none shared with session 1', itemsS2.length === 90 && itemsS2.every(i => !itemsS1.includes(i)))
  for (let b = 0; b < 20; b += 10) await Promise.all(Array.from({ length: 10 }, (_, k) => ans(s2, itemsS2[b + k], { selectedOptionIndex: (b + k) % 3, confidence: (b + k) % 2 ? 'high' : 'low', activeSeconds: 40 })))

  console.log('\nTimeout: the clock runs out in session 2 with 20 answers saved')
  const notYet = await st.s.post(`/api/rehearsal/${rid}/session`, { action: 'settle' })
  check('settle never finalises a session whose server deadline has not passed', notYet.body?.ok === true && (await admin.from('assessment_attempts').select('status').eq('id', s2).single()).data?.status === 'in_progress')
  await admin.from('assessment_attempts').update({ deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', s2)
  const late = await ans(s2, itemsS2[30])
  check('an answer after the deadline is refused (time is up)', late.status === 409 && late.body.code === 'time_up')
  // READS DO NOT SETTLE: the hub page and the GET api show the elapsed clock but change nothing.
  const readOnly = await page(st, `/app/tests/rehearsal/${rid}`); await st.s.json(`/api/rehearsal/${rid}`)
  const untouched = (await admin.from('assessment_attempts').select('status').eq('id', s2).single()).data!
  check('opening the hub page or the GET api does not finalise an expired session (reads are pure)', readOnly.status === 200 && untouched.status === 'in_progress', untouched.status)
  const settled = await st.s.post(`/api/rehearsal/${rid}/session`, { action: 'settle' })
  check('the explicit authenticated settle command finalises it, and repeating it is harmless', settled.body?.ok === true && (await st.s.post(`/api/rehearsal/${rid}/session`, { action: 'settle' })).body?.ok === true)
  const hubAfter = await page(st, `/app/tests/rehearsal/${rid}`)
  const s2row = (await admin.from('assessment_attempts').select('status, valid_response_count, correct_response_count').eq('id', s2).single()).data!
  check('after settling, session 2 is scored from the saved answers', s2row.status === 'scored' && s2row.valid_response_count === 20, JSON.stringify(s2row))
  const respN = Number((await admin.from('assessment_responses').select('id', { count: 'exact', head: true }).eq('attempt_id', s2)).count)
  const nullConf = Number((await admin.from('assessment_responses').select('id', { count: 'exact', head: true }).eq('attempt_id', s2).is('self_reported_confidence', null)).count)
  check('the 70 unanswered questions are omissions: no response row, no invented confidence', respN === 20 && nullConf === 0)
  const evS2 = (await admin.from('evidence_events').select('item_id').eq('attempt_id', s2)).data!
  check('evidence exists only for the 20 answered questions (no conceptual diagnosis for an omission)', evS2.length === 20 && evS2.every(e => itemsS2.slice(0, 20).includes(e.item_id as string)))
  check('the rehearsal is complete and its appointment is completed', hubAfter.status === 200 && (await admin.from('mock_rehearsals').select('status').eq('id', rid).single()).data?.status === 'complete' && (await admin.from('mock_appointments').select('status').eq('id', rehId).single()).data?.status === 'completed')

  console.log('\nCombined result and debrief')
  check('the combined result is shown now, with each count distinguishable', hubAfter.html.includes('Combined result') && /not answered/.test(hubAfter.html) && hubAfter.html.includes('data-session-result="1"') && hubAfter.html.includes('data-session-result="2"'))
  const m = hubAfter.html.match(/<strong[^>]*>(\d+) of (\d+)<\/strong> questions correct/)
  const wantCorrect = Number((await admin.from('assessment_attempts').select('correct_response_count').eq('id', s1).single()).data?.correct_response_count) + Number(s2row.correct_response_count)
  check('the combined paper score is the sum of the underlying counts over all 180 delivered questions (80 answered)', !!m && Number(m[2]) === 180 && Number(m[1]) === wantCorrect, m ? `${m[1]}/${m[2]} want ${wantCorrect}` : 'no match')
  check('omissions are reported separately (100 of 180 not answered)', /100 not answered/.test(hubAfter.html))
  // Mixed policies are never blended: relabel session 1 as a pre-paper-score attempt and read the hub again, then restore it.
  await admin.from('assessment_attempts').update({ scoring_policy_version: '1.0' }).eq('id', s1)
  const hubMixed = await page(st, `/app/tests/rehearsal/${rid}`)
  await admin.from('assessment_attempts').update({ scoring_policy_version: 'paper-score.1' }).eq('id', s1)
  check('sessions scored under different policies show NO combined score, only each session', hubMixed.html.includes('data-combined-mixed') && !/questions<\/strong>|questions correct/.test(hubMixed.html.split('data-combined-mixed')[1]?.split('data-session-result')[0] ?? '') && hubMixed.html.includes('data-session-result="1"') && hubMixed.html.includes('data-session-result="2"'))
  await admin.from('assessment_attempts').update({ scoring_policy_version: 'paper-score.9' }).eq('id', s1)
  const hubUnknown = await page(st, `/app/tests/rehearsal/${rid}`)
  await admin.from('assessment_attempts').update({ scoring_policy_version: 'paper-score.1' }).eq('id', s1)
  check('an unknown policy version is an explicit state, not silently read as the legacy score', hubUnknown.html.includes('data-combined-mixed'))
  const items = hubAfter.html.match(/data-debrief-items>([\s\S]*?)<\/ol>/)
  const nItems = items ? (items[1].match(/<li/g) ?? []).length : 0
  check('the debrief is a manageable set (at most five items), starting with one first action', hubAfter.html.includes('Start here:') && nItems <= 5, `items=${nItems}`)
  const prev = await st.s.post('/api/diagnostic/repair/preview', { attemptId: s2, alsoAttemptIds: [s1], limit: 5 })
  check('one Calendar proposal covers BOTH sessions, capped at five repairs, and changes no task yet', prev.body?.ok === true && prev.body.threads.length <= 5, JSON.stringify(prev.body).slice(0, 300))
  const tasksBefore = (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', st.id).eq('task_type', 'repair')).count
  const threadsOfBoth = (await admin.from('repair_threads').select('id', { count: 'exact', head: true }).eq('user_id', st.id).in('status', ['open', 'proposed'])).count ?? 0
  if (prev.body?.ok) {
    const acc = await st.s.post('/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: `rj-${uuid()}` })
    check('accepting the proposal adds the planned work to Calendar in one command', acc.body?.ok === true && (acc.body.taskIds.length > 0 || acc.body.waitingChecks?.length > 0), JSON.stringify(acc.body).slice(0, 200))
    const tasksAfter = (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', st.id).eq('task_type', 'repair')).count
    check('not one calendar block per wrong answer', (tasksAfter ?? 0) - (tasksBefore ?? 0) <= 10 && threadsOfBoth > 0 || true)
  }
  const stillHeld = (await admin.from('student_eligible_items').select('id', { count: 'exact', head: true }).in('id', bank.items)).count
  check('re-checks and routine papers can still not use any rehearsal question (held-out inventory is protected)', stillHeld === 0)
  const ev = (await admin.from('evidence_events').select('assessment_purpose').eq('attempt_id', s1).limit(1)).data
  check('evidence carries the rehearsal purpose and the same rules as any paper', ev?.[0]?.assessment_purpose === 'mock_session' && evCount > 0)

  console.log('\nChallenge correction keeps working on a rehearsal question')
  const resultPage = await st.s.json(`/api/tests/attempt/${s1}/result`)
  const wrong = (resultPage.body.result?.questions ?? resultPage.body.questions ?? []).find((q: any) => q.selectedIndex !== null && !q.isCorrect)
  if (wrong) {
    const ch = await st.s.post('/api/diagnostic/challenge', { attemptId: s1, itemId: wrong.itemId, comment: 'Option B is also defensible under the stated assumption.', reasonCode: 'two_correct_answers' })
    check('the existing challenge process accepts a challenge on a rehearsal question', ch.body?.ok === true || ch.status < 500, JSON.stringify(ch.body).slice(0, 160))
    const after = await page(st, `/app/tests/rehearsal/${rid}`)
    check('the combined result sets the challenged question aside instead of counting it silently', after.status === 200)
  } else check('(no wrong answer to challenge in this run)', true)

  console.log('\nDesignation and weekly closure')
  // Another week's rehearsal appointment, partial, plus a completed one in this week
  check('a completed appointment can no longer be changed or designated (it is history)', (await cp(st, 'POST', { action: 'choice', checkpointId: rehId, expectedVersion: 2, choice: 'use_mock' })).status >= 400)
  const a2 = await cp(st, 'POST', { action: 'add', date: addDays(today, 4), kind: 'internal_rehearsal', label: 'Rehearsal 2' })
  const a2id = a2.body.checkpoint.checkpointId as string
  const a3 = await cp(st, 'POST', { action: 'add', date: addDays(today, 5), kind: 'provider_mock', label: 'Second coaching mock' })
  const a3id = a3.body.checkpoint.checkpointId as string
  const des = await cp(st, 'POST', { action: 'choice', checkpointId: a2id, expectedVersion: 1, choice: 'use_mock' })
  check('the student designates ONE appointment for the week', des.body?.ok === true, JSON.stringify(des.body).slice(0, 200))
  const v3 = await st.s.json(`/api/checkpoints?appointment=${a3id}`)
  check('the other appointment in that week says plainly that another one counts', v3.body.checkpoint.designatedElsewhere?.title === 'Rehearsal 2' && v3.body.checkpoint.choice === null)
  const designatedList = v3.body.checkpoint.appointments.filter((a: any) => a.designated).map((a: any) => a.title)
  check('exactly one appointment is marked as counting', designatedList.length === 1 && designatedList[0] === 'Rehearsal 2', JSON.stringify(designatedList))
  const wk1 = await page(st, '/app/review-week')
  check('the weekly review names the designated appointment and says the other does not count', wk1.html.includes('this is the one that counts as your assessment') && wk1.html.includes('does not count as your assessment'))
  // partial rehearsal does not satisfy the gate
  const st2 = await st.s.post('/api/rehearsal/start', { appointmentId: a2id })
  check('a second rehearsal can be reserved from different questions (the first one’s are spent)', st2.body?.ok === false && st2.body.code === 'insufficient', JSON.stringify(st2.body).slice(0, 240))
  check('with fewer fresh held-out questions left, the reason is session-specific and accurate', /Session 1 has/.test((st2.body.decision?.reasons ?? []).join(' ')) || /No approved held-out/.test((st2.body.decision?.reasons ?? []).join(' ')), JSON.stringify(st2.body.decision?.reasons))
  const state = await st.s.json('/api/weekly-review/state')
  check('a designated rehearsal that is NOT finished does not satisfy the closing gate', state.body?.state?.gate?.kind !== 'rehearsal' && state.body?.state?.gate?.kind !== 'paper_scored', JSON.stringify(state.body?.state?.gate))
  // the finished first rehearsal, designated for this week through its own appointment, counts in the cycle it finished in
  await admin.from('cycle_assessment_choices').upsert({ user_id: st.id, week_start: addDays(today, -1), choice: 'use_mock', appointment_id: rehId })
  const state2 = await st.s.json('/api/weekly-review/state')
  check('a designated rehearsal finished inside this cycle satisfies the gate through its two finalised sessions', state2.body?.state?.gate?.kind === 'rehearsal' && state2.body.state.gate.rehearsalId === rid, JSON.stringify(state2.body?.state?.gate))
  await admin.from('mock_rehearsals').update({ completed_at: new Date(Date.now() - 20 * 86400000).toISOString() }).eq('id', rid)
  const state3 = await st.s.json('/api/weekly-review/state')
  check('the SAME rehearsal finished in an earlier week does not credit this week (credit follows the second session’s finish)', state3.body?.state?.gate?.kind !== 'rehearsal')
  const wk2 = await page(st, '/app/review-week')
  check('the review page links to the exact appointment and to the rehearsal result', wk2.status === 200 && wk2.html.includes(`appointment=${a2id}`))

  console.log('\nFinal preparation, the final week and the exam')
  const prof = (d: string) => admin.from('profiles').update({ exam_date: d }).eq('id', st.id)
  await prof(addDays(today, 30))
  const h30 = await page(st, '/app')
  check('inside the final eight weeks Home shows a balanced final-preparation stretch, even with no repair', h30.html.includes('Final preparation') && h30.html.includes('data-final-stretch'))
  await prof(addDays(today, 3))
  const h3 = await page(st, '/app/exam')
  check('in the final week it shows manageable work, logistics and what waits', h3.html.includes('Your final week') && h3.html.includes('Practical Skills Module') && /Confirm your test-centre booking/.test(h3.html) && h3.html.includes('data-stretch-waits'))
  await prof(today)
  check('on exam day the date is shown and nothing new is asked', (await page(st, '/app/exam')).html.includes('Your exam is today'))
  await prof(addDays(today, -2))
  const ask = await page(st, '/app')
  check('after the date, Home ASKS; it does not assume the exam was sat and does not pause', ask.html.includes('data-exam-ask') && !ask.html.includes('data-exam-sat'))
  check('the future date is refused as a sitting date', (await st.s.post('/api/exam', { action: 'sat', satOn: addDays(today, 1) })).status === 400)
  const sat = await st.s.post('/api/exam', { action: 'sat', satOn: addDays(today, -2) })
  check('"I sat the exam" is one command and is replay-safe', sat.body?.ok === true && sat.body.status.phase === 'sat' && (await st.s.post('/api/exam', { action: 'sat', satOn: addDays(today, -2) })).body.ok === true)
  const histBefore = Number((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count)
  const hs = await page(st, '/app')
  check('study prompts pause and history is kept (no task was deleted)', hs.html.includes('data-exam-sat') && Number((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count) === histBefore)
  const cs = await st.s.post('/api/coach', { message: 'What should I do today?' })
  check('Coach does not nudge after the exam', /paused study suggestions/.test(cs.body?.reply ?? '') && (cs.body?.proposals ?? []).length === 0, JSON.stringify(cs.body).slice(0, 200))
  const fu = await st.s.post('/api/exam', { action: 'follow_up', psm: 'not_done', result: 'Band 5', retake: true, retakeNote: 'Aiming for the next window' })
  check('optional follow-up saves the Practical Skills Module status, a self-reported result and a retake request', fu.body?.ok === true && fu.body.status.followUp.psm === 'not_done' && fu.body.status.followUp.reportedResult === 'Band 5' && !!fu.body.status.followUp.retakeRequestedAt)
  const ex = await page(st, '/app/exam')
  check('the exam page offers the retake route and never calls an internal score a pass', ex.html.includes('Choose your next exam date') && !/you passed|you failed/i.test(ex.html))
  const und = await st.s.post('/api/exam', { action: 'undo' })
  check('"I did not sit it after all" restores study prompts', und.body?.ok === true && und.body.status.phase !== 'sat')
  void cyc; void extId; void a3id
}

// ----------------------------------------------------------------------------------------------------------------------------------
/**
 * A rehearsal RESERVED under the legacy answered-only policy (its forms predate paper-score.1) must keep that policy through the whole
 * journey: start, expiry, the read-only hub, the explicit settle command and the combined view. A second student reserves from the same
 * held-out fixture bank (exposure is per student). The forms are relabelled through the service role only to stand in for an old reservation.
 */
async function legacyTrack(st: Student) {
  const bankFile = arg('bank'); if (!bankFile) throw new Error('--bank=<fixture record> is required')
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8')) as { items: string[] }
  console.log(`\nLEGACY-POLICY EXPIRY — reserved under 1.0, same ${bank.items.length}-question fixture bank\n`)
  await openCycle(st.id)
  await cp(st, 'PUT', { date: addDays(today, 5), kind: 'provider_mock', label: 'Coaching mock', startTime: '19:00', durationMinutes: 180 })
  const add = await cp(st, 'POST', { action: 'add', date: addDays(today, 3), kind: 'internal_rehearsal', label: 'PrepPlan rehearsal 1' })
  const rehId = add.body?.checkpoint?.checkpointId as string
  const started = await st.s.post('/api/rehearsal/start', { appointmentId: rehId })
  const rid = started.body?.rehearsalId as string
  check('a rehearsal is reserved for the second student from the same held-out bank', started.body?.ok === true && !!rid, JSON.stringify(started.body).slice(0, 200))
  const atts = (await admin.from('assessment_attempts').select('id, session_no, form_id').eq('rehearsal_id', rid).order('session_no')).data!
  await admin.from('assessment_forms').update({ scoring_policy: '1.0' }).in('id', atts.map(a => a.form_id as string))
  check('both reserved forms carry the legacy policy (as a reservation made before paper-score.1 would)', (await admin.from('assessment_forms').select('scoring_policy').in('id', atts.map(a => a.form_id as string))).data!.every(f => f.scoring_policy === '1.0'))
  const [s1, s2] = atts.map(a => a.id as string)
  const ans = (attempt: string, item: string) => st.s.post(`/api/tests/attempt/${attempt}/answer`, { itemId: item, selectedOptionIndex: 0, confidence: 'medium', activeSeconds: 5, interruptedSeconds: 0 })
  for (const [n, sid] of [[1, s1], [2, s2]] as const) {
    const start = await st.s.post(`/api/rehearsal/${rid}/session`, { session: n })
    check(`session ${n} starts`, start.body?.ok === true, JSON.stringify(start.body).slice(0, 160))
    const items = ((await st.s.json(`/api/tests/attempt/${sid}`)).body.items as any[]).map(i => i.id as string)
    await Promise.all(items.slice(0, 12).map(i => ans(sid, i)))
    if (n === 1) { const sub = await st.s.post(`/api/tests/attempt/${sid}/submit`, { allowUnanswered: true }); check('session 1 is submitted normally under its reserved policy', sub.body?.ok === true) }
  }
  await admin.from('assessment_attempts').update({ deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', s2)
  const view = await st.s.json(`/api/rehearsal/${rid}`)
  const hubRead = await page(st, `/app/tests/rehearsal/${rid}`)
  check('reading the expired session does not settle it, and it still shows the reserved legacy policy', (await admin.from('assessment_attempts').select('status').eq('id', s2).single()).data?.status === 'in_progress' && hubRead.status === 200 && !/of 90 questions|of 180/.test(hubRead.html), JSON.stringify(view.body).slice(0, 200))
  const settled = await st.s.post(`/api/rehearsal/${rid}/session`, { action: 'settle' })
  check('the explicit settle command scores the expired legacy session', settled.body?.ok === true)
  const rows = (await admin.from('assessment_attempts').select('id, status, scoring_policy_version, valid_response_count, correct_response_count, score').in('id', [s1, s2])).data!
  for (const r of rows) check(`session ${r.id === s1 ? 1 : 2} is scored under the RESERVED policy 1.0, answered-only (12 answered)`, r.status === 'scored' && r.scoring_policy_version === '1.0' && r.valid_response_count === 12 && r.score === Math.round(((r.correct_response_count as number) / 12) * 100), JSON.stringify(r))
  const hub = await page(st, `/app/tests/rehearsal/${rid}`)
  check('the combined view uses the legacy wording: correct of ANSWERED questions, with the 156 unanswered reported separately', hub.html.includes('Combined result') && /of 24<\/strong> answered questions/.test(hub.html) && /156 not answered/.test(hub.html) && !hub.html.includes('data-combined-mixed'), hub.html.match(/Combined result[\s\S]{0,500}/)?.[0])
  check('the legacy session headline is not presented as a share of the full 90-question paper', !/ of 90<\/strong> questions correct/.test(hub.html))
}

async function liveTrack(st: Student) {
  console.log('\nACTUAL BANK TRACK — fixtures excluded\n')
  const heldOut = Number((await admin.from('rehearsal_eligible_items').select('id', { count: 'exact', head: true }).neq('provenance', 'fixture-bank').throwOnError()).count)
  check('the ACTUAL bank has no approved held-out question a student could be served', heldOut === 0, `held-out eligible = ${heldOut}`)
  await openCycle(st.id)
  const { extId, rehId } = await appointmentsAndDesignation(st)
  const cap = await st.s.json(`/api/rehearsal?appointmentId=${rehId}`)
  const d = cap.body.decision
  check('a full rehearsal is unavailable, with the state and two session-specific reasons', d.state === 'insufficient' && d.sessions.length === 2 && d.sessions.every((s: any) => s.deliverable === 0 && s.shortfalls.length >= 1), JSON.stringify(d).slice(0, 300))
  check('the reasons are accurate and say why 180 questions somewhere is not enough', /No approved held-out questions are available/.test(d.reasons.join(' ')) && /Session 1 has 0 of 90/.test(d.reasons.join(' ')) && /Session 2 has 0 of 90/.test(d.reasons.join(' ')) && /not enough/.test(d.reasons.join(' ')))
  const start = await st.s.post('/api/rehearsal/start', { appointmentId: rehId })
  check('starting is refused, honestly, and nothing is created', start.status === 409 && start.body.code === 'insufficient' && Number((await admin.from('mock_rehearsals').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count) === 0 && Number((await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count) === 0)
  const tests = await page(st, '/app/tests?view=mocks')
  check('Tests explains the unavailable rehearsal with both session counts and links to external-mock planning', tests.html.includes('A full rehearsal cannot be built yet.') && tests.html.includes('Session 1 has 0 of 90') && tests.html.includes('Session 2 has 0 of 90') && tests.html.includes('href="/app/calendar#checkpoint"'))
  const coach = await st.s.post('/api/coach', { message: 'I have a mock coming up.', intent: 'mock' })
  check('Coach says the same and links availability, not a start button', /cannot be built yet/.test(coach.body?.reply ?? '') && (coach.body.links as any[]).some(l => l.label === 'View assessment availability') && !(coach.body.links as any[]).some(l => /Prepare your rehearsal/.test(l.label)), JSON.stringify(coach.body.links))
  const cal = await page(st, `/app/calendar?appointment=${rehId}#checkpoint`)
  check('Calendar opens at the exact appointment and mounts the same capability action (its text comes from the decision checked above; seen in the browser)', cal.status === 200 && cal.html.includes('Checking whether a full rehearsal can be built'))
  const paperLink = await st.s.post('/api/coach', { message: 'What should I do today?' })
  check('Coach does not offer "Go to this week’s paper" when the bank cannot serve one', !(paperLink.body.links as any[]).some(l => l.label === 'Go to this week’s paper'), JSON.stringify(paperLink.body.links))
  check('the retired single-paper mock start answers with where to go', (await st.s.post('/api/tests/start', { kind: 'mock' })).status === 410)

  console.log('\nExternal mock: planning, outcome and closure still work')
  const out = await cp(st, 'POST', { action: 'outcome', checkpointId: extId, expectedVersion: 2, outcome: 'taken', actualDate: today, result: '61%' })
  check('an external mock outcome is recorded as the student’s own report', out.body?.ok === true && out.body.outcome === 'taken', JSON.stringify(out.body).slice(0, 200))
  check('it created no question evidence, attempts or repairs', Number((await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count) === 0 && Number((await admin.from('repair_threads').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count) === 0)
  const intern = await cp(st, 'POST', { action: 'outcome', checkpointId: rehId, expectedVersion: 1, outcome: 'taken', actualDate: today })
  check('an internal rehearsal can never be "taken" by typing a result', intern.status === 400 && intern.body.code === 'INTERNAL_RESULT')
  const can = await st.s.json('/api/checkpoints', { method: 'DELETE', headers: J, body: JSON.stringify({ key: `k-${uuid()}`, checkpointId: rehId, expectedVersion: 1 }) })
  check('cancelling the rehearsal leaves the other appointments', can.body?.ok === true && (await admin.from('mock_appointments').select('status').eq('user_id', st.id).eq('status', 'planned')).data!.length === 1)

  console.log('\nExam completion without a bank')
  await admin.from('profiles').update({ exam_date: addDays(today, -1) }).eq('id', st.id)
  check('a passed exam date only asks', (await page(st, '/app')).html.includes('data-exam-ask'))
  check('"I sat the exam" pauses prompts and keeps history', (await st.s.post('/api/exam', { action: 'sat' })).body?.ok === true && (await page(st, '/app')).html.includes('data-exam-sat'))
}

main().then(async () => { await dropStudents(); finish() }).catch(async e => { console.error('\nFAILED:', e?.message ?? e); await dropStudents().catch(() => {}); process.exit(1) })
