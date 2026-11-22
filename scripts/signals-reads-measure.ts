/**
 * Phase 2 §2 measurement: REST read counts and latency of getSignals on an ordinary account with realistic history, before (the loader at git HEAD,
 * written to a temporary sibling module) and after. Fixture history, owned throwaway student. Never lowers evidence to save time.
 *   E2E_BASE_URL=http://localhost:3142 npx tsx scripts/signals-reads-measure.ts
 */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, FRESH_STUDENT_ONBOARDING, preflightServer } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'

const realFetch = globalThis.fetch
let seen = new Map<string, number>()
globalThis.fetch = (async (input: any, init?: any) => { const m = /\/rest\/v1\/([a-z_]+)\?/.exec(String(typeof input === 'string' ? input : input?.url ?? input)); if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1); return realFetch(input, init) }) as typeof fetch
const db = createAdminClient(), owned: string[] = []
const OLD = 'src/lib/signals/signals-loader.old.ts'

async function main() {
  await preflightServer()
  fs.writeFileSync(OLD, execFileSync('git', ['show', 'HEAD:src/lib/signals/signals-loader.ts'], { encoding: 'utf8' }))
  const s = await createStudent(db, 'p2meas', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone)
  const outcomes = (await db.from('reading_los').select('id').order('id').limit(20).throwOnError()).data!.map(o => o.id as string)
  const items = (await db.from('assessment_items').select('id').order('id').limit(60).throwOnError()).data!
  const concept = (await db.from('curriculum_concepts').select('id').limit(1).single().throwOnError()).data!.id as string
  const att = [randomUUID(), randomUUID(), randomUUID()]
  await db.from('assessment_attempts').insert(att.map((id, i) => ({ id, user_id: s.id, status: 'scored', evidence_mode: 'evidence', started_at: addDays(today, -i - 1) + 'T10:00:00Z', submitted_at: addDays(today, -i - 1) + 'T10:30:00Z', score: 60 }))).throwOnError()
  await db.from('assessment_responses').insert(att.flatMap(attempt_id => items.map(it => ({ attempt_id, item_id: it.id, user_id: s.id, is_correct: true, self_reported_confidence: 4 })))).throwOnError()
  await db.from('evidence_events').insert(att.flatMap((attempt_id, i) => items.map(it => ({ user_id: s.id, attempt_id, item_id: it.id, concept_id: concept, evidence_state: 'supported', is_correct: true, self_reported_confidence: 4, validity: 'valid', evidence_mode: 'evidence', created_at: addDays(today, -i - 1) + 'T10:30:00Z' })))).throwOnError()
  const sessions = [randomUUID(), randomUUID()]
  await db.from('class_sessions').insert(sessions.map(id => ({ id, user_id: s.id, cycle_id: cycle.id, class_date: addDays(today, -2), kind: 'covered', idempotency_key: randomUUID() }))).throwOnError()
  await db.from('class_session_items').insert(sessions.flatMap((id, k) => outcomes.map(o => ({ session_id: id, outcome_id: o, extent: k ? 'full' : 'part', studied_in_class: false })))).throwOnError()
  console.log('\nOrdinary account: 3 scored papers x 60 answers (180 responses, 180 events), 2 class sessions x 20 items\n')
  const measure = async (label: string, load: (u: string, n: Date) => Promise<any>) => {
    const runs: { ms: number; reads: number; by: string }[] = []
    for (let i = 0; i < 3; i++) { seen = new Map(); const t = Date.now(); const sig = await load(s.id, new Date(Date.now() + (i + 1) * 61_000 + (label === 'new' ? 7_000_000 : 0))); const ms = Date.now() - t
      runs.push({ ms, reads: [...seen.values()].reduce((a, b) => a + b, 0), by: `events=${sig.understanding.validEvents} whole=${sig.position.whole ?? 'n/a'} partial=${sig.position.partial ?? 'n/a'} exposed=${sig.position.exposed}` }) }
    runs.sort((a, b) => a.ms - b.ms); const m = runs[1]
    console.log(`  ${label.padEnd(4)} median ${m.ms} ms, ${m.reads} REST reads  (${m.by})`)
  }
  const oldPath = '../src/lib/signals/signals-loader.old'
  await measure('old', (await import(oldPath)).getSignals)
  await measure('new', (await import('../src/lib/signals/signals-loader')).getSignals)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  try { fs.unlinkSync(OLD) } catch { /* already gone */ }
  for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\ncleaned ${owned.length} owned student(s); temporary old-loader copy removed`)
})
