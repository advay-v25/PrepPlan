/** Live learning-capture contract, scoped to the dedicated E2E identity. */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding } from '../src/lib/testing/e2eIdentity'
import { completeOnboarding, createSession, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main() {
  const session = createSession(admin, getE2EEmail())
  check('signed in', await session.signIn())
  const userId = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, userId)
  await assertBlankOnboarding(admin, userId)
  await completeOnboarding(session, admin)

  const { data: module } = await admin.from('learning_modules').select('id')
    .eq('is_active', true).eq('topic_ref', 'fsa').limit(1).single()
  if (!module) throw new Error('No active FSA module')

  const list = await session.json('/api/log-learning')
  check('curriculum choices load', list.status === 200 && list.body.modules?.some((m: any) => m.id === module.id))

  const beforeEvidence = await admin.from('evidence_events')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId)
  const classLog = await session.post('/api/log-learning', {
    activity_type: 'class', description: 'E2E class coverage', lm_id: module.id, duration_minutes: 60,
  })
  check('class log saves with an exposure update', classLog.status === 200 && classLog.body.coverageUpdated === true,
    JSON.stringify(classLog.body))
  const taught = await admin.from('user_module_state').select('coverage_state,source')
    .eq('user_id', userId).eq('lm_id', module.id).single()
  check('class moves mapped module to taught, not verified',
    taught.data?.coverage_state === 'taught' && taught.data?.source === 'class', JSON.stringify(taught.data))

  const studyLog = await session.post('/api/log-learning', {
    activity_type: 'independent_study', description: 'E2E individual work', lm_id: module.id,
  })
  check('independent study log saves', studyLog.status === 200)
  const studied = await admin.from('user_module_state').select('coverage_state')
    .eq('user_id', userId).eq('lm_id', module.id).single()
  check('later individual work moves exposure to studied', studied.data?.coverage_state === 'studied')

  const invalid = await session.post('/api/log-learning', {
    activity_type: 'class', description: 'Invalid module reference', lm_id: 'not-a-real-module',
  })
  check('unknown module is rejected', invalid.status >= 400)
  // Outcome-level logging (the Log learning sheet): coverage + one completed Calendar block per outcome.
  const topics = list.body.topics as { id: string; readings: { id: string; outcomes: { id: string }[] }[] }[]
  check('curriculum loads as subjects → readings → outcomes', Array.isArray(topics) && topics.length === 10
    && topics.every(t => t.readings.length > 0 && t.readings.every(r => r.outcomes.length > 0)))
  const reading = topics.find(t => t.id !== 'fsa')!.readings[0]
  const outcomeIds = reading.outcomes.slice(0, 3).map(o => o.id)
  const key = `e2e${Date.now().toString(36)}`
  const entry = { activity_type: 'independent_study', reading_id: reading.id, outcome_ids: outcomeIds, duration_minutes: 60, idempotency_key: key }
  const logged = await session.post('/api/log-learning', entry)
  check('outcome log saves for today', logged.status === 200 && logged.body.ok === true && logged.body.outcomes === outcomeIds.length,
    JSON.stringify(logged.body).slice(0, 200))
  check('today is inside the active week, so it reaches Calendar', logged.body.inCycle === true)
  const { data: blocks } = await admin.from('plan_blocks').select('outcome_id, execution, created_by, cycle_id, duration_minutes')
    .eq('user_id', userId).like('id', `log-${key}-%`)
  check('one completed student block per outcome', (blocks ?? []).length === outcomeIds.length
    && (blocks ?? []).every(b => b.execution === 'completed' && b.created_by === 'student' && b.cycle_id && outcomeIds.includes(b.outcome_id as string)),
    JSON.stringify(blocks).slice(0, 200))
  check('the time is split across the outcomes', (blocks ?? []).every(b => b.duration_minutes === 20))
  const readingState = await admin.from('user_module_state').select('coverage_state').eq('user_id', userId).eq('lm_id', reading.id).single()
  check('the reading is marked studied, not verified', readingState.data?.coverage_state === 'studied', JSON.stringify(readingState.data))
  const replay = await session.post('/api/log-learning', entry)
  const { count: afterReplay } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', userId).like('id', `log-${key}-%`)
  check('a double-submit is replayed, not duplicated', replay.status === 200 && replay.body.replayed === true && afterReplay === outcomeIds.length)
  const old = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10)
  const tooOld = await session.post('/api/log-learning', { ...entry, idempotency_key: `${key}old`, date: old })
  check('a date beyond the last 14 days is refused', tooOld.status >= 400)
  const noOutcomes = await session.post('/api/log-learning', { ...entry, idempotency_key: `${key}none`, outcome_ids: [] })
  check('an empty outcome list is refused', noOutcomes.status >= 400)

  const afterEvidence = await admin.from('evidence_events')
    .select('*', { count: 'exact', head: true }).eq('user_id', userId)
  check('self-report created no diagnostic evidence', afterEvidence.count === beforeEvidence.count)

  finish()
}

main().catch(error => { console.error(error); process.exit(1) })
