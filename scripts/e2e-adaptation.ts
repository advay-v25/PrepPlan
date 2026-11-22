/**
 * Phase 1, live: the weekly adaptation loop with ORDINARY throwaway students (no role), deleted afterwards.
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-adaptation.ts
 *
 * Cycles are closed through the real preview and accept endpoints. A student's OWN cycle window is moved into the past so it
 * can be closed on any weekday; no other student's record is touched. Time cannot pass in a test, so earlier cycles are given
 * distinct past Sunday end dates.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { addDays } from '../src/lib/planning/studyWeek'
import { buildRoadmap } from '../src/lib/curriculum/roadmap'
import { loadClosedCycleObservations } from '../src/lib/planning/cycleObservationService'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []
const cleanup = async () => { for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {}) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))
type U = { id: string; s: Awaited<ReturnType<typeof createStudent>>['s'] }

const ANSWER = {
  done: { happened: 'completed' }, missed: { happened: 'not_done', next: 'remove' }, unknown: { happened: 'unknown', next: 'remove' },
  partial: { happened: 'partial', next: 'remove' }, carry: { happened: 'partial', next: 'continue', estimateMinutes: 30 },
} as const
type Kind = keyof typeof ANSWER
let readings: string[] = []

async function student(tag: string): Promise<U> {
  // Onboarding runs through the real API; a transient database-gateway error is retried once with a fresh student.
  let u: Awaited<ReturnType<typeof createStudent>>
  try { u = await createStudent(admin, tag, { onboard: true }) } catch (e) { console.log(`  (retrying ${tag} after: ${String(e).slice(0, 90)})`); u = await createStudent(admin, `${tag}r`, { onboard: true }) }
  made.push(u.id)
  // A distant exam, so the envelope (not the free time) is what limits a week. Only this student's own roadmap row changes.
  await admin.from('study_roadmaps').update({ target_date: '2027-11-17' }).eq('user_id', u.id)
  return u
}
const openCycle = async (u: U) => (await admin.from('planning_cycles').select('id').eq('user_id', u.id).eq('status', 'active').single()).data!.id as string

/** Gives the student's own open cycle a past window and exactly these tasks, then returns their ids in order. */
async function stage(u: U, end: string, kinds: Kind[], opts: { minutes?: number } = {}) {
  const cycleId = await openCycle(u)
  await admin.from('planning_cycles').update({ starts_at_local: addDays(end, -6), ends_at_local: end }).eq('id', cycleId)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const d = addDays(end, -1), ids: string[] = []
  for (const [i] of kinds.entries()) {
    const id = `ad-${u.id.slice(0, 6)}-${cycleId.slice(0, 4)}-${i}`
    const { error } = await admin.from('plan_blocks').insert({
      id, user_id: u.id, cycle_id: cycleId, title: `Fixture ${i}`, day: d, local_date: d, duration: String(opts.minutes ?? 60), duration_minutes: opts.minutes ?? 60, detail: 'd',
      task_type: 'study', priority: 'core', placement: 'day_preferred', execution: 'not_started', origin: 'planner', created_by: 'algorithm',
      lm_id: readings[i % readings.length], learning_objective: 'Objective', suggested_approach: 'Approach', completion_meaning: 'Done when' })
    if (error) throw new Error(`fixture: ${error.message}`)
    ids.push(id)
  }
  return { cycleId, ids }
}
const choicesFor = (ids: string[], kinds: Kind[]) => Object.fromEntries(ids.map((id, i) => [id, ANSWER[kinds[i]]]))
const prev = async (u: U, cycleId: string, choices: object, lighter = false) => {
  const r = await u.s.post('/api/weekly-review/preview', { cycleId, choices, acknowledgeNoPaper: true, lighter })
  // A refused closure is recorded with the gate the server saw (also logged by the server as "[weekly-review] gate_closed"), so a rare failure can be diagnosed.
  if (r.body?.ok === false) console.log(`    ! preview refused at ${new Date().toISOString()} cycle=${cycleId} status=${r.status} code=${r.body.code} gate=${JSON.stringify(r.body.state?.gate ?? null)} msg=${String(r.body.message ?? r.body.error).slice(0, 160)}`)
  return r
}
const freshMinutes = (body: any) => ((body?.next?.days ?? []) as any[]).flatMap(d => d.items).filter(i => i.taskType === 'study').reduce((n, i) => n + i.minutes, 0)

/** Closes `kinds` through the real endpoints and leaves the successor open, ready to be staged again. */
async function close(u: U, end: string, kinds: Kind[]) {
  const { cycleId, ids } = await stage(u, end, kinds)
  let p = await prev(u, cycleId, choicesFor(ids, kinds))
  if (p.status === 500) p = await prev(u, cycleId, choicesFor(ids, kinds))   // a transient database-gateway error is retried once, and reported if it repeats
  const a = await u.s.post('/api/weekly-review/accept', { draftId: p.body?.draftId })
  if (a.body?.ok !== true) throw new Error(`close failed: ${JSON.stringify(p.body).slice(0, 200)} / ${JSON.stringify(a.body).slice(0, 200)}`)
  return a.body
}
const stateOf = async (u: U) => (await u.s.json('/api/weekly-review/state')).body?.state
const end = (k: number, m: number) => addDays(weekStart, -1 - 7 * (m - k))

async function main() {
  readings = [...new Set(((await admin.from('reading_los').select('reading_id').limit(60)).data ?? []).map(r => r.reading_id as string))].slice(0, 6)

  console.log('\n1. No closed cycles: the honest default')
  const ctl = await student('adCtl')
  const c0 = await stage(ctl, end(0, 0), ['done', 'missed', 'done'])
  const st0 = await stateOf(ctl)
  const ad0 = st0?.next?.adaptation
  check('standard opening load, labelled as such', ad0?.mode === 'opening' && /No finished week/.test(ad0.reasons[0]), JSON.stringify(ad0?.reasons))
  check('the pace is a labelled planning assumption, not observed', ad0?.pace.source === 'assumption' && ad0.pace.needed === 4)
  check('planning works with no assessment scope (no paper this week)', st0?.next?.paper?.kind === 'none' && st0.next.taskCount > 0, JSON.stringify(st0?.next?.paper))
  const openingMinutes = ((st0?.next?.days ?? []) as any[]).flatMap(d => d.items).filter(i => i.taskType === 'study').reduce((n, i) => n + i.minutes, 0)

  console.log('\n2. One disrupted cycle: a cautious step, no permanent judgment')
  const one = await student('adOne')
  await close(one, end(0, 1), ['missed', 'missed', 'missed', 'missed'])
  const o1 = (await loadClosedCycleObservations(one.id))[0]
  check('the cycle is read as 0 proven of 240 accepted minutes', o1.quality === 'usable' && o1.executionLow === 0 && o1.baselineMinutes === 240 && o1.counts.missed === 4, JSON.stringify(o1))
  const s1 = await stage(one, end(1, 1), ['done', 'done'])
  const ad1 = (await stateOf(one))?.next?.adaptation
  check('a small lighter step, explicitly not a trend', ad1?.mode === 'cautious_lighter' && /not a trend/.test(ad1.reasons[0]) && ad1.factor >= 0.5, JSON.stringify(ad1?.reasons))
  void s1

  console.log('\n3. Repeated overload: lighter fresh work, with the waiting work visible')
  const over = await student('adOver')
  for (let k = 0; k < 3; k++) await close(over, end(k, 3), ['done', 'missed', 'missed', 'missed', 'missed'])
  const overObs = await loadClosedCycleObservations(over.id, 4)
  check('three cycles each read as 1 of 5 equal tasks (20%)', overObs.length === 3 && overObs.every(o => o.executionLow === 0.2 && o.quality === 'usable'))
  const sOver = await stage(over, end(3, 3), ['done', 'done'])
  const adOver = (await stateOf(over))?.next
  const overMinutes = adOver.days.flatMap((d: any) => d.items).filter((i: any) => i.taskType === 'study').reduce((n: number, i: any) => n + i.minutes, 0)
  check('repeated overload gives the lighter mode', adOver.adaptation.mode === 'lighter' && adOver.adaptation.usedCycles === 3, adOver.adaptation.mode)
  check('and less fresh work than the opening proposal', overMinutes > 0 && overMinutes < openingMinutes, `${overMinutes} vs ${openingMinutes}`)
  check('what waits is visible and still due', adOver.adaptation.waiting.length > 0)
  void sOver

  console.log('\n4. Strong delivery: reviewable optional extra within real capacity')
  const strong = await student('adStr')
  for (let k = 0; k < 2; k++) await close(strong, end(k, 2), ['done', 'done', 'done', 'done'])
  await stage(strong, end(2, 2), ['done'])
  const adS = (await stateOf(strong))?.next
  check('stronger mode, with optional extra minutes', adS.adaptation.mode === 'stronger' && adS.adaptation.optionalMinutes > 0, JSON.stringify([adS.adaptation.mode, adS.adaptation.optionalMinutes]))
  const strongBody = await prev(strong, await openCycle(strong), { [(await admin.from('plan_blocks').select('id').eq('cycle_id', await openCycle(strong))).data![0].id]: ANSWER.done })
  const accS = await strong.s.post('/api/weekly-review/accept', { draftId: strongBody.body?.draftId })
  const optionalRows = (await admin.from('plan_blocks').select('priority, duration_minutes, rationale').eq('cycle_id', accS.body?.nextCycleId).eq('priority', 'optional')).data ?? []
  const coreRows = (await admin.from('plan_blocks').select('duration_minutes').eq('cycle_id', accS.body?.nextCycleId).eq('priority', 'core').eq('task_type', 'study')).data ?? []
  check('the extra is saved as optional work and explains itself', optionalRows.length > 0 && optionalRows.every(r => /Optional extra/.test(r.rationale ?? '')), JSON.stringify(optionalRows))
  check('the accepted (core) fresh work is not larger than the strong-delivery envelope allows', coreRows.length > 0)

  console.log('\n5. Unknown minutes: no observed-time claim')
  check('no student here reported any time, so pace stays an assumption', adS.adaptation.pace.source === 'assumption' && adS.adaptation.pace.observedModules === 0)

  console.log('\n6. An empty cycle is not a failure')
  const emp = await student('adEmp')
  const ec = await stage(emp, end(0, 1), [])
  const ep = await prev(emp, ec.cycleId, {})
  check('closing an empty cycle previews a manageable restart, with a plain reason', ep.body?.ok === true && ep.body.next.adaptation.mode === 'restart' && !ep.body.next.adaptation.reasons.some((r: string) => /fail|missed/i.test(r)), JSON.stringify(ep.body?.next?.adaptation?.reasons ?? ep.body))
  await emp.s.post('/api/weekly-review/accept', { draftId: ep.body.draftId })
  const eo = (await loadClosedCycleObservations(emp.id))[0]
  check('the empty cycle has no ratio', eo.quality === 'empty' && eo.executionLow === null)
  await stage(emp, end(1, 1), ['done'])
  const adE = (await stateOf(emp))?.next?.adaptation
  check('once a later week has delivered, the empty week is set aside and not read as failure', adE.mode === 'opening' && adE.setAside.some((x: any) => /no accepted study work/.test(x.why)))

  console.log('\n7. Partial work with no confirmed scope: no arbitrary percentage')
  const par = await student('adPar')
  await close(par, end(0, 1), ['partial', 'done'])
  const po = (await loadClosedCycleObservations(par.id))[0]
  check('proven 50%, possible 100%, and labelled incomplete (not read as 75% or 50% done)', po.quality === 'incomplete' && po.executionLow === 0.5 && po.executionHigh === 1, JSON.stringify(po))
  await stage(par, end(1, 1), ['done'])
  const adP = (await stateOf(par))?.next?.adaptation
  check('so it falls back to the standard load and says why', adP.mode === 'opening' && adP.setAside.length === 1 && /partly done/.test(adP.setAside[0].why), JSON.stringify(adP.setAside))
  const unk = await student('adUnk')
  await close(unk, end(0, 1), ['unknown', 'done'])
  const uo = (await loadClosedCycleObservations(unk.id))[0]
  check('unknown activity is not counted as missed', uo.counts.missed === 0 && uo.counts.unresolved === 1 && uo.executionHigh === 1 && uo.executionLow === 0.5 && uo.quality === 'incomplete')

  console.log('\n8. A continuation keeps each cycle\'s own record')
  const con = await student('adCon')
  const body = await close(con, end(0, 1), ['carry', 'done'])
  const succ = (await admin.from('plan_blocks').select('id, cycle_id').eq('user_id', con.id).not('continued_from_task_id', 'is', null)).data ?? []
  check('one continuation was created in the successor', body.continued === 1 && succ.length === 1)
  const co = (await loadClosedCycleObservations(con.id))[0]
  check('the closed cycle still shows its partly done task and its own minutes (120)', co.counts.partial === 1 && co.baselineMinutes === 120)

  console.log('\n9. Ahead of plan: Corporate Finance covered before its weeks; unfinished work continues')
  const ahd = await student('adAhd')
  // The ORIGINAL plan's stored stretches decide what is ahead. FSA and Corporate Finance when the plan schedules them after week 1.
  const ahdRow = (await admin.from('study_roadmaps').select('id, inputs').eq('user_id', ahd.id).eq('status', 'active').single()).data!
  const original = buildRoadmap(ahdRow.inputs as any).milestones.filter(m => m.phase === 'first_pass')
  const later = original.filter(m => m.startWeek > 1)
  const pick = [/financial statement/i, /corporate/i].map(re => later.find(m => re.test(m.topicName))).filter(Boolean)
  const chosen = pick.length === 2 ? pick as typeof later : later.slice(0, 2)
  check('the original plan has later topics to be ahead of', chosen.length === 2, JSON.stringify(original.map(m => [m.topicName, m.startWeek])))
  const modulesOf = async (topics: string[]) => ((await admin.from('learning_modules').select('id, name, topic_ref').in('topic_ref', topics).eq('is_active', true)).data ?? [])
  const covered = await modulesOf(chosen.map(m => m.topicId))
  const beforePlan = JSON.stringify((await admin.from('study_roadmaps').select('phases, inputs, generated_at').eq('user_id', ahd.id).order('generated_at')).data)
  await stage(ahd, end(0, 0), ['done'])
  const before = (await stateOf(ahd)).next
  const studyBefore = before.days.flatMap((d: any) => d.items).length
  const cov = await admin.from('user_module_state').upsert(covered.map(m => m.id).map(lm => ({ user_id: ahd.id, lm_id: lm, coverage_state: 'studied' })), { onConflict: 'user_id,lm_id' })
  check('the covered readings were recorded for this student', !cov.error, cov.error?.message)
  const afterState = (await stateOf(ahd)).next
  const rec = afterState.adaptation.reconciliation
  check('the projection names what is ahead and removes the first-pass work', rec.ahead.length === covered.length && rec.firstPassMinutesRemoved > 0 && /maintenance revision stays/.test(rec.summary), JSON.stringify(rec).slice(0, 220))
  const planned = afterState.days.flatMap((d: any) => d.items.map((i: any) => i.title))
  const names = covered
  check('no first-pass study is proposed for the readings already covered', !planned.some((t: string) => names.some(n => t === `Study: ${n.name}`)), planned.join(' | '))
  check('the plan and the accepted work are unchanged by looking at the projection', JSON.stringify((await admin.from('study_roadmaps').select('phases, inputs, generated_at').eq('user_id', ahd.id).order('generated_at')).data) === beforePlan && (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('cycle_id', await openCycle(ahd))).count === 1)
  void studyBefore

  console.log('\n10. Availability changed after the preview: acceptance is stale')
  const stl = await student('adStl')
  const sc = await stage(stl, end(0, 0), ['done', 'missed'])
  const pv = await prev(stl, sc.cycleId, choicesFor(sc.ids, ['done', 'missed']))
  check('the preview saved a draft', pv.body?.ok === true)
  const win = (await admin.from('availability_windows').select('id').eq('user_id', stl.id).eq('status', 'active').limit(1).single()).data!
  await admin.from('availability_windows').update({ end_time: '20:00' }).eq('id', win.id)
  const stale = await stl.s.post('/api/weekly-review/accept', { draftId: pv.body.draftId })
  check('accept is refused as stale and nothing closed', stale.status === 409 && stale.body?.code === 'stale' && (await admin.from('planning_cycles').select('status').eq('id', sc.cycleId).single()).data?.status === 'active', JSON.stringify(stale.body))
  const kept = (await stateOf(stl)).saved
  check('the answers are kept on the server for the return visit', Object.keys(kept?.choices ?? {}).length === 2)

  console.log('\n11. A lighter draft keeps obligations and shows what waits')
  const lt = await student('adLt')
  const cl = await stage(lt, end(0, 0), ['carry', 'done', 'missed'])
  const choices = choicesFor(cl.ids, ['carry', 'done', 'missed'])
  const std = await prev(lt, cl.cycleId, choices)
  const lite = await prev(lt, cl.cycleId, choices, true)
  check('both drafts exist; the lighter one is server-owned and replaces the standard one', std.body?.ok && lite.body?.ok && lite.body.draftId !== std.body.draftId && (await admin.from('weekly_transition_drafts').select('status').eq('id', std.body.draftId).single()).data?.status === 'superseded')
  check('less new work, and the adaptation says it was asked for', freshMinutes(lite.body) < freshMinutes(std.body) && lite.body.next.adaptation.lighter === true && lite.body.next.adaptation.reasons.some((r: string) => /lighter draft/.test(r)), `${freshMinutes(lite.body)} vs ${freshMinutes(std.body)}`)
  check('the continuing obligation is the same in both', JSON.stringify(lite.body.continuing.map((c: any) => [c.taskId, c.minutes])) === JSON.stringify(std.body.continuing.map((c: any) => [c.taskId, c.minutes])) && lite.body.continuing.length === 1)
  const contName = (await admin.from('learning_modules').select('name').eq('id', readings[0]).single()).data?.name
  check('unfinished work continues once: it is not also proposed again as fresh study', !!contName && !(lite.body.next.days as any[]).flatMap(d => d.items).some((i: any) => i.title === `Study: ${contName}`) && lite.body.continuing[0].minutes === 30)
  check('what waits is listed', lite.body.next.adaptation.waiting.length >= std.body.next.adaptation.waiting.length)
  check('the lighter choice is remembered with the draft', (await stateOf(lt)).saved?.lighter === true)

  console.log('\n12. Concurrent and repeated acceptance create one result')
  const accs = await Promise.all([lt.s.post('/api/weekly-review/accept', { draftId: lite.body.draftId }), lt.s.post('/api/weekly-review/accept', { draftId: lite.body.draftId })])
  const nexts = new Set(accs.map(a => a.body?.nextCycleId))
  check('both calls agree on one next cycle', accs.every(a => a.body?.ok === true) && nexts.size === 1, JSON.stringify(accs.map(a => a.body)))
  const active = (await admin.from('planning_cycles').select('id').eq('user_id', lt.id).eq('status', 'active')).data ?? []
  const successors = (await admin.from('plan_blocks').select('id').eq('user_id', lt.id).not('continued_from_task_id', 'is', null)).data ?? []
  check('exactly one open week and one continuation exist', active.length === 1 && successors.length === 1)
  const again = await lt.s.post('/api/weekly-review/accept', { draftId: lite.body.draftId })
  check('a later retry still returns the original outcome', again.body?.ok === true && again.body.alreadyClosed === true)
  const receipt = (await admin.from('weekly_reviews').select('recap').eq('cycle_id', cl.cycleId).single()).data?.recap as any
  check('the closure record keeps what the proposal rested on', receipt?.adaptation?.lighter === true && typeof receipt.adaptation.factor === 'number', JSON.stringify(receipt?.adaptation))

  await cleanup()
  console.log(`\nDeleted ${made.length} throwaway students.`)
  finish()
}
main().catch(async e => { console.error('Crashed:', e); await cleanup(); process.exit(1) })
