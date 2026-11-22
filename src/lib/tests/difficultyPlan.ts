import { createHash } from 'node:crypto'
import { DIFFICULTY_POLICY, POLICY_PATCH, PROFILE_LABEL, decideReadingProfile, seededRandom, targetMix, type Profile } from './difficultyPolicy'
import { loadDifficultyEvidence, selectionSeed } from './difficultyEvidence'
import type { LevelCounts, Mix } from './assembly'
import type { PoolItem } from './itemPool'
import type { WeightedBlueprint } from './weightedBlueprint'

/** What a browser may see about the difficulty of a paper: reasons and counts, never item ids, keys or a selectable pool. */
export type DifficultySummary = {
  policy: string; patch: string; evidenceRevision: string; cutoff: string
  readings: { readingId: string; name: string; profile: Profile; label: string; basis: 'scope' | 'reading' | 'limited'; n: number; attempts: number; reasons: string[] }[]
  target: LevelCounts; fractional: LevelCounts
  actual: Mix | null; shortfall: LevelCounts | null
  limited: boolean
  /** One plain sentence for the card. */
  explanation: string
}
/** Server-only. */
export type DifficultyPlan = { seed: string; target: LevelCounts; evidenceVersion: string; summary: DifficultySummary }

const EXPLAIN: Record<Profile, string> = {
  balanced: 'A broad check with a balanced mix of foundation, standard and difficult questions.',
  support: 'A broad check, with extra foundation questions in the areas recently missed.',
  challenge: 'A broad check, with more difficult application questions where recent results are strong.',
}

export async function planDifficulty(userId: string, bp: Pick<WeightedBlueprint, 'perOutcome' | 'perReading'>, pool: PoolItem[], names: Map<string, string>, seedParts: (string | null)[], now: Date): Promise<DifficultyPlan> {
  const readingIds = bp.perReading.map(r => r.readingId)
  const ev = await loadDifficultyEvidence(userId, readingIds, now)   // the revision is read BEFORE the evidence it describes
  const parts = bp.perReading.map(r => {
    const d = decideReadingProfile({ paperOutcomeIds: bp.perOutcome.filter(o => o.readingId === r.readingId).map(o => o.outcomeId), readingObs: ev.byReading.get(r.readingId) ?? [], history: ev.history.get(r.readingId), now })
    return { r, d }
  })
  const mix = targetMix(parts.map(p => ({ questions: p.r.questions, profile: p.d.proposed })))
  const fingerprint = createHash('sha256').update(pool.map(i => `${i.id}:${i.item_version}:${i.level ?? ''}`).sort().join(',')).digest('hex')
  const seed = selectionSeed([userId, ...seedParts, ev.version, fingerprint])
  const limited = parts.every(p => p.d.basis === 'limited')
  const profiles = new Set(parts.map(p => p.d.proposed))   // a mixed paper is described as mixed, never by whichever reading happens to be last
  return {
    seed, target: mix.counts, evidenceVersion: ev.version,
    summary: {
      policy: DIFFICULTY_POLICY, patch: POLICY_PATCH, evidenceRevision: ev.version, cutoff: parts[0]?.d.cutoff ?? now.toISOString(),
      readings: parts.map(p => ({ readingId: p.r.readingId, name: names.get(p.r.readingId) ?? p.r.readingId, profile: p.d.proposed, label: PROFILE_LABEL[p.d.proposed], basis: p.d.basis, n: p.d.n, attempts: p.d.attempts, reasons: p.d.reasons })),
      target: mix.counts, fractional: mix.fractional, actual: null, shortfall: null, limited,
      explanation: limited ? 'A broad check with a balanced mix. There is not enough recent independent evidence yet to personalise it.' : profiles.size > 1 ? 'Adjusted by reading; open details for the differences.' : EXPLAIN[[...profiles][0] ?? 'balanced'],
    },
  }
}
export { seededRandom }
