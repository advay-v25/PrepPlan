import { STALE_DAYS } from '../curriculum/confidence'

/**
 * difficulty-policy.1 — ONE deterministic, rules-based definition consumed by preview, reservation, results and adaptive practice.
 * Not IRT, not CAT, not a pass predictor. Authored difficulty is a reviewer-confirmed label (never an empirical calibration); the learner
 * evidence is first-exposure, human-approved, independent-family, scored observations. Every threshold below is a conservative BETA
 * operating rule, versioned here and recorded on each reserved form; none is a validated psychometric cutoff.
 */
export const DIFFICULTY_POLICY = 'difficulty-policy.1'
/** Interpretation patch recorded beside the policy on every form made after it: scope-before-cap evidence and the post-change-paper hold. Forms without it used the earlier reading. */
export const POLICY_PATCH = 'scope-cap-hold.1'
export type Level = 'foundation' | 'standard' | 'difficult' | 'stretch'
export type Profile = 'support' | 'balanced' | 'challenge'
export type Confidence = 'low' | 'medium' | 'high' | null
export const PROFILES: Profile[] = ['support', 'balanced', 'challenge']
export const PROFILE_LABEL: Record<Profile, string> = { support: 'Foundation support', balanced: 'Balanced', challenge: 'Application challenge' }
/** Provisional engineering defaults, NOT official exam difficulty distributions. Stretch is excluded from ordinary papers. */
export const PROFILE_MIX: Record<Profile, Record<'foundation' | 'standard' | 'difficult', number>> = {
  balanced: { foundation: 0.25, standard: 0.5, difficult: 0.25 },
  support: { foundation: 0.5, standard: 0.5, difficult: 0 },
  challenge: { foundation: 0, standard: 0.5, difficult: 0.5 },
}
export const MIX_LEVELS = ['foundation', 'standard', 'difficult'] as const

export const CONFIG = {
  /** The shared recency boundary; never a second freshness constant. */
  windowDays: STALE_DAYS,
  minObservations: 8, minAttempts: 2, maxObservations: 20, newest: 3,
  challengeCorrect: 0.8, challengeStandardSuccesses: 2,
  supportCorrect: 0.5, supportMissAttempts: 2,
  /** Completed relevant attempts required after a profile change before the next change. */
  attemptsBetweenChanges: 2,
  readingMinOutcomes: 2,
  practice: { setSize: 5, caps: [10, 20] as const, defaultCap: 10, raiseCorrect: 0.8, raiseStandardSuccesses: 2, raiseMismatchLimit: 2, lowerAnswered: 4, lowerCorrect: 0.5, setsBetweenChanges: 2 },
} as const

export type Observation = {
  id: string; familyId: string; attemptId: string; at: string; correct: boolean; confidence: Confidence
  level: Level; outcomeId: string; readingId: string
}
const cmp = (a: Observation, b: Observation) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1) // newest first, id as the deterministic tie-break

/** One independent observation per family (the FIRST exposure), newest-first, inside the window. The cap is applied per sample (scope, then reading), never here. */
export function independentObservations(all: Observation[], now: Date): { used: Observation[]; cutoff: string } {
  const cutoff = new Date(now.getTime() - CONFIG.windowDays * 86_400_000).toISOString()
  const first = new Map<string, Observation>()
  for (const o of [...all].sort((a, b) => -cmp(a, b))) if (!first.has(o.familyId)) first.set(o.familyId, o)   // earliest exposure wins; a later familiar success never replaces a first miss
  const used = [...first.values()].filter(o => o.at >= cutoff).sort(cmp)
  return { used, cutoff }
}

const adequate = (o: Observation[]) => o.length >= CONFIG.minObservations && new Set(o.map(x => x.attemptId)).size >= CONFIG.minAttempts

export type ScopeEvidence = { proposed: Profile; basis: 'scope' | 'reading' | 'limited'; n: number; attempts: number; reasons: string[] }

/** The profile the evidence supports for ONE observation set (before the one-step and anti-oscillation rules). */
export function evidenceProfile(obs: Observation[]): { proposed: Profile; reasons: string[] } {
  const n = obs.length, correct = obs.filter(o => o.correct).length, rate = n ? correct / n : 0
  const newest = obs.slice(0, CONFIG.newest)
  const confidentMiss = newest.some(o => !o.correct && o.confidence === 'high')
  const unsure = newest.filter(o => o.correct && (o.confidence === 'low' || o.confidence === 'medium')).length >= 2
  const standardWins = obs.filter(o => o.correct && o.level === 'standard' && o.confidence === 'high').length
  const standardMissAttempts = new Set(obs.filter(o => !o.correct && o.level === 'standard').map(o => o.attemptId)).size
  const pct = `${Math.round(rate * 100)}% of ${n}`
  if (rate >= CONFIG.challengeCorrect && standardWins >= CONFIG.challengeStandardSuccesses && !confidentMiss && !unsure)
    return { proposed: 'challenge', reasons: [`${pct} independent questions correct, with ${standardWins} confident standard-level successes.`] }
  if (rate <= CONFIG.supportCorrect && standardMissAttempts >= CONFIG.supportMissAttempts)
    return { proposed: 'support', reasons: [`${pct} independent questions correct, with standard-level misses in ${standardMissAttempts} papers.`] }
  const why = rate >= CONFIG.challengeCorrect
    ? (confidentMiss ? 'a recent confident miss still needs repair' : unsure ? 'recent correct answers were unsure, so an independent check comes first' : 'fewer than two confident standard-level successes')
    : 'results are mixed'
  return { proposed: 'balanced', reasons: [`${pct} correct; staying balanced because ${why}.`] }
}

export type ProfileHistory = { profile: Profile; at: string; id?: string }[]   // earlier scored forms for this reading, oldest first

/** Per-reading decision: scope evidence first, then (labelled) wider reading evidence, else the cold-start Balanced profile. */
export function decideReadingProfile(args: { paperOutcomeIds: string[]; readingObs: Observation[]; history?: ProfileHistory; now: Date }): ScopeEvidence & { cutoff: string; held: boolean } {
  const { used: all, cutoff } = independentObservations(args.readingObs, args.now)
  // Scope is selected BEFORE its own twenty-observation cap, so newer evidence on other outcomes cannot erase valid narrow history.
  const inScope = all.filter(o => args.paperOutcomeIds.includes(o.outcomeId)).slice(0, CONFIG.maxObservations)
  const used = all.slice(0, CONFIG.maxObservations)
  let basis: ScopeEvidence['basis'] = 'limited', pool: Observation[] = []
  if (adequate(inScope)) { basis = 'scope'; pool = inScope }
  else if (adequate(used) && new Set(used.map(o => o.outcomeId)).size >= CONFIG.readingMinOutcomes) { basis = 'reading'; pool = used }
  if (basis === 'limited') {
    const have = inScope.length
    return { proposed: 'balanced', basis, n: have, attempts: new Set(inScope.map(o => o.attemptId)).size, cutoff, held: false,
      reasons: [`Not enough recent independent evidence yet (${have} of ${CONFIG.minObservations} questions across ${CONFIG.minAttempts} papers), so this paper stays balanced.`] }
  }
  const ev = evidenceProfile(pool)
  // Chronological with a deterministic tie-break; an unrecorded start is Balanced, so a first recorded non-Balanced paper IS a change paper.
  const h = [...(args.history ?? [])].sort((a, b) => a.at.localeCompare(b.at) || (a.id ?? '').localeCompare(b.id ?? ''))
  const prior = h.length ? h[h.length - 1].profile : 'balanced'
  const step = (from: Profile, to: Profile): Profile => PROFILES[PROFILES.indexOf(from) + Math.sign(PROFILES.indexOf(to) - PROFILES.indexOf(from))] ?? from
  let next = step(prior, ev.proposed), held = false
  if (next !== prior) {
    // Hold until two papers have COMPLETED AFTER the paper that introduced the current profile (the change paper itself does not count).
    const seq = [{ profile: 'balanced' as Profile }, ...h]
    let since = 0, changed = false
    for (let i = seq.length - 1; i > 0; i--) { if (seq[i].profile !== seq[i - 1].profile) { changed = true; break } since++ }
    if (changed && since < CONFIG.attemptsBetweenChanges) { next = prior; held = true }
  }
  const reasons = [...ev.reasons, ...(next !== ev.proposed && !held ? ['The profile moves one step at a time.'] : []), ...(held ? [`Held at ${PROFILE_LABEL[prior]}: the profile changed recently and needs ${CONFIG.attemptsBetweenChanges} newly completed papers before changing again.`] : [])]
  if (basis === 'reading') reasons.unshift('Broader context: no scope-specific history yet, so this uses your recent results across this reading.')
  return { proposed: next, basis, n: pool.length, attempts: new Set(pool.map(o => o.attemptId)).size, cutoff, held, reasons }
}

/** Largest-remainder apportionment to an integer total; deterministic (ties go to the earlier slot). */
export function apportion(total: number, shares: number[]): number[] {
  const sum = shares.reduce((a, b) => a + b, 0)
  if (!Number.isInteger(total) || total < 0 || !(sum > 0)) return shares.map(() => 0)
  const exact = shares.map(s => (s / sum) * total), out = exact.map(Math.floor)
  let left = total - out.reduce((a, b) => a + b, 0)
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) { if (left <= 0) break; if (shares[i] > 0) { out[i]++; left-- } }
  return out
}

export type MixTarget = { fractional: Record<'foundation' | 'standard' | 'difficult', number>; counts: Record<'foundation' | 'standard' | 'difficult', number> }
/** Paper-level target from per-reading profiles: each reading's questions use its own profile; the sum is apportioned to the real size. */
export function targetMix(parts: { questions: number; profile: Profile }[]): MixTarget {
  const total = parts.reduce((n, p) => n + p.questions, 0)
  const frac = { foundation: 0, standard: 0, difficult: 0 }
  for (const p of parts) for (const l of MIX_LEVELS) frac[l] += p.questions * PROFILE_MIX[p.profile][l]
  const c = apportion(total, MIX_LEVELS.map(l => frac[l]))
  return { fractional: frac, counts: { foundation: c[0], standard: c[1], difficult: c[2] } }
}

/** Seeded PRNG so a refreshed preview and its reservation make the same choices. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19) }
  let a = h >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Adaptive practice: a practice-only decision path over fixed five-question sets. Never feeds the evidence ledger.
export type PracticeSet = {
  size: number; answered: number; correct: number
  /** Independent (first-exposure, distinct-family) standard-level correct answers. */
  standardCorrect: number
  /** Confident-wrong plus unsure-right answers. */
  mismatches: number
}
export type PracticeDelivered = { itemId: string; outcomeId: string | null; familyId: string | null; level: string | null }
export type PracticeAnswer = { correct: boolean; confidence: Confidence }
/**
 * Stats for ONE scored practice set from the same validity rules as results: voided and disputed questions are excluded once, a question outside the
 * scope being planned is not evidence for it, and a family already counted (an earlier set, or earlier evidence) is not an independent exposure.
 * Excluded questions shrink the sample; they are never treated as wrong, and a reduced sample can never satisfy the "full set" advancement rule.
 */
export function practiceSetStats(a: { delivered: PracticeDelivered[]; answers: Map<string, PracticeAnswer>; excluded: Set<string>; relevant?: Set<string>; seen?: Set<string>; familiar?: Set<string> }): PracticeSet & { inScope: number; outOfScope: number } {
  let answered = 0, correct = 0, standardCorrect = 0, mismatches = 0, inScope = 0, outOfScope = 0
  for (const d of a.delivered) {
    if (a.excluded.has(d.itemId)) continue
    if (a.relevant && !(d.outcomeId && a.relevant.has(d.outcomeId))) { outOfScope++; continue }
    inScope++
    const r = a.answers.get(d.itemId)
    if (!r) continue
    if (d.familyId && (a.seen?.has(d.familyId) || a.familiar?.has(d.familyId))) continue
    if (d.familyId) a.seen?.add(d.familyId)
    answered++
    if (r.correct) correct++
    if ((r.correct && r.confidence === 'low') || (!r.correct && r.confidence === 'high')) mismatches++
    if (r.correct && d.level === 'standard' && d.familyId) standardCorrect++
  }
  return { size: CONFIG.practice.setSize, answered, correct, standardCorrect, mismatches, inScope, outOfScope }
}
export type PracticeStep = { profile: Profile; changed: 'up' | 'down' | null; reasons: string[] }

/** Replay consecutive scored sets (oldest first) from the base profile. Returns the profile for the NEXT set and why. */
export function practiceProfile(base: Profile, sets: PracticeSet[]): PracticeStep {
  const P = CONFIG.practice
  let profile = base, since = 0, lastChange: PracticeStep['changed'] = null
  let reasons = [sets.length ? 'Waiting for two completed sets before adjusting.' : base === 'balanced' ? 'Starting balanced: there is not enough recent independent evidence for this scope.' : `Starting at ${PROFILE_LABEL[base]} from your recent results on this scope.`]
  for (let i = 0; i < sets.length; i++) {
    since++; lastChange = null
    if (i === 0 || since < P.setsBetweenChanges) continue
    const a = sets[i - 1], b = sets[i]
    const full = (s: PracticeSet) => s.answered === s.size
    const acc = (s: PracticeSet) => (s.answered ? s.correct / s.answered : 0)
    if (full(a) && full(b) && acc(a) >= P.raiseCorrect && acc(b) >= P.raiseCorrect) {
      if (a.standardCorrect + b.standardCorrect < P.raiseStandardSuccesses) { reasons = ['Two strong sets, but not enough independent standard-level questions in them to move up.']; continue }
      if (a.mismatches + b.mismatches >= P.raiseMismatchLimit) { reasons = ['Two strong sets, but several answers were unsure or confidently wrong, so a fresh independent check comes before harder questions.']; continue }
      if (profile !== 'challenge') { profile = PROFILES[PROFILES.indexOf(profile) + 1]; since = 0; lastChange = 'up'; reasons = ['Two full sets at or above 80%: the next set steps up one level.']; continue }
      reasons = ['Already at the hardest practice level.']; continue
    }
    if (a.answered >= P.lowerAnswered && b.answered >= P.lowerAnswered && acc(a) <= P.lowerCorrect && acc(b) <= P.lowerCorrect) {
      if (profile !== 'support') { profile = PROFILES[PROFILES.indexOf(profile) - 1]; since = 0; lastChange = 'down'; reasons = ['Two answered sets were difficult: the next set steps down one level to rebuild footing. This is about the questions, not about you.']; continue }
      reasons = ['Already at the most supportive practice level.']; continue
    }
    reasons = [sets.some(s => s.answered < s.size) ? 'Skipped or unanswered questions are not treated as wrong; keeping the current level.' : 'Mixed results: keeping the current level.']
  }
  return { profile, changed: lastChange, reasons }
}
