import { WEEKLY_PAPER_SOFT_MAX_QUESTIONS } from '../../tests/limits'
import { createAdminClient } from '../../supabase/admin'
import { allowedTiers } from '../../diagnostic/blueprint'
import { countFreshByReading } from '../../tests/itemPool'

/**
 * Weekly paper planning (Decisions §3).
 *
 *  - new material only          -> diagnostic
 *  - revisited material only    -> revisionary
 *  - both                       -> mixed (separate sections, separate evidence semantics)
 *  - nothing the bank can test  -> no paper, with the reason
 *
 * A module is only part of a paper if the bank holds enough UNSEEN, quality-
 * controlled items scoped to that module. The check runs when the week is
 * planned and again when the attempt is reserved, so a paper is never offered
 * that cannot be assembled.
 */

export type PaperPurpose = 'diagnostic' | 'revisionary' | 'mixed'
export type SectionPurpose = 'diagnostic' | 'revisionary'
export type ModuleSize = 'small' | 'medium' | 'large'

/** effort_band 1-2 = small, 3 = medium, 4+ = large. */
export function moduleSize(effortBand: number): ModuleSize {
  return effortBand >= 4 ? 'large' : effortBand === 3 ? 'medium' : 'small'
}

/**
 * Minimum unseen items a module needs before it can appear in a paper. A
 * first-exposure check needs more items to say anything than a revisit of
 * material the student has already worked, and larger modules span more
 * concepts, so they need more.
 */
export const PAPER_MIN_ITEMS_PER_MODULE: Record<SectionPurpose, Record<ModuleSize, number>> = {
  diagnostic:  { small: 5, medium: 7, large: 9 },
  revisionary: { small: 3, medium: 5, large: 6 },
}

/** Target is 1.5x the minimum, so a paper has headroom to balance concepts. */
export const PAPER_TARGET_FACTOR = 1.5
/**
 * A paper smaller than this in total is not worth reporting — the same
 * floor the blueprint assembler already applies (createBlueprintAndForm:
 * "a minimum below which the result would not be worth reporting").
 */
/** The weekly paper is always a morning sitting; the rest of that day is for missed points. */
export const PAPER_START_TIME = '09:00'
export const PAPER_MIN_TOTAL_ITEMS = 5
/** Upper bound on a weekly paper's length (matches the weekly cumulative length). */
export const PAPER_MAX_TOTAL_ITEMS = WEEKLY_PAPER_SOFT_MAX_QUESTIONS
/** Minutes budgeted per item, and the bounds on a paper's sitting. */
export const PAPER_MINUTES_PER_ITEM = 1.5
export const PAPER_MIN_MINUTES = 30
export const PAPER_MAX_MINUTES = 120

/** Papers move demonstrated understanding, so they follow the readiness-moving tier policy. */
export const PAPER_ELIGIBLE_TIERS = allowedTiers('weekly_cumulative')

export type ModuleBank = { moduleId: string; effortBand: number; unseenEligible: number }

export type PaperSection = {
  purpose: SectionPurpose
  moduleIds: string[]
  minItems: number
  targetItems: number
}

export type SkippedModule = {
  moduleId: string
  purpose: SectionPurpose
  reason: 'insufficient_bank'
  available: number
  required: number
}

export type PaperPlan =
  | {
      kind: 'paper'
      purpose: PaperPurpose
      sections: PaperSection[]
      totalMinItems: number
      totalTargetItems: number
      estimatedMinutes: number
      skipped: SkippedModule[]
    }
  | { kind: 'none'; reason: 'no_scope' | 'insufficient_bank' | 'below_minimum_paper' | 'mock_chosen' | 'no_slot'; skipped: SkippedModule[] }

/** Pure: decide the paper from the week's scope and what the bank can support. */
export function classifyWeeklyPaper(input: {
  newModules: ModuleBank[]
  revisitedModules: ModuleBank[]
}): PaperPlan {
  const skipped: SkippedModule[] = []

  const section = (purpose: SectionPurpose, modules: ModuleBank[]): PaperSection | null => {
    const eligible: ModuleBank[] = []
    let minItems = 0
    for (const m of modules) {
      const required = PAPER_MIN_ITEMS_PER_MODULE[purpose][moduleSize(m.effortBand)]
      if (m.unseenEligible < required) {
        skipped.push({ moduleId: m.moduleId, purpose, reason: 'insufficient_bank', available: m.unseenEligible, required })
        continue
      }
      eligible.push(m)
      minItems += required
    }
    if (eligible.length === 0) return null
    return {
      purpose,
      moduleIds: eligible.map(m => m.moduleId),
      minItems,
      targetItems: Math.ceil(minItems * PAPER_TARGET_FACTOR),
    }
  }

  const sections = [section('diagnostic', input.newModules), section('revisionary', input.revisitedModules)]
    .filter((s): s is PaperSection => s !== null)

  if (sections.length === 0) {
    const hadScope = input.newModules.length + input.revisitedModules.length > 0
    return { kind: 'none', reason: hadScope ? 'insufficient_bank' : 'no_scope', skipped }
  }

  const totalMinItems = sections.reduce((s, x) => s + x.minItems, 0)
  if (totalMinItems < PAPER_MIN_TOTAL_ITEMS) return { kind: 'none', reason: 'below_minimum_paper', skipped }

  const totalTargetItems = Math.min(PAPER_MAX_TOTAL_ITEMS, sections.reduce((s, x) => s + x.targetItems, 0))
  const estimatedMinutes = Math.min(PAPER_MAX_MINUTES, Math.max(PAPER_MIN_MINUTES, Math.round(totalTargetItems * PAPER_MINUTES_PER_ITEM)))
  const purpose: PaperPurpose = sections.length === 2 ? 'mixed' : sections[0].purpose

  return { kind: 'paper', purpose, sections, totalMinItems, totalTargetItems, estimatedMinutes, skipped }
}

/** What is persisted on plan_blocks.assessment_scope so the reservation can re-check the same scope. */
export type PersistedPaperScope = {
  kind: 'weekly_paper'
  purpose: PaperPurpose
  sections: PaperSection[]
  totalMinItems: number
  totalTargetItems: number
  manifestId: string
  tiers: string[]
  checkedAt: string
}

export function toPersistedScope(plan: Extract<PaperPlan, { kind: 'paper' }>, manifestId: string, now = new Date()): PersistedPaperScope {
  return {
    kind: 'weekly_paper', purpose: plan.purpose, sections: plan.sections,
    totalMinItems: plan.totalMinItems, totalTargetItems: plan.totalTargetItems,
    manifestId, tiers: PAPER_ELIGIBLE_TIERS, checkedAt: now.toISOString(),
  }
}

export function paperTitle(purpose: PaperPurpose): string {
  return purpose === 'diagnostic' ? 'Weekly diagnostic paper'
    : purpose === 'revisionary' ? 'Weekly revisionary paper'
    : 'Weekly mixed paper (diagnostic + revisionary)'
}

export function isPersistedPaperScope(v: unknown): v is PersistedPaperScope {
  const s = v as PersistedPaperScope | null
  return !!s && s.kind === 'weekly_paper' && Array.isArray(s.sections) && typeof s.manifestId === 'string'
}

// ---------------------------------------------------------------------------
// Database-backed
// ---------------------------------------------------------------------------

/** The manifest papers are assembled from: the active one that can build blueprints. */
export async function getPaperManifestId(): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin.from('curriculum_manifests').select('id, capabilities').eq('is_active', true).throwOnError()
  const usable = (data ?? []).find(m => (m.capabilities as any)?.blueprint_available)
  return (usable?.id as string | undefined) ?? null
}

/** Fresh, eligible questions per module — a thin view over the shared pool, so planning and reservation cannot disagree. */
export async function countUnseenEligibleByModule(
  userId: string, _manifestId: string, moduleIds: string[], _tiers: string[] = PAPER_ELIGIBLE_TIERS
): Promise<Map<string, number>> {
  return moduleIds.length ? countFreshByReading(userId, moduleIds) : new Map()
}

async function effortBands(moduleIds: string[]): Promise<Map<string, number>> {
  const admin = createAdminClient()
  const { data } = await admin.from('learning_modules').select('id, effort_band').in('id', moduleIds)
  return new Map((data ?? []).map(m => [m.id as string, (m.effort_band ?? 3) as number]))
}

/** Plan the week's paper from its scope, checking the bank. */
export async function planWeeklyPaper(
  userId: string, scope: { newModuleIds: string[]; revisitedModuleIds: string[] }
): Promise<{ plan: PaperPlan; manifestId: string | null }> {
  const all = [...new Set([...scope.newModuleIds, ...scope.revisitedModuleIds])]
  if (all.length === 0) return { plan: { kind: 'none', reason: 'no_scope', skipped: [] }, manifestId: null }

  const manifestId = await getPaperManifestId()
  if (!manifestId) {
    const skipped = all.map(moduleId => ({ moduleId, purpose: 'diagnostic' as SectionPurpose, reason: 'insufficient_bank' as const, available: 0, required: 0 }))
    return { plan: { kind: 'none', reason: 'insufficient_bank', skipped }, manifestId: null }
  }

  const [counts, bands] = await Promise.all([countUnseenEligibleByModule(userId, manifestId, all), effortBands(all)])
  const bank = (id: string): ModuleBank => ({ moduleId: id, effortBand: bands.get(id) ?? 3, unseenEligible: counts.get(id) ?? 0 })
  // A module that is both new and revisited counts once, as new.
  const newIds = new Set(scope.newModuleIds)
  return {
    plan: classifyWeeklyPaper({
      newModules: scope.newModuleIds.map(bank),
      revisitedModules: scope.revisitedModuleIds.filter(id => !newIds.has(id)).map(bank),
    }),
    manifestId,
  }
}

/** Re-check a persisted paper scope against the bank now (used when reserving the attempt). */
export async function recheckPersistedPaper(
  userId: string, scope: PersistedPaperScope
): Promise<{ ok: true; moduleIds: string[]; targetItems: number } | { ok: false; reason: string }> {
  const sectionModules = scope.sections.flatMap(s => s.moduleIds.map(id => ({ id, purpose: s.purpose })))
  const ids = [...new Set(sectionModules.map(m => m.id))]
  const [counts, bands] = await Promise.all([
    countUnseenEligibleByModule(userId, scope.manifestId, ids, scope.tiers), effortBands(ids),
  ])
  const bank = (id: string) => ({ moduleId: id, effortBand: bands.get(id) ?? 3, unseenEligible: counts.get(id) ?? 0 })
  const current = classifyWeeklyPaper({
    newModules: scope.sections.filter(s => s.purpose === 'diagnostic').flatMap(s => s.moduleIds).map(bank),
    revisitedModules: scope.sections.filter(s => s.purpose === 'revisionary').flatMap(s => s.moduleIds).map(bank),
  })
  if (current.kind === 'none') return { ok: false, reason: 'The question bank no longer has enough unseen questions for this paper.' }
  // Every module the paper was scheduled with must still be supported.
  if (current.skipped.length > 0) return { ok: false, reason: 'Part of this paper can no longer be assembled from unseen questions.' }
  return { ok: true, moduleIds: ids, targetItems: current.totalTargetItems }
}
