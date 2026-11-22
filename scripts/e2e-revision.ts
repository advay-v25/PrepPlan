/**
 * Phase D, live: the maintenance-revision loop across several weeks, with ORDINARY throwaway students (no role, deleted after).
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-revision.ts
 *
 * Each cycle is proposed by the real preview endpoint, accepted by the real accept endpoint, its revision is completed through the
 * task and scope-confirmation endpoints, and the cycle is closed through the supported external-mock path. A student's OWN cycle
 * window is moved to today so it can be closed; no other student's record is touched. Time cannot pass in a test, so completions
 * are dated "now" and one step ages a student's own confirmed activity to show the second round of the rotation.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { completeOnboarding, createSession } from './lib/e2eSession'
import { getActiveRoadmap } from '../src/lib/curriculum/roadmapService'
import { loadRevisionFacts } from '../src/lib/curriculum/revisionQueueService'
import { addDays } from '../src/lib/planning/studyWeek'
import { MAX_REVISION_TASKS } from '../src/lib/curriculum/revisionQueue'

const TZ = 'Europe/London'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const made: string[] = []
let passed = 0, failed = 0; const skipped: string[] = []
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const skip = (n: string, why: string) => { skipped.push(`${n} (${why})`); console.log(`  – SKIPPED ${n}: ${why}`) }
type S = ReturnType<typeof createSession>
const uuid = () => crypto.randomUUID()
const H = { 'Content-Type': 'application/json' }

async function student(tag: string, o: { exposure?: (topics: string[]) => Record<string, string>; stage?: string; extra?: Record<string, unknown> } = {}) {
  const email = `integ+${tag}${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  made.push(data.user!.id)
  await admin.from('profiles').upsert({ id: data.user!.id, onboarding_status: 'not_started' })
  const s = createSession(admin, email)
  if (!(await s.signIn())) throw new Error('sign-in failed')
  const topics = ((await admin.from('topics').select('id').order('default_sequence')).data ?? []).map(t => t.id as string)
  await completeOnboarding(s, admin, { stage: o.stage ?? 'revising_or_mocks', topicExposure: o.exposure ? o.exposure(topics) : Object.fromEntries(topics.map(t => [t, 'recent'])), positionExtra: o.extra })
  return { id: data.user!.id, s, topics }
}
const cycleOf = async (uid: string) => (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', uid).eq('status', 'active').single()).data!
const reviews = async (uid: string, cycleId?: string) => {
  let q = admin.from('plan_blocks').select('id, lm_id, title, execution, revision, local_date, rationale, task_type, continued_from_task_id, cancelled_at, outcome_id, learning_objective, suggested_approach, completion_meaning, assessment_scope, duration_minutes')
    .eq('user_id', uid).eq('task_type', 'review').is('cancelled_at', null).is('learning_activity_id', null)
  if (cycleId) q = q.eq('cycle_id', cycleId)
  return (await q.order('local_date').order('id')).data ?? []
}
const lmsOf = (rows: { lm_id: string | null }[]) => [...new Set(rows.map(r => r.lm_id as string))]
const counts = async (uid: string) => JSON.stringify(await Promise.all(['evidence_events', 'assessment_attempts', 'assessment_responses', 'repair_threads', 'coach_proposals'].map(async t =>
  (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count)))
const taskPatch = (s: S, id: string, body: Record<string, unknown>) => s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ action: 'execution', ...body }) })
const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)

/** Completes every sitting of a reading and explicitly confirms `n` of its outcomes (all when omitted). Returns the outcome ids confirmed. */
async function complete(u: { id: string; s: S }, lm: string, cycleId: string, n?: number, execution: 'completed' | 'partial' = 'completed') {
  const rows = (await reviews(u.id, cycleId)).filter(r => r.lm_id === lm)
  for (const r of rows) {
    const res = await taskPatch(u.s, r.id, { execution, actualDurationMinutes: 30, expectedRevision: await rev(r.id) })
    if (res.body?.ok !== true) throw new Error(`complete ${r.id}: ${JSON.stringify(res.body).slice(0, 160)}`)
  }
  const info = await u.s.json(`/api/tests/scope/confirm?blockId=${rows[0].id}`)
  const ids = ((info.body?.outcomes ?? []) as { id: string }[]).map(o => o.id).slice(0, n ?? 999)
  const conf = await u.s.post('/api/tests/scope/confirm', { blockId: rows[0].id, outcomeIds: ids, expectedRevision: await rev(rows[0].id) })
  if (conf.body?.ok !== true) throw new Error(`confirm ${lm}: ${JSON.stringify(conf.body).slice(0, 160)}`)
  return ids
}

/**
 * Closes the student's open cycle through the supported external-mock path (a self-reported mock chosen as the week's assessment),
 * so the bank's ability to assemble a paper does not decide whether the test can proceed. Moves the student's own cycle to end today.
 */
async function closeCycle(u: { id: string; s: S }, choices: Record<string, unknown> = {}, o: { dueAsRemove?: boolean; continueLms?: string[] } = {}) {
  const cyc = await cycleOf(u.id)
  await admin.from('plan_blocks').update({ local_date: today, day: today }).eq('cycle_id', cyc.id).gt('local_date', today)
  await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: today }).eq('id', cyc.id)
  await admin.from('plan_blocks').delete().eq('cycle_id', cyc.id).eq('task_type', 'diagnostic').eq('execution', 'not_started')
  const cp = await u.s.json('/api/checkpoints')
  if (!cp.body?.checkpoint) {
    const put = await u.s.json('/api/checkpoints', { method: 'PUT', headers: H, body: JSON.stringify({ key: uuid(), checkpointId: null, expectedVersion: null, date: today, kind: 'provider_mock' }) })
    if (put.body?.ok !== true) throw new Error(`mock: ${JSON.stringify(put.body).slice(0, 160)}`)
  }
  const v = (await u.s.json('/api/checkpoints')).body.checkpoint
  const taken = await u.s.json('/api/checkpoints', { method: 'POST', headers: H, body: JSON.stringify({ key: uuid(), checkpointId: v.checkpointId, expectedVersion: v.version, action: 'outcome', outcome: 'taken', actualDate: today, choice: 'use_mock', paperAction: 'replace' }) })
  if (taken.body?.ok !== true) throw new Error(`outcome: ${JSON.stringify(taken.body).slice(0, 200)}`)
  const state = (await u.s.json('/api/weekly-review/state')).body?.state
  const answers: Record<string, unknown> = { ...choices }
  for (const t of (state?.dueTasks ?? []) as { id: string; execution: string; lmId: string | null }[]) if (!answers[t.id]) {
    // Tell the truth about each task: partly done work stays partly done; only untouched work is "not done".
    const happened = t.execution === 'partial' ? 'partial' : 'not_done'
    const keep = !o.dueAsRemove && (t.execution === 'partial' || (t.lmId != null && (o.continueLms ?? []).includes(t.lmId)))
    answers[t.id] = { happened, next: keep ? 'continue' : 'remove' }
  }
  const prev = await u.s.post('/api/weekly-review/preview', { cycleId: cyc.id, choices: answers })
  return { cyc, state, prev, answers }
}
const accept = (u: { s: S }, draftId: string) => u.s.post('/api/weekly-review/accept', { draftId })

async function main() {
  console.log(`\nPhase D — local date ${today} in ${TZ}`)

  console.log('\n1. Midway through the first pass: maintenance returns alongside unfinished syllabus work')
  const mid = await student('rvMid', { stage: 'first_pass_underway', exposure: t => Object.fromEntries(t.slice(0, 4).map(x => [x, 'recent'])) })
  const midCycle = await cycleOf(mid.id)
  const midAll = await admin.from('plan_blocks').select('task_type, lm_id, rationale').eq('user_id', mid.id).eq('cycle_id', midCycle.id).is('cancelled_at', null)
  const midTypes = new Set((midAll.data ?? []).map(b => b.task_type))
  const midRev = (midAll.data ?? []).filter(b => b.task_type === 'review')
  check('the first week has both new study and revision of covered material', midTypes.has('study') && midRev.length > 0, [...midTypes].join(','))
  check('with nothing reported uncertain, the revision is maintenance and says why', midRev.length > 0 && midRev.every(b => /No revision date is recorded|unknown, not forgotten/.test(String(b.rationale))), String(midRev[0]?.rationale).slice(0, 200))
  check('the revision stays within the first-pass cap (3 readings)', lmsOf(midRev as any).length <= 3)

  console.log('\n2. First pass complete: a real revision week, not an empty one or repeated first readings')
  const done = await student('rvDone')
  const c1 = await cycleOf(done.id)
  const w1 = await reviews(done.id, c1.id)
  const readings1 = lmsOf(w1)
  const types1 = new Set((await admin.from('plan_blocks').select('task_type').eq('user_id', done.id).eq('cycle_id', c1.id).is('cancelled_at', null)).data?.map(b => b.task_type))
  check('the week has real revision work and no first-pass study', readings1.length >= 3 && !types1.has('study'), `${readings1.length} readings; types ${[...types1]}`)
  const first = w1[0]
  check('each revision task explains what, why, how and what completion means', !!first.title && /Revise:/.test(first.title) && !!first.rationale && !!first.suggested_approach && !!first.completion_meaning && /activity, not demonstrated understanding/.test(first.completion_meaning))
  check('revision carries no assessment scope and is not a repair', w1.every(r => !r.assessment_scope))
  const evidence0 = await counts(done.id)

  console.log('\n3. Multi-cycle rotation, completion, partial work, missed work and continuation')
  // Cycle 1: complete A and B fully, C partially (2 outcomes), leave D unstarted and continue it, let the rest lapse.
  // C must have at least three outcomes so "partly done" can confirm a strict subset; the rest are whichever come first.
  const outcomeCount = new Map<string, number>()
  for (const o of (await admin.from('reading_los').select('reading_id').in('reading_id', readings1)).data ?? []) outcomeCount.set(o.reading_id as string, (outcomeCount.get(o.reading_id as string) ?? 0) + 1)
  const C = readings1.find(id => (outcomeCount.get(id) ?? 0) >= 3)!
  // D is a reading that was split into two sittings if one exists: continuing both must count as ONE reading-level obligation.
  const sittingsOf = (id: string) => w1.filter(r => r.lm_id === id).length
  const others = readings1.filter(id => id !== C)
  const D = others.find(id => sittingsOf(id) >= 2) ?? others[2]
  const [A, B] = others.filter(id => id !== D)
  const idsA = await complete(done, A, c1.id)
  await complete(done, B, c1.id)
  const idsC = await complete(done, C, c1.id, 2, 'partial')
  check('partial work confirmed only the outcomes the student chose', idsC.length === 2)
  const closing = await closeCycle(done, {}, { continueLms: [D] })
  check('the review preview shows the next rotation', closing.prev.body?.ok === true && !!closing.prev.body.next?.revision, JSON.stringify(closing.prev.body).slice(0, 220))
  const rv = closing.prev.body.next.revision
  const placed2 = (rv.placed as { readingId: string }[]).map(p => p.readingId)
  check('the preview lists why each reading was chosen, with how recency is known', rv.placed.length > 0 && rv.placed.every((p: any) => p.why.length > 0 && ['recorded', 'reported', 'unknown'].includes(p.recency.source)), JSON.stringify({ placed: rv.placed.length, waiting: rv.waiting.length, elsewhere: rv.elsewhere.length, limit: rv.limit, phase: rv.phase }))
  check('readings completed in cycle 1 are not offered again straight away', !placed2.includes(A) && !placed2.includes(B))
  check('the partly confirmed reading is not treated as fully refreshed: it is still eligible and says only part was confirmed', (() => {
    const all = [...rv.placed, ...rv.waiting, ...rv.elsewhere] as { readingId: string; why: string[] }[]
    const c = all.find(x => x.readingId === C)
    return !c || c.why.some(w => /covers 2 of \d+ outcomes/.test(w)) || rv.elsewhere.some((e: any) => e.readingId === C)
  })())
  const continuedD = (closing.prev.body.continuing as { taskId: string }[]).length
  check('unfinished revision continues (one continuation per unfinished task) and none is duplicated in the proposal', continuedD > 0)
  const contLms = new Set((closing.prev.body.continuing as { taskId: string }[]).map(c => w1.find(r => r.id === c.taskId)?.lm_id))
  const contTasks = (closing.prev.body.continuing as { taskId: string }[]).length
  if (sittingsOf(D) < 2) skip('split reading consumes one allowance', 'no reading in this week was split into two sittings')
  else check('a reading continuing in two sittings is two tasks but ONE reading-level obligation: the week\'s allowance shrinks by one', contTasks > contLms.size && rv.limit === MAX_REVISION_TASKS[rv.phase as 'consolidation'] - contLms.size, `tasks ${contTasks}, readings ${contLms.size}, limit ${rv.limit}, sittings ${sittingsOf(D)}`)
  check('two sittings of one reading never become two different readings', [...contLms].every(id => w1.filter(r => r.lm_id === id).length >= 1) && contLms.size < contTasks + 1)
  check('a continuing reading is not also generated as a fresh task', !placed2.some(id => contLms.has(id)))
  check('the weekly-review state itself previews the rotation too', !!closing.state?.next?.revision)
  const acc = await accept(done, closing.prev.body.draftId)
  check('accepting creates the next cycle', acc.body?.ok === true, JSON.stringify(acc.body).slice(0, 160))
  const c2 = await cycleOf(done.id)
  const w2 = await reviews(done.id, c2.id)
  const live2 = w2.filter(r => !r.continued_from_task_id)
  const fresh2 = lmsOf(live2)
  const cont2 = w2.filter(r => r.continued_from_task_id)
  check('the new cycle carries the continuations and fresh revision of other readings', cont2.length > 0 && fresh2.length > 0, `continuations ${cont2.length}, fresh ${fresh2.length}, w1 ${readings1.length}`)
  const perLm = new Map<string, number>()
  for (const r of w2) perLm.set(r.lm_id as string, (perLm.get(r.lm_id as string) ?? 0) + 1)
  const dupFresh = [...contLms].filter(id => id && fresh2.includes(id as string))
  check('continuation plus fresh generation yields ONE obligation per reading', dupFresh.length === 0, dupFresh.join(','))
  check('the fresh readings are different from cycle 1\'s completed ones', fresh2.every(id => ![A, B].includes(id)))
  const retry = await accept(done, closing.prev.body.draftId)
  check('retrying acceptance returns the original outcome and adds nothing', retry.body?.ok === true && retry.body.alreadyClosed === true && (await reviews(done.id, c2.id)).length === w2.length)

  console.log('\n4. Recorded activity: completed refreshes, partial refreshes only what was confirmed, missed refreshes nothing')
  const road = (await getActiveRoadmap(done.id))!
  const factsNow = await loadRevisionFacts(done.id, road.input.modules, { weekStart: c2.starts_at_local, weekEnd: c2.ends_at_local })
  const rd = (id: string) => factsNow.readings.find(r => r.id === id)!
  const dated = (id: string) => rd(id).outcomeActivity.filter(Boolean).length
  check('a completed reading with confirmed scope has recorded activity for every outcome', dated(A) === rd(A).outcomeActivity.length && dated(A) > 0)
  check('a partly confirmed reading has recorded activity for exactly the confirmed outcomes', dated(C) === 2 && rd(C).outcomeActivity.length > 2)
  const missedLm = lmsOf(w1).find(id => ![A, B, C].includes(id))!
  check('a scheduled but missed reading has no recorded activity (scheduling alone refreshes nothing)', dated(missedLm) === 0)
  check('a reading studied only in the student\'s own words (never confirmed) has unknown recency', factsNow.readings.filter(r => dated(r.id) === 0).length > 90)
  check('nothing about revision created evidence, attempts, responses, repairs or Coach proposals', evidence0 === await counts(done.id))

  console.log('\n5. The next cycles rotate; the second round returns to old readings after the interval')
  const seen = new Set<string>([...readings1])
  const cycleSets: string[][] = [readings1, fresh2]
  let prevCycle = c2
  for (let n = 3; n <= 4; n++) {
    const wk = await reviews(done.id, prevCycle.id)
    for (const lm of lmsOf(wk.filter(r => !r.continued_from_task_id)).slice(0, 6)) await complete(done, lm, prevCycle.id)
    const cl = await closeCycle(done, {}, { dueAsRemove: true })
    if (cl.prev.body?.ok !== true) { check(`cycle ${n} closes`, false, JSON.stringify(cl.prev.body).slice(0, 200)); break }
    const ac = await accept(done, cl.prev.body.draftId)
    if (ac.body?.ok !== true) { check(`cycle ${n} opens`, false, JSON.stringify(ac.body).slice(0, 200)); break }
    prevCycle = await cycleOf(done.id)
    cycleSets.push(lmsOf((await reviews(done.id, prevCycle.id)).filter(r => !r.continued_from_task_id)))
  }
  const latest = cycleSets[cycleSets.length - 1]
  check('later cycles select readings not yet revised while any remain', latest.length > 0 && latest.filter(id => seen.has(id)).length <= Math.floor(latest.length / 2), `${latest.length} chosen, ${latest.filter(id => seen.has(id)).length} repeated`)
  const consecutiveRepeats = cycleSets.slice(1).flatMap((set, i) => set.filter(id => cycleSets[i].includes(id)).map(id => `cycle ${i + 2}: ${id}`))
  check('no cycle repeats the previous cycle\'s fresh readings', consecutiveRepeats.length === 0, consecutiveRepeats.join(', '))
  const subjects = (ids: string[]) => new Set(ids.map(id => road.input.modules.find(m => m.id === id)?.topic))
  check('every cycle draws from more than one subject', cycleSets.every(s => s.length === 0 || subjects(s).size >= 2))
  // Age the student's own confirmed activity by 40 days (their own records) to show that revisited material returns.
  const confirmedBlocks = (await admin.from('task_events').select('id, created_at').eq('user_id', done.id).in('event_type', ['completed', 'partial'])).data ?? []
  for (const e of confirmedBlocks) await admin.from('task_events').update({ created_at: new Date(new Date(e.created_at as string).getTime() - 40 * 86_400_000).toISOString() }).eq('id', e.id)
  const road2 = (await getActiveRoadmap(done.id))!
  const cyc5 = await cycleOf(done.id)
  const aged = await loadRevisionFacts(done.id, road2.input.modules, { weekStart: cyc5.starts_at_local, weekEnd: cyc5.ends_at_local })
  const { selectRevision } = await import('../src/lib/curriculum/revisionQueue')
  const round2 = selectRevision({ readings: aged.readings, phase: 'consolidation', now: new Date(), weekStart: cyc5.starts_at_local, limit: 8, topicWeight: aged.topicWeight })
  check('once their confirmed activity is 40 days old, revised readings are due and chosen again, ahead of never-confirmed ones', round2.selected.filter(e => e.recency.source === 'recorded').length >= 4, round2.selected.map(e => `${e.readingId}:${e.recency.source}`).join(' '))
  check('and their recency is recorded, with a day count', round2.selected.some(e => e.recency.source === 'recorded' && (e.recency.days ?? 0) >= 39))

  console.log('\n6. Repairs keep their identity; revision does not add a second block')
  const rep = await student('rvRep')
  const crep = await cycleOf(rep.id)
  const w = await reviews(rep.id, crep.id)
  const road3 = (await getActiveRoadmap(rep.id))!
  const candidateIds = [...new Set([...lmsOf(w), ...road3.input.modules.filter(m => m.coverage !== 'not_started').map(m => m.id)])]
  const manifest = (await admin.from('curriculum_manifests').select('id').eq('is_active', true).single()).data!.id
  const mapped = (await admin.from('concept_outcome_map').select('concept_id, outcome_id').limit(2000)).data ?? []
  const losByReading = new Map<string, string[]>()
  for (const o of (await admin.from('reading_los').select('id, reading_id').in('reading_id', candidateIds).throwOnError()).data ?? []) losByReading.set(o.reading_id as string, [...(losByReading.get(o.reading_id as string) ?? []), o.id as string])
  const target = candidateIds.find(lm => (losByReading.get(lm)?.length ?? 0) > 1 && mapped.some(m => losByReading.get(lm)!.includes(m.outcome_id as string)))
  const cmap = target ? mapped.find(m => losByReading.get(target)!.includes(m.outcome_id as string)) : null
  if (!target || !cmap) throw new Error('The repair regression needs a covered, mapped reading with more than one outcome.')
  else {
    await admin.from('plan_blocks').delete().eq('user_id', rep.id).eq('task_type', 'review')
    const t = await admin.from('repair_threads').insert({ user_id: rep.id, concept_id: cmap.concept_id, manifest_id: manifest, status: 'open', latest_evidence_at: new Date().toISOString() }).select('id').single()
    check('an open repair thread exists for this reading', !!t.data?.id, JSON.stringify(t.error))
    const facts = await loadRevisionFacts(rep.id, road3.input.modules, { weekStart: crep.starts_at_local, weekEnd: crep.ends_at_local })
    const { selectRevision: sel } = await import('../src/lib/curriculum/revisionQueue')
    const s = sel({ readings: facts.readings, phase: 'consolidation', now: new Date(), weekStart: crep.starts_at_local, limit: 102, topicWeight: facts.topicWeight })
    const re = facts.readings.find(r => r.id === target)!
    const bandsOf = (re.outcomeEvidence ?? []).map(e => e?.band ?? 'untested')
    check('evidence is carried per outcome: the repair sits on the outcome it concerns and the rest stay untested', bandsOf.includes('repair') && bandsOf.filter(b => b === 'repair').length === re.evidence.repair && bandsOf.filter(b => b === 'untested').length === re.evidence.untested && re.evidence.untested > 0, JSON.stringify(bandsOf))
    check('the repaired reading is flagged as covered by its repair and not selected for revision', !s.selected.some(e => e.readingId === target) && s.elsewhere.some(e => e.readingId === target && e.state === 'repair'))
  }

  console.log('\n7. A changed activity or context makes a prepared review stale')
  const st = await student('rvStale')
  const cs = await cycleOf(st.id)
  const ws = await reviews(st.id, cs.id)
  const pre = await closeCycle(st, {}, { dueAsRemove: true })
  check('a review is prepared', pre.prev.body?.ok === true, JSON.stringify(pre.prev.body).slice(0, 160))
  if (pre.prev.body?.ok) {
    // New activity after the preview: confirm a revision task's scope in the closing cycle.
    const lm = lmsOf(ws)[0]
    const r0 = ws.find(r => r.lm_id === lm)!
    await taskPatch(st.s, r0.id, { execution: 'completed', actualDurationMinutes: 20, expectedRevision: await rev(r0.id) })
    const stale = await accept(st, pre.prev.body.draftId)
    check('accepting after the activity changed is refused as stale, nothing closed', stale.status === 409 && stale.body?.code === 'stale' && (await cycleOf(st.id)).id === cs.id, JSON.stringify(stale.body).slice(0, 160))
    const again = await closeCycle(st, {}, { dueAsRemove: true })
    check('preparing it again works and keeps the student\'s answers flow', again.prev.body?.ok === true)
    const [x, y] = await Promise.all([accept(st, again.prev.body.draftId), accept(st, again.prev.body.draftId)])
    const next = await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active')
    const nextReviews = await reviews(st.id, next.data![0].id)
    const per = new Map<string, number>(); for (const r of nextReviews.filter(r => !r.continued_from_task_id)) per.set(r.lm_id as string, (per.get(r.lm_id as string) ?? 0) + 1)
    check('two simultaneous acceptances open exactly one cycle', next.data?.length === 1 && x.body?.ok === true && y.body?.ok === true && x.body.nextCycleId === y.body.nextCycleId)
    check('and create each revision reading once (sittings of one reading aside)', [...per.values()].every(n => n <= 3) && nextReviews.length > 0)
  }

  console.log('\n8. Short capacity: work waits visibly, nothing is silently lost')
  const tight = await student('rvTight')
  await admin.from('availability_windows').delete().eq('user_id', tight.id)
  await admin.from('availability_windows').insert([1, 2].map(weekday => ({ user_id: tight.id, weekday, start_time: '18:00', end_time: '18:50', source: 'onboarding', status: 'active' })))
  await admin.from('plan_blocks').delete().eq('user_id', tight.id)
  const ct = await closeCycle(tight, {}, { dueAsRemove: true })
  const rvt = ct.prev.body?.next?.revision
  check('the proposal places only what fits', ct.prev.body?.ok === true && !!rvt && rvt.placed.length < 8)
  check('the readings that did not fit are listed as waiting, each with a reason', !!rvt && rvt.waiting.length > 0 && rvt.waiting.every((x: any) => (x.note ?? '').length > 10))
  check('trade-offs are offered, and none says the student failed or is blocked', !!rvt && rvt.tradeoffs.length > 0 && !rvt.tradeoffs.join(' ').match(/fail|blocked|not allowed|behind|too late/i), rvt?.tradeoffs?.join(' | '))

  console.log('\n9. The assessment gate cannot be bypassed by revision')
  const gate = await student('rvGate')
  const cg = await cycleOf(gate.id)
  const manifestId = (await admin.from('curriculum_manifests').select('id').eq('is_active', true).single()).data!.id
  const bp = await admin.from('assessment_blueprints').insert({ manifest_id: manifestId, purpose: 'weekly_cumulative', requested_scope: { fixture: true }, constraints: { fixture: true } }).select('id').single()
  const form = await admin.from('assessment_forms').insert({ blueprint_id: bp.data!.id, delivery_mode: 'fixed' }).select('id').single()
  const item = (await admin.from('assessment_items').select('id').eq('review_status', 'reviewed').limit(1).single()).data
  if (!item) skip('open weekly attempt fixture', 'no reviewed item exists to build the fixture form')
  else {
    await admin.from('form_items').insert({ form_id: form.data!.id, item_id: item.id, sequence_number: 1 })
    for (const status of ['ready', 'in_progress']) {
      await admin.from('assessment_attempts').delete().eq('user_id', gate.id)
      const ins = await admin.from('assessment_attempts').insert({ user_id: gate.id, form_id: form.data!.id, delivery_mode: 'fixed', status, attempt_kind: 'weekly', cycle_id: cg.id }).select('id').single()
      if (ins.error) { skip(`${status} weekly attempt`, ins.error.message); continue }
      await admin.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: today }).eq('id', cg.id)
      const st2 = (await gate.s.json('/api/weekly-review/state')).body?.state
      const dueAll: Record<string, unknown> = {}
      for (const t of (st2?.dueTasks ?? []) as { id: string }[]) dueAll[t.id] = { happened: 'not_done', next: 'remove' }
      const p = await gate.s.post('/api/weekly-review/preview', { cycleId: cg.id, choices: dueAll, acknowledgeNoPaper: true })
      check(`with a ${status} weekly attempt the gate stays shut, even when acknowledging no paper`, st2?.gate?.kind === 'paper_pending' && p.status === 409 && p.body?.code === 'gate_closed', `${st2?.gate?.kind} ${p.status} ${JSON.stringify(p.body).slice(0, 100)}`)
    }
    await admin.from('assessment_attempts').delete().eq('user_id', gate.id)
  }

  console.log('\n10. Tests scope: scheduled revision adds nothing; confirmed revision is revisionary; missed is excluded')
  const sc = await student('rvScope')
  const csc = await cycleOf(sc.id)
  const rsc = await reviews(sc.id, csc.id)
  const scope0 = (await sc.s.json('/api/tests/scope')).body?.preview?.scope?.totals
  check('scheduled revision contributes no completed scope', scope0?.outcomes === 0, JSON.stringify(scope0))
  const lmDo = lmsOf(rsc)[0], lmMiss = lmsOf(rsc)[1]
  const confirmed = await complete(sc, lmDo, csc.id, 2)
  const missedTask = rsc.find(r => r.lm_id === lmMiss)!.id
  const skippedTask = await sc.s.json(`/api/tasks/${missedTask}`, { method: 'PATCH', headers: H, body: JSON.stringify({ action: 'execution', execution: 'skipped', expectedRevision: await rev(missedTask) }) })
  if (skippedTask.body?.ok !== true) throw new Error(`Fixture skip did not save: HTTP ${skippedTask.status}`)
  const pv = (await sc.s.json('/api/tests/scope')).body?.preview
  const tested = (pv?.scope?.targets ?? []).map((target: { outcomeId: string }) => target.outcomeId).sort()
  const excluded = (pv?.scope?.excluded ?? []).some((block: { blockId: string; reason: string }) => block.blockId === missedTask && block.reason === 'missed')
  check('confirmed revision is revisionary scope and the missed reading is excluded', confirmed.length > 0 && tested.join() === [...confirmed].sort().join() && pv?.scope?.totals?.revisionOutcomes === confirmed.length && pv?.scope?.totals?.newOutcomes === 0 && pv?.paperKind === 'revisionary' && excluded, JSON.stringify(pv?.scope?.totals) + ' ' + pv?.paperKind)
  check('historical coverage did not become this week\'s completed learning', pv?.scope?.totals?.newOutcomes === 0)

  console.log('\n10b. Activity dates: study date versus the moment of recording')
  const dt = await student('rvDate')
  const cd = await cycleOf(dt.id)
  const roadD = (await getActiveRoadmap(dt.id))!
  const picks = lmsOf(await reviews(dt.id, cd.id))
  const readingA = picks[0], readingB = picks[1]
  const outcomesOf = async (lm: string) => ((await admin.from('reading_los').select('id').eq('reading_id', lm).order('id')).data ?? []).map(o => o.id as string)
  const oa = await outcomesOf(readingA)
  const sevenAgo = addDays(today, -7)
  const logged = await dt.s.json('/api/log-learning', { method: 'POST', headers: H, body: JSON.stringify({ activity_type: 'independent_study', reading_id: readingA, outcome_ids: oa, date: sevenAgo, idempotency_key: `d-${Date.now()}-a` }) })
  check('a sitting studied seven days ago is logged today with its own study date', logged.body?.ok === true, JSON.stringify(logged.body).slice(0, 160))
  const factsD = async () => { const r = (await getActiveRoadmap(dt.id))!; return loadRevisionFacts(dt.id, r.input.modules, { weekStart: cd.starts_at_local, weekEnd: cd.ends_at_local }) }
  const { candidateFor: cf } = await import('../src/lib/curriculum/revisionQueue')
  const opt = { phase: 'consolidation' as const, now: new Date(), weekStart: cd.starts_at_local }
  let fd = await factsD()
  const ra = fd.readings.find(r => r.id === readingA)!
  const ca = cf(ra, opt, null)
  check('its recency is seven days old, from the study date, not "today"', ca.recency.source === 'recorded' && ca.recency.days === 7 && ca.recency.provenance === 'study_date', JSON.stringify(ca.recency))
  check('the explanation says the date is the one the student logged', ca.reasons.some(r => /7 days ago \(the study date you logged\)/.test(r)), ca.reasons.join(' | '))
  check('every outcome the log confirmed has that date; none was refreshed by the save itself', ra.outcomeActivity.length === oa.length && ra.outcomeActivity.every(a => a && Math.abs(Date.parse(a) - Date.parse(`${sevenAgo}T00:00:00Z`)) < 2 * 86_400_000))
  // Completing a planned revision task today, with scope confirmed, is dated by when it was recorded.
  const rowsB = (await reviews(dt.id, cd.id)).filter(r => r.lm_id === readingB)
  if (rowsB.length === 0) skip('completed-today provenance', 'no planned revision for the second reading')
  else {
    await complete(dt, readingB, cd.id)
    fd = await factsD()
    const cb = cf(fd.readings.find(r => r.id === readingB)!, opt, null)
    check('completed today with no separate study date: dated today, described as when it was marked done', cb.recency.days === 0 && cb.recency.provenance === 'recorded' && cb.reasons.some(r => /today \(when you marked it done\)/.test(r)), JSON.stringify(cb.recency))
  }
  // A skipped or removed task and a task that was only scheduled change nothing.
  const readingC = picks[2]
  const rowsC = (await reviews(dt.id, cd.id)).filter(r => r.lm_id === readingC)
  for (const r of rowsC) await taskPatch(dt.s, r.id, { execution: 'skipped', expectedRevision: await rev(r.id) })
  fd = await factsD()
  const cc = cf(fd.readings.find(r => r.id === readingC)!, opt, null)
  check('scheduled and then skipped: no recency at all (still unknown)', cc.recency.source === 'unknown' && cc.recency.days === null)
  // Typed narrative and onboarding "working on it now" do not create dates.
  check('the onboarding report of working on a subject carries no date', fd.readings.filter(r => r.reportedCurrent).every(r => cf(r, opt, null).recency.days === null || r.outcomeActivity.some(Boolean)))
  const page = await (await dt.s.req(`/app/curriculum/${roadD.input.modules.find(m => m.id === readingA)!.topic}/${readingA}`)).text()
  check('the reading page shows the logged-date provenance to the student', /the study date you logged/.test(page) && /7 days ago/.test(page))
  const noEvid = await counts(dt.id)
  check('logging and completing revision created no evidence, attempts, responses, repairs or Coach rows', JSON.parse(noEvid).every((n: number) => n === 0), noEvid)

  console.log('\n11. Uncertainty gets targeted priority without excluding other subjects')
  const unc = await student('rvUnc', { extra: { uncertainty: { econ: { level: 'most', lmIds: [] } } } })
  const cu = await cycleOf(unc.id)
  const ru = await reviews(unc.id, cu.id)
  const modules = (await getActiveRoadmap(unc.id))!.input.modules
  const topicOf = (id: string) => modules.find(m => m.id === id)?.topic
  const lmu = lmsOf(ru)
  check('the flagged subject leads', topicOf(lmu[0]) === 'econ' || lmu.some(id => topicOf(id) === 'econ'), lmu.map(topicOf).join(','))
  check('but does not take every place', lmu.some(id => topicOf(id) !== 'econ'), lmu.map(topicOf).join(','))
  check('and the flagged tasks say the reason is self-reported', ru.filter(r => topicOf(r.lm_id as string) === 'econ').every(r => /self-reported/i.test(String(r.rationale))))
}

main().catch(e => { console.error(e); process.exitCode = 1; failed++ }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.`)
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped (skips are NOT counted as passed)`)
  for (const s of skipped) console.log(`  skipped: ${s}`)
  if (failed > 0) process.exitCode = 1
})
