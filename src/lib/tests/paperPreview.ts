import { createAdminClient } from '../supabase/admin'
import { loadEligibleItemPool } from './itemPool'
import { assembleEligiblePool } from './assembly'
import { getCompletedCycleScope } from './completedScopeService'
import { allocateWeighted, type WeightedBlueprint } from './weightedBlueprint'
import type { CompletedCycleScope, ScopeKind } from './completedScope'
import { topicWeightRows } from '../curriculum/referenceReads'

export type PaperKind = 'diagnostic' | 'revisionary' | 'mixed'
export const PAPER_SCOPE_KINDS: Record<PaperKind, ScopeKind[]> = { diagnostic: ['new'], revisionary: ['revision'], mixed: ['new', 'revision'] }

export type PaperPreview = {
  paperKind: PaperKind
  scope: CompletedCycleScope
  blueprint: WeightedBlueprint
  /** Completed-scope readings the bank cannot yet fully serve, and why the paper may be narrower than the scope. */
  limitation: string | null
  /** Why there is no weekly paper, when there is not. */
  noPaperReason: string | null
}

/** One rule for which paper the completed scope produces: new only, revisited only, or both. */
export function choosePaperKind(newCount: number, revisionCount: number, requested?: PaperKind): PaperKind {
  return requested ?? (newCount > 0 && revisionCount > 0 ? 'mixed' : revisionCount > 0 ? 'revisionary' : 'diagnostic')
}

/** Read-only: the paper the student's completed scope would produce right now. */
export async function getPaperPreview(userId: string, requested?: PaperKind, now = new Date(), exclude?: Set<string>): Promise<PaperPreview> {
  const admin = createAdminClient()
  const full = await getCompletedCycleScope(userId, now)
  // A further paper (part 2+) starts from the confirmed outcomes earlier papers did not ask.
  const scope = exclude?.size ? { ...full, targets: full.targets.filter(t => !exclude.has(t.outcomeId)) } : full
  const newCount = scope.targets.filter(t => t.kind === 'new').length, revCount = scope.targets.filter(t => t.kind === 'revision').length
  const paperKind = choosePaperKind(newCount, revCount, requested)

  const topics = await topicWeightRows()
  const subjects = (topics ?? []).map(t => ({ id: t.id as string, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) }))

  const blueprint = allocateWeighted({ scope, subjects, kinds: PAPER_SCOPE_KINDS[paperKind] })
  const pool = await loadEligibleItemPool(userId, blueprint.perReading.map(r => r.readingId), 'weekly_cumulative')
  const available = assembleEligiblePool(blueprint, pool, () => 0.5)
  blueprint.bankShortfalls = available.shortfalls.map(r => ({ readingId: r.readingId, wanted: r.wanted, available: r.delivered }))

  let noPaperReason: string | null = null
  if (scope.targets.length === 0 && !exclude?.size) {
    noPaperReason = scope.unresolved.length > 0
      ? 'You have completed work that is not yet tied to specific outcomes. Confirm what each block covered and it can be tested.'
      : 'Nothing has been completed and mapped to the curriculum this cycle, so there is no weekly paper. Complete a block or log a class and it will appear here.'
  } else if (blueprint.totalQuestions === 0 && !exclude?.size) {
    noPaperReason = `A ${paperKind} paper has no completed material of that kind this cycle.`
  }
  const short = blueprint.bankShortfalls
  const { data: rn } = short.length ? await admin.from('curriculum_readings').select('id, reading_no').in('id', short.map(x => x.readingId)) : { data: [] as any[] }
  const nameOf = new Map((rn ?? []).map(r => [r.id as string, `Reading ${r.reading_no}`]))
  const limitation = short.length
    ? `The question bank cannot yet fully cover ${short.length} completed reading${short.length === 1 ? '' : 's'} (${short.map(s => `${nameOf.get(s.readingId) ?? s.readingId}: ${s.available} of ${s.wanted} questions available`).join('; ')}). Only confirmed outcomes can be used; anything not sampled remains untested.`
    : null
  return { paperKind, scope, blueprint, limitation, noPaperReason }
}
