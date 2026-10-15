import { create, all } from 'mathjs'
import { generateStructuredOutput } from '../llm'
import { BlueprintCell, ERROR_TAXONOMY, ErrorCode, GeneratedItemDraft } from './types'

/**
 * Independent verifier (§11.6, §12.1).
 *
 * Two properties make this a verifier rather than a second opinion:
 *
 *  1. It never sees the generator's reasoning, its solution, or which option
 *     the generator declared correct. It is asked to solve the item cold and
 *     the comparison is made afterwards, in code. Showing the verifier the key
 *     is the failure mode this whole pass exists to catch — a model told the
 *     answer will write a formula that reaches it.
 *
 *  2. Numerical checking is executed, not judged. The verifier produces a
 *     formula; mathjs evaluates it. §6.3 describes solving independently and
 *     computing every option; implementing that as a model's assertion
 *     reproduces the arithmetic error it is meant to detect.
 */

// A restricted mathjs instance. evaluate() on the stock instance can define
// units, import functions, and build symbolic expressions; none of that is
// needed to check an arithmetic solution, and all of it widens what a model's
// output can reach.
const math = create(all, {})

// Capture the real evaluate BEFORE disabling the escape hatches. Overriding
// happens on the instance, so an expression that names `evaluate`, `import`, or
// `createUnit` resolves to the disabled version, while this captured reference
// still works. Disabling first and calling math.evaluate afterwards disables
// the verifier itself.
const limitedEvaluate = math.evaluate

math.import(
  {
    import: function () { throw new Error('import is disabled') },
    createUnit: function () { throw new Error('createUnit is disabled') },
    evaluate: function () { throw new Error('nested evaluate is disabled') },
    parse: function () { throw new Error('parse is disabled') },
    simplify: function () { throw new Error('simplify is disabled') },
    derivative: function () { throw new Error('derivative is disabled') },
    resolve: function () { throw new Error('resolve is disabled') },
  },
  { override: true }
)

export type VerifierStatus = 'PASS' | 'REVISE' | 'VOID' | 'HUMAN_REVIEW'

export type GateResult = {
  gate: string
  passed: boolean
  detail: string
}

export type VerificationResult = {
  status: VerifierStatus
  /** Short defect codes for the §11.2 corpus, e.g. ['NUM_KEY_MISMATCH']. */
  defectCodes: string[]
  reason: string
  gates: GateResult[]
  verifierModel: string
  /** The verifier's own derivation, retained for audit. */
  derivation?: {
    variables: Record<string, number>
    keyFormula: string
    computedKey: number
    matchedOptionIndex: number | null
    distractorFormulas?: Record<string, string>
    distractorReproduced?: Record<string, boolean>
  }
  /** The answer the verifier reached on its own, before seeing the key. */
  independentAnswerIndex?: number
}

/**
 * Parses an option into a number. Handles currency, thousands separators,
 * percentages, and accounting negatives — "$(1,250.50)" is -1250.50.
 */
export function parseOptionNumber(text: string): number {
  const cleaned = String(text).trim()
  // Accounting negatives wrap the number, not the whole string: "$(1,250.50)"
  // keeps the currency symbol outside the parentheses.
  const negative = /\(\s*[^)]*\d[^)]*\)/.test(cleaned) || /^-/.test(cleaned)
  const digits = cleaned.replace(/[^0-9.]/g, '')
  if (digits === '' || digits === '.') return NaN
  const value = parseFloat(digits)
  if (!Number.isFinite(value)) return NaN
  return negative ? -value : value
}

/** Relative tolerance, with an absolute floor so values near zero still compare. */
function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b), 1)
  return Math.abs(a - b) <= Math.max(0.005 * scale, 0.01)
}

/**
 * The verifier solves in whatever unit the arithmetic naturally produces: 0.35
 * for a margin whose options read "35.0%", or 1470000 where the options read
 * "$1.47 million". Treating that as a mismatch voids correct items, so the
 * comparison is scale-aware — but only along scalings the options themselves
 * license, so an unrelated value cannot be rescaled into a false match.
 */
export function allowedScales(options: string[]): number[] {
  const every = (pattern: RegExp) => options.every(o => pattern.test(o))
  const scales = [1]
  if (every(/%/)) scales.push(100)            // computed a ratio, options are percentages
  if (every(/\bbillions?\b/i)) scales.push(1e-9)
  if (every(/\bmillions?\b/i)) scales.push(1e-6)
  if (every(/\b(thousands?|000s)\b/i)) scales.push(1e-3)
  return scales
}

/**
 * Finds the option a computed value corresponds to. Returns the first scaling
 * that yields exactly one match; a scaling that matches several options is
 * ambiguous and is skipped rather than guessed at.
 */
export function matchComputedToOption(
  computed: number,
  optionValues: number[],
  scales: number[]
): { index: number | null; scale: number; multiple: boolean } {
  let sawMultiple = false
  for (const scale of scales) {
    const scaled = computed * scale
    const hits = optionValues.map((v, i) => ({ v, i })).filter(({ v }) => closeEnough(v, scaled))
    if (hits.length === 1) return { index: hits[0].i, scale, multiple: false }
    if (hits.length > 1) sawMultiple = true
  }
  return { index: null, scale: 1, multiple: sawMultiple }
}

// ---------------------------------------------------------------------------
// Gate 1: numerical execution
// ---------------------------------------------------------------------------

const NUMERIC_SYSTEM_PROMPT = `You are a quantitative verifier. You will be given the text of a finance question. You will NOT be given its answer options and you will NOT be told the answer.

Solve it yourself from first principles and express your solution as executable arithmetic.

Return ONLY a JSON object of this shape:
{
  "variables": { "revenue": 500000, "cogs": 320000 },
  "keyFormula": "revenue - cogs",
  "notes": "one sentence naming the method used, including units, sign convention, period weighting, and rounding"
}

Rules:
- variables holds raw numbers only. No currency symbols, no percent signs, no units. Express a percentage as its decimal value where the arithmetic requires it, and say so in notes.
- keyFormula must be a single expression evaluable by mathjs using only the names in variables and standard operators and functions.
- Express the RESULT in the unit a candidate would write on an answer line. If the answer is a percentage or a margin, the formula must end in "* 100" so it evaluates to 35.0 rather than 0.35. If the answer is an amount of money, give the full figure (1470000), not an abbreviated one.
- Do not guess. If the question does not contain enough information to compute an answer, return {"variables":{},"keyFormula":"","notes":"insufficient information"}.`

type NumericPlan = { variables?: Record<string, unknown>; keyFormula?: string; notes?: string }

/**
 * Executes one arithmetic expression against a fixed variable scope.
 * Exported so the self-test can exercise it without a model call — the
 * sandboxing here is easy to break silently.
 */
export function safeEvaluate(formula: string, scope: Record<string, number>): number {
  const result = limitedEvaluate(formula, { ...scope })
  const value = typeof result === 'number' ? result : Number(result)
  if (!Number.isFinite(value)) throw new Error(`formula did not evaluate to a finite number: ${formula}`)
  return value
}

async function numericalGate(
  draft: GeneratedItemDraft,
  onModel: (m: string) => void
): Promise<{ gates: GateResult[]; defects: string[]; derivation?: VerificationResult['derivation']; fatal: boolean; undecided: boolean }> {
  const gates: GateResult[] = []
  const defects: string[] = []

  const optionValues = draft.options.map(parseOptionNumber)
  if (optionValues.some(v => !Number.isFinite(v))) {
    gates.push({ gate: 'numerical', passed: false, detail: 'item is marked numeric but an option is not a number' })
    defects.push('NUM_OPTION_NOT_NUMERIC')
    return { gates, defects, fatal: true, undecided: false }
  }

  let plan: NumericPlan
  try {
    plan = await generateStructuredOutput<NumericPlan>(
      NUMERIC_SYSTEM_PROMPT,
      `Question:\n${draft.stem}`,
      { tier: 'reasoning', temperature: 0.1, maxTokens: 1200, onModelResolved: onModel }
    )
  } catch (error: any) {
    gates.push({ gate: 'numerical', passed: false, detail: `verifier could not derive a solution: ${error.message}` })
    return { gates, defects: ['NUM_DERIVATION_FAILED'], fatal: false, undecided: true }
  }

  const variables: Record<string, number> = {}
  for (const [k, v] of Object.entries(plan.variables ?? {})) {
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) variables[k] = n
  }

  if (!plan.keyFormula || plan.keyFormula.trim() === '') {
    gates.push({
      gate: 'numerical',
      passed: false,
      detail: `verifier judged the stem insufficient to compute an answer: ${plan.notes ?? 'no reason given'}`,
    })
    defects.push('STEM_INSUFFICIENT')
    return { gates, defects, fatal: true, undecided: false }
  }

  let computedKey: number
  try {
    computedKey = safeEvaluate(plan.keyFormula, variables)
  } catch (error: any) {
    gates.push({ gate: 'numerical', passed: false, detail: `key formula failed to execute: ${error.message}` })
    return { gates, defects: ['NUM_FORMULA_UNEXECUTABLE'], fatal: false, undecided: true }
  }

  // Which option does the computed value correspond to? Spec requires exactly one.
  const scales = allowedScales(draft.options)
  const match = matchComputedToOption(computedKey, optionValues, scales)

  const derivation: VerificationResult['derivation'] = {
    variables,
    keyFormula: plan.keyFormula,
    computedKey,
    matchedOptionIndex: match.index,
  }
  const scaleNote = match.scale === 1 ? '' : ` (×${match.scale} to the options' unit)`

  if (match.index === null && match.multiple) {
    gates.push({
      gate: 'numerical',
      passed: false,
      detail: `computed ${computedKey} is within tolerance of more than one option — the options are not separable`,
    })
    defects.push('NUM_OPTIONS_NOT_SEPARABLE')
    return { gates, defects, derivation, fatal: true, undecided: false }
  }

  if (match.index === null) {
    gates.push({
      gate: 'numerical',
      passed: false,
      detail: `independently computed ${computedKey} via "${plan.keyFormula}", which matches no option (${draft.options.join(' | ')})`,
    })
    defects.push('NUM_NO_OPTION_MATCHES')
    return { gates, defects, derivation, fatal: true, undecided: false }
  }

  if (match.index !== draft.keyIndex) {
    gates.push({
      gate: 'numerical',
      passed: false,
      detail: `independently computed ${computedKey}${scaleNote} = option ${match.index}, but the item declares option ${draft.keyIndex} as the key`,
    })
    defects.push('NUM_KEY_MISMATCH')
    return { gates, defects, derivation, fatal: true, undecided: false }
  }

  gates.push({
    gate: 'numerical',
    passed: true,
    detail: `independently computed ${computedKey}${scaleNote} via "${plan.keyFormula}", matching option ${draft.keyIndex} and no other`,
  })

  // Spec §5.3 also requires every distractor value to be reproduced. A
  // distractor nobody can reach by a named mistake is not a distractor, but it
  // is a fixable flaw rather than a wrong answer — REVISE, not VOID.
  const distractorGate = await reproduceDistractors(draft, variables, computedKey, match.scale, onModel)
  gates.push(distractorGate.gate)
  if (!distractorGate.gate.passed) defects.push('DISTRACTOR_NOT_REPRODUCED')
  derivation.distractorFormulas = distractorGate.formulas
  derivation.distractorReproduced = distractorGate.reproduced

  return { gates, defects, derivation, fatal: false, undecided: false }
}

const DISTRACTOR_SYSTEM_PROMPT = `You are checking whether each wrong option in a finance question is reachable by a specific, plausible candidate mistake — rather than being an arbitrary number.

You will be given the question, the numbers it contains, and each wrong option with its numeric value.

For each wrong option, give arithmetic that evaluates to EXACTLY that option's stated numeric value, representing the mistake a candidate would make to land there.

Return ONLY:
{
  "extraVariables": { "sga": 610000 },
  "formulas": { "1": "(revenue - cogs - sga) / revenue * 100", "2": "cogs / revenue * 100" }
}

Rules:
- Formula keys are the wrong-option indices you were given.
- Each formula must evaluate to the option's stated numeric value in the SAME unit it is stated in. If the option reads "20.5%", the formula must produce 20.5, not 0.205.
- Use the supplied variable names. If you need a number from the question that was not supplied, add it to extraVariables and use it.
- Use only standard operators and functions.
- If no plausible mistake produces an option, give "" for that index. Do not invent a contrived formula to force a match.`

async function reproduceDistractors(
  draft: GeneratedItemDraft,
  variables: Record<string, number>,
  computedKey: number,
  /** The scaling that reconciled the key with the options; distractors use the same one. */
  scale: number,
  onModel: (m: string) => void
): Promise<{ gate: GateResult; formulas: Record<string, string>; reproduced: Record<string, boolean> }> {
  const wrongIndices = draft.options.map((_, i) => i).filter(i => i !== draft.keyIndex)
  const formulas: Record<string, string> = {}
  const reproduced: Record<string, boolean> = {}

  // The key's derivation only names the variables its own formula needed. A
  // distractor usually turns on a number the key ignored — the expense line the
  // candidate wrongly deducted — so the stem's full numeric context goes in too.
  const scope: Record<string, number> = { ...draft.card.exactNumericValues, ...variables }

  let plan: { formulas?: Record<string, string>; extraVariables?: Record<string, unknown> }
  try {
    plan = await generateStructuredOutput<{ formulas?: Record<string, string>; extraVariables?: Record<string, unknown> }>(
      DISTRACTOR_SYSTEM_PROMPT,
      `Question:\n${draft.stem}\n\n` +
        `Available variables: ${JSON.stringify(scope)}\n` +
        `The correct answer is option ${draft.keyIndex}: "${draft.options[draft.keyIndex]}" (numeric value ${computedKey * scale}).\n` +
        `Wrong options to explain:\n` +
        wrongIndices.map(i => `  ${i}: "${draft.options[i]}" (numeric value ${parseOptionNumber(draft.options[i])})`).join('\n'),
      { tier: 'reasoning', temperature: 0.2, maxTokens: 1100, onModelResolved: onModel }
    )
  } catch {
    return {
      gate: { gate: 'distractors', passed: false, detail: 'verifier could not derive distractor pathways' },
      formulas,
      reproduced,
    }
  }

  for (const [k, v] of Object.entries(plan.extraVariables ?? {})) {
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n) && !(k in scope)) scope[k] = n
  }

  const failures: string[] = []
  for (const i of wrongIndices) {
    const formula = (plan.formulas?.[String(i)] ?? '').trim()
    formulas[String(i)] = formula
    if (!formula) {
      reproduced[String(i)] = false
      failures.push(`option ${i}: no plausible mistake produces it`)
      continue
    }
    try {
      // Formulas are required to produce the option's stated unit directly, so
      // no scaling is applied here — applying it twice was the earlier hazard.
      const value = safeEvaluate(formula, scope)
      const target = parseOptionNumber(draft.options[i])
      const ok = closeEnough(value, target)
      reproduced[String(i)] = ok
      if (!ok) failures.push(`option ${i}: "${formula}" gives ${value}, option states ${target}`)
    } catch (error: any) {
      reproduced[String(i)] = false
      failures.push(`option ${i}: formula failed to execute (${error.message})`)
    }
  }

  return {
    gate: failures.length === 0
      ? { gate: 'distractors', passed: true, detail: 'every distractor value reproduced from a named mistake' }
      : { gate: 'distractors', passed: false, detail: failures.join('; ') },
    formulas,
    reproduced,
  }
}

// ---------------------------------------------------------------------------
// Gate 2: editorial — scope, cold answer, ambiguity, language
// ---------------------------------------------------------------------------

const EDITORIAL_SYSTEM_PROMPT = `You are an independent reviewer of a CFA Level I exam item. You have NOT been told which option is correct and you must not assume any of them is.

You will be given the item and the concept it is supposed to test.

Do four things:

1. Answer it yourself. Choose the single best option by index (0, 1, or 2).
2. Judge scope: does the item test the stated concept, at CFA Level I, using terminology consistent with current standards? An item that tests a different concept, or reaches into Level II material, fails this.
3. Judge uniqueness: is exactly one option defensible as best under the stated assumptions? If two could be argued, or if the stem omits something needed to choose, it fails.
4. Judge language: are the options parallel in grammar, unit, specificity, and length? Is the stem self-contained and free of ambiguity? Does any option give itself away by being longer, more hedged, or more precise than the others?

Return ONLY:
{
  "answerIndex": 0,
  "answerReasoning": "one or two sentences",
  "inScope": true,
  "scopeDetail": "...",
  "uniqueAnswer": true,
  "uniquenessDetail": "...",
  "languageOk": true,
  "languageDetail": "...",
  "confidence": "high"
}

confidence is "high", "medium", or "low" — how sure you are of your own answer.`

type EditorialVerdict = {
  answerIndex?: unknown
  answerReasoning?: string
  inScope?: boolean
  scopeDetail?: string
  uniqueAnswer?: boolean
  uniquenessDetail?: string
  languageOk?: boolean
  languageDetail?: string
  confidence?: string
}

async function editorialGate(
  draft: GeneratedItemDraft,
  cell: BlueprintCell,
  onModel: (m: string) => void
): Promise<{ gates: GateResult[]; defects: string[]; answerIndex?: number; fatal: boolean; undecided: boolean }> {
  const gates: GateResult[] = []
  const defects: string[] = []

  let verdict: EditorialVerdict
  try {
    verdict = await generateStructuredOutput<EditorialVerdict>(
      EDITORIAL_SYSTEM_PROMPT,
      `Concept under test: ${cell.conceptName}\nScope of that concept: ${cell.conceptScope}\nTopic: ${cell.topic}\n\nItem:\n${draft.stem}\n\nOptions:\n${draft.options
        .map((o, i) => `  ${i}. ${o}`)
        .join('\n')}`,
      { tier: 'reasoning', temperature: 0.1, maxTokens: 1200, onModelResolved: onModel }
    )
  } catch (error: any) {
    gates.push({ gate: 'editorial', passed: false, detail: `editorial pass failed: ${error.message}` })
    return { gates, defects: ['EDITORIAL_FAILED'], fatal: false, undecided: true }
  }

  const answerIndex = Number(verdict.answerIndex)
  const hasAnswer = Number.isInteger(answerIndex) && answerIndex >= 0 && answerIndex <= 2

  // The cold-answer gate. This is the single strongest signal in the pass:
  // two independent derivations of the same item agreeing on the key.
  if (!hasAnswer) {
    gates.push({ gate: 'answer', passed: false, detail: 'verifier did not produce an answer' })
    defects.push('NO_INDEPENDENT_ANSWER')
    return { gates, defects, fatal: false, undecided: true }
  }

  if (answerIndex !== draft.keyIndex) {
    gates.push({
      gate: 'answer',
      passed: false,
      detail: `verifier answered option ${answerIndex} (${verdict.answerReasoning ?? 'no reasoning'}); item declares option ${draft.keyIndex}`,
    })
    defects.push('ANSWER_DISAGREEMENT')
    // Disagreement is decisive: either the key is wrong or the item is
    // ambiguous enough that a competent solver goes elsewhere. Both disqualify.
    return { gates, defects, answerIndex, fatal: true, undecided: false }
  }

  gates.push({
    gate: 'answer',
    passed: true,
    detail: `solved cold to option ${answerIndex}, agreeing with the declared key (verifier confidence: ${verdict.confidence ?? 'unstated'})`,
  })

  const scopeOk = verdict.inScope !== false
  gates.push({ gate: 'scope', passed: scopeOk, detail: verdict.scopeDetail ?? '' })
  if (!scopeOk) defects.push('OUT_OF_SCOPE')

  const uniqueOk = verdict.uniqueAnswer !== false
  gates.push({ gate: 'ambiguity', passed: uniqueOk, detail: verdict.uniquenessDetail ?? '' })
  if (!uniqueOk) defects.push('AMBIGUOUS')

  const languageOk = verdict.languageOk !== false
  gates.push({ gate: 'language', passed: languageOk, detail: verdict.languageDetail ?? '' })
  if (!languageOk) defects.push('LANGUAGE')

  // Scope and ambiguity failures are not repairable by editing wording — they
  // mean the item is testing the wrong thing or has no single answer.
  return { gates, defects, answerIndex, fatal: !scopeOk || !uniqueOk, undecided: false }
}

// ---------------------------------------------------------------------------
// Gate 3: distractor taxonomy and exposure — checked locally, no model needed
// ---------------------------------------------------------------------------

function structuralGates(draft: GeneratedItemDraft, existingFingerprints: Set<string>, fingerprint: string): { gates: GateResult[]; defects: string[]; fatal: boolean } {
  const gates: GateResult[] = []
  const defects: string[] = []
  let fatal = false

  const wrongIndices = draft.options.map((_, i) => i).filter(i => i !== draft.keyIndex)
  const mapped = new Set(draft.card.distractorDiagnoses.map(d => d.optionIndex))
  const unmapped = wrongIndices.filter(i => !mapped.has(i))
  const badCodes = draft.card.distractorDiagnoses.filter(d => !(d.errorCode in ERROR_TAXONOMY))

  if (unmapped.length > 0 || badCodes.length > 0) {
    gates.push({
      gate: 'distractor_taxonomy',
      passed: false,
      detail: [
        unmapped.length ? `options ${unmapped.join(', ')} have no named error pathway` : '',
        badCodes.length ? `unknown error codes: ${badCodes.map(d => d.errorCode).join(', ')}` : '',
      ].filter(Boolean).join('; '),
    })
    defects.push('DISTRACTOR_UNMAPPED')
  } else {
    gates.push({
      gate: 'distractor_taxonomy',
      passed: true,
      detail: draft.card.distractorDiagnoses.map(d => `option ${d.optionIndex} → ${d.errorCode} (${ERROR_TAXONOMY[d.errorCode as ErrorCode]})`).join('; '),
    })
  }

  const duplicate = existingFingerprints.has(fingerprint)
  gates.push({
    gate: 'exposure',
    passed: !duplicate,
    detail: duplicate ? `fingerprint ${fingerprint} already exists in the bank` : `fingerprint ${fingerprint} is new`,
  })
  if (duplicate) { defects.push('DUPLICATE'); fatal = true }

  // Answer-position balance is a property of a run, not of one item, so it is
  // measured by the pilot runner rather than gated here.

  return { gates, defects, fatal }
}

// ---------------------------------------------------------------------------

export async function verifyItem(
  draft: GeneratedItemDraft,
  cell: BlueprintCell,
  options: { existingFingerprints?: Set<string>; fingerprint: string }
): Promise<VerificationResult> {
  const gates: GateResult[] = []
  const defectCodes: string[] = []
  let verifierModel = 'unknown'
  const onModel = (m: string) => { verifierModel = m }

  let fatal = false
  let undecided = false
  let derivation: VerificationResult['derivation']
  let independentAnswerIndex: number | undefined

  const structural = structuralGates(draft, options.existingFingerprints ?? new Set(), options.fingerprint)
  gates.push(...structural.gates)
  defectCodes.push(...structural.defects)
  fatal ||= structural.fatal

  if (!fatal) {
    const editorial = await editorialGate(draft, cell, onModel)
    gates.push(...editorial.gates)
    defectCodes.push(...editorial.defects)
    fatal ||= editorial.fatal
    undecided ||= editorial.undecided
    independentAnswerIndex = editorial.answerIndex
  }

  if (!fatal && draft.card.isNumeric) {
    const numeric = await numericalGate(draft, onModel)
    gates.push(...numeric.gates)
    defectCodes.push(...numeric.defects)
    fatal ||= numeric.fatal
    undecided ||= numeric.undecided
    derivation = numeric.derivation
  } else if (!fatal) {
    gates.push({ gate: 'numerical', passed: true, detail: 'not a numerical item — no arithmetic to execute' })
  }

  const failed = gates.filter(g => !g.passed)

  let status: VerifierStatus
  if (fatal) status = 'VOID'
  else if (undecided) status = 'HUMAN_REVIEW'
  else if (failed.length > 0) status = 'REVISE'
  else status = 'PASS'

  return {
    status,
    defectCodes,
    reason: failed.length === 0
      ? `all ${gates.length} gates passed`
      : failed.map(g => `${g.gate}: ${g.detail}`).join(' | '),
    gates,
    verifierModel,
    derivation,
    independentAnswerIndex,
  }
}
