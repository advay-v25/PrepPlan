/**
 * Connected journeys on the CURRENT contracts, with ordinary (non-reviewer) students created for the run and deleted afterwards.
 *   A. learning → paper → repair follow-up (preview/accept) → weekly review (draft/accept) → continuations and preserved minutes
 *   B. exam-target change makes an earlier weekly draft stale; the empty next week then opens cleanly
 *   C. re-check: waiting before its spacing, placed once eligible, started on exactly the intended concepts, threads stay open
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-integration.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const made: string[] = []
type Student = Awaited<ReturnType<typeof createStudent>>

const block = (uid: string, cycleId: string, id: string, o: Record<string, unknown> = {}) => ({
  id, user_id: uid, cycle_id: cycleId, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started',
  local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when', ...o })
const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
const exec = async (st: Student, id: string, execution: string, minutes?: number) =>
  st.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: await rev(id) }) })
const post = (st: Student, p: string, b?: unknown) => st.s.post(p, b)
const activeCycle = async (uid: string) => (await admin.from('planning_cycles').select('id, status, starts_at_local, ends_at_local').eq('user_id', uid).eq('status', 'active')).data ?? []
const planHash = async (uid: string) => JSON.stringify([(await admin.from('plan_blocks').select('id, execution, revision, cycle_id').eq('user_id', uid).order('id')).data, (await admin.from('planning_cycles').select('id, status').eq('user_id', uid).order('id')).data])
async function openCycle(uid: string, startOff: number, endOff: number) {
  const [a, b] = [await activeCycle(uid)].flat()
  await admin.from('planning_cycles').update({ starts_at_local: addDays(today, startOff), ends_at_local: addDays(today, endOff), starts_at: new Date(Date.now() + startOff * 86400000).toISOString(), ends_at: new Date(Date.now() + endOff * 86400000).toISOString() }).eq('id', a.id)
  await admin.from('plan_blocks').delete().eq('cycle_id', a.id)
  return a.id as string
}
const minutesOf = async (id: string) => ((await admin.from('task_events').select('actual_duration_minutes').eq('task_id', id).not('actual_duration_minutes', 'is', null)).data ?? []).reduce((x, e) => x + Number(e.actual_duration_minutes), 0)

async function journeyA() {
  console.log('\nA. Learning → paper → repair follow-up → weekly transition')
  const st = await createStudent(admin, 'a', { onboard: true }); made.push(st.id)
  const roles = (await admin.from('user_roles').select('user_id').eq('user_id', st.id)).data ?? []
  check('the student is ordinary: no reviewer or staff role', roles.length === 0)
  const cyc = await openCycle(st.id, -1, 6)
  await admin.from('plan_blocks').insert(['a', 'b', 'c', 'd', 'e'].map(c => block(st.id, cyc, `ia-${c}`, { title: `Income statement ${c}`, lm_id: 'r028', outcome_id: `r028-${c}` })))
  for (const c of ['a', 'b', 'c', 'd']) await exec(st, `ia-${c}`, 'completed', 30)
  check('partial learning is recorded with its minutes', (await exec(st, 'ia-e', 'partial', 20)).status === 200)

  const preview = (await st.s.json('/api/tests/scope')).body?.preview
  const start = await post(st, '/api/tests/start', { kind: 'weekly', expectedRevision: preview?.scope?.revision })
  check('a weekly paper starts from the completed work', start.body?.ok === true, JSON.stringify(start.body).slice(0, 160))
  const attemptId = start.body?.attemptId as string
  const state = await st.s.json(`/api/tests/attempt/${attemptId}`)
  const items = state.body.items as { id: string; options: string[] }[]
  const keys = new Map(((await admin.from('assessment_items').select('id, key_index').in('id', items.map(i => i.id))).data ?? []).map(r => [r.id as string, Number(r.key_index)]))
  for (const it of items) await post(st, `/api/tests/attempt/${attemptId}/answer`, { itemId: it.id, selectedOptionIndex: (keys.get(it.id)! + 1) % it.options.length, confidence: 'high', activeSeconds: 20, interruptedSeconds: 0 })
  const sub = await post(st, `/api/tests/attempt/${attemptId}/submit`, {})
  check('the paper is submitted and scored', sub.body?.ok === true, JSON.stringify(sub.body).slice(0, 120))

  const read = await st.s.json(`/api/diagnostic/repair?attemptId=${attemptId}`)
  check('the repair follow-up lists proposable gaps', read.body?.ok === true && (read.body.proposable ?? 0) > 0, JSON.stringify(read.body).slice(0, 140))
  check('the retired repair endpoint returns 410', (await post(st, '/api/diagnostic/repair', { attemptId })).status === 410)

  const before = await planHash(st.id)
  const prev = await post(st, '/api/diagnostic/repair/preview', { attemptId })
  check('a repair proposal is previewed', prev.body?.ok === true && typeof prev.body.proposalId === 'string', JSON.stringify(prev.body).slice(0, 140))
  check('previewing changes no accepted task, execution or cycle', before === await planHash(st.id))
  const key = `integ-${Date.now()}`
  const acc = await post(st, '/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: key })
  const taskIds = (acc.body?.taskIds ?? []) as string[]
  check('acceptance creates the planned tasks', acc.body?.ok === true && taskIds.length > 0, JSON.stringify(acc.body).slice(0, 140))
  const repairs = (await admin.from('plan_blocks').select('id, task_type, repair_thread_id, revision').in('id', taskIds)).data ?? []
  check('every repair task is linked to its thread', repairs.filter(t => t.task_type === 'repair').length > 0 && repairs.filter(t => t.task_type === 'repair').every(t => t.repair_thread_id))
  const afterAccept = await planHash(st.id)
  const retry = await post(st, '/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: key })
  check('a retry replays the original receipt and changes nothing', retry.body?.ok === true && retry.body.replayed === true && afterAccept === await planHash(st.id))

  // Finish one repair, then close the week.
  const firstRepair = repairs.find(t => t.task_type === 'repair')!
  check('a repair can be finished and its minutes are recorded', (await exec(st, firstRepair.id, 'completed', 25)).status === 200)
  const doneMinutes = { e: await minutesOf('ia-e'), repair: await minutesOf(firstRepair.id) }
  await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: today }).eq('id', cyc)
  await admin.from('plan_blocks').update({ local_date: today, day: today }).eq('cycle_id', cyc).neq('execution', 'completed')   // time-shift fixture: everything unfinished is now due
  const wk = await st.s.json('/api/weekly-review/state')
  const due = (wk.body?.state?.dueTasks ?? []) as { id: string; execution: string }[]
  check('the review lists the unfinished work', due.length > 0, JSON.stringify(wk.body?.state?.gate))
  const choices: Record<string, unknown> = {}
  for (const t of due) choices[t.id] = t.execution === 'partial' ? { happened: 'partial', next: 'continue', estimateMinutes: 25 } : { happened: 'not_done', next: 'continue', estimateMinutes: 30 }
  const hash0 = await planHash(st.id)
  const pr = await post(st, '/api/weekly-review/preview', { cycleId: cyc, choices, acknowledgeNoPaper: wk.body?.state?.gate?.kind === 'no_paper_allowed' })
  check('the transition draft is saved', pr.body?.ok === true && typeof pr.body.draftId === 'string', JSON.stringify(pr.body).slice(0, 200))
  check('saving the draft changes no accepted task, execution or cycle', hash0 === await planHash(st.id))
  const ac = await post(st, '/api/weekly-review/accept', { draftId: pr.body.draftId })
  check('the draft is accepted', ac.body?.ok === true && ac.body.continued === due.length, JSON.stringify(ac.body).slice(0, 160))
  const cycles = await activeCycle(st.id)
  check('exactly one cycle is active and it is the successor', cycles.length === 1 && cycles[0].id === ac.body?.nextCycleId)
  const succ = (await admin.from('plan_blocks').select('id, continued_from_task_id, repair_thread_id, execution, cycle_id').not('continued_from_task_id', 'is', null).eq('user_id', st.id)).data ?? []
  check('each unfinished task continues once, in the new cycle', succ.length === due.length && succ.every(t => t.cycle_id === cycles[0].id && t.execution === 'not_started'))
  const origThreads = new Map(((await admin.from('plan_blocks').select('id, repair_thread_id').in('id', succ.map(t => t.continued_from_task_id as string))).data ?? []).map(t => [t.id as string, t.repair_thread_id]))
  check('repair continuations keep their thread link', succ.every(t => (origThreads.get(t.continued_from_task_id as string) ?? null) === (t.repair_thread_id ?? null)))
  check('historical minutes are untouched (20 on the partial task, 25 on the finished repair)', (await minutesOf('ia-e')) === doneMinutes.e && (await minutesOf(firstRepair.id)) === doneMinutes.repair && doneMinutes.e === 20)
  check('the successors carry none of those minutes', (await Promise.all(succ.map(t => minutesOf(t.id)))).every(m => m === 0))
  return st
}

async function journeyB() {
  console.log('\nB. Exam target changes → earlier draft stale → empty next week opens')
  const st = await createStudent(admin, 'b', { onboard: true }); made.push(st.id)
  const cyc = await openCycle(st.id, -6, 0)
  await admin.from('plan_blocks').insert(block(st.id, cyc, 'ib-x', { title: 'Will be removed' }))
  const choices = { 'ib-x': { happened: 'not_done', next: 'remove' } }
  const gate = (await st.s.json('/api/weekly-review/state')).body?.state?.gate?.kind
  const ack = gate === 'no_paper_allowed'
  const pr = await post(st, '/api/weekly-review/preview', { cycleId: cyc, choices, acknowledgeNoPaper: ack })
  check('a weekly draft is saved', pr.body?.ok === true, JSON.stringify(pr.body).slice(0, 180))
  // The exam target a student edits lives on the profile and is changed through the onboarding "exam" step (Settings → Your exam → Change).
  const prof = (await admin.from('profiles').select('exam_date, exam_window_id, timezone').eq('id', st.id).single()).data!
  check('the student has an exam target', Boolean(prof.exam_date && prof.exam_window_id))
  const oldDate = String(prof.exam_date).slice(0, 10), newDate = oldDate.slice(0, 8) + (oldDate.endsWith('-21') ? '22' : '21')
  const upd = await post(st, '/api/onboarding/exam', { examWindowId: prof.exam_window_id, registered: true, examDate: newDate, timezone: prof.timezone ?? 'Europe/London' })
  check('the exam target changes through the authorised route', upd.status === 200 && upd.body?.ok === true, JSON.stringify(upd.body).slice(0, 160))
  check('and it persisted', String((await admin.from('profiles').select('exam_date').eq('id', st.id).single()).data?.exam_date).slice(0, 10) === newDate)
  const hash0 = await planHash(st.id)
  const stale = await post(st, '/api/weekly-review/accept', { draftId: pr.body.draftId })
  check('accepting the earlier draft is refused as stale', stale.status === 409 && stale.body?.code === 'stale', JSON.stringify(stale.body).slice(0, 160))
  check('nothing was partly committed', hash0 === await planHash(st.id) && (await activeCycle(st.id)).length === 1 && (await activeCycle(st.id))[0].id === cyc)
  const draft = (await admin.from('weekly_transition_drafts').select('choices').eq('id', pr.body.draftId).maybeSingle()).data
  check('the review answers are still stored on the stale draft', (draft?.choices as any)?.['ib-x']?.next === 'remove')
  const pr2 = await post(st, '/api/weekly-review/preview', { cycleId: cyc, choices, acknowledgeNoPaper: ack })
  const ac = await post(st, '/api/weekly-review/accept', { draftId: pr2.body?.draftId })
  check('the same answers, prepared again, are accepted: an empty next week is valid', ac.body?.ok === true && ac.body.continued === 0, JSON.stringify(ac.body).slice(0, 160))
  const cycles = await activeCycle(st.id)
  check('the successor cycle is active (not a failed activation)', cycles.length === 1 && cycles[0].id === ac.body?.nextCycleId)
  const after = await st.s.json('/api/weekly-review/state')
  check('the weekly state sees the new open cycle', after.body?.ok === true && after.body.state?.status === 'active', JSON.stringify(after.body?.state?.status))
  check('the Calendar renders it', (await st.s.req('/app/calendar')).status === 200)
  check('onboarding stays complete', (await admin.from('profiles').select('onboarding_status').eq('id', st.id).single()).data?.onboarding_status === 'complete')
}

async function journeyC() {
  console.log('\nC. Re-check: waiting → eligible → placed once → started on the intended concepts only')
  const st = await createStudent(admin, 'c', { onboard: true }); made.push(st.id)
  const cyc = await openCycle(st.id, -1, 6)
  const rows = (await admin.from('student_eligible_items').select('concept_id').not('concept_id', 'is', null)).data ?? []   // approved for their exact version: what a paper may actually use
  const per = new Map<string, number>(); for (const r of rows) per.set(r.concept_id as string, (per.get(r.concept_id as string) ?? 0) + 1)
  const ranked = [...per.entries()].sort((x, y) => y[1] - x[1]); const picked: string[] = []; let supply = 0
  for (const [c, n] of ranked) { if (supply >= 6 || picked.length >= 3) break; picked.push(c); supply += Math.min(n, 3) }
  if (supply < 5) { console.log(`  (the bank supports only ${supply} reviewed questions across its deepest concepts: the eligible re-check cannot start live. Insufficient-bank path only.)`); }
  const manifest = (await admin.from('curriculum_concepts').select('manifest_id').eq('id', picked[0]).single()).data!.manifest_id
  const threads: string[] = []
  for (const c of picked) { const t = await admin.from('repair_threads').insert({ user_id: st.id, concept_id: c, manifest_id: manifest, status: 'scheduled', latest_evidence_at: new Date().toISOString() }).select('id').single(); threads.push(t.data!.id as string) }
  await admin.from('plan_blocks').insert(threads.map((t, i) => block(st.id, cyc, `ic-r${i}`, { title: `Repair ${i}`, task_type: 'repair', origin: 'diagnostic', repair_thread_id: t })))
  const unfinished = await post(st, '/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `c-unf-${Date.now()}` })
  check('unfinished repairs cannot produce a re-check', unfinished.status === 409 && unfinished.body?.ok === false, JSON.stringify(unfinished.body).slice(0, 140))
  for (let i = 0; i < threads.length; i++) await exec(st, `ic-r${i}`, 'completed', 20)
  const status = (await admin.from('repair_threads').select('status').in('id', threads)).data ?? []
  check('finished repairs leave the threads open, awaiting their re-check', status.every(t => t.status === 'awaiting_recheck'), status.map(t => t.status).join(','))
  const checkTasks = async () => (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'recheck')).data ?? []

  await admin.from('repair_threads').update({ next_recheck_due_at: new Date(Date.now() + 12 * 86400000).toISOString() }).in('id', threads)   // spacing not yet reached, beyond this week
  const early = await post(st, '/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `c-early-${Date.now()}` })
  check('before the spacing is up, the re-check stays waiting and nothing is placed', early.status === 409 && (await checkTasks()).length === 0, JSON.stringify(early.body).slice(0, 140))

  await admin.from('repair_threads').update({ next_recheck_due_at: new Date(Date.now() - 86400000).toISOString() }).in('id', threads)   // deliberately dated history
  const key = `c-ok-${Date.now()}`
  const placed = await post(st, '/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: key })
  check('once eligible, the re-check is placed in the open week', placed.body?.ok === true && typeof placed.body.checkTaskId === 'string', JSON.stringify(placed.body).slice(0, 160))
  const again = await post(st, '/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: key })
  const other = await post(st, '/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `${key}-other` })
  check('repeating the request creates no second re-check', (await checkTasks()).length === 1 && (again.body?.ok !== true || again.body.checkTaskId === placed.body.checkTaskId) && other.body?.ok !== true)
  const linked = (await admin.from('repair_check_threads').select('thread_id').eq('check_task_id', placed.body.checkTaskId)).data ?? []
  check('it is linked to exactly the finished repairs', linked.length === threads.length && linked.every(l => threads.includes(l.thread_id as string)))

  if (supply < 5) {
    const r = await post(st, '/api/tests/start', { kind: 'repair', checkTaskId: placed.body.checkTaskId })
    check('with too little eligible bank depth the start is refused honestly', r.body?.ok === false && /bank|question|enough/i.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 200)); return
  }
  // Deliberately dated history: the repairs were finished five days ago (the spacing rule itself is not touched).
  const repairIds = (await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('task_type', 'repair')).data?.map(r => r.id as string) ?? []
  const back = await admin.from('task_events').update({ created_at: new Date(Date.now() - 5 * 86400000).toISOString() }).in('task_id', repairIds).eq('event_type', 'completed')
  check('the repair history can be dated for the test', !back.error, back.error?.message)
  const attemptsBefore = (await admin.from('assessment_attempts').select('id').eq('user_id', st.id)).data?.length ?? 0
  const started = await post(st, '/api/tests/start', { kind: 'repair', checkTaskId: placed.body.checkTaskId })
  if (started.body?.ok !== true) { check('the re-check starts, or is honestly refused for bank depth', started.body?.code === 'bank_insufficient', JSON.stringify(started.body).slice(0, 220)); console.log('  (refused: insufficient unseen eligible questions for this scope; the isolated-suite success path stands)'); return }
  const attempt = started.body.attemptId as string
  const form = (await admin.from('assessment_attempts').select('form_id').eq('id', attempt).single()).data!.form_id
  const formConcepts = new Set(((await admin.from('form_items').select('assessment_items(concept_id)').eq('form_id', form)).data ?? []).map((r: any) => r.assessment_items?.concept_id))
  check('the paper covers only the intended concepts', formConcepts.size > 0 && [...formConcepts].every(c => picked.includes(c as string)), [...formConcepts].join(','))
  const resumed = await post(st, '/api/tests/start', { kind: 'repair', checkTaskId: placed.body.checkTaskId })
  check('starting again resumes the same paper; no duplicate attempt', resumed.body?.attemptId === attempt && ((await admin.from('assessment_attempts').select('id').eq('user_id', st.id)).data?.length ?? 0) === attemptsBefore + 1)
  const st2 = (await admin.from('repair_threads').select('status').in('id', threads)).data ?? []
  check('the threads are still open (no automatic closure)', st2.every(t => t.status !== 'closed'))
}

async function main() {
  console.log('\nIntegration journeys (current contracts)\n')
  const only = (process.env.JOURNEYS ?? 'A,B,C').split(',')
  try { if (only.includes('A')) await journeyA(); if (only.includes('B')) await journeyB(); if (only.includes('C')) await journeyC() }
  finally { for (const id of made) await admin.auth.admin.deleteUser(id); console.log(`\nDeleted ${made.length} student fixtures.`) }
  finish()
}
main().catch(e => { console.error('Crashed:', e); process.exit(1) })
