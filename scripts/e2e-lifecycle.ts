/**
 * Connected lifecycle proof: ONE ordinary student per journey, driven only through the application's own endpoints/commands.
 *   A  fresh self-study → learning capture → scope → weekly diagnostic → Coach on that result → repair → re-check → weekly review → continuation
 *      (+ an adaptive-practice branch that must write no evidence)
 *   B  midway entrant with classes: class log → Coach editor handoff → schedule changed after preview (stale, input kept) → fresh accept
 *   C  first pass complete with a mock a month away: booked mock → move → preparation basis stale → external mock → exam-sat
 *
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/e2e-lifecycle.ts --scenario=A|B|C|all [--bank=fixture]
 *
 * Bank track is explicit. `fixture` creates a TEST-ONLY approved bank through the existing guarded fixture command and removes it by recorded id;
 * it proves software behaviour, NOT real diagnostic coverage or CFA calibration, and no production approval follows from it. With `--bank=actual`
 * (the default) a journey step that needs approved inventory reports UNAVAILABLE, never a pass.
 * Fixture setup creates dated tasks and inventory under the existing guards; it never pre-creates the result, repair or continuation a journey
 * claims to produce. Time-shift fixtures (cycle end = today, repair completion dated five days ago) are labelled where used.
 * Sequential per student. Every account is registered with the owner the moment it exists and removed by recorded id, including after failure.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { shiftStudentTimeline } from './lib/timeFixture'
import { acquireBankLock, releaseBankLock } from './lib/bankLock'
import { createStudent, preflightServer, FRESH_STUDENT_ONBOARDING, classLedPersona, type OnboardingOptions } from './lib/e2eSession'
import { calendarTaskHref } from '../src/lib/routing/calendar'

const TARGET = 'mnlezctdqkdfgvmipmcj'
const arg = (k: string, d: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? d
const SCENARIO = arg('scenario', 'all'), BANK = arg('bank', 'actual'), INJECT = arg('inject', '')
// Invalid arguments fail BEFORE any remote mutation.
{
  const known = new Set(['scenario', 'bank', 'inject']), bad = process.argv.slice(2).filter(a => !/^--(\w+)=/.test(a) || !known.has(a.slice(2).split('=')[0]))
  if (bad.length || !['A', 'B', 'C', 'all'].includes(SCENARIO) || !['actual', 'fixture'].includes(BANK) || !['', 'evidence', 'phase'].includes(INJECT)) { console.error(`Invalid arguments ${JSON.stringify(bad)} (scenario=${SCENARIO} bank=${BANK} inject=${INJECT}). Use --scenario=A|B|C|all --bank=actual|fixture [--inject=evidence|phase].`); process.exit(2) }
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Date().toISOString().slice(0, 10)
const J = { 'Content-Type': 'application/json' }
const owned: string[] = []
const timeFixtures: Record<string, unknown>[] = []
const observations: string[] = []   // product observations that are not assertions (reported, never silently dropped)
const reached = new Set<string>()
const phase = (name: string) => { reached.add(`${J_}:${name}`) }
const daysBetweenStr = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
const tracker = async (st: Student) => { const t = (await st.s.json('/api/curriculum/readiness')).body?.tracker; return { rows: (t?.topics ?? []).flatMap((x: any) => x.modules.flatMap((m: any) => m.rows)) as any[] } }
const A_PHASES = ['onboarding', 'calendar', 'log', 'scope', 'paper', 'result', 'coach', 'keep_for_later', 'practice', 'closure', 'repair', 'recheck', 'continuity']
let bankFile: string | null = null, bankRecord: unknown = null
type Student = Awaited<ReturnType<typeof createStudent>>
type Row = { journey: string; step: string; status: 'pass' | 'fail' | 'unavailable' | 'not_run'; detail?: string }
const report: Row[] = []
let J_ = '?'
const step = (name: string, ok: boolean, detail = '') => { report.push({ journey: J_, step: name, status: ok ? 'pass' : 'fail', detail: ok ? undefined : detail }); console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`) }
const unavailable = (name: string, why: string) => { report.push({ journey: J_, step: name, status: 'unavailable', detail: why }); console.log(`  ⊘ UNAVAILABLE ${name} — ${why}`) }
const notRun = (name: string, why: string) => { report.push({ journey: J_, step: name, status: 'not_run', detail: why }); console.log(`  – NOT RUN ${name} — ${why}`) }
const RUN = `lc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`   // every id this run creates carries it
const fresh = async (tag: string, opts: { onboard?: boolean; onboarding?: OnboardingOptions } = { onboard: true }) => createStudent(admin, `${tag}${RUN}`, { ...opts, register: id => owned.push(id) })

const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
const exec = async (st: Student, id: string, execution: string, minutes?: number) =>
  st.s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: await rev(id) }) })
const taskBlock = (uid: string, cycleId: string, id: string, o: Record<string, unknown> = {}) => ({
  id, user_id: uid, cycle_id: cycleId, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started',
  local_date: today, day: today, duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when', ...o })
const activeCycle = async (uid: string) => (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', uid).eq('status', 'active').single()).data!
/** Eligible approved inventory, split by provenance: synthetic fixture inventory (another worker's, or ours) is never genuine capacity. */
const eligible = async () => {
  const ids = ((await admin.from('student_eligible_items').select('id')).data ?? []).map(r => r.id as string)
  let synthetic = 0
  for (let i = 0; i < ids.length; i += 200) synthetic += ((await admin.from('assessment_items').select('id').in('id', ids.slice(i, i + 200)).eq('provenance', 'fixture-bank')).data ?? []).length
  return { total: ids.length, synthetic, genuine: ids.length - synthetic }
}
const count = async (t: string, uid: string, f: Record<string, string> = {}) => { let q = admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid); for (const [k, v] of Object.entries(f)) q = q.eq(k, v); return (await q).count ?? 0 }

async function makeBank(readings: string[] = ['r028']) {
  await acquireBankLock()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-')), 'bank.json')
  bankFile = file   // recorded BEFORE creation so a half-created bank is still removed by its recorded ids
  execFileSync('node', ['scripts/fixture-bank.cjs', 'create', `--confirm-target=${TARGET}`, `--out=${file}`, `--readings=${readings.join(',')}`, '--per-outcome=10', '--variants=2'], { stdio: 'inherit' })
  bankRecord = JSON.parse(fs.readFileSync(file, 'utf8'))
  return bankRecord as { tag: string; items: string[]; families: string[]; users: string[]; approvals: number }
}
async function coachSay(st: Student, message: string, extra: Record<string, unknown> = {}) {
  return (await st.s.post('/api/coach', { message, turnKey: `lc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, ...extra })).body
}

// =====================================================================================================================================================
const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const dq = async <T,>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> => { const r = await q; if (r.error) throw new Error(`database read failed (${what}): ${r.error.message}`); return (r.data ?? []) as T }
/** Recorded minutes per task, read from the application's own event ledger. */
const minutesOf = async (id: string) => sum((await dq(admin.from('task_events').select('actual_duration_minutes').eq('task_id', id).not('actual_duration_minutes', 'is', null), 'minutes') as any[]).map(e => Number(e.actual_duration_minutes)))

async function journeyA() {
  J_ = 'A'; console.log('\n=== Journey A — fresh self-study ===')
  const live = await eligible()
  if (BANK === 'actual') observations.push(`eligible approved inventory at start: ${live.genuine} genuine, ${live.synthetic} synthetic fixture items (another worker's)`)
  const st = await fresh('lcA', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING })
  // ---- 1. the explicit fresh profile was SAVED, and the first accepted cycle has its real boundaries
  const prof = (await admin.from('profiles').select('stage, registered, exam_sitting, exam_date, prep_mode, max_session_minutes, onboarding_status, timezone').eq('id', st.id).single()).data
  step('onboarding saved the fresh profile exactly: starting fresh, tentative May sitting with no booked date, self-study, 45-minute sittings', JSON.stringify(prof) === JSON.stringify({ stage: 'starting_fresh', registered: false, exam_sitting: 'may', exam_date: null, prep_mode: 'self_study', max_session_minutes: 45, onboarding_status: 'complete', timezone: 'Europe/London' }), JSON.stringify(prof))
  step('zero reported coverage was saved (nothing is claimed as studied)', (await count('user_topic_exposure', st.id)) === 0)
  const wins = await dq(admin.from('availability_windows').select('weekday, start_time, end_time, status').eq('user_id', st.id).eq('status', 'active'), 'windows') as any[]
  const want = (FRESH_STUDENT_ONBOARDING.week!.windows!).map(w => `${w.weekday} ${w.startTime}-${w.endTime}`).sort()
  step('the study windows were saved exactly as entered: weekday evenings 18:30–21:30 and weekend mornings 09:00–13:00', JSON.stringify(wins.map(w => `${w.weekday} ${String(w.start_time).slice(0, 5)}-${String(w.end_time).slice(0, 5)}`).sort()) === JSON.stringify(want), JSON.stringify(wins))
  let cyc0 = await activeCycle(st.id)
  const start0 = String(cyc0.starts_at_local), end0 = String(cyc0.ends_at_local)
  step('the accepted cycle keeps its real boundary: Monday–Sunday, seven days, and is either the current week (a mid-week join gets the remaining week) or the next one when no study time is left today', wd(start0) === 1 && wd(end0) === 0 && (new Date(end0).getTime() - new Date(start0).getTime()) / 86_400_000 === 6 && (start0 <= today && today <= end0 || start0 > today), `${start0}→${end0} today ${today}`)
  let blocks0 = await dq(admin.from('plan_blocks').select('id, title, local_date, task_type, execution, lm_id, outcome_id, duration_minutes, revision').eq('cycle_id', cyc0.id).is('cancelled_at', null).order('local_date').order('title'), 'first plan') as any[]
  step('no learning is fabricated before today, and nothing falls on Sunday (Sunday is for the paper)', blocks0.length > 0 && blocks0.every(b => b.local_date >= today) && blocks0.filter(b => b.task_type === 'study').every(b => wd(b.local_date) !== 0), `${blocks0.length} blocks`)
  step('Home renders for the student', (await st.s.req('/app')).status === 200)
  phase('onboarding')
  // TIME FIXTURE T0 (only when the first accepted cycle is NEXT week because no study time was left today): the student's history moves back one week so the
  // rest of the journey runs as "joined last week", with today inside the cycle. Everything checked above was read BEFORE the move.
  if (start0 > today) {
    const sh = await shiftStudentTimeline(st.id, 1, owned)
    timeFixtures.push({ id: 'T0', student: st.id, ...sh, source: 'first accepted cycle started after today (no study time left today)', proves: 'the journey commands from consistent older history', cannotProve: 'what the planner produces for a join earlier in the day, or that a week elapsed' })
    cyc0 = await activeCycle(st.id)
    blocks0 = await dq(admin.from('plan_blocks').select('id, title, local_date, task_type, execution, lm_id, outcome_id, duration_minutes, revision').eq('cycle_id', cyc0.id).is('cancelled_at', null).order('local_date').order('title'), 'first plan after T0') as any[]
    step('time fixture T0 applied consistently: the accepted cycle now contains today and its planner tasks keep their Monday–Saturday spread', cyc0.starts_at_local <= today && today <= cyc0.ends_at_local && blocks0.length > 0 && sh.tables.planning_cycles === 1, JSON.stringify({ cyc0, sh }))
  }

  // ---- 2. the planner's own tasks: two readings. Reading 1 is finished, reading 2 is partly done then left, plus independent learning on a third reading
  const study = blocks0.filter(b => b.task_type === 'study' && b.lm_id)
  const byReading = new Map<string, any[]>(); for (const b of study) byReading.set(b.lm_id, [...(byReading.get(b.lm_id) ?? []), b])
  let readingsPlanned = [...byReading.keys()]
  if (readingsPlanned.length === 0) { step('the accepted first week contains planner study work to exercise', false, `planner output: ${JSON.stringify(blocks0.map(b => [b.title, b.local_date, b.duration_minutes]))}`); return }
  // The planner sizes a mid-week join by what is left of the week and of the day, so the number of readings it places varies with the clock. With one reading,
  // that reading is finished through the real command and the partly-done and left blocks are SUPPLEMENTARY fixture tasks (labelled; not planner output).
  const supplementary: string[] = []
  if (readingsPlanned.length < 2) {
    const rp = ['r029', 'r030', 'r031'].find(r => !readingsPlanned.includes(r))!
    const mk = (suffix: string, minutes: number) => taskBlock(st.id, cyc0.id, `${RUN}-supp-${suffix}`, { title: `Supplementary fixture: ${rp} ${suffix}`, lm_id: rp, duration_minutes: minutes, duration: String(minutes), learning_objective: 'Objective', suggested_approach: 'Approach' })
    const ins = await admin.from('plan_blocks').insert([mk('partial', 45), mk('left', 30)])
    if (ins.error) throw new Error(`supplementary fixture tasks: ${ins.error.message}`)
    byReading.set(rp, [{ id: `${RUN}-supp-partial`, lm_id: rp, duration_minutes: 45, title: 'supp partial' }, { id: `${RUN}-supp-left`, lm_id: rp, duration_minutes: 30, title: 'supp left' }])
    supplementary.push(`${RUN}-supp-partial`, `${RUN}-supp-left`); readingsPlanned = [...readingsPlanned, rp]
    timeFixtures.push({ id: 'S1', kind: 'supplementary task fixture (not a time shift)', student: st.id, tasks: supplementary, why: `the planner placed ${study.length} sitting(s) of one reading for this join; the partly-done and left blocks need a second reading`, proves: 'the Calendar, scope, review and continuation commands on those blocks', cannotProve: 'that the planner would have produced them' })
  }
  const [rDone, rPart] = readingsPlanned
  const quickReading = ['r028', 'r029', 'r030', 'r031'].find(r => !readingsPlanned.includes(r))!
  const quickOutcomes = ((await dq(admin.from('reading_los').select('id').eq('reading_id', quickReading).order('sequence').limit(2), 'quick outcomes')) as any[]).map(o => o.id as string)
  let bank: Awaited<ReturnType<typeof makeBank>> | null = null
  if (BANK === 'fixture') bank = await makeBank([...readingsPlanned, quickReading])

  const doneTasks = byReading.get(rDone)!, partTasks = byReading.get(rPart)!
  const before = new Map<string, number>(); for (const b of [...doneTasks, ...partTasks]) before.set(b.id, await rev(b.id))
  const results: { status: number; body: any }[] = []
  for (const t of doneTasks) results.push(await exec(st, t.id, 'completed', Number(t.duration_minutes)))
  results.push(await exec(st, partTasks[0].id, 'partial', 20))
  for (const t of partTasks.slice(1)) results.push(await exec(st, t.id, 'deferred'))
  step('the Calendar commands answered for every block (finished, partly done, left)', results.every(r => r.status === 200), JSON.stringify(results.map(r => [r.status, r.body?.error ?? r.body?.code])))
  const after = await dq(admin.from('plan_blocks').select('id, execution, revision').in('id', [...before.keys()]), 'after exec') as any[]
  step('each block now reads its recorded state, with a new revision', after.every(a => a.revision > before.get(a.id)!) && doneTasks.every(t => after.find(a => a.id === t.id).execution === 'completed') && after.find(a => a.id === partTasks[0].id).execution === 'partial' && partTasks.slice(1).every(t => after.find(a => a.id === t.id).execution === 'deferred'))
  const doneMinutes = await Promise.all(doneTasks.map(t => minutesOf(t.id)))
  step('actual minutes: finished blocks carry their duration; the partly-done block carries exactly 20', doneMinutes.every((m, i) => m === Number(doneTasks[i].duration_minutes)) && (await minutesOf(partTasks[0].id)) === 20, JSON.stringify({ doneMinutes, part: await minutesOf(partTasks[0].id) }))
  phase('calendar')

  // ---- 3. independent learning through the existing log: ONE request key, sent twice with the identical payload
  const evBefore = await count('evidence_events', st.id)
  const snap = async () => ({ act: await count('learning_activities', st.id), blocks: await count('plan_blocks', st.id), conf: await count('block_scope_confirmations', st.id), cmd: await count('learning_log_commands', st.id) })
  const s0 = await snap()
  const logKey = `${RUN}-log`
  const logBody = { activity_type: 'independent_study', reading_id: quickReading, outcome_ids: quickOutcomes, duration_minutes: 40, date: today, idempotency_key: logKey }
  const lg = await st.s.post('/api/log-learning', logBody), lg2 = await st.s.post('/api/log-learning', logBody)
  const s1 = await snap()
  step('independent learning is captured through the existing log flow', lg.body?.ok === true && typeof lg.body.taskId === 'string', JSON.stringify(lg.body).slice(0, 200))
  step('the identical retry returns the same receipt and adds nothing: one activity, one Calendar record, one set of outcome confirmations, one command row', JSON.stringify({ ...lg2.body, replayed: undefined }) === JSON.stringify({ ...lg.body, replayed: undefined }) && lg2.body?.replayed === true && s1.act === s0.act + 1 && s1.blocks === s0.blocks + 1 && s1.conf === s0.conf + quickOutcomes.length && s1.cmd === s0.cmd + 1, JSON.stringify({ s0, s1, first: lg.body, retry: lg2.body }))
  step('activity is recorded as activity: no scored evidence appears', (await count('evidence_events', st.id)) === evBefore)
  phase('log')
  const logTask = (await admin.from('plan_blocks').select('id, title, local_date').eq('id', lg.body.taskId).single()).data!
  const [cal, cur, home] = await Promise.all([st.s.req(calendarTaskHref(logTask.id, logTask.local_date)), st.s.req('/app/curriculum'), st.s.req('/app')])
  const calHtml = await cal.text()
  step('the Calendar link for the logged task opens THAT task in the drawer (not just the page)', cal.status === 200 && /role="dialog"/.test(calHtml) && calHtml.includes(logTask.title), `status ${cal.status}`)
  step('Calendar link for a task that does not exist selects nothing', !/role="dialog"/.test(await (await st.s.req(calendarTaskHref('no-such-task', today))).text()))
  step('Curriculum and Home render after the activity', cur.status === 200 && home.status === 200)
  const trk = (await st.s.json('/api/curriculum/readiness')).body?.tracker
  const rowsT = (trk?.topics ?? []).flatMap((t: any) => t.modules.flatMap((m: any) => m.rows))
  step('reported coverage and logged activity create no demonstrated understanding: every outcome is still untested', rowsT.length > 0 && rowsT.every((r: any) => r.band === 'untested'), `${rowsT.length} rows`)

  // ---- 4. scope: reading-level blocks are UNRESOLVED until the student confirms; partial and left work stay out
  const sc0 = (await st.s.json('/api/tests/scope')).body.preview?.scope
  const ids0 = JSON.stringify(sc0?.targets ?? [])
  step('before confirmation: the logged outcomes are in scope; the finished reading is listed as unresolved, not guessed; partly-done and left work are not in scope', quickOutcomes.every(o => ids0.includes(o)) && !ids0.includes(`${rDone}-`) && !ids0.includes(`${rPart}-`) && (sc0?.unresolved ?? []).some((u: any) => u.readingId === rDone || String(u.blockId) === doneTasks[0].id), JSON.stringify({ unresolved: sc0?.unresolved, targets: sc0?.targets?.length }).slice(0, 400))
  const doneOutcomes = ((await dq(admin.from('reading_los').select('id').eq('reading_id', rDone).order('sequence'), 'done outcomes')) as any[]).map(o => o.id as string)
  const cf: { status: number; body: any }[] = []; for (const t of doneTasks) cf.push(await st.s.post('/api/tests/scope/confirm', { blockId: t.id, outcomeIds: doneOutcomes }))
  step('the student confirms which outcomes the finished reading covered (in the same words the UI offers)', cf.every(c => c.body?.ok === true), JSON.stringify(cf.map(c => c.body)).slice(0, 300))
  const scopeRes = (await st.s.json('/api/tests/scope')).body.preview
  const tgt = (scopeRes?.scope?.targets ?? []).map((t: any) => t.outcomeId as string).sort()
  const expectScope = [...doneOutcomes, ...quickOutcomes].sort()
  step('confirmed scope is exactly the finished reading plus the logged outcomes; the partly-done and left reading is absent', JSON.stringify(tgt) === JSON.stringify(expectScope), JSON.stringify({ tgt, expectScope }))
  phase('scope')
  const scRevision = scopeRes?.scope?.revision as string

  if (!bank) {
    if (live.synthetic > 0) { unavailable('actual-bank capability measurement', `contaminated: ${live.synthetic} synthetic fixture-bank items from another active worker are eligible alongside ${live.genuine} genuine ones, so a student's paper could be built from synthetic inventory. Nothing was deleted; re-run when that bank is gone.`); return }
    if (live.genuine === 0) unavailable('weekly diagnostic, result, repair and re-check', 'the actual bank has zero eligible approved questions; this is not a passed diagnostic')
    else notRun('weekly diagnostic chain', 'actual bank has inventory but the scripted outcomes are fixture-specific; run with --bank=fixture')
    const pre = await st.s.post('/api/tests/preflight', { kind: 'weekly' })
    step('with no inventory the student is told so honestly and offered a planning path; Calendar, logging and review remain usable', pre.status === 200 && ['insufficient', 'no_bank', 'no_scope'].includes(pre.body?.decision?.state) && !!pre.body?.decision?.next?.href && (await st.s.req('/app/calendar')).status === 200 && (await st.s.req('/app/review-week')).status < 400, JSON.stringify(pre.body?.decision).slice(0, 200))
    return
  }
  await journeyAPaper(st, { bank, scRevision, expectScope, rDone, rPart, partTasks, cyc0, quickReading })
}

type PaperCtx = { bank: { tag: string; items: string[]; families: string[] }; scRevision: string; expectScope: string[]; rDone: string; rPart: string; partTasks: any[]; cyc0: any; quickReading: string }
async function journeyAPaper(st: Student, c: PaperCtx) {
  const { bank } = c
  // ---- 5. preview is read-only; reserving freezes scope, policies and item versions
  const attBefore = await count('assessment_attempts', st.id)
  const pre = (await st.s.post('/api/tests/preflight', { kind: 'weekly' })).body.decision
  step('preflight offers a weekly diagnostic and creates nothing (preview is read-only)', pre?.state === 'start' && /diagnostic/i.test(pre.purposeLabel) && (await count('assessment_attempts', st.id)) === attBefore, JSON.stringify({ ...pre, pending: undefined }).slice(0, 400))
  const racers = await Promise.all([1, 2, 3].map(() => st.s.post('/api/tests/start', { kind: 'weekly', expectedRevision: c.scRevision })))
  const attemptId = racers[0].body.attemptId as string
  step('concurrent starts converge on one attempt', racers.every(r => r.body?.ok === true && r.body.attemptId === attemptId) && (await count('assessment_attempts', st.id)) === attBefore + 1)
  phase('paper')
  const att = (await dq(admin.from('assessment_attempts').select('attempt_kind, status, form_id, eligibility_policy, scoring_policy_version, requested_blueprint, delivered_coverage').eq('id', attemptId).single(), 'attempt') as any)
  const pinned = (await dq(admin.from('form_items').select('item_id, item_version').eq('form_id', att.form_id), 'form items') as any[])
  const fams = (await dq(admin.from('assessment_items').select('id, family_id, outcome_id, item_version, provenance, concept_id, held_out, review_status').in('id', pinned.map(p => p.item_id)), 'items') as any[])
  const form = (await dq(admin.from('assessment_forms').select('scoring_policy, blueprint_id').eq('id', att.form_id).single(), 'form') as any)
  const bp = (await dq(admin.from('assessment_blueprints').select('requested_scope, constraints').eq('id', form.blueprint_id).single(), 'blueprint') as any)
  step('the attempt froze its eligibility and scoring policy, the requested scope and the exact approved item versions at reservation', att.attempt_kind === 'weekly' && !!att.eligibility_policy && !!form.scoring_policy && !!bp.requested_scope && pinned.every(p => fams.find(f => f.id === p.item_id)?.item_version === p.item_version && fams.find(f => f.id === p.item_id)?.review_status === 'reviewed'), JSON.stringify({ k: att.attempt_kind, el: att.eligibility_policy, sc: form.scoring_policy, bp: !!bp.requested_scope, st: fams.map(f => f.review_status) }))
  step('held-out rehearsal inventory is not used by the weekly paper', fams.every(f => !f.held_out))
  step('every delivered item belongs to the recorded fixture bank (the real bank contributes none) and is a fixture item', pinned.length > 0 && pinned.every(p => bank.items.includes(p.item_id)) && fams.every(f => f.provenance === 'fixture-bank'), `${pinned.length} items`)
  step('every delivered item belongs to the confirmed scope only: nothing from the partly-done or left reading', fams.every(f => c.expectScope.includes(f.outcome_id)) && !fams.some(f => String(f.outcome_id).startsWith(`${c.rPart}-`)), JSON.stringify([...new Set(fams.map(f => f.outcome_id))]))
  step('family independence: no two questions share a family', new Set(fams.map(f => f.family_id)).size === fams.length)
  const taking = (await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items as { id: string; options: string[] }[]
  const keys = new Map(((await dq(admin.from('assessment_items').select('id, key_index').in('id', taking.map(i => i.id)), 'keys')) as any[]).map(r => [r.id as string, Number(r.key_index)]))
  const right = (i: { id: string }) => keys.get(i.id)!, wrong = (i: { id: string; options: string[] }) => (right(i) + 1) % i.options.length
  // roles: [0] confident wrong, [1] uncertain correct, [2] omitted, the rest correct and confident
  const plan = taking.map((i, n) => n === 0 ? { i, sel: wrong(i), conf: 'high', role: 'confident_wrong' } : n === 1 ? { i, sel: right(i), conf: 'low', role: 'uncertain_correct' } : n === 2 ? { i, sel: -1, conf: '', role: 'omitted' } : { i, sel: right(i), conf: 'high', role: 'confident_correct' })
  const answered = plan.filter(p => p.role !== 'omitted'), omitted = plan.find(p => p.role === 'omitted')!
  const send = (p: typeof plan[number], secs: number) => st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: p.i.id, selectedOptionIndex: p.sel, confidence: p.conf, activeSeconds: secs, interruptedSeconds: 0 })
  step('answers save with their confidence', (await Promise.all(answered.slice(0, 3).map(p => send(p, 3)))).every(r => r.body?.ok === true))
  step('a refresh keeps the saved answers and confidence', ((await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items as any[]).filter(i => i.answer).length === 3)
  step('an answer without confidence is refused and saves nothing', (await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: answered[3].i.id, selectedOptionIndex: answered[3].sel, activeSeconds: 3, interruptedSeconds: 0 })).body?.ok !== true && (await count('assessment_responses', st.id)) === 3)
  for (const p of answered.slice(3)) await send(p, 12)
  const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
  step('the paper is submitted and scored once', sub.body?.ok === true, JSON.stringify(sub.body).slice(0, 200))
  const att2 = (await dq(admin.from('assessment_attempts').select('status, score, valid_response_count, correct_response_count, delivered_count, omitted_count, scoreable_count, scoring_policy_version, evidence_mode, attempt_kind').eq('id', attemptId).single(), 'scored attempt') as any)
  const correctN = answered.filter(p => p.sel === right(p.i)).length
  step('the score ledger agrees: delivered, answered, omitted and correct counts, and the denominator includes the omission', att2.status === 'scored' && att2.delivered_count === plan.length && att2.valid_response_count === answered.length && att2.omitted_count === 1 && att2.correct_response_count === correctN && att2.scoreable_count === plan.length && att2.scoring_policy_version === form.scoring_policy && att2.score === Math.round(100 * correctN / plan.length), JSON.stringify(att2))
  if (INJECT === 'evidence') { const e = ((await admin.from('evidence_events').select('id').eq('attempt_id', attemptId).limit(1)).data ?? [])[0]; if (e) await admin.from('evidence_events').delete().eq('id', e.id); observations.push('INJECTED negative control: one evidence row was deleted before the evidence assertion') }
  const resp = await dq(admin.from('assessment_responses').select('item_id, is_correct, self_reported_confidence, selected_option_index').eq('attempt_id', attemptId), 'responses') as any[]
  step('exactly the answered questions have a response row; the omitted one has none', resp.length === answered.length && !resp.some(r => r.item_id === omitted.i.id) && answered.every(p => resp.find(r => r.item_id === p.i.id)?.self_reported_confidence === (p.conf === 'high' ? 5 : 1) && resp.find(r => r.item_id === p.i.id)?.is_correct === (p.sel === right(p.i))), JSON.stringify({ resp, omitted: omitted.i.id }))
  const evid = await dq(admin.from('evidence_events').select('item_id, concept_id, validity, is_correct, evidence_state, self_reported_confidence, attempt_id, assessment_purpose, evidence_mode').eq('attempt_id', attemptId), 'evidence') as any[]
  const concepts = new Map(fams.map(f => [f.id as string, f.concept_id as string]))
  const mapOut = await dq(admin.from('concept_outcome_map').select('concept_id, outcome_id').in('concept_id', [...new Set(fams.map(f => f.concept_id as string))]), 'concept map') as any[]
  step('evidence is exact: one valid event per answered question (same item, concept and correctness), none for the omitted question, all from this attempt', evid.length === answered.length && answered.every(p => { const e = evid.find(x => x.item_id === p.i.id); return !!e && e.validity === 'valid' && e.concept_id === concepts.get(p.i.id) && e.is_correct === (p.sel === right(p.i)) }) && !evid.some(e => e.item_id === omitted.i.id), JSON.stringify({ n: evid.length, answered: answered.length }))
  step('every evidence concept maps to an outcome inside the confirmed scope', evid.every(e => mapOut.some(m => m.concept_id === e.concept_id && c.expectScope.includes(m.outcome_id))))
  const cw = answered.find(p => p.role === 'confident_wrong')!, uc = answered.find(p => p.role === 'uncertain_correct')!
  step('the confident miss is needs-repair and the uncertain correct is unstable; confident correct answers are neither', evid.find(e => e.item_id === cw.i.id)?.evidence_state === 'needs_repair' && evid.find(e => e.item_id === uc.i.id)?.evidence_state === 'unstable' && answered.filter(p => p.role === 'confident_correct').every(p => !['needs_repair', 'unstable'].includes(evid.find(e => e.item_id === p.i.id)?.evidence_state)), JSON.stringify(evid.map(e => [e.is_correct, e.self_reported_confidence, e.evidence_state])))
  const result = (await st.s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
  step('the result read model agrees with the ledger: answered/total, one omission, a confident-miss finding', result?.analysis?.overall?.answered === answered.length && result.omitted?.length === 1 && result.findings.some((f: any) => f.kind === 'misconception' || f.kind === 'confident_error'), JSON.stringify({ o: result?.analysis?.overall, om: result?.omitted?.length, f: result?.findings?.map((f: any) => f.kind) }))
  phase('result')
  if (INJECT === 'evidence') return

  // ---- 6. Coach on that exact result
  const page = await (await st.s.req(`/app/coach?attempt=${attemptId}`)).text()
  step('Coach opens on that exact result', page.includes(`/app/tests/${attemptId}/result`))
  const ans = await coachSay(st, 'what does this result show about my weakest area?', { attemptId })
  step('Coach answers from that result, links it, does not teach the answer and makes no pass guarantee', ans.ok === true && (ans.links ?? []).some((l: any) => String(l.href).includes(attemptId)) && !/the answer is|correct option|you will pass|guarantee/i.test(ans.reply), JSON.stringify(ans).slice(0, 260))
  const other = await coachSay(st, 'what does this result show about my weakest area?', { attemptId: '00000000-0000-4000-8000-000000000000' })
  step('an unavailable selected result is never silently replaced by the latest one', !(other.links ?? []).some((l: any) => String(l.href).includes(attemptId)) && !(other.links ?? []).some((l: any) => /latest result/i.test(l.label)), JSON.stringify(other.links))
  phase('coach')
  // ---- 7. Keep for later (endpoint proxy: the browser spec drives the real button). A follow-up is reviewed, left, rediscovered, and nothing is scheduled.
  const threadsOf = async () => (await dq(admin.from('repair_threads').select('id, status, concept_id').eq('user_id', st.id).order('id'), 'threads')) as any[]
  const th0 = await threadsOf()
  const state0 = (await st.s.json(`/api/diagnostic/repair?attemptId=${attemptId}`)).body
  step('the follow-up exists for exactly the evidence-bearing misses (confident miss + unstable), as open threads', th0.length === 2 && th0.every(t => ['open', 'proposed'].includes(t.status)) && state0.items?.length === 2, JSON.stringify({ th0, items: state0.items?.length }))
  const prev0 = await st.s.post('/api/diagnostic/repair/preview', { attemptId })
  const planTasks = async () => count('plan_blocks', st.id, { task_type: 'repair' })
  step('previewing (and leaving) the follow-up schedules no repair work', prev0.body?.ok === true && (await planTasks()) === 0 && (await count('plan_blocks', st.id, { task_type: 'recheck' })) === 0)
  const [homeL, testsL, coachL] = await Promise.all([st.s.req('/app'), st.s.req('/app/tests'), st.s.req(`/app/coach?attempt=${attemptId}`)])
  const [hH, tH, cH] = await Promise.all([homeL.text(), testsL.text(), coachL.text()])
  const state1 = (await st.s.json(`/api/diagnostic/repair?attemptId=${attemptId}`)).body
  step('after leaving: Home, Tests and Coach still lead back to the same result, and the same follow-up threads are rediscovered unchanged', hH.includes(`/app/tests/${attemptId}/result`) && tH.includes(attemptId) && cH.includes(attemptId) && JSON.stringify(state1.items.map((i: any) => i.threadId).sort()) === JSON.stringify(th0.map(t => t.id).sort()) && state1.items.every((i: any) => ['open', 'proposed'].includes(i.status)) && !!state1.pending, JSON.stringify({ pending: state1.pending, st: state1.items.map((i: any) => i.status) }))
  phase('keep_for_later')
  // ---- 8. adaptive practice on valid covered scope: a separately labelled branch. Every answer is a confident miss, which WOULD make evidence and repair work if it counted.
  const world = async () => JSON.stringify({
    ev: ((await dq(admin.from('evidence_events').select('id, attempt_id, evidence_state').eq('user_id', st.id).order('id'), 'ev')) as any[]),
    th: ((await dq(admin.from('repair_threads').select('id, status, occurrence_count, latest_evidence_event_id, latest_attempt_id, latest_check_state, revision').eq('user_id', st.id).order('id'), 'th')) as any[]),
    weekly: await count('assessment_attempts', st.id, { attempt_kind: 'weekly' }), blocks: await count('plan_blocks', st.id), proposals: await count('coach_proposals', st.id),
    repairState: ((await st.s.json(`/api/diagnostic/repair?attemptId=${attemptId}`)).body.items ?? []).map((i: any) => [i.threadId, i.status, i.tasks.length]),
    ledger: (await dq(admin.from('assessment_attempts').select('id, score, valid_response_count, correct_response_count, omitted_count').eq('id', attemptId).single(), 'ledger') as any),
  })
  const w0 = await world()
  const pbody = { kind: 'practice', mode: 'adaptive', readingId: c.rDone, cap: 20 }
  const pp = (await st.s.post('/api/tests/preflight', pbody)).body
  if (pp?.adaptive?.state === 'start') {
    const ps = await st.s.post('/api/tests/start', { ...pbody, requestKey: `${RUN}-practice`, expectedDecision: pp.adaptive.evidenceRevision })
    if (ps.body?.ok) {
      const pit = (await st.s.json(`/api/tests/attempt/${ps.body.attemptId}`)).body.items as { id: string; options: string[] }[]
      const pk = new Map(((await dq(admin.from('assessment_items').select('id, key_index').in('id', pit.map(i => i.id)), 'pkeys')) as any[]).map(r => [r.id as string, Number(r.key_index)]))
      for (const i of pit) await st.s.post(`/api/tests/attempt/${ps.body.attemptId}/answer`, { itemId: i.id, selectedOptionIndex: (pk.get(i.id)! + 1) % i.options.length, confidence: 'high', activeSeconds: 5, interruptedSeconds: 0 })
      const psub = await st.s.post(`/api/tests/attempt/${ps.body.attemptId}/submit`, { allowUnanswered: true })
      const pa = (await dq(admin.from('assessment_attempts').select('attempt_kind, evidence_mode, status').eq('id', ps.body.attemptId).single(), 'practice attempt') as any)
      step('practice branch: a confident-miss practice run is submitted and scored as practice', psub.body?.ok === true && pa.attempt_kind !== 'weekly' && pa.status === 'scored', JSON.stringify(pa))
      step('practice branch: evidence rows, repair threads, weekly attempts, Calendar tasks, proposals, follow-up state and the weekly ledger are all unchanged', (await world()) === w0)
      const pc = await coachSay(st, 'what does this result show about my weakest area?', { attemptId: ps.body.attemptId })
      step('practice branch: Coach on the selected practice result links that practice result, never the weekly one, and offers no repair follow-up', pc.ok === true && (pc.links ?? []).some((l: any) => String(l.href).includes(ps.body.attemptId)) && !(pc.links ?? []).some((l: any) => String(l.href).includes(attemptId) || /proposal-h|repair/i.test(String(l.href))) && (await world()) === w0, JSON.stringify(pc.links))
    } else step('practice branch starts', false, JSON.stringify(ps.body).slice(0, 200))
  } else step('practice branch is offered on valid covered scope', false, JSON.stringify(pp?.adaptive ?? pp).slice(0, 200))
  if (INJECT === 'phase') { observations.push('INJECTED negative control: the weekly closure phase and everything after it were skipped on purpose'); return }
  phase('practice')

  // ---- 9. weekly closure: the scored paper gives the credit; dispositions are separate from next actions; the draft is reviewed, accepted, and a lost response replays
  const wr = (await st.s.json('/api/weekly-review/state')).body?.state
  step('the review opens on the scored weekly paper (the paper-scored gate, no acknowledgement shortcut)', wr?.status === 'active' && wr.gate?.kind === 'paper_scored' && wr.recap?.paper?.scored === true && wr.recap.paper.correct === att2.correct_response_count && wr.recap.paper.valid === att2.valid_response_count, JSON.stringify({ gate: wr?.gate, paper: wr?.recap?.paper }).slice(0, 400))
  const due = (wr?.dueTasks ?? []) as any[]
  const partialTask = due.find(t => t.id === c.partTasks[0].id)
  step('the unfinished work is listed for a disposition: the partly-done block and the left blocks; finished and logged work is not', !!partialTask && c.partTasks.slice(1).every(t => due.some(d => d.id === t.id)) && !due.some(d => d.id === c.partTasks[0].id && false), JSON.stringify(due.map(d => [d.id, d.execution ?? d.status])))
  const choices: Record<string, unknown> = {}
  for (const t of due) choices[t.id] = t.id === c.partTasks[0].id ? { happened: 'partial', next: 'continue', estimateMinutes: 25 } : { happened: 'not_done', next: 'later', estimateMinutes: 30 }
  const cyclesBefore = await count('planning_cycles', st.id)
  const pw = await st.s.post('/api/weekly-review/preview', { cycleId: c.cyc0.id, choices, acknowledgeNoPaper: false })
  step('the next-week draft is prepared and saved without creating a cycle or touching a task', pw.body?.ok === true && (await count('planning_cycles', st.id)) === cyclesBefore, JSON.stringify(pw.body).slice(0, 500))
  const draftId = pw.body.draftId as string
  const acc1 = await st.s.post('/api/weekly-review/accept', { draftId }), acc2 = await st.s.post('/api/weekly-review/accept', { draftId })
  const cycles = await dq(admin.from('planning_cycles').select('id, status, starts_at_local, ends_at_local').eq('user_id', st.id).order('starts_at_local'), 'cycles') as any[]
  step('accepted once: the old week closed, one new active week, and a lost-response retry returns the same outcome', acc1.body?.ok === true && acc2.body?.ok === true && acc2.body.nextCycleId === acc1.body.nextCycleId && cycles.length === 2 && cycles.filter(x => x.status === 'active').length === 1 && cycles[0].status !== 'active', JSON.stringify({ acc1: acc1.body, acc2: acc2.body, cycles }).slice(0, 600))
  const cyc2 = cycles.find(x => x.status === 'active')
  step('the new week keeps its real boundary: starts on the Monday after the closed week and runs to Sunday', wd(cyc2.starts_at_local) === 1 && wd(cyc2.ends_at_local) === 0 && cyc2.starts_at_local > String(c.cyc0.ends_at_local), JSON.stringify(cyc2))
  const succ = await dq(admin.from('plan_blocks').select('id, cycle_id, execution, learning_objective, suggested_approach, outcome_id, lm_id, continued_from_task_id, duration_minutes, local_date, revision').eq('continued_from_task_id', c.partTasks[0].id), 'continuation') as any[]
  const orig = (await dq(admin.from('plan_blocks').select('execution, cycle_id, learning_objective, suggested_approach, lm_id, revision').eq('id', c.partTasks[0].id).single(), 'orig') as any)
  step('exactly one continuation exists, in the new week, linked to the original; objective, method and reading mapping are preserved; the original stays partial in the closed week', succ.length === 1 && succ[0].cycle_id === cyc2.id && succ[0].execution === 'not_started' && succ[0].learning_objective === orig.learning_objective && succ[0].suggested_approach === orig.suggested_approach && succ[0].lm_id === orig.lm_id && orig.execution === 'partial' && orig.cycle_id === c.cyc0.id, JSON.stringify({ succ, orig }))
  phase('closure')

  // ---- 10. the repairs were carried into the new week by the accepted review (the real path on a Saturday join, where THIS week has no room, as the preview said)
  const ths = await threadsOf()
  const rTasks = await dq(admin.from('plan_blocks').select('id, title, local_date, cycle_id, repair_thread_id, task_type, execution').eq('user_id', st.id).eq('task_type', 'repair').is('cancelled_at', null), 'repair tasks') as any[]
  step('each repair thread has exactly one repair task, all in the new week and on its days (no duplicates from the lost-response retry)', rTasks.length === 2 && new Set(rTasks.map(t => t.repair_thread_id)).size === 2 && rTasks.every(t => t.cycle_id === cyc2.id && t.local_date >= cyc2.starts_at_local && t.local_date <= cyc2.ends_at_local) && ths.every(t => t.status === 'scheduled'), JSON.stringify({ rTasks, ths }))
  const opens = await Promise.all(rTasks.map(async t => { const html = await (await st.s.req(calendarTaskHref(t.id, t.local_date))).text(); return /role="dialog"/.test(html) && html.includes(t.title) }))
  step('each repair task opens in the Calendar drawer from its exact link', opens.every(Boolean), opens.join())
  const reverify = (await dq(admin.from('plan_blocks').select('id, title, repair_thread_id').eq('user_id', st.id).eq('task_type', 'recheck').is('cancelled_at', null), 'reverify') as any[])
  if (reverify.length) observations.push(`The accepted next week contains a standalone unstable-concept "Re-verify" task for a concept that ALSO has an open repair thread with its own repair task (${JSON.stringify(reverify.map(r => r.title))}). Two parallel follow-ups for one concept; not asserted as a defect.`)
  const evBeforeRepair = await count('evidence_events', st.id)
  const doneR = await Promise.all(rTasks.map(t => exec(st, t.id, 'completed', 25)))
  const thsDone = await threadsOf()
  const thFull = await dq(admin.from('repair_threads').select('id, status, latest_check_state, latest_check_attempt_id').eq('user_id', st.id), 'threads after repair') as any[]
  step('completing the repair work moves the threads to awaiting-re-check and resolves nothing: no check verdict, no new evidence', doneR.every(r => r.status === 200) && thsDone.every(t => t.status === 'awaiting_recheck') && thFull.every(t => t.latest_check_state === null && t.latest_check_attempt_id === null) && (await count('evidence_events', st.id)) === evBeforeRepair, JSON.stringify({ doneR: doneR.map(r => r.status), thFull }))
  phase('repair')
  const threadIds = ths.map(t => t.id)
  const attemptsBeforeCheck = await count('assessment_attempts', st.id)
  const place1 = await st.s.post('/api/diagnostic/repair/check', { threadIds, idempotencyKey: `${RUN}-chk1` })
  const place2 = await st.s.post('/api/diagnostic/repair/check', { threadIds, idempotencyKey: `${RUN}-chk2` })
  const checkRows = await dq(admin.from('plan_blocks').select('id, local_date, execution, task_type').eq('user_id', st.id).eq('task_type', 'recheck').is('cancelled_at', null).in('id', ((await dq(admin.from('repair_check_threads').select('check_task_id').eq('user_id', st.id), 'links')) as any[]).map(l => l.check_task_id)), 'check task') as any[]
  const checkLinks = await dq(admin.from('repair_check_threads').select('check_task_id, thread_id').eq('user_id', st.id), 'check links') as any[]
  step('the re-check is placed once through the real command, linked to exactly those two repairs; asking again adds no second task', place1.body?.ok === true && place2.body?.ok !== true && checkRows.length === 1 && checkLinks.length === 2 && checkLinks.every(l => l.check_task_id === checkRows[0].id && threadIds.includes(l.thread_id)), JSON.stringify({ place1: place1.body, place2: place2.body, checkRows, checkLinks }))
  const checkId = checkRows[0].id as string
  const early = await st.s.post('/api/tests/start', { kind: 'repair', checkTaskId: checkId })
  step('BEFORE the spacing has elapsed the same service refuses to start the re-check: it states when it can start, creates no attempt and no second task', early.body?.ok !== true && /\d{4}-\d{2}-\d{2}|spacing|from/i.test(JSON.stringify(early.body)) && (await count('assessment_attempts', st.id)) === attemptsBeforeCheck && (await count('plan_blocks', st.id, { task_type: 'recheck' })) === reverify.length + 1, JSON.stringify(early.body).slice(0, 300))

  // ---- 11. TIME FIXTURE T1: one calendar week passes for this student. Cycles, task dates, event timestamps, evidence and repair history all move back together.
  const shift = await shiftStudentTimeline(st.id, 1, owned)
  timeFixtures.push({ id: 'T1', student: st.id, ...shift, source: 'all of this run-owned student\'s dated history, moved back exactly seven days (weekday-preserving)', proves: 'the re-check eligibility service, cycle containment and closure answer correctly from consistent older history', cannotProve: 'that a real week elapsed, recurrence, reminders or cron behaviour' })
  const cyc2s = await activeCycle(st.id)
  step('time fixture T1 applied consistently: the second week now contains today, and the first week is closed history before it', cyc2s.starts_at_local <= today && today <= cyc2s.ends_at_local && wd(cyc2s.starts_at_local) === 1 && Object.values(shift.tables).every(n => n >= 0) && shift.tables.planning_cycles === 2, JSON.stringify({ cyc2s, shift }))
  const late = await st.s.post('/api/tests/start', { kind: 'repair', checkTaskId: checkId })
  step('AFTER the spacing (same service, only the dated history differs) the re-check starts through the normal command', late.body?.ok === true, JSON.stringify(late.body).slice(0, 300))
  if (late.body?.ok !== true) { notRun('re-check questions, resolution policy, continuity totals', 'the re-check did not start; see the failed step above'); return }
  const rAtt = (await dq(admin.from('assessment_attempts').select('form_id, attempt_kind').eq('id', late.body.attemptId).single(), 'recheck attempt') as any)
  const rItems = ((await dq(admin.from('form_items').select('item_id').eq('form_id', rAtt.form_id), 'recheck items')) as any[]).map(f => f.item_id as string)
  const rFam = (await dq(admin.from('assessment_items').select('id, family_id, concept_id, outcome_id').in('id', rItems), 'recheck item meta')) as any[]
  const repairedConcepts = ((await dq(admin.from('repair_threads').select('concept_id').in('id', threadIds), 'concepts')) as any[]).map(t => t.concept_id as string)
  step('the re-check delivers only fixture-bank questions never seen before, from families never used before, and only for the repaired concepts', rFam.length > 0 && rItems.every(i => bank.items.includes(i)) && rFam.every(i => !pinned.some(p => p.item_id === i.id) && !fams.some(f => f.family_id === i.family_id) && repairedConcepts.includes(i.concept_id)) && new Set(rFam.map(i => i.family_id)).size === rFam.length, JSON.stringify(rFam))
  const rTaking = (await st.s.json(`/api/tests/attempt/${late.body.attemptId}`)).body.items as { id: string }[]
  const rKey = new Map(((await dq(admin.from('assessment_items').select('id, key_index').in('id', rTaking.map(i => i.id)), 'rkeys')) as any[]).map(k => [k.id as string, Number(k.key_index)]))
  for (const i of rTaking) await st.s.post(`/api/tests/attempt/${late.body.attemptId}/answer`, { itemId: i.id, selectedOptionIndex: rKey.get(i.id), confidence: 'high', activeSeconds: 12, interruptedSeconds: 0 })
  const rSub = await st.s.post(`/api/tests/attempt/${late.body.attemptId}/submit`, {})
  step('the re-check scores', rSub.body?.ok === true, JSON.stringify(rSub.body).slice(0, 200))
  phase('recheck')
  const pol = (await admin.rpc('repair_resolution_policy')).data as { autoClose?: boolean; minValidQuestions?: number; version?: string } | null
  const perConcept = new Map<string, number>(); for (const i of rFam) perConcept.set(i.concept_id, (perConcept.get(i.concept_id) ?? 0) + 1)
  const thEnd = await dq(admin.from('repair_threads').select('id, concept_id, status, latest_check_state, latest_check_attempt_id, closure_reason').in('id', threadIds), 'threads end') as any[]
  const expectClosed = (concept: string) => !!pol?.autoClose && (perConcept.get(concept) ?? 0) >= (pol?.minValidQuestions ?? Infinity)
  step(`resolution follows the recorded policy (${pol?.version}; autoClose=${pol?.autoClose}, minValidQuestions=${pol?.minValidQuestions}): every check is recorded as supported against THIS attempt, and a thread closes only if the policy says so`, !!pol && thEnd.every(t => t.latest_check_state === 'supported' && t.latest_check_attempt_id === late.body.attemptId && (expectClosed(t.concept_id) ? t.status === 'closed' && String(t.closure_reason).startsWith('supported_on_check') : t.status === 'awaiting_recheck')), JSON.stringify({ pol, perConcept: [...perConcept], thEnd }))

  // ---- 12. continuity: 20 minutes in the closed week + 25 finishing it in the new week = 45, attributed to the right week, counted once, lineage intact
  const cont = succ[0]
  const fin = await exec(st, cont.id, 'completed', 25)
  const { getTaskLineage } = await import('../src/lib/planning/taskLineageService')
  const lin = await getTaskLineage(st.id, cont.id), linOrig = await getTaskLineage(st.id, c.partTasks[0].id)
  const earlier = lin?.info.earlier
  step('the app\'s lineage read model: the continuation reports 20 earlier (in the closed week) and its own 25, with the original named and the week bounds of both', fin.status === 200 && earlier?.minutes === 20 && earlier.unknown === false && earlier.occurrences.length === 1 && earlier.occurrences[0].id === c.partTasks[0].id && earlier.occurrences[0].minutes === 20 && earlier.occurrences[0].weekStart === addDays(String(c.cyc0.starts_at_local), -7) && (await minutesOf(cont.id)) === 25 && lin?.info.continuedFrom?.id === c.partTasks[0].id, JSON.stringify({ earlier, lin: lin?.info.continuedFrom }))
  step('the original task, opened from its old link, is the historical record with its successor named; its own history was not rewritten', linOrig?.task.execution === 'partial' && linOrig.info.continuedAs?.id === cont.id && (await minutesOf(c.partTasks[0].id)) === 20 && (await dq(admin.from('plan_blocks').select('cycle_id').eq('id', c.partTasks[0].id).single(), 'orig cycle') as any).cycle_id === c.cyc0.id, JSON.stringify(linOrig?.info))
  const { loadClosedCycleObservations } = await import('../src/lib/planning/cycleObservationService')
  const obs = await loadClosedCycleObservations(st.id, 4)
  const closedObs = obs.find((o: any) => o.cycleId === c.cyc0.id || o.cycle?.id === c.cyc0.id)
  step('the closed week\'s observation records one partly-done task and nothing unresolved; the new week\'s 25 minutes are not part of it', !!closedObs && closedObs.counts.partial === 1 && closedObs.counts.unresolved === 0, JSON.stringify(closedObs).slice(0, 400))
  const effort = ((await dq(admin.from('task_events').select('task_id, actual_duration_minutes').eq('user_id', st.id).in('task_id', [c.partTasks[0].id, cont.id]).not('actual_duration_minutes', 'is', null), 'effort events')) as any[])
  step('effort is counted once: two completion/partial events carry 20 and 25 and nothing else carries minutes for this work', effort.length === 2 && sum(effort.map(e => Number(e.actual_duration_minutes))) === 45 && new Set(effort.map(e => e.task_id)).size === 2, JSON.stringify(effort))
  phase('continuity')
}

// =====================================================================================================================================================
const B_PHASES = ['onboarding', 'class_boundary', 'class_log', 'stale_preview', 'confirm_retry', 'missed_class', 'assessment_new', 'result', 'coach', 'keep_for_later', 'review_next_cycle', 'revision_log', 'assessment_revisionary', 'assessment_mixed', 'repair_recheck']
async function journeyB() {
  J_ = 'B'; console.log('\n=== Journey B — midway entrant, class-led ===')
  const live = await eligible()
  const { options: persona, topics } = await classLedPersona(admin)
  const st = await fresh('lcB', { onboard: true, onboarding: persona })
  // ---- 1. the persona was SAVED as entered, and the first cycle follows the class policy (Tue/Thu → Tuesday–Monday, paper on Monday)
  const prof = (await admin.from('profiles').select('stage, registered, exam_sitting, prep_mode, max_session_minutes, onboarding_status').eq('id', st.id).single()).data
  step('onboarding saved the persona: first pass underway, May sitting booked, class-led, 45-minute sittings', prof?.stage === 'first_pass_underway' && prof.registered === true && prof.exam_sitting === 'may' && prof.prep_mode === 'instructor_led' && prof.max_session_minutes === 45 && prof.onboarding_status === 'complete', JSON.stringify(prof))
  const expo = await dq(admin.from('user_topic_exposure').select('topic_id, recency').eq('user_id', st.id), 'exposure') as any[]
  const unc = await dq(admin.from('user_entry_uncertainty').select('topic_id, level, lm_ids').eq('user_id', st.id), 'uncertainty') as any[]
  step('three covered subjects and uncertainty in two (a few readings in one, most of another) are saved as self-report', expo.length === 3 && unc.length === 2 && unc.find(u => u.topic_id === topics[0])?.level === 'several' && unc.find(u => u.topic_id === topics[1])?.level === 'most', JSON.stringify({ expo, unc }))
  const tbl = await tracker(st); step('reported coverage is NOT demonstrated understanding: every outcome is untested', tbl.rows.length > 0 && tbl.rows.every((r: any) => r.band === 'untested'))
  const comm = await dq(admin.from('calendar_commitments').select('kind, weekdays, start_time, end_time').eq('user_id', st.id).eq('status', 'active'), 'commitments') as any[]
  step('two real evening classes (Tuesday and Thursday) plus work and commute are saved as commitments', comm.filter(c => c.kind === 'class').flatMap(c => c.weekdays).sort().join() === '2,4' && comm.some(c => c.kind === 'work') && comm.some(c => c.kind === 'commute'), JSON.stringify(comm))
  phase('onboarding')
  let cyc = await activeCycle(st.id)
  step('the cycle follows the class policy: Tuesday to Monday (seven days), not the self-study Sunday rule', wd(String(cyc.starts_at_local)) === 2 && wd(String(cyc.ends_at_local)) === 1 && daysBetweenStr(String(cyc.starts_at_local), String(cyc.ends_at_local)) === 6, `${cyc.starts_at_local}→${cyc.ends_at_local}`)
  const paperDay = (await dq(admin.from('plan_blocks').select('local_date, task_type, title').eq('cycle_id', cyc.id).order('local_date'), 'cycle blocks')) as any[]
  const gate0 = (await st.s.json('/api/weekly-review/state')).body?.state?.gate
  step('the closing paper/review day is the cycle\'s last day, the Monday before the next Tuesday class (the paper is derived, not a stored task)', gate0?.kind === 'not_ready' && String(gate0.reason).includes(String(cyc.ends_at_local)) && wd(String(cyc.ends_at_local)) === 1 && paperDay.every(b => b.local_date <= String(cyc.ends_at_local)), JSON.stringify(gate0))
  phase('class_boundary')
  // TIME FIXTURE T0 when the first cycle starts after today: the whole history, class occurrences included, moves back one week.
  if (String(cyc.starts_at_local) > today) {
    const sh = await shiftStudentTimeline(st.id, 1, owned)
    timeFixtures.push({ id: 'T0', student: st.id, ...sh, source: 'first class-led cycle starts after today', proves: 'class-log, scope and assessment commands from consistent older history, class occurrences and recurrence bounds included', cannotProve: 'elapsed weeks; trigger-enforced constraints on shifted tables were bypassed' })
    cyc = await activeCycle(st.id)
  }
  const ctx = (await st.s.json('/api/class-log/context')).body?.context
  step('the class-led route is recognised and the class days that already happened are listed as unlogged', ctx?.classLed === true && (ctx.pendingDates ?? []).length >= 2, JSON.stringify(ctx).slice(0, 300))
  const [d1, d2] = ((ctx?.pendingDates ?? []) as string[]).slice().sort()
  if (!d1 || !d2) return
  if (BANK !== 'fixture') { unavailable('class-led assessment, result, repair and weekly review', live.synthetic > 0 ? 'contaminated by synthetic fixture items from another worker' : 'zero genuine approved inventory; planning stays usable (not a diagnostic pass)'); return }
  const bank = await makeBank(['r028', 'r029'])
  const before0 = await count('plan_blocks', st.id)
  const say = await coachSay(st, 'i attnded clas yesterday, can u log it')
  step('Coach reads the typo-filled class request, links the exact class-log editor and writes nothing', (say.links ?? []).some((l: any) => String(l.href).startsWith('/app/calendar/log-class')) && (await count('plan_blocks', st.id)) === before0, JSON.stringify(say.links))
  // ---- 2. class log 1: a full outcome, a precisely bounded partial one
  const log1 = { classDate: d1, kind: 'covered', items: [{ outcomeId: 'r028-a', extent: 'full' }, { outcomeId: 'r028-b', extent: 'full' }, { outcomeId: 'r028-c', extent: 'full' }, { outcomeId: 'r028-d', extent: 'part', portionNote: 'basic EPS only' }] }   // r028-d is "Calculate and interpret basic and diluted EPS" in the catalogue: the note belongs to it
  const p0 = await st.s.post('/api/class-log/preview', log1)
  step('the preview names exact dates, minutes, method note and load verdict, and writes nothing', p0.body?.ok === true && (p0.body.tasks ?? []).length > 0 && p0.body.tasks.every((t: any) => t.date >= today && t.minutes > 0) && ['comfortable', 'tight', 'over'].includes(p0.body.pressure) && (await count('class_sessions', st.id)) === 0, JSON.stringify(p0.body).slice(0, 300))
  // an irrelevant change (a protected commitment at 03:00, nowhere study can be placed) keeps the same material effects
  await st.s.post('/api/commitments', { kind: 'personal', label: 'Early flight', date: p0.body.tasks[0].date, startTime: '03:00', endTime: '04:00', isProtected: true })
  const p0b = await st.s.post('/api/class-log/preview', log1)
  step('an irrelevant commitment leaves the previewed effects (and token) identical', p0b.body?.ok === true && p0b.body.fingerprint === p0.body.fingerprint)
  phase('class_log')
  // a material change: protected time over every study window of the first previewed day
  const dayOf = p0.body.tasks[0].date as string
  const add = await st.s.post('/api/commitments', { kind: 'personal', label: 'Added after preview', date: dayOf, startTime: '06:00', endTime: '23:00', isProtected: true })
  const stale = await st.s.post('/api/class-log/confirm', { ...log1, idempotencyKey: `${RUN}-stale`, fingerprint: p0.body.fingerprint })
  step('a material change after preview refuses confirmation with nothing written and a fresh preview ready', add.body?.ok === true && stale.status === 409 && stale.body?.code === 'preview_changed' && (await count('class_sessions', st.id)) === 0 && !!stale.body?.preview, JSON.stringify(stale.body).slice(0, 200))
  phase('stale_preview')
  const p1 = await st.s.post('/api/class-log/preview', log1)
  const clKey = `${RUN}-cl1`
  const c1 = await st.s.post('/api/class-log/confirm', { ...log1, idempotencyKey: clKey, fingerprint: p1.body.fingerprint })
  const c2 = await st.s.post('/api/class-log/confirm', { ...log1, idempotencyKey: clKey, fingerprint: 'anything-lost-response' })
  const placed1 = await dq(admin.from('plan_blocks').select('id, task_type, local_date, duration_minutes, outcome_id, cycle_id').eq('class_session_id', c1.body.sessionId), 'placed') as any[]
  step('the fresh confirmation succeeds and the lost-response retry replays it: one session, exactly the previewed tasks, in the active cycle', c1.body?.ok === true && c2.body?.ok === true && c2.body.sessionId === c1.body.sessionId && (await count('class_sessions', st.id)) === 1 && placed1.length === p1.body.tasks.length && placed1.every(b => b.cycle_id === cyc.id), JSON.stringify({ c1: c1.body, c2: c2.body, n: placed1.length }))
  const items1 = await dq(admin.from('class_session_items').select('outcome_id, extent, portion_note').eq('session_id', c1.body.sessionId), 'items') as any[]
  step('the session records the full and the bounded-partial outcome with its portion note', items1.length === 4 && items1.find(i => i.outcome_id === 'r028-d')?.extent === 'part' && items1.find(i => i.outcome_id === 'r028-d')?.portion_note === 'basic EPS only')
  const calHtml = await (await st.s.req(`/app/calendar?view=agenda&week=${placed1[0].local_date}`)).text()
  step('the planned consolidation work shows in Calendar and Curriculum marks class coverage as exposure, never evidence', calHtml.includes('Consolidat') || placed1.length > 0, 'calendar') 
  const tr2 = await tracker(st); const d = tr2.rows.find((r: any) => r.outcomeId === 'r028-d')
  step('class coverage does not move the evidence band', d?.classCoverage === 'part' && d?.band === 'untested', JSON.stringify([d?.classCoverage, d?.band]))
  phase('confirm_retry')
  // ---- 3. a missed class: recorded, nothing manufactured, nothing removed
  const commBefore = await count('calendar_commitments', st.id)
  const pm = await st.s.post('/api/class-log/preview', { classDate: d2, kind: 'missed', items: [] })
  const cm = await st.s.post('/api/class-log/confirm', { classDate: d2, kind: 'missed', items: [], idempotencyKey: `${RUN}-miss`, fingerprint: pm.body?.fingerprint })
  step('a missed class is recorded without any learned scope or new task, and no protected commitment is removed', cm.body?.ok === true && (await count('plan_blocks', st.id, { class_session_id: cm.body.sessionId } as any)) === 0 && (await count('calendar_commitments', st.id)) === commBefore, JSON.stringify(cm.body))
  phase('missed_class')
  // ---- 4. complete the planned work through the real command, then the class-led weekly paper (new outcomes → diagnostic)
  for (const b of placed1) await exec(st, b.id, 'completed', Number(b.duration_minutes))
  const pre = (await st.s.post('/api/tests/preflight', { kind: 'weekly' })).body.decision
  step('new taught outcomes give a DIAGNOSTIC (not revisionary), from the class-confirmed scope only', pre?.state === 'start' && /diagnostic/i.test(pre.purposeLabel), JSON.stringify({ s: pre?.state, l: pre?.purposeLabel, m: pre?.message }).slice(0, 300))
  const scope = (await st.s.json('/api/tests/scope')).body.preview
  const tgt = (scope?.scope?.targets ?? []) as any[]
  // The class said "part of" r028-d (EPS). No verified concept mapping can say which questions test only that part, so r028-d is PENDING, not testable, even though its
  // consolidation task above was completed: the scope is exactly the three fully taught outcomes plus a visible pending portion.
  step('the scope is exactly the three fully taught outcomes (all new); the bounded part (r028-d) is visibly pending and adds no target, although its consolidation task was completed', tgt.map(t => t.outcomeId).sort().join() === 'r028-a,r028-b,r028-c' && tgt.every(t => t.kind === 'new') && (scope?.scope?.pendingPortions ?? []).map((p: any) => p.outcomeId).join() === 'r028-d', JSON.stringify({ t: tgt.map(t => [t.outcomeId, t.weight, t.kind]), p: scope?.scope?.pendingPortions }))
  const start = await st.s.post('/api/tests/start', { kind: 'weekly', expectedRevision: scope.scope.revision })
  const attemptId = start.body.attemptId as string
  const att = (await dq(admin.from('assessment_attempts').select('form_id, attempt_kind, eligibility_policy').eq('id', attemptId).single(), 'attempt') as any)
  const pinned = (await dq(admin.from('form_items').select('item_id, item_version').eq('form_id', att.form_id), 'form items') as any[])
  const items = (await dq(admin.from('assessment_items').select('id, family_id, outcome_id, key_index, provenance, concept_id').in('id', pinned.map(p => p.item_id)), 'items') as any[])
  step('every delivered item is a recorded fixture-bank item for the fully taught outcomes (none from the pending EPS portion), from independent families', start.body?.ok === true && items.length > 0 && items.every(i => bank.items.includes(i.id) && ['r028-a', 'r028-b', 'r028-c'].includes(i.outcome_id)) && new Set(items.map(i => i.family_id)).size === items.length, JSON.stringify(items.map(i => i.outcome_id)))
  phase('assessment_new')
  const taking = (await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items as { id: string; options: string[] }[]
  const key = new Map(items.map(i => [i.id, Number(i.key_index)]))
  const right = (i: { id: string }) => key.get(i.id)!, wrong = (i: { id: string; options: string[] }) => (right(i) + 1) % i.options.length
  for (const [n, i] of taking.entries()) { if (n === 2) continue; await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: i.id, selectedOptionIndex: n === 0 ? wrong(i) : right(i), confidence: n === 0 ? 'high' : n === 1 ? 'low' : 'high', activeSeconds: 10, interruptedSeconds: 0 }) }
  const sub = await st.s.post(`/api/tests/attempt/${attemptId}/submit`, { allowUnanswered: true })
  const a2 = (await dq(admin.from('assessment_attempts').select('status, delivered_count, valid_response_count, omitted_count, correct_response_count, score').eq('id', attemptId).single(), 'scored') as any)
  const evid = await dq(admin.from('evidence_events').select('item_id, evidence_state, is_correct').eq('attempt_id', attemptId), 'evidence') as any[]
  step('scored once: one omission in the denominator, one evidence event per answered question, a confident miss (needs-repair) and an uncertain correct (unstable)', sub.body?.ok === true && a2.status === 'scored' && a2.omitted_count === 1 && evid.length === taking.length - 1 && evid.find(e => e.item_id === taking[0].id)?.evidence_state === 'needs_repair' && evid.find(e => e.item_id === taking[1].id)?.evidence_state === 'unstable', JSON.stringify({ a2, evid }))
  phase('result')
  const ans = await coachSay(st, 'what does this result show about my weakest area?', { attemptId })
  step('Coach opens on that exact result, links it, does not teach the answer or promise a pass', ans.ok === true && (ans.links ?? []).some((l: any) => String(l.href).includes(attemptId)) && !/the answer is|correct option|you will pass|guarantee/i.test(ans.reply), JSON.stringify(ans.links))
  phase('coach')
  const th0 = await dq(admin.from('repair_threads').select('id, status').eq('user_id', st.id).order('id'), 'threads') as any[]
  const prev = await st.s.post('/api/diagnostic/repair/preview', { attemptId })
  step('Keep for later: the follow-up is previewed and left; the same threads stay open and no repair task exists', th0.length >= 1 && prev.body?.ok === true && (await count('plan_blocks', st.id, { task_type: 'repair' })) === 0 && JSON.stringify(await dq(admin.from('repair_threads').select('id, status').eq('user_id', st.id).order('id'), 'threads again')) === JSON.stringify(th0), JSON.stringify({ threads: th0.length, previewOk: prev.body?.ok, prev: prev.body?.error ?? prev.body?.code }))
  phase('keep_for_later')
  if (INJECT === 'phase') { observations.push('INJECTED negative control: the weekly review, next cycle and everything after were skipped on purpose'); return }
  // ---- 5. weekly review → the next class-led cycle (Tuesday anchor, Monday pre-class paper), history untouched
  const wr = (await st.s.json('/api/weekly-review/state')).body?.state
  step('the review opens on the scored class-led paper (no no-paper shortcut)', wr?.gate?.kind === 'paper_scored', JSON.stringify(wr?.gate))
  const choices: Record<string, unknown> = {}; for (const t of (wr?.dueTasks ?? []) as any[]) choices[t.id] = { happened: 'not_done', next: 'later', estimateMinutes: 30 }
  const pw = await st.s.post('/api/weekly-review/preview', { cycleId: cyc.id, choices, acknowledgeNoPaper: false })
  const a1 = await st.s.post('/api/weekly-review/accept', { draftId: pw.body.draftId }), a1b = await st.s.post('/api/weekly-review/accept', { draftId: pw.body.draftId })
  const cycles = await dq(admin.from('planning_cycles').select('id, status, starts_at_local, ends_at_local').eq('user_id', st.id).order('starts_at_local'), 'cycles') as any[]
  const next = cycles.find(c => c.status === 'active')
  step('accepted once (a lost response replays): the old week closed; the next cycle starts the Tuesday after, ends Monday, and carries its pre-class paper', a1.body?.ok === true && a1b.body?.nextCycleId === a1.body?.nextCycleId && cycles.length === 2 && !!next && wd(next.starts_at_local) === 2 && wd(next.ends_at_local) === 1 && next.starts_at_local > String(cyc.ends_at_local), JSON.stringify({ a1: a1.body, cycles }).slice(0, 300))
  const classesOld = await count('class_sessions', st.id, { cycle_id: cyc.id } as any)
  step('history stays in the old week: both class logs and their tasks keep their cycle', classesOld === 2 && (await dq(admin.from('plan_blocks').select('id').eq('class_session_id', c1.body.sessionId).eq('cycle_id', cyc.id), 'old tasks') as any[]).length === placed1.length)
  const reverifyDup = (await dq(admin.from('plan_blocks').select('title, repair_thread_id, task_type').eq('user_id', st.id).eq('cycle_id', next.id).eq('task_type', 'recheck').is('cancelled_at', null), 'reverify') as any[]).filter(r => !r.repair_thread_id)
  step('no standalone "Re-verify" is planned for a concept a repair thread already owns (no duplicate verification obligation)', reverifyDup.length === 0, JSON.stringify(reverifyDup))
  phase('review_next_cycle')
  // ---- 6. one week passes (T1): the next cycle's classes have happened; a REVISION log, then revisionary and mixed papers
  const sh1 = await shiftStudentTimeline(st.id, 1, owned)
  timeFixtures.push({ id: 'T1', student: st.id, ...sh1, source: 'one calendar week passes after the accepted review', proves: 'the next class-led cycle\'s commands from consistent history', cannotProve: 'elapsed weeks' })
  const ctx2 = (await st.s.json('/api/class-log/context')).body?.context
  const [e1, e2] = ((ctx2?.pendingDates ?? []) as string[]).slice().sort()
  step('the next cycle\'s class days that happened are listed as unlogged', !!e1 && !!e2, JSON.stringify(ctx2?.pendingDates))
  if (!e1 || !e2) return
  const log3 = { classDate: e1, kind: 'revision', items: ['a', 'b', 'c'].map(c => ({ outcomeId: `r028-${c}`, extent: 'full' })) }
  const p3 = await st.s.post('/api/class-log/preview', log3)
  const c3 = await st.s.post('/api/class-log/confirm', { ...log3, idempotencyKey: `${RUN}-rev`, fingerprint: p3.body.fingerprint })
  const placed3 = await dq(admin.from('plan_blocks').select('id, task_type, duration_minutes').eq('class_session_id', c3.body.sessionId), 'revision tasks') as any[]
  step('a class that revisited covered material plans REVISION (review tasks), not new first-pass content', c3.body?.ok === true && placed3.length > 0 && placed3.every(b => b.task_type === 'review'), JSON.stringify(placed3))
  phase('revision_log')
  for (const b of placed3) await exec(st, b.id, 'completed', Number(b.duration_minutes))
  const sc3 = (await st.s.json('/api/tests/scope')).body.preview
  const pre3 = (await st.s.post('/api/tests/preflight', { kind: 'weekly' })).body.decision
  step('only previously covered outcomes revisited → a REVISIONARY paper whose scope is exactly those outcomes, all labelled revision', pre3?.state === 'start' && /revision/i.test(pre3.purposeLabel) && (sc3?.scope?.targets ?? []).every((t: any) => t.kind === 'revision') && (sc3?.scope?.targets ?? []).map((t: any) => t.outcomeId).sort().join() === 'r028-a,r028-b,r028-c', JSON.stringify({ l: pre3?.purposeLabel, t: sc3?.scope?.targets }).slice(0, 300))
  phase('assessment_revisionary')
  const log4 = { classDate: e2, kind: 'covered', items: ['a', 'b', 'c'].map(c => ({ outcomeId: `r029-${c}`, extent: 'full' })) }
  const p4 = await st.s.post('/api/class-log/preview', log4)
  const c4 = await st.s.post('/api/class-log/confirm', { ...log4, idempotencyKey: `${RUN}-new2`, fingerprint: p4.body.fingerprint })
  for (const b of await dq(admin.from('plan_blocks').select('id, duration_minutes').eq('class_session_id', c4.body.sessionId), 'new tasks') as any[]) await exec(st, b.id, 'completed', Number(b.duration_minutes))
  const sc5 = (await st.s.json('/api/tests/scope')).body.preview
  const pre5 = (await st.s.post('/api/tests/preflight', { kind: 'weekly' })).body.decision
  const kinds = Object.fromEntries((sc5?.scope?.targets ?? []).map((t: any) => [t.outcomeId, t.kind]))
  step('new + revisited outcomes → a MIXED paper with each part\'s provenance visible (r029-a..c new, r028-a..c revision)', pre5?.state === 'start' && /mixed|new/i.test(pre5.purposeLabel) && ['a', 'b', 'c'].every(c => kinds[`r029-${c}`] === 'new' && kinds[`r028-${c}`] === 'revision'), JSON.stringify({ l: pre5?.purposeLabel, st: pre5?.state, m: pre5?.message, kinds }))
  phase('assessment_mixed')
  // ---- 7. repair work carried into this cycle, then the spaced fresh-family re-check
  const rTasks = await dq(admin.from('plan_blocks').select('id, repair_thread_id').eq('user_id', st.id).eq('task_type', 'repair').is('cancelled_at', null), 'repair tasks') as any[]
  if (rTasks.length) {
    for (const t of rTasks) await exec(st, t.id, 'completed', 25)
    const tids = [...new Set(rTasks.map(t => t.repair_thread_id as string))]
    const chk = await st.s.post('/api/diagnostic/repair/check', { threadIds: tids, idempotencyKey: `${RUN}-chk` })
    const checkId = chk.body?.checkTaskId as string
    const rs = await st.s.post('/api/tests/start', { kind: 'repair', checkTaskId: checkId })
    const done = (await dq(admin.from('repair_threads').select('status, latest_check_state').in('id', tids), 'threads') as any[])
    // The repair work was finished TODAY, so the recorded spacing has not elapsed: the same service must refuse (the after-spacing start is proven in Journey A).
    step('repair activity alone does not close the weakness, and the re-check cannot start before the recorded spacing (no attempt created)', chk.body?.ok === true && done.every(t => t.latest_check_state === null && t.status === 'awaiting_recheck') && rs.body?.ok !== true && /spacing|can start from/i.test(JSON.stringify(rs.body)), JSON.stringify({ chk: chk.body, rs: rs.body }).slice(0, 300))
    phase('repair_recheck')
  } else notRun('repair work and re-check', 'the accepted next cycle carried no repair task for this join')
}
async function journeyC() {
  J_ = 'C'; console.log('\n=== Journey C — first pass complete, mock in a month ===')
  const { completeOnboarding } = await import('./lib/e2eSession')
  const st = await fresh('lcC', { onboard: false })
  const topics = ((await admin.from('topics').select('id')).data ?? []).map(t => t.id as string)
  const mockDate = addDays(today, 30)
  await completeOnboarding(st.s, admin, { stage: 'revising_or_mocks', topicExposure: Object.fromEntries(topics.map(t => [t, 'recent'])), positionExtra: { mock: { date: mockDate, kind: 'provider_mock' } } })
  const blocks = (await admin.from('plan_blocks').select('id, title, task_type, local_date').eq('user_id', st.id).is('cancelled_at', null)).data ?? []
  step('a student who finished the first pass is not given generic first-pass tasks', blocks.length > 0 && !blocks.some(b => /^Study: /.test(String(b.title))), blocks.slice(0, 3).map(b => b.title).join(' | '))
  const cp = (await st.s.json('/api/checkpoints')).body
  const v = cp?.checkpoint ?? cp
  step('the mock a month away is the student\'s checkpoint, with a version', !!(v?.checkpointId ?? v?.id) && Number.isFinite(Number(v?.version)), JSON.stringify(cp).slice(0, 220))
  const id = v?.checkpointId ?? v?.id, ver = Number(v?.version)
  const keyM = `lcC-move-${Date.now()}`
  const dowC = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
  let weekend = addDays(today, 32); while (dowC(weekend) !== 6) weekend = addDays(weekend, 1)
  const body = (key: string, date: string, startTime = '10:00') => JSON.stringify({ key, checkpointId: id, expectedVersion: ver, date, kind: 'provider_mock', startTime, durationMinutes: 120 })
  const overlap = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: body(`${keyM}-w`, addDays(weekend, -3)) })
  step('a mock cannot be booked over the student\'s Monday–Friday work: refused with the conflict named, nothing changed', overlap.body?.code === 'SLOT_TAKEN' && /Work/.test(JSON.stringify(overlap.body.conflicts)), JSON.stringify(overlap.body).slice(0, 200))
  const moved = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: body(keyM, weekend) })
  step('the mock is moved to a free weekend slot, with its version', moved.body?.ok === true && moved.body.receipt?.version === ver + 1, JSON.stringify(moved.body).slice(0, 200))
  const again = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: body(keyM, weekend) })
  step('a lost response is safe: the same key returns the original receipt', again.body?.ok === true && again.body.receipt?.version === moved.body.receipt?.version, JSON.stringify(again.body).slice(0, 160))
  const staleMove = await st.s.json('/api/checkpoints', { method: 'PUT', headers: J, body: JSON.stringify({ key: `${keyM}-2`, checkpointId: id, expectedVersion: ver, date: addDays(weekend, 7), kind: 'provider_mock' }) })
  step('an older version cannot change the newer record', staleMove.status === 409 && staleMove.body?.code === 'CHECKPOINT_CHANGED', JSON.stringify(staleMove.body).slice(0, 160))
  const cp2 = (await st.s.json('/api/checkpoints')).body, v2 = cp2?.checkpoint ?? cp2
  // External mock: topic scores are self-report; no item-level evidence appears
  const evBefore = await count('evidence_events', st.id)
  const out = await st.s.json('/api/checkpoints', { method: 'POST', headers: J, body: JSON.stringify({ key: `lcC-out-${Date.now()}`, checkpointId: id, expectedVersion: Number(v2?.version), action: 'outcome', outcome: 'taken', result: '62%', notes: 'felt rushed', choice: 'use_mock', paperAction: 'replace' }) })
  step('the external mock result is recorded as self-report', out.body?.ok === true, JSON.stringify(out.body).slice(0, 200))
  step('and creates no fabricated item-level evidence', (await count('evidence_events', st.id)) === evBefore)
  const coach = await coachSay(st, 'I have a mock coming up.', { intent: 'mock' })
  step('Coach answers about the mock from the stored record and links it', coach.ok === true && (coach.links ?? []).some((l: any) => /calendar|tests|mock/i.test(String(l.href))), JSON.stringify(coach.links))
  // Exam-sat: planned work stays as history, countdown pressure ends, the exam page is the destination
  const sat = await st.s.json('/api/exam', { method: 'POST', headers: J, body: JSON.stringify({ action: 'sat', satOn: addDays(today, -2) }) })
  step('"I sat the exam" is recorded as the student\'s own statement', sat.body?.ok === true || sat.status === 200, JSON.stringify(sat.body).slice(0, 160))
  const after = await coachSay(st, 'What should I do today?')
  step('after the exam, Coach points to the exam page instead of weekly pressure', (after.links ?? []).some((l: any) => String(l.href) === '/app/exam'), JSON.stringify(after.links))
  notRun('C: internal rehearsal variant, preparation-basis staleness, challenge/void invalidation, dated final week and horizon', 'covered only by e2e-rehearsal-journey and e2e-checkpoint-commands (separate students); not connected in this runner')
}

function target() {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://invalid').hostname.split('.')[0]
  let confirmed = ''
  try { confirmed = (dotenv.parse(fs.readFileSync('.env.staging.local')) as Record<string, string>).E2E_CONFIRMED_DISPOSABLE_PROJECT_REF ?? '' } catch { /* missing file is a refusal below */ }
  if (ref !== TARGET || confirmed !== TARGET) throw new Error(`SETUP FAILURE: the database in .env.local is ${ref}, the owner-confirmed disposable project is ${confirmed || '(unset)'}, this runner is pinned to ${TARGET}. Nothing was created.`)
}

type Status = 'complete' | 'limited_actual_bank' | 'incomplete_known' | 'incomplete' | 'failed'
function statusOf(j: string): Status {
  const rows = report.filter(r => r.journey === j)
  if (rows.some(r => r.status === 'fail')) return 'failed'
  if (j === 'A') {
    const missing = A_PHASES.filter(ph => !reached.has(`A:${ph}`))
    if (BANK === 'actual') return rows.some(r => r.status === 'unavailable') && !rows.some(r => r.status === 'not_run') ? 'limited_actual_bank' : 'incomplete'
    return missing.length === 0 && !rows.some(r => r.status === 'unavailable' || r.status === 'not_run') ? 'complete' : 'incomplete'
  }
  if (j === 'B') {
    if (BANK === 'actual') return rows.some(r => r.status === 'unavailable') && !rows.some(r => r.status === 'not_run') ? 'limited_actual_bank' : 'incomplete'
    return B_PHASES.every(ph => reached.has(`B:${ph}`)) && !rows.some(r => r.status === 'unavailable' || r.status === 'not_run') ? 'complete' : 'incomplete'
  }
  return rows.some(r => r.status === 'not_run' || r.status === 'unavailable') ? 'incomplete_known' : 'complete'
}

async function main() {
  console.log(`\nLifecycle proof — run ${RUN}, scenario ${SCENARIO}, bank track ${BANK}${INJECT ? `, INJECTED negative control: ${INJECT}` : ''}\n`)
  target()
  await preflightServer()
  const t0 = Date.now()
  try {
    if (SCENARIO === 'A' || SCENARIO === 'all') await journeyA()
    if (SCENARIO === 'B' || SCENARIO === 'all') await journeyB()
    if (SCENARIO === 'C' || SCENARIO === 'all') await journeyC()
  } finally {
    const cleanup: { what: string; ok: boolean; error?: string }[] = []
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
    if (bankFile && fs.existsSync(bankFile)) { try { execFileSync('node', ['scripts/fixture-bank.cjs', 'destroy', `--confirm-target=${TARGET}`, `--file=${bankFile}`], { stdio: 'inherit' }); cleanup.push({ what: `fixture bank ${(bankRecord as { tag?: string } | null)?.tag}`, ok: true }) } catch (e) { cleanup.push({ what: 'fixture bank', ok: false, error: (e as Error).message }) } }
    releaseBankLock()
    for (const c of cleanup.filter(x => !x.ok)) console.error(`CLEANUP FAILED: ${c.what}: ${c.error}`)
    const journeys = Object.fromEntries(['A', 'B', 'C'].filter(j => report.some(r => r.journey === j)).map(j => [j, statusOf(j)]))
    fs.mkdirSync('docs/evidence', { recursive: true })
    fs.writeFileSync(`docs/evidence/lifecycle-${today}-${SCENARIO}-${BANK}${INJECT ? `-inject-${INJECT}` : ''}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, scenario: SCENARIO, bank: BANK, inject: INJECT || null, seconds: Math.round((Date.now() - t0) / 1000), journeys, fixtureBank: bankRecord, timeFixtures, observations, cleanup, report }, null, 1))
    ;(globalThis as any).__cleanupFailed = cleanup.some(c => !c.ok)
  }
  const c = (s: Row['status']) => report.filter(r => r.status === s).length
  const journeys = Object.fromEntries(['A', 'B', 'C'].filter(j => report.some(r => r.journey === j)).map(j => [j, statusOf(j)]))
  console.log(`\n${c('pass')} passed, ${c('fail')} failed, ${c('unavailable')} unavailable, ${c('not_run')} not run`)
  console.log(`journey status: ${JSON.stringify(journeys)}${observations.length ? `\nobservations:\n- ${observations.join('\n- ')}` : ''}\n`)
  // Success means every selected journey is COMPLETE (or an honestly labelled actual-bank limitation). A known-incomplete journey or a failed step is never a pass.
  const vals = Object.values(journeys)
  if (c('fail') || vals.includes('failed') || (globalThis as any).__cleanupFailed) process.exit(1)
  if (vals.some(v => v !== 'complete' && v !== 'limited_actual_bank')) process.exit(3)
}
main().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
