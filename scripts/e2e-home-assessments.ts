/**
 * Home through the assessment loop. TWO separate parts, never blended:
 *   1. ACTUAL BANK (nothing created): an unavailable-bank week and its permitted weekly review.
 *   2. FIXTURE BANK (test-only approved questions made and removed by scripts/fixture-bank.cjs; ordinary throwaway students): running paper → resume →
 *      scored result → repair proposal → accept → Calendar → finished repair → waiting re-check → eligible re-check, plus stale and cross-account selection.
 * Fixture results say nothing about the live bank. Students and fixtures are removed by recorded id.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-home-assessments.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const TARGET = 'asylsxszdhlnzewhwtga'
const made: string[] = []
type Student = Awaited<ReturnType<typeof createStudent>>
const strip = (h: string) => h.replace(/<!-- -->/g, '')
const home = async (st: Student) => strip(await (await st.s.req('/app')).text())
const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
const exec = async (st: Student, id: string, execution: string, minutes?: number) => st.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: await rev(id) }) })

/** A cycle around today whose five 30-minute study tasks (reading r028, five outcomes) the student completes: confirmed scope for a paper. */
async function completeScope(st: Student, tag: string) {
  const { data } = await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active'); const cyc = data![0].id as string
  await admin.from('planning_cycles').update({ starts_at_local: add(today, -1), ends_at_local: add(today, 6), starts_at: new Date(Date.now() - 86400000).toISOString(), ends_at: new Date(Date.now() + 6 * 86400000).toISOString() }).eq('id', cyc)
  const old = ((await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('cycle_id', cyc)).data ?? []).map(r => r.id as string)
  if (old.length) await admin.from('plan_blocks').delete().in('id', old).eq('user_id', st.id)
  const ids = ['a', 'b', 'c', 'd', 'e'].map(c => `${tag}-${c}`)
  await admin.from('plan_blocks').insert(['a', 'b', 'c', 'd', 'e'].map(c => ({ id: `${tag}-${c}`, user_id: st.id, cycle_id: cyc, title: `Income statement ${c}`, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', lm_id: 'r028', outcome_id: `r028-${c}` })))
  for (const id of ids) await exec(st, id, 'completed', 30)
  return cyc
}

async function partOne() {
  console.log('1. ACTUAL BANK (nothing created): unavailable week → permitted weekly review')
  const live = (await admin.from('student_eligible_items').select('id', { count: 'exact', head: true })).count ?? 0
  if (live > 0) { console.log(`  (skipped: ${live} eligible questions exist, so this is not the empty live bank)`); return }
  const st = await createStudent(admin, 'hu', { onboard: true }); made.push(st.id)
  const cyc = await completeScope(st, 'hu')
  let h = await home(st)
  check('Home states the actual reason a weekly paper is unavailable, and points at availability', /checked questions are missing|not available yet/i.test(h) && h.includes('/app/tests'))
  await admin.from('planning_cycles').update({ ends_at_local: today }).eq('id', cyc)
  const gate = (await st.s.json('/api/weekly-review/state')).body?.state?.gate
  check('the canonical gate permits closing without a paper', gate?.kind === 'no_paper_allowed', JSON.stringify(gate))
  h = await home(st)
  check('Home carries that reason into the closure recommendation (no promise of a paper)', /Close the week/.test(h) && /without a paper|No paper could be assembled/i.test(h) && !/paper is ready/i.test(h))
  check('…and the week review link is the real destination', h.includes('/app/review-week'))
}

/** Fixture questions that existed before this run (another worker's bank) and the ones this run made, recorded by id. */
let preIds: string[] = [], ownedIds: string[] = []
const chunks = <T,>(a: T[], n = 100) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))
const countIn = async (ids: string[]) => { let n = 0; for (const c of chunks(ids)) n += (await admin.from('assessment_items').select('id', { count: 'exact', head: true }).in('id', c)).count ?? 0; return n }

async function partTwo() {
  console.log('\n2. FIXTURE BANK (test-only): running paper → result → repair → re-check')
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'home-assess-')), 'bank.json')
  preIds = ((await admin.from('assessment_items').select('id').like('id', 'fxb-%').limit(5000)).data ?? []).map(r => r.id as string)
  execFileSync('node', ['scripts/fixture-bank.cjs', 'create', `--confirm-target=${TARGET}`, `--out=${file}`, '--readings=r028', '--per-outcome=6', '--variants=2'], { stdio: 'inherit' })
  ownedIds = JSON.parse(fs.readFileSync(file, 'utf8')).items as string[]
  try {
    const st = await createStudent(admin, 'hf', { onboard: true }); made.push(st.id)
    const other = await createStudent(admin, 'hx', { onboard: true }); made.push(other.id)
    await completeScope(st, 'hf')
    const scope = (await st.s.json('/api/tests/scope')).body.preview
    let h = await home(st)
    check('before starting: the paper is "upcoming" (available early, due on its day), not the primary action', !/Your (diagnostic|revisionary|mixed) paper is ready/.test(h) && /available now, due|Start paper/.test(h))
    const start = await st.s.post('/api/tests/start', { kind: 'weekly', expectedRevision: scope.revision })
    const attemptId = start.body.attemptId as string
    h = await home(st)
    check('a running paper: Home recommends Resume, with the real clock policy (untimed → no limit, can pause)', /Resume your/.test(h) && /Resume paper/.test(h) && /no time limit/i.test(h), (/next-up[\s\S]{0,500}/.exec(h) ?? [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 200))
    check('…and its destination is that attempt', h.includes(`/app/tests/${attemptId}`))
    const resumed = await st.s.post('/api/tests/start', { kind: 'weekly' })
    check('resuming reaches the same attempt', resumed.body?.attemptId === attemptId && resumed.body.resumed === true)

    // answer everything: a wrong+sure outcome produces a genuine repair
    const items = (await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items as { id: string; options: string[] }[]
    const meta = new Map(((await admin.from('assessment_items').select('id, outcome_id, key_index').in('id', items.map(i => i.id))).data ?? []).map(r => [r.id as string, r]))
    for (const i of items) {
      const o = String(meta.get(i.id)!.outcome_id), key = Number(meta.get(i.id)!.key_index)
      const wrong = o.endsWith('-a') || o.endsWith('-d')
      await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: i.id, selectedOptionIndex: wrong ? (key + 1) % i.options.length : key, confidence: o.endsWith('-d') ? 'low' : 'high', activeSeconds: 12, interruptedSeconds: 0 })
    }
    const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
    check('the paper is scored', sub.body?.ok === true)
    h = await home(st)
    check('Home → scored result: "Your paper has been scored" with the result as its destination', /Your paper has been scored|See result/.test(h) && h.includes(`/app/tests/${attemptId}/result`))

    // repair loop
    const prev = await st.s.post('/api/diagnostic/repair/preview', { attemptId })
    const acc = await st.s.post('/api/diagnostic/repair/accept', { proposalId: prev.body.proposalId, idempotencyKey: `hf-${Date.now()}` })
    const taskIds = (acc.body?.taskIds ?? []) as string[]
    const tasks = (await admin.from('plan_blocks').select('id, local_date, task_type, repair_thread_id').in('id', taskIds)).data ?? []
    check('accepting the repair proposal adds linked tasks to Calendar', acc.body?.ok === true && tasks.length > 0)
    const repairs = tasks.filter(t => t.task_type === 'repair'), threads = [...new Set(repairs.map(t => t.repair_thread_id as string))]
    const pid = prev.body.proposalId as string

    // exact destinations: the repair and the proposal
    let page = strip(await (await st.s.req(`/app/coach?repair=${threads[0]}`)).text())
    check('/app/coach?repair=<id> shows the weak area, its current status and its Calendar work', /Weak area ·/.test(page) && /Repair work is on your Calendar|planned work|You are working/.test(page) && page.includes('/app/calendar?'), page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 200))
    page = strip(await (await st.s.req(`/app/coach?proposal=${pid}`)).text())
    check('/app/coach?proposal=<id> shows the suggestion and its status (executed after acceptance)', /Suggestion ·/.test(page) && /executed|Already applied/.test(page), page.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160))
    const foreign = strip(await (await other.s.req(`/app/coach?repair=${threads[0]}`)).text()), foreignP = strip(await (await other.s.req(`/app/coach?proposal=${pid}`)).text())
    check('another student opening those links sees only "not available": no title, status or tasks', /not available/.test(foreign) && /not available/.test(foreignP) && !/Weak area ·/.test(foreign) && !/Suggestion ·/.test(foreignP))
    const bogus = strip(await (await st.s.req('/app/coach?repair=not-a-uuid&proposal=00000000-0000-4000-8000-000000000000')).text())
    check('a malformed id is ignored and a missing one reads as not available', /not available/.test(bogus) && !/Weak area ·|Suggestion ·/.test(bogus))
    h = await home(st)
    check('Home never sends a repair or proposal to a generic Coach question: its links name the object', !/\/app\/coach\?q=/.test(h))
    const stale = (await admin.from('coach_proposals').insert({ user_id: st.id, intent: 'x', proposed_changes: { moves: [] }, reasoning: 'r', status: 'stale', origin: 'coach', kind: 'defer', title: 'Old suggestion' }).select('id').single()).data!.id as string
    const sp = strip(await (await st.s.req(`/app/coach?proposal=${stale}`)).text())
    check('a stale proposal says the plan changed and offers no Confirm', /no longer applies|plan changed/i.test(sp) && !/>Confirm</.test(sp.split('Suggestion')[1] ?? ''))
    await admin.from('coach_proposals').delete().eq('id', stale).eq('user_id', st.id)

    for (const t of repairs) await exec(st, t.id, 'completed', 25)
    const check1 = (await admin.from('plan_blocks').select('id, local_date').eq('user_id', st.id).eq('task_type', 'recheck').is('cancelled_at', null)).data?.[0]
    let checkTask = check1?.id as string | undefined
    if (!checkTask) { const placed = await st.s.post('/api/diagnostic/repair/check', { threadIds: threads, idempotencyKey: `hf-chk-${Date.now()}` }); checkTask = placed.body?.checkTaskId }
    if (checkTask) await admin.from('plan_blocks').update({ local_date: today, day: today }).eq('id', checkTask).eq('user_id', st.id)
    h = await home(st)
    check('finished repair → the re-check WAITS (spacing), with the reason, and cannot be marked done', !!checkTask && /Waiting|can start from|Finish the repair/.test(h) && !/Mark .*Re-?check.* done/i.test(h))
    const refuse = await exec(st, checkTask!, 'completed', 10)
    check('the command boundary refuses to complete the re-check by hand', refuse.status === 409 && refuse.body.code === 'SYSTEM_ASSESSMENT')
    await admin.from('task_events').update({ created_at: new Date(Date.now() - 5 * 86400000).toISOString() }).in('task_id', repairs.map(t => t.id)).eq('event_type', 'completed')
    await admin.from('repair_threads').update({ next_recheck_due_at: new Date(Date.now() - 86400000).toISOString() }).in('id', threads)
    h = await home(st)
    check('after the spacing: the re-check is eligible and Home offers Start check', /Start check|Start your re-check/.test(h), (/re-check[\s\S]{0,300}/i.exec(h) ?? [''])[0].replace(/<[^>]+>/g, ' ').slice(0, 160))
    const rstart = await st.s.post('/api/tests/start', { kind: 'repair', checkTaskId: checkTask })
    h = await home(st)
    check('a started re-check is resumed from Home', rstart.body?.ok === true && /Resume (your )?(re-)?check/i.test(h) || /Resume check/.test(h))

    // follow-up completion: opening the result and having no repair needing a decision ends the recommendation
    await st.s.post(`/api/tests/attempt/${attemptId}/viewed`, {})
    const viewed = (await admin.from('assessment_attempts').select('result_viewed_at').eq('id', attemptId).single()).data?.result_viewed_at
    const openThreads = ((await admin.from('repair_threads').select('id').eq('opened_from_attempt_id', attemptId).in('status', ['open', 'proposed'])).data ?? []).length
    h = await home(st)
    check('once the result is opened and its repairs are decided, the same result is no longer recommended', !!viewed && openThreads === 0 && !/Your paper has been scored/.test(h), `viewed=${!!viewed} open=${openThreads}`)
    const foreignView = await other.s.post(`/api/tests/attempt/${attemptId}/viewed`, {})
    check('another student cannot mark someone else’s result as viewed', foreignView.status === 404)
  } finally {
    for (const id of made.splice(0)) await admin.auth.admin.deleteUser(id)
    try { execFileSync('node', ['scripts/fixture-bank.cjs', 'destroy', `--confirm-target=${TARGET}`, `--file=${file}`], { stdio: 'inherit' }) } catch (e) { console.error('fixture cleanup failed:', (e as Error).message) }
  }
}

async function main() {
  console.log('\nHome through the assessment loop\n')
  try { await partOne(); await partTwo() } finally { for (const id of made.splice(0)) await admin.auth.admin.deleteUser(id) }
  check('every fixture question this run made is removed (by recorded id)', ownedIds.length > 0 && await countIn(ownedIds) === 0)
  check('another worker\'s fixture questions were left untouched', await countIn(preIds) === preIds.length)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
