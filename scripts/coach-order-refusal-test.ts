/**
 * Phase 2 §5: a Coach move that would invert a declared sitting order is refused by the authoritative move boundary, the student gets a useful
 * explanation with a Calendar link to the affected task, and nothing is written or invented. Owned throwaway student; the proposal is fixture-inserted
 * (the Coach's own preview path is covered elsewhere), the confirmation goes through the real HTTP route.
 *   E2E_BASE_URL=http://localhost:3142 npx tsx scripts/coach-order-refusal-test.ts
 */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, FRESH_STUDENT_ONBOARDING, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { calendarTaskHref } from '../src/lib/routing/calendar'

const db = createAdminClient(), { check, finish } = makeCheck()
const owned: string[] = []

async function main() {
  await preflightServer()
  const s = await createStudent(db, 'p2order', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone), D = addDays(today, 1), D2 = addDays(today, 2)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 6) }).eq('id', cycle.id).throwOnError()
  const A = `p2-a-${randomUUID()}`, B = `p2-b-${randomUUID()}`
  const row = (id: string, title: string, o: Record<string, unknown>) => ({ id, user_id: s.id, cycle_id: cycle.id, title, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: D, day: D, duration_minutes: 30, duration: '30', created_by: 'algorithm', dependencies: [], ...o })
  await db.from('plan_blocks').insert([row(A, 'Sitting 1 of two', { sitting_ordinal: 1 }), row(B, 'Sitting 2 of two', { sitting_ordinal: 2, dependencies: [A] })]).throwOnError()
  const a0 = (await db.from('plan_blocks').select('revision, local_date, updated_at').eq('id', A).single().throwOnError()).data!
  const eventsBefore = (await db.from('task_events').select('*', { count: 'exact', head: true }).eq('user_id', s.id)).count
  const blocksBefore = (await db.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', s.id)).count
  const prop = (to: string) => db.from('coach_proposals').insert({ user_id: s.id, intent: 'move_task', kind: 'move_task', title: 'Move sitting 1', reasoning: 'fixture', origin: 'coach', status: 'pending', target_cycle_id: cycle.id,
    proposed_changes: { version: 3, move: { id: A, title: 'Sitting 1 of two', revision: a0.revision, fromDate: D, toDate: to, startsAt: null, startMinutes: null, minutes: 30, windowed: false } } }).select('id').single().throwOnError()

  const bad = (await prop(D2)).data!.id as string
  const r = await s.s.post(`/api/coach/proposals/${bad}`, { decision: 'accept' })
  check('confirming a move that puts sitting 1 after sitting 2 is refused (409)', r.status === 409 && r.body.ok === false && r.body.code === 'STALE', JSON.stringify(r.body))
  check('the explanation names the order and the sibling, in plain words', /break the order you planned/.test(r.body.error) && /Sitting 2 of two/.test(r.body.error) && /Nothing was moved/.test(r.body.error), r.body.error)
  check('it links to the affected task in Calendar by its exact task-date deep link', r.body.nextUrl === calendarTaskHref(A, D), String(r.body.nextUrl))
  const a1 = (await db.from('plan_blocks').select('revision, local_date, updated_at').eq('id', A).single().throwOnError()).data!
  check('no write: the task is exactly as it was, no event, no new task and no automatic re-placement', a1.revision === a0.revision && a1.local_date === D && a1.updated_at === a0.updated_at
    && (await db.from('task_events').select('*', { count: 'exact', head: true }).eq('user_id', s.id)).count === eventsBefore
    && (await db.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', s.id)).count === blocksBefore)
  check('the proposal is marked stale, so the refusal cannot be replayed into a move', (await db.from('coach_proposals').select('status').eq('id', bad).single().throwOnError()).data!.status === 'stale')
  const again = await s.s.post(`/api/coach/proposals/${bad}`, { decision: 'accept' })
  check('retrying the same confirmation is still refused, never applied', again.status === 409)

  const other = await createStudent(db, 'p2orderx', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const foreign = await other.s.post(`/api/coach/proposals/${bad}`, { decision: 'accept' })
  check("another student cannot act on this student's proposal", foreign.status === 404, String(foreign.status))

  const fine = (await prop(D)).data!.id as string
  const ok = await s.s.post(`/api/coach/proposals/${fine}`, { decision: 'accept' })
  check('a same-day move that keeps the declared order is still applied (the refusal is narrow)', ok.status === 200 && ok.body.ok === true, JSON.stringify(ok.body).slice(0, 160))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {})
  console.log(`cleaned ${owned.length} owned student(s)`)
  finish()
})
