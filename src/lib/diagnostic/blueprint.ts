import { clampQuestions, WEEKLY_PAPER_SOFT_MAX_QUESTIONS } from '../tests/limits'
import { createAdminClient } from '../supabase/admin'
import { Difficulty } from './types'

/**
 * Form assembly.
 *
 * Two rules govern what may appear on a form:
 *
 *  1. Trust tier (§5.5). An assessment that moves the mastery ledger or
 *     produces a readiness judgement may use only human-reviewed items. Routine
 *     testing may also use verifier-passed ones. This is what allows live
 *     generation without letting unreviewed items decide whether someone is
 *     ready to sit the exam.
 *
 *  2. Exposure. An item the learner has already answered is not evidence of
 *     anything the second time. Seen items are excluded per learner.
 */

export type AssessmentPurpose = 'weekly_cumulative' | 'module_diagnostic' | 'repair_recheck' | 'concept_check'

/** Purposes that move readiness, and therefore require reviewed (gold) items only. */
const READINESS_MOVING: AssessmentPurpose[] = ['weekly_cumulative']

export function allowedTiers(purpose: AssessmentPurpose): string[] {
  return READINESS_MOVING.includes(purpose) ? ['reviewed'] : ['verified', 'reviewed']
}

export const PURPOSE_LABELS: Record<AssessmentPurpose, string> = {
  module_diagnostic: 'Module diagnostic',
  weekly_cumulative: 'Weekly cumulative',
  concept_check: 'Concept check',
  repair_recheck: 'Repair re-check',
}

export const PURPOSE_DESCRIPTIONS: Record<AssessmentPurpose, string> = {
  module_diagnostic: 'Where you stand on one module, across every concept in it.',
  weekly_cumulative: 'Everything covered so far. This one moves your readiness.',
  concept_check: 'A short probe on a single concept.',
  repair_recheck: 'Re-tests only what a previous diagnostic flagged.',
}

/** §4.1 assessment scopes. */
export const PURPOSE_LENGTHS: Record<AssessmentPurpose, number> = {
  concept_check: 5,
  repair_recheck: 8,
  module_diagnostic: 20,
  weekly_cumulative: WEEKLY_PAPER_SOFT_MAX_QUESTIONS,
}

export type BlueprintInput = {
  manifestId: string
  purpose: AssessmentPurpose
  requestedScope: { topic?: string; modules?: string[]; concepts?: string[] }
  constraints: { maxQuestions?: number; timeLimitMinutes?: number }
}

export type BlueprintResult = {
  blueprintId: string
  formId: string
  itemCount: number
}

/** Raised with a message intended to be shown to the learner. */
export class AssemblyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message)
    this.name = 'AssemblyError'
  }
}

type CandidateItem = {
  id: string
  concept_id: string | null
  intended_difficulty: Difficulty | null
  cognition: string | null
}

/**
 * Spreads selection evenly across concepts before taking a second item from any
 * one of them. Taking the first N by insertion order concentrates a form on
 * whichever concept happened to generate well, which is the sampling bias the
 * blueprint exists to prevent.
 */
function selectBalanced(items: CandidateItem[], limit: number): CandidateItem[] {
  const byConcept = new Map<string, CandidateItem[]>()
  for (const item of items) {
    const key = item.concept_id ?? 'unassigned'
    if (!byConcept.has(key)) byConcept.set(key, [])
    byConcept.get(key)!.push(item)
  }

  // Shuffle within each concept so repeat attempts do not see the same order.
  for (const list of byConcept.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[list[i], list[j]] = [list[j], list[i]]
    }
  }

  const queues = [...byConcept.values()]
  const selected: CandidateItem[] = []
  let round = 0
  while (selected.length < limit) {
    let tookAny = false
    for (const queue of queues) {
      if (selected.length >= limit) break
      if (queue.length > round) { selected.push(queue[round]); tookAny = true }
    }
    if (!tookAny) break
    round++
  }
  return selected
}

/**
 * Counts what a learner could actually be served right now, per purpose.
 * The tests page uses this to say why an option is unavailable rather than
 * offering a button that fails.
 */
export async function countAvailableItems(
  userId: string,
  manifestId: string,
  scope: { modules?: string[] } = {}
): Promise<{ verified: number; reviewed: number; seen: number }> {
  const admin = createAdminClient()

  const { data: responses } = await admin
    .from('assessment_responses')
    .select('item_id')
    .eq('user_id', userId)
  const seen = new Set((responses ?? []).map(r => r.item_id as string))

  const { data: concepts } = await admin
    .from('curriculum_concepts')
    .select('id')
    .eq('manifest_id', manifestId)
  const conceptIds = (concepts ?? []).map(c => c.id as string)
  if (conceptIds.length === 0) return { verified: 0, reviewed: 0, seen: seen.size }

  let query = admin
    .from('assessment_items')
    .select('id, review_status, lm_id')
    .in('concept_id', conceptIds)
    .in('review_status', ['verified', 'reviewed'])
  if (scope.modules?.length) query = query.in('lm_id', scope.modules)

  const { data: items } = await query
  const unseen = (items ?? []).filter(i => !seen.has(i.id as string))

  return {
    verified: unseen.filter(i => i.review_status === 'verified').length,
    reviewed: unseen.filter(i => i.review_status === 'reviewed').length,
    seen: seen.size,
  }
}

export async function createBlueprintAndForm(userId: string, input: BlueprintInput): Promise<BlueprintResult> {
  const admin = createAdminClient()

  // 1. The manifest must exist and be able to back a blueprint.
  const { data: manifest, error: manifestErr } = await admin
    .from('curriculum_manifests')
    .select('id, is_active, capabilities')
    .eq('id', input.manifestId)
    .maybeSingle()

  if (manifestErr) throw new AssemblyError(`Could not read the curriculum manifest: ${manifestErr.message}`, 'MANIFEST_READ_FAILED')
  if (!manifest) throw new AssemblyError('That curriculum manifest does not exist.', 'MANIFEST_NOT_FOUND')
  if (!manifest.is_active) throw new AssemblyError('That curriculum manifest is not active.', 'MANIFEST_INACTIVE')
  if (!(manifest.capabilities as any)?.blueprint_available) {
    throw new AssemblyError('This curriculum is not yet ready to generate diagnostics.', 'BLUEPRINT_UNAVAILABLE')
  }

  // 2. Resolve the concept scope.
  let conceptQuery = admin.from('curriculum_concepts').select('id').eq('manifest_id', input.manifestId)
  if (input.requestedScope.topic) conceptQuery = conceptQuery.eq('topic', input.requestedScope.topic)
  if (input.requestedScope.modules?.length) conceptQuery = conceptQuery.in('lm_id', input.requestedScope.modules)
  if (input.requestedScope.concepts?.length) conceptQuery = conceptQuery.in('id', input.requestedScope.concepts)

  const { data: concepts, error: conceptErr } = await conceptQuery
  if (conceptErr) throw new AssemblyError(`Could not read the curriculum: ${conceptErr.message}`, 'CONCEPT_READ_FAILED')
  if (!concepts || concepts.length === 0) {
    throw new AssemblyError('No curriculum concepts match that scope.', 'NO_CONCEPTS')
  }
  const conceptIds = concepts.map(c => c.id as string)

  // 3. Candidate items: right trust tier, in scope, and not already seen.
  const tiers = allowedTiers(input.purpose)
  const { data: seenRows } = await admin.from('assessment_responses').select('item_id').eq('user_id', userId)
  const seen = new Set((seenRows ?? []).map(r => r.item_id as string))

  let itemQuery = admin
    .from('assessment_items')
    .select('id, concept_id, intended_difficulty, cognition')
    .in('concept_id', conceptIds)
    .in('review_status', tiers)
  if (input.requestedScope.modules?.length) itemQuery = itemQuery.in('lm_id', input.requestedScope.modules)

  const { data: allItems, error: itemErr } = await itemQuery
  if (itemErr) throw new AssemblyError(`Could not read the item bank: ${itemErr.message}`, 'ITEM_READ_FAILED')

  const unseen = (allItems ?? []).filter(i => !seen.has(i.id as string)) as CandidateItem[]

  // No assessment of any kind exceeds the shared ceiling (90), however it was requested.
  const requested = clampQuestions(input.constraints.maxQuestions ?? PURPOSE_LENGTHS[input.purpose])
  // A minimum below which the result would not be worth reporting (§4.1).
  const minimum = Math.min(5, requested)

  if (unseen.length < minimum) {
    const tierNote = tiers.length === 1
      ? ' This assessment moves your readiness, so it can only use items that have been reviewed by hand.'
      : ''
    throw new AssemblyError(
      `Not enough unseen questions to assemble this. ${unseen.length} available, ${minimum} needed.${tierNote}`,
      'INSUFFICIENT_ITEMS'
    )
  }

  const selected = selectBalanced(unseen, Math.min(requested, unseen.length))

  // 4. Record the blueprint, then the form it produced.
  const { data: blueprint, error: bpErr } = await admin
    .from('assessment_blueprints')
    .insert({
      manifest_id: input.manifestId,
      purpose: input.purpose,
      requested_scope: input.requestedScope,
      constraints: { ...input.constraints, resolvedLength: selected.length, allowedTiers: tiers },
    })
    .select('id')
    .single()
  if (bpErr || !blueprint) throw new AssemblyError(`Could not record the blueprint: ${bpErr?.message}`, 'BLUEPRINT_INSERT_FAILED')

  const { data: form, error: formErr } = await admin
    .from('assessment_forms')
    .insert({ blueprint_id: blueprint.id, delivery_mode: 'fixed' })
    .select('id')
    .single()
  if (formErr || !form) throw new AssemblyError(`Could not record the form: ${formErr?.message}`, 'FORM_INSERT_FAILED')

  const { error: formItemsErr } = await admin.from('form_items').insert(
    selected.map((item, index) => ({ form_id: form.id, item_id: item.id, sequence_number: index + 1 }))
  )
  if (formItemsErr) throw new AssemblyError(`Could not record the form's questions: ${formItemsErr.message}`, 'FORM_ITEMS_INSERT_FAILED')

  return { blueprintId: blueprint.id, formId: form.id, itemCount: selected.length }
}
