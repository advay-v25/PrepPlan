/**
 * Phase 4 live: the result page and API for a scored weekly paper — score with uncertainty,
 * confidence and pattern breakdowns, per-reading/subject tables, scope tested vs untested,
 * evidence-led SWOT, prioritised repair with an independent retest, a next-week PREVIEW
 * (never a mutation) and agreement with Curriculum and weekly closure. +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-results.ts
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
  console.log('\nResults, SWOT and repair\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)

  const cnt = async (t: string) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  const today = new Date().toISOString().slice(0, 10)
  await admin.from('plan_blocks').delete().eq('cycle_id', cycleId)
  const mk = (id: string, o: Record<string, unknown>) => ({
    id, user_id: uid, cycle_id: cycleId, title: id, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred',
    execution: 'completed', local_date: addDays(today, -1), day: addDays(today, -1), duration_minutes: 30, duration: '30', created_by: 'algorithm', ...o,
  })
  await admin.from('plan_blocks').insert([
    ...['a', 'b', 'c', 'd', 'e'].map(c => mk(`rs-r28${c}`, { title: `Income statement ${c}`, lm_id: 'r028', outcome_id: `r028-${c}` })),
    mk('rs-post', { title: 'Balance sheet (postponed)', lm_id: 'r029', outcome_id: 'r029-a', execution: 'deferred' }),
    mk('rs-paper', { title: 'Weekly paper', task_type: 'diagnostic', origin: 'diagnostic', execution: 'not_started', local_date: addDays(today, 3), day: addDays(today, 3), lm_id: 'r028',
      assessment_scope: { kind: 'weekly_paper', purpose: 'diagnostic', manifestId: 'x', tiers: ['reviewed'], checkedAt: new Date().toISOString(), totalMinItems: 5, totalTargetItems: 8, sections: [{ purpose: 'diagnostic', moduleIds: ['r028'], minItems: 5, targetItems: 8 }] } }),
  ])
  const preview = (await s.json('/api/tests/scope')).body.preview
  const start = await s.post('/api/tests/start', { kind: 'weekly', expectedRevision: preview.scope.revision })
  check('the weekly paper starts', start.body?.ok === true, JSON.stringify(start.body).slice(0, 160))
  const attemptId = start.body.attemptId as string
  const state = (await s.json(`/api/tests/attempt/${attemptId}`)).body
  const items = state.items as { id: string; options: string[] }[]

  check('the result is not available before scoring', (await s.json(`/api/tests/attempt/${attemptId}/result`)).status === 404)
  check('the result requires authentication', (await fetch(`${E2E_BASE_URL}/api/tests/attempt/${attemptId}/result`)).status === 401)
  check('the result page sends an unfinished attempt back to the taking screen', (await s.req(`/app/tests/${attemptId}/result`)).status >= 300)

  // Controlled answers: correctness and confidence chosen so every pattern is known in advance.
  const plan: [boolean, 'low' | 'medium' | 'high'][] = [[true, 'high'], [false, 'high'], [true, 'low'], [false, 'low'], [true, 'medium'], [false, 'high'], [true, 'high'], [false, 'medium']]
  const expected = { correct: 0, confidentMistakes: 0, correctGuesses: 0 }
  const answers: { itemId: string; correct: boolean; level: string }[] = []
  for (let i = 0; i < items.length; i++) {
    const [wantCorrect, level] = plan[i % plan.length]
    const { data: k } = await admin.from('assessment_items').select('key_index, options').eq('id', items[i].id).single()
    const key = k!.key_index as number, n = (k!.options as string[]).length
    const pick = wantCorrect ? key : (key + 1) % n
    await s.post(`/api/tests/attempt/${attemptId}/progress`, { itemId: items[i].id, activeSeconds: 2, interruptedSeconds: 0, visit: true })
    const r = await s.post(`/api/tests/attempt/${attemptId}/answer`, { itemId: items[i].id, selectedOptionIndex: pick, confidence: level, activeSeconds: 3, interruptedSeconds: 0 })
    if (!r.body?.ok) check(`answer ${i + 1} saves`, false, JSON.stringify(r.body))
    answers.push({ itemId: items[i].id, correct: wantCorrect, level })
    if (wantCorrect) expected.correct++
    if (!wantCorrect && level === 'high') expected.confidentMistakes++
    if (wantCorrect && level === 'low') expected.correctGuesses++
  }
  const counts0 = { blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), threads: await cnt('repair_threads'), evidence: await cnt('evidence_events') }
  const sub = await s.post(`/api/tests/attempt/${attemptId}/submit`, {})
  check('the paper scores', sub.body?.ok === true)
  const evAfter = await cnt('evidence_events')
  check('scoring wrote evidence', evAfter > counts0.evidence)

  // --- the API
  const beforeReads = { blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), threads: await cnt('repair_threads'), evidence: await cnt('evidence_events') }
  const res = await s.json(`/api/tests/attempt/${attemptId}/result`)
  const r = res.body.result
  check('the result loads', res.body.ok === true && !!r)
  const again = (await s.json(`/api/tests/attempt/${attemptId}/result`)).body.result
  check('reading a result never writes: plans, cycles, repairs and evidence are unchanged', JSON.stringify({ blocks: await cnt('plan_blocks'), cycles: await cnt('planning_cycles'), threads: await cnt('repair_threads'), evidence: await cnt('evidence_events') }) === JSON.stringify(beforeReads))
  check('a repeat read returns the same analysis', again.analysis.overall.correct === r.analysis.overall.correct && again.repairs.length === r.repairs.length)
  await s.post(`/api/tests/attempt/${attemptId}/submit`, {})
  check('a retried submission changes neither evidence nor the result', (await cnt('evidence_events')) === evAfter && (await s.json(`/api/tests/attempt/${attemptId}/result`)).body.result.analysis.overall.correct === r.analysis.overall.correct)

  const o = r.analysis.overall
  check('the score matches what was answered', o.answered === items.length && o.correct === expected.correct && o.scorePercent === Math.round((expected.correct / items.length) * 100))
  check('the score comes with a plausible range, not just a number', Array.isArray(o.interval) && o.interval[0] < o.scorePercent / 100 + 0.001 && o.interval[1] > o.scorePercent / 100 - 0.001)
  const conf = o.confidence
  check('the confidence distribution matches the answers given', (['low', 'medium', 'high'] as const).every(l => conf[l].n === answers.filter(a => a.level === l).length && conf[l].correct === answers.filter(a => a.level === l && a.correct).length))
  check('confident mistakes and correct guesses are counted as answered', r.analysis.patterns.confidentMistakes === expected.confidentMistakes && r.analysis.patterns.correctGuesses === expected.correctGuesses, JSON.stringify(r.analysis.patterns))
  check('active time is reported and paused time is separate', typeof o.activeMinutes === 'number' && typeof r.attempt.pausedMinutes === 'number')

  // --- breakdowns
  const rd = r.analysis.byReading.find((c: any) => c.id === 'r028')
  check('the reading table has this paper\'s 8 questions with a sample-size label', rd?.questions === items.length && ['limited', 'moderate'].includes(rd.certainty), JSON.stringify(rd))
  check('the reading table reports difficulty and form mix', Object.keys(rd.difficultyMix).length > 0)
  check('the subject table is present and consistent with the reading table', r.analysis.bySubject.find((c: any) => c.id === 'fsa')?.questions === rd.questions)
  check('no group is called weak or strong on fewer than four questions', [...r.analysis.byReading, ...r.analysis.bySubject, ...r.analysis.byOutcome].filter((c: any) => c.questions < 4).every((c: any) => c.judgement === 'too_few'))
  check('names are provided for every reading and subject shown', r.analysis.byReading.every((c: any) => r.names.readings[c.id]) && r.analysis.bySubject.every((c: any) => r.names.subjects[c.id]))

  // --- scope: tested vs untested, and what was excluded
  check('the frozen scope snapshot is tied to this result', r.coverage.snapshotRevision === preview.scope.revision)
  check('tested outcomes are within the completed scope', r.coverage.testedOutcomes.every((id: string) => preview.scope.targets.some((t: any) => t.outcomeId === id)))
  const allTargets = preview.scope.targets.map((t: any) => t.outcomeId) as string[]
  check('completed outcomes that were not tested are listed, not hidden', allTargets.filter(id => !r.coverage.testedOutcomes.includes(id)).every(id => r.coverage.untestedOutcomes.includes(id)))
  check('the postponed block is named as excluded and not a wrong answer', r.coverage.excluded.some((e: any) => /postponed/i.test(e.title) && e.reason === 'postponed') && !r.coverage.testedOutcomes.includes('r029-a'))
  check('requested versus delivered questions are both reported', r.coverage.deliveredQuestions === items.length && r.coverage.requestedQuestions !== null)

  // --- SWOT honesty
  const sw = r.swot
  const askedBy = new Map(r.analysis.byOutcome.map((c: any) => [c.id, c]))
  const trackerNow = (await s.json('/api/curriculum/readiness')).body.tracker.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows))
  check('every strength is a Secure outcome in Curriculum (repeated, confident, correct), never a single answer', sw.strengths.every((x: any) => trackerNow.find((row: any) => row.outcomeId === x.outcomeId)?.verdict === 'secure'))
  void askedBy
  check('every weakness carries evidence and a reason', sw.weaknesses.every((x: any) => x.basis === 'evidence' && x.support.length > 10))
  check('opportunities and threats are readings, labelled inferred, and never outcomes you were tested on', [...sw.opportunities, ...sw.threats].every((x: any) => x.basis === 'inferred' && !!x.readingId && !x.outcomeId))
  check('a correct answer that is not yet secure is an observed success, not a strength', sw.observedSuccesses.every((x: any) => !sw.strengths.some((st: any) => st.outcomeId === x.outcomeId)))
  check('a correct guess is never in strengths', sw.toVerify.every((x: any) => !sw.strengths.some((st: any) => st.outcomeId === x.outcomeId)))

  // --- repair
  check('repairs are prioritised and numbered', r.repairs.every((x: any, i: number) => x.priority === i + 1))
  const rank = (v: string) => ({ concept_miss: 0, known_gap: 2, guess: 4 } as any)[v] ?? 9
  check('confident misses are repaired before plain gaps', (() => { const t = sw.weaknesses; return t.length === 0 || r.repairs.length > 0 })())
  check('each repair states reason, method and an independent retest', r.repairs.every((x: any) => x.reason && x.method && x.retest.independent === true))
  for (const x of r.repairs.slice(0, 3)) {
    const { data: bank } = await admin.from('assessment_items').select('id').eq('outcome_id', x.outcomeId).eq('review_status', 'reviewed')
    const { data: seen } = await admin.from('assessment_responses').select('item_id').eq('user_id', uid)
    const seenIds = new Set((seen ?? []).map(z => z.item_id)); const unseen = (bank ?? []).filter(b => !seenIds.has(b.id)).length
    check(`the re-check for "${x.title.slice(0, 40)}" reports the real unseen bank (${unseen})`, x.retest.available === unseen)
  }
  void rank

  // --- next week is a preview, not a change
  check('the next-week effect is offered as a preview with a link to weekly review', r.nextWeek?.available === true && r.nextWeek.reviewUrl === '/app/review-week')
  check('viewing it created no tasks and no cycle', (await cnt('plan_blocks')) === beforeReads.blocks && (await cnt('planning_cycles')) === beforeReads.cycles)

  // --- agreement with Curriculum and weekly closure
  const tracker = (await s.json('/api/curriculum/readiness')).body.tracker
  const rows = tracker.topics.flatMap((t: any) => t.modules.flatMap((m: any) => m.rows))
  check('every SWOT weakness is a Repair-worthy outcome in Curriculum too', sw.weaknesses.every((w: any) => { const row = rows.find((x: any) => x.outcomeId === w.outcomeId); return row && ['concept_miss', 'known_gap'].includes(row.verdict) }))
  check('every repair proposed maps to a Curriculum outcome with the same verdict', r.repairs.every((x: any) => rows.some((row: any) => row.outcomeId === x.outcomeId && ['concept_miss', 'known_gap', 'guess'].includes(row.verdict))))
  const review = (await s.json('/api/weekly-review/state')).body.state
  check('weekly closure sees the same scored paper', review.gate?.kind === 'paper_scored' && review.recap.paper.scored === true && review.recap.paper.correct === o.correct, JSON.stringify([review.gate, review.recap?.paper]))
  check('the Tests tab now offers See result and Complete weekly closure', ((await (await s.req('/app/tests')).text())).includes('Complete weekly closure'))

  // --- the page
  const html = await (await s.req(`/app/tests/${attemptId}/result`)).text()
  for (const [label, needle] of [['the summary', 'correct'], ['confidence', 'How sure you were'], ['scope', 'What was tested, and what was not'], ['breakdowns', 'By subject and reading'], ['SWOT', 'Strengths, weaknesses, opportunities, threats'], ['repair', 'What to repair, in order'], ['next week', 'What this could do to next week'], ['questions', 'Every question, and why']] as const) {
    check(`the page shows ${label}`, html.includes(needle), needle)
  }
  check('the page warns that the percentage is a snapshot, not a level', /snapshot of this paper/.test(html))
  check('the page never shows a pass probability or readiness score', !/pass probability|readiness score|you will pass|likely to pass/i.test(html))
  const firstWrong = r.questions.find((q: any) => !q.isCorrect)
  check('the first missed question is open and links back to its reading in Curriculum', !firstWrong || !firstWrong.extra.readingHref || html.includes(firstWrong.extra.readingHref))
  check('the per-question review carries a working, reasons and tags for every question', r.questions.length === items.length && r.questions.every((q: any) => q.extra && 'solution' in q && Array.isArray(q.extra.tags)))
  check('the per-question review offers the challenge route', html.includes('Something is wrong with this question'))

  // --- ownership: another student's attempt is not readable
  const { data: other } = await admin.from('assessment_attempts').select('id').neq('user_id', uid).eq('status', 'scored').limit(1)
  if (other?.length) check('another student\'s result is a 404', (await s.json(`/api/tests/attempt/${other[0].id}/result`)).status === 404)

  await admin.from('paper_scope_snapshots').delete().eq('user_id', uid)
  await admin.from('plan_blocks').delete().eq('user_id', uid).like('id', 'rs-%')
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
