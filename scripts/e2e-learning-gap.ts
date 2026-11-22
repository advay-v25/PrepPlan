/**
 * Phase 2 carry-over: learning done OUTSIDE the planned week lowers the remaining syllabus work and changes what the next week
 * asks for, while the original week's completion record is untouched. Live, with an ordinary throwaway student (deleted after).
 *   E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-learning-gap.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { getStudyWeekContext } from '../src/lib/planning/schedule'
import { buildWeekPlanWithPaper } from '../src/lib/planning/pulse/generateWeek'
import { computeProgress, getActiveRoadmap } from '../src/lib/curriculum/roadmapService'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
let uid: string | null = null

async function remaining(id: string) {
  const a = await getActiveRoadmap(id); if (!a) throw new Error('no roadmap')
  const p = await computeProgress(id, a.roadmap, a.input)
  return { done: p.actualEffortDone, total: p.totalEffort, modulesDone: p.modulesDone }
}

async function main() {
  const u = await createStudent(admin, 'lgap', { onboard: true }); uid = u.id
  const planned = async () => (await admin.from('plan_blocks').select('id, execution, cancelled_at, duration_minutes').eq('user_id', u.id).is('learning_activity_id', null).order('id')).data ?? []
  const week0 = JSON.stringify(await planned())
  const before = await remaining(u.id)
  const ctx = await getStudyWeekContext(u.id)
  const planBefore = await buildWeekPlanWithPaper(u.id, ctx.week)
  const firstPassBefore = new Set(planBefore.days.flatMap(d => d.portions).filter(p => p.taskType === 'study' && p.lmId).map(p => p.lmId))

  const catalog = await u.s.json('/api/log-learning')
  const planned0 = planBefore.days.flatMap(d => d.portions).find(p => p.taskType === 'study' && p.lmId)
  const reading = catalog.body.topics.flatMap((t: any) => t.readings).find((r: any) => r.id === planned0?.lmId)
  check('found a reading the next week would ask the student to study', Boolean(reading), String(planned0?.lmId))
  const key = `lgap-${Date.now()}`
  const log = await u.s.post('/api/log-learning', { activity_type: 'independent_study', reading_id: reading.id, outcome_ids: reading.outcomes.map((o: any) => o.id), duration_minutes: 60, idempotency_key: key })
  check('extra learning is recorded', log.status === 200 && log.body.blocks === 1, JSON.stringify(log.body).slice(0, 120))

  const after = await remaining(u.id)
  check('remaining syllabus work goes down', after.done > before.done && (after.total - after.done) < (before.total - before.done), `${before.done}→${after.done} of ${before.total}`)
  check('the original week’s completion record is unchanged', JSON.stringify(await planned()) === week0)
  const planAfter = await buildWeekPlanWithPaper(u.id, ctx.week)
  const firstPassAfter = planAfter.days.flatMap(d => d.portions).filter(p => p.taskType === 'study' && p.lmId && p.lmId === reading.id)
  check('the next plan no longer asks for first-pass study of that reading', !firstPassBefore.has(reading.id) ? false : firstPassAfter.length === 0, `still ${firstPassAfter.length} portion(s)`)
  const replay = await u.s.post('/api/log-learning', { activity_type: 'independent_study', reading_id: reading.id, outcome_ids: reading.outcomes.map((o: any) => o.id), duration_minutes: 60, idempotency_key: key })
  check('a retry of the same log changes nothing', replay.status === 200 && replay.body.replayed === true && (await remaining(u.id)).done === after.done)
  const rm = await u.s.json(`/api/tasks/${log.body.taskId}?expectedRevision=1`, { method: 'DELETE' })
  check('removing the log restores the remaining work', rm.status === 200 && (await remaining(u.id)).done === before.done)
  check('and still leaves the planned record untouched', JSON.stringify(await planned()) === week0)
}
main().catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { if (uid) await admin.auth.admin.deleteUser(uid).catch(() => {}); finish() })
