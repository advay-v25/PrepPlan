/**
 * Activation recovery and weekly-paper reservation, against the live app.
 *
 *  - recovery restores/regenerates a versioned DRAFT, is idempotent, never
 *    commits tasks, and acceptance stays the explicit atomic confirm
 *  - a paper task's persisted scope is re-checked against the bank at
 *    reservation, and the reservation is idempotent
 *
 *   npm run dev
 *   npx tsx scripts/e2e-activation.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from './lib/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'
import { commitWeekPlan } from '../src/lib/planning/pulse/generateWeek'
import { resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'
import { draftFingerprint } from '../src/lib/onboarding/previewService'
import { todayInZone } from '../src/lib/planning/studyWeek'
import { getStudyWeekContext } from '../src/lib/planning/schedule'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function count(table: string, uid: string, filter: Record<string, string> = {}) {
  let q = admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', uid)
  for (const [k, v] of Object.entries(filter)) q = q.eq(k, v)
  const { count: n } = await q
  return n ?? 0
}

async function main() {
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)

  // ---------------------------------------------------------------- recovery
  console.log('\nActivation recovery')
  const noAuth = await fetch(`${E2E_BASE_URL}/api/activation/recover`, { method: 'POST' })
  check('recovery requires authentication', noAuth.status === 401, `status ${noAuth.status}`)
  const early = await s.post('/api/activation/recover')
  check('recovery before setup is complete is refused with a way forward', early.status === 409 && early.body?.nextUrl === '/onboarding', JSON.stringify(early.body))
  check('GET is not allowed (a prefetch can never create a draft)', (await s.req('/api/activation/recover')).status === 405)

  await completeOnboarding(s, admin)
  const { data: activeCycle } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').maybeSingle()
  check('acceptance created the active cycle', Boolean(activeCycle))
  const planned = await count('plan_blocks', uid)
  check('the accepted first week contains planned work (so the checks below are not vacuous)', planned > 0, `${planned} blocks`)

  const already = await s.post('/api/activation/recover')
  const draftsAfterAccept = await count('plan_drafts', uid)
  check('an already-active week needs no recovery', planned === 0 ? true : already.body?.status === 'already_active', JSON.stringify(already.body))

  // Put the account in the failed-activation state: onboarded, active roadmap, nothing planned.
  await admin.from('plan_blocks').delete().eq('user_id', uid)
  await admin.from('planning_cycles').delete().eq('user_id', uid)

  // A 'scheduled' repair thread whose only task is an orphan (cycle_id null) must be re-planned.
  const { data: cpt } = await admin.from('curriculum_concepts').select('id, manifest_id').limit(1).single()
  const orphanThread = await admin.from('repair_threads').insert({
    user_id: uid, concept_id: cpt!.id, manifest_id: cpt!.manifest_id, status: 'scheduled',
    latest_evidence_at: new Date().toISOString(),
  }).select('id').single()
  check('scheduled orphan-repair thread created', !orphanThread.error, orphanThread.error?.message)
  const nowIso0 = new Date().toISOString(), day0 = nowIso0.slice(0, 10)
  await admin.from('plan_blocks').insert({
    id: 'orphan-repair-e2e', user_id: uid, title: 'Orphan repair', detail: '', task_type: 'repair', origin: 'planner',
    priority: 'core', placement: 'timed', execution: 'not_started', local_date: day0, day: day0, starts_at: nowIso0,
    duration_minutes: 30, duration: '30', created_by: 'algorithm', repair_thread_id: orphanThread.data?.id,
  })

  const blocks0 = await count('plan_blocks', uid), cycles0 = await count('planning_cycles', uid)
  const r1 = await s.post('/api/activation/recover')
  check('recovery returns a draft for review', r1.body?.ok === true && r1.body.status === 'draft_ready' && !!r1.body.draftId, JSON.stringify(r1.body))
  check('it points at the real review step', r1.body?.reviewUrl === '/onboarding/plan')
  check('it carries an opaque support reference', typeof r1.body?.requestId === 'string' && r1.body.requestId.length > 20)
  check('recovery never commits tasks', (await count('plan_blocks', uid)) === blocks0)
  check('recovery never creates a cycle', (await count('planning_cycles', uid)) === cycles0)

  const { data: dr } = await admin.from('plan_drafts').select('draft_json').eq('id', r1.body.draftId).single()
  const draftRepairs = ((dr?.draft_json as any)?.tasks ?? []).filter((t: any) => t.metadata?.repair_thread_id === orphanThread.data?.id)
  check('a scheduled thread with only an orphan task is re-planned in the draft', draftRepairs.length === 1, JSON.stringify(draftRepairs.length))
  check('the orphan row is preserved for audit', (await admin.from('plan_blocks').select('id').eq('id', 'orphan-repair-e2e')).data?.length === 1)

  const review = await s.req('/onboarding/plan')
  check('the review route exists and renders', review.status === 200, `status ${review.status}`)

  const r2 = await s.post('/api/activation/recover')
  check('a second request returns the same draft', r2.body?.draftId === r1.body?.draftId && r2.body?.reused === true, JSON.stringify(r2.body))
  const burst = await Promise.all([1, 2, 3].map(() => s.post('/api/activation/recover')))
  check('concurrent requests all resolve to one draft', new Set(burst.map(b => b.body?.draftId)).size === 1 && burst.every(b => b.body?.ok === true), JSON.stringify(burst.map(b => b.body?.draftId)))
  check('exactly one ready draft exists', (await count('plan_drafts', uid, { status: 'ready' })) === 1)
  const preview = await s.post('/api/onboarding/plan/preview', {})
  check('the review screen loads the same draft (no duplicate on refresh)', preview.body?.data?.draftId === r1.body?.draftId, JSON.stringify(preview.body).slice(0, 160))
  const { data: draftRoadmaps } = await admin.from('study_roadmaps').select('id').eq('user_id', uid).eq('status', 'draft')
  check('repeated requests leave no orphaned draft roadmaps', (draftRoadmaps?.length ?? 0) <= 1, `${draftRoadmaps?.length}`)
  check('nothing was committed by any of it', (await count('plan_blocks', uid)) === blocks0)
  void draftsAfterAccept

  console.log('\nSetup changes and failed acceptance')
  await s.post('/api/onboarding/position', { stage: 'first_pass_underway', topicExposure: { quant: 'current' } }) // bumps the setup version
  const r3 = await s.post('/api/activation/recover')
  check('changed setup produces a new draft', r3.body?.draftId && r3.body.draftId !== r1.body?.draftId && r3.body.reused === false, JSON.stringify(r3.body))
  const { data: old } = await admin.from('plan_drafts').select('status').eq('id', r1.body.draftId).maybeSingle()
  check('the stale draft is superseded', old?.status === 'superseded', old?.status)
  check('still exactly one ready draft', (await count('plan_drafts', uid, { status: 'ready' })) === 1)

  const bad = await s.post('/api/onboarding/plan/confirm', { draftId: r3.body.draftId, expectedRevision: 999 })
  check('a failed acceptance reports a recoverable error', bad.body?.ok === false && bad.body?.recoverable === true && bad.body?.recoverUrl === '/api/activation/recover', JSON.stringify(bad.body))
  check('a failed acceptance commits nothing', (await count('plan_blocks', uid)) === blocks0 && (await count('planning_cycles', uid)) === cycles0)
  const { data: prof } = await admin.from('profiles').select('onboarding_status').eq('id', uid).maybeSingle()
  check('it does not corrupt the onboarding status', prof?.onboarding_status === 'complete', prof?.onboarding_status)
  const r4 = await s.post('/api/activation/recover')
  check('recovery after a failed acceptance regenerates a fresh draft', r4.body?.ok === true && r4.body.draftId !== r3.body.draftId && r4.body.reused === false, JSON.stringify(r4.body))

  const ok = await s.post('/api/onboarding/plan/confirm', { draftId: r4.body.draftId, expectedRevision: r4.body.revision })
  check('explicit acceptance commits the week atomically', ok.body?.ok === true, JSON.stringify(ok.body))
  check('exactly one active cycle after acceptance', (await count('planning_cycles', uid, { status: 'active' })) === 1)
  const afterBlocks = await count('plan_blocks', uid)
  const r5 = await s.post('/api/activation/recover')
  check('recovering an active week is a no-op', afterBlocks === 0 ? r5.body?.status === 'draft_ready' : r5.body?.status === 'already_active', JSON.stringify(r5.body))
  check('and writes nothing', (await count('plan_blocks', uid)) === afterBlocks && (await count('planning_cycles', uid)) === 1)

  // The owned, concurrent reservation scenarios now run in e2e-paper-journey.ts.
  const attemptsBefore = await count('assessment_attempts', uid)
  const retired = await s.post('/api/diagnostic/attempt')
  check('the obsolete paper starter is retired', retired.status === 410 && retired.body?.code === 'RETIRED')
  check('the retired route writes no attempt', (await count('assessment_attempts', uid)) === attemptsBefore)

  // ------------------------------------------------ scope persistence
  console.log('\nPaper purpose and scope survive both commit paths')
  const supported = 'r028'
  const now = new Date()
  const scope = {
    kind: 'weekly_paper', purpose: 'diagnostic', manifestId: '11111111-1111-1111-1111-111111111111',
    tiers: ['reviewed'], checkedAt: now.toISOString(), totalMinItems: 5, totalTargetItems: 8,
    sections: [{ purpose: 'diagnostic', moduleIds: [supported], minItems: 5, targetItems: 8 }],
  } as any
  // The cycle a first-week draft names is the shared first-cycle decision's (on a Sunday evening that is the next cycle).
  await admin.from('planning_cycles').delete().eq('user_id', uid)
  const week = (await getStudyWeekContext(uid)).week
  const paperPortion = {
    title: 'Weekly diagnostic paper', detail: 'Covers: test', taskType: 'diagnostic', effortUnits: 0,
    durationMinutes: 45, lmId: null, repairThreadId: null, priorityLane: 'content' as const,
    assessmentScope: scope, rationale: 'Closes the week',
  }
  await admin.from('plan_blocks').delete().eq('user_id', uid)
  await admin.from('planning_cycles').delete().eq('user_id', uid)
  await commitWeekPlan(uid, week, week.days.map((date, i) => ({
    date, weekday: new Date(`${date}T12:00:00Z`).getUTCDay() as any, portions: i === week.days.length - 1 ? [paperPortion] : [],
  })))
  const { data: viaCommit } = await admin.from('plan_blocks').select('task_type, placement, origin, assessment_scope').eq('user_id', uid).eq('task_type', 'diagnostic').maybeSingle()
  check('commit_pulse_week persists the paper scope', viaCommit?.assessment_scope?.kind === 'weekly_paper' && viaCommit.assessment_scope.purpose === 'diagnostic' && viaCommit.assessment_scope.sections?.[0]?.moduleIds?.[0] === supported, JSON.stringify(viaCommit))
  check('and the paper is timed, attributed to diagnostics', viaCommit?.placement === 'timed' && viaCommit?.origin === 'diagnostic')

  await admin.from('plan_blocks').delete().eq('user_id', uid)
  await admin.from('planning_cycles').delete().eq('user_id', uid)
  const { data: rm } = await admin.from('study_roadmaps').select('id').eq('user_id', uid).eq('status', 'active').maybeSingle()
  const { data: prof2 } = await admin.from('profiles').select('onboarding_context_version').eq('id', uid).maybeSingle()
  const { data: draft, error: draftErr } = await admin.from('plan_drafts').insert({
    user_id: uid, purpose: 'onboarding_initial_week', status: 'ready', revision: 1, roadmap_id: rm?.id,
    cycle_start_date: week.startDate, cycle_end_date: week.endDate, timezone: 'Europe/London',
    onboarding_context_version: prof2?.onboarding_context_version ?? 1,
    // A current draft: the fingerprint the application itself would compute for this setup version, cycle and local day.
    context_fingerprint: draftFingerprint((prof2?.onboarding_context_version ?? 1) as number, week.startDate, todayInZone('Europe/London')),
    draft_json: { tasks: [{
      id: crypto.randomUUID(), title: paperPortion.title, purpose: 'learning', scheduled_date: week.endDate,
      duration_minutes: 45, is_floating: false,
      metadata: { detail: '', task_type: 'diagnostic', priority: 'core', placement: 'timed', origin: 'diagnostic', starts_at: now.toISOString(), assessment_scope: scope, rationale: '' },
    }] },
  }).select('id, revision').single()
  if (draftErr) throw new Error(draftErr.message)
  const accepted = await s.post('/api/onboarding/plan/confirm', { draftId: draft.id, expectedRevision: draft.revision })
  check('accept_onboarding_preview accepts the paper draft', accepted.body?.ok === true, JSON.stringify(accepted.body))
  const { data: viaAccept } = await admin.from('plan_blocks').select('assessment_scope, placement').eq('user_id', uid).eq('task_type', 'diagnostic').maybeSingle()
  check('accept_onboarding_preview persists the paper scope', viaAccept?.assessment_scope?.kind === 'weekly_paper' && viaAccept.assessment_scope.purpose === 'diagnostic', JSON.stringify(viaAccept))
  await admin.from('plan_blocks').delete().eq('user_id', uid)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
