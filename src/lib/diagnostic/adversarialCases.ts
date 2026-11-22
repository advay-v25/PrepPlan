import type { GeneratedItemDraft } from './types'

/**
 * Reusable, labelled evaluation cases. Each names the failure it embodies and the gate or code that MUST catch it, so a change to a prompt, a
 * model or a check can be re-evaluated against the same set. `decidedBy: 'offline'` cases need no model: a fatal one stops before any model call; a non-fatal one is asserted on the deterministic stem/option check alone. `decidedBy: 'solver'` cases carry the
 * verdict a competent blind solver would return; run against a CONTROLLED provider they prove the pipeline maps that verdict to the right gate
 * and status. They do NOT measure a real model's judgement - `npm run authoring:eval:test -- --online` is the (unexecuted) place to do that.
 * All content is synthetic.
 */
export type AdversarialKind = 'control' | 'qualitative_ambiguity' | 'two_defensible_keys' | 'missing_assumption' | 'wrong_formula' | 'wrong_input' | 'wrong_unit'
  | 'rounding_collision' | 'unsupported_scope' | 'stale_edition' | 'prompt_injection' | 'near_duplicate_family' | 'unsupported_combination' | 'banned_format'

export type SolverScript = { editorial: Record<string, unknown>; numeric?: Record<string, unknown>; distractors?: Record<string, unknown> }
export type AdversarialCase = {
  id: string; kind: AdversarialKind; why: string
  draft: Pick<GeneratedItemDraft, 'stem' | 'options' | 'keyIndex'> & { isNumeric: boolean; exactNumericValues: Record<string, number> }
  decidedBy: 'offline' | 'solver'
  /** Verifier status that must result. */
  expectStatus: 'PASS' | 'REVISE' | 'VOID' | 'HUMAN_REVIEW'
  /** A defect code that MUST be present (null for the control). */
  expectDefect: string | null
  solver?: SolverScript
}

const ed = (answerIndex: number, o: Record<string, unknown> = {}) => ({ answerIndex, answerReasoning: 'scripted', inScope: true, scopeDetail: 'in scope', uniqueAnswer: true, uniquenessDetail: 'one answer', languageOk: true, languageDetail: 'fine', confidence: 'high', ...o })
const GP = { stem: 'A synthetic retailer reports revenue of 500000 and cost of goods sold of 320000 for the year. Gross profit is closest to:', options: ['180,000', '320,000', '500,000'], keyIndex: 0, isNumeric: true, exactNumericValues: { revenue: 500000, cogs: 320000 } }
const RECOG = { stem: 'A synthetic company ships a widget on the last day of the year and control passes to the customer on shipment. Under a control-based recognition rule, revenue from the shipment is most likely recognised:', options: ['in the year of shipment', 'in the following year', 'when cash is collected'], keyIndex: 0, isNumeric: false, exactNumericValues: {} }

export const ADVERSARIAL_CASES: AdversarialCase[] = [
  { id: 'control-qualitative', kind: 'control', why: 'A sound item must not be rejected: the set is not vacuous.', draft: RECOG, decidedBy: 'solver', expectStatus: 'PASS', expectDefect: null, solver: { editorial: ed(0) } },
  { id: 'ambiguous-qualitative', kind: 'qualitative_ambiguity', why: 'Two options are arguable and the stem does not say which standard applies.', draft: { ...RECOG, stem: 'A synthetic company records a shipment near year end. Revenue is most likely recognised:' }, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'AMBIGUOUS', solver: { editorial: ed(0, { uniqueAnswer: false, uniquenessDetail: 'options 0 and 2 are both defensible without the transfer-of-control fact' }) } },
  { id: 'two-keys', kind: 'two_defensible_keys', why: 'A blind solver defends a different option than the declared key.', draft: RECOG, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'ANSWER_DISAGREEMENT', solver: { editorial: ed(2) } },
  { id: 'out-of-scope', kind: 'unsupported_scope', why: 'The item tests a neighbouring concept, not the one in scope.', draft: RECOG, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'OUT_OF_SCOPE', solver: { editorial: ed(0, { inScope: false, scopeDetail: 'this tests lease classification, which is out of scope' }) } },
  { id: 'missing-assumption', kind: 'missing_assumption', why: 'The stem omits an input the answer needs.', draft: { ...GP, stem: 'A synthetic retailer reports revenue of 500000 for the year. Gross profit is closest to:' }, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'STEM_INSUFFICIENT', solver: { editorial: ed(0), numeric: { variables: {}, keyFormula: '', notes: 'insufficient information' } } },
  { id: 'wrong-formula', kind: 'wrong_formula', why: 'The declared key corresponds to a different formula than the stem calls for.', draft: { ...GP, keyIndex: 1 }, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'NUM_KEY_MISMATCH', solver: { editorial: ed(1), numeric: { variables: { revenue: 500000, cogs: 320000 }, keyFormula: 'revenue - cogs', notes: 'gross profit = revenue - cogs' } } },
  { id: 'wrong-input', kind: 'wrong_input', why: 'The key was computed from a figure the stem does not state.', draft: GP, decidedBy: 'solver', expectStatus: 'VOID', expectDefect: 'NUM_NO_OPTION_MATCHES', solver: { editorial: ed(0), numeric: { variables: { revenue: 500000, cogs: 123457 }, keyFormula: 'revenue - cogs', notes: 'read cogs differently' } } },
  { id: 'wrong-unit', kind: 'wrong_unit', why: 'Options mix a percentage, a currency amount and a plain number.', draft: { stem: 'A synthetic firm earns 62500 on revenue of 500000. The margin is closest to:', options: ['12.5%', '$62,500', '0.45'], keyIndex: 0, isNumeric: true, exactNumericValues: { profit: 62500, revenue: 500000 } }, decidedBy: 'offline', expectStatus: 'REVISE', expectDefect: 'UNIT_MIXED' },
  { id: 'rounding-collision', kind: 'rounding_collision', why: 'Two options are the same value at different formatting.', draft: { stem: 'A synthetic firm earns 62500 on revenue of 500000. The margin, to one decimal place, is closest to:', options: ['12.5%', '12.50%', '13.1%'], keyIndex: 0, isNumeric: true, exactNumericValues: { profit: 62500, revenue: 500000 } }, decidedBy: 'offline', expectStatus: 'VOID', expectDefect: 'OPTION_VALUES_COLLIDE' },
  { id: 'no-inputs-declared', kind: 'missing_assumption', why: 'Marked numerical but declares no inputs, so nothing can be reproduced.', draft: { ...GP, exactNumericValues: {} }, decidedBy: 'offline', expectStatus: 'REVISE', expectDefect: 'NUMERIC_NO_INPUTS' },
  { id: 'compound-option', kind: 'banned_format', why: 'An option refers to the other options.', draft: { ...RECOG, options: ['in the year of shipment', 'in the following year', 'both of the above'] }, decidedBy: 'offline', expectStatus: 'VOID', expectDefect: 'FORMAT_COMPOUND_OPTION' },
]

/** Cases that concern packets, not drafts: expected blocking code from buildGroundingPacket. */
export const PACKET_CASES = [
  { id: 'stale-edition', kind: 'stale_edition' as const, expectBlocker: 'PACK_OUTDATED' },
  { id: 'wrong-outcome', kind: 'unsupported_scope' as const, expectBlocker: 'PACK_SCOPE_MISMATCH' },
  { id: 'no-pack-for-combination', kind: 'unsupported_combination' as const, expectBlocker: 'NO_SOURCE_PACK' },
  { id: 'injection-in-fact', kind: 'prompt_injection' as const, expectQuarantined: true },
]

/** A synthetic reworded and renumbered sibling: not an independent family, even though it looks different. */
export const NEAR_DUPLICATE = {
  original: { stem: 'A synthetic retailer reports revenue of 500000 and cost of goods sold of 320000 for the year. Gross profit is closest to:', options: ['180,000', '320,000', '500,000'] },
  reworded: { stem: 'A synthetic retailer reports revenue of 750000 and cost of goods sold of 410000 for the year. Gross profit is closest to:', options: ['340,000', '410,000', '750,000'] },
  unrelated: { stem: 'A synthetic issuer reports a bond with a stated coupon and a market yield above that coupon. The bond most likely trades at:', options: ['a discount', 'par', 'a premium'] },
}
