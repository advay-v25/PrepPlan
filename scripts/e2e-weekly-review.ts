/**
 * Weekly closure + week-two loop, live, on the dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-weekly-review.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function main() {
  console.log('\nWeekly review (closure + week two)\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)

  const cnt = async (t: string, f: Record<string, string> = {}) => {
    let q = admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)
    for (const [k, v] of Object.entries(f)) q = q.eq(k, v)
    return (await q).count ?? 0
  }

  // --- auth + method guards
  const noAuthState = await fetch(`${E2E_BASE_URL}/api/weekly-review/state`)
  const noAuthAccept = await fetch(`${E2E_BASE_URL}/api/weekly-review/accept`, { method: 'POST' })
  check('state requires authentication', noAuthState.status === 401)
  check('accept requires authentication', noAuthAccept.status === 401)
  check('accept is POST only (a prefetch cannot close a week)', (await s.req('/api/weekly-review/accept')).status === 405)
  const viaAdmin = await admin.rpc('accept_weekly_review', {
    p_cycle_id: '00000000-0000-0000-0000-000000000000', p_closure_kind: 'no_paper', p_no_paper_reason: 'x',
    p_resolutions: {}, p_recap: {}, p_next: {},
  })
  check('the RPC refuses a caller with no user session', !!viaAdmin.error && /Not authenticated/.test(viaAdmin.error.message), viaAdmin.error?.message)

  const { data: cycle0 } = await admin.from('planning_cycles').select('id, ends_at_local').eq('user_id', uid).eq('status', 'active').single()
  check('onboarding left one active cycle', !!cycle0)
  const cycleId = cycle0!.id as string

  // --- render purity + gate before the cycle ends
  const before = { blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), reviews: await cnt('weekly_reviews') }
  const st1 = await s.json('/api/weekly-review/state')
  await s.req('/app/review-week'); const page = await s.req('/app/review-week')
  check('review page renders', page.status === 200, `status ${page.status}`)
  check('viewing the review writes nothing', before.blocks === await cnt('plan_blocks') && before.cycles === await cnt('planning_cycles') && before.reviews === await cnt('weekly_reviews'))
  check('cycle is still active after viewing', (await admin.from('planning_cycles').select('status').eq('id', cycleId).single()).data?.status === 'active')
  // On or after the cycle's last day the gate is decided by the paper; before it, the cycle is not ready.
  const onOrAfterEnd = new Date().toISOString().slice(0, 10) >= (st1.body?.state?.cycle?.endsAt ?? '9999')
  check('before the last day the gate is not_ready (on it, the paper decides)', onOrAfterEnd ? ['no_paper_allowed', 'paper_pending'].includes(st1.body?.state?.gate?.kind) : st1.body?.state?.gate?.kind === 'not_ready', JSON.stringify(st1.body?.state?.gate))
  const early = await s.post('/api/weekly-review/accept', { cycleId, resolutions: {}, previewFingerprint: st1.body?.state?.next?.fingerprint ?? 'x' })
  check('closing early is refused and changes nothing', early.status === 409 && early.body?.code === 'gate_closed' && await cnt('weekly_reviews') === 0, JSON.stringify(early.body))

  // --- fixture: move the cycle so today is its last day; place its tasks inside it; no paper
  const today = new Date().toISOString().slice(0, 10)
  // A real self-study cycle ends on Sunday: use the most recent one (today if Sunday).
  const endDay = addDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay())
  await admin.from('planning_cycles').update({ starts_at_local: addDays(endDay, -6), ends_at_local: endDay }).eq('id', cycleId)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId).eq('task_type', 'diagnostic')
  const { data: blocks } = await admin.from('plan_blocks').select('id').eq('cycle_id', cycleId).order('id')
  const ids = (blocks ?? []).map(b => b.id as string)
  await admin.from('plan_blocks').update({ local_date: addDays(endDay, -1), day: addDays(endDay, -1), execution: 'not_started' }).eq('cycle_id', cycleId)
  check('the fixture has due tasks', ids.length >= 4, `${ids.length} tasks`)

  // a scheduled repair thread attached to the closing cycle's task, to prove carryover
  const { data: cpt } = await admin.from('curriculum_concepts').select('id, manifest_id').limit(1).single()
  const th = await admin.from('repair_threads').insert({
    user_id: uid, concept_id: cpt!.id, manifest_id: cpt!.manifest_id, status: 'scheduled', latest_evidence_at: new Date().toISOString(),
  }).select('id').single()
  await admin.from('plan_blocks').update({ repair_thread_id: th.data?.id, task_type: 'repair' }).eq('id', ids[0])

  const st = (await s.json('/api/weekly-review/state')).body?.state
  check('gate allows an explicit no-paper closure when no paper exists', st?.gate?.kind === 'no_paper_allowed', JSON.stringify(st?.gate))
  check('every open due task is listed', st?.dueTasks?.length === ids.length, `${st?.dueTasks?.length}`)
  check('the preview is not empty and has a fingerprint', st?.next?.taskCount > 0 && typeof st?.next?.fingerprint === 'string')
  check('preview starts after the closing cycle ends', st?.next?.week?.startDate > endDay, st?.next?.week?.startDate)
  check('a self-study student has no unlogged class days', Array.isArray(st?.unloggedClassDays) && st.unloggedClassDays.length === 0)
  check('no hours target appears in the state', !/hours? (target|goal)/i.test(JSON.stringify(st)))
  const carry = (st?.carryover ?? []).find((c: any) => c.threadId === th.data?.id)
  check('unresolved repair is shown as carryover', !!carry)
  const previewedRepair = st?.next?.days?.flatMap((d: any) => d.items).filter((i: any) => i.taskType === 'repair').length
  check('preview plans the carried repair (closing cycle does not hide it)', previewedRepair >= 1, `${previewedRepair}`)

  const allDone = Object.fromEntries(ids.map((id, i) => [id, (['completed', 'skipped', 'deferred', 'unknown'] as const)[i % 4]]))
  const snapshot = async () => ({ blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), reviews: await cnt('weekly_reviews') })
  const s0 = await snapshot()

  const noAck = await s.post('/api/weekly-review/accept', { cycleId, resolutions: allDone, previewFingerprint: st.next.fingerprint })
  check('a no-paper closure needs explicit acknowledgement', noAck.status === 409 && noAck.body?.code === 'gate_closed', JSON.stringify(noAck.body))
  const partial = await s.post('/api/weekly-review/accept', { cycleId, resolutions: { [ids[0]]: 'completed' }, previewFingerprint: st.next.fingerprint, acknowledgeNoPaper: true })
  check('unanswered due tasks block closure', partial.status === 409 && partial.body?.code === 'unresolved_tasks', JSON.stringify(partial.body))
  const stale = await s.post('/api/weekly-review/accept', { cycleId, resolutions: allDone, previewFingerprint: 'stale', acknowledgeNoPaper: true })
  check('a changed preview must be re-confirmed', stale.status === 409 && stale.body?.code === 'preview_changed', JSON.stringify(stale.body))
  const wrong = await s.post('/api/weekly-review/accept', { cycleId: '00000000-0000-0000-0000-000000000000', resolutions: allDone, previewFingerprint: st.next.fingerprint, acknowledgeNoPaper: true })
  check('a cycle that is not the open one is refused', wrong.status === 409 && wrong.body?.code === 'wrong_cycle', JSON.stringify(wrong.body))
  const bad = await s.post('/api/weekly-review/accept', { cycleId, resolutions: { [ids[0]]: 'maybe' }, previewFingerprint: 'x' })
  check('an invalid resolution is rejected', bad.status === 400)
  check('every refusal changed nothing', JSON.stringify(await snapshot()) === JSON.stringify(s0))

  // --- the confirmation, fired concurrently: exactly one next cycle
  const burst = await Promise.all([1, 2, 3].map(() =>
    s.post('/api/weekly-review/accept', { cycleId, resolutions: allDone, previewFingerprint: st.next.fingerprint, acknowledgeNoPaper: true })))
  check('concurrent confirmations all succeed', burst.every(b => b.body?.ok === true), JSON.stringify(burst.map(b => b.body?.code ?? b.body?.ok)))
  const nextIds = new Set(burst.map(b => b.body?.nextCycleId))
  check('they resolve to a single next cycle', nextIds.size === 1)
  const nextId = [...nextIds][0] as string

  const { data: cycles } = await admin.from('planning_cycles').select('id, status, starts_at_local').eq('user_id', uid)
  check('the prior cycle is closed', cycles?.find(c => c.id === cycleId)?.status === 'closed')
  check('exactly one cycle is active, and it is the next one', cycles?.filter(c => c.status === 'active').length === 1 && cycles?.find(c => c.status === 'active')?.id === nextId)
  const { data: nextBlocks } = await admin.from('plan_blocks').select('id, title, task_type, local_date, repair_thread_id').eq('cycle_id', nextId)
  check('next week tasks match the previewed count', nextBlocks?.length === st.next.taskCount, `${nextBlocks?.length} vs ${st.next.taskCount}`)
  check('next week has no duplicate tasks', new Set((nextBlocks ?? []).map(b => `${b.local_date}|${b.title}`)).size === (nextBlocks ?? []).length)
  check('next week starts after the closed cycle ended', (nextBlocks ?? []).every(b => (b.local_date as string) > endDay))
  check('the carried repair is now a next-week task', (nextBlocks ?? []).some(b => b.repair_thread_id === th.data?.id))
  const { data: old } = await admin.from('plan_blocks').select('id, execution').eq('cycle_id', cycleId)
  check('prior cycle tasks are preserved', old?.length === ids.length)
  const exec = Object.fromEntries((old ?? []).map(b => [b.id as string, b.execution as string]))
  check('completed / skipped / deferred resolutions were applied', ids.every((id, i) => allDone[id] === 'unknown' ? exec[id] === 'not_started' : exec[id] === allDone[id]))
  const { data: review } = await admin.from('weekly_reviews').select('*').eq('cycle_id', cycleId)
  check('exactly one review row was written', review?.length === 1)
  check('unknown tasks are recorded, not silently completed', (review?.[0]?.unknown_task_ids ?? []).length === ids.filter((_, i) => i % 4 === 3).length)
  check('it records the no-paper closure', review?.[0]?.closure_kind === 'no_paper' && !!review?.[0]?.no_paper_reason)

  const replay = await s.post('/api/weekly-review/accept', { cycleId, resolutions: allDone, previewFingerprint: st.next.fingerprint, acknowledgeNoPaper: true })
  check('a later replay is idempotent', replay.body?.ok === true && replay.body?.alreadyClosed === true && replay.body?.nextCycleId === nextId, JSON.stringify(replay.body))
  check('replay created nothing', (await cnt('planning_cycles')) === (cycles?.length ?? 0) && (await cnt('weekly_reviews')) === 1)

  const cal = await (await s.req('/app/calendar')).text()
  check('Calendar renders after the loop', cal.length > 1000)
  // --- Scenario 2: the paper is scored, so closure needs no no-paper acknowledgement
  console.log('\nPaper scored path')
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  const { data: c2 } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cyc2 = c2!.id as string
  await admin.from('planning_cycles').update({ starts_at_local: addDays(endDay, -6), ends_at_local: endDay }).eq('id', cyc2)
  await admin.from('plan_blocks').delete().eq('cycle_id', cyc2).eq('task_type', 'diagnostic')
  await admin.from('plan_blocks').update({ local_date: addDays(endDay, -1), day: addDays(endDay, -1), execution: 'completed' }).eq('cycle_id', cyc2)
  const attempt = await admin.from('assessment_attempts').insert({ user_id: uid, status: 'scored', score: 50, valid_response_count: 4, correct_response_count: 2 }).select('id').single()
  check('a scored attempt fixture was created', !attempt.error, attempt.error?.message)
  const paperId = 'paper-e2e-review'
  await admin.from('plan_blocks').insert({
    id: paperId, user_id: uid, cycle_id: cyc2, title: 'Weekly diagnostic paper', detail: '', task_type: 'diagnostic', origin: 'diagnostic',
    priority: 'core', placement: 'timed', execution: 'not_started', local_date: endDay, day: endDay, starts_at: new Date().toISOString(),
    duration_minutes: 45, duration: '45', created_by: 'algorithm', attempt_id: attempt.data?.id,
    assessment_scope: { kind: 'weekly_paper', purpose: 'diagnostic', sections: [], manifestId: 'x', tiers: ['reviewed'] },
  })
  const st2 = (await s.json('/api/weekly-review/state')).body?.state
  check('a scored paper opens the gate', st2?.gate?.kind === 'paper_scored', JSON.stringify(st2?.gate))
  check('the recap shows the paper result', st2?.recap?.paper?.scored === true && st2?.recap?.paper?.correct === 2)
  check('the paper itself is not listed as a due task', !st2?.dueTasks?.some((t: any) => t.id === paperId))
  const ok2 = await s.post('/api/weekly-review/accept', { cycleId: cyc2, resolutions: {}, previewFingerprint: st2.next.fingerprint })
  check('closing with a scored paper needs no acknowledgement', ok2.body?.ok === true, JSON.stringify(ok2.body))
  const rv2 = (await admin.from('weekly_reviews').select('closure_kind').eq('cycle_id', cyc2).single()).data
  check('it is recorded as a paper-scored closure', rv2?.closure_kind === 'paper_scored')
  check('exactly one active cycle remains', (await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active')).data?.length === 1)
  await admin.from('assessment_attempts').delete().eq('id', attempt.data!.id)
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
