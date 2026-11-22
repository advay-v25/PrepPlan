/**
 * Versioned prompt / schema roles. Bump a version when its text or contract changes; a batch snapshots all of them, and resuming never
 * upgrades them silently. The reviewer summary is deterministic code and can never approve (see reviewerSummary.ts).
 *   blueprint  - blueprintPlan.ts: deterministic planning from approved scope and demand (no model)
 *   writer     - generator.ts: grounded original item writing
 *   solver     - verifier.ts: blind solving; it never sees the key, the rationale or the generator's reasoning
 *   summary    - reviewerSummary.ts: blockers and derivations for a person; no model, no decision
 *   schema     - the draft JSON contract coerceDraft() enforces (draft.3: the item card also records the pack revision, edition, source reference and this package)
 *   checks     - deterministic gates in verifier.ts/formatRules.ts/authoringPackage.ts (checks.1 adds stem/option unit, collision and declared-input checks)
 */
export const PROMPT_VERSIONS = { blueprint: 'blueprint.2', writer: 'writer.3', solver: 'solver.2', summary: 'summary.2', schema: 'draft.3', checks: 'checks.1' } as const
