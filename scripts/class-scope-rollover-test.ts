/**
 * B3 §1, live: a class portion ("part" / "continued") never becomes whole-outcome scope, including across the REAL weekly command.
 * The weekly continuation deliberately resets plan_blocks.class_session_id; provenance must survive through continued_from_task_id.
 * Ordinary throwaway student, deleted afterwards. Needs the owned dev server (E2E_BASE_URL).
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck, preflightServer } from './lib/e2eSession'
import { getCompletedCycleScope } from '../src/lib/tests/completedScopeService'
import { getPaperPreview } from '../src/lib/tests/paperPreview'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))
const made: string[] = []

async function main() {
  await preflightServer()
  console.log('\nClass portion scope across the real weekly rollover\n')
  const u = await createStudent(admin, 'cscope', { onboard: true, register: id => made.push(id) })
  const uid = u.id
  // Two outcomes of one reading, standing in for two synthetic concepts: neither may reach a paper until the whole outcome is confirmed.
  const { data: rd } = await admin.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false)
  let o1 = '', o2 = '', reading = ''
  for (const r of rd ?? []) {
    const { data: los } = await admin.from('reading_los').select('id').eq('reading_id', r.id).order('id').limit(2)
    if ((los ?? []).length === 2) { reading = r.id as string; o1 = los![0].id as string; o2 = los![1].id as string; break }
  }
  check('a reading with two outcomes was found', Boolean(reading && o1 && o2))

  // Stage: a past cycle holding a class log (part + continued) and each outcome's consolidation task, partly done.
  const end = addDays(weekStart, -1)
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  await admin.from('planning_cycles').update({ starts_at_local: addDays(end, -6), ends_at_local: end }).eq('id', cycleId)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const classDate = addDays(end, -5)
  const { data: sess, error: se } = await admin.from('class_sessions').insert({ user_id: uid, cycle_id: cycleId, class_date: classDate, kind: 'covered', idempotency_key: `cscope-${uid}` }).select('id').single()
  if (se) throw new Error(se.message)
  const sessionId = sess!.id as string
  await admin.from('class_session_items').insert([{ session_id: sessionId, outcome_id: o1, extent: 'part' }, { session_id: sessionId, outcome_id: o2, extent: 'continued' }])
  const ids: Record<string, string> = {}
  for (const [i, o] of [o1, o2].entries()) {
    const id = `cs-${uid.slice(0, 6)}-${i}`; ids[o] = id
    const d = addDays(end, -3)
    const { error } = await admin.from('plan_blocks').insert({
      id, user_id: uid, cycle_id: cycleId, title: `Consolidate ${i}`, day: d, local_date: d, duration: '60', duration_minutes: 60, detail: 'd', task_type: 'class_consolidation',
      priority: 'core', placement: 'day_preferred', execution: 'partial', origin: 'planner', created_by: 'algorithm', lm_id: reading, outcome_id: o, class_session_id: sessionId,
      learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when' })
    if (error) throw new Error(error.message)
  }
  const evidenceBefore = (await admin.from('evidence_events').select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0

  // Roll the week over with the real command, continuing both tasks.
  const choices = Object.fromEntries(Object.values(ids).map(id => [id, { happened: 'partial', next: 'continue', estimateMinutes: 30 }]))
  const p = await u.s.post('/api/weekly-review/preview', { cycleId, choices, acknowledgeNoPaper: true })
  check('the weekly preview is accepted', p.body?.ok === true, JSON.stringify(p.body).slice(0, 200))
  const a = await u.s.post('/api/weekly-review/accept', { draftId: p.body?.draftId })
  check('the weekly command rolls the week over', a.body?.ok === true && a.body.continued === 2, JSON.stringify(a.body).slice(0, 200))
  const { data: succ } = await admin.from('plan_blocks').select('id, class_session_id, continued_from_task_id, cycle_id, outcome_id').eq('user_id', uid).not('continued_from_task_id', 'is', null)
  check('the successors have NO class_session_id (the leak precondition), only lineage', (succ ?? []).length === 2 && (succ ?? []).every(s => s.class_session_id === null && s.cycle_id !== cycleId))
  const succOf = (o: string) => succ!.find(s => s.outcome_id === o)!.id as string

  // Completing the successors (the student did the work next week) is still not whole coverage.
  for (const o of [o1, o2]) await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', succOf(o))
  let scope = await getCompletedCycleScope(uid, new Date(Date.now() + 60_000))
  check('neither outcome is a target after the consolidation is completed next week', !scope.targets.some(t => t.outcomeId === o1 || t.outcomeId === o2))
  check('both portions stay visible across the boundary with the ORIGINAL class date', [o1, o2].every(o => scope.pendingPortions.some(x => x.outcomeId === o && x.classDate === classDate)))
  check('each has a concrete confirmation action (an unresolved class_part task)', [o1, o2].every(o => scope.unresolved.some(x => x.blockId === succOf(o) && x.reason === 'class_part')))
  let paper = await getPaperPreview(uid, undefined, new Date(Date.now() + 60_000))
  check('the paper blueprint draws nothing from that reading (conservative exclusion)', !paper.blueprint.perReading.some(r => r.readingId === reading))

  // The student explicitly confirms the whole of ONE outcome.
  const rev = (await admin.from('plan_blocks').select('revision').eq('id', succOf(o1)).single()).data!.revision
  const c = await u.s.post('/api/tests/scope/confirm', { blockId: succOf(o1), outcomeIds: [o1], expectedRevision: rev })
  check('explicit whole-outcome confirmation is accepted', c.body?.ok === true, JSON.stringify(c.body))
  scope = await getCompletedCycleScope(uid, new Date(Date.now() + 120_000))
  const t1 = scope.targets.find(t => t.outcomeId === o1)
  check('only the confirmed outcome becomes a target, and it is NEW (earlier exposure is not a completed first pass)', Boolean(t1) && t1!.kind === 'new' && !scope.targets.some(t => t.outcomeId === o2))
  check('the other portion is still pending', scope.pendingPortions.some(x => x.outcomeId === o2) && !scope.pendingPortions.some(x => x.outcomeId === o1))
  paper = await getPaperPreview(uid, undefined, new Date(Date.now() + 120_000))
  check('the confirmed outcome now reaches the blueprint (subject to normal bank rules)', paper.blueprint.perReading.some(r => r.readingId === reading))

  // Reopening the confirmation removes it again.
  const rev2 = (await admin.from('plan_blocks').select('revision').eq('id', succOf(o1)).single()).data!.revision
  await u.s.post('/api/tests/scope/confirm', { blockId: succOf(o1), outcomeIds: [], expectedRevision: rev2 })
  scope = await getCompletedCycleScope(uid, new Date(Date.now() + 180_000))
  check('clearing the confirmation returns it to pending (correction/reopening)', !scope.targets.some(t => t.outcomeId === o1) && scope.pendingPortions.some(x => x.outcomeId === o1))

  // A later class that logs the outcome "All of it" is the other explicit route.
  const { data: s2 } = await admin.from('class_sessions').insert({ user_id: uid, cycle_id: (await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()).data!.id, class_date: today, kind: 'covered', idempotency_key: `cscope2-${uid}` }).select('id').single()
  await admin.from('class_session_items').insert({ session_id: s2!.id, outcome_id: o2, extent: 'full' })
  scope = await getCompletedCycleScope(uid, new Date(Date.now() + 240_000))
  check('a later "All of it" class log confirms the other outcome', scope.targets.some(t => t.outcomeId === o2) && !scope.pendingPortions.some(x => x.outcomeId === o2))

  // History untouched.
  const evidenceAfter = (await admin.from('evidence_events').select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const { data: preds } = await admin.from('plan_blocks').select('id, cycle_id, execution, duration_minutes').in('id', Object.values(ids))
  check('evidence is unchanged', evidenceBefore === evidenceAfter)
  check('last week\'s tasks keep their own cycle, state and minutes', (preds ?? []).length === 2 && (preds ?? []).every(r => r.cycle_id === cycleId && r.execution === 'partial' && r.duration_minutes === 60))
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  if (!process.exitCode) finish()
})
