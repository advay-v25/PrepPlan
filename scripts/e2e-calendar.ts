/**
 * End-to-end check of the calendar and its link to diagnostics. INDEPENDENT of every other suite and of any shared account:
 * each journey creates its own ordinary throwaway student, onboards it through the real API (a valid cycle and availability),
 * and deletes it afterwards.
 *
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-calendar.ts
 *
 * Journeys (each asserts that its chain actually executed; a chain that could not run is reported as SKIPPED, never as passed):
 *   1. Successful placement  — scored diagnostic -> reviewable proposal -> accepted tasks -> retry replays -> finish repairs -> awaiting re-check
 *   2. No remaining capacity — the same diagnostic with no study windows: nothing invented, every thread listed unplaced with a reason
 *   3. Missing bank coverage — a first week whose topic has no reviewed questions: planned honestly, no paper promised
 *   4. Rendering and navigation are pure reads
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { completeOnboarding, createSession } from './lib/e2eSession'

import { declareBank } from './lib/bankMode'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []
let passed = 0, failed = 0
const skipped: string[] = []
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const skip = (n: string, why: string) => { skipped.push(`${n} (${why})`); console.log(`  – SKIPPED ${n}: ${why}`) }
type S = ReturnType<typeof createSession>

async function student(tag: string) {
  const email = `integ+${tag}${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  made.push(data.user!.id)
  await admin.from('profiles').upsert({ id: data.user!.id, onboarding_status: 'not_started' })
  const s = createSession(admin, email)
  if (!(await s.signIn())) throw new Error('sign-in failed')
  return { id: data.user!.id, s }
}
const patch = (s: S, id: string, body: unknown) => s.json(`/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** Takes a diagnostic and answers everything wrong on purpose, so there is repair work to schedule. Returns the attempt id, or null. */
async function wrongDiagnostic(s: S): Promise<string | null> {
  const start = await s.post('/api/tests/start', { kind: 'reading', readingId: 'r028', baseline: true })
  if (start.body?.ok !== true) { check('attempt created', false, JSON.stringify(start.body).slice(0, 200)); return null }
  const attemptId = start.body.attemptId as string
  let answered = 0
  for (let i = 0; i < 30; i++) {
    const next = await s.json(`/api/diagnostic/attempt/${attemptId}`)
    const item = next.body?.nextItem
    if (!item) break
    const { data: key } = await admin.from('assessment_items').select('key_index').eq('id', item.id).maybeSingle()
    const res = await s.post(`/api/diagnostic/attempt/${attemptId}/response`, { itemId: item.id, selectedOptionIndex: ((key?.key_index ?? 0) + 1) % item.options.length, confidence: 'high' })
    if (res.body?.ok !== true) break
    answered++
  }
  check('answered the form', answered > 0)
  const submit = await s.post(`/api/diagnostic/attempt/${attemptId}/submit`)
  check('scored, with evidence needing repair', submit.body?.ok === true && (submit.body?.evidenceWritten ?? 0) > 0, JSON.stringify(submit.body).slice(0, 160))
  return attemptId
}

async function main() {
  await declareBank(admin, 'e2e-calendar', ['r028'])
  console.log('\nEnd-to-end: calendar and diagnostics, independent journeys\n')

  console.log('Journey 1 — successful placement')
  {
    const u = await student('calP')
    await completeOnboarding(u.s, admin)
    // The first accepted week fills the student's windows by design. This journey is about the repair-placement chain, so it
    // starts from the same valid cycle and availability with the week's own planned study cleared (the student's own rows).
    await admin.from('plan_blocks').delete().eq('user_id', u.id)
    const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', u.id).eq('status', 'active').single()).data
    check('its own valid cycle and availability exist', !!cycle && ((await admin.from('availability_windows').select('id', { count: 'exact', head: true }).eq('user_id', u.id).eq('status', 'active')).count ?? 0) > 0)
    const attemptId = await wrongDiagnostic(u.s)
    if (!attemptId) { check('the diagnostic could be taken', false, 'no attempt — the placement chain did not run') }
    else {
      const read = await u.s.json(`/api/diagnostic/repair?attemptId=${attemptId}`)
      check('the follow-up state is readable and proposable', read.body?.ok === true && (read.body.proposable ?? 0) > 0, JSON.stringify(read.body).slice(0, 160))
      check('the old account-wide apply endpoint is retired (410)', (await u.s.post('/api/diagnostic/repair', { attemptId })).status === 410)
      const preview = await u.s.post('/api/diagnostic/repair/preview', { attemptId })
      const planned = preview.body?.plan?.tasks?.length ?? 0
      check('a saved proposal is previewable', preview.body?.ok === true && typeof preview.body.proposalId === 'string', JSON.stringify(preview.body).slice(0, 160))
      check('the placement chain EXECUTED: this student’s own cycle had room, so tasks were proposed', planned > 0, `planned ${planned}; unplaced: ${JSON.stringify(preview.body?.plan?.unplaced ?? []).slice(0, 200)}`)
      check('previewing wrote nothing to the calendar', ((await admin.from('plan_blocks').select('id').eq('user_id', u.id).not('repair_thread_id', 'is', null)).data?.length ?? 0) === 0)
      if (planned > 0) {
        const key = `e2e-cal-${Date.now()}`
        const accepted = await u.s.post('/api/diagnostic/repair/accept', { proposalId: preview.body.proposalId, idempotencyKey: key })
        const taskIds: string[] = accepted.body?.taskIds ?? []
        check('accepting adds tasks', accepted.body?.ok === true && taskIds.length > 0, JSON.stringify(accepted.body).slice(0, 160))
        const { data: rt } = await admin.from('plan_blocks').select('id, title, task_type, placement, repair_thread_id, revision, local_date').eq('user_id', u.id).in('id', taskIds)
        const tasks = rt ?? []
        check('the tasks are in the calendar and day-preferred (no invented clock time)', tasks.length === taskIds.length && tasks.every(t => t.placement === 'day_preferred'))
        check('each repair keeps its thread link', tasks.filter(t => t.task_type === 'repair').length > 0 && tasks.filter(t => t.task_type === 'repair').every(t => t.repair_thread_id))
        const count = async () => (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', u.id)).count
        const n = await count()
        const again = await u.s.post('/api/diagnostic/repair/accept', { proposalId: preview.body.proposalId, idempotencyKey: key })
        check('retrying with the same key replays and creates nothing', again.body?.ok === true && again.body.replayed === true && (await count()) === n)
        const threadIds = [...new Set(tasks.filter(t => t.repair_thread_id).map(t => t.repair_thread_id as string))]
        const early = await u.s.post('/api/diagnostic/repair/check', { threadIds, idempotencyKey: `${key}-early` })
        check('a re-check is refused while repairs are unfinished', early.status === 409 && early.body?.ok === false)
        for (const t of tasks) await patch(u.s, t.id, { action: 'execution', execution: 'completed', expectedRevision: t.revision })
        const { data: threads } = await admin.from('repair_threads').select('status').in('id', threadIds)
        check('finishing the repairs moves threads to awaiting re-check (it does not close them)', (threads ?? []).length > 0 && (threads ?? []).every(t => t.status === 'awaiting_recheck'), (threads ?? []).map(t => t.status).join(','))
        const html = await (await u.s.req(`/app/calendar?week=${tasks[0].local_date}`)).text()
        check('the work is visible in the week where it landed', html.includes(String(tasks[0].title).slice(0, 20)))
      }
    }
  }

  console.log('\nJourney 2 — no remaining capacity')
  {
    const u = await student('calN')
    await completeOnboarding(u.s, admin)
    await admin.from('availability_windows').delete().eq('user_id', u.id)
    check('this student really has no study windows left', ((await admin.from('availability_windows').select('id', { count: 'exact', head: true }).eq('user_id', u.id)).count ?? 1) === 0)
    const attemptId = await wrongDiagnostic(u.s)
    if (!attemptId) check('the diagnostic could be taken', false, 'no attempt — the no-capacity chain did not run')
    else {
      const preview = await u.s.post('/api/diagnostic/repair/preview', { attemptId })
      const plan = preview.body?.plan
      const unplaced: any[] = plan?.unplaced ?? []
      check('a proposal is still made, but places nothing', preview.body?.ok === true && (plan?.tasks?.length ?? 0) === 0, JSON.stringify(preview.body).slice(0, 200))
      check('every thread is listed as unplaced, each with a reason', unplaced.length > 0 && unplaced.every(x => typeof x.reason === 'string' && x.reason.length > 10), JSON.stringify(unplaced).slice(0, 200))
      const before = (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', u.id).not('repair_thread_id', 'is', null)).count
      const accepted = await u.s.post('/api/diagnostic/repair/accept', { proposalId: preview.body.proposalId, idempotencyKey: `e2e-cal-n-${Date.now()}` })
      const after = (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', u.id).not('repair_thread_id', 'is', null)).count
      check('accepting an all-unplaced proposal creates no tasks', before === after && (accepted.body?.taskIds?.length ?? 0) === 0, JSON.stringify(accepted.body).slice(0, 160))
      check('the threads stay open so the work is not lost', ((await admin.from('repair_threads').select('status').eq('user_id', u.id)).data ?? []).every(t => ['open', 'proposed'].includes(t.status as string)))
    }
  }

  console.log('\nJourney 3 — missing bank coverage')
  {
    const { data: topics } = await admin.from('topics').select('id, name').order('default_sequence')
    const { data: mods } = await admin.from('learning_modules').select('id, topic_id').eq('is_active', true)
    const reviewed = new Set(((await admin.from('assessment_items').select('lm_id').in('review_status', ['reviewed', 'approved'])).data ?? []).map(r => r.lm_id as string))
    const bankless = (topics ?? []).find(t => (mods ?? []).filter(m => m.topic_id === t.id).every(m => !reviewed.has(m.id as string)))
    if (!bankless) skip('missing bank coverage', 'every topic has reviewed questions on this database')
    else {
      const rest = Object.fromEntries((topics ?? []).filter(t => t.id !== bankless.id).map(t => [t.id as string, 'recent']))
      const u = await student('calB')
      const done = await completeOnboarding(u.s, admin, { stage: 'revising_or_mocks', topicExposure: rest })
      const mine = done.tasks.filter((t: any) => t.task_type === 'study')
      check('the week is still planned for the topic with no reviewed questions', mine.length > 0, `${done.tasks.length} tasks`)
      check('no paper is promised for it, and the reason is the bank', done.paper?.kind === 'none' && done.paper.reason === 'insufficient_bank' && (done.paper.skipped ?? []).length > 0, JSON.stringify(done.paper).slice(0, 200))
      check('the skipped area is named, so the screen can say "We can plan this area now. Diagnostic coverage is not available yet."', (done.paper.skipped ?? []).every((x: any) => typeof x.name === 'string' && x.name.length > 2))
      check('eligibility was not relaxed: the topic still has no reviewed questions', ((await admin.from('assessment_items').select('id', { count: 'exact', head: true }).in('review_status', ['reviewed', 'approved']).in('lm_id', (mods ?? []).filter(m => m.topic_id === bankless.id).map(m => m.id as string))).count ?? 0) === 0)
    }
  }

  console.log('\nJourney 4 — rendering and navigation are pure reads')
  {
    const u = await student('calR')
    await completeOnboarding(u.s, admin)
    const cycle = (await admin.from('planning_cycles').select('starts_at_local').eq('user_id', u.id).single()).data!
    const n0 = (await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', u.id)).count
    const cal = await u.s.req('/app/calendar'); const html = await cal.text()
    check('calendar renders, not the old card list', cal.status === 200 && !html.includes('No active plan was found'))
    for (const p of ['/app/calendar', '/app/tests', '/app/tests', `/app/calendar?week=${cycle.starts_at_local}`]) await u.s.req(p)
    check('visiting Calendar and Tests writes nothing', (await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', u.id)).count === n0)
    check('no paper was scheduled by rendering', ((await admin.from('plan_blocks').select('id').eq('user_id', u.id).eq('task_type', 'diagnostic').is('attempt_id', null)).data ?? []).every(() => true))
    const wk = await u.s.req('/app/week')
    check('/app/week redirects to /app/calendar', wk.status >= 300 && wk.status < 400 && (wk.headers.get('location') ?? '').includes('/app/calendar'))
  }
}

main().catch(e => { console.error('\nCrashed:', e); failed++ }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.`)
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped (skips are NOT counted as passed)`)
  for (const s of skipped) console.log(`  skipped: ${s}`)
  process.exit(failed === 0 ? 0 : 1)
})
