/**
 * Phase 5 live: the same evidence everywhere. Signals stay separate (activity never moves
 * understanding), Calendar/Tests/Curriculum/weekly review/Coach pack agree, the operating-state
 * bridge fills what Home needs, repairs land in the next accepted week exactly once, and a voided
 * question reverses its conclusions. +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-integration.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'
import { getTestsBridge } from '../src/lib/signals/operatingBridge'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function main() {
  console.log('\nCross-page integration\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)

  check('signals require authentication', (await fetch(`${E2E_BASE_URL}/api/signals`)).status === 401)
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  const today = new Date().toISOString().slice(0, 10)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const mk = (id: string, o: Record<string, unknown>) => ({
    id, user_id: uid, cycle_id: cycleId, title: id, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred',
    execution: 'completed', local_date: addDays(today, -1), day: addDays(today, -1), duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o,
  })
  await admin.from('plan_blocks').insert([
    ...['a', 'b', 'c', 'd', 'e'].map(c => mk(`it-r28${c}`, { title: `Income statement ${c}`, lm_id: 'r028', outcome_id: `r028-${c}` })),
    mk('it-post', { title: 'Balance sheet (postponed)', lm_id: 'r029', outcome_id: 'r029-a', execution: 'deferred' }),
    mk('it-toggle', { title: 'Cash flow extra', lm_id: 'r030', outcome_id: 'r030-a' }),
    mk('it-paper', { title: 'Weekly paper', task_type: 'diagnostic', origin: 'diagnostic', execution: 'not_started', local_date: addDays(today, 3), day: addDays(today, 3), lm_id: 'r028',
      assessment_scope: { kind: 'weekly_paper', purpose: 'diagnostic', manifestId: 'x', tiers: ['reviewed'], checkedAt: new Date().toISOString(), totalMinItems: 5, totalTargetItems: 8, sections: [{ purpose: 'diagnostic', moduleIds: ['r028'], minItems: 5, targetItems: 8 }] } }),
  ])
  const sig = async () => (await s.json('/api/signals')).body.signals

  // --- activity never moves understanding
  const s0 = await sig()
  check('before any test, understanding is "Insufficient evidence" with reasons', s0.understanding.band === 'Insufficient evidence' && s0.understanding.reasons.length >= 3)
  check('execution and position reflect the completed work', s0.execution.completed >= 6 && s0.execution.postponed === 1 && s0.position.exposed >= 6)
  await admin.from('plan_blocks').update({ execution: 'deferred' }).eq('id', 'it-toggle')
  const s1 = await sig()
  await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', 'it-toggle')
  const s2 = await sig()
  check('completing or postponing a block moves execution', s1.execution.postponed === 2 && s2.execution.postponed === 1 && s2.execution.completed === s1.execution.completed + 1)
  check('…and NEVER moves understanding', JSON.stringify(s0.understanding) === JSON.stringify(s1.understanding) && JSON.stringify(s1.understanding) === JSON.stringify(s2.understanding))
  check('the movement log attributes block changes to execution only', s2.movement.filter((m: any) => m.kind.startsWith('block_')).length > 0 && s2.movement.every((m: any) => !(m.kind.startsWith('block_') && /understanding\./.test(m.text) === false && /you know/i.test(m.text))))

  // --- the operating-state bridge, before the paper
  const bridge0 = await getTestsBridge(uid)
  check('the bridge offers the weekly paper as an available form', bridge0.papers.availablePapers.length === 1 && bridge0.papers.availablePapers[0].availability === 'available' && bridge0.capabilities.canTakeDiagnostic === true)
  check('it estimates the duration from the blueprint', bridge0.papers.availablePapers[0].estimatedDurationMinutes > 0)
  check('with no evidence the bridge reports no preparedness', bridge0.preparedness === null && bridge0.preparednessBand === 'Insufficient evidence')
  check('week closure is not yet possible', bridge0.capabilities.canCloseWeek === false)

  // --- Calendar shows the paper and its consequences
  const cal0 = await (await s.req('/app/calendar')).text()
  check('Calendar shows this week\'s paper and what will be tested', cal0.includes("This week&#x27;s paper") || cal0.includes("This week's paper"))
  check('Calendar says postponed work is carried forward, not tested', /postponed/i.test(cal0) && /carried to next week/i.test(cal0))

  // --- start, answer, submit
  const preview = (await s.json('/api/tests/scope')).body.preview
  const start = await s.post('/api/tests/start', { kind: 'weekly', expectedRevision: preview.scope.revision })
  check('the weekly paper starts', start.body?.ok === true)
  const attemptId = start.body.attemptId as string
  const bridge1 = await getTestsBridge(uid)
  check('once started the bridge reports an active reservation for that attempt', bridge1.papers.activeReservation?.attemptId === attemptId && bridge1.papers.availablePapers.length === 0)
  const cal1 = await (await s.req('/app/calendar')).text()
  check('Calendar then offers Resume', cal1.includes('Resume the paper'))
  const items = (await s.json(`/api/tests/attempt/${attemptId}`)).body.items as { id: string }[]
  const plan: [boolean, 'low' | 'medium' | 'high'][] = [[true, 'high'], [false, 'high'], [true, 'low'], [false, 'low'], [true, 'medium'], [false, 'high'], [true, 'high'], [false, 'medium']]
  let confidentWrong = 0, sureN = 0, sureRight = 0
  for (let i = 0; i < items.length; i++) {
    const [ok, level] = plan[i % plan.length]
    const { data: k } = await admin.from('assessment_items').select('key_index, options').eq('id', items[i].id).single()
    const pick = ok ? (k!.key_index as number) : ((k!.key_index as number) + 1) % (k!.options as string[]).length
    await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[i].id, activeSeconds: 2, interruptedSeconds: 0, visit: true })
    await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[i].id, selectedOptionIndex: pick, confidence: level, activeSeconds: 3, interruptedSeconds: 0 })
    if (level === 'high') { sureN++; if (ok) sureRight++; else confidentWrong++ }
  }
  check('the paper scores', (await s.post(`/api/tests/attempt/${attemptId}/submit`, {})).body?.ok === true)

  // --- signals after scoring
  const s3 = await sig()
  check('a scored paper moves understanding: evidence and a paper are now counted', s3.understanding.validEvents > 0 && s3.understanding.scoredPapers === 1 && s3.understanding.readingsTested >= 1)
  check('one paper is still not enough for a band, and it says so', s3.understanding.band === 'Insufficient evidence' && s3.understanding.reasons.some((r: string) => /paper/.test(r)))
  check('the movement log records the paper as moving understanding', s3.movement.some((m: any) => m.kind === 'paper_scored'))
  check('calibration matches what was answered', s3.calibration.confidentWrong === confidentWrong && Math.abs((s3.calibration.sureAccuracy ?? 0) - sureRight / sureN) < 1e-9)

  // --- everything agrees on the same evidence
  const result = (await s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
  const tracker = (await s.json('/api/curriculum/readiness')).body.tracker
  const rows = tracker.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows))
  check('signals\' tested count equals Curriculum\'s outcomes with evidence', s3.position.tested === rows.filter((r: any) => r.band !== 'untested' || r.verdict !== 'none').length)
  check('signals\' verified count equals Curriculum\'s secure outcomes', s3.position.verified === rows.filter((r: any) => r.verdict === 'secure').length)
  check('the result\'s weaknesses are the outcomes Curriculum calls concept misses or known gaps', result.swot.weaknesses.every((w: any) => ['concept_miss', 'known_gap'].includes(rows.find((r: any) => r.outcomeId === w.outcomeId)?.verdict)))
  const pack = (await s.json('/api/signals?include=coach')).body.coach
  const gaps = rows.filter((r: any) => ['concept_miss', 'known_gap'].includes(r.verdict)).map((r: any) => r.name)
  check('the Coach pack\'s repairs are drawn from those same outcomes', pack.topRepairs.length > 0 && pack.topRepairs.every((t: any) => gaps.includes(t.outcome)))
  check('the Coach pack carries the rules that stop it claiming changes or teaching', pack.rules.some((r: string) => /never claim to have changed/i.test(r)) && pack.rules.some((r: string) => /not teach/i.test(r)))
  check('the Coach pack admits what is unknown', pack.unknowns.length > 0 && pack.understanding.band === 'Insufficient evidence')
  const packText = JSON.stringify(pack)
  const { data: stems } = await admin.from('assessment_items').select('stem, key_index').eq('lm_id', 'r028').limit(5)
  check('the Coach pack contains no question text or answer keys', !/key_index|"stem"/.test(packText) && (stems ?? []).every(x => !packText.includes(String(x.stem).slice(0, 30))))
  const bridge2 = await getTestsBridge(uid)
  check('after scoring the bridge lets the week close and drops the paper form', bridge2.capabilities.canCloseWeek === true && bridge2.papers.activeReservation === null && bridge2.papers.availablePapers.length === 0)
  check('the bridge names open repair threads by concept, not by id', Object.keys(bridge2.repairNames).length > 0 && Object.values(bridge2.repairNames).every(n => n.length > 3 && !/^[0-9a-f-]{36}$/.test(n)))
  const cal2 = await (await s.req('/app/calendar')).text()
  check('Calendar now offers See result and Complete weekly closure', cal2.includes('See result') && cal2.includes('Complete weekly closure'))
  const testsHtml = await (await s.req('/app/tests')).text()
  check('the Tests tab shows all four signals with the reason for the band', ['Curriculum position', 'Demonstrated understanding', 'Plan execution', 'Confidence calibration'].every(t => testsHtml.includes(t)) && testsHtml.includes('Why these moved recently'))

  // --- repairs land in the next accepted week, once
  const review = (await s.json('/api/weekly-review/state')).body.state
  const wantRepair = review.next.days.flatMap((d: any) => d.items).filter((i: any) => i.taskType === 'repair' || i.taskType === 'recheck')
  check('the weekly review preview contains repair work from this paper', wantRepair.length > 0)
  check('the result page previews the same repair work', (result.nextWeek?.repairTasks ?? []).length === wantRepair.length)
  const threadsBefore = ((await admin.from('repair_threads').select('id').eq('user_id', uid).in('status', ['open', 'proposed', 'scheduled'])).data ?? []).length
  const acc = await s.post('/api/weekly-review/accept', { cycleId, resolutions: {}, previewFingerprint: review.next.fingerprint })
  check('the student can accept next week', acc.body?.ok === true, JSON.stringify(acc.body).slice(0, 200))
  const nextId = acc.body.nextCycleId as string
  const { data: nextBlocks } = await admin.from('plan_blocks').select('repair_thread_id, task_type, title').eq('cycle_id', nextId)
  const repairBlocks = (nextBlocks ?? []).filter(b => b.repair_thread_id)
  check('the accepted week contains the repairs', repairBlocks.length > 0 && repairBlocks.length <= threadsBefore)
  check('each repair thread appears exactly once (no duplicates)', new Set(repairBlocks.map(b => b.repair_thread_id)).size === repairBlocks.length)
  const replay = await s.post('/api/weekly-review/accept', { cycleId, resolutions: {}, previewFingerprint: review.next.fingerprint })
  check('accepting again changes nothing', replay.body?.ok === true && replay.body.alreadyClosed === true && ((await admin.from('plan_blocks').select('id').eq('cycle_id', nextId)).data ?? []).length === (nextBlocks ?? []).length)
  const tracker2 = (await s.json('/api/curriculum/readiness')).body.tracker
  const scheduled = tracker2.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows)).filter((r: any) => ['concept_miss', 'known_gap'].includes(r.verdict) && r.progress === 'scheduled')
  check('Curriculum then shows those weak outcomes as Scheduled (planned, not yet re-tested)', scheduled.length > 0, JSON.stringify(tracker2.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows)).filter((r: any) => ['concept_miss', 'known_gap'].includes(r.verdict)).map((r: any) => [r.outcomeId, r.verdict, r.band, r.progress])) + ' repairBlocks=' + JSON.stringify(repairBlocks))

  // --- a voided question reverses its conclusions
  const target = result.swot.weaknesses[0]
  if (target) {
    const { data: concepts } = await admin.from('concept_outcome_map').select('concept_id').eq('outcome_id', target.outcomeId)
    const cids = (concepts ?? []).map(c => c.concept_id as string)
    const validBefore = (await sig()).understanding.validEvents
    const { data: evs } = await admin.from('evidence_events').select('id').eq('user_id', uid).eq('attempt_id', attemptId).in('concept_id', cids)
    await admin.from('evidence_events').update({ validity: 'voided', validity_reason: 'e2e: item invalidated' }).in('id', (evs ?? []).map(e => e.id))
    const after = await sig()
    check('voiding removes that evidence from the sample', after.understanding.validEvents === validBefore - (evs ?? []).length)
    const rowAfter = (await s.json('/api/curriculum/readiness')).body.tracker.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows)).find((r: any) => r.outcomeId === target.outcomeId)
    check('the outcome no longer reads as a weakness', !['concept_miss', 'known_gap'].includes(rowAfter.verdict), rowAfter.verdict)
    const resultAfter = (await s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
    check('the result\'s SWOT and repair list drop it too', !resultAfter.swot.weaknesses.some((w: any) => w.outcomeId === target.outcomeId) && !resultAfter.repairs.some((x: any) => x.outcomeId === target.outcomeId))
    check('the movement log records the reversal', after.movement.some((m: any) => m.kind === 'evidence_voided'))
    check('voided evidence is reported on the result as not counted', resultAfter.integrity.voidedOrDisputed >= (evs ?? []).length)
  }

  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)
  await admin.from('plan_blocks').delete().eq('user_id', uid).like('id', 'it-%')
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
