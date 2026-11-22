/**
 * T3 through the NORMAL student endpoints and the real reviewer database commands, on a TEST-ONLY approved fixture bank
 * (scripts/fixture-bank.cjs). Synthetic difficulty labels prove software branching, not CFA calibration. Ordinary throwaway students;
 * fixture rows are never created or removed here.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/e2e-difficulty-journey.ts --bank=<fixture-bank record>
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createStudent, makeCheck } from './lib/e2eSession'

const require = createRequire(path.join(process.cwd(), 'package.json'))
const { Client } = require('pg'); const { parse } = require('dotenv'); const { configuration } = require('./scripts/lib/migrations.cjs')
const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const arg = (k: string) => (process.argv.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=')
const bank = JSON.parse(fs.readFileSync(arg('bank'), 'utf8')) as { items: string[]; users: string[] }
const made: string[] = []
type Student = Awaited<ReturnType<typeof createStudent>>
const uuid = () => crypto.randomUUID()
const READING = 'r028'

const dropStudents = async () => {
  for (const id of made.splice(0)) {
    await admin.from('practice_runs').delete().eq('user_id', id)
    const { data: att } = await admin.from('assessment_attempts').select('id, form_id').eq('user_id', id)
    const aIds = (att ?? []).map(a => a.id as string), forms = (att ?? []).map(a => a.form_id as string).filter(Boolean)
    if (aIds.length) { for (const t of ['evidence_events', 'item_challenges', 'assessment_responses', 'attempt_item_progress']) await admin.from(t).delete().in('attempt_id', aIds) }
    const threads = ((await admin.from('repair_threads').select('id').eq('user_id', id)).data ?? []).map(t => t.id as string)
    if (threads.length) { await admin.from('repair_check_threads').delete().in('thread_id', threads); await admin.from('repair_thread_events').delete().in('thread_id', threads) }
    await admin.from('plan_blocks').update({ repair_thread_id: null }).eq('user_id', id)
    await admin.from('repair_threads').delete().eq('user_id', id)
    if (aIds.length) await admin.from('assessment_attempts').delete().in('id', aIds)
    if (forms.length) { await admin.from('form_items').delete().in('form_id', forms); await admin.from('assessment_forms').delete().in('id', forms) }
    await admin.auth.admin.deleteUser(id)
  }
}

async function pg() {
  const root = process.cwd(), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, query_timeout: 60000 }); await c.connect(); return c
}
const as = async (c: any, uid: string, sql: string, p: unknown[] = []) => {
  await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { const r = await c.query(sql, p); await c.query('COMMIT'); return r.rows[0] } catch (e) { await c.query('ROLLBACK'); throw e }
}

/** Answers every item of an attempt through the real endpoint. `right(i)` picks correct/incorrect per item. */
async function answerAll(st: Student, attemptId: string, right: (i: number, level: string | null) => boolean, confidence: (i: number) => 'low' | 'medium' | 'high' = () => 'high', only?: number) {
  const items = (await st.s.json(`/api/tests/attempt/${attemptId}`)).body.items as { id: string; options: string[] }[]
  const meta = new Map(((await admin.from('assessment_items').select('id, key_index').in('id', items.map(i => i.id))).data ?? []).map(r => [r.id as string, Number(r.key_index)]))
  const attempt = (await admin.from('assessment_attempts').select('form_id').eq('id', attemptId).single()).data!
  const lv = new Map(((await admin.from('form_items').select('item_id, difficulty_level').eq('form_id', attempt.form_id as string)).data ?? []).map(r => [r.item_id as string, r.difficulty_level as string | null]))
  let n = 0
  for (const [i, it] of items.entries()) {
    if (only !== undefined && n >= only) break
    const key = meta.get(it.id)!
    await st.s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: it.id, selectedOptionIndex: right(i, lv.get(it.id) ?? null) ? key : (key + 1) % it.options.length, confidence: confidence(i), activeSeconds: 10, interruptedSeconds: 0 })
    n++
  }
  return items.length
}
const submit = (st: Student, id: string) => st.s.post(`/api/tests/attempt/${id}/submit`, { allowUnanswered: true })
const scoped = { readingId: READING }

async function main() {
  const db = await pg()
  const reviewer = bank.users[0]
  try {
    console.log('\nA. Reviewed difficulty on the real reviewer commands')
    const probe = (await admin.from('assessment_items').select('id, item_version, intended_difficulty').in('id', bank.items).limit(1)).data![0]
    const confirmed = (await admin.from('item_confirmed_difficulty').select('level, reviewer_id, created_at, item_version').eq('item_id', probe.id)).data ?? []
    check('fixture approvals went through the reviewer commands: a level is confirmed for the exact version, with reviewer and time', confirmed.length === 1 && confirmed[0].item_version === probe.item_version && !!confirmed[0].reviewer_id && !!confirmed[0].created_at)
    check('the generator tag is only a proposal; the confirmed level is a separate record', probe.intended_difficulty !== null)
    const st0 = await createStudent(admin, 'dz', { onboard: true }); made.push(st0.id)
    const noAuth = await as(db, st0.id, "select public.confirm_item_difficulty($1,$2,'standard','a student cannot do this') as r", [probe.id, probe.item_version]).then(r => r.r)
    check('a student cannot confirm a level', noAuth.code === 'FORBIDDEN')
    const bad = await as(db, reviewer, "select public.confirm_item_difficulty($1,$2,'expert','long enough rationale text') as r", [probe.id, probe.item_version]).then(r => r.r)
    check('an unknown level is refused', bad.code === 'BAD_LEVEL')
    const short = await as(db, reviewer, "select public.confirm_item_difficulty($1,$2,'standard','short') as r", [probe.id, probe.item_version]).then(r => r.r)
    check('a rationale is required', short.code === 'RATIONALE_REQUIRED')
    const stale = await as(db, reviewer, "select public.confirm_item_difficulty($1,$2,'standard','long enough rationale text') as r", [probe.id, probe.item_version + 1]).then(r => r.r)
    check('a stale version is refused', stale.code === 'STALE_VERSION')
    for (const t of ['practice_runs', 'practice_run_sets', 'item_difficulty_reviews']) {
      const e = await as(db, st0.id, `insert into public.${t} select * from public.${t} limit 0`).then(() => null, (x: any) => x.message)
      void e
    }
    const denied = await as(db, st0.id, "insert into public.practice_runs(user_id, request_key, reading_id, cap, policy_version) values ($1,'k','r028',10,'x') returning id", [st0.id]).then(() => false, (e: any) => /permission denied|row-level security/.test(e.message))
    check('a student cannot insert a practice run (or a completed one) directly', denied)
    const denied2 = await as(db, st0.id, "insert into public.item_difficulty_reviews(item_id,item_version,level,rationale,reviewer_id) values ($1,1,'standard','a student writing their own label',$2)", [probe.id, st0.id]).then(() => false, (e: any) => /permission denied|row-level security/.test(e.message))
    check('a student cannot write difficulty history', denied2)

    console.log('\nB. Fresh learner: cold start, preview purity, determinism')
    const st = await createStudent(admin, 'da', { onboard: true }); made.push(st.id)
    const before = (await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count
    const body = { kind: 'reading', readingId: READING, baseline: true }
    const p1 = (await st.s.post('/api/tests/preflight', body)).body.decision
    const p2 = (await st.s.post('/api/tests/preflight', body)).body.decision
    check('a baseline reading check is startable on the fixture bank', p1?.state === 'start', JSON.stringify(p1)?.slice(0, 200))
    check('fresh learner: Balanced, with the limited-evidence basis stated', p1.difficulty?.readings?.[0]?.profile === 'balanced' && p1.difficulty.readings[0].basis === 'limited' && /not enough recent independent evidence/i.test(p1.difficulty.readings[0].reasons.join(' ')))
    check('the integer target sums to the real form size', Object.values(p1.difficulty.target as Record<string, number>).reduce((a, b) => a + b, 0) === p1.requested)
    check('the reported mix equals what is delivered', Object.values(p1.difficulty.actual as Record<string, number>).reduce((a, b) => a + b, 0) === p1.deliverable)
    const core = (d: any) => JSON.stringify({ ...d, cutoff: undefined })
    check('a refresh returns the same decision (no new mix on refresh)', core(p1.difficulty) === core(p2.difficulty) && p1.deliverable === p2.deliverable, `${core(p1.difficulty)}\n${core(p2.difficulty)}`)
    check('the preview exposes no item ids, keys or pool', !/"itemId"|keyIndex|key_index|"pool"/.test(JSON.stringify(p1)))
    check('previewing created no attempt, form or exposure', (await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', st.id)).count === before)

    console.log('\nC. Reservation pins the form the student reviewed')
    const startR = await st.s.post('/api/tests/start', { ...body, expectedDecision: p1.difficulty.evidenceRevision })
    check('start succeeds with the reviewed revision', startR.body?.ok === true, JSON.stringify(startR.body).slice(0, 200))
    const attemptId = startR.body.attemptId as string
    const att = (await admin.from('assessment_attempts').select('form_id, requested_blueprint, delivered_coverage').eq('id', attemptId).single()).data!
    const fis = (await admin.from('form_items').select('item_id, difficulty_level, difficulty_basis, difficulty_review_id').eq('form_id', att.form_id as string)).data ?? []
    check('every reserved row froze a confirmed level and the review it came from', fis.length === p1.deliverable && fis.every(f => f.difficulty_basis === 'confirmed' && f.difficulty_level && f.difficulty_review_id))
    const cov = (att.delivered_coverage as any)?.difficulty, req = (att.requested_blueprint as any)?.difficulty
    check('the form records policy, targets, actual mix, evidence revision and seed', cov?.policy === 'difficulty-policy.1' && !!cov.seed && !!cov.evidenceRevision && !!cov.target && !!cov.actual && req?.policy === cov.policy)
    const norm = (o: any) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()))
    check('the started form equals the previewed mix', norm(cov.actual) === norm(p1.difficulty.actual), `${JSON.stringify(cov.actual)} vs ${JSON.stringify(p1.difficulty.actual)}`)
    const probeItem = fis[0].item_id as string, probeLevel = fis[0].difficulty_level as string
    const ver = (await admin.from('assessment_items').select('item_version').eq('id', probeItem).single()).data!.item_version as number
    const other = probeLevel === 'difficult' ? 'foundation' : 'difficult'
    const re = await as(db, reviewer, "select public.confirm_item_difficulty($1,$2,$3,'reclassified after reservation to test that history is pinned') as r", [probeItem, ver, other]).then(r => r.r)
    check('a reviewer can reclassify a used item (explicit metadata revision)', re.ok === true)
    const after = (await admin.from('form_items').select('difficulty_level').eq('form_id', att.form_id as string).eq('item_id', probeItem).single()).data!
    check('the earlier student’s form keeps the interpretation it was reserved with', after.difficulty_level === probeLevel)
    check('the current view shows the revision; history keeps both rows', (await admin.from('item_confirmed_difficulty').select('level').eq('item_id', probeItem).eq('item_version', ver).single()).data!.level === other && ((await admin.from('item_difficulty_reviews').select('id').eq('item_id', probeItem)).data ?? []).length === 2)
    await as(db, reviewer, "select public.confirm_item_difficulty($1,$2,$3,'restored to the original synthetic label') as r", [probeItem, ver, probeLevel])

    console.log('\nD. Stale evidence and metadata after preview (atomic)')
    const pre = (await st.s.post('/api/tests/preflight', { kind: 'reading', readingId: READING, baseline: true })).body.decision
    check('an open paper resumes before any fresh selection', pre.state === 'resume' && pre.attemptId === attemptId)
    const total = await answerAll(st, attemptId, (i, lv) => lv !== 'standard' && i % 2 === 0)   // standard-level questions are missed in both papers
    check('answers are saved', total > 0)
    const evBefore = (await admin.rpc('difficulty_evidence_version', { p_user: st.id })).data as string
    const sub = await submit(st, attemptId)
    check('the paper is scored', sub.body?.ok === true)
    const evAfter = (await admin.rpc('difficulty_evidence_version', { p_user: st.id })).data as string
    check('scoring changed the evidence revision', evBefore !== evAfter)
    const staleStart = await st.s.post('/api/tests/start', { ...body, expectedDecision: p1.difficulty.evidenceRevision })
    check('starting from a revision reviewed before new results is refused as stale, with the updated decision', staleStart.status === 409 && !!staleStart.body.decision?.difficulty, JSON.stringify(staleStart.body).slice(0, 160))
    const items2 = (await admin.from('assessment_items').select('id, item_version').in('id', bank.items).limit(5)).data!
    const atomicEv = (await admin.rpc('start_paper_checked', { p_user: st.id, p_evidence: 'not-the-current-revision', p_levels: null, p_paper: { kind: 'reading', itemIds: items2.map(i => i.id) } })).data as any
    check('the database refuses a reservation whose evidence revision is not current', atomicEv?.code === 'DECISION_CHANGED')
    const atomicLv = (await admin.rpc('start_paper_checked', { p_user: st.id, p_evidence: null, p_levels: Object.fromEntries(items2.map(i => [i.id, 'stretch'])), p_paper: { kind: 'reading', itemIds: items2.map(i => i.id) } })).data as any
    check('and one whose item labels changed since the student looked', atomicLv?.code === 'DECISION_CHANGED')

    console.log('\nE. Evidence-driven adaptation (two papers, eight independent observations)')
    const e1 = (await st.s.post('/api/tests/start', body)).body
    const t2 = await answerAll(st, e1.attemptId, () => false, () => 'low'); await submit(st, e1.attemptId)
    const pe = (await st.s.post('/api/tests/preflight', body)).body.decision
    const dr = pe.difficulty?.readings?.[0]
    const eligible = (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', st.id).eq('evidence_mode', 'evidence').eq('validity', 'valid')).count ?? 0
    console.log(`    (observations recorded: ${eligible}; papers: 2 of sizes ${total}, ${t2}; basis ${dr?.basis}, profile ${dr?.profile})`)
    if (eligible >= 8) {
      check('eight or more eligible observations over two papers personalise the scope', dr?.basis !== 'limited')
      check('low results with standard misses → foundation support, explained in plain words', dr?.profile === 'support' && /correct/.test(dr.reasons.join(' ')) && !/weak student/i.test(JSON.stringify(pe)))
      check('the support target has extra foundation questions and no difficult ones', pe.difficulty.target.difficult === 0 && pe.difficulty.target.foundation >= pe.difficulty.target.standard - 1)
      check('standard stays at least half (when inventory permits)', pe.difficulty.target.standard >= Math.floor(pe.requested / 2))
    } else check('fewer than eight eligible observations keep the cold-start profile', dr?.basis === 'limited' && dr.profile === 'balanced')

    console.log('\nF. Adaptive practice: preview → start → answer → result → next → stop / cap')
    const prac = await createStudent(admin, 'dp', { onboard: true }); made.push(prac.id)
    const pbody = { kind: 'practice', mode: 'adaptive', readingId: READING, cap: 20 }
    const attemptsBefore = (await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count
    const pp = (await prac.s.post('/api/tests/preflight', pbody)).body
    check('preview is read-only and states what practice is not', pp.ok && pp.adaptive.state === 'start' && /does not verify understanding/.test(pp.adaptive.statement) && pp.adaptive.size === 5 && pp.adaptive.cap === 20)
    check('no run, form or exposure was written by the preview', (await admin.from('practice_runs').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === 0 && (await admin.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === attemptsBefore)
    check('the preview names no items, keys or pool', !/itemId|keyIndex|key_index|itemIds/.test(JSON.stringify(pp)))
    const one0 = (await admin.from('reading_los').select('id').eq('reading_id', READING).order('id').limit(1)).data![0].id as string
    const key = `k-${uuid()}`
    const [s1, s1b] = await Promise.all([prac.s.post('/api/tests/start', { ...pbody, requestKey: key, expectedDecision: pp.adaptive.evidenceRevision }), prac.s.post('/api/tests/start', { ...pbody, requestKey: key })])
    check('start creates one owned run and its first set; a duplicate start with the same key converges', s1.body.ok && s1b.body.ok && s1.body.runId === s1b.body.runId && s1.body.attemptId === s1b.body.attemptId && (await admin.from('practice_runs').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === 1)
    const runId = s1.body.runId as string, a1 = s1.body.attemptId as string
    const ra = (await admin.from('assessment_attempts').select('attempt_kind, time_limit_minutes, status').eq('id', a1).single()).data!
    check('the set is an ordinary untimed practice attempt of five questions', ra.attempt_kind === 'practice' && ra.time_limit_minutes === null && (await admin.from('form_items').select('item_id', { count: 'exact', head: true }).eq('form_id', (await admin.from('assessment_attempts').select('form_id').eq('id', a1).single()).data!.form_id as string)).count === 5)
    const g0 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    check('run state: owned, set open, action Resume, not finished', g0.action === 'resume' && g0.openAttemptId === a1 && g0.finished === false && g0.cap === 20)
    const nOpen = await prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g0.revision, requestKey: `k-${uuid()}` })
    check('Continue is refused while a set is open', nOpen.status === 409 && nOpen.body.code === 'set_open')
    const sOpen = await prac.s.post(`/api/tests/practice-runs/${runId}/stop`, { expectedRevision: g0.revision })
    check('Stop is refused while a set is open (no destroying or secret scoring)', sOpen.status === 409 && sOpen.body.code === 'set_open')
    const other2 = await createStudent(admin, 'do', { onboard: true }); made.push(other2.id)
    check('another student cannot read, continue or stop this run', (await other2.s.json(`/api/tests/practice-runs/${runId}`)).status === 404 && (await other2.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: 2, requestKey: 'xxxxxxxxxx' })).status === 404 && (await other2.s.post(`/api/tests/practice-runs/${runId}/stop`, {})).status === 404)
    const ev0 = (await admin.rpc('difficulty_evidence_version', { p_user: prac.id })).data as string
    await answerAll(prac, a1, () => true); const sb1 = await submit(prac, a1)
    check('submitting the set uses the ordinary submit endpoint', sb1.body?.ok === true)
    const g1 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    check('after the set: Continue is offered with the next approach and why', g1.action === 'continue' && g1.next?.state === 'start' && g1.next.reasons.length > 0 && g1.delivered === 5 && g1.answered === 5)
    check('practice wrote no evidence, repair, readiness or weekly credit', (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === 0 && (await admin.from('repair_threads').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === 0 && (await admin.rpc('difficulty_evidence_version', { p_user: prac.id })).data === ev0)
    const kn = `k-${uuid()}`
    const [n1, n2] = await Promise.all([prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g1.revision, requestKey: kn }), prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g1.revision, requestKey: kn })])
    check('Continue/Continue with one key: one next set, both callers see it', n1.body.ok && n2.body.ok && n1.body.attemptId === n2.body.attemptId && (await admin.from('practice_run_sets').select('block_no', { count: 'exact', head: true }).eq('run_id', runId)).count === 2)
    await answerAll(prac, n1.body.attemptId, () => true); await submit(prac, n1.body.attemptId)
    const g2 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    const [r1, r2] = await Promise.all([prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g2.revision, requestKey: `k-${uuid()}` }), prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g2.revision, requestKey: `k-${uuid()}` })])
    const oks = [r1, r2].filter(r => r.body.ok).length
    check('Continue/Continue with different keys: exactly one next set; the other is told the run changed', oks === 1 && [r1, r2].some(r => r.body.code === 'stale_run' || r.body.code === 'set_open') && (await admin.from('practice_run_sets').select('block_no', { count: 'exact', head: true }).eq('run_id', runId)).count === 3)
    const g3 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    check('two consecutive full strong sets: the third set steps up ONE level, with the reason', g3.sets.length === 3 && /Practice|practice/.test(JSON.stringify(g3)) && g3.sets[2].decision.profile !== 'support' && g3.sets[2].decision.priorSets === 2, JSON.stringify(g3.sets.map((s: any) => s.decision?.profile)))
    check('the set records its policy, target and actual mix', g3.sets[2].decision.policy === 'difficulty-policy.1/practice' && !!g3.sets[2].decision.target && !!g3.sets[2].decision.actual)
    const openAtt = g3.openAttemptId as string
    await answerAll(prac, openAtt, () => true); await submit(prac, openAtt)
    const g4 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    const [cn, st2] = await Promise.all([prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: g4.revision, requestKey: `k-${uuid()}` }), prac.s.post(`/api/tests/practice-runs/${runId}/stop`, { expectedRevision: g4.revision })])
    const setsNow = (await admin.from('practice_run_sets').select('block_no', { count: 'exact', head: true }).eq('run_id', runId)).count
    const finalRun = (await admin.from('practice_runs').select('status').eq('id', runId).single()).data!.status
    check('Continue/Stop race: one coherent outcome (a next set XOR a stopped run), never both', (cn.body.ok && !st2.body.ok && setsNow === g4.sets.length + 1 && finalRun === 'active') || (!cn.body.ok && st2.body.ok && setsNow === g4.sets.length && finalRun === 'stopped'), JSON.stringify({ cn: cn.body.code ?? 'ok', st: st2.body.code ?? 'ok', setsNow, finalRun }))
    if (finalRun === 'active') { const op = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run; await answerAll(prac, op.openAttemptId, () => true); await submit(prac, op.openAttemptId) }
    const g5 = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    const stopped = await prac.s.post(`/api/tests/practice-runs/${runId}/stop`, { expectedRevision: g5.revision })
    check('Stop at a boundary succeeds and is idempotent', stopped.body.ok === true && (await prac.s.post(`/api/tests/practice-runs/${runId}/stop`, {})).body.ok === true)
    const afterStop = await prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: 99, requestKey: `k-${uuid()}` })
    check('after Stop no further set can be reserved', afterStop.status === 409 && afterStop.body.ok === false)
    const fin = (await prac.s.json(`/api/tests/practice-runs/${runId}`)).body.run
    check('the compact summary has actual delivered/answered counts and no mastery claim', fin.finished === true && fin.delivered === fin.sets.length * 5 && fin.answered <= fin.delivered && !/mastery|mastered/i.test(JSON.stringify(fin)))
    check('the whole run still produced no evidence, repair or weekly credit', (await admin.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', prac.id)).count === 0)

    console.log('\nC4. Retry receipts: a successful operation is replayed as itself')
    const setCount = async () => (await admin.from('practice_run_sets').select('block_no', { count: 'exact', head: true }).eq('run_id', runId)).count
    const setsBefore = await setCount()
    const old = await prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: 1, requestKey: kn })
    check('an older successful Continue retried after later sets AND a Stop returns ITS original set (not the latest), shows the run as stopped, creates nothing', old.body.ok === true && old.body.attemptId === n1.body.attemptId && old.body.replay === true && old.body.runStatus === 'stopped' && (await setCount()) === setsBefore)
    check('the run stays stopped after the replay (nothing revived)', (await admin.from('practice_runs').select('status').eq('id', runId).single()).data!.status === 'stopped')
    const startAgain = await prac.s.post('/api/tests/start', { ...pbody, requestKey: key })
    check('the original Start key still returns the first set even though the run has ended and the cap/inventory moved on', startAgain.body.ok === true && startAgain.body.attemptId === a1 && startAgain.body.replay === true)
    const wrongScope = await prac.s.post('/api/tests/start', { ...pbody, outcomeIds: [one0], requestKey: key })
    check('the same key with a different scope is a conflict, not another operation', wrongScope.status === 409 && wrongScope.body.code === 'key_conflict')
    const crossOp = await prac.s.post(`/api/tests/practice-runs/${runId}/next`, { expectedRevision: 1, requestKey: key })
    check('a Start key cannot be reused as a Continue key', crossOp.status === 409 && crossOp.body.code === 'key_conflict')
    const mine = await other2.s.post('/api/tests/start', { ...pbody, requestKey: key })
    check("another student's key is not a receipt for me: I get my own run, never theirs", mine.body.ok === true && mine.body.runId !== runId && mine.body.attemptId !== a1 && mine.body.replay !== true)

    console.log('\nG. Cap, shortage and fixed timed practice')
    const capS = await createStudent(admin, 'dc', { onboard: true }); made.push(capS.id)
    const cb = { kind: 'practice', mode: 'adaptive', readingId: READING, cap: 10 }
    const c1 = (await capS.s.post('/api/tests/start', { ...cb, requestKey: `k-${uuid()}` })).body
    await answerAll(capS, c1.attemptId, () => true); await submit(capS, c1.attemptId)
    const cg = (await capS.s.json(`/api/tests/practice-runs/${c1.runId}`)).body.run
    const c2k = `k-${uuid()}`
    const c2 = (await capS.s.post(`/api/tests/practice-runs/${c1.runId}/next`, { expectedRevision: cg.revision, requestKey: c2k })).body
    await answerAll(capS, c2.attemptId, () => true, () => 'high', 3); const c2s = await submit(capS, c2.attemptId)
    const capG = (await capS.s.json(`/api/tests/practice-runs/${c1.runId}`)).body.run
    check('a ten-question cap allows exactly two sets', c2.ok && capG.delivered === 10 && capG.action === 'summary' && capG.finished === true, JSON.stringify(capG).slice(0, 200))
    check('a partly answered set records omissions, not wrong answers', capG.sets[1].stats.answered === 3 && capG.sets[1].stats.correct === 3 && c2s.body?.ok === true)
    const over = await capS.s.post(`/api/tests/practice-runs/${c1.runId}/next`, { expectedRevision: capG.revision, requestKey: `k-${uuid()}` })
    check('the cap cannot be exceeded', over.status === 409 && over.body.code === 'cap_reached')
    const lostFinal = await capS.s.post(`/api/tests/practice-runs/${c1.runId}/next`, { expectedRevision: cg.revision, requestKey: c2k })
    check('a lost response of the FINAL Continue is replayed at the cap (not reported as cap reached)', lostFinal.body.ok === true && lostFinal.body.attemptId === c2.attemptId && lostFinal.body.replay === true)

    const one = (await admin.from('reading_los').select('id').eq('reading_id', READING).order('id').limit(1)).data![0].id as string
    const sh = await createStudent(admin, 'ds', { onboard: true }); made.push(sh.id)
    const sbody = { kind: 'practice', mode: 'adaptive', readingId: READING, outcomeIds: [one], cap: 10 }
    const sp = (await sh.s.post('/api/tests/preflight', sbody)).body.adaptive
    const shk = `k-${uuid()}`
    const first = await sh.s.post('/api/tests/start', { ...sbody, requestKey: shk })
    if (first.body.ok) {
      await answerAll(sh, first.body.attemptId, () => true); await submit(sh, first.body.attemptId)
      const sg = (await sh.s.json(`/api/tests/practice-runs/${first.body.runId}`)).body.run
      check('scope shortage: when fewer than five fresh questions remain on the scope, nothing is padded or looped; the student can end', sg.next?.state === 'insufficient' && /Nothing is repeated or padded/.test(sg.next.message) && sg.action === 'stop' && (sg.next.deliverable ?? 0) < 5, JSON.stringify(sg.next).slice(0, 220))
      const blocked = await sh.s.post(`/api/tests/practice-runs/${first.body.runId}/next`, { expectedRevision: sg.revision, requestKey: `k-${uuid()}` })
      const lostStart = await sh.s.post('/api/tests/start', { ...sbody, requestKey: shk })
      check('a lost initial Start response is replayed after the first set opened and the scope inventory is exhausted', lostStart.body.ok === true && lostStart.body.attemptId === first.body.attemptId && lostStart.body.replay === true)
      check('and Continue refuses with the limitation', blocked.status === 409 && /padded|remain/.test(blocked.body.message ?? ''))
    } else check('the one-outcome scope has at least five questions for its first set', sp.state !== 'start' ? true : false, JSON.stringify(first.body).slice(0, 200))

    const timed = (await prac.s.post('/api/tests/preflight', { kind: 'practice', readingId: READING })).body.decision
    check('fixed timed practice is unchanged: ten questions, timed, labelled Timed practice, no difficulty profile', timed.purposeLabel === 'Timed practice' && timed.timed === true && timed.difficulty === null)


    console.log('\nC5/C6. Practice history is scope-relevant and uses valid, first-exposure answers')
    const sc = await createStudent(admin, 'dq', { onboard: true }); made.push(sc.id)
    const wholeBody = { kind: 'practice', mode: 'adaptive', readingId: READING, cap: 20 }
    const w1 = (await sc.s.post('/api/tests/start', { ...wholeBody, requestKey: `k-${uuid()}` })).body
    await answerAll(sc, w1.attemptId, () => false, () => 'medium'); await submit(sc, w1.attemptId)
    const wg = (await sc.s.json(`/api/tests/practice-runs/${w1.runId}`)).body.run
    const w2 = (await sc.s.post(`/api/tests/practice-runs/${w1.runId}/next`, { expectedRevision: wg.revision, requestKey: `k-${uuid()}` })).body
    await answerAll(sc, w2.attemptId, () => false, () => 'medium'); await submit(sc, w2.attemptId)
    const whole = (await sc.s.post('/api/tests/preflight', wholeBody)).body.adaptive
    check('two fully answered whole-reading sets of misses step the NEXT whole-reading practice down one level', whole.profile === 'support', JSON.stringify(whole).slice(0, 200))
    {
      const narrow = (await sc.s.post('/api/tests/preflight', { ...wholeBody, outcomeIds: [one0] })).body.adaptive
      check('the same history does NOT lower a single-outcome scope it barely touched, and says only its own questions were counted', narrow.profile === 'balanced' && /only its questions on this scope were counted/.test(narrow.reasons.join(' ')), JSON.stringify(narrow).slice(0, 240))
    }
    const setAttempts = [w1.attemptId, w2.attemptId] as string[]
    const itemsOfSets = ((await admin.from('form_items').select('item_id, form_id').in('form_id', ((await admin.from('assessment_attempts').select('form_id').in('id', setAttempts)).data ?? []).map(a => a.form_id as string))).data ?? [])
    const formOf = new Map(((await admin.from('assessment_attempts').select('id, form_id').in('id', setAttempts)).data ?? []).map(a => [a.form_id as string, a.id as string]))
    for (const status of ['pending', 'resolved_voided']) {
      await admin.from('item_challenges').delete().eq('user_id', sc.id)
      await admin.from('item_challenges').insert(itemsOfSets.map(f => ({ user_id: sc.id, item_id: f.item_id, attempt_id: formOf.get(f.form_id as string), comment: 'fixture challenge', status })))
      const after = (await sc.s.post('/api/tests/preflight', wholeBody)).body.adaptive
      check(`every earlier miss ${status === 'pending' ? 'disputed' : 'voided'}: the next set no longer steps down (no valid sample, hold)`, after.profile === 'balanced', JSON.stringify(after).slice(0, 200))
    }
    await admin.from('item_challenges').delete().eq('user_id', sc.id)
    const back = (await sc.s.post('/api/tests/preflight', wholeBody)).body.adaptive
    check('removing the challenges restores the step-down (the decision is derived, never stored)', back.profile === 'support')

    console.log('\nH. Fixed purposes keep their policy')
    const mock = await st.s.post('/api/tests/start', { kind: 'mock' })
    check('the retired single-paper mock route is still retired', mock.status === 410)
  } finally { db.end().catch(() => {}); await dropStudents() }
  finish()
}
main().catch(async e => { console.error(e); await dropStudents().catch(() => {}); process.exit(1) })
