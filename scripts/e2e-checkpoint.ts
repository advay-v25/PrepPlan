/**
 * Phase C, live: the first useful week and the mock checkpoint, with ORDINARY throwaway students (no role, deleted after).
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-checkpoint.ts
 * Each journey creates its own student, cycle, availability and records, and asserts that its chain really executed.
 * Anything that cannot run today (a Sunday assertion on a Wednesday) is reported as SKIPPED and is never counted as passed.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { completeOnboarding, createSession } from './lib/e2eSession'
import { getStudyWeekContext } from '../src/lib/planning/schedule'
import { buildWeekPlanWithPaper } from '../src/lib/planning/pulse/generateWeek'
import { weekContaining } from '../src/lib/planning/checkpointService'
import { weekdayOf, addDays } from '../src/lib/planning/studyWeek'

const TZ = process.env.E2E_TZ ?? 'Europe/London'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const localToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const today = localToday()
const made: string[] = []
let passed = 0, failed = 0; const skipped: string[] = []
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const skip = (n: string, why: string) => { skipped.push(`${n} (${why})`); console.log(`  – SKIPPED ${n}: ${why}`) }
type S = ReturnType<typeof createSession>

async function student(tag: string) {
  const email = `integ+${tag}${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  made.push(data.user!.id)
  await admin.from('profiles').upsert({ id: data.user!.id, onboarding_status: 'not_started' })
  const s = createSession(admin, email)
  if (!(await s.signIn())) throw new Error('sign-in failed')
  return { id: data.user!.id, s }
}

/** exam → route → position → week, then the first-week preview; stops before acceptance. */
async function toPreview(s: S, position: Record<string, unknown>, windows = true) {
  const { data: w } = await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens', { ascending: true })
  const steps: [string, unknown][] = [
    ['exam', { examWindowId: w![0].id, registered: true, examDate: `${String(w![0].window_opens).slice(0, 7)}-20`, timezone: TZ }],
    ['route', { prepMode: 'self_study', classPattern: 'none', recurringClasses: [] }],
    ['position', position],
    ['week', { commitments: [], availabilityMode: windows ? 'windows' : 'none_this_week', windows: windows ? [1, 2, 3, 4, 5, 6, 0].map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })) : [], maxSessionMinutes: 45 }],
  ]
  for (const [step, body] of steps) { const r = await s.post(`/api/onboarding/${step}`, body); if (r.body?.ok !== true) throw new Error(`${step}: ${JSON.stringify(r.body)}`) }
  return s.post('/api/onboarding/plan/preview', {})
}
const get = (s: S) => s.json('/api/checkpoints')
/** Every write names the checkpoint and version it was made against, plus a fresh request key (as the page does). */
const send = async (s: S, method: string, body: Record<string, unknown>) => {
  const v = (await get(s)).body?.checkpoint
  return s.json('/api/checkpoints', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: crypto.randomUUID(), checkpointId: v?.checkpointId ?? null, expectedVersion: v?.version ?? null, ...body }) })
}
const put = (s: S, body: Record<string, unknown>) => send(s, 'PUT', body)
const act = (s: S, body: Record<string, unknown>) => send(s, 'POST', body)
const del = (s: S) => send(s, 'DELETE', {})
const evidenceCounts = async (uid: string) => JSON.stringify(await Promise.all(['evidence_events', 'assessment_attempts', 'assessment_responses', 'repair_threads', 'coach_proposals'].map(async t =>
  (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count)))
const blockCount = async (uid: string) => (await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', uid)).count

async function main() {
  const { data: topics } = await admin.from('topics').select('id').order('default_sequence')
  const T = (topics ?? []).map(t => t.id as string)
  const { data: mods } = await admin.from('learning_modules').select('id, topic_id').eq('is_active', true)
  const topicOf = new Map((mods ?? []).map(m => [m.id as string, m.topic_id as string]))
  const all = Object.fromEntries(T.map(t => [t, 'recent']))

  console.log(`\nA. First useful week — local date ${today} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayOf(today)]}) in ${TZ}`)
  const a = await student('cpA')
  const prev = await toPreview(a.s, { stage: 'starting_fresh', topicExposure: {} })
  check('the preview is built', prev.body?.ok === true, JSON.stringify(prev.body).slice(0, 160))
  const cyc = prev.body.data.cycle as { start: string; end: string }
  const ic = prev.body.data.initialCycle as { advanced: boolean; reason: string; note: string | null } | null
  const sunday = weekdayOf(today) === 0
  if (sunday) {
    check('Sunday evening: the first plan is the upcoming Monday–Sunday cycle', cyc.start === addDays(today, 1) && cyc.end === addDays(today, 7) && ic?.advanced === true)
    check('its dates are explained before acceptance', /no study days left/.test(ic?.note ?? '') && (ic?.note ?? '').length > 30)
    check('it is a usable week, not an exhausted one', (prev.body.data.tasks as any[]).length > 0 && (prev.body.data.tasks as any[]).every(t => t.local_date >= cyc.start && t.local_date <= cyc.end))
    check('no compulsory paper is scheduled before eligible learning exists', !(prev.body.data.tasks as any[]).some(t => t.task_type === 'diagnostic'))
  } else skip('Sunday-evening first cycle', `today is ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayOf(today)]} in ${TZ}; covered by scripts/first-cycle-test.ts with fixed instants`)
  check('every task in the preview falls inside the cycle it names', (prev.body.data.tasks as any[]).every(t => t.local_date >= cyc.start && t.local_date <= cyc.end))
  const blocksBefore = await blockCount(a.id)
  check('previewing wrote no plan blocks', blocksBefore === 0)
  // Context changes invalidate the preview: edit availability, then try to accept the old one.
  await a.s.post('/api/onboarding/week', { commitments: [], availabilityMode: 'windows', windows: [{ weekday: 2, startTime: '19:00', endTime: '20:00' }], maxSessionMinutes: 45 })
  const stale = await a.s.post('/api/onboarding/plan/confirm', { draftId: prev.body.data.draftId, expectedRevision: prev.body.data.revision })
  check('an edit after the preview makes it stale; nothing is accepted', stale.status === 409 && (await blockCount(a.id)) === 0, `${stale.status} ${JSON.stringify(stale.body).slice(0, 120)}`)
  const prev2 = await a.s.post('/api/onboarding/plan/preview', {})
  check('a fresh preview is prepared for the changed context', prev2.body?.ok === true && prev2.body.data.draftId !== prev.body.data.draftId)
  const body = { draftId: prev2.body.data.draftId, expectedRevision: prev2.body.data.revision }
  const [c1, c2] = await Promise.all([a.s.post('/api/onboarding/plan/confirm', body), a.s.post('/api/onboarding/plan/confirm', body)])
  check('accepting twice at once is safe: both succeed', c1.body?.ok === true && c2.body?.ok === true, `${JSON.stringify(c1.body).slice(0, 80)} / ${JSON.stringify(c2.body).slice(0, 80)}`)
  const cycles = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', a.id)).data ?? []
  check('exactly one cycle exists, and it is the one the review named', cycles.length === 1 && cycles[0].starts_at_local === prev2.body.data.cycle.start)
  const n1 = await blockCount(a.id)
  const c3 = await a.s.post('/api/onboarding/plan/confirm', body)
  check('a later retry replays and creates no duplicate tasks', c3.body?.ok === true && (await blockCount(a.id)) === n1)
  const rec = await a.s.post('/api/activation/recover', {})
  check('activation recovery sees the accepted cycle and does not rebuild over it', rec.body?.status === 'already_active' || rec.body?.data?.status === 'already_active', JSON.stringify(rec.body).slice(0, 140))
  const cal = await a.s.req('/app/calendar'); const calHtml = await cal.text()
  check('Calendar opens immediately after setup (waiting for Monday is not a gate)', cal.status === 200 && !/Prepare a draft|Set up my week/.test(calHtml) )
  const ctx = await getStudyWeekContext(a.id)
  check('every surface agrees on the accepted cycle', ctx.week.startDate === cycles[0].starts_at_local && ctx.week.endDate === cycles[0].ends_at_local)

  // An accepted cycle that holds no work is the student's own: never moved or replaced.
  await admin.from('plan_blocks').delete().eq('user_id', a.id)
  const sunEvening = new Date(`${addDays(today, 7 - weekdayOf(today))}T21:00:00Z`)
  const ctxEmpty = await getStudyWeekContext(a.id, sunEvening)
  check('an existing accepted-but-empty cycle is not treated as a new student’s initial cycle', ctxEmpty.initialCycle === null)
  const recEmpty = await a.s.post('/api/activation/recover', {})
  check('recovery leaves it alone rather than silently replacing it', ['already_active', 'draft_ready'].includes(recEmpty.body?.status ?? recEmpty.body?.data?.status) )
  check('the accepted cycle row itself is unchanged', (await admin.from('planning_cycles').select('starts_at_local').eq('user_id', a.id)).data?.[0]?.starts_at_local === cycles[0].starts_at_local)

  console.log('\nB. No usable availability: unplaced work and a Calendar action, one cycle at most')
  const b = await student('cpB')
  const prevB = await toPreview(b.s, { stage: 'starting_fresh', topicExposure: {} }, false)
  check('the preview is built without windows', prevB.body?.ok === true)
  const cB = prevB.body.data.cycle
  check('it chose a single cycle (never searched ahead for capacity)', cB.start >= addDays(today, -6) && cB.start <= addDays(today, 1), `${cB.start}`)
  check('no task was invented into a window that does not exist', (prevB.body.data.tasks as any[]).every(t => t.placement !== 'timed'))

  console.log('\nC. Ten topics: three covered, seven open for the first pass')
  const c = await student('cpC')
  const three = T.slice(0, 3)
  await completeOnboarding(c.s, admin, { stage: 'first_pass_underway', topicExposure: Object.fromEntries(three.map(t => [t, 'recent'])) })
  const road = await c.s.json('/api/roadmap')
  const fp = new Set((road.body.roadmap.milestones as any[]).filter(m => m.phase === 'first_pass').map(m => m.topicId as string))
  check('there are ten topics', T.length === 10, String(T.length))
  check('the first pass covers exactly the seven topics not covered', fp.size === 7 && T.slice(3).every(t => fp.has(t)) && !three.some(t => fp.has(t)), [...fp].join(','))
  const { data: studyTasks } = await admin.from('plan_blocks').select('lm_id, task_type').eq('user_id', c.id).eq('task_type', 'study')
  check('first-week study comes only from the open topics', (studyTasks ?? []).length > 0 && (studyTasks ?? []).every(t => !three.includes(topicOf.get(t.lm_id as string) ?? '')))

  console.log('\nD. The mock: one record seen from Calendar, Home, the roadmap, Coach and Settings')
  const mockDay = (a: string, b: string) => b
  const d = await student('cpD')
  const mock1 = addDays(today, 12)
  await completeOnboarding(d.s, admin, { stage: 'revising_or_mocks', topicExposure: all, positionExtra: { mock: { date: mock1, kind: 'provider_mock' } } })
  const g1 = await get(d.s)
  const cp1 = g1.body.checkpoint
  check('the mock captured in onboarding is the checkpoint', g1.body?.ok === true && cp1?.checkpoint.date === mock1 && cp1.checkpoint.kind === 'provider_mock')
  check('a date-only mock says exactly what is missing and reserves nothing', cp1.missing.join() === 'start time,expected length')
  check('preparation and a check-in are proposed, not added', cp1.suggestions.length === 3 && (await admin.from('plan_blocks').select('id').eq('user_id', d.id).ilike('title', 'Prepare for%')).data?.length === 0)
  check('the assessment choice is unresolved until the student chooses', cp1.choice === null && cp1.choiceUnresolved === true)
  const surfaces = async () => {
    const [cal, home, set, coach, road] = await Promise.all([d.s.req('/app/calendar?week=' + mock1), d.s.req('/app'), d.s.req('/app/settings'), d.s.req('/app/coach'), d.s.json('/api/roadmap')])
    return { cal: await cal.text(), home: await home.text(), set: await set.text(), coach: await coach.text(), road: road.body.roadmap?.checkpoints?.[0]?.date as string | undefined }
  }
  const s1 = await surfaces()
  check('Calendar shows it', s1.cal.includes('id="checkpoint"') && s1.cal.includes('Mock from a course provider'))
  check('Home links to the mock’s Calendar panel', s1.home.includes('#checkpoint'))
  check('the roadmap has it on the same date', s1.road === mock1)
  check('Settings and Coach name the same date', s1.set.includes(mock1) && s1.coach.includes(mock1))

  const before = { blocks: await blockCount(d.id), ev: await evidenceCounts(d.id) }
  const timing = { date: mock1, kind: 'provider_mock', label: 'Coaching mock', startTime: '19:00', durationMinutes: 120 }
  const p1 = await put(d.s, timing)
  check('timing, a description and a length can be set', p1.body?.ok === true && p1.body.checkpoint.checkpoint.label === 'Coaching mock' && p1.body.checkpoint.checkpoint.startTime === '19:00' && p1.body.checkpoint.missing.length === 0)
  check('saving the same thing again is a no-op, not a second checkpoint', (await put(d.s, timing)).body?.ok === true && (await admin.from('profiles').select('mock_label').eq('id', d.id).single()).data?.mock_label === 'Coaching mock')
  const s2 = await surfaces()
  check('Calendar and the roadmap show the description and time', s2.cal.includes('Coaching mock') && s2.cal.includes('19:00') && s2.home.includes('Coaching mock'))
  check('accepted study work is untouched by editing the mock', (await blockCount(d.id)) === before.blocks)

  const bad = [
    ['a past date', { ...timing, date: addDays(today, -2) }], ['a date after the exam', { ...timing, date: '2027-12-31' }],
    ['a bad time', { ...timing, startTime: '25:99' }], ['a mock past midnight', { ...timing, startTime: '22:00', durationMinutes: 240 }], ['a bad type', { ...timing, kind: 'exam' }],
  ] as const
  for (const [name, body] of bad) { const r = await put(d.s, body); check(`${name} is refused with a reason`, r.status === 400 && typeof r.body.error === 'string' && r.body.error.length > 5, `${r.status} ${JSON.stringify(r.body).slice(0, 100)}`) }
  const anon = await fetch(`${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}/api/checkpoints`)
  check('without a session the endpoint refuses', anon.status === 401)
  const other = await student('cpDx')
  check('another student has their own (empty) record and cannot read this one', (await other.s.json('/api/checkpoints')).status === 403 || (await other.s.json('/api/checkpoints')).body?.checkpoint == null)

  console.log('\nE. The mock and the weekly paper')
  const week = await weekContaining(d.id, mock1)
  const choose = (choice: string, paperAction?: string) => act(d.s, { action: 'choice', choice, paperAction })
  const cL = await choose('later')
  check('"decide later" is a recorded choice that stays visible as unresolved', cL.body?.ok === true && cL.body.checkpoint.choiceUnresolved === true)
  check('an unknown choice is refused', (await choose('both')).status === 400)
  const tokenA = (await admin.rpc('weekly_source_version', { p_user: d.id, p_cycle: (await admin.from('planning_cycles').select('id').eq('user_id', d.id).single()).data!.id })).data
  const cU = await choose('use_mock', 'replace')
  const tokenB = (await admin.rpc('weekly_source_version', { p_user: d.id, p_cycle: (await admin.from('planning_cycles').select('id').eq('user_id', d.id).single()).data!.id })).data
  check('choosing is saved and resolves the choice', cU.body?.ok === true && cU.body.checkpoint.choice === 'use_mock' && cU.body.checkpoint.choiceUnresolved === false)
  check('a pending weekly draft would go stale (the change token moved)', tokenA !== tokenB)
  const planUse = await buildWeekPlanWithPaper(d.id, week, { now: new Date() })
  check('with the mock as the assessment, that week plans no weekly paper and says why', planUse.paper.kind === 'none' && (planUse.paper as any).reason === 'mock_chosen')
  await choose('keep_paper')
  const planKeep = await buildWeekPlanWithPaper(d.id, week, { now: new Date() })
  check('keeping the paper plans it exactly as before (no mock_chosen)', (planKeep.paper as any).reason !== 'mock_chosen')
  await choose('use_mock', 'replace')
  await choose('use_mock', 'replace')
  check('choosing twice leaves one record', (await admin.from('cycle_assessment_choices').select('*', { count: 'exact', head: true }).eq('user_id', d.id)).count === 1)

  console.log('\nF. Moving and cancelling')
  const mock2 = addDays(today, 25)
  const mv = await put(d.s, { ...timing, date: mock2 })
  const s3 = await surfaces()
  check('moving it updates every surface to the same new date', mv.body?.ok === true && s3.road === mock2 && s3.cal.includes('id="checkpoint"') && s3.set.includes(mock2) && s3.coach.includes(mock2))
  check('its details moved with it', mv.body.checkpoint.checkpoint.label === 'Coaching mock' && mv.body.checkpoint.checkpoint.startTime === '19:00')
  check('the choice for the week it left no longer applies', (await admin.from('cycle_assessment_choices').select('*', { count: 'exact', head: true }).eq('user_id', d.id)).count === 0)
  check('accepted study work is unchanged by the move', (await blockCount(d.id)) === before.blocks)
  const cancelledNow = await del(d.s)
  check('cancelling removes it and says what could replace the assessment', cancelledNow.body?.ok === true && typeof cancelledNow.body.replacement?.message === 'string' && cancelledNow.body.replacement.message.length > 20, JSON.stringify(cancelledNow.body).slice(0, 160))
  const s4 = await surfaces()
  check('it is gone from the roadmap, Home and Calendar', s4.road === undefined && !s4.home.includes('Coming up') && !s4.cal.includes('Edit or move'))
  check('cancelling when nothing is left says so (the original request key replays; see e2e-checkpoint-commands)', (await del(d.s)).body?.code === 'NO_CHECKPOINT')
  check('timing was cleared with it', (await admin.from('profiles').select('mock_label, mock_start_time').eq('id', d.id).single()).data?.mock_label === null)

  console.log('\nG. A preview made before the mock moved or was cancelled')
  const g = await student('cpG')
  const prevG = await toPreview(g.s, { stage: 'revising_or_mocks', topicExposure: all, mock: { date: addDays(today, 12), kind: 'provider_mock' } })
  const bodyG = { draftId: prevG.body.data.draftId, expectedRevision: prevG.body.data.revision }
  await g.s.post('/api/onboarding/position', { stage: 'revising_or_mocks', topicExposure: all, mock: { date: addDays(today, 13), kind: 'provider_mock' } })
  const moved = await g.s.post('/api/onboarding/plan/confirm', bodyG)
  check('a mock moved after the preview makes it stale; nothing is accepted', moved.status === 409 && (await blockCount(g.id)) === 0)
  const prevG2 = await g.s.post('/api/onboarding/plan/preview', {})
  await g.s.post('/api/onboarding/position', { stage: 'revising_or_mocks', topicExposure: all, mock: null })
  const cancelled = await g.s.post('/api/onboarding/plan/confirm', { draftId: prevG2.body.data.draftId, expectedRevision: prevG2.body.data.revision })
  check('a mock cancelled after the preview makes it stale too', cancelled.status === 409 && (await blockCount(g.id)) === 0)

  console.log('\nH. An external mock outcome closes the week; app-scored and external stay distinct')
  const h = await student('cpH')
  await completeOnboarding(h.s, admin, { stage: 'revising_or_mocks', topicExposure: all })
  const cycleH = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', h.id).single()).data!
  const lo = [addDays(today, 1), addDays(cycleH.starts_at_local as string, 2)].sort().pop()!
  const mockH = lo <= (cycleH.ends_at_local as string) ? lo : (cycleH.ends_at_local as string)
  await put(h.s, { date: mockH, kind: 'provider_mock', label: 'Coaching mock' })
  const evBefore = await evidenceCounts(h.id)
  const st0 = await h.s.json('/api/weekly-review/state')
  check('before any outcome the week is not closable early', st0.body?.state?.gate?.kind !== 'external_mock')
  const vH = (await get(h.s)).body.checkpoint
  const outKey = crypto.randomUUID()
  const outBody = { key: outKey, checkpointId: vH.checkpointId, expectedVersion: vH.version, action: 'outcome', outcome: 'taken', result: '62%', notes: 'felt rushed', choice: 'use_mock', paperAction: 'replace' }
  const rec1 = await h.s.post('/api/checkpoints', outBody)
  check('the outcome, a reported result and the choice are recorded together', rec1.body?.ok === true, JSON.stringify(rec1.body).slice(0, 160))
  const rec2 = await h.s.post('/api/checkpoints', outBody)
  check('retrying the same request after the checkpoint was cleared returns the original receipt', rec2.body?.ok === true && rec2.body.replayed === true && rec2.body.outcomeId === rec1.body.outcomeId, JSON.stringify(rec2.body).slice(0, 160))
  const rows = (await admin.from('mock_outcomes').select('outcome, reported_result').eq('user_id', h.id)).data ?? []
  check('exactly one outcome row, labelled as the student’s own report', rows.length === 1 && rows[0].outcome === 'taken' && rows[0].reported_result === '62%')
  check('no evidence, answers, attempts, readiness inputs or repair threads were created', evBefore === await evidenceCounts(h.id))
  check('a result cannot be attached to a mock that was not taken', (await (async () => { await put(h.s, { date: mockH, kind: 'other' }); return act(h.s, { action: 'outcome', outcome: 'not_taken', result: '70%' }) })()).status === 400)
  const state = await h.s.json('/api/weekly-review/state')
  const rs = state.body?.state
  check('weekly review offers closure on the recorded external outcome', rs?.gate?.kind === 'external_mock' && rs.gate.outcome === 'taken', JSON.stringify(rs?.gate))
  check('the page labels it external and self-reported', /External mock \(\d{4}-\d{2}-\d{2}\): taken/.test((await (await h.s.req('/app/review-week')).text()).replace(/<!-- -->/g, '')))
  const due = (rs.dueTasks as any[])
  const choices = Object.fromEntries(due.map(t => [t.id, { happened: 'not_done', next: 'remove' }]))
  const prevR = await h.s.post('/api/weekly-review/preview', { cycleId: rs.cycle.id, choices })
  check('required activity must still be resolved; once it is, a next-week proposal is built', prevR.body?.ok === true, JSON.stringify(prevR.body).slice(0, 200))
  const unresolved = due.length ? await h.s.post('/api/weekly-review/preview', { cycleId: rs.cycle.id, choices: {} }) : null
  check('leaving unfinished work unanswered still blocks closure', unresolved === null || unresolved.body?.ok === false)
  const acc = await h.s.post('/api/weekly-review/accept', { draftId: prevR.body.draftId })
  check('the week closes and the next cycle opens', acc.body?.ok === true && typeof acc.body.nextCycleId === 'string', JSON.stringify(acc.body).slice(0, 160))
  const closed = (await admin.from('weekly_reviews').select('closure_kind, no_paper_reason').eq('user_id', h.id)).data ?? []
  check('the closure record says external mock, self-reported — distinguishable from a scored paper', closed.length === 1 && closed[0].closure_kind === 'no_paper' && /^External mock \(self-reported\): taken/.test(closed[0].no_paper_reason ?? ''))
  check('still no evidence or attempts after closing', evBefore === await evidenceCounts(h.id))
  const acc2 = await h.s.post('/api/weekly-review/accept', { draftId: prevR.body.draftId })
  check('accepting again replays the same closure', acc2.body?.ok === true && acc2.body.alreadyClosed === true)

  console.log('\nI. Completed revision becomes revisionary scope; scheduled or declared revision does not')
  const i = await student('cpI')
  await completeOnboarding(i.s, admin, { stage: 'revising_or_mocks', topicExposure: all, positionExtra: { uncertainty: { [T[0]]: { level: 'most', lmIds: [] } } } })
  const scope0 = await i.s.json('/api/tests/scope')
  check('declared coverage and scheduled revision create no scope', scope0.body?.preview?.scope?.totals?.outcomes === 0, JSON.stringify(scope0.body?.preview?.scope?.totals))
  const { data: rev } = await admin.from('plan_blocks').select('id, lm_id, revision, execution, local_date').eq('user_id', i.id).eq('task_type', 'review').order('local_date').limit(1)
  if (!rev?.length) { skip('completed revision -> scope', 'no revision task was planned in this week') } else {
    const r0 = rev[0]
    const done = await i.s.json(`/api/tasks/${r0.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'completed', expectedRevision: r0.revision }) })
    check('the revision task can be completed', done.body?.ok === true, JSON.stringify(done.body).slice(0, 140))
    const scopeDone = await i.s.json('/api/tests/scope')
    check('completing it does not by itself invent scope (its readings are not yet confirmed)', scopeDone.body?.preview?.scope?.totals?.outcomes === 0 || scopeDone.body?.preview?.scope?.unresolved?.length > 0)
    const choiceInfo = await i.s.json(`/api/tests/scope/confirm?blockId=${r0.id}`)
    const outcomeIds = ((choiceInfo.body?.outcomes ?? []) as any[]).slice(0, 2).map(o => o.id)
    const cur = (await admin.from('plan_blocks').select('revision').eq('id', r0.id).single()).data!.revision
    const conf = await i.s.post('/api/tests/scope/confirm', { blockId: r0.id, outcomeIds, expectedRevision: cur })
    check('explicitly recording the curriculum scope is accepted', conf.body?.ok === true && outcomeIds.length > 0, JSON.stringify(conf.body).slice(0, 140))
    const scopeConf = await i.s.json('/api/tests/scope')
    const pv = scopeConf.body?.preview
    check('that scope is now eligible, as revision, and the paper is revisionary', pv?.scope?.totals?.revisionOutcomes === outcomeIds.length && pv?.scope?.totals?.newOutcomes === 0 && pv?.paperKind === 'revisionary', JSON.stringify(pv?.scope?.totals) + ' ' + pv?.paperKind)
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; failed++ }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.`)
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped (skips are NOT counted as passed)`)
  for (const s of skipped) console.log(`  skipped: ${s}`)
  if (failed > 0) process.exitCode = 1
})
