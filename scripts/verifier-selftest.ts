/**
 * Verifier self-test.
 *
 * Two halves:
 *   Offline  — pure functions, no network. Runs in milliseconds.
 *   Online   — feeds the verifier a correct item and a deliberately corrupted
 *              one and asserts it separates them. This is the check that the
 *              deterministic numerical gate (§5.3) actually does its job; a
 *              verifier that passes both is worthless regardless of what it
 *              reports.
 *
 *   npx tsx scripts/verifier-selftest.ts            # offline only
 *   npx tsx scripts/verifier-selftest.ts --online   # includes live model calls
 */
import * as dotenv from 'dotenv'

import { extractJson } from '../src/lib/llm'
import { allowedScales, matchComputedToOption, parseOptionNumber, safeEvaluate, verifyItem } from '../src/lib/diagnostic/verifier'
import { semanticFingerprint } from '../src/lib/diagnostic/generator'
import { buildBlueprint, checkCoverage } from '../src/lib/diagnostic/blueprintPlan'
import type { BlueprintCell, GeneratedItemDraft } from '../src/lib/diagnostic/types'

dotenv.config({ path: '.env.local', quiet: true } as any)

let passed = 0
let failed = 0

function check(name: string, condition: boolean, detail = '') {
  if (condition) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---------------------------------------------------------------------------
console.log('\nOption number parsing')
check('plain integer', parseOptionNumber('1250') === 1250)
check('currency and separators', parseOptionNumber('$1,250.50') === 1250.5)
check('percentage', parseOptionNumber('12.5%') === 12.5)
check('accounting negative', parseOptionNumber('$(1,250.50)') === -1250.5)
check('leading minus', parseOptionNumber('-42.0') === -42)
check('trailing unit', parseOptionNumber('3.75 million') === 3.75)
check('non-numeric is NaN', Number.isNaN(parseOptionNumber('Increase in gross margin')))

// ---------------------------------------------------------------------------
console.log('\nFormula execution (the deterministic numerical gate, §5.3)')
function evaluates(name: string, formula: string, scope: Record<string, number>, expected: number) {
  try {
    const actual = safeEvaluate(formula, scope)
    check(name, Math.abs(actual - expected) < 1e-6, `got ${actual}, wanted ${expected}`)
  } catch (error: any) {
    check(name, false, error.message)
  }
}
function rejects(name: string, formula: string, scope: Record<string, number> = {}) {
  try {
    safeEvaluate(formula, scope)
    check(name, false, 'expression executed when it should have been refused')
  } catch { check(name, true) }
}

evaluates('subtraction', 'revenue - cogs', { revenue: 4200000, cogs: 2730000 }, 1470000)
evaluates('margin as a ratio', '(revenue - cogs) / revenue * 100', { revenue: 4200000, cogs: 2730000 }, 35)
evaluates('weighted average shares', '(a * 12 + b * 4) / 12', { a: 100000, b: 30000 }, 110000)
evaluates('declining balance', 'cost * (2 / life)', { cost: 50000, life: 5 }, 20000)
evaluates('built-in function', 'round(x, 2)', { x: 3.14159 }, 3.14)
evaluates('exponent', 'p * (1 + r) ^ n', { p: 1000, r: 0.05, n: 2 }, 1102.5)

// The sandbox must refuse the escape hatches while still running arithmetic.
rejects('import is refused', 'import({})')
rejects('createUnit is refused', 'createUnit("zzz")')
rejects('nested evaluate is refused', 'evaluate("1+1")')
rejects('unknown symbol is refused', 'revenue - mystery', { revenue: 10 })
rejects('non-finite result is refused', '1 / 0')

// ---------------------------------------------------------------------------
console.log('\nJSON extraction from model output')
check('bare object', extractJson('{"a":1}') === '{"a":1}')
check('fenced', extractJson('```json\n{"a":1}\n```') === '{"a":1}')
check('preamble prose', extractJson('Here is the answer:\n{"a":1}') === '{"a":1}')
check('nested braces', extractJson('{"a":{"b":2}} trailing') === '{"a":{"b":2}}')
check('brace inside string', extractJson('{"a":"}"}') === '{"a":"}"}')
check('escaped quote inside string', extractJson('{"a":"say \\"}\\" ok"}') === '{"a":"say \\"}\\" ok"}')
check('no object returns null', extractJson('sorry, I cannot') === null)

// ---------------------------------------------------------------------------
console.log('\nUnit-scale reconciliation')
const pctOptions = ['35.0%', '20.5%', '65.0%']
const cashOptions = ['$1,470,000', '$2,730,000', '$4,200,000']
const millionOptions = ['$1.47 million', '$2.73 million', '$4.20 million']

check('percent options license a ×100 scaling', allowedScales(pctOptions).includes(100))
check('plain cash options license only ×1', allowedScales(cashOptions).join(',') === '1')
check('"million" options license ×1e-6', allowedScales(millionOptions).includes(1e-6))

const ratioMatch = matchComputedToOption(0.35, pctOptions.map(parseOptionNumber), allowedScales(pctOptions))
check('a ratio matches its percentage option', ratioMatch.index === 0 && ratioMatch.scale === 100,
  `index ${ratioMatch.index}, scale ${ratioMatch.scale}`)

const directMatch = matchComputedToOption(35.0, pctOptions.map(parseOptionNumber), allowedScales(pctOptions))
check('an already-scaled percentage matches at ×1', directMatch.index === 0 && directMatch.scale === 1)

const cashMatch = matchComputedToOption(1470000, millionOptions.map(parseOptionNumber), allowedScales(millionOptions))
check('a full figure matches its "million" option', cashMatch.index === 0 && cashMatch.scale === 1e-6,
  `index ${cashMatch.index}, scale ${cashMatch.scale}`)

check('a value matching nothing stays unmatched',
  matchComputedToOption(999, cashOptions.map(parseOptionNumber), allowedScales(cashOptions)).index === null)
check('no rescaling is invented for plain options',
  matchComputedToOption(14.7, cashOptions.map(parseOptionNumber), allowedScales(cashOptions)).index === null)
check('an ambiguous match is reported, not guessed',
  matchComputedToOption(100, [100, 100.1, 500], [1]).multiple === true)

// ---------------------------------------------------------------------------
console.log('\nSemantic fingerprinting')
const fpA = semanticFingerprint('Revenue is $500,000 and COGS is $320,000. Gross profit is closest to:', ['$180,000', '$150,000', '$200,000'])
const fpB = semanticFingerprint('Revenue is $900,000 and COGS is $410,000. Gross profit is closest to:', ['$490,000', '$450,000', '$500,000'])
const fpC = semanticFingerprint('A company uses straight-line depreciation. Annual expense is closest to:', ['$10,000', '$12,000', '$8,000'])
check('same shape, different numbers → same fingerprint', fpA === fpB, `${fpA} vs ${fpB}`)
check('different content → different fingerprint', fpA !== fpC, `${fpA} vs ${fpC}`)
check('stable across calls', semanticFingerprint('x y z', ['a']) === semanticFingerprint('x y z', ['a']))

// ---------------------------------------------------------------------------
console.log('\nBlueprint allocation')
const concepts = Array.from({ length: 8 }, (_, i) => ({
  id: `c${i}`, name: `Concept ${i}`, topic: 'FSA', module: 'fsa-income',
  scopeNotes: 'scope', importance: (i % 2 === 0 ? 'core' : 'supporting') as 'core' | 'supporting',
}))

for (const total of [1, 5, 20, 60, 90]) {
  const { cells, quota } = buildBlueprint(concepts, total, 1234)
  const pairSum = quota.pairs.reduce((a, p) => a + p.count, 0)
  const diffSum = quota.difficulties.reduce((a, d) => a + d.count, 0)
  const conceptSum = Object.values(quota.conceptCounts).reduce((a, n) => a + n, 0)
  check(`total ${total}: cells match`, cells.length === total, `got ${cells.length}`)
  check(`total ${total}: pair quotas sum exactly`, pairSum === total, `got ${pairSum}`)
  check(`total ${total}: difficulty quotas sum exactly`, diffSum === total, `got ${diffSum}`)
  check(`total ${total}: concept counts sum exactly`, conceptSum === total, `got ${conceptSum}`)
}

const twenty = buildBlueprint(concepts, 20, 1234)
check('20 items reach every concept', Object.keys(twenty.quota.conceptCounts).length === 8,
  `covered ${Object.keys(twenty.quota.conceptCounts).length}/8`)
check('same seed is reproducible',
  JSON.stringify(buildBlueprint(concepts, 20, 7).cells) === JSON.stringify(buildBlueprint(concepts, 20, 7).cells))
check('different seed differs',
  JSON.stringify(buildBlueprint(concepts, 20, 7).cells) !== JSON.stringify(buildBlueprint(concepts, 20, 8).cells))

const fullCoverage = checkCoverage(twenty.quota, twenty.cells.map(c => ({
  cognition: c.cognition, itemForm: c.itemForm, difficulty: c.difficulty, conceptId: c.conceptId,
})))
check('a complete run satisfies its own quota', fullCoverage.satisfied, fullCoverage.shortfalls.join('; '))

const partialCoverage = checkCoverage(twenty.quota, twenty.cells.slice(0, 10).map(c => ({
  cognition: c.cognition, itemForm: c.itemForm, difficulty: c.difficulty, conceptId: c.conceptId,
})))
check('a half run reports shortfalls', !partialCoverage.satisfied && partialCoverage.shortfalls.length > 0)

// ---------------------------------------------------------------------------
// Online: does the numerical gate catch a wrong key?
// ---------------------------------------------------------------------------
const CELL: BlueprintCell = {
  conceptId: '22222222-2222-2222-2222-22222222222b',
  conceptName: 'Gross Profit, Operating Profit and Margin Analysis',
  topic: 'FSA',
  module: 'fsa-income',
  conceptScope: 'Construction of the income statement from revenue through gross profit and operating profit. Calculation and interpretation of gross and operating margin.',
  cognition: 'calculate',
  itemForm: 'calculation',
  difficulty: 'standard',
}

// Revenue 4,200,000 − COGS 2,730,000 = gross profit 1,470,000 → margin 35.0%
const CORRECT: GeneratedItemDraft = {
  stem: 'Bellamy Industries reported revenue of $4,200,000 and cost of goods sold of $2,730,000 for the year. Selling and administrative expenses were $610,000. The company\'s gross profit margin for the year is closest to:',
  options: ['35.0%', '20.5%', '65.0%'],
  keyIndex: 0,
  perOptionFeedback: {
    '0': 'Correct. Gross profit of $1,470,000 divided by revenue of $4,200,000 is 35.0%.',
    '1': 'Incorrect. This deducts selling and administrative expenses as well, which gives the operating margin, not the gross margin.',
    '2': 'Incorrect. This is cost of goods sold as a percentage of revenue, the complement of gross margin.',
  },
  card: {
    conceptId: CELL.conceptId, conceptName: CELL.conceptName, cognition: 'calculate',
    itemForm: 'calculation', difficulty: 'standard',
    solution: 'Gross profit = 4,200,000 − 2,730,000 = 1,470,000. Gross margin = 1,470,000 / 4,200,000 = 35.0%.',
    distractorDiagnoses: [
      { optionIndex: 1, errorCode: 'R', description: 'Computed operating margin instead of gross margin.' },
      { optionIndex: 2, errorCode: 'S', description: 'Reported the COGS ratio rather than its complement.' },
    ],
    exactNumericValues: { revenue: 4200000, cogs: 2730000, sga: 610000 },
    isNumeric: true,
  },
}

// Identical item, key moved to an option the arithmetic does not support.
const CORRUPTED: GeneratedItemDraft = {
  ...CORRECT,
  keyIndex: 2,
  perOptionFeedback: {
    '0': 'Incorrect. This is cost of goods sold as a percentage of revenue.',
    '1': 'Incorrect. This deducts selling and administrative expenses as well.',
    '2': 'Correct. Gross profit divided by revenue gives 65.0%.',
  },
  card: {
    ...CORRECT.card,
    solution: 'Gross profit = 4,200,000 − 2,730,000 = 1,470,000. Gross margin = 65.0%.',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'S', description: 'Inverted the ratio.' },
      { optionIndex: 1, errorCode: 'R', description: 'Computed operating margin.' },
    ],
  },
}

async function online() {
  console.log('\nOnline verification (live model calls)')

  const good = await verifyItem(CORRECT, CELL, { fingerprint: 'selftest-good' })
  console.log(`  correct item → ${good.status} (${good.verifierModel})`)
  for (const g of good.gates) console.log(`      ${g.passed ? '✓' : '✗'} ${g.gate}: ${g.detail}`)
  check('a sound item passes', good.status === 'PASS', good.reason)

  const bad = await verifyItem(CORRUPTED, CELL, { fingerprint: 'selftest-bad' })
  console.log(`  corrupted key  → ${bad.status} (${bad.verifierModel})`)
  for (const g of bad.gates) console.log(`      ${g.passed ? '✓' : '✗'} ${g.gate}: ${g.detail}`)
  check('a wrong key is rejected', bad.status === 'VOID', `got ${bad.status}: ${bad.reason}`)
  check('rejection names the mismatch',
    bad.defectCodes.some(c => c === 'NUM_KEY_MISMATCH' || c === 'ANSWER_DISAGREEMENT'),
    bad.defectCodes.join(', '))

  const dup = await verifyItem(CORRECT, CELL, {
    fingerprint: 'selftest-good',
    existingFingerprints: new Set(['selftest-good']),
  })
  check('a duplicate is rejected without a model call', dup.status === 'VOID' && dup.defectCodes.includes('DUPLICATE'), dup.reason)
}

async function run() {
  if (process.argv.includes('--online')) await online()
  else console.log('\n(skipping online checks — pass --online to include them)')

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

run().catch(error => {
  console.error('\nSelf-test crashed:', error)
  process.exit(1)
})
