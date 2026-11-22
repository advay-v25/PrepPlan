/**
 * The scoring ledger (pure). One definition of "how did this paper go" for SQL-stored counts, results, sessions, mocks, Home and history.
 *
 * Policy "paper-score.1" counts over DELIVERED form items, not response rows:
 *   scoreable = delivered - voided;  correct / incorrect / omitted partition the scoreable items;
 *   paperScore = correct / scoreable;  answeredAccuracy = correct / (correct + incorrect);  completion = (correct + incorrect) / scoreable.
 * An omission earns no mark and is NOT evidence of a misconception. A dispute is not a void: the item stays scoreable and is flagged provisional.
 * Policy "1.0" (every form reserved before paper-score.1) scored answered items only; those results keep that label.
 * Round only for display: every ratio here is a fraction or null (null = no denominator, never zero).
 */
export const PAPER_SCORE_POLICY = 'paper-score.1'
export const LEGACY_SCORING_POLICY = '1.0'

/** Only these policies exist. Anything else is an explicit unsupported state, never silently read as legacy. */
export const SUPPORTED_POLICIES = [LEGACY_SCORING_POLICY, PAPER_SCORE_POLICY]
export const isSupportedPolicy = (p: string | null | undefined): boolean => SUPPORTED_POLICIES.includes(p ?? LEGACY_SCORING_POLICY)

export type LedgerResponse = { itemId: string; isCorrect: boolean | null }
export type Ledger = {
  policy: string
  delivered: number; voided: number; scoreable: number
  correct: number; incorrect: number; omitted: number
  /** Disputed items still count (provisionally) until an authorised resolution voids them. */
  provisional: number
  paperScore: number | null
  answeredAccuracy: number | null
  completion: number | null
}

export function buildLedger(input: { policy?: string | null; delivered: string[]; responses: LedgerResponse[]; voided?: Iterable<string>; disputed?: Iterable<string> }): Ledger {
  const policy = input.policy ?? LEGACY_SCORING_POLICY
  const delivered = new Set(input.delivered)
  const voidedSet = new Set([...(input.voided ?? [])].filter(id => delivered.has(id)))
  const disputed = new Set([...(input.disputed ?? [])].filter(id => delivered.has(id) && !voidedSet.has(id)))
  // The latest response per item wins; a response for an item that is not on the form is ignored, never added to the denominator.
  const answer = new Map<string, boolean | null>()
  for (const r of input.responses) if (delivered.has(r.itemId)) answer.set(r.itemId, r.isCorrect)
  let correct = 0, incorrect = 0
  for (const [id, ok] of answer) { if (voidedSet.has(id) || ok === null) continue; if (ok) correct++; else incorrect++ }
  const scoreable = delivered.size - voidedSet.size
  const omitted = scoreable - correct - incorrect
  const answered = correct + incorrect
  // Legacy forms were scored over answered items only, so their denominator stays what it always was.
  const legacy = policy !== PAPER_SCORE_POLICY
  return {
    policy, delivered: delivered.size, voided: voidedSet.size, scoreable, correct, incorrect, omitted, provisional: disputed.size,
    paperScore: legacy ? (answered ? correct / answered : null) : (scoreable ? correct / scoreable : null),
    answeredAccuracy: answered ? correct / answered : null,
    completion: scoreable ? answered / scoreable : null,
  }
}

/**
 * The same ledger from COUNTS (for a recap or card that has no per-item rows). Factual delivered / voided come from the reserved form and the
 * challenge rows, never from the stored legacy counts, which are answered-based by definition (see migration 20261214).
 */
export function ledgerFromCounts(i: { policy?: string | null; delivered: number; voided: number; correct: number; answered: number }): Ledger {
  const policy = i.policy ?? LEGACY_SCORING_POLICY
  const scoreable = Math.max(i.delivered - i.voided, 0), omitted = Math.max(scoreable - i.answered, 0)
  const legacy = policy !== PAPER_SCORE_POLICY
  return {
    policy, delivered: i.delivered, voided: i.voided, scoreable, correct: i.correct, incorrect: Math.max(i.answered - i.correct, 0), omitted, provisional: 0,
    paperScore: legacy ? (i.answered ? i.correct / i.answered : null) : (scoreable ? i.correct / scoreable : null),
    answeredAccuracy: i.answered ? i.correct / i.answered : null,
    completion: scoreable ? i.answered / scoreable : null,
  }
}

/** Combine ledgers by summing counts (never by averaging rounded percentages). Mixed policies are refused rather than blended. */
export function combineLedgers(ledgers: Ledger[]): Ledger | null {
  if (!ledgers.length) return null
  const policy = ledgers[0].policy
  if (ledgers.some(l => l.policy !== policy)) return null
  const sum = (k: 'delivered' | 'voided' | 'scoreable' | 'correct' | 'incorrect' | 'omitted' | 'provisional') => ledgers.reduce((n, l) => n + l[k], 0)
  const [delivered, voided, scoreable, correct, incorrect, omitted, provisional] = (['delivered', 'voided', 'scoreable', 'correct', 'incorrect', 'omitted', 'provisional'] as const).map(sum)
  const answered = correct + incorrect
  const legacy = policy !== PAPER_SCORE_POLICY
  return { policy, delivered, voided, scoreable, correct, incorrect, omitted, provisional, paperScore: legacy ? (answered ? correct / answered : null) : (scoreable ? correct / scoreable : null), answeredAccuracy: answered ? correct / answered : null, completion: scoreable ? answered / scoreable : null }
}
