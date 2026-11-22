import { clampQuestions, WEEKLY_PAPER_SOFT_MAX_QUESTIONS } from '../tests/limits'
import { createAdminClient } from '../supabase/admin'
import { Difficulty } from './types'
import { EVIDENCE_TIERS } from './itemState'
import { loadEligibleItemPool, countFreshByReading } from '../tests/itemPool'

/**
 * Form assembly.
 *
 * Two rules govern what may appear on a form:
 *
 *  1. Trust tier. Every student assessment uses only human-reviewed items that are not held out (itemState.ts).
 *     Automatically checked items are candidates a reviewer can preview, never student content.
 *
 *  2. Exposure. An item the learner has already answered is not evidence of
 *     anything the second time. Seen items are excluded per learner.
 */

export type AssessmentPurpose = 'weekly_cumulative' | 'module_diagnostic' | 'repair_recheck' | 'concept_check'

/** Every student assessment uses human-reviewed items only; automatically checked items are reviewer-preview content (itemState.ts). */
export function allowedTiers(_purpose?: AssessmentPurpose): string[] {
  return EVIDENCE_TIERS
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
  _manifestId: string,
  scope: { modules?: string[] } = {}
): Promise<{ reviewed: number; seen: number }> {
  const admin = createAdminClient()
  const [{ count }, counts] = await Promise.all([
    admin.from('assessment_responses').select('item_id', { count: 'exact', head: true }).eq('user_id', userId),
    countFreshByReading(userId, scope.modules?.length ? scope.modules : undefined),
  ])
  return { reviewed: [...counts.values()].reduce((s, n) => s + n, 0), seen: count ?? 0 }
}

/**
 * Chooses the questions for a module / concept-scoped paper from the shared eligible pool (approved exact version, fresh item and
 * family, one question per family). Writes nothing: `reserveAttempt` (tests/reserve.ts) re-validates and creates the paper atomically.
 */
export async function selectModuleItems(userId: string, input: BlueprintInput): Promise<{ itemIds: string[]; requested: number; manifestId: string }> {
  const admin = createAdminClient()
  const { data: manifest, error: manifestErr } = await admin.from('curriculum_manifests').select('id, is_active, capabilities').eq('id', input.manifestId).maybeSingle()
  if (manifestErr) throw new AssemblyError(`Could not read the curriculum manifest: ${manifestErr.message}`, 'MANIFEST_READ_FAILED')
  if (!manifest) throw new AssemblyError('That curriculum manifest does not exist.', 'MANIFEST_NOT_FOUND')
  if (!manifest.is_active) throw new AssemblyError('That curriculum manifest is not active.', 'MANIFEST_INACTIVE')
  if (!(manifest.capabilities as any)?.blueprint_available) throw new AssemblyError('This curriculum is not yet ready to generate diagnostics.', 'BLUEPRINT_UNAVAILABLE')

  let conceptQuery = admin.from('curriculum_concepts').select('id').eq('manifest_id', input.manifestId)
  if (input.requestedScope.topic) conceptQuery = conceptQuery.eq('topic', input.requestedScope.topic)
  if (input.requestedScope.modules?.length) conceptQuery = conceptQuery.in('lm_id', input.requestedScope.modules)
  if (input.requestedScope.concepts?.length) conceptQuery = conceptQuery.in('id', input.requestedScope.concepts)
  const { data: concepts, error: conceptErr } = await conceptQuery
  if (conceptErr) throw new AssemblyError(`Could not read the curriculum: ${conceptErr.message}`, 'CONCEPT_READ_FAILED')
  if (!concepts || concepts.length === 0) throw new AssemblyError('No curriculum concepts match that scope.', 'NO_CONCEPTS')
  const conceptIds = new Set(concepts.map(c => c.id as string))

  let readingIds = input.requestedScope.modules
  if (!readingIds?.length) readingIds = ((await admin.from('curriculum_readings').select('id').eq('is_active', true)).data ?? []).map(r => r.id as string)
  const unseen = (await loadEligibleItemPool(userId, readingIds)).filter(i => i.concept_id && conceptIds.has(i.concept_id)) as (CandidateItem & { family_id?: string | null })[]

  // No assessment of any kind exceeds the shared ceiling (90), however it was requested.
  const requested = clampQuestions(input.constraints.maxQuestions ?? PURPOSE_LENGTHS[input.purpose])
  const minimum = Math.min(5, requested)
  // One question per known family, so a reworded sibling never pads the paper.
  const families = new Set<string>()
  const distinct = unseen.filter(i => !i.family_id || (!families.has(i.family_id) && families.add(i.family_id)))
  if (distinct.length < minimum) {
    throw new AssemblyError(`Not enough fresh human-reviewed questions to assemble this. ${distinct.length} available, ${minimum} needed. Nothing was started.`, 'INSUFFICIENT_ITEMS')
  }
  const selected = selectBalanced(distinct, Math.min(requested, distinct.length))
  return { itemIds: selected.map(i => i.id), requested, manifestId: input.manifestId }
}
