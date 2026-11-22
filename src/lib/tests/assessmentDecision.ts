import { activeCycleId } from '../ops/sharedReads'
import { createAdminClient } from '../supabase/admin'
import { getPaperManifestId } from '../planning/pulse/paper'
import { getCompletedCycleScope } from './completedScopeService'
import { getPaperPreview, type PaperKind, type PaperPreview } from './paperPreview'
import { allocateWeighted, type SubjectWeight, type WeightedBlueprint } from './weightedBlueprint'
import { assembleEligiblePool } from './assembly'
import { planDifficulty, seededRandom, type DifficultyPlan, type DifficultySummary } from './difficultyPlan'
import { loadEligibleItemPool } from './itemPool'
import { planRepairCheck } from './repairCheck'
import { MAX_ASSESSMENT_QUESTIONS, MIN_PAPER_QUESTIONS, PRACTICE_QUESTIONS, estimatedMinutes, practiceMinutes } from './limits'
import type { CompletedCycleScope, ScopeTarget } from './completedScope'

/**
 * THE assessment decision. Tests, Calendar, /api/tests/preflight, /api/tests/start, reading/subject checks, re-checks and the
 * weekly closure all ask this one function whether a paper can start, with how many questions, what is left pending and what the
 * student should do next. `startAssessment` reserves exactly what this returned, so a button and a start cannot disagree.
 */

export type DecisionKind = 'weekly' | 'reading' | 'subject' | 'repair' | 'practice'
export type DecisionInput = {
  kind: DecisionKind
  paperKind?: PaperKind
  /** weekly: 1 = the routine paper; 2+ = a further paper from the scope the earlier ones left pending. */
  part?: number
  /** weekly: the scope revision the student reviewed. */
  expectedRevision?: string
  readingId?: string
  subjectId?: string
  /** reading/subject: explicit baseline of the whole reading/subject. Never mixed with weekly accountability scope. */
  baseline?: boolean
  checkTaskId?: string
  /** practice: narrow the explicit reading to these outcomes. */
  outcomeIds?: string[]
  /** The evidence revision the student reviewed; a different current revision makes the preview stale. */
  expectedDecision?: string
  /** practice: `adaptive` = a bounded sequence of five-question sets (separate from the fixed timed ten). */
  mode?: 'timed' | 'adaptive'
  cap?: number
}

export type DecisionState =
  | 'start' | 'resume' | 'confirm_scope' | 'no_scope' | 'insufficient' | 'waiting' | 'unavailable' | 'no_cycle' | 'no_bank' | 'stale'

export type AssessmentDecision = {
  kind: DecisionKind
  purposeLabel: string
  paperKind: PaperKind | null
  state: DecisionState
  attemptId: string | null
  message: string | null
  /** What the blueprint asked for, and what fresh approved questions can actually be served right now. */
  requested: number
  deliverable: number
  needed: number
  ceiling: number
  minutes: number
  timed: boolean
  scopeRevision: string | null
  /** Per reading: wanted vs deliverable, with the readable name. */
  readings: { readingId: string; name: string; wanted: number; delivered: number }[]
  /** Scope that this paper will not test, and why. Unsupported areas stay visible; nothing unrelated fills them. */
  pending: {
    capacity: { outcomeId: string; title: string }[]
    capacityTotal: number
    bank: { readingId: string; name: string; wanted: number; available: number }[]
    unresolvedBlocks: number
  }
  part: number
  /** Set when confirmed scope exceeds one paper: a further paper from what remains. */
  furtherPaper: { part: number; outcomes: number; tradeoff: string } | null
  reasons: string[]
  next: { label: string; href: string } | null
  /** Echo of the scope used (names and counts only). */
  scopeTotals: { outcomes: number; readings: number } | null
  /** difficulty-policy.1 explanation; null for fixed-profile purposes (re-checks, timed practice, mocks). */
  difficulty: DifficultySummary | null
}

/** Server-only reservation material. Never serialised to a browser. */
export type DecisionPlan = {
  blueprint: WeightedBlueprint | null
  scope: CompletedCycleScope | unknown | null
  scopeLabel: string
  openKey: string | null
  cycleId: string | null
  pool: Awaited<ReturnType<typeof loadEligibleItemPool>>
  manifestId: string | null
  /** repair only */
  repairItemIds?: string[]
  /** paper_scope_source read before the scope was built (scope-derived papers only). */
  scopeSource?: string | null
  /** Adaptive difficulty material (server only): seed, integer target and the evidence revision read before the decision. */
  difficulty?: DifficultyPlan
}
export type DecisionResult = { decision: AssessmentDecision; plan: DecisionPlan }

const LABEL = { diagnostic: 'Weekly diagnostic (new material)', revisionary: 'Weekly revisionary paper (revisited material)', mixed: 'Weekly mixed paper (new + revisionary)' } as const
const base = (kind: DecisionKind, over: Partial<AssessmentDecision> = {}): AssessmentDecision => ({
  kind, purposeLabel: '', paperKind: null, state: 'unavailable', attemptId: null, message: null, requested: 0, deliverable: 0, needed: MIN_PAPER_QUESTIONS,
  ceiling: MAX_ASSESSMENT_QUESTIONS, minutes: 0, timed: false, scopeRevision: null, readings: [], pending: { capacity: [], capacityTotal: 0, bank: [], unresolvedBlocks: 0 },
  part: 1, furtherPaper: null, reasons: [], next: null, scopeTotals: null, difficulty: null, ...over,
})
const noPlan = (over: Partial<DecisionPlan> = {}): DecisionPlan => ({ blueprint: null, scope: null, scopeLabel: '', openKey: null, cycleId: null, pool: [], manifestId: null, ...over })

/** Where the student goes when no paper can be started. Thin or empty bank → plan the week without a paper; nothing is lost. */
const NEXT = {
  calendar: { label: 'Open Calendar', href: '/app/calendar' },
  confirm: { label: 'Confirm what you covered', href: '/app/tests#scope-h' },
  plan: { label: 'Plan the week without this paper', href: '/app/review-week' },
  curriculum: { label: 'Keep studying in Curriculum', href: '/app/curriculum' },
}

async function sourceVersion(userId: string): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc('paper_scope_source', { p_user: userId })
  return error || typeof data !== 'string' ? null : data
}

async function subjectWeights(): Promise<SubjectWeight[]> {
  const { data } = await createAdminClient().from('topics').select('id, exam_weight_min, exam_weight_max').throwOnError()
  return (data ?? []).map(t => ({ id: t.id as string, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) }))
}

async function catalog() {
  const admin = createAdminClient()
  const [{ data: readings }, { data: los }] = await Promise.all([
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title, page_count, structure_pending').eq('is_active', true).throwOnError(),
    admin.from('reading_los').select('id, reading_id').throwOnError(),
  ])
  const rmap = new Map((readings ?? []).map(r => [r.id as string, { id: r.id as string, subjectId: r.topic_id as string, pageCount: Number(r.page_count), pending: Boolean(r.structure_pending), name: `Reading ${r.reading_no}: ${r.title}` }]))
  const targets: ScopeTarget[] = (los ?? []).filter(l => rmap.get(l.reading_id as string) && !rmap.get(l.reading_id as string)!.pending).map(l => ({
    outcomeId: l.id as string, readingId: l.reading_id as string, subjectId: rmap.get(l.reading_id as string)!.subjectId, kind: 'new' as const, weight: 1, sources: [],
  }))
  return { rmap, targets }
}

function scopeToInput(targets: ScopeTarget[], readings: Map<string, { pageCount: number; subjectId: string }>) {
  const rmap = new Map<string, { readingId: string; subjectId: string; pageCount: number; outcomeIds: string[]; newCount: number; revisionCount: number }>()
  for (const t of targets) {
    const r = rmap.get(t.readingId) ?? { readingId: t.readingId, subjectId: t.subjectId, pageCount: readings.get(t.readingId)?.pageCount ?? 0, outcomeIds: [], newCount: 0, revisionCount: 0 }
    r.outcomeIds.push(t.outcomeId); rmap.set(t.readingId, r)
  }
  return { targets, readings: [...rmap.values()] }
}

/** Outcomes already asked by this cycle's weekly papers, so a further paper starts from what is still pending. */
async function outcomesAskedThisCycle(userId: string, cycleId: string): Promise<Set<string>> {
  const admin = createAdminClient()
  const { data: atts } = await admin.from('assessment_attempts').select('form_id').eq('user_id', userId).eq('cycle_id', cycleId).eq('attempt_kind', 'weekly').throwOnError()
  const forms = (atts ?? []).map(a => a.form_id as string).filter(Boolean)
  if (!forms.length) return new Set()
  const { data: fi } = await admin.from('form_items').select('item_id').in('form_id', forms).throwOnError()
  const ids = (fi ?? []).map(f => f.item_id as string)
  if (!ids.length) return new Set()
  const { data: items } = await admin.from('assessment_items').select('outcome_id').in('id', ids).throwOnError()
  return new Set((items ?? []).flatMap(i => i.outcome_id ? [i.outcome_id as string] : []))
}

export async function findOpenAttempt(userId: string, kind: string, match: { cycleId?: string | null; openKey?: string | null }) {
  const admin = createAdminClient()
  let q = admin.from('assessment_attempts').select('id, form_id, open_key, time_limit_minutes').eq('user_id', userId).eq('attempt_kind', kind).in('status', ['ready', 'in_progress'])
  if (match.cycleId) q = q.eq('cycle_id', match.cycleId)
  const { data } = await q.order('started_at', { ascending: false, nullsFirst: false }).throwOnError()
  const hit = match.openKey ? (data ?? []).find(a => a.open_key === match.openKey) : (data ?? [])[0]
  if (!hit) return null
  const { count } = await admin.from('form_items').select('*', { count: 'exact', head: true }).eq('form_id', hit.form_id as string)
  return { id: hit.id as string, questions: count ?? 0, timed: hit.time_limit_minutes !== null }
}

async function names(ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  const { data } = await createAdminClient().from('curriculum_readings').select('id, reading_no, title').in('id', ids).throwOnError()
  return new Map((data ?? []).map(r => [r.id as string, `Reading ${r.reading_no}: ${r.title}`]))
}

/** Decide from a blueprint and the shared pool; the single place deliverable, shortfalls and pending are computed. */
async function fromBlueprint(
  d: AssessmentDecision, plan: DecisionPlan, bp: WeightedBlueprint, userId: string, o: { exact?: number; unresolved?: number; adaptive?: boolean; expectedDecision?: string },
): Promise<DecisionResult> {
  const pool = await loadEligibleItemPool(userId, bp.perReading.map(r => r.readingId))
  const rn0 = await names(bp.perReading.map(r => r.readingId))
  const dp = o.adaptive ? await planDifficulty(userId, bp, pool, rn0, [plan.openKey, d.scopeRevision, d.kind], new Date()) : null
  // Deterministic: the preview, a refresh and the reservation make the same choices for an unchanged decision and inventory.
  const sim = assembleEligiblePool(bp, pool, dp ? seededRandom(dp.seed) : () => 0.5, dp ? { target: dp.target } : {})
  if (dp) { dp.summary.actual = sim.mix; dp.summary.shortfall = sim.mixShortfall }
  bp.bankShortfalls = sim.shortfalls.map(r => ({ readingId: r.readingId, wanted: r.wanted, available: r.delivered }))
  const rn = await names([...new Set([...bp.perReading.map(r => r.readingId), ...bp.bankShortfalls.map(s => s.readingId)])])
  const needed = o.exact ?? MIN_PAPER_QUESTIONS
  const capacityIds = bp.rollingCoverage.slice(0, 200)
  const titles = capacityIds.length ? new Map(((await createAdminClient().from('reading_los').select('id, title').in('id', capacityIds).throwOnError()).data ?? []).map(l => [l.id as string, l.title as string])) : new Map<string, string>()
  const out: AssessmentDecision = {
    ...d, requested: bp.totalQuestions, deliverable: sim.delivered, needed, minutes: estimatedMinutes(sim.delivered),
    readings: sim.perReading.map(r => ({ ...r, name: rn.get(r.readingId) ?? r.readingId })),
    pending: {
      capacity: capacityIds.map(id => ({ outcomeId: id, title: titles.get(id) ?? id })), capacityTotal: bp.rollingCoverage.length,
      bank: bp.bankShortfalls.map(s => ({ ...s, name: rn.get(s.readingId) ?? s.readingId })), unresolvedBlocks: o.unresolved ?? 0,
    },
    reasons: [bp.policy.note, ...(bp.policy.breadthFloor ? [`${bp.policy.breadthFloor} reading${bp.policy.breadthFloor === 1 ? '' : 's'} sampled.`] : [])],
    difficulty: dp?.summary ?? null,
  }
  if (bp.rollingCoverage.length > 0) {
    out.furtherPaper = {
      part: d.part + 1, outcomes: bp.rollingCoverage.length,
      tradeoff: `This paper samples ${bp.perOutcome.length} of ${bp.perOutcome.length + bp.rollingCoverage.length} confirmed outcomes (a paper never exceeds ${MAX_ASSESSMENT_QUESTIONS} questions and is sized to your time). The other ${bp.rollingCoverage.length} stay pending; a further paper can cover them, using different questions.`,
    }
  }
  if (sim.delivered < needed) {
    out.state = 'insufficient'
    const gaps = bp.bankShortfalls.map(s => `${rn.get(s.readingId) ?? s.readingId}: ${s.available} of ${s.wanted}`).join('; ')
    out.message = `The bank can serve ${sim.delivered} fresh human-reviewed question${sim.delivered === 1 ? '' : 's'} for this scope; at least ${needed} are needed.${gaps ? ` Short: ${gaps}.` : ''} Nothing will be started, and no unrelated question fills the gap. This scope stays pending.`
    out.next = NEXT.plan
  } else out.state = 'start'
  if (dp && o.expectedDecision && o.expectedDecision !== dp.evidenceVersion && out.state === 'start') {
    out.state = 'stale'; out.message = 'Your recent results changed since you reviewed this paper. Review the updated paper before starting.'
  }
  return { decision: out, plan: { ...plan, blueprint: bp, pool, difficulty: dp ?? undefined } }
}

export async function decideAssessment(userId: string, input: DecisionInput, opts: { preview?: PaperPreview; now?: Date } = {}): Promise<DecisionResult> {
  const admin = createAdminClient()
  const now = opts.now ?? new Date()

  if (input.kind === 'repair') {
    const d0 = base('repair', { purposeLabel: 'Repair re-check', needed: MIN_PAPER_QUESTIONS })
    if (!input.checkTaskId) return { decision: { ...d0, message: 'Start a re-check from its task in Calendar, so it covers exactly the repairs you did.', next: NEXT.calendar }, plan: noPlan() }
    const c = await planRepairCheck(userId, input.checkTaskId)
    if (c.state === 'resume') return { decision: { ...d0, state: 'resume', attemptId: c.attemptId }, plan: noPlan() }
    if (c.state === 'startable') {
      return { decision: { ...d0, state: 'start', requested: c.needed, deliverable: c.deliverable, minutes: c.minutes, readings: c.perConcept.map(p => ({ readingId: p.conceptName, name: p.conceptName, wanted: p.wanted, delivered: p.delivered })) },
        plan: noPlan({ repairItemIds: c.itemIds, openKey: `check:${input.checkTaskId}` }) }
    }
    if (c.state === 'bank_insufficient') {
      return { decision: { ...d0, state: 'insufficient', message: c.message, deliverable: c.deliverable, requested: c.perConcept.reduce((n, p) => n + p.wanted, 0), readings: c.perConcept.map(p => ({ readingId: p.conceptName, name: p.conceptName, wanted: p.wanted, delivered: p.delivered })),
        next: { label: 'Review the repairs in Calendar', href: '/app/calendar' } }, plan: noPlan() }
    }
    return { decision: { ...d0, state: c.state === 'waiting' ? 'waiting' : 'unavailable', message: c.message, next: NEXT.calendar }, plan: noPlan() }
  }

  // Read BEFORE the scope is built: an edit landing after this point makes the reservation refuse instead of reserving from an old scope.
  const scopeSource = input.baseline ? null : await sourceVersion(userId)
  const manifestId = await getPaperManifestId()
  const cycleId = (await activeCycleId(userId).catch(() => undefined)) ?? null

  if (input.kind === 'weekly') {
    const part = Math.max(1, Math.floor(input.part ?? 1))
    const d0 = base('weekly', { part })
    if (!cycleId) return { decision: { ...d0, state: 'no_cycle', purposeLabel: 'Weekly paper', message: 'There is no open week, so there is no weekly paper. Prepare your week in Calendar first.', next: NEXT.calendar }, plan: noPlan() }
    const open = await findOpenAttempt(userId, 'weekly', { cycleId })
    if (open) return { decision: { ...d0, state: 'resume', attemptId: open.id, minutes: estimatedMinutes(open.questions), deliverable: open.questions, timed: open.timed }, plan: noPlan({ cycleId }) }
    const exclude = part > 1 ? await outcomesAskedThisCycle(userId, cycleId) : undefined
    const preview = opts.preview && part === 1 && !input.paperKind ? opts.preview : await getPaperPreview(userId, input.paperKind, now, exclude)
    const label = LABEL[preview.paperKind] + (part > 1 ? ` — further paper ${part}` : '')
    const d1 = { ...d0, purposeLabel: label, paperKind: preview.paperKind, scopeRevision: preview.scope.revision, scopeTotals: { outcomes: preview.scope.totals.outcomes, readings: preview.scope.totals.readings } }
    const plan = noPlan({ cycleId, scope: preview.scope, scopeLabel: `weekly_${preview.paperKind}`, openKey: `${cycleId}:p${part}`, manifestId, scopeSource })
    const unresolved = preview.scope.unresolved.length
    // Unconfirmed blocks never block the confirmed part of the scope; they stay pending until the student says what they covered.
    if (unresolved > 0 && preview.scope.targets.length === 0) return { decision: { ...d1, state: 'confirm_scope', message: `${unresolved} finished or partly finished block${unresolved === 1 ? ' needs' : 's need'} you to confirm what ${unresolved === 1 ? 'it' : 'they'} covered before testing.`, pending: { ...d1.pending, unresolvedBlocks: unresolved }, next: NEXT.confirm }, plan }
    if (preview.noPaperReason) return { decision: { ...d1, state: 'no_scope', message: part > 1 ? 'Everything you have confirmed this week has already been covered by an earlier paper.' : preview.noPaperReason, next: NEXT.calendar }, plan }
    if (!manifestId) return { decision: { ...d1, state: 'no_bank', message: 'No question bank is active yet.', next: NEXT.plan }, plan }
    if (input.expectedRevision && input.expectedRevision !== preview.scope.revision) {
      const r = await fromBlueprint(d1, plan, preview.blueprint, userId, { unresolved, adaptive: true, expectedDecision: input.expectedDecision })
      return { decision: { ...r.decision, state: 'stale', message: 'Your completed work changed since you reviewed it. Review the updated paper before starting.' }, plan: r.plan }
    }
    return fromBlueprint(d1, plan, preview.blueprint, userId, { unresolved, adaptive: true, expectedDecision: input.expectedDecision })
  }

  if (input.kind === 'reading' || input.kind === 'subject') {
    const label = `${input.kind === 'reading' ? 'Reading' : 'Subject'} check${input.baseline ? ' (baseline)' : ''}`
    const d0 = base(input.kind, { purposeLabel: label })
    const id = input.kind === 'reading' ? input.readingId : input.subjectId
    if (!id) return { decision: { ...d0, message: 'Choose what to test.' }, plan: noPlan() }
    const open = await findOpenAttempt(userId, input.kind, { openKey: id })
    if (open) return { decision: { ...d0, state: 'resume', attemptId: open.id, deliverable: open.questions, minutes: estimatedMinutes(open.questions) }, plan: noPlan() }
    if (!manifestId) return { decision: { ...d0, state: 'no_bank', message: 'No question bank is active yet.', next: NEXT.curriculum }, plan: noPlan() }
    const { rmap, targets: all } = await catalog()
    const inScope = (t: ScopeTarget) => (input.kind === 'reading' ? t.readingId === id : t.subjectId === id)
    let targets: ScopeTarget[], scope: CompletedCycleScope | null = null
    if (input.baseline) targets = all.filter(inScope)
    else { scope = await getCompletedCycleScope(userId, now); targets = scope.targets.filter(inScope) }
    const plan = noPlan({ cycleId, manifestId, scope, scopeLabel: `${input.kind}${input.baseline ? '_baseline' : ''}`, openKey: id, scopeSource })
    const d1 = { ...d0, scopeRevision: scope?.revision ?? null, scopeTotals: { outcomes: targets.length, readings: new Set(targets.map(t => t.readingId)).size } }
    if (targets.length === 0) {
      return { decision: { ...d1, state: 'no_scope', message: input.baseline ? 'That reading or subject has no examinable outcomes yet.' : 'Nothing you have completed falls in that reading or subject. Complete some work first, or choose a baseline check.', next: input.baseline ? NEXT.curriculum : NEXT.calendar }, plan }
    }
    const bp = allocateWeighted({ scope: scopeToInput(targets, rmap), subjects: await subjectWeights(), kinds: ['new', 'revision'] })
    return fromBlueprint(d1, plan, bp, userId, { adaptive: true, expectedDecision: input.expectedDecision })
  }

  if (input.kind === 'practice') {
    const d0 = base('practice', { purposeLabel: 'Timed practice', timed: true })
    if (!input.readingId) return { decision: { ...d0, message: 'Choose a reading to practise.' }, plan: noPlan() }
    const outs = [...new Set(input.outcomeIds ?? [])].sort()
    const key = `practice:${input.readingId}${outs.length ? `:${outs.join(',')}` : ''}`
    const open = await findOpenAttempt(userId, 'practice', { openKey: key })
    if (open) return { decision: { ...d0, state: 'resume', attemptId: open.id, deliverable: open.questions, minutes: practiceMinutes(open.questions) }, plan: noPlan() }
    if (!manifestId) return { decision: { ...d0, state: 'no_bank', message: 'No question bank is active yet.', next: NEXT.curriculum }, plan: noPlan() }
    const { rmap, targets: all } = await catalog()
    const targets = all.filter(t => t.readingId === input.readingId && (!outs.length || outs.includes(t.outcomeId)))
    const plan = noPlan({ cycleId: null, manifestId, scopeLabel: 'practice', openKey: key })
    if (!targets.length) return { decision: { ...d0, state: 'no_scope', message: 'That reading has no examinable outcomes to practise.', next: NEXT.curriculum }, plan }
    const bp = allocateWeighted({ scope: scopeToInput(targets, rmap), subjects: await subjectWeights(), kinds: ['new'], totalOverride: PRACTICE_QUESTIONS })
    const r = await fromBlueprint({ ...d0, scopeTotals: { outcomes: targets.length, readings: 1 } }, plan, bp, userId, {})
    r.decision.minutes = practiceMinutes(r.decision.deliverable)
    r.decision.furtherPaper = null
    r.decision.reasons = ['Practice, not evidence: it does not change your understanding signal, close a repair or count toward a weekly paper.', 'It uses questions you have not seen; once answered they are not reused in a paper.']
    if (r.decision.state === 'insufficient') {
      r.decision.message = `Timed practice needs at least ${r.decision.needed} fresh human-reviewed questions on this reading; the bank can serve ${r.decision.deliverable} right now. Nothing was started. Practise from your own materials in the meantime.`
      r.decision.next = { label: 'Study this reading in Curriculum', href: `/app/curriculum` }
    }
    return r
  }

  // The single-paper mock was retired: a full mock is two linked sessions (src/lib/rehearsal), reserved from a mock appointment.
  return { decision: base('weekly', { state: 'unavailable', message: 'Unknown assessment.' }), plan: noPlan() }
}

/** What a browser may see: the decision, never the plan. */
export const publicDecision = (r: DecisionResult) => r.decision

/** A five-question blueprint over ONE explicit reading (optionally narrowed to outcomes), for adaptive practice sets. Null = nothing examinable there. */
export async function practiceSetBlueprint(readingId: string, outcomeIds: string[], size: number) {
  const { rmap, targets: all } = await catalog()
  const outs = [...new Set(outcomeIds)]
  const targets = all.filter(t => t.readingId === readingId && (!outs.length || outs.includes(t.outcomeId)))
  if (!targets.length) return null
  return { bp: allocateWeighted({ scope: scopeToInput(targets, rmap), subjects: await subjectWeights(), kinds: ['new'], totalOverride: size }), outcomes: targets.map(t => t.outcomeId), readingName: (await names([readingId])).get(readingId) ?? readingId }
}
export { findOpenAttempt as _findOpenAttemptForPractice }
