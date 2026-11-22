/**
 * Phase 2 §2 — mature histories are read completely, deduplicated and fail loudly.
 * One owned throwaway student with a LABELLED FIXTURE history (not bank capability): 6 scored papers x 200 answers (1,200 responses and events),
 * 1,029 class items over 3 sessions, one confirmed whole block. All rows cascade with the registered student.
 */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, FRESH_STUDENT_ONBOARDING, preflightServer, makeCheck } from './lib/e2eSession'
import { getSignals } from '../src/lib/signals/signals-loader'
import { coverageLine } from '../src/lib/state/progressSummary'
import { toLevel } from '../src/lib/curriculum/confidence'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'

// Count and (on demand) fail REST page requests, so the negative control exercises the real readers.
const realFetch = globalThis.fetch
const seen = new Map<string, number>()
let failRule: { table: string; offset: number } | null = null
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input)
  const m = /\/rest\/v1\/([a-z_]+)\?/.exec(url)
  if (m) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1)
    const off = Number(/[?&]offset=(\d+)/.exec(url)?.[1] ?? 0)
    if (failRule && m[1] === failRule.table && off >= failRule.offset) return new Response(JSON.stringify({ message: 'injected page failure' }), { status: 500, headers: { 'content-type': 'application/json' } })
  }
  return realFetch(input, init)
}) as typeof fetch

const db = createAdminClient(), { check, finish } = makeCheck()
const owned: string[] = []
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function main() {
  await preflightServer()
  const s = await createStudent(db, 'p2hist', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone)
  const outcomes = (await db.from('reading_los').select('id').order('id').throwOnError()).data!.map(o => o.id as string)
  const items = (await db.from('assessment_items').select('id, lm_id').order('id').limit(200).throwOnError()).data!
  const concept = (await db.from('curriculum_concepts').select('id').limit(1).single().throwOnError()).data!.id as string
  console.log(`\nFixture history: ${outcomes.length} outcomes, ${items.length} items per paper (labelled fixture, not bank capability)\n`)

  // 6 scored evidence papers + 1 practice paper that must not count.
  const attemptIds = Array.from({ length: 6 }, () => randomUUID()), practiceId = randomUUID()
  const submitted = (i: number) => new Date(Date.parse(`${today}T12:00:00Z`) - (6 - i) * 86_400_000).toISOString()
  await db.from('assessment_attempts').insert([
    ...attemptIds.map((id, i) => ({ id, user_id: s.id, status: 'scored', evidence_mode: 'evidence', started_at: submitted(i), submitted_at: submitted(i), score: 60 })),
    { id: practiceId, user_id: s.id, status: 'scored', evidence_mode: 'practice', started_at: submitted(0), submitted_at: submitted(0), score: 40 },
  ]).throwOnError()
  const responses: any[] = [], events: any[] = []
  attemptIds.forEach((attempt_id, a) => items.forEach((it, k) => {
    const n = a * items.length + k
    responses.push({ attempt_id, item_id: it.id, user_id: s.id, is_correct: n % 3 !== 0, self_reported_confidence: (n % 5) + 1 })
    events.push({ user_id: s.id, attempt_id, item_id: it.id, concept_id: concept, evidence_state: 'supported', is_correct: n % 3 !== 0, self_reported_confidence: (n % 5) + 1,
      validity: n % 50 === 49 ? 'voided' : n % 70 === 69 ? 'disputed' : 'valid', evidence_mode: 'evidence', created_at: submitted(a) })
  }))
  for (const it of items.slice(0, 5)) responses.push({ attempt_id: practiceId, item_id: it.id, user_id: s.id, is_correct: true, self_reported_confidence: 5 })
  for (let i = 0; i < responses.length; i += 200) await db.from('assessment_responses').insert(responses.slice(i, i + 200)).throwOnError()
  for (let i = 0; i < events.length; i += 200) await db.from('evidence_events').insert(events.slice(i, i + 200)).throwOnError()
  const valid = events.filter(e => e.validity === 'valid')
  const tally = { high: { n: 0, correct: 0 }, low: { n: 0, correct: 0 }, medium: { n: 0, correct: 0 } }
  for (const e of valid) { const l = toLevel(e.self_reported_confidence); if (l) { tally[l].n++; if (e.is_correct) tally[l].correct++ } }
  const readings = new Set(items.map(i => i.lm_id as string))

  // Class history: 3 sessions covering every outcome (> 1,000 items). Session A: first 100 "all of it", rest "part". B and C: "part" everywhere.
  const sessions = ['a', 'b', 'c'].map(k => ({ k, id: randomUUID() }))
  await db.from('class_sessions').insert(sessions.map(x => ({ id: x.id, user_id: s.id, cycle_id: cycle.id, class_date: addDays(today, -2), kind: 'covered', idempotency_key: randomUUID() }))).throwOnError()
  const classItems = sessions.flatMap(x => outcomes.map((o, i) => ({ session_id: x.id, outcome_id: o, extent: x.k === 'a' && i < 100 ? 'full' : 'part', studied_in_class: false })))
  for (let i = 0; i < classItems.length; i += 200) await db.from('class_session_items').insert(classItems.slice(i, i + 200)).throwOnError()
  // One outcome that was only partly covered in class is then explicitly confirmed whole by a finished study block (a second source for the same kind of fact).
  const confirmedOutcome = outcomes[150], block = `p2-confirm-${randomUUID()}`
  await db.from('plan_blocks').insert({ id: block, user_id: s.id, cycle_id: cycle.id, outcome_id: confirmedOutcome, title: 'Fixture study', detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'completed', local_date: addDays(today, -1), day: addDays(today, -1), duration_minutes: 30, duration: '30', created_by: 'algorithm' }).throwOnError()
  await db.from('task_events').insert({ user_id: s.id, task_id: block, event_type: 'completed', payload: {} }).throwOnError().then(() => null, () => null)

  console.log('1. Complete reads and exact totals\n')
  seen.clear()
  const t0 = Date.now(), sig = await getSignals(s.id, new Date())
  const ms = Date.now() - t0
  check(`all ${events.length} events are read: ${valid.length} valid (not truncated at 1,000)`, sig.understanding.validEvents === valid.length, `${sig.understanding.validEvents} vs ${valid.length}`)
  check('scored papers: six evidence papers, the practice paper is not one', sig.understanding.scoredPapers === 6, String(sig.understanding.scoredPapers))
  check(`readings tested = distinct readings of the ${items.length} items answered across ALL 1,200 responses`, sig.understanding.readingsTested === readings.size, `${sig.understanding.readingsTested} vs ${readings.size}`)
  check('confidence tally uses every valid event with its real denominator', sig.calibration.sample === tally.high.n + tally.medium.n + tally.low.n && sig.calibration.sureSample === tally.high.n, JSON.stringify({ s: sig.calibration.sample, h: sig.calibration.sureSample, want: tally.high.n }))
  const pos = sig.position
  const wholeWant = 100 + 0 + (outcomes.length > 150 ? 1 : 0)
  check('1,029 class items over 3 sessions: whole outcomes are the 100 "all of it" plus the one explicitly confirmed block', pos.whole === wholeWant, `${pos.whole} vs ${wholeWant}`)
  check('partly covered = the rest, each counted ONCE although three sessions mention it', pos.partial === outcomes.length - wholeWant, `${pos.partial} vs ${outcomes.length - wholeWant}`)
  check('whole + partial = exposed: no outcome is both, none is double counted', pos.whole + pos.partial === pos.exposed && pos.exposed === outcomes.length)
  const line = coverageLine(sig)
  check('Home never calls partial coverage "confirmed": it says partly covered', /partly covered/.test(line.detail) && !new RegExp(`${pos.exposed} of ${pos.total} outcomes are also confirmed`).test(line.detail), line.detail)
  const reads = [...seen.entries()].sort()
  console.log(`  reads by table (REST requests): ${reads.map(([t, n]) => `${t}=${n}`).join(' ')}; total ${reads.reduce((n, [, c]) => n + c, 0)}; ${ms} ms\n`)
  check('identifier lookups are bounded batches (assessment_items requests, each <= 100 ids)', (seen.get('assessment_items') ?? 0) >= Math.ceil(items.length / 100))

  console.log('2. A failed later page is a failure, never "no activity"\n')
  for (const [table, offset] of [['assessment_responses', 500], ['evidence_events', 500], ['assessment_attempts', 0], ['profiles', 0], ['class_session_items', 500]] as const) {
    failRule = { table, offset }
    let err = '', value: unknown = null
    try { value = await getSignals(s.id, new Date(Date.now() + 61_000 * (1 + Math.random() * 1000))) } catch (e: any) { err = String(e?.message ?? e) }
    check(`${table} (page from offset ${offset}) failing rejects the signals instead of returning zeros`, err !== '' && value === null, err.slice(0, 110))
    failRule = null
  }
  const after = await getSignals(s.id, new Date(Date.now() + 61_000 * 2000))
  check('once reads recover the exact same totals come back (nothing was cached as empty)', after.understanding.validEvents === valid.length && after.position.whole === wholeWant)

  console.log('3. Owner scope\n')
  const other = (await db.from('profiles').select('id').neq('id', s.id).limit(1)).data?.[0]?.id as string | undefined
  if (other) { const o = await getSignals(other, new Date(Date.now() + 61_000 * 3000)).catch(() => null); check("another student's signals never include this student's events", !o || o.understanding.validEvents !== valid.length) }
  const r = await s.s.json('/api/signals'); check('the signed-in student can read their own signals route', r.status === 200 && r.body.signals?.position?.whole === wholeWant, JSON.stringify(r.body).slice(0, 120))
  const anon = await fetch(`${process.env.E2E_BASE_URL ?? 'http://localhost:3000'}/api/signals`, { redirect: 'manual' }); check('an anonymous request to the signals route is refused', anon.status === 401 || anon.status === 403 || anon.status === 307 || anon.status === 302, String(anon.status))
  await wait(1)
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {})
  console.log(`cleaned ${owned.length} owned student(s)`)
  finish()
})
