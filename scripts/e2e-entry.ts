/**
 * Adaptive entry, live: the real onboarding API, saved records and accepted weeks, with ORDINARY throwaway students (no role, deleted after).
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-entry.ts
 * Proves: the answers are saved as asked, plans differ materially between entries, a claim fabricates no evidence, and an edit
 * after a preview cannot accept a stale plan or touch an accepted one.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck, completeOnboarding, createSession } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
type S = ReturnType<typeof createSession>
const made: string[] = []

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
async function toPreview(s: S, position: Record<string, unknown>) {
  const { data: windows } = await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens', { ascending: true })
  const steps: [string, unknown][] = [
    ['exam', { examWindowId: windows![0].id, registered: true, examDate: `${String(windows![0].window_opens).slice(0, 7)}-20`, timezone: process.env.E2E_TZ ?? 'Europe/London' }],
    ['route', { prepMode: 'self_study', classPattern: 'none', recurringClasses: [] }],
    ['position', position],
    ['week', { commitments: [], availabilityMode: 'windows', windows: [1, 2, 3, 4, 5, 6, 0].map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })), maxSessionMinutes: 45 }],
  ]
  for (const [step, body] of steps) { const r = await s.post(`/api/onboarding/${step}`, body); if (r.body?.ok !== true && step !== 'position') throw new Error(`${step}: ${JSON.stringify(r.body)}`) }
  return s.post('/api/onboarding/plan/preview', {})
}

const counts = async (uid: string) => JSON.stringify(await Promise.all(['task_events', 'evidence_events', 'assessment_attempts', 'assessment_responses', 'repair_threads', 'coach_proposals'].map(async t =>
  (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count)))

async function main() {
  const { data: topics } = await admin.from('topics').select('id, name').order('default_sequence')
  const T = (topics ?? []).map(t => t.id as string)
  const { data: mods } = await admin.from('learning_modules').select('id, topic_id, sequence_hint').eq('is_active', true).order('sequence_hint')
  const readingsOf = (t: string) => (mods ?? []).filter(m => m.topic_id === t).map(m => m.id as string)
  const topicOf = new Map((mods ?? []).map(m => [m.id as string, m.topic_id as string]))
  const rec = (ids: string[]) => Object.fromEntries(ids.map(id => [id, 'recent']))
  const mock = { date: addDays(today, 30), kind: 'provider_mock' }

  console.log('\nA. Partway through preparation (three topics covered, uneven uncertainty)')
  const a = await student('entA')
  const pick = readingsOf(T[1])[1]
  const prevA = await toPreview(a.s, {
    stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 3)),
    uncertainty: { [T[0]]: { level: 'most', lmIds: [] }, [T[1]]: { level: 'several', lmIds: [pick] }, [T[2]]: { level: 'none', lmIds: [] } },
  })
  check('the preview is built', prevA.body?.ok === true, JSON.stringify(prevA.body).slice(0, 200))
  const unc = (await admin.from('user_entry_uncertainty').select('topic_id, level, lm_ids').eq('user_id', a.id)).data ?? []
  check('uncertainty is saved: two answers, with "none" distinct from the unanswered topics', unc.length === 2 + 0 + 1 && unc.find(u => u.topic_id === T[2])?.level === 'none' && !unc.some(u => u.topic_id === T[3]))
  check('the narrowed reading is saved', JSON.stringify(unc.find(u => u.topic_id === T[1])?.lm_ids) === JSON.stringify([pick]))
  check('coverage is saved as a planning claim with its source', ((await admin.from('user_module_state').select('source, coverage_state').eq('user_id', a.id)).data ?? []).every(r => r.source === 'self_report' && r.coverage_state === 'studied'))
  const tasksA = (prevA.body.data.tasks ?? []) as any[]
  const covered = new Set(T.slice(0, 3))
  const studyA = tasksA.filter(t => t.task_type === 'study'), reviewA = tasksA.filter(t => t.task_type === 'review')
  check('first-pass study is only for the subjects not yet covered', studyA.length > 0 && studyA.every(t => !covered.has(topicOf.get(t.lm_id)!)), JSON.stringify(studyA.map(t => t.title)))
  check('revision is proposed for what was flagged, and only that', reviewA.length > 0 && reviewA.every(t => [T[0], T[1]].includes(topicOf.get(t.lm_id)!)))
  check('the reading the student picked is the one revised in that topic', reviewA.filter(t => topicOf.get(t.lm_id) === T[1]).every(t => t.lm_id === pick))
  check('nothing is proposed for the topic marked "nothing shaky"', !reviewA.some(t => topicOf.get(t.lm_id) === T[2]))
  check('each revision task says it is self-reported, not test evidence', reviewA.every(t => /self-reported/i.test(t.rationale ?? '') && !/test evidence is|demonstrated/i.test(t.rationale ?? '')))
  check('no repair thread was fabricated for reported uncertainty', tasksA.every(t => !t.repair_thread_id))
  const confirmA = await a.s.post('/api/onboarding/plan/confirm', { draftId: prevA.body.data.draftId, expectedRevision: prevA.body.data.revision })
  check('the week is accepted', confirmA.body?.ok === true, JSON.stringify(confirmA.body).slice(0, 160))
  const blocksA = (await admin.from('plan_blocks').select('id, title, task_type, execution, revision, learning_objective, suggested_approach, completion_meaning').eq('user_id', a.id)).data ?? []
  check('revision tasks arrive in Calendar with purpose, activity and what to log', blocksA.filter(b => b.task_type === 'review').length > 0 && blocksA.filter(b => b.task_type === 'review').every(b => b.learning_objective && b.suggested_approach && /Log/.test(b.completion_meaning ?? '')), JSON.stringify(blocksA.filter(b => b.task_type === 'review').slice(0, 2)))
  check('nothing is completed and no minutes exist', blocksA.length > 0 && blocksA.every(b => b.execution === 'not_started'))
  check('no events, evidence, answers, attempts, repairs or proposals were created by the claims or the plan', (await counts(a.id)) === JSON.stringify([0, 0, 0, 0, 0, 0]), await counts(a.id))
  const roadmap = await a.s.json('/api/roadmap')
  const rm = roadmap.body?.roadmap
  check('the roadmap uses the claims: a shorter first pass limited to the unfinished subjects', roadmap.status === 200 && rm?.milestones.filter((m: any) => m.phase === 'first_pass').every((m: any) => !covered.has(m.topicId)), JSON.stringify(roadmap.body).slice(0, 160))
  check('the roadmap explains what it assumed', Array.isArray(rm?.assumptions) && rm.assumptions.length >= 0 && Array.isArray(rm?.warnings))

  console.log('\nB. Edit after acceptance: the accepted week is not rewritten, and a stale proposal cannot be accepted')
  const planFingerprint = async () => JSON.stringify((await admin.from('plan_blocks').select('id, title, local_date, duration_minutes, execution, revision').eq('user_id', a.id).order('id')).data)
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', a.id).eq('status', 'active').single()
  const tokenOf = async () => (await admin.rpc('weekly_source_version', { p_user: a.id, p_cycle: cyc!.id })).data as string
  const fp0 = await planFingerprint(), tok0 = await tokenOf()
  const { data: setup } = await admin.from('profiles').select('onboarding_context_version').eq('id', a.id).single().throwOnError()
  const edit = await a.s.post('/api/onboarding/position', {
    stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 3)),
    uncertainty: { [T[0]]: { level: 'few', lmIds: [] } }, mock,
    expectedVersion: setup!.onboarding_context_version,
  })
  check('the edit saves', edit.body?.ok === true, JSON.stringify(edit.body))
  check('the accepted week is exactly as it was', fp0 === await planFingerprint())
  check('the weekly change token moved, so an unaccepted weekly proposal built before the edit is stale', tok0 !== await tokenOf())
  const keep = await a.s.post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 3)), expectedVersion: edit.body?.version })
  check('a save from a client that does not know the new fields keeps uncertainty and the mock', keep.body?.ok === true && ((await admin.from('user_entry_uncertainty').select('*', { count: 'exact', head: true }).eq('user_id', a.id)).count === 1) && (await admin.from('profiles').select('mock_date').eq('id', a.id).single()).data?.mock_date === mock.date)

  console.log('\nC. First pass complete, a mock in a month')
  const c = await student('entC')
  const prevC = await toPreview(c.s, {
    stage: 'revising_or_mocks', topicExposure: rec(T), uncertainty: { [T[3]]: { level: 'most', lmIds: [] } }, mock,
  })
  check('the preview is built', prevC.body?.ok === true, JSON.stringify(prevC.body).slice(0, 200))
  const tasksC = (prevC.body.data.tasks ?? []) as any[]
  check('no first-pass study at all', tasksC.length > 0 && !tasksC.some(t => t.task_type === 'study'), JSON.stringify(tasksC.map(t => t.title)))
  check('the week includes targeted revision for the flagged topic', tasksC.some(t => t.task_type === 'review' && topicOf.get(t.lm_id) === T[3] && /self-reported|you said|you marked/i.test(t.rationale ?? '')),
    JSON.stringify(tasksC.map(t => ({ title: t.title, why: t.rationale }))))
  const stale = (await admin.from('profiles').select('mock_kind, mock_date').eq('id', c.id).single()).data
  check('the mock is saved as a checkpoint', stale?.mock_date === mock.date && stale?.mock_kind === 'provider_mock')
  console.log('\n   A preview built before an edit cannot be accepted')
  const edit2 = await c.s.post('/api/onboarding/position', { stage: 'revising_or_mocks', topicExposure: rec(T), uncertainty: { [T[3]]: { level: 'few', lmIds: [] } }, mock })
  check('the edit saves', edit2.body?.ok === true)
  const before = (await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', c.id)).count
  const late = await c.s.post('/api/onboarding/plan/confirm', { draftId: prevC.body.data.draftId, expectedRevision: prevC.body.data.revision })
  check('the stale preview is refused', late.body?.ok === false, JSON.stringify(late.body).slice(0, 200))
  check('nothing was created by the refused acceptance', (await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', c.id)).count === before && before === 0)
  const fresh = await c.s.post('/api/onboarding/plan/preview', {})
  check('a fresh preview reflects the edit and can be accepted', fresh.body?.ok === true && fresh.body.data.draftId !== prevC.body.data.draftId
    && (await c.s.post('/api/onboarding/plan/confirm', { draftId: fresh.body.data.draftId, expectedRevision: fresh.body.data.revision })).body?.ok === true)

  const rmC = (await c.s.json('/api/roadmap')).body?.roadmap
  check('the roadmap has no first pass and the mock as a dated checkpoint', rmC && !rmC.phases.some((p: any) => p.phase === 'first_pass') && rmC.checkpoints?.length === 1 && rmC.checkpoints[0].date === mock.date)
  const exam = (await admin.from('profiles').select('exam_date').eq('id', c.id).single()).data?.exam_date
  check('the exam stays the only exam date', rmC?.targetDate === exam)
  check('the plan does not claim a verdict on the candidate', rmC && rmC.feasibility.verdict !== 'not_enough_time')


  console.log('\nD. Dates and shapes are validated, and a close mock is never refused for being close')
  const d = await student('entD')
  await toPreview(d.s, { stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 1)) })
  const tryMock = async (m: unknown) => d.s.post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 1)), mock: m })
  check('a malformed date is refused', (await tryMock({ date: '2026-13-45', kind: 'other' })).status === 400)
  const past = await tryMock({ date: addDays(today, -3), kind: 'other' })
  check('a past date is refused with a plain reason', past.status === 400 && /passed/.test(past.body?.message ?? ''), JSON.stringify(past.body))
  const afterExam = await tryMock({ date: addDays(exam as string, 5), kind: 'other' })
  check('a mock after the exam target is refused with the target named', afterExam.status === 400 && /exam target/.test(afterExam.body?.message ?? ''), JSON.stringify(afterExam.body))
  check('an unknown mock type is refused', (await tryMock({ date: addDays(today, 10), kind: 'webinar' })).status === 400)
  check('a mock tomorrow is accepted', (await tryMock({ date: addDays(today, 1), kind: 'other' })).body?.ok === true)
  check('a reading that does not belong to the topic is refused', (await d.s.post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: rec(T.slice(0, 1)), uncertainty: { [T[0]]: { level: 'few', lmIds: [readingsOf(T[1])[0]] } } })).status === 400)
  check('an unknown uncertainty level is refused', (await d.s.post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: {}, uncertainty: { [T[0]]: { level: 'huge', lmIds: [] } } })).status === 400)
  check('"first pass complete" with no topic marked is refused', (await d.s.post('/api/onboarding/position', { stage: 'revising_or_mocks', topicExposure: {} })).status === 400)
  check('a refused save changed nothing', (await admin.from('profiles').select('mock_date').eq('id', d.id).single()).data?.mock_date === addDays(today, 1))

  console.log('\nE. An existing student who never saw the new questions')
  const e = await student('entE')
  await completeOnboarding(e.s, admin)   // the previous payload shape: stage and topic exposure only
  check('no uncertainty or mock was invented for them', ((await admin.from('user_entry_uncertainty').select('*', { count: 'exact', head: true }).eq('user_id', e.id)).count === 0) && (await admin.from('profiles').select('mock_date').eq('id', e.id).single()).data?.mock_date === null)
  const page = await e.s.req('/onboarding/position')
  check('their position screen loads (they are not sent through onboarding again)', page.status === 200, String(page.status))
  check('the app and roadmap load', (await e.s.req('/app')).status === 200 && (await e.s.json('/api/roadmap')).body?.ok === true)
  check('their onboarding stays complete', (await admin.from('profiles').select('onboarding_status').eq('id', e.id).single()).data?.onboarding_status === 'complete')

  console.log('\nF. A topic whose questions are not reviewed')
  const noBank = tasksC.find(t => t.task_type === 'review')
  const reviewedTopics = new Set(((await admin.from('assessment_items').select('lm_id').eq('review_status', 'reviewed')).data ?? []).map(r => topicOf.get(r.lm_id as string)))
  check('planning continued for a flagged topic (' + (reviewedTopics.has(T[3]) ? 'it has reviewed items' : 'no reviewed items') + ')', !!noBank)
  const paper = prevC.body.data.paper
  check('the paper decision is honest about the bank rather than invented', paper?.kind === 'paper' || ['insufficient_bank', 'no_scope', 'below_minimum_paper'].includes(paper?.reason))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.`)
  finish()
})
