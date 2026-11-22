import type { SupabaseClient } from '@supabase/supabase-js'
import { decideAssessment, type AssessmentDecision, type DecisionInput } from './assessmentDecision'
import { assembleEligiblePool } from './assembly'
import { seededRandom } from './difficultyPolicy'
import { reserveAttempt } from './reserve'
import { startRepairCheck } from './repairCheck'
import type { PaperPreview } from './paperPreview'
import { MAX_ASSESSMENT_QUESTIONS, estimatedMinutes } from './limits'

/**
 * Starting an assessment freezes it. The decision (assessmentDecision.ts) says what can be served; `reserveAttempt` writes the
 * blueprint, form, pinned item versions, attempt, scope snapshot and Calendar link in ONE transaction. Idempotent: an open attempt
 * for the same identity is resumed, never duplicated, and any change in the bank or scope since the student looked is returned as
 * an updated decision instead of a silent smaller paper.
 */

export type StartKind = 'weekly' | 'reading' | 'subject' | 'repair' | 'practice'
export type StartInput = DecisionInput & { kind: StartKind }

export type StartResult =
  | { ok: true; attemptId: string; resumed: boolean; questions: number; estimatedMinutes: number; timed: boolean }
  | { ok: false; code: 'no_scope' | 'scope_changed' | 'bank_insufficient' | 'bad_request' | 'no_cycle' | 'failed'; message: string; decision?: AssessmentDecision; preview?: PaperPreview }

const CODE = { confirm_scope: 'no_scope', no_scope: 'no_scope', no_cycle: 'no_cycle', no_bank: 'bank_insufficient', insufficient: 'bank_insufficient', stale: 'scope_changed', waiting: 'no_scope', unavailable: 'no_scope' } as const

export async function startAssessment(_db: SupabaseClient, userId: string, input: StartInput): Promise<StartResult> {
  if (!['weekly', 'reading', 'subject', 'repair', 'practice'].includes(input.kind)) return { ok: false, code: 'bad_request', message: 'Unknown assessment type.' }
  if (input.kind === 'repair' && !input.checkTaskId) return { ok: false, code: 'bad_request', message: 'Start a re-check from its task in Calendar, so it covers exactly the repairs you did.' }
  const result = await decideAssessment(userId, input)
  const d = result.decision
  if (d.state === 'resume') return { ok: true, attemptId: d.attemptId!, resumed: true, questions: d.deliverable, estimatedMinutes: d.minutes || estimatedMinutes(d.deliverable), timed: d.timed }
  if (d.state !== 'start') return { ok: false, code: CODE[d.state as keyof typeof CODE] ?? 'failed', message: d.message ?? 'This paper is not available.', decision: d }

  if (input.kind === 'repair') {
    // The re-check keeps its own command (it re-validates the linked repairs under lock) and applies the same defect rule.
    const r = await startRepairCheck(userId, input.checkTaskId!)
    return r.ok ? { ok: true, attemptId: r.attemptId, resumed: r.resumed, questions: r.questions, estimatedMinutes: estimatedMinutes(r.questions), timed: false }
      : { ok: false, code: r.code === 'bank_insufficient' || r.code === 'bank_changed' ? 'bank_insufficient' : r.code === 'failed' ? 'failed' : 'no_scope', message: r.message }
  }

  const { plan } = result
  const bp = plan.blueprint!
  const dp = plan.difficulty
  const assembly = assembleEligiblePool(bp, plan.pool, dp ? seededRandom(dp.seed) : Math.random, dp ? { target: dp.target } : {})
  const need = d.needed
  if (assembly.delivered < need) return { ok: false, code: 'bank_insufficient', message: `The available questions changed (${assembly.delivered} can be served; ${need} are needed). Nothing was started.`, decision: d }
  const timed = input.kind === 'practice'
  const lv = new Map(plan.pool.map(p => [p.id, p.level ?? '']))
  const levels = dp ? Object.fromEntries(assembly.items.map(i => [i.itemId, lv.get(i.itemId) ?? ''])) : undefined
  // Recorded on the form: the policy, targets, actual mix, evidence basis and seed it was reserved with.
  const difficulty = dp ? { ...d.difficulty, actual: assembly.mix, shortfall: assembly.mixShortfall, seed: dp.seed } : null
  const requested = { ...bp, label: plan.scopeLabel, scopeRevision: d.scopeRevision, key: plan.openKey, part: d.part, ...(difficulty ? { difficulty } : {}) }
  const r = await reserveAttempt({
    userId, manifestId: plan.manifestId!, kind: input.kind, openKey: plan.openKey, cycleId: plan.cycleId,
    paperKind: d.paperKind, purpose: input.kind === 'weekly' ? 'weekly_cumulative' : 'module_diagnostic',
    itemIds: assembly.items.map(i => i.itemId),
    requestedScope: { kind: input.kind, label: plan.scopeLabel, readingIds: bp.perReading.map(x => x.readingId) },
    constraints: { maxQuestions: assembly.delivered, resolvedLength: assembly.delivered, allowedTiers: ['reviewed'], requested: bp.totalQuestions, ceiling: MAX_ASSESSMENT_QUESTIONS, eligibility: 'approved-version-v1' },
    requested,
    coverage: {
      delivered: assembly.delivered, requested: assembly.requested, perReading: assembly.perReading, shortfalls: assembly.shortfalls, balance: assembly.balance,
      ...(difficulty ? { difficulty } : {}),
      selection: { requestedOutcomes: bp.perOutcome.length + bp.rollingCoverage.length, selectedOutcomes: bp.perOutcome.map(o => o.outcomeId), pendingCapacity: bp.rollingCoverage, pendingBank: bp.bankShortfalls, reasons: d.reasons, part: d.part, policy: 'approved-version-v1' },
    },
    scopeSnapshot: plan.scope, scopeLabel: plan.scopeLabel, scopeRevision: d.scopeRevision,
    timeLimitMinutes: input.kind === 'practice' ? d.minutes : null, linkWeekly: input.kind === 'weekly' && d.part === 1,
    minQuestions: need, scopeSource: plan.scopeSource ?? null,
    ...(dp ? { evidenceVersion: dp.evidenceVersion, levels } : {}),
  })
  if (r.ok) return { ok: true, attemptId: r.attemptId, resumed: r.resumed, questions: r.questions, estimatedMinutes: estimatedMinutes(r.questions), timed }
  if (r.code === 'scope_changed' || r.code === 'decision_changed') return { ok: false, code: 'scope_changed', message: r.message, decision: (await decideAssessment(userId, input)).decision }
  if (r.code === 'bank_insufficient' || r.code === 'bank_changed') {
    // Show the student the updated choice rather than only an error.
    const fresh = await decideAssessment(userId, input)
    return { ok: false, code: 'bank_insufficient', message: r.message, decision: fresh.decision }
  }
  return { ok: false, code: r.code === 'cycle_changed' ? 'no_cycle' : 'failed', message: r.message }
}
