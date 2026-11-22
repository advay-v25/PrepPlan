import { createAdminClient } from '../supabase/admin'
import { isEvidenceGrade } from '../diagnostic/itemState'
import { loadEligibleItemPool } from './itemPool'
import { decideAssessment } from './assessmentDecision'
import { studyGuidance } from '../study/guidance'
import { ERROR_TAXONOMY, type ErrorCode } from '../diagnostic/types'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getWeeklyReviewState } from '../planning/weeklyReview/service'
import { toLevel, outcomeVerdict } from '../curriculum/confidence'
import { buildLedger, type Ledger } from './scoreLedger'
import { analyseAttempt, buildFindings, buildSwot, chooseNextAction, prioritiseRepairs, type Analysis, type Finding, type NextAction, type ItemMeta, type OutcomeStatus, type ReadingEdge, type RepairItem, type RespRow, type Swot } from './resultAnalysis'

/**
 * Everything the result page and /api/tests/attempt/[id]/result show, built from one read.
 * Read-only: opening a result never mutates a plan, an evidence row or a repair thread.
 */

export type ResultQuestion = {
  itemId: string; seq: number; stem: string; options: string[]; keyIndex: number | null; selectedIndex: number | null; isCorrect: boolean
  confidence: number | null; perOptionFeedback: Record<string, string>; solution: string | null; conceptName: string | null
  errorCode: string | null; errorLabel: string | null; errorDescription: string | null; unreviewed: boolean; challenged: boolean
  /** Never answered: no selection and no confidence exist, and nothing is assumed about why. */
  omitted: boolean; flagged: boolean
  /** pending = under review, still counted; upheld = set aside and the score adjusted; dismissed = kept. */
  challengeStatus: 'pending' | 'upheld' | 'dismissed' | null
  extra: { outcomeId: string | null; readingLabel: string | null; readingHref: string | null; outcomeTitle: string | null; difficulty: string | null; form: string | null; timing: string; pattern: string | null; tags: string[]; activeSeconds: number | null }
}

export type AttemptResult = {
  attempt: { id: string; kind: string | null; paperKind: string | null; startedAt: string | null; submittedAt: string | null; pausedMinutes: number; timed: boolean }
  analysis: Omit<Analysis, 'tagged'>
  /** The scoring ledger over delivered items, under the policy the form was reserved with. The headline score comes from here. */
  ledger: Ledger
  integrity: { voidedOrDisputed: number; challenges: number; unmappedQuestions: number }
  /** Findings by pattern, each with its support, and the single most useful next step. */
  findings: Finding[]
  nextAction: NextAction
  /** Questions with no answer (omitted), and questions whose evidence is disputed, voided or under challenge. Neither counts as a wrong answer. */
  omitted: { seq: number; itemId: string; outcomeId: string | null; outcomeTitle: string | null }[]
  invalidated: { itemId: string; seq: number; why: 'disputed' | 'voided' | 'challenged' }[]
  /** Which eligibility rule the paper was reserved under; null = reserved before the approved-version rule. */
  eligibilityPolicy: string | null
  /** A further paper from confirmed scope this one left pending. */
  pendingScope: number
  coverage: {
    requestedQuestions: number | null; deliveredQuestions: number
    shortfalls: { readingId: string; wanted: number; delivered: number }[]
    testedOutcomes: string[]; untestedOutcomes: string[]
    excluded: { title: string; reason: string }[]; snapshotRevision: string | null
  }
  names: { readings: Record<string, string>; subjects: Record<string, string>; outcomes: Record<string, string> }
  subjectOfReading: Record<string, string>
  swot: Swot
  /** The result revision these findings describe (an authorised challenge adjustment raises it) and when it was last adjusted. */
  revision: { number: number; adjustedAt: string | null }
  /** Cumulative Curriculum status for the tested outcomes, read now. Later papers update THIS, never the findings above. */
  currentStatus: { available: boolean; asOf: string; rows: { outcomeId: string; readingId: string; title: string; band: string; verdict: string }[] }
  repairs: RepairItem[]
  nextWeek: { available: boolean; weekStart: string | null; weekEnd: string | null; repairTasks: { date: string; title: string; minutes: number }[]; reviewUrl: string } | null
  previous: { id: string; kind: string | null; answered: number; correct: number; questions: number; startedAt: string | null }[]
  questions: ResultQuestion[]
}


export class ResultUnavailable extends Error { constructor(m: string) { super(m); this.name = 'ResultUnavailable' } }

export async function getAttemptResult(userId: string, attemptId: string, now = new Date()): Promise<AttemptResult | null> {
  const admin = createAdminClient()
  const { data: attempt } = await admin.from('assessment_attempts')
    .select('id, status, attempt_kind, paper_kind, started_at, submitted_at, paused_seconds, deadline_at, requested_blueprint, delivered_coverage, form_id, eligibility_policy, scoring_policy_version, result_revision, rescored_at, completed_at')
    .eq('id', attemptId).eq('user_id', userId).maybeSingle()
  if (!attempt || attempt.status !== 'scored') return null

  const [{ data: resp, error: respErr }, { data: formItems, error: formErr }, { data: challenges, error: chErr }, { data: snap }] = await Promise.all([
    admin.from('assessment_responses').select('item_id, selected_option_index, is_correct, self_reported_confidence, flagged, active_seconds, interrupted_seconds, elapsed_seconds, changed_count').eq('attempt_id', attemptId).eq('user_id', userId),
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id),
    admin.from('item_challenges').select('item_id, status').eq('user_id', userId).eq('attempt_id', attemptId),
    admin.from('paper_scope_snapshots').select('revision, scope').eq('attempt_id', attemptId).eq('user_id', userId).maybeSingle(),
  ])
  // A voided answer (an upheld challenge) leaves the analysis, score and findings; it is listed under "not counted". A disputed one stays, marked as under review.
  // A failed read is UNAVAILABLE, never an empty paper that would score as zero.
  if (respErr || formErr || chErr) throw new ResultUnavailable(respErr?.message ?? formErr?.message ?? chErr?.message ?? 'read failed')
  // Validity comes from the challenge record, not from an evidence row: practice papers and omitted items have none.
  const voidedNow = new Set((challenges ?? []).filter(c => c.status === 'resolved_voided').map(c => c.item_id as string))
  const pendingNow = new Set((challenges ?? []).filter(c => c.status === 'pending').map(c => c.item_id as string))
  const allResponded = new Set((resp ?? []).map(r => r.item_id as string))
  const responses = (resp ?? []).filter(r => !voidedNow.has(r.item_id as string))
  const itemIds = responses.map(r => r.item_id as string)
  const seqOf = new Map((formItems ?? []).map(f => [f.item_id as string, f.sequence_number as number]))

  const [{ data: items }, { data: readings }, { data: topics }, { data: outcomeRows }] = await Promise.all([
    itemIds.length ? admin.from('assessment_items').select('id, stem, options, per_option_feedback, key_index, item_card, review_status, lm_id, outcome_id, concept_id, intended_difficulty, item_form, cognition, concept:curriculum_concepts ( name )').in('id', itemIds) : Promise.resolve({ data: [] as any[] }),
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title'),
    admin.from('topics').select('id, name'),
    admin.from('reading_los').select('id, reading_id, title'),
  ])
  const itemById = new Map((items ?? []).map(i => [i.id as string, i]))
  const readingById = new Map((readings ?? []).map(r => [r.id as string, r]))
  const outcomeTitle = new Map((outcomeRows ?? []).map(o => [o.id as string, o.title as string]))

  const meta = new Map<string, ItemMeta>()
  const rows: RespRow[] = []
  for (const r of responses) {
    const it: any = itemById.get(r.item_id as string)
    const card = (it?.item_card ?? {}) as any
    const diag = r.is_correct === false ? (card.distractorDiagnoses ?? []).find((d: any) => d.optionIndex === r.selected_option_index) : null
    const reading = it?.lm_id ? readingById.get(it.lm_id as string) : null
    meta.set(r.item_id as string, {
      readingId: (reading?.id ?? null) as string | null, subjectId: (reading?.topic_id ?? null) as string | null, outcomeId: (it?.outcome_id ?? null) as string | null,
      conceptId: (it?.concept_id ?? null) as string | null, conceptName: (it?.concept?.name ?? null) as string | null,
      difficulty: (it?.intended_difficulty ?? null) as string | null, form: (it?.item_form ?? null) as string | null, cognition: (it?.cognition ?? null) as string | null,
      errorCode: (diag?.errorCode ?? null) as string | null,
    })
    rows.push({
      itemId: r.item_id as string, correct: r.is_correct === true, level: toLevel(r.self_reported_confidence as number | null),
      activeSeconds: (r.active_seconds ?? r.elapsed_seconds ?? null) as number | null, interruptedSeconds: (r.interrupted_seconds ?? 0) as number,
      changedCount: (r.changed_count ?? 0) as number, flagged: Boolean(r.flagged),
    })
  }
  const analysis = analyseAttempt(rows, meta)

  // WHAT THIS PAPER SHOWED: each outcome's verdict comes from this paper's own valid observations (the installed outcomeVerdict policy,
  // thresholds unchanged), as of when it was finished. A later paper cannot rewrite it; a challenge changes it only through the revision.
  const paperAt = ((attempt.completed_at ?? attempt.submitted_at ?? new Date().toISOString()) as string)
  const obsByOutcome = new Map<string, { correct: boolean; level: ReturnType<typeof toLevel>; at: string }[]>()
  // All of a paper's observations share one timestamp, so which three are "recent" needs a tie-break. Curriculum breaks it by evidence-event id; so do we,
  // which keeps a single paper reading the same here and there. Items with no event (practice, unmapped) follow in question order.
  const { data: evIds, error: evErr } = await admin.from('evidence_events').select('item_id, id').eq('attempt_id', attemptId).eq('user_id', userId)
  if (evErr) throw new ResultUnavailable(evErr.message)
  const evIdOf = new Map((evIds ?? []).map(e => [e.item_id as string, String(e.id)]))
  const ordered = [...rows].sort((a, b) => (evIdOf.get(a.itemId) ?? `~${String(seqOf.get(a.itemId) ?? 0).padStart(6, '0')}`).localeCompare(evIdOf.get(b.itemId) ?? `~${String(seqOf.get(b.itemId) ?? 0).padStart(6, '0')}`))
  for (const r of ordered) { const oc = meta.get(r.itemId)?.outcomeId; if (oc) obsByOutcome.set(oc, [...(obsByOutcome.get(oc) ?? []), { correct: r.correct, level: r.level, at: paperAt }]) }
  const outcomeCell = new Map(analysis.byOutcome.map(c => [c.id, c]))
  const outcomes: OutcomeStatus[] = analysis.byOutcome.map(c => {
    const rd = readingOfOutcome(c.id, outcomeRows ?? [])
    return { outcomeId: c.id, readingId: rd, subjectId: readingById.get(rd)?.topic_id as string ?? '',
      title: outcomeTitle.get(c.id) ?? c.id, verdict: outcomeVerdict(obsByOutcome.get(c.id) ?? [], new Date(paperAt)).verdict, band: 'paper', correctHere: c.correct, askedHere: c.questions }
  })

  // WHERE THINGS STAND NOW: the cumulative Curriculum view, labelled with when it was read. Unavailable is not empty.
  let currentStatus: AttemptResult['currentStatus'] = { available: false, asOf: now.toISOString(), rows: [] }
  try {
    const tracker = await getLosTracker(userId, now)
    const trackerRow = new Map(tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows)).map(r => [r.outcomeId, r]))
    currentStatus = { available: true, asOf: now.toISOString(), rows: outcomes.map(o => { const tr = trackerRow.get(o.outcomeId); return { outcomeId: o.outcomeId, readingId: o.readingId, title: o.title, band: (tr?.band ?? 'untested') as string, verdict: (tr?.verdict ?? 'none') as string } }) }
  } catch { /* leave it unavailable */ }

  // Relationships between readings. Only a link with a written rationale is a verified curriculum relationship; reading order alone is navigation.
  const readingIds = [...readingById.keys()]
  const { data: edgeRows } = await admin.from('lm_edges').select('from_lm, to_lm, kind, rationale').in('from_lm', readingIds).in('to_lm', readingIds)
  const edges: ReadingEdge[] = (edgeRows ?? []).map(e => ({
    from: e.from_lm as string, to: e.to_lm as string, kind: e.kind as ReadingEdge['kind'],
    basis: String(e.rationale ?? '').trim() ? 'concept_link' : 'sequence', rationale: (e.rationale ?? null) as string | null,
  }))
  const rname = (id: string) => { const r = readingById.get(id); return r ? `Reading ${r.reading_no}: ${r.title}` : id }
  const swot = buildSwot({ outcomes, edges, readingName: rname })

  // Repair proposal, with real bank availability for an independent retest.
  const repeatedOutcomes = new Set(analysis.tagged.filter(t => t.tags.includes('repeated_misconception')).map(t => t.outcomeId).filter(Boolean) as string[])
  const cands = outcomes.filter(o => ['concept_miss', 'known_gap', 'guess'].includes(o.verdict))
  // Fresh retest availability comes from the same pool every other surface uses (approved exact version, unseen item and family).
  const pool = cands.length ? await loadEligibleItemPool(userId, [...new Set(cands.map(c => c.readingId))]) : []
  const unseenBy = new Map<string, number>()
  for (const b of pool) if (b.outcome_id) unseenBy.set(b.outcome_id, (unseenBy.get(b.outcome_id) ?? 0) + 1)
  const repairs = prioritiseRepairs(cands.map(c => ({ outcomeId: c.outcomeId, readingId: c.readingId, title: c.title, verdict: c.verdict, repeated: repeatedOutcomes.has(c.outcomeId), unseenAvailable: unseenBy.get(c.outcomeId) ?? 0 })))

  // What the next week would gain — a preview only; acceptance stays in weekly review.
  let nextWeek: AttemptResult['nextWeek'] = null
  try {
    const review = await getWeeklyReviewState(userId, now)
    nextWeek = review.status === 'active'
      ? { available: true, weekStart: review.next.week.startDate, weekEnd: review.next.week.endDate, reviewUrl: '/app/review-week',
          repairTasks: review.next.days.flatMap(d => d.items.filter(i => i.taskType === 'repair' || i.taskType === 'recheck').map(i => ({ date: d.date, title: i.title, minutes: i.minutes }))) }
      : { available: false, weekStart: null, weekEnd: null, repairTasks: [], reviewUrl: '/app/calendar' }
  } catch { nextWeek = null }

  // Scope: what the frozen snapshot said versus what this paper actually tested.
  const scope = (snap?.scope ?? null) as any
  const tested = analysis.byOutcome.map(c => c.id)
  const snapshotTargets: string[] = (scope?.targets ?? []).map((t: any) => t.outcomeId)
  const bp = (attempt.requested_blueprint ?? null) as any, dc = (attempt.delivered_coverage ?? null) as any
  const coverage: AttemptResult['coverage'] = {
    requestedQuestions: (bp?.totalQuestions ?? null) as number | null, deliveredQuestions: (dc?.delivered ?? responses.length) as number, shortfalls: (dc?.shortfalls ?? []) as any[],
    testedOutcomes: tested, untestedOutcomes: snapshotTargets.filter(id => !tested.includes(id)), snapshotRevision: (snap?.revision ?? null) as string | null,
    excluded: ((scope?.excluded ?? []) as any[]).map(e => ({ title: e.title, reason: e.reason })),
  }

  // Earlier papers of the same kind, for context only — raw percentages from different forms are not comparable.
  const { data: prev } = await admin.from('assessment_attempts').select('id, attempt_kind, started_at, valid_response_count, correct_response_count')
    .eq('user_id', userId).eq('status', 'scored').neq('id', attemptId).eq('attempt_kind', attempt.attempt_kind ?? '__none__').order('started_at', { ascending: false }).limit(3)

  const challenged = new Set((challenges ?? []).map(c => c.item_id as string))
  const challengeStatusOf = (id: string): ResultQuestion['challengeStatus'] => { const c = (challenges ?? []).find(x => x.item_id === id); return c ? (c.status === 'resolved_voided' ? 'upheld' : c.status === 'resolved_kept' ? 'dismissed' : 'pending') : null }
  const { data: progressRows, error: progErr } = await admin.from('attempt_item_progress').select('item_id, flagged').eq('attempt_id', attemptId).eq('user_id', userId)
  if (progErr) throw new ResultUnavailable(progErr.message)
  const flaggedIds = new Set((progressRows ?? []).filter(p => p.flagged).map(p => p.item_id as string))
  const questions: ResultQuestion[] = analysis.tagged.map(t => {
    const it: any = itemById.get(t.itemId)
    const card = (it?.item_card ?? {}) as any
    const r = responses.find(x => x.item_id === t.itemId)!
    const errCode = t.errorCode as ErrorCode | null
    const diag = !t.correct ? (card.distractorDiagnoses ?? []).find((d: any) => d.optionIndex === r.selected_option_index) : null
    const reading = t.readingId ? readingById.get(t.readingId) : null
    return {
      itemId: t.itemId, seq: seqOf.get(t.itemId) ?? 0, stem: it?.stem ?? '(this question is no longer available)', options: (it?.options ?? []) as string[],
      keyIndex: (it?.key_index ?? null) as number | null, selectedIndex: (r.selected_option_index ?? null) as number | null, isCorrect: t.correct,
      confidence: (r.self_reported_confidence ?? null) as number | null, perOptionFeedback: (it?.per_option_feedback ?? {}) as Record<string, string>,
      solution: (card.solution ?? null) as string | null, conceptName: t.conceptName, errorCode: errCode, errorLabel: errCode ? ERROR_TAXONOMY[errCode] ?? null : null,
      errorDescription: (diag?.description ?? null) as string | null, unreviewed: !isEvidenceGrade(it?.review_status), challenged: challenged.has(t.itemId), omitted: false, flagged: flaggedIds.has(t.itemId), challengeStatus: challengeStatusOf(t.itemId),
      extra: {
        outcomeId: t.outcomeId ?? null,
        readingLabel: reading ? `Reading ${reading.reading_no}: ${reading.title}` : null, readingHref: reading ? `/app/curriculum/${reading.topic_id}/${reading.id}${t.outcomeId ? `?los=${encodeURIComponent(t.outcomeId)}` : ''}` : null,
        outcomeTitle: t.outcomeId ? outcomeTitle.get(t.outcomeId) ?? null : null, difficulty: t.difficulty, form: t.form ?? t.cognition,
        timing: t.timing, pattern: t.reading, tags: t.tags, activeSeconds: t.activeSeconds,
      },
    }
  }).sort((a, b) => a.seq - b.seq)

  // Omitted questions: on the paper, never answered. No confidence exists for them and no cause is assumed.
  const answeredIds = allResponded
  const omittedIds = (formItems ?? []).filter(f => !answeredIds.has(f.item_id as string)).map(f => ({ itemId: f.item_id as string, seq: f.sequence_number as number }))
  const { data: omittedItems } = omittedIds.length ? await admin.from('assessment_items').select('id, stem, options, per_option_feedback, key_index, item_card, review_status, lm_id, outcome_id, concept_id, intended_difficulty, item_form, cognition, concept:curriculum_concepts ( name )').in('id', omittedIds.map(o => o.itemId)) : { data: [] as any[] }
  const omittedOutcome = new Map((omittedItems ?? []).map(i => [i.id as string, (i.outcome_id ?? null) as string | null]))
  const omitted = omittedIds.sort((a, b) => a.seq - b.seq).map(o => ({ ...o, outcomeId: omittedOutcome.get(o.itemId) ?? null, outcomeTitle: omittedOutcome.get(o.itemId) ? outcomeTitle.get(omittedOutcome.get(o.itemId)!) ?? null : null }))
  const disputed = pendingNow
  const voided = voidedNow
  const invalidated = [...new Set([...disputed, ...voided, ...(challenges ?? []).map(c => c.item_id as string)])].map(id => ({ itemId: id, seq: seqOf.get(id) ?? 0, why: (voided.has(id) ? 'voided' : disputed.has(id) ? 'disputed' : 'challenged') as 'voided' | 'disputed' | 'challenged' })).sort((a, b) => a.seq - b.seq)
  const distractorOf = (itemId: string) => {
    const t = analysis.tagged.find(x => x.itemId === itemId); const q = itemById.get(itemId) as any
    if (!t || t.correct || !q) return null
    const r = responses.find(x => x.item_id === itemId); const diag = ((q.item_card ?? {}).distractorDiagnoses ?? []).find((d: any) => d.optionIndex === r?.selected_option_index)
    return { label: t.errorCode ? ERROR_TAXONOMY[t.errorCode as ErrorCode] ?? null : null, description: (diag?.description ?? null) as string | null }
  }
  const findings = buildFindings({ tagged: analysis.tagged, distractor: distractorOf, outcomeTitle: id => outcomeTitle.get(id) ?? id, omitted })
  // A timing finding may offer timed practice on its reading, only as far as the shared decision allows it right now.
  const timing = findings.find(f => f.kind === 'timing')
  if (timing && attempt.attempt_kind !== 'practice') {
    const slowReading = [...new Map(analysis.tagged.filter(t => t.tags.includes('slow_correct') && t.readingId).map(t => [t.readingId!, 0])).keys()][0]
    if (slowReading) {
      const outIds = [...new Set(analysis.tagged.filter(t => t.tags.includes('slow_correct') && t.readingId === slowReading && t.outcomeId).map(t => t.outcomeId!))]
      const { decision } = await decideAssessment(userId, { kind: 'practice', readingId: slowReading, outcomeIds: outIds })
      const rd = readingById.get(slowReading)
      if (rd) timing.guidance = studyGuidance({ signal: 'slow_correct', scope: `Reading ${rd.reading_no}: ${rd.title}`, reading: { label: `Reading ${rd.reading_no}`, href: `/app/curriculum/${rd.topic_id}/${rd.id}` }, observations: timing.observations })
      timing.practice = { readingId: slowReading, outcomeIds: outIds, state: decision.state, deliverable: decision.deliverable, minutes: decision.minutes, message: decision.message }
    }
  }
  // Unanswered questions are reviewable too (a voided one is not scored, but it is still listed as set aside).
  for (const o of omittedIds) {
    const it: any = (omittedItems ?? []).find(x => x.id === o.itemId); if (!it) continue
    const reading = it.lm_id ? readingById.get(it.lm_id as string) : null
    questions.push({
      itemId: o.itemId, seq: o.seq, stem: it.stem, options: (it.options ?? []) as string[], keyIndex: (it.key_index ?? null) as number | null, selectedIndex: null, isCorrect: false,
      confidence: null, perOptionFeedback: (it.per_option_feedback ?? {}) as Record<string, string>, solution: ((it.item_card ?? {}).solution ?? null) as string | null, conceptName: (it.concept?.name ?? null) as string | null,
      errorCode: null, errorLabel: null, errorDescription: null, unreviewed: !isEvidenceGrade(it.review_status), challenged: challenged.has(o.itemId), omitted: true, flagged: flaggedIds.has(o.itemId), challengeStatus: challengeStatusOf(o.itemId),
      extra: { outcomeId: (it.outcome_id ?? null) as string | null, readingLabel: reading ? `Reading ${reading.reading_no}: ${reading.title}` : null, readingHref: reading ? `/app/curriculum/${reading.topic_id}/${reading.id}${it.outcome_id ? `?los=${encodeURIComponent(it.outcome_id)}` : ''}` : null,
        outcomeTitle: it.outcome_id ? outcomeTitle.get(it.outcome_id as string) ?? null : null, difficulty: (it.intended_difficulty ?? null) as string | null, form: (it.item_form ?? it.cognition ?? null) as string | null, timing: 'not answered', pattern: null, tags: [], activeSeconds: null },
    })
  }
  questions.sort((a, b) => a.seq - b.seq)
  const ledger = buildLedger({ policy: (attempt.scoring_policy_version ?? null) as string | null, delivered: (formItems ?? []).map(f => f.item_id as string), responses: (resp ?? []).map(r => ({ itemId: r.item_id as string, isCorrect: r.selected_option_index === null || r.selected_option_index === undefined ? null : r.is_correct === true })), voided, disputed })
  const pendingScope = coverage.untestedOutcomes.length
  const nextAction = chooseNextAction({ findings, repairCount: repairs.length, furtherPaper: pendingScope > 0, hasRepairOpen: false })

  const nameMap = <T,>(entries: [string, T][]) => Object.fromEntries(entries)
  const { tagged: _drop, ...analysisOut } = analysis
  void outcomeCell
  return {
    attempt: { id: attemptId, kind: attempt.attempt_kind as string | null, paperKind: attempt.paper_kind as string | null, startedAt: attempt.started_at as string | null, submittedAt: attempt.submitted_at as string | null, pausedMinutes: Math.round(((attempt.paused_seconds as number) ?? 0) / 60), timed: attempt.deadline_at !== null },
    analysis: analysisOut, ledger, findings, nextAction, omitted, invalidated, pendingScope, eligibilityPolicy: (attempt.eligibility_policy ?? null) as string | null,
    integrity: { voidedOrDisputed: voidedNow.size + pendingNow.size, challenges: (challenges ?? []).length, unmappedQuestions: analysis.tagged.filter(t => !t.outcomeId).length },
    coverage,
    names: { readings: nameMap([...readingById].map(([id, r]) => [id, rname(id)] as [string, string])), subjects: nameMap((topics ?? []).map(t => [t.id as string, t.name as string] as [string, string])), outcomes: nameMap([...outcomeTitle]) },
    subjectOfReading: nameMap([...readingById].map(([id, r]) => [id, r.topic_id as string] as [string, string])),
    swot, repairs, nextWeek, currentStatus, revision: { number: (attempt.result_revision ?? 1) as number, adjustedAt: (attempt.rescored_at ?? null) as string | null },
    previous: (prev ?? []).map(p => ({ id: p.id as string, kind: p.attempt_kind as string | null, answered: (p.valid_response_count ?? 0) as number, correct: (p.correct_response_count ?? 0) as number, questions: (p.valid_response_count ?? 0) as number, startedAt: p.started_at as string | null })),
    questions,
  }
}

function readingOfOutcome(outcomeId: string, rows: { id: unknown; reading_id: unknown }[]): string {
  return (rows.find(r => r.id === outcomeId)?.reading_id ?? '') as string
}
