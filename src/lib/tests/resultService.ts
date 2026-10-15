import { createAdminClient } from '../supabase/admin'
import { allowedTiers } from '../diagnostic/blueprint'
import { ERROR_TAXONOMY, type ErrorCode } from '../diagnostic/types'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getWeeklyReviewState } from '../planning/weeklyReview/service'
import { toLevel } from '../curriculum/confidence'
import { analyseAttempt, buildSwot, prioritiseRepairs, type Analysis, type ItemMeta, type OutcomeStatus, type ReadingEdge, type RepairItem, type RespRow, type Swot } from './resultAnalysis'

/**
 * Everything the result page and /api/tests/attempt/[id]/result show, built from one read.
 * Read-only: opening a result never mutates a plan, an evidence row or a repair thread.
 */

export type ResultQuestion = {
  itemId: string; seq: number; stem: string; options: string[]; keyIndex: number | null; selectedIndex: number | null; isCorrect: boolean
  confidence: number | null; perOptionFeedback: Record<string, string>; solution: string | null; conceptName: string | null
  errorCode: string | null; errorLabel: string | null; errorDescription: string | null; unreviewed: boolean; challenged: boolean
  extra: { readingLabel: string | null; readingHref: string | null; outcomeTitle: string | null; difficulty: string | null; form: string | null; timing: string; pattern: string | null; tags: string[]; activeSeconds: number | null }
}

export type AttemptResult = {
  attempt: { id: string; kind: string | null; paperKind: string | null; startedAt: string | null; submittedAt: string | null; pausedMinutes: number; timed: boolean }
  analysis: Omit<Analysis, 'tagged'>
  integrity: { voidedOrDisputed: number; challenges: number; unmappedQuestions: number }
  coverage: {
    requestedQuestions: number | null; deliveredQuestions: number
    shortfalls: { readingId: string; wanted: number; delivered: number }[]
    testedOutcomes: string[]; untestedOutcomes: string[]
    excluded: { title: string; reason: string }[]; snapshotRevision: string | null
  }
  names: { readings: Record<string, string>; subjects: Record<string, string>; outcomes: Record<string, string> }
  subjectOfReading: Record<string, string>
  swot: Swot
  repairs: RepairItem[]
  nextWeek: { available: boolean; weekStart: string | null; weekEnd: string | null; repairTasks: { date: string; title: string; minutes: number }[]; reviewUrl: string } | null
  previous: { id: string; kind: string | null; answered: number; correct: number; questions: number; startedAt: string | null }[]
  questions: ResultQuestion[]
}

const ELIGIBLE = allowedTiers('weekly_cumulative')

export async function getAttemptResult(userId: string, attemptId: string, now = new Date()): Promise<AttemptResult | null> {
  const admin = createAdminClient()
  const { data: attempt } = await admin.from('assessment_attempts')
    .select('id, status, attempt_kind, paper_kind, started_at, submitted_at, paused_seconds, deadline_at, requested_blueprint, delivered_coverage, form_id')
    .eq('id', attemptId).eq('user_id', userId).maybeSingle()
  if (!attempt || attempt.status !== 'scored') return null

  const [{ data: resp }, { data: formItems }, { data: events }, { data: challenges }, { data: snap }] = await Promise.all([
    admin.from('assessment_responses').select('item_id, selected_option_index, is_correct, self_reported_confidence, flagged, active_seconds, interrupted_seconds, elapsed_seconds, changed_count').eq('attempt_id', attemptId).eq('user_id', userId),
    admin.from('form_items').select('item_id, sequence_number').eq('form_id', attempt.form_id),
    admin.from('evidence_events').select('validity').eq('attempt_id', attemptId).eq('user_id', userId),
    admin.from('item_challenges').select('item_id, status').eq('user_id', userId).eq('attempt_id', attemptId),
    admin.from('paper_scope_snapshots').select('revision, scope').eq('attempt_id', attemptId).eq('user_id', userId).maybeSingle(),
  ])
  const responses = resp ?? []
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

  // Cumulative, cross-attempt view of each tested outcome (the same one Curriculum shows).
  const tracker = await getLosTracker(userId, now)
  const trackerRow = new Map(tracker.topics.flatMap(t => t.modules.flatMap(m => m.rows)).map(r => [r.outcomeId, r]))
  const outcomeCell = new Map(analysis.byOutcome.map(c => [c.id, c]))
  const outcomes: OutcomeStatus[] = analysis.byOutcome.map(c => {
    const tr = trackerRow.get(c.id)
    return { outcomeId: c.id, readingId: readingOfOutcome(c.id, outcomeRows ?? []), subjectId: readingById.get(readingOfOutcome(c.id, outcomeRows ?? []))?.topic_id as string ?? '',
      title: outcomeTitle.get(c.id) ?? c.id, verdict: tr?.verdict ?? 'none', band: tr?.band ?? 'untested', correctHere: c.correct, askedHere: c.questions }
  })

  // Dependency links between readings, from the curriculum graph.
  const readingIds = [...readingById.keys()]
  const { data: edgeRows } = await admin.from('lm_edges').select('from_lm, to_lm, kind').eq('kind', 'prerequisite').in('from_lm', readingIds).in('to_lm', readingIds)
  const edges: ReadingEdge[] = (edgeRows ?? []).map(e => ({
    from: e.from_lm as string, to: e.to_lm as string, kind: 'prerequisite',
    basis: readingById.get(e.from_lm as string)?.topic_id !== readingById.get(e.to_lm as string)?.topic_id ? 'concept_link' : 'sequence',
  }))
  const rname = (id: string) => { const r = readingById.get(id); return r ? `Reading ${r.reading_no}: ${r.title}` : id }
  const swot = buildSwot({ outcomes, edges, readingName: rname })

  // Repair proposal, with real bank availability for an independent retest.
  const repeatedOutcomes = new Set(analysis.tagged.filter(t => t.tags.includes('repeated_misconception')).map(t => t.outcomeId).filter(Boolean) as string[])
  const cands = outcomes.filter(o => ['concept_miss', 'known_gap', 'guess'].includes(o.verdict))
  const { data: seenRows } = await admin.from('assessment_responses').select('item_id').eq('user_id', userId)
  const seen = new Set((seenRows ?? []).map(r => r.item_id as string))
  const { data: bank } = cands.length ? await admin.from('assessment_items').select('id, outcome_id').in('outcome_id', cands.map(c => c.outcomeId)).in('review_status', ELIGIBLE) : { data: [] as any[] }
  const unseenBy = new Map<string, number>()
  for (const b of bank ?? []) if (!seen.has(b.id as string)) unseenBy.set(b.outcome_id as string, (unseenBy.get(b.outcome_id as string) ?? 0) + 1)
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
      errorDescription: (diag?.description ?? null) as string | null, unreviewed: it?.review_status === 'verified', challenged: challenged.has(t.itemId),
      extra: {
        readingLabel: reading ? `Reading ${reading.reading_no}: ${reading.title}` : null, readingHref: reading ? `/app/curriculum/${reading.topic_id}/${reading.id}` : null,
        outcomeTitle: t.outcomeId ? outcomeTitle.get(t.outcomeId) ?? null : null, difficulty: t.difficulty, form: t.form ?? t.cognition,
        timing: t.timing, pattern: t.reading, tags: t.tags, activeSeconds: t.activeSeconds,
      },
    }
  }).sort((a, b) => a.seq - b.seq)

  const nameMap = <T,>(entries: [string, T][]) => Object.fromEntries(entries)
  const { tagged: _drop, ...analysisOut } = analysis
  void outcomeCell
  return {
    attempt: { id: attemptId, kind: attempt.attempt_kind as string | null, paperKind: attempt.paper_kind as string | null, startedAt: attempt.started_at as string | null, submittedAt: attempt.submitted_at as string | null, pausedMinutes: Math.round(((attempt.paused_seconds as number) ?? 0) / 60), timed: attempt.deadline_at !== null },
    analysis: analysisOut,
    integrity: { voidedOrDisputed: (events ?? []).filter(e => e.validity !== 'valid').length, challenges: (challenges ?? []).length, unmappedQuestions: analysis.tagged.filter(t => !t.outcomeId).length },
    coverage,
    names: { readings: nameMap([...readingById].map(([id, r]) => [id, rname(id)] as [string, string])), subjects: nameMap((topics ?? []).map(t => [t.id as string, t.name as string] as [string, string])), outcomes: nameMap([...outcomeTitle]) },
    subjectOfReading: nameMap([...readingById].map(([id, r]) => [id, r.topic_id as string] as [string, string])),
    swot, repairs, nextWeek,
    previous: (prev ?? []).map(p => ({ id: p.id as string, kind: p.attempt_kind as string | null, answered: (p.valid_response_count ?? 0) as number, correct: (p.correct_response_count ?? 0) as number, questions: (p.valid_response_count ?? 0) as number, startedAt: p.started_at as string | null })),
    questions,
  }
}

function readingOfOutcome(outcomeId: string, rows: { id: unknown; reading_id: unknown }[]): string {
  return (rows.find(r => r.id === outcomeId)?.reading_id ?? '') as string
}
