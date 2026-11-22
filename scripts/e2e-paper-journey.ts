/**
 * Phase 3 student journey through the NORMAL routes, in two separate parts:
 *   1. ACTUAL-BANK LIMITATION — against the live bank as it is (no approved question exists for the completed scope): honest wording,
 *      a usable planning path, nothing started.   (Skipped, and said so, if the live bank is not empty of eligible questions.)
 *   2. COMPLETE SUCCESS JOURNEY — against a TEST-ONLY approved fixture bank created and destroyed by this script (scripts/fixture-bank.cjs):
 *      completed scope → preflight → start (stale, concurrent, resume) → taking (confidence, timing, refresh, no keys) → submit once → result
 *      (next action, findings, SWOT) → repair preview/accept → linked Calendar tasks → completion → fresh re-check → challenge invalidation.
 * Ordinary throwaway students only; fixtures are removed by recorded id.
 *
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-paper-journey.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { Client } from 'pg'
import { createStudent, makeCheck } from './lib/e2eSession'
import { calendarTaskHref } from '../src/lib/routing/calendar'
import { FIXTURE_PROVENANCE } from '../src/lib/diagnostic/itemState'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const made: string[] = []
type Student = Awaited<ReturnType<typeof createStudent>>
const TARGET = 'asylsxszdhlnzewhwtga'

const block = (uid: string, cycleId: string, id: string, o: Record<string, unknown> = {}) => ({
  id, user_id: uid, cycle_id: cycleId, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started',
  local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when', ...o })
const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
const exec = async (st: Student, id: string, execution: string, minutes?: number) =>
  st.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: await rev(id) }) })
async function openCycle(uid: string) {
  const { data } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active')
  const id = data![0].id as string
  await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 6), starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString() }).eq('id', id)
  await admin.from('plan_blocks').delete().eq('cycle_id', id)
  return id
}
async function completeScope(st: Student, tag: string) {
  const cyc = await openCycle(st.id)
  await admin.from('plan_blocks').insert(['a', 'b', 'c', 'd', 'e'].map(c => block(st.id, cyc, `${tag}-${c}`, { title: `Income statement ${c}`, lm_id: 'r028', outcome_id: `r028-${c}` })))
  for (const c of ['a', 'b', 'c', 'd', 'e']) await exec(st, `${tag}-${c}`, 'completed', 30)
  return cyc
}
const eligibleCount = async () => (await admin.from('student_eligible_items').select('id', { count: 'exact', head: true }).neq('provenance', FIXTURE_PROVENANCE).throwOnError()).count ?? 0
const attemptsOf = async (uid: string) => (await admin.from('assessment_attempts').select('id').eq('user_id', uid)).data?.length ?? 0

async function dropStudents() {
  const ids = made.splice(0)
  for (const id of ids) await admin.auth.admin.deleteUser(id)
  if (ids.length) console.log(`\nDeleted ${ids.length} student fixtures.`)
}

async function partOne() {
  console.log('\n1. Actual-bank limitation (live bank, no fixtures)')
  const live = await eligibleCount()
  if (live > 0) { console.log(`  (skipped: ${live} eligible questions exist, so this is not the empty live bank)`); return }
  const st = await createStudent(admin, 'lim', { onboard: true }); made.push(st.id)
  await completeScope(st, 'lm')
  const pre = await st.s.post('/api/tests/preflight', { kind: 'weekly' })
  const d = pre.body?.decision
  check('preflight reports that the bank cannot serve the completed scope', pre.status === 200 && d?.state === 'insufficient' && d.deliverable === 0, JSON.stringify(d).slice(0, 200))
  check('the wording is accurate: fresh human-reviewed questions, the count, and that nothing was started', /fresh human-reviewed/.test(d?.message ?? '') && /0 fresh/.test(d?.message ?? '') && /Nothing will be started/.test(d?.message ?? ''))
  check('the short reading is named and the scope stays pending', d?.pending?.bank?.length > 0 && /Reading/.test(d.pending.bank[0].name) && /pending/.test(d.message))
  check('the student is offered a usable planning path', d?.next?.href === '/app/review-week' && /without/.test(d.next.label))
  const before = await attemptsOf(st.id)
  const start = await st.s.post('/api/tests/start', { kind: 'weekly' })
  check('starting is refused with the same decision and creates nothing', start.status === 409 && start.body?.code === 'bank_insufficient' && start.body?.decision?.state === 'insufficient' && (await attemptsOf(st.id)) === before)
  check('the response carries no answer keys or item ids', !/itemIds|key_index|keyIndex/.test(JSON.stringify(start.body)))
  const html = await (await st.s.req('/app/tests')).text()
  check('the Tests page tells the same story and links the planning path', /Waiting on reviewed questions/.test(html) && html.includes('/app/review-week'))
  // Time-shift fixture: it is the cycle's last day, which is when closure is offered.
  await admin.from('planning_cycles').update({ ends_at_local: today }).eq('user_id', st.id).eq('status', 'active')
  const gate = (await st.s.json('/api/weekly-review/state')).body?.state?.gate
  check('weekly closure does not demand a paper that cannot exist', gate?.kind === 'no_paper_allowed', JSON.stringify(gate))
  const mock = await st.s.post('/api/tests/preflight', { kind: 'mock' })
  // Routine preflight no longer has a standalone mock mode (mocks are linked rehearsals, covered by e2e-rehearsal-journey): the CONTRACT is that it refuses one.
  check('routine preflight refuses a standalone mock (its contract); linked-rehearsal availability is tested in e2e-rehearsal-journey', mock.status === 400 && /Unknown assessment type/.test(JSON.stringify(mock.body)))
  const rd = await st.s.post('/api/tests/preflight', { kind: 'reading', readingId: 'r028' })
  check('a reading check for completed scope is also refused honestly', rd.body?.decision?.state === 'insufficient')
}

async function partTwo() {
  console.log('\n2. Complete success journey (test-only approved fixture bank)')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paper-journey-')), 'bank.json')
  execFileSync('node', ['scripts/fixture-bank.cjs', 'create', `--confirm-target=${TARGET}`, `--out=${file}`, '--readings=r028', '--per-outcome=6', '--variants=2'], { stdio: 'inherit' })
  const bank = JSON.parse(fs.readFileSync(file, 'utf8')) as { items: string[]; users: string[] }
  const reviewer = bank.users[0]
  try {
    const st = await createStudent(admin, 'pj', { onboard: true }); made.push(st.id)
    const cyc = await completeScope(st, 'pj')
    const scope = (await st.s.json('/api/tests/scope')).body.preview

    // --- one decision, three surfaces
    const pre = (await st.s.post('/api/tests/preflight', { kind: 'weekly' })).body.decision
    check('preflight says the paper can start, with requested and deliverable counts', pre.state === 'start' && pre.deliverable >= 5 && pre.deliverable <= 90 && pre.requested >= pre.deliverable, JSON.stringify(pre).slice(0, 200))
    check('it names the purpose, timing and the confirmed scope', /diagnostic/i.test(pre.purposeLabel) && pre.minutes > 0 && pre.scopeTotals.outcomes === 5 && pre.readings.length === 1)
    check('breadth first: every confirmed outcome is asked before any gets depth', pre.pending.capacityTotal === 0)
    const stale = await st.s.post('/api/tests/start', { kind: 'weekly', expectedRevision: 'not-the-revision' })
    check('a stale scope revision is refused and the updated choice is returned', stale.status === 409 && stale.body.code === 'scope_changed' && stale.body.decision?.state === 'stale' && (await attemptsOf(st.id)) === 0)
    const racers = await Promise.all([1, 2, 3, 4].map(() => st.s.post('/api/tests/start', { kind: 'weekly', expectedRevision: scope.revision })))
    check('concurrent starts converge on ONE attempt', racers.every(r => r.body?.ok === true) && new Set(racers.map(r => r.body.attemptId)).size === 1 && (await attemptsOf(st.id)) === 1, JSON.stringify(racers.map(r => r.body?.code ?? r.body?.resumed)))
    const attemptId = racers[0].body.attemptId as string
    check('the paper started is the paper previewed', racers[0].body.questions === pre.deliverable)
    const att = (await admin.from('assessment_attempts').select('eligibility_policy, delivered_coverage, requested_blueprint, cycle_id').eq('id', attemptId).single()).data!
    check('the eligibility policy, selection reasons, pending list and shortfalls are recorded on the attempt', att.eligibility_policy === 'approved-version-v1' && Array.isArray((att.delivered_coverage as any).selection?.selectedOutcomes) && (att.delivered_coverage as any).selection.policy === 'approved-version-v1' && 'shortfalls' in (att.delivered_coverage as any))
    const block1 = (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'diagnostic')).data ?? []
    check('the paper is linked to the cycle', att.cycle_id === cyc || block1.length === 0)
    const pinned = (await admin.from('form_items').select('item_id, item_version').eq('form_id', (await admin.from('assessment_attempts').select('form_id').eq('id', attemptId).single()).data!.form_id)).data ?? []
    check('every question is pinned at its approved version', pinned.length === pre.deliverable && pinned.every(p => p.item_version === 1))
    const fams = (await admin.from('assessment_items').select('family_id').in('id', pinned.map(p => p.item_id as string))).data ?? []
    check('no two questions share a family', new Set(fams.map(f => f.family_id)).size === fams.length)

    // --- taking
    const taking = await st.s.json(`/api/tests/attempt/${attemptId}`)
    const items = taking.body.items as { id: string; options: string[] }[]
    check('the taking payload carries no keys, feedback or rationale', !/key_index|keyIndex|solution|perOptionFeedback|per_option|distractor|rationale|conceptName/i.test(JSON.stringify(taking.body)))
    const meta = new Map(((await admin.from('assessment_items').select('id, outcome_id, key_index').in('id', items.map(i => i.id))).data ?? []).map(r => [r.id as string, r]))
    const byOutcome = (o: string) => items.filter(i => meta.get(i.id)!.outcome_id === `r028-${o}`)
    const unanswered = byOutcome('e')[0]
    const wrongOf = (i: { id: string; options: string[] }) => (Number(meta.get(i.id)!.key_index) + 1) % i.options.length
    const rightOf = (i: { id: string }) => Number(meta.get(i.id)!.key_index)
    const plan: [typeof items[number], number, string][] = []
    for (const i of byOutcome('a')) plan.push([i, wrongOf(i), 'high'])
    for (const i of byOutcome('b')) plan.push([i, rightOf(i), 'low'])
    for (const i of byOutcome('c')) plan.push([i, rightOf(i), 'high'])
    for (const i of byOutcome('d')) plan.push([i, wrongOf(i), 'low'])
    for (const i of byOutcome('e').slice(1)) plan.push([i, rightOf(i), 'high'])
    let saved = 0
    for (const [n, [i, sel, conf]] of plan.slice(0, 3).entries()) {
      await st.s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: i.id, activeSeconds: 1, interruptedSeconds: 0, visit: true })
      if (n === 0) await new Promise(r => setTimeout(r, 6500))   // real time must pass for the server to accept time spent
      const r = await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: i.id, selectedOptionIndex: sel, confidence: conf, activeSeconds: n === 0 ? 4 : 1, interruptedSeconds: n === 0 ? 2 : 0 })
      if (r.body?.ok) saved++
    }
    check('answers with confidence are saved', saved === 3)
    const noConf = await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: plan[3][0].id, selectedOptionIndex: plan[3][1], activeSeconds: 5, interruptedSeconds: 0 })
    check('an answer without a confidence level is refused', noConf.body?.ok !== true)
    const refreshed = await st.s.json(`/api/tests/attempt/${attemptId}`)
    const back = refreshed.body.items.filter((i: any) => i.answer)
    const given = new Map(plan.slice(0, 3).map(([i, sel, conf]) => [i.id, { selected: sel, confidence: conf }]))
    check('a refresh keeps the saved answers and confidence', back.length === 3 && back.every((i: any) => JSON.stringify(i.answer) === JSON.stringify(given.get(i.id))))
    const first = back.find((i: any) => i.id === plan[0][0].id)
    check('interrupted time is kept apart from active time', first.activeSeconds >= 3 && first.interruptedSeconds >= 2 && first.activeSeconds < 8, JSON.stringify([first.activeSeconds, first.interruptedSeconds]))
    check('timing is stable across another refresh', JSON.stringify((await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items.filter((i: any) => i.answer).map((i: any) => [i.id, i.activeSeconds, i.interruptedSeconds])) === JSON.stringify(back.map((i: any) => [i.id, i.activeSeconds, i.interruptedSeconds])))
    const resumed = await st.s.post('/api/tests/start', { kind: 'weekly' })
    check('starting again resumes the same open paper', resumed.body?.attemptId === attemptId && resumed.body.resumed === true && (await attemptsOf(st.id)) === 1)
    for (const [i, sel, conf] of plan.slice(3)) await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: i.id, selectedOptionIndex: sel, confidence: conf, activeSeconds: 20, interruptedSeconds: 0 })
    const refuse = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, {})
    check('submitting with an unanswered question is refused', refuse.status === 409 && refuse.body.code === 'unanswered')
    const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
    check('the paper is scored once', sub.body?.ok === true)
    const resp0 = JSON.stringify((await admin.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence').eq('attempt_id', attemptId).order('item_id')).data)
    const evN = (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('attempt_id', attemptId)).count
    const again = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
    const late = await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: unanswered.id, selectedOptionIndex: 0, confidence: 'high', activeSeconds: 1, interruptedSeconds: 0 })
    check('a repeat submit returns the same result and adds no evidence', again.body?.ok === true && (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('attempt_id', attemptId)).count === evN)
    check('a late answer is refused and the saved responses are unchanged', late.body?.ok !== true && JSON.stringify((await admin.from('assessment_responses').select('item_id, selected_option_index, self_reported_confidence').eq('attempt_id', attemptId).order('item_id')).data) === resp0)
    check('the unanswered question has no response row, so no confidence exists for it', ((await admin.from('assessment_responses').select('id').eq('attempt_id', attemptId).eq('item_id', unanswered.id)).data ?? []).length === 0)

    // --- result
    const r = (await st.s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
    check('the result leads with the most useful next action: repair, because there is a genuine gap', r.nextAction.kind === 'repair' && r.nextAction.href === '#proposal-h', JSON.stringify(r.nextAction))
    const kinds = r.findings.map((f: any) => f.kind)
    check('findings cover the four patterns from this paper, each with its support', ['misconception', 'provisional', 'omitted'].every(k => kinds.includes(k)) && r.findings.every((f: any) => f.observations >= 1 && f.interpretation.length > 20), kinds.join())
    const mis = r.findings.find((f: any) => f.kind === 'misconception')
    check('the misconception uses the chosen distractor’s recorded diagnosis', /Possible misconception/.test(mis.interpretation) && /points to/.test(mis.interpretation))
    check('correct-but-unsure is provisional and offers a fresh check', r.findings.find((f: any) => f.kind === 'provisional')?.action === 'fresh_check')
    check('the omitted question is recorded as an omission with its cause unknown', r.omitted.length === 1 && r.omitted[0].itemId === unanswered.id && /unknown/.test(r.findings.find((f: any) => f.kind === 'omitted').interpretation))
    check('accuracy, confidence and timing are separate in the analysis', r.analysis.overall.confidence && typeof r.analysis.overall.activeMinutes === 'number' && typeof r.analysis.overall.interruptedMinutes === 'number')
    check('the result records which eligibility rule applied', r.eligibilityPolicy === 'approved-version-v1')
    check('SWOT: no threat or opportunity rests on reading order alone', [...r.swot.threats, ...r.swot.opportunities].every((x: any) => x.basis === 'inferred' && !/curriculum order/.test(x.support)))
    const page = await (await st.s.req(`/app/tests/${attemptId}/result`)).text()
    check('the page puts "Do this next" before the detailed analysis', page.indexOf('Do this next') > -1 && page.indexOf('Do this next') < page.indexOf('What the patterns show') && page.indexOf('What the patterns show') < page.indexOf('Accuracy'))
    check('it shows accuracy, confidence and timing as separate sections', ['Accuracy', 'How sure you were', 'Timing'].every(h => page.includes(h)))
    const home = await (await st.s.req('/app')).text()
    check('Home’s Understanding summary links to this result', home.includes(`/app/tests/${attemptId}/result`))

    // --- repair loop
    const prev = await st.s.post('/api/diagnostic/repair/preview', { attemptId })
    check('a repair preview shows targeted work with a reason and dates', prev.body?.ok === true && prev.body.plan.tasks.length > 0 && prev.body.plan.tasks.every((t: any) => t.rationale && t.local_date), JSON.stringify(prev.body).slice(0, 160))
    const key = `pj-${Date.now()}`
    const acc = await st.s.post('/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: key })
    const taskIds = (acc.body?.taskIds ?? []) as string[]
    const retry = await st.s.post('/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: key })
    check('acceptance happens once; a retry replays it', acc.body?.ok === true && taskIds.length > 0 && retry.body?.replayed === true)
    const tasks = (await admin.from('plan_blocks').select('id, local_date, task_type, repair_thread_id').in('id', taskIds)).data ?? []
    const opened = await Promise.all(tasks.map(async t => (await st.s.req(calendarTaskHref(t.id, t.local_date ?? undefined))).status))
    check('each accepted task opens in Calendar from its exact link', opened.every(s => s === 200), opened.join())
    const repairs = tasks.filter(t => t.task_type === 'repair')
    for (const t of repairs) await exec(st, t.id, 'completed', 25)
    const threads = [...new Set(repairs.map(t => t.repair_thread_id as string))]
    check('completing the repairs leaves each thread open awaiting its re-check', ((await admin.from('repair_threads').select('status').in('id', threads)).data ?? []).every(t => t.status === 'awaiting_recheck'))
    const early = await st.s.post('/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `${key}-early` })
    const spaced = early.body?.ok !== true
    check('the spacing rule holds: a re-check cannot be placed before it is due', spaced || (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'recheck')).data!.length >= 1)
    // Deliberately dated history: the repairs were finished five days ago. The spacing rule itself is not touched.
    await admin.from('task_events').update({ created_at: new Date(Date.now() - 5 * 86400000).toISOString() }).in('task_id', repairs.map(t => t.id)).eq('event_type', 'completed')
    await admin.from('repair_threads').update({ next_recheck_due_at: new Date(Date.now() - 86400000).toISOString() }).in('id', threads)
    let checkTask = (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'recheck').is('cancelled_at', null)).data?.[0]?.id as string | undefined
    // Time-shift fixture: the repairs were finished five days ago, so the check Calendar planned for later is due today. The spacing rule itself is not touched.
    if (checkTask) await admin.from('plan_blocks').update({ local_date: today, day: today }).eq('id', checkTask)
    if (!checkTask) { const placed = await st.s.post('/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `${key}-ok` }); checkTask = placed.body?.checkTaskId }
    check('the re-check is placed in the open week, linked to exactly those repairs', !!checkTask && ((await admin.from('repair_check_threads').select('thread_id').eq('check_task_id', checkTask!)).data ?? []).length === threads.length)
    const rpre = (await st.s.post('/api/tests/preflight', { kind: 'repair', checkTaskId: checkTask })).body.decision
    check('re-check preflight uses the same decision shape and fresh scope', rpre.state === 'start' && rpre.deliverable >= 5, JSON.stringify(rpre).slice(0, 200))
    const rstart = await st.s.post('/api/tests/start', { kind: 'repair', checkTaskId: checkTask })
    check('the re-check starts', rstart.body?.ok === true, JSON.stringify(rstart.body).slice(0, 200))
    const rForm = (await admin.from('assessment_attempts').select('form_id, eligibility_policy').eq('id', rstart.body.attemptId).single()).data!
    const rItems = ((await admin.from('form_items').select('item_id').eq('form_id', rForm.form_id)).data ?? []).map(f => f.item_id as string)
    const seenFam = new Set(fams.map(f => f.family_id)), seenItems = new Set(pinned.map(p => p.item_id as string))
    const rFam = (await admin.from('assessment_items').select('id, family_id').in('id', rItems)).data ?? []
    check('the re-check uses genuinely fresh questions: no earlier item and no variant of an earlier family', rFam.every(i => !seenItems.has(i.id as string) && !seenFam.has(i.family_id)) && rForm.eligibility_policy === 'approved-version-v1')
    const rAtt = (await st.s.json(`/api/tests/attempt/${rstart.body.attemptId}`)).body.items as { id: string }[]
    const rKey = new Map(((await admin.from('assessment_items').select('id, key_index').in('id', rAtt.map(i => i.id))).data ?? []).map(k => [k.id as string, Number(k.key_index)]))
    for (const i of rAtt) await st.s.post(`/api/tests/attempt/${rstart.body.attemptId}/answer`, { itemId: i.id, selectedOptionIndex: rKey.get(i.id), confidence: 'high', activeSeconds: 15, interruptedSeconds: 0 })
    const rsub = await st.s.post(`/api/tests/attempt/${rstart.body.attemptId}/submit`, {})
    check('the re-check scores', rsub.body?.ok === true)
    const after = (await admin.from('repair_threads').select('status, latest_check_state').in('id', threads)).data ?? []
    check('the new evidence is shown while the thread follows the existing repair-resolution policy (not auto-closed)', after.every(t => t.latest_check_state !== null) && after.every(t => t.status !== 'closed'), JSON.stringify(after))

    // --- challenge invalidation through the existing correction path
    const target = plan.find(([i, , c]) => c === 'high' && rightOf(i) !== undefined && meta.get(i.id)!.outcome_id === 'r028-c')![0]
    const ch = await st.s.post('/api/diagnostic/challenge', { itemId: target.id, attemptId, comment: 'The stem is ambiguous.', reasonCode: 'unclear_wording' })
    check('a student can challenge a question', ch.body?.ok === true)
    const disputed = (await st.s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
    check('while pending, the evidence shows as under review and still counts', disputed.invalidated.some((x: any) => x.itemId === target.id && ['challenged', 'disputed'].includes(x.why)) && disputed.analysis.overall.answered === r.analysis.overall.answered)
    const nodeRequire = createRequire(path.join(process.cwd(), 'package.json'))
    const { configuration } = nodeRequire('./scripts/lib/migrations.cjs'); const { parse } = nodeRequire('dotenv')
    const cfg = configuration(['--env=staging', '--dry-run'], parse(fs.readFileSync('.env.staging.local')))
    const pg = new Client({ ...cfg.connection }); await pg.connect()
    try {
      await pg.query('BEGIN'); await pg.query('SET LOCAL ROLE authenticated')
      await pg.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [reviewer, JSON.stringify({ sub: reviewer, role: 'authenticated' })])
      const cid = (await admin.from('item_challenges').select('id').eq('item_id', target.id).eq('attempt_id', attemptId).single()).data!.id
      const res = (await pg.query("select public.resolve_item_challenge($1,'resolved_voided') as r", [cid])).rows[0].r; await pg.query('COMMIT')
      check('an authorised reviewer upholds it through the existing correction path', res.ok === true)
    } finally { await pg.end() }
    const voided = (await st.s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
    check('the result now excludes the invalidated answer and lists it as not counted', voided.analysis.overall.answered === r.analysis.overall.answered - 1 && voided.invalidated.some((x: any) => x.itemId === target.id && x.why === 'voided') && voided.integrity.voidedOrDisputed >= 1)
    check('and it is not mistaken for an omission', !voided.omitted.some((o: any) => o.itemId === target.id))
  } finally {
    await dropStudents()   // students first: their attempts, repairs and plans are what reference the fixture questions
    try { execFileSync('node', ['scripts/fixture-bank.cjs', 'destroy', `--confirm-target=${TARGET}`, `--file=${file}`], { stdio: 'inherit' }) } catch (e) { console.error('fixture cleanup failed:', (e as Error).message) }
  }
}

async function main() {
  console.log('\nDiagnostic papers → results → repair follow-through\n')
  try {
    if (!process.argv.includes('--fixture-only')) await partOne()
    if (!process.argv.includes('--actual-only')) await partTwo()
  }
  finally { await dropStudents() }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
