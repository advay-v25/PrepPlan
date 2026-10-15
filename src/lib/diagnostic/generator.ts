import { generateStructuredOutput } from '../llm'
import {
  BlueprintCell,
  ERROR_TAXONOMY,
  ErrorCode,
  GeneratedItemDraft,
  ItemCard,
  COGNITIONS,
  ITEM_FORMS,
  DIFFICULTIES,
} from './types'

/**
 * Blueprint-driven item generator (§4.3, §5.1–5.3).
 *
 * The generator never chooses what to write about. It is handed one blueprint
 * cell — concept, cognition, item form, difficulty — and writes the item that
 * cell demands. That is what keeps a diagnostic free of sampling bias: coverage
 * is decided by the blueprint before any item exists, not by whatever the model
 * finds easy to produce.
 *
 * Style calibration is structural only (§2.4): lead-in forms, option
 * parallelism, stem self-containment, and the distractor error taxonomy. No
 * wording, numbers, or entities are carried from any source paper.
 */

const LEAD_INS = [
  'is most likely',
  'is least likely',
  'is closest to',
  'is best described as',
  'will most likely',
]

const FORM_GUIDANCE: Record<string, string> = {
  direct: 'State the concept question directly. No scenario wrapper. Test whether the relationship itself is understood.',
  scenario: 'Open with a brief analyst or company situation (two or three sentences), then ask what follows from it.',
  data_table: 'Present the financial data as an inline labelled list of line items and values, then ask for a derived figure or interpretation.',
  calculation: 'Give every input needed and require a numerical answer. All three options must be numbers in the same unit and format.',
  exception: 'Ask which of three statements is least likely to be correct, or which does not belong. Make the negation unmistakable.',
  integrated: 'Require two distinct concepts to be combined. Neither alone is sufficient to reach the answer.',
}

const COGNITION_GUIDANCE: Record<string, string> = {
  recall: 'Test whether a definition, classification, or requirement is known.',
  interpret: 'Give a figure or result and ask what it means for the company.',
  apply: 'Require a rule to be applied to a situation it was not stated in.',
  calculate: 'Require a numerical answer derived from stated inputs.',
  compare: 'Require two treatments, standards, or periods to be set against each other.',
  diagnose: 'Present a result or statement and ask what has gone wrong or what explains it.',
  integrate: 'Require a chain of reasoning across more than one concept.',
}

const DIFFICULTY_GUIDANCE: Record<string, string> = {
  foundation: 'One step. The concept is tested directly, with no distracting information.',
  standard: 'Two steps, or one step plus a judgement. Typical exam weight.',
  difficult: 'Multi-step, or contains one piece of information that must be recognised as irrelevant.',
  stretch: 'Requires the concept to be applied in an unfamiliar framing, or combined with a second idea.',
}

function systemPrompt(cell: BlueprintCell): string {
  const taxonomy = (Object.entries(ERROR_TAXONOMY) as [ErrorCode, string][])
    .map(([code, meaning]) => `  ${code} = ${meaning}`)
    .join('\n')

  return `You are a CFA Level I assessment author. You write one item at a time, to a specification.

The CFA exam tests concepts indirectly and in depth. It rarely asks for a definition outright; it asks what a definition implies in a situation. Write in that register.

SPECIFICATION FOR THIS ITEM
  Topic:      ${cell.topic}
  Module:     ${cell.module}
  Concept:    ${cell.conceptName}
  Scope:      ${cell.conceptScope}
  Cognition:  ${cell.cognition} — ${COGNITION_GUIDANCE[cell.cognition]}
  Item form:  ${cell.itemForm} — ${FORM_GUIDANCE[cell.itemForm]}
  Difficulty: ${cell.difficulty} — ${DIFFICULTY_GUIDANCE[cell.difficulty]}

You must stay inside the stated concept scope. Do not test an adjacent concept because it is easier to write. Do not reach into Level II material.

HARD REQUIREMENTS
1. The stem is self-contained. Every number, standard, and assumption needed to answer is stated in the stem. The reader has no other material.
2. Exactly three options. Exactly one is defensible as best under the stated assumptions.
3. Options are parallel: same grammatical form, same unit, same level of specificity, similar length. A reader must not be able to pick the answer from its shape.
4. The lead-in ends with one of: ${LEAD_INS.map(l => `"${l}"`).join(', ')}.
5. Every wrong option is a place a real candidate lands by making one identifiable mistake. Never a random number, never an obviously absurd option.
6. Each wrong option is labelled with the error it represents, from this taxonomy:
${taxonomy}
7. If the item is numerical, every option must be a number in the same unit and rounding, and you must list every numeric input from the stem in exactNumericValues.
8. Write in precise professional English. No emoji, no rhetorical questions, no addressing the reader as "you".

Return ONLY a JSON object of this exact shape:
{
  "stem": "string",
  "options": ["string", "string", "string"],
  "keyIndex": 0,
  "perOptionFeedback": {
    "0": "One or two sentences. For the key, why it is right. For a distractor, name the specific mistake and how to avoid it.",
    "1": "...",
    "2": "..."
  },
  "solution": "The worked solution, step by step, in full.",
  "distractorDiagnoses": [
    { "optionIndex": 1, "errorCode": "F", "description": "what the candidate did to land here" },
    { "optionIndex": 2, "errorCode": "T", "description": "..." }
  ],
  "exactNumericValues": { "revenue": 500000, "cogs": 320000 },
  "isNumeric": true
}

distractorDiagnoses must contain an entry for each option that is NOT the key, and none for the key.
exactNumericValues may be {} for a non-numerical item. isNumeric must reflect that honestly.`
}

type RawDraft = {
  stem?: string
  options?: unknown
  keyIndex?: unknown
  perOptionFeedback?: Record<string, string>
  solution?: string
  distractorDiagnoses?: { optionIndex?: unknown; errorCode?: string; description?: string }[]
  exactNumericValues?: Record<string, unknown>
  isNumeric?: unknown
}

/** Thrown when the model's response cannot be trusted as an item at all. */
export class DraftShapeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftShapeError'
  }
}

/**
 * Structural validation only. This is not the verifier — it rejects responses
 * that are not items, so the verifier is never handed malformed input and its
 * pass rate means what it says.
 */
function coerceDraft(raw: RawDraft, cell: BlueprintCell, model: string): GeneratedItemDraft {
  const stem = typeof raw.stem === 'string' ? raw.stem.trim() : ''
  if (stem.length < 20) throw new DraftShapeError('stem missing or too short')

  if (!Array.isArray(raw.options) || raw.options.length !== 3) {
    throw new DraftShapeError(`expected exactly 3 options, got ${Array.isArray(raw.options) ? raw.options.length : typeof raw.options}`)
  }
  const options = raw.options.map(o => String(o).trim())
  if (options.some(o => o.length === 0)) throw new DraftShapeError('an option is empty')
  if (new Set(options.map(o => o.toLowerCase())).size !== 3) {
    throw new DraftShapeError('options are not distinct')
  }

  const keyIndex = Number(raw.keyIndex)
  if (!Number.isInteger(keyIndex) || keyIndex < 0 || keyIndex > 2) {
    throw new DraftShapeError(`keyIndex out of range: ${raw.keyIndex}`)
  }

  const feedback: Record<string, string> = {}
  for (const i of [0, 1, 2]) {
    const fb = raw.perOptionFeedback?.[String(i)]
    if (typeof fb !== 'string' || fb.trim().length < 10) {
      throw new DraftShapeError(`per-option feedback missing for option ${i}`)
    }
    feedback[String(i)] = fb.trim()
  }

  const solution = typeof raw.solution === 'string' ? raw.solution.trim() : ''
  if (solution.length < 20) throw new DraftShapeError('solution missing or too short')

  const wrongIndices = [0, 1, 2].filter(i => i !== keyIndex)
  const diagnoses = (raw.distractorDiagnoses ?? [])
    .map(d => ({
      optionIndex: Number(d.optionIndex),
      errorCode: String(d.errorCode ?? '').toUpperCase() as ErrorCode,
      description: String(d.description ?? '').trim(),
    }))
    .filter(d => wrongIndices.includes(d.optionIndex))

  const covered = new Set(diagnoses.map(d => d.optionIndex))
  if (wrongIndices.some(i => !covered.has(i))) {
    throw new DraftShapeError('a distractor has no named error pathway')
  }
  for (const d of diagnoses) {
    if (!(d.errorCode in ERROR_TAXONOMY)) {
      throw new DraftShapeError(`unknown error code "${d.errorCode}" on option ${d.optionIndex}`)
    }
  }

  const exactNumericValues: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw.exactNumericValues ?? {})) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.eE+-]/g, ''))
    if (Number.isFinite(n)) exactNumericValues[k] = n
  }

  const card: ItemCard = {
    conceptId: cell.conceptId,
    conceptName: cell.conceptName,
    cognition: cell.cognition,
    itemForm: cell.itemForm,
    difficulty: cell.difficulty,
    solution,
    distractorDiagnoses: diagnoses,
    exactNumericValues,
    isNumeric: Boolean(raw.isNumeric),
  }

  return { stem, options, keyIndex, perOptionFeedback: feedback, card, generatorModel: model }
}

export async function generateItemDraft(cell: BlueprintCell): Promise<GeneratedItemDraft> {
  if (!COGNITIONS.includes(cell.cognition)) throw new Error(`bad cognition: ${cell.cognition}`)
  if (!ITEM_FORMS.includes(cell.itemForm)) throw new Error(`bad item form: ${cell.itemForm}`)
  if (!DIFFICULTIES.includes(cell.difficulty)) throw new Error(`bad difficulty: ${cell.difficulty}`)

  let model = 'unknown'
  const raw = await generateStructuredOutput<RawDraft>(
    systemPrompt(cell),
    `Write the item now, to the specification above. Return only the JSON object.`,
    {
      tier: 'reasoning',
      temperature: 0.85, // variety across a run; the verifier is the quality gate
      maxTokens: 3600,
      onModelResolved: m => { model = m },
    }
  )

  return coerceDraft(raw, cell, model)
}

/**
 * A stable content fingerprint for exposure and duplicate screening (§12.2
 * semantic originality). Normalises away formatting and the specific numbers,
 * so two items that differ only in their figures collide.
 */
export function semanticFingerprint(stem: string, options: string[]): string {
  const normalised = [stem, ...options]
    .join(' | ')
    .toLowerCase()
    .replace(/[\d.,$%()]+/g, '#')
    .replace(/[^a-z#|\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // FNV-1a — short, stable, and no dependency. Collisions are screened by a
  // human at review time, so this only needs to be good enough to cluster.
  let hash = 0x811c9dc5
  for (let i = 0; i < normalised.length; i++) {
    hash ^= normalised.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
