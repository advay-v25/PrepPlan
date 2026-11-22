/**
 * Onboarding, end to end, with an ORDINARY throwaway student (no role, deleted after); independent of every other suite.
 *
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-onboarding.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

import { assertBlankOnboarding, E2E_BASE_URL } from './lib/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = `integ+onb${Date.now()}@example.com`
let createdId = ''

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }

const jar = new Map<string, string>()
function store(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';'); const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  store(res); return res
}
async function json(path: string, init: RequestInit = {}) {
  const res = await req(path, init); const t = await res.text()
  try { return { status: res.status, body: JSON.parse(t) } } catch { return { status: res.status, body: { raw: t.slice(0, 200) } } }
}
const post = (p: string, b?: unknown) =>
  json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log(`\nOnboarding end to end against ${BASE}\n`)

  const created = await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true })
  createdId = created.data.user!.id
  const { data: link } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (!link.properties) throw new Error('Could not generate an owned sign-in link.')
  const login = await post('/api/auth', { action: 'verify', type: 'magiclink', tokenHash: link.properties.hashed_token, next: '/onboarding' })
  check('magic link signs us in and sets cookies', login.status === 200 && login.body?.next === '/onboarding')
  const entry = await req('/onboarding')
  check('a fresh user hits the gateway /onboarding and redirects', entry.status === 302 || entry.status === 307 || entry.status === 308)

  const uid = createdId
  await assertBlankOnboarding(admin, uid)
  check('the account starts from a blank onboarding slate', true)

  // Every screen must actually render (server-side), not just accept its API
  // call — a component reading a field the service never returns 500s here.
  const renders = async (step: string) => {
    const r = await req(`/onboarding/${step}`)
    return r.status === 200
  }
  check('exam screen renders', await renders('exam'))

  // --- Exam ----------------------------------------------------------------
  console.log('\nStep 1 · Exam')
  const { data: wins } = await admin.from('exam_windows').select('id, year, sitting, window_opens').order('window_opens', { ascending: true })
  const w27 = (wins ?? []).filter(w => w.year === 2027)
  const feb = w27[0], may = w27[1]
  const w28 = (wins ?? []).find(w => w.year === 2028)
  const month = (d: string) => String(d).slice(0, 7)

  const unsupported = await post('/api/onboarding/exam', { examWindowId: w28?.id, registered: false, timezone: 'Europe/London' })
  check('a sitting outside the active curriculum year is refused', unsupported.status === 400 && unsupported.body?.ok === false, JSON.stringify(unsupported.body))
  const fake = await post('/api/onboarding/exam', { examWindowId: '00000000-0000-4000-8000-000000000000', registered: false, timezone: 'Europe/London' })
  check('an unknown sitting id is refused', fake.status === 400, JSON.stringify(fake.body))
  const badTz = await post('/api/onboarding/exam', { examWindowId: feb.id, registered: false, timezone: 'Mars/Olympus' })
  check('an unknown timezone is refused', badTz.status === 400)
  const noDate = await post('/api/onboarding/exam', { examWindowId: feb.id, registered: true, timezone: 'Europe/London' })
  check('a registered candidate must give the exact date', noDate.status === 400 && !!noDate.body?.fields?.examDate, JSON.stringify(noDate.body))
  const wrongMonth = await post('/api/onboarding/exam', { examWindowId: feb.id, registered: true, examDate: `${month(may.window_opens)}-12`, timezone: 'Europe/London' })
  check('an exact date outside the chosen sitting is refused', wrongMonth.status === 400 && !!wrongMonth.body?.fields?.examDate, JSON.stringify(wrongMonth.body))

  const examRes = await post('/api/onboarding/exam', { examWindowId: feb.id, registered: true, examDate: `${month(feb.window_opens)}-20`, timezone: 'Europe/London' })
  check('a booked exam saves', examRes.body?.ok === true, JSON.stringify(examRes.body))
  const { data: prof1 } = await admin.from('profiles').select('*').eq('id', uid).single()
  check('the exact date and silently-detected timezone are stored', prof1?.exam_date === `${month(feb.window_opens)}-20` && prof1?.timezone === 'Europe/London')

  const unreg = await post('/api/onboarding/exam', { examWindowId: feb.id, registered: false, examDate: `${month(feb.window_opens)}-20`, timezone: 'Europe/London' })
  check('switching to not registered saves', unreg.body?.ok === true)
  const { data: prof1b } = await admin.from('profiles').select('exam_date, registered, exam_window_id').eq('id', uid).single()
  check('…and clears the old exact date, even if the client sent it', prof1b?.exam_date === null && prof1b?.registered === false && prof1b?.exam_window_id === feb.id, JSON.stringify(prof1b))

  // --- Route ---------------------------------------------------------------
  console.log('\nStep 2 · Study setup')
  check('the route screen renders once exam is saved', await renders('route'))
  const t = (weekdays: number[], startTime: string, endTime: string) => ({ label: '', weekdays, startTime, endTime, endsOn: null })
  const bad1 = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [t([2], '20:00', '18:00')] })
  check('a class that ends before it starts is refused', bad1.status === 400, JSON.stringify(bad1.body))
  const bad2 = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [t([2], '18:00', '20:00'), t([2], '19:00', '21:00')] })
  check('overlapping classes are refused', bad2.status === 400 && /overlap/i.test(JSON.stringify(bad2.body)), JSON.stringify(bad2.body))
  const bad3 = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [t([2], '18:00', '20:00'), t([2], '18:00', '20:00')] })
  check('duplicate classes are refused', bad3.status === 400 && /twice/i.test(JSON.stringify(bad3.body)), JSON.stringify(bad3.body))
  const bad4 = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [] })
  check('a fixed schedule with no classes is refused', bad4.status === 400)
  const bad5 = await post('/api/onboarding/route', { prepMode: 'self_study', classPattern: 'fixed', recurringClasses: [t([2], '18:00', '20:00')] })
  check('self-study cannot carry a class schedule', bad5.status === 400)

  // Atomicity: a failing replacement must leave the previous setup untouched.
  const good = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [t([2], '18:00', '20:00'), t([5], '18:00', '20:00')] })
  check('a valid fixed schedule saves', good.body?.ok === true, JSON.stringify(good.body))
  const classRows = async () => (await admin.from('calendar_commitments').select('weekdays').eq('user_id', uid).eq('kind', 'class').eq('status', 'active')).data ?? []
  check('both classes are active', (await classRows()).length === 2)
  const boom = await admin.rpc('onboarding_replace_route', { p_user: uid, p_prep_mode: 'hybrid', p_class_pattern: 'fixed',
    p_classes: [{ label: 'ok', weekdays: [1], start_time: '09:00', end_time: '10:00', ends_on: '' }, { label: 'broken', weekdays: [3], start_time: '15:00', end_time: '14:00', ends_on: '' }], p_next_class: null })
  check('a replacement that fails midway raises an error', !!boom.error, boom.error?.message ?? 'no error')
  const after = await classRows()
  const { data: profAfter } = await admin.from('profiles').select('prep_mode').eq('id', uid).single()
  check('…and the earlier classes are still active, nothing archived', after.length === 2 && JSON.stringify(after.flatMap(c => c.weekdays).sort()) === '[2,5]', JSON.stringify(after))
  check('…and the profile was not half-updated', profAfter?.prep_mode === 'instructor_led', profAfter?.prep_mode ?? '')

  const { data: pf } = await admin.from('profiles').select('diagnostic_day').eq('id', uid).single()
  check('the derived week-closing day follows the classes (earliest class Tue → closes Mon)', pf?.diagnostic_day === 1, String(pf?.diagnostic_day))

  const varNoClass = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'variable', recurringClasses: [], nextClass: null })
  check('variable classes may continue with no class known yet', varNoClass.body?.ok === true, JSON.stringify(varNoClass.body))
  const { data: pfv } = await admin.from('profiles').select('diagnostic_day').eq('id', uid).single()
  check('…and never define a cycle: it falls back to Sunday', pfv?.diagnostic_day === 0, String(pfv?.diagnostic_day))
  const varNext = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'variable', recurringClasses: [], nextClass: { label: '', date: '2027-01-12', startTime: '18:00', endTime: '20:00' } })
  check('an actual next class saves as a one-off', varNext.body?.ok === true, JSON.stringify(varNext.body))
  const { data: oneoff } = await admin.from('calendar_commitments').select('recurrence, kind').eq('user_id', uid).eq('status', 'active').eq('recurrence', 'none')
  check('…stored as a one-off class, not a series', oneoff?.length === 1 && oneoff[0].kind === 'class')

  // The one-off class must actually block placement on its own date, not just display on Calendar — a
  // one-off class carries an absolute UTC instant, not the weekday+HH:MM shape a weekly class uses, and the
  // planner's capacity function originally only matched the weekly shape.
  await admin.from('availability_windows').delete().eq('user_id', uid).eq('weekday', 2)
  await admin.from('availability_windows').insert({ user_id: uid, weekday: 2, start_time: '17:00', end_time: '21:00', source: 'onboarding', status: 'active' })
  const { dailyCapacityMinutes } = await import('../src/lib/planning/pulse/capacity')
  const cap = await dailyCapacityMinutes(uid, 2 as never, '2027-01-12', 'Europe/London')
  check('a one-off class subtracts its own time from that day\'s capacity (4h window − 2h class = 2h)', cap === 120, String(cap))

  // The anchor only ever applies when the class is close enough to matter (within ~2 weeks) — a far-future
  // date like 2027-01-12 above is deliberately left unanchored; this checks the near-term case does anchor.
  const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
  const todayIso = new Date().toISOString().slice(0, 10)
  await admin.from('calendar_commitments').delete().eq('user_id', uid).eq('kind', 'class')
  const { getStudyWeekContext } = await import('../src/lib/planning/schedule')
  // With no class defining the cycle, this is the week the student has. The near class below must differ from it, so pick a date
  // (3 to 10 days out) whose "day before" is NOT already this week's natural last day; otherwise "anchors" and "does not move"
  // cannot be told apart. (Fixed to the real local date; nothing else is assumed about the weekday the suite runs on.)
  const baseline = await getStudyWeekContext(uid)
  const nearDate = [3, 4, 5, 6, 7, 8, 9, 10].map(n => addDays(todayIso, n)).find(d => addDays(d, -1) !== baseline.week.endDate)!
  const varNear = await post('/api/onboarding/route', { prepMode: 'instructor_led', classPattern: 'variable', recurringClasses: [], nextClass: { label: '', date: nearDate, startTime: '18:00', endTime: '20:00' } })
  check('a near-term next class saves', varNear.body?.ok === true, JSON.stringify(varNear.body))
  const { data: nearRow } = await admin.from('calendar_commitments').select('defines_cycle').eq('user_id', uid).eq('status', 'active').eq('recurrence', 'none').single()
  check('it is marked as defining the cycle', nearRow?.defines_cycle === true, JSON.stringify(nearRow))
  const ctxNear = await getStudyWeekContext(uid)
  // Two separate facts. The class ANCHOR is a pure rule of the class date; first-cycle ADVANCEMENT is a separate decision about
  // a student with no cycle yet (it moves them one cycle on when this one has no study time left, e.g. late on a Sunday).
  const { resolvePulseWeek } = await import('../src/lib/planning/pulse/weekBoundary')
  const anchored = resolvePulseWeek({ classWeekdays: [], nextClassDate: nearDate, timezone: ctxNear.timezone, reference: todayIso })
  check('anchor: the rule puts the cycle end on the day before that class', anchored.endDate === addDays(nearDate, -1) && anchored.classLed, `${anchored.endDate} vs expected ${addDays(nearDate, -1)}`)
  const advanced = ctxNear.initialCycle?.advanced === true
  check('first cycle: the saved class produced that anchor, or exactly one cycle after it when the first cycle advanced',
    ctxNear.week.endDate === (advanced ? addDays(anchored.endDate, 7) : anchored.endDate), `${ctxNear.week.endDate}; advanced=${advanced}`)
  check('getStudyWeekContext reports this as class-led', ctxNear.classLed === true)

  // An ad-hoc class — the ordinary Calendar "Add commitment" path — must never anchor the week by accident.
  await admin.from('calendar_commitments').delete().eq('user_id', uid).eq('kind', 'class').eq('recurrence', 'none')
  // The Calendar route is an app API: it needs a completed setup, as it would for a real student.
  await admin.from('profiles').update({ onboarding_status: 'complete' }).eq('id', uid)
  const adhoc = await post('/api/commitments', { label: 'Doubt session', kind: 'class', recurrence: 'none', date: nearDate, startTime: '18:00', endTime: '20:00' })
  await admin.from('profiles').update({ onboarding_status: 'in_progress' }).eq('id', uid) // back to the journey's own state
  check('an ad-hoc one-off class can be added the ordinary way', adhoc.body?.ok === true, JSON.stringify(adhoc.body))
  check('…and is not marked as defining the cycle', adhoc.body?.commitment?.defines_cycle === false, JSON.stringify(adhoc.body?.commitment))
  const ctxAdhoc = await getStudyWeekContext(uid)
  check('…so it does not move the week boundary: the week is exactly the one the student had before adding it',
    ctxAdhoc.classLed === baseline.classLed && ctxAdhoc.week.startDate === baseline.week.startDate && ctxAdhoc.week.endDate === baseline.week.endDate,
    `${JSON.stringify(ctxAdhoc.week)} vs ${JSON.stringify(baseline.week)}`)
  check('…and that unchanged week really differs from the one an anchoring class would give', ctxAdhoc.week.endDate !== addDays(nearDate, -1))
  await admin.from('calendar_commitments').delete().eq('user_id', uid).eq('kind', 'class')

  const routeRes = await post('/api/onboarding/route', { prepMode: 'self_study', classPattern: 'none', recurringClasses: [] })
  check('switching to self-study saves', routeRes.body?.ok === true)
  check('…and archives the class rows this flow wrote', (await classRows()).length === 0)
  const { data: prof2 } = await admin.from('profiles').select('prep_mode, class_pattern, diagnostic_day').eq('id', uid).single()
  check('self-study: Monday-Saturday study, Sunday paper', prof2?.prep_mode === 'self_study' && prof2?.diagnostic_day === 0)

  // --- Position ------------------------------------------------------------
  console.log('\nStep 3 · Starting point')
  const oldStage = await post('/api/onboarding/position', { stage: 'studying', topicExposure: {} })
  check('a retired stage value is refused', oldStage.status === 400)
  const needTopics = await post('/api/onboarding/position', { stage: 'revising_or_mocks', topicExposure: {} })
  check('revision stage requires at least one topic', needTopics.status === 400 && /topic/i.test(JSON.stringify(needTopics.body)), JSON.stringify(needTopics.body))
  const retake = await post('/api/onboarding/position', { stage: 'retaking', topicExposure: {} })
  check('retaking requires at least one topic', retake.status === 400)
  const oldChip = await post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: { quant: 'stale' } })
  check('the retired "a while ago" status is refused', oldChip.status === 400)
  const fresh = await post('/api/onboarding/position', { stage: 'starting_fresh', topicExposure: {} })
  check('starting fresh needs no topics', fresh.body?.ok === true, JSON.stringify(fresh.body))

  const { data: topics } = await admin.from('topics').select('id').order('default_sequence')
  const tids = (topics ?? []).map(x => x.id as string)
  const posRes = await post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: { [tids[0]]: 'current', [tids[1]]: 'recent' } })
  check('stage and topic status save', posRes.body?.ok === true, JSON.stringify(posRes.body))
  const { data: prof3 } = await admin.from('profiles').select('stage').eq('id', uid).single()
  check('the stage is stored', prof3?.stage === 'first_pass_underway')

  const cov = async (topic: string) => (await admin.from('user_module_state').select('coverage_state, source, lm_id, learning_modules!inner(topic_id)').eq('user_id', uid).eq('learning_modules.topic_id', topic)).data ?? []
  const c0 = await cov(tids[0]), c1 = await cov(tids[1])
  check('the topic answers reach the roadmap: "working on now" becomes taught', c0.length > 0 && c0.every((r: any) => r.coverage_state === 'taught' && r.source === 'self_report'), JSON.stringify(c0.slice(0, 2)))
  check('"covered before" becomes studied', c1.length > 0 && c1.every((r: any) => r.coverage_state === 'studied' && r.source === 'self_report'))
  const { data: verifiedRows } = await admin.from('user_module_state').select('lm_id').eq('user_id', uid).eq('coverage_state', 'verified')
  check('onboarding never creates knowledge evidence (nothing verified)', (verifiedRows?.length ?? 0) === 0)
  const { data: evs } = await admin.from('evidence_events').select('id').eq('user_id', uid)
  check('…and writes no evidence events', (evs?.length ?? 0) === 0)

  // A verified module must survive a later self-report.
  const someMod = c0[0]?.lm_id as string
  await admin.from('user_module_state').update({ coverage_state: 'verified', source: 'diagnostic' }).eq('user_id', uid).eq('lm_id', someMod)
  await post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: { [tids[0]]: 'recent' } })
  const kept = (await admin.from('user_module_state').select('coverage_state').eq('user_id', uid).eq('lm_id', someMod).single()).data
  check('a self-report never overwrites a verified module', kept?.coverage_state === 'verified', JSON.stringify(kept))
  await admin.from('user_module_state').delete().eq('user_id', uid).eq('lm_id', someMod)
  const unticked = await post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: { [tids[2]]: 'current' } })
  check('re-saving replaces the earlier answers', unticked.body?.ok === true && (await cov(tids[0])).length === 0 && (await cov(tids[2])).length > 0)

  // --- Week ----------------------------------------------------------------
  console.log('\nStep 4 · Real week')
  const w = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime })
  const noneSel = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [], maxSessionMinutes: 45 })
  check('"windows" with none chosen is refused', noneSel.status === 400)
  const endBefore = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(1, '21:00', '18:00')], maxSessionMinutes: 45 })
  check('a window that ends before it starts is refused', endBefore.status === 400)
  const dupWin = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(1, '18:00', '21:00'), w(1, '18:00', '21:00')], maxSessionMinutes: 45 })
  check('duplicate windows are refused', dupWin.status === 400 && /twice/i.test(JSON.stringify(dupWin.body)))
  const overWin = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(1, '18:00', '21:00'), w(1, '20:00', '22:00')], maxSessionMinutes: 45 })
  check('overlapping windows are refused', overWin.status === 400 && /overlap/i.test(JSON.stringify(overWin.body)))
  const badLen = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(1, '18:00', '21:00')], maxSessionMinutes: 50 })
  check('only the offered sitting lengths are accepted', badLen.status === 400)
  const mixed = await post('/api/onboarding/week', { availabilityMode: 'varies', windows: [w(1, '18:00', '21:00')], maxSessionMinutes: 45 })
  check('"my schedule changes" cannot also carry windows', mixed.status === 400)

  const weekRes = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(6, '09:00', '12:00'), w(0, '10:00', '14:00')], commitments: [], maxSessionMinutes: 45 })
  check('study windows save with no fixed commitments at all', weekRes.body?.ok === true, JSON.stringify(weekRes.body))
  const { data: avails } = await admin.from('availability_windows').select('*').eq('user_id', uid).eq('status', 'active')
  check('the windows are stored, and no label or category was required', avails?.length === 2, JSON.stringify(avails))
  const { data: comms } = await admin.from('calendar_commitments').select('id').eq('user_id', uid).eq('status', 'active').eq('source', 'onboarding')
  check('no fixed commitments were invented', (comms?.length ?? 0) === 0)

  const wBoom = await admin.rpc('onboarding_replace_week', { p_user: uid, p_max_session: 30, p_mode: 'windows',
    p_windows: [w(1, '18:00', '21:00'), { weekday: 2, start_time: '21:00', end_time: '18:00' }].map(x => 'startTime' in x ? { weekday: x.weekday, start_time: x.startTime, end_time: x.endTime } : x), p_commitments: [] })
  check('a week replacement that fails midway raises an error', !!wBoom.error, wBoom.error?.message ?? 'no error')
  const { data: avails2 } = await admin.from('availability_windows').select('weekday').eq('user_id', uid).eq('status', 'active')
  const { data: pw } = await admin.from('profiles').select('max_session_minutes').eq('id', uid).single()
  check('…and the earlier windows and sitting length are untouched', avails2?.length === 2 && pw?.max_session_minutes === 45, JSON.stringify({ avails2, pw }))

  const withFixed = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(6, '09:00', '12:00')], commitments: [{ weekdays: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:30' }], maxSessionMinutes: 45 })
  check('an optional fixed commitment saves without a name', withFixed.body?.ok === true, JSON.stringify(withFixed.body))
  const noWin = await post('/api/onboarding/week', { availabilityMode: 'none_this_week', windows: [], maxSessionMinutes: 45 })
  check('"I cannot schedule study this week" is a valid answer', noWin.body?.ok === true, JSON.stringify(noWin.body))
  const st = (await json('/api/onboarding/state')).body?.data
  check('…and setup still counts the week step as complete', st?.completed?.week === true && st?.firstIncompleteStep === 'plan', JSON.stringify(st?.completed))
  const restore = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [w(6, '09:00', '12:00'), w(0, '10:00', '14:00')], commitments: [], maxSessionMinutes: 45 })
  check('windows can be given again afterwards', restore.body?.ok === true)
  check('a student still completing onboarding gets no impact report (nothing committed yet to have an impact on)', restore.body?.impact === null || restore.body?.impact === undefined, JSON.stringify(restore.body?.impact))

  // --- Routes --------------------------------------------------------------
  console.log('\nRoutes')
  check('the plan screen renders once all four steps are saved', await renders('plan'))
  const cp = await req('/onboarding/checkpoint')
  check('/onboarding/checkpoint permanently redirects to the review screen', cp.status === 308 && (cp.headers.get('location') ?? '').endsWith('/onboarding/plan'), `${cp.status} → ${cp.headers.get('location')}`)
  const cpApi = await post('/api/onboarding/checkpoint', {})
  check('the checkpoint API is retired', cpApi.status === 404, String(cpApi.status))
  const stateApi = await json('/api/onboarding/state')
  check('GET /api/onboarding/state returns the single completion model', stateApi.body?.ok === true && !!stateApi.body?.data?.completed && !('checkpoint' in stateApi.body.data.completed))
  const badReturn = await req('/onboarding/exam?returnTo=https://evil.example')
  check('an off-list returnTo is ignored', badReturn.status === 200)

  // --- S6 Plan Preview -----------------------------------------------------
  console.log('\nStep 5 · Review and activate')
  const previewRes = await post('/api/onboarding/plan/preview', {})
  check('preview generated', previewRes.body?.ok === true && !!previewRes.body?.data?.draftId, JSON.stringify(previewRes.body))

  const draftId = previewRes.body?.data?.draftId
  const draftRev = previewRes.body?.data?.revision

  // --- S7 Plan Confirm -----------------------------------------------------
  console.log('\nConfirm')

  const confirmRes = await post('/api/onboarding/plan/confirm', {
    draftId, expectedRevision: draftRev
  })
  check('plan confirmed successfully', confirmRes.body?.ok === true, JSON.stringify(confirmRes.body))

  const { data: activeRoadmap } = await admin.from('study_roadmaps').select('*').eq('user_id', uid).eq('status', 'active')
  check('active roadmap created', activeRoadmap?.length === 1)

  const { data: prof4 } = await admin.from('profiles').select('onboarding_status').eq('id', uid).single()
  check('onboarding_status set to complete', prof4?.onboarding_status === 'complete')

  // Editing setup afterwards must never rewrite accepted history.
  console.log('\nEditing after activation')
  const snap = async () => ({
    blocks: JSON.stringify(((await admin.from('plan_blocks').select('id, revision, local_date, starts_at').eq('user_id', uid).order('id').throwOnError()).data ?? [])),
    cycles: JSON.stringify(((await admin.from('planning_cycles').select('id, status, starts_at_local, ends_at_local, timezone').eq('user_id', uid).order('id').throwOnError()).data ?? [])),
    roadmap: JSON.stringify(((await admin.from('study_roadmaps').select('id, status').eq('user_id', uid).order('id').throwOnError()).data ?? [])),
  })
  const beforeEdit = await snap()
  const setupVersion = async () => Number((await admin.from('profiles').select('onboarding_context_version').eq('id', uid).single().throwOnError()).data!.onboarding_context_version)
  const edit = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [{ weekday: 3, startTime: '19:00', endTime: '21:00' }], maxSessionMinutes: 60, expectedVersion: await setupVersion() })
  check('a completed student can edit the week', edit.body?.ok === true, JSON.stringify(edit.body))
  const afterEdit = await snap()
  check('…and the accepted blocks, cycle and roadmap are unchanged', beforeEdit.blocks === afterEdit.blocks && beforeEdit.cycles === afterEdit.cycles && beforeEdit.roadmap === afterEdit.roadmap)
  const { data: prof5 } = await admin.from('profiles').select('onboarding_status').eq('id', uid).single()
  check('…and onboarding stays complete', prof5?.onboarding_status === 'complete')

  // The future-plan impact proposal: real numbers from before/after the write, never a rewrite of the plan.
  console.log('\nFuture-plan impact proposal')
  check('a shrunk week reports how much study time it costs', edit.body?.impact && typeof edit.body.impact.capacityDeltaMinutes === 'number' && edit.body.impact.capacityDeltaMinutes < 0, JSON.stringify(edit.body?.impact))
  check('…and no cycle change for a same-route edit', edit.body?.impact?.cycleChanged === false)
  const noop = await post('/api/onboarding/week', { availabilityMode: 'windows', windows: [{ weekday: 3, startTime: '19:00', endTime: '21:00' }], maxSessionMinutes: 60, expectedVersion: await setupVersion() })
  // Zero net change in capacity — overflowDays can still be non-empty if a day was already tight (that is
  // real and pre-existing, not caused by this edit); the invariant a true no-op guarantees is zero delta.
  check('an edit that changes nothing reports zero capacity delta', noop.body?.impact?.capacityDeltaMinutes === 0, JSON.stringify(noop.body?.impact))

  console.log('\nProfile edits stay explicit and preserve omitted context')
  const beforeProfile = (await admin.from('profiles').select('prep_mode,class_pattern,classes_completed_at').eq('id', uid).single().throwOnError()).data!
  const invalidClassResponses: Awaited<ReturnType<typeof post>>[] = []
  for (const body of [null, {}, { done: 'false' }]) invalidClassResponses.push(await post('/api/profile/classes-completed', body))
  check('invalid class-completion bodies are refused rather than interpreted as completed', invalidClassResponses.every(r => r.status === 400))
  const afterInvalid = (await admin.from('profiles').select('classes_completed_at').eq('id', uid).single().throwOnError()).data!
  check('invalid bodies leave class completion untouched', afterInvalid.classes_completed_at === beforeProfile.classes_completed_at)
  const savedProfile = await json('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Onboarding fixture' }) })
  check('the guarded profile route persists its name through the planning command', savedProfile.status === 200 && savedProfile.body.ok)
  const retiredTry = await json('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'x', maxSessionMinutes: 20 }) })
  check('planning fields are explicitly refused here (retired), changing nothing', retiredTry.status === 400 && retiredTry.body.code === 'RETIRED_FIELD' && (await admin.from('profiles').select('display_name,max_session_minutes').eq('id', uid).single().throwOnError()).data!.display_name === 'Onboarding fixture')
  const afterProfile = (await admin.from('profiles').select('display_name,max_session_minutes,prep_mode,class_pattern').eq('id', uid).single().throwOnError()).data!
  check('profile edits keep omitted preparation context', afterProfile.display_name === 'Onboarding fixture' && afterProfile.prep_mode === beforeProfile.prep_mode && afterProfile.class_pattern === beforeProfile.class_pattern)

  finish()
}

async function finish() {
  if (createdId) await admin.auth.admin.deleteUser(createdId).catch(() => {})
  console.log(`\nDeleted the throwaway student.\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(async e => { console.error('\nCrashed:', e); failed++; await finish() })
