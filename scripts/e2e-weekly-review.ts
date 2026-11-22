/**
 * Weekly transition, live, against the CURRENT contract: answers → saved draft (preview) → accept that draft.
 * Its own ordinary throwaway student (no role), deleted afterwards: no shared account, no --reset, safe beside other suites.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-weekly-review.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { E2E_BASE_URL } from './lib/e2eIdentity'
import { createStudent, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const made: string[] = []
const cleanup = async () => { for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {}) }
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function main() {
  console.log('\nWeekly transition (answers → draft → accept)\n')
  const { id: uid, s } = await createStudent(admin, 'wkrev', { onboard: true })
  made.push(uid)
  check('a throwaway student is signed in and onboarded', Boolean(uid))

  const noAuth = await fetch(`${E2E_BASE_URL}/api/weekly-review/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"draftId":"x"}' })
  check('accept requires authentication', noAuth.status === 401)
  check('accept is POST only', (await s.req('/api/weekly-review/accept')).status === 405)
  check('accept rejects a body without a draft id', (await s.post('/api/weekly-review/accept', {})).status === 400)

  // --- owned fixture: the open cycle ends on a past/today Sunday and holds exactly our tasks
  const { data: cycle } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cycle!.id as string
  const today = new Date().toISOString().slice(0, 10)
  const endDay = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay())
  await admin.from('planning_cycles').update({ starts_at_local: addDays(endDay, -6), ends_at_local: endDay }).eq('id', cycleId)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const { data: lo } = await admin.from('reading_los').select('id, reading_id').limit(1).single()
  const d = addDays(endDay, -1)
  const mk = (id: string) => admin.from('plan_blocks').insert({
    id, user_id: uid, cycle_id: cycleId, title: `Fixture ${id}`, day: d, local_date: d, duration: '45', duration_minutes: 45, detail: 'd', task_type: 'study', priority: 'core',
    placement: 'day_preferred', execution: 'not_started', origin: 'planner', created_by: 'algorithm', outcome_id: lo!.id, lm_id: lo!.reading_id,
    learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when' })
  const ids = { done: 'wk-done', part: 'wk-part', later: 'wk-later', gone: 'wk-gone', cont: 'wk-cont' }
  for (const id of Object.values(ids)) { const { error } = await mk(id); if (error) throw new Error(`fixture ${id}: ${error.message}`) }

  const rev = async (id: string) => Number((await admin.from('plan_blocks').select('revision').eq('id', id).single()).data?.revision)
  const setExec = async (id: string, execution: string, minutes: number) =>
    s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution, actualDurationMinutes: minutes, expectedRevision: await rev(id) }) })
  check('completed work is recorded with its minutes', (await setExec(ids.done, 'completed', 30)).status === 200)
  check('partial work is recorded with its minutes (20)', (await setExec(ids.part, 'partial', 20)).status === 200)

  const state = await s.json('/api/weekly-review/state')
  check('the review is open and no paper is allowed', state.body?.state?.gate?.kind === 'no_paper_allowed', JSON.stringify(state.body?.state?.gate))
  const choices = { [ids.part]: { happened: 'partial', next: 'continue', estimateMinutes: 25 },
    [ids.later]: { happened: 'not_done', next: 'later', estimateMinutes: 30 }, [ids.gone]: { happened: 'not_done', next: 'remove' }, [ids.cont]: { happened: 'not_done', next: 'continue', estimateMinutes: 40 } }

  console.log('\nPreview writes nothing')
  const snap = async () => ({ blocks: (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', uid)).count, cycles: (await admin.from('planning_cycles').select('id', { count: 'exact', head: true }).eq('user_id', uid)).count,
    exec: JSON.stringify((await admin.from('plan_blocks').select('id, execution, revision').in('id', Object.values(ids)).order('id')).data) })
  const before = await snap()
  const refused = await s.post('/api/weekly-review/preview', { cycleId, choices })
  check('without acknowledging the missing paper, preview is refused', refused.status === 409 && refused.body?.code === 'gate_closed', JSON.stringify(refused.body).slice(0, 120))
  const bad = await s.post('/api/weekly-review/preview', { cycleId, choices: { [ids.done]: { happened: 'nonsense' } }, acknowledgeNoPaper: true })
  check('an unknown answer is refused', bad.status === 400)
  const prev = await s.post('/api/weekly-review/preview', { cycleId, choices, acknowledgeNoPaper: true })
  check('preview saves a draft', prev.status === 200 && prev.body?.ok === true && typeof prev.body.draftId === 'string', JSON.stringify(prev.body).slice(0, 200))
  const after = await snap()
  check('no task or cycle was created and original execution is untouched', before.blocks === after.blocks && before.cycles === after.cycles && before.exec === after.exec)
  const cont = (prev.body?.continuing ?? []) as any[]
  check('exactly the three "continue/later" tasks continue; "remove" does not', cont.length === 3 && !cont.some(c => c.taskId === ids.gone) && !cont.some(c => c.taskId === ids.done), cont.map(c => c.taskId).join(','))
  check('partial work continues with the student estimate', cont.find(c => c.taskId === ids.part)?.minutes === 25)

  console.log('\nA changed week makes the draft stale; answers are kept')
  await admin.from('plan_blocks').update({ detail: 'edited after preview' }).eq('id', ids.cont)
  const stale = await s.post('/api/weekly-review/accept', { draftId: prev.body.draftId })
  check('accepting a stale draft is refused (409 stale)', stale.status === 409 && stale.body?.code === 'stale', JSON.stringify(stale.body).slice(0, 160))
  check('nothing was closed or created', (await snap()).blocks === before.blocks && (await admin.from('planning_cycles').select('status').eq('id', cycleId).single()).data?.status === 'active')
  const keptDraft = await admin.from('weekly_transition_drafts').select('id, choices').eq('id', prev.body.draftId).maybeSingle()
  check('the saved review answers still exist on the stale draft', Boolean(keptDraft.data) && Object.keys((keptDraft.data?.choices ?? {}) as object).length === 4)
  const prev2 = await s.post('/api/weekly-review/preview', { cycleId, choices, acknowledgeNoPaper: true })
  check('re-preparing with the same answers works', prev2.body?.ok === true && prev2.body.draftId !== prev.body.draftId)

  console.log('\nAcceptance')
  const acc = await s.post('/api/weekly-review/accept', { draftId: prev2.body.draftId })
  check('accept succeeds', acc.status === 200 && acc.body?.ok === true && acc.body.continued === 3, JSON.stringify(acc.body).slice(0, 200))
  const nextCycleId = acc.body?.nextCycleId as string
  const cyc = await admin.from('planning_cycles').select('id, status').eq('user_id', uid)
  check('the old cycle closed and a successor opened, atomically', cyc.data?.find(c => c.id === cycleId)?.status !== 'active' && cyc.data?.find(c => c.id === nextCycleId)?.status === 'active' && cyc.data?.filter(c => c.status === 'active').length === 1, JSON.stringify(cyc.data))
  const succ = (await admin.from('plan_blocks').select('*').in('continued_from_task_id', [ids.part, ids.later, ids.cont])).data ?? []
  check('three continuations exist, each linked to its original', succ.length === 3 && succ.every(t => t.cycle_id === nextCycleId))
  const again = await s.post('/api/weekly-review/accept', { draftId: prev2.body.draftId })
  check('retrying the same draft returns the original outcome, creating nothing', again.status === 200 && again.body?.ok === true && again.body.alreadyClosed === true && again.body.nextCycleId === nextCycleId, JSON.stringify(again.body).slice(0, 160))
  check('and there are still exactly three continuations', ((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', uid).not('continued_from_task_id', 'is', null)).count) === 3)

  console.log('\nContinuation semantics')
  const orig = (await admin.from('plan_blocks').select('id, execution, cycle_id, outcome_id, lm_id').in('id', Object.values(ids))).data ?? []
  check('originals keep their cycle, mapping and status', orig.every(o => o.cycle_id === cycleId) && orig.find(o => o.id === ids.done)?.execution === 'completed' && orig.find(o => o.id === ids.part)?.execution === 'partial')
  const sp = succ.find(t => t.continued_from_task_id === ids.part)!
  check('the successor keeps objective, approach, mapping', sp.learning_objective === 'Objective' && sp.suggested_approach === 'Approach' && sp.outcome_id === lo!.id && sp.lm_id === lo!.reading_id)
  check('the successor starts clean: not started, no copied scope', sp.execution === 'not_started' && !sp.assessment_scope)
  const succMin = await admin.from('task_events').select('id', { count: 'exact', head: true }).in('task_id', succ.map(t => t.id)).not('actual_duration_minutes', 'is', null)
  check('the successors have no copied reported minutes', (succMin.count ?? 0) === 0)
  const origMin = (await admin.from('task_events').select('actual_duration_minutes').eq('task_id', ids.part).not('actual_duration_minutes', 'is', null)).data ?? []
  check('the original still holds its 20 reported minutes', origMin.reduce((a, e) => a + Number(e.actual_duration_minutes), 0) === 20, JSON.stringify(origMin))

  console.log('\n20 minutes partial → 25 minutes completed = 45, attributed to each week once')
  const fin = await s.json(`/api/tasks/${sp.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'execution', execution: 'completed', actualDurationMinutes: 25, expectedRevision: Number(sp.revision) }) })
  check('the continuation can be completed with 25 minutes', fin.status === 200, JSON.stringify(fin.body).slice(0, 140))
  const minutesOf = async (id: string) => ((await admin.from('task_events').select('actual_duration_minutes').eq('task_id', id).not('actual_duration_minutes', 'is', null)).data ?? []).reduce((a, e) => a + Number(e.actual_duration_minutes), 0)
  const [m1, m2] = [await minutesOf(ids.part), await minutesOf(sp.id)]
  check('week one keeps 20, week two has 25, lineage total is 45', m1 === 20 && m2 === 25 && m1 + m2 === 45, `${m1} + ${m2}`)

  console.log('\nA deliberately empty next week is valid')
  const { data: c2 } = await admin.from('planning_cycles').select('id').eq('id', nextCycleId).single()
  // The second cycle is this student's own fixture: it covers a window that ends today, so it is closable on ANY weekday.
  await admin.from('planning_cycles').update({ starts_at_local: addDays(endDay, 1) <= today ? addDays(endDay, 1) : today, ends_at_local: today }).eq('id', c2!.id)
  const st2 = await s.json('/api/weekly-review/state')
  const due = (st2.body?.state?.dueTasks ?? []) as any[]
  check('the second cycle is open for review and lists its unfinished work (the field the response really has)', st2.body?.state?.gate?.kind !== 'not_ready' && due.length > 0, `${st2.body?.state?.gate?.kind} / ${due.length} due`)
  const allRemove: Record<string, unknown> = {}
  for (const t of due) allRemove[t.id] = { happened: 'not_done', next: 'remove' }
  const p3 = await s.post('/api/weekly-review/preview', { cycleId: nextCycleId, choices: allRemove, acknowledgeNoPaper: true })
  check('answering "remove" for everything previews a week with no continuing work', p3.body?.ok === true && (p3.body.continuing ?? []).length === 0, JSON.stringify(p3.body).slice(0, 160))
  await cleanup()
  finish()
}
main().catch(async e => { console.error('Crashed:', e); await cleanup(); process.exit(1) })
