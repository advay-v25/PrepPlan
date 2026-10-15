/**
 * Shared types for the diagnostic item pipeline.
 * Spec: docs/superpowers/specs/2026-09-07-diagnostic-item-pipeline-design.md
 */

/** §4.2 blueprint dimensions. These mirror the DB check constraints exactly. */
export const COGNITIONS = ['recall', 'interpret', 'apply', 'calculate', 'compare', 'diagnose', 'integrate'] as const
export const ITEM_FORMS = ['direct', 'scenario', 'data_table', 'calculation', 'exception', 'integrated'] as const
export const DIFFICULTIES = ['foundation', 'standard', 'difficult', 'stretch'] as const

export type Cognition = (typeof COGNITIONS)[number]
export type ItemForm = (typeof ITEM_FORMS)[number]
export type Difficulty = (typeof DIFFICULTIES)[number]

/** Numeric difficulty kept alongside the enum — the adaptive selector needs a scalar. */
export const DIFFICULTY_SCALE: Record<Difficulty, number> = {
  foundation: 0.5,
  standard: 1.0,
  difficult: 1.5,
  stretch: 2.0,
}

/**
 * §9.2 error taxonomy. Every distractor must map to one of these, so that a
 * wrong answer names a diagnosis rather than only a loss of a mark. These codes
 * are what the coach and the repair queue read.
 */
export const ERROR_TAXONOMY = {
  C: 'Concept misunderstanding — the underlying idea is wrong',
  R: 'Requirement misread — solved a question the stem did not ask',
  F: 'Formula error — wrong formula, or the right formula in the wrong form',
  S: 'Sign or direction error — added instead of subtracted, inverted a ratio',
  A: 'Arithmetic slip — correct method, wrong computation',
  M: 'Misclassification — wrong category, statement, or section',
  T: 'Timing or period error — weighting, day count, compounding frequency',
  G: 'Standards confusion — IFRS treatment applied under US GAAP or vice versa',
  L: 'Language trap — missed a negation such as "least likely" or "except"',
  I: 'Incomplete — stopped one required step short of the answer',
} as const

export type ErrorCode = keyof typeof ERROR_TAXONOMY

/** One cell of a blueprint: what a single item is required to be. */
export type BlueprintCell = {
  conceptId: string
  conceptName: string
  topic: string
  module: string
  /** Free-text scope for the generator — what the concept covers. Not a citation. */
  conceptScope: string
  cognition: Cognition
  itemForm: ItemForm
  difficulty: Difficulty
}

export type DistractorDiagnosis = {
  optionIndex: number
  errorCode: ErrorCode
  /** What the learner did to land here, in plain language. */
  description: string
}

/**
 * The §11.3 gold item record: everything needed to re-check, de-duplicate, and
 * explain an item. Never sent to a learner while the item is live.
 */
export type ItemCard = {
  conceptId: string
  conceptName: string
  cognition: Cognition
  itemForm: ItemForm
  difficulty: Difficulty
  /** Worked solution, step by step. */
  solution: string
  /** Named error pathway for each wrong option (§6.2). */
  distractorDiagnoses: DistractorDiagnosis[]
  /** Every number stated in the stem, so the verifier's arithmetic is auditable. */
  exactNumericValues: Record<string, number>
  isNumeric: boolean
}

export type GeneratedItemDraft = {
  stem: string
  options: string[]
  keyIndex: number
  perOptionFeedback: Record<string, string>
  card: ItemCard
  /** Attribution for the item record. Filled by the generator, not the model. */
  generatorModel?: string
}
