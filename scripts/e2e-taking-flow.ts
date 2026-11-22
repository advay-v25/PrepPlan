/**
 * Phase 3 live: starting a weekly paper from completed scope, the taking flow (mandatory
 * confidence, active time, pause/resume, change-before-submit, flags), idempotent submission,
 * and the Tests-tab buttons. Dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-taking-flow.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from './lib/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
import { declareBank } from './lib/bankMode'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await declareBank(admin, 'e2e-taking-flow', ['r028'])
  console.log('\nTaking flow\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)

  const cnt = async (t: string, f: Record<string, string> = {}) => { let q = admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid); for (const [k, v] of Object.entries(f)) q = q.eq(k, v); return (await q).count ?? 0 }
  const post = (p: string, b?: unknown) => fetch(`${E2E_BASE_URL}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) })

  check('start requires authentication', (await post('/api/tests/start', { kind: 'weekly' })).status === 401)
  check('attempt routes require authentication', (await fetch(`${E2E_BASE_URL}/api/tests/attempt/00000000-0000-0000-0000-000000000000`)).status === 401
    && (await post('/api/tests/attempt/00000000-0000-0000-0000-000000000000/answer')).status === 401)
  check('start is POST only', (await s.req('/api/tests/start')).status === 405)
  check('an unknown assessment type is a 400', (await s.post('/api/tests/start', { kind: 'nope' })).status === 400)
  check('an unknown attempt is a 404', (await s.json('/api/tests/attempt/00000000-0000-0000-0000-000000000000')).status === 404)

  // --- fixture: a cycle; only Reading 29 completed (the bank holds 1 item there)
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  const today = new Date().toISOString().slice(0, 10)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const mk = (id: string, o: Record<string, unknown>) => ({
    id, user_id: uid, cycle_id: cycleId, title: id, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred',
    execution: 'completed', local_date: addDays(today, -1), day: addDays(today, -1), duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o,
  })
  await admin.from('plan_blocks').insert([
    mk('tf-thin', { title: 'Balance sheet: intangibles', lm_id: 'r029', outcome_id: 'r029-a' }),
    mk('tf-paper', { title: 'Weekly paper', task_type: 'diagnostic', origin: 'diagnostic', execution: 'not_started', local_date: addDays(today, 3), day: addDays(today, 3), lm_id: 'r028',
      assessment_scope: { kind: 'weekly_paper', purpose: 'diagnostic', manifestId: 'x', tiers: ['reviewed'], checkedAt: new Date().toISOString(), totalMinItems: 5, totalTargetItems: 8, sections: [{ purpose: 'diagnostic', moduleIds: ['r028', 'r029'], minItems: 5, targetItems: 8 }] } }),
  ])
  const attempts0 = await cnt('assessment_attempts')
  const thin = await s.post('/api/tests/start', { kind: 'weekly' })
  check('a thin bank is refused honestly and nothing is started', thin.status === 409 && thin.body?.code === 'bank_insufficient' && /at least 5/.test(thin.body?.message ?? ''), JSON.stringify(thin.body).slice(0, 200))
  check('no attempt, form or snapshot was created by the refusal', (await cnt('assessment_attempts')) === attempts0 && (await cnt('paper_scope_snapshots')) === 0)
  const mock = await s.post('/api/tests/start', { kind: 'mock' })
  check('the single-paper mock is retired and points to the rehearsal (two linked 90-question sessions)', mock.status === 410 && mock.body?.code === 'retired' && /90-question sessions/.test(mock.body?.message ?? ''), JSON.stringify(mock.body).slice(0, 200))
  check('a reading with nothing completed is refused with a reason', (await s.post('/api/tests/start', { kind: 'reading', readingId: 'r027' })).body?.code === 'no_scope')
  const repair0 = await s.post('/api/tests/start', { kind: 'repair' })
  check('a repair paper cannot be started without naming its Calendar re-check (there is no account-wide repair paper)', repair0.body?.code === 'bad_request' && /Calendar/.test(repair0.body?.message ?? ''))
  const noTask = await s.post('/api/tests/start', { kind: 'repair', checkTaskId: 'does-not-exist' })
  check('a re-check that does not exist is refused, not faked', noTask.body?.ok === false)

  // --- Tests tab before starting
  const noPaperHtml = await (await s.req('/app/tests')).text()
  check('the Tests tab leads with this week\'s paper', noPaperHtml.indexOf('This week') > -1 && noPaperHtml.includes('weekly-h'))
  check('mocks are their own view, not a block ahead of this week\'s paper', noPaperHtml.indexOf('weekly-h') > -1 && !noPaperHtml.includes('id="mock-h"') && (await (await s.req('/app/tests?view=mocks')).text()).includes('mock-h'))
  const isReviewer = ((await admin.from('user_roles').select('role').eq('user_id', uid).eq('role', 'diagnostic_reviewer')).data ?? []).length > 0
  check('the staff-only Item review link appears only for reviewers', noPaperHtml.includes('/app/tests/review') === isReviewer)

  // --- complete Reading 28 (bank: 15 items) and start the weekly paper
  await admin.from('plan_blocks').delete().eq('id', 'tf-thin')
  await admin.from('plan_blocks').insert(['a', 'b', 'c', 'd', 'e'].map(c => mk(`tf-r28${c}`, { title: `Income statement ${c}`, lm_id: 'r028', outcome_id: `r028-${c}` })))
  const preview = (await s.json('/api/tests/scope')).body.preview
  const rev = preview.scope.revision as string
  const beforeHtml = await (await s.req('/app/tests')).text()
  check('the weekly card offers ONE primary action: Review and start (the shared preview), and scope detail sits behind a disclosure', beforeHtml.includes('Review and start') && beforeHtml.includes('Scope detail') && !beforeHtml.includes('Start weekly paper</button>'))
  check('it says what changed since Calendar planned the paper (inside the disclosure)', /What this paper covers/.test(beforeHtml) && /Planned but not completed/.test(beforeHtml))
  check('it links the scheduled paper to Calendar', beforeHtml.includes('href="/app/calendar"'))

  const stale = await s.post('/api/tests/start', { kind: 'weekly', expectedRevision: 'stale-revision' })
  check('a scope that changed since it was reviewed must be re-reviewed', stale.status === 409 && stale.body?.code === 'scope_changed')
  check('no attempt was created by the stale start', (await cnt('assessment_attempts')) === attempts0)
  const burst = await Promise.all([1, 2, 3].map(() => s.post('/api/tests/start', { kind: 'weekly', expectedRevision: rev })))
  const ids = new Set(burst.filter(b => b.body?.ok).map(b => b.body.attemptId))
  check('concurrent starts converge on ONE attempt', burst.every(b => b.body?.ok) && ids.size === 1, JSON.stringify(burst.map(b => b.body?.code ?? b.body?.attemptId)))
  const attemptId = [...ids][0] as string
  check('exactly one attempt exists for this cycle', ((await admin.from('assessment_attempts').select('id').eq('user_id', uid).eq('attempt_kind', 'weekly')).data ?? []).length === 1)
  const again = await s.post('/api/tests/start', { kind: 'weekly', expectedRevision: rev })
  check('starting again resumes the same attempt', again.body?.ok && again.body.attemptId === attemptId && again.body.resumed === true)

  const { data: att } = await admin.from('assessment_attempts').select('*').eq('id', attemptId).single()
  const { data: snap } = await admin.from('paper_scope_snapshots').select('revision, attempt_id').eq('attempt_id', attemptId)
  check('the scope is frozen at start: a snapshot is linked to the attempt', snap?.length === 1 && snap[0].revision === rev)
  check('the requested blueprint and delivered coverage are stored', !!att?.requested_blueprint?.totalQuestions && !!att?.delivered_coverage?.delivered && att.attempt_kind === 'weekly' && att.paper_kind === 'diagnostic')
  const total = att!.delivered_coverage.delivered as number
  check('the paper is within the ceiling and matches the delivered count', total > 0 && total <= 90 && ((await admin.from('form_items').select('item_id').eq('form_id', att!.form_id)).data ?? []).length === total, String(total))
  const { data: blk } = await admin.from('plan_blocks').select('attempt_id').eq('id', 'tf-paper').single()
  check('the scheduled paper on Calendar is linked to the attempt', blk?.attempt_id === attemptId)

  // --- the taking screen's data: no key, no concept label
  const state = await s.json(`/api/tests/attempt/${attemptId}`)
  const raw = JSON.stringify(state.body)
  check('the attempt state has every question, nothing answered yet', state.body.ok && state.body.items.length === total && state.body.attempt.answered === 0)
  const keys = new Set<string>(); const walk = (v: any) => { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x) } }; walk(state.body)
  check('no key, concept label or rationale field is exposed while the attempt is open', !['key_index', 'concept', 'conceptName', 'rationale', 'is_correct', 'correct', 'per_option_feedback'].some(k => keys.has(k)), [...keys].join(','))
  check('questions carry only a stem and options', state.body.items.every((i: any) => typeof i.stem === 'string' && Array.isArray(i.options) && i.options.length >= 2))
  const items = state.body.items as { id: string; options: string[] }[]

  // --- mandatory confidence, enforced on the server
  const noConf = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 0, activeSeconds: 5, interruptedSeconds: 0 })
  check('an answer without confidence is refused', noConf.status === 400 && noConf.body?.code === 'confidence_required')
  check('an invalid confidence is refused', (await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 0, confidence: 'maybe' })).status === 400)
  check('nothing was saved by the refused answers', (await cnt('assessment_responses', { attempt_id: attemptId })) === 0)
  check('an option that does not exist is refused', (await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 99, confidence: 'high' })).status === 400)
  check('a question not in this attempt is refused', (await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: 'not-in-form', selectedOptionIndex: 0, confidence: 'high' })).status === 400)

  await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[0].id, activeSeconds: 1, interruptedSeconds: 0, visit: true })
  const a1 = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 0, confidence: 'high', activeSeconds: 900, interruptedSeconds: 0 })
  check('an answer with confidence saves', a1.body?.ok === true)
  check('active time cannot exceed the wall clock, whatever the client claims', a1.body.activeSeconds <= 10, String(a1.body.activeSeconds))
  const r1 = (await admin.from('assessment_responses').select('selected_option_index, self_reported_confidence, changed_count').eq('attempt_id', attemptId).eq('item_id', items[0].id).single()).data
  check('the exact choice and confidence are stored (Sure = 5)', r1?.selected_option_index === 0 && r1?.self_reported_confidence === 5 && r1?.changed_count === 0)
  await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 1, confidence: 'low', activeSeconds: 2, interruptedSeconds: 0 })
  const r1b = (await admin.from('assessment_responses').select('selected_option_index, self_reported_confidence, changed_count, active_seconds').eq('attempt_id', attemptId).eq('item_id', items[0].id).single()).data
  check('an answer and confidence can be changed before submission (Guessing = 1)', r1b?.selected_option_index === 1 && r1b?.self_reported_confidence === 1 && r1b?.changed_count === 1)
  check('changing an answer never shrinks recorded active time', (r1b?.active_seconds ?? 0) >= (a1.body.activeSeconds ?? 0))
  check('one response row per question, not two', (await cnt('assessment_responses', { attempt_id: attemptId })) === 1)

  // --- active time survives a refresh; flags; interruptions
  await sleep(4000)
  const hb = await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[1].id, activeSeconds: 6, interruptedSeconds: 2, flagged: true, visit: true })
  check('a heartbeat saves active and interrupted time', hb.body?.ok && hb.body.activeSeconds === 6 && hb.body.interruptedSeconds === 2)
  const lower = await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[1].id, activeSeconds: 1, interruptedSeconds: 0 })
  check('reported time never goes backwards', lower.body?.activeSeconds === 6 && lower.body?.interruptedSeconds === 2)
  const inflated = await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[1].id, activeSeconds: 100000, interruptedSeconds: 0 })
  check('a tampered heartbeat cannot inflate time', inflated.body.activeSeconds < 60, String(inflated.body.activeSeconds))
  const refreshed = (await s.json(`/api/tests/attempt/${attemptId}`)).body.items
  check('after a refresh the time, flag and answer come back', refreshed[1].activeSeconds >= 6 && refreshed[1].interruptedSeconds >= 2 && refreshed[1].flagged === true && refreshed[0].answer.confidence === 'low')

  // --- pause / resume
  check('pausing an untimed attempt works', (await s.post(`/api/tests/attempt/${attemptId}/pause`, { action: 'pause' })).body?.paused === true)
  const whilePaused = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[1].id, selectedOptionIndex: 0, confidence: 'medium' })
  check('answers are refused while paused', whilePaused.status === 409 && whilePaused.body?.code === 'paused')
  await sleep(2500)
  const resumed = await s.post(`/api/tests/attempt/${attemptId}/pause`, { action: 'resume' })
  check('resuming records the paused time separately', resumed.body?.paused === false && resumed.body.pausedSeconds >= 2, JSON.stringify(resumed.body))
  check('paused time is not added to any question\'s active time', ((await s.json(`/api/tests/attempt/${attemptId}`)).body.items[1].activeSeconds) < 60)

  // --- a timed session: strict clock, no pause, answers refused after the deadline
  await admin.from('assessment_attempts').update({ deadline_at: new Date(Date.now() + 3600_000).toISOString(), time_limit_minutes: 60 }).eq('id', attemptId)
  const timedPause = await s.post(`/api/tests/attempt/${attemptId}/pause`, { action: 'pause' })
  check('a timed session cannot be paused', timedPause.status === 409 && timedPause.body?.code === 'timed')
  await admin.from('assessment_attempts').update({ deadline_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', attemptId)
  const late = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[2].id, selectedOptionIndex: 0, confidence: 'high' })
  check('answers after the deadline are refused', late.status === 409 && late.body?.code === 'time_up')
  await admin.from('assessment_attempts').update({ deadline_at: null, time_limit_minutes: null }).eq('id', attemptId)

  // --- answer everything (mixed confidence), then review-before-submit rules
  const conf = ['high', 'low', 'medium', 'high', 'low'] as const
  for (let i = 1; i < items.length - 1; i++) {
    const r = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[i].id, selectedOptionIndex: i % items[i].options.length, confidence: conf[i % 5], activeSeconds: 8, interruptedSeconds: 0 })
    if (!r.body?.ok) check(`answer ${i} saves`, false, JSON.stringify(r.body))
  }
  const early = await s.post(`/api/tests/attempt/${attemptId}/submit`, {})
  check('submitting with an unanswered question is refused, naming it', early.status === 409 && early.body?.code === 'unanswered' && early.body.unanswered.includes(items.length), JSON.stringify(early.body))
  check('nothing was scored by the refused submit', ((await admin.from('assessment_attempts').select('status').eq('id', attemptId).single()).data?.status) !== 'scored')

  const midState = await s.req('/app/tests')
  const midHtml = await midState.text()
  check('mid-attempt the Tests tab offers Resume for the weekly paper', midHtml.includes('Resume paper') && midHtml.includes(`/app/tests/${attemptId}`))

  // --- idempotent submission
  const evBefore = await cnt('evidence_events')
  const sub = await s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
  check('with the unanswered acknowledged it scores', sub.body?.ok === true && sub.body.resultUrl === `/app/tests/${attemptId}/result`, JSON.stringify(sub.body).slice(0, 200))
  const evAfter = await cnt('evidence_events')
  check('scoring wrote evidence', evAfter > evBefore)
  const sub2 = await Promise.all([1, 2, 3].map(() => s.post(`/api/tests/attempt/${attemptId}/submit`, {})))
  check('a repeated or concurrent submit returns the same scored attempt', sub2.every(r => r.body?.ok === true && r.body?.alreadyScored === true))
  check('the retry created no duplicate evidence', (await cnt('evidence_events')) === evAfter)
  // The invariant is two-sided: the endpoint refuses, AND the stored responses do not change. A 503 means the access check itself could not
  // reach the database (a transient infrastructure fault, not an answer being accepted): it is inconclusive, so ask once more rather than guess.
  const respHash = async () => JSON.stringify((await admin.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence').eq('attempt_id', attemptId).order('item_id')).data)
  const hashBefore = await respHash()
  let closed = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 0, confidence: 'high' })
  if (closed.status === 503) { console.log('  (503 from the access check: inconclusive, asking once more)'); closed = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[0].id, selectedOptionIndex: 0, confidence: 'high' }) }
  check('a scored attempt accepts no more answers', closed.status === 409 && closed.body?.code === 'closed', `${closed.status} ${JSON.stringify(closed.body).slice(0, 160)}`)
  check('and its stored responses are unchanged', (await respHash()) === hashBefore)
  check('submission time is recorded', !!(await admin.from('assessment_attempts').select('submitted_at').eq('id', attemptId).single()).data?.submitted_at)

  // --- after scoring
  const doneHtml = await (await s.req('/app/tests')).text()
  check('after scoring the Tests tab offers See result and Complete weekly closure', doneHtml.includes('See result') && doneHtml.includes('Complete weekly closure') && doneHtml.includes('/app/review-week'))
  check('the taking page redirects to the result once scored', (await s.req(`/app/tests/${attemptId}`)).status >= 300)
  const resultPage = await s.req(`/app/tests/${attemptId}/result`)
  check('the result page renders', resultPage.status === 200)
  const doneRepair = await s.post('/api/tests/start', { kind: 'repair' })
  check('after scoring there is still no account-wide repair paper', doneRepair.body?.code === 'bad_request')

  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)
  await admin.from('plan_blocks').delete().eq('user_id', uid).like('id', 'tf-%')
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
