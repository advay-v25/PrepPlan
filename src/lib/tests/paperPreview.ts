import { createAdminClient } from '../supabase/admin'
import { countUnseenEligibleByModule, getPaperManifestId } from '../planning/pulse/paper'
import { getCompletedCycleScope } from './completedScopeService'
import { allocateWeighted, type WeightedBlueprint } from './weightedBlueprint'
import type { CompletedCycleScope, ScopeKind } from './completedScope'

export type PaperKind = 'diagnostic' | 'revisionary' | 'mixed'
const KINDS: Record<PaperKind, ScopeKind[]> = { diagnostic: ['new'], revisionary: ['revision'], mixed: ['new', 'revision'] }

export type PaperPreview = {
  paperKind: PaperKind
  scope: CompletedCycleScope
  blueprint: WeightedBlueprint
  /** Completed-scope readings the bank cannot yet fully serve, and why the paper may be narrower than the scope. */
  limitation: string | null
  /** Why there is no weekly paper, when there is not. */
  noPaperReason: string | null
}

/** Read-only: the paper the student's completed scope would produce right now. */
export async function getPaperPreview(userId: string, requested?: PaperKind, now = new Date()): Promise<PaperPreview> {
  const admin = createAdminClient()
  const scope = await getCompletedCycleScope(userId, now)
  const newCount = scope.totals.newOutcomes, revCount = scope.totals.revisionOutcomes
  const paperKind: PaperKind = requested ?? (newCount > 0 && revCount > 0 ? 'mixed' : revCount > 0 ? 'revisionary' : 'diagnostic')

  const { data: topics } = await admin.from('topics').select('id, exam_weight_min, exam_weight_max')
  const subjects = (topics ?? []).map(t => ({ id: t.id as string, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) }))

  const manifestId = await getPaperManifestId()
  const readingIds = scope.readings.map(r => r.readingId)
  const bank = manifestId && readingIds.length ? await countUnseenEligibleByModule(userId, manifestId, readingIds) : new Map<string, number>()
  const blueprint = allocateWeighted({ scope, subjects, kinds: KINDS[paperKind], bankCountByReading: bank })

  let noPaperReason: string | null = null
  if (scope.totals.outcomes === 0) {
    noPaperReason = scope.unresolved.length > 0
      ? 'You have completed work that is not yet tied to specific outcomes. Confirm what each block covered and it can be tested.'
      : 'Nothing has been completed and mapped to the curriculum this cycle, so there is no weekly paper. Complete a block or log a class and it will appear here.'
  } else if (blueprint.totalQuestions === 0) {
    noPaperReason = `A ${paperKind} paper has no completed material of that kind this cycle.`
  }
  const short = blueprint.bankShortfalls
  const { data: rn } = short.length ? await admin.from('curriculum_readings').select('id, reading_no').in('id', short.map(x => x.readingId)) : { data: [] as any[] }
  const nameOf = new Map((rn ?? []).map(r => [r.id as string, `Reading ${r.reading_no}`]))
  const limitation = short.length
    ? `The question bank cannot yet fully cover ${short.length} completed reading${short.length === 1 ? '' : 's'} (${short.map(s => `${nameOf.get(s.readingId) ?? s.readingId}: ${s.available} of ${s.wanted} questions available`).join('; ')}). It will not be silently narrowed — the gap is carried as a follow-up.`
    : null
  return { paperKind, scope, blueprint, limitation, noPaperReason }
}
