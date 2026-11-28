import { PROMPT_VERSIONS } from '../../src/lib/diagnostic/promptVersions'
import type { Cognition, Difficulty, ErrorCode, GeneratedItemDraft, ItemForm } from '../../src/lib/diagnostic/types'

export type PilotItemRecord<ReadingId extends string = 'r032' | 'r004'> = {
  id: string
  itemVersion: number
  revisionHistory?: { fromVersion: number; toVersion: number; reason: string }[]
  codexBlindSolve: { versionSolved: number | null; status: 'matched_key' | 'pending_reverify_after_v2_edit' }
  familyId: string
  edition: string
  manifestId: string
  readingId: ReadingId
  outcomeId: string
  conceptIdSeed: string
  packId: string
  packVersion: string
  rubricVersion: string
  promptVersions: typeof PROMPT_VERSIONS
  intendedDifficulty: Exclude<Difficulty, 'stretch'>
  legacyTierLabel: 'Easy' | 'Medium' | 'Hard'
  comparativeTierRationale: string
  reviewerConfirmedDifficulty: null
  reviewStatus: 'draft' | 'verified'
  published: false
  estimatedSeconds: number
  tierRationale: string
  calculationAndAssumptions: string
  keyFormula?: string
  distractorFormulas?: Record<string, string>
  draft: GeneratedItemDraft
}

export const PILOT_MANIFEST_ID = '11111111-1111-1111-1111-111111111111'
export const PILOT_RUBRIC_VERSION = 'phase1-rubric.1'

function makeItem(spec: {
  id: string
  itemVersion?: number
  revisionHistory?: { fromVersion: number; toVersion: number; reason: string }[]
  codexBlindSolve?: { versionSolved: number | null; status: 'matched_key' | 'pending_reverify_after_v2_edit' }
  familyId: string
  readingId: 'r032' | 'r004'
  outcomeId: string
  conceptName: string
  packId: string
  cognition: Cognition
  itemForm: ItemForm
  intendedDifficulty: Exclude<Difficulty, 'stretch'>
  legacyTierLabel: 'Easy' | 'Medium' | 'Hard'
  comparativeTierRationale?: string
  estimatedSeconds: number
  tierRationale: string
  calculationAndAssumptions: string
  stem: string
  options: [string, string, string]
  keyIndex: 0 | 1 | 2
  solution: string
  keyFeedback: string
  distractors: Array<{ optionIndex: 0 | 1 | 2; errorCode: ErrorCode; description: string; feedback: string }>
  isNumeric: boolean
  exactNumericValues: Record<string, number>
  keyFormula?: string
  distractorFormulas?: Record<string, string>
}): PilotItemRecord {
  const perOptionFeedback: Record<string, string> = {
    [String(spec.keyIndex)]: spec.keyFeedback,
  }
  for (const d of spec.distractors) {
    perOptionFeedback[String(d.optionIndex)] = d.feedback
  }
  const itemVersion = spec.itemVersion ?? 1
  return {
    id: spec.id,
    itemVersion,
    ...(spec.revisionHistory ? { revisionHistory: spec.revisionHistory } : {}),
    codexBlindSolve: spec.codexBlindSolve ?? { versionSolved: 1, status: 'matched_key' },
    familyId: spec.familyId,
    edition: '2027',
    manifestId: PILOT_MANIFEST_ID,
    readingId: spec.readingId,
    outcomeId: spec.outcomeId,
    conceptIdSeed: `concept:${PILOT_MANIFEST_ID}:${spec.outcomeId}`,
    packId: spec.packId,
    packVersion: '1',
    rubricVersion: PILOT_RUBRIC_VERSION,
    promptVersions: PROMPT_VERSIONS,
    intendedDifficulty: spec.intendedDifficulty,
    legacyTierLabel: spec.legacyTierLabel,
    comparativeTierRationale: spec.comparativeTierRationale ?? spec.tierRationale,
    reviewerConfirmedDifficulty: null,
    reviewStatus: 'verified',
    published: false,
    estimatedSeconds: spec.estimatedSeconds,
    tierRationale: spec.tierRationale,
    calculationAndAssumptions: spec.calculationAndAssumptions,
    keyFormula: spec.keyFormula,
    distractorFormulas: spec.distractorFormulas,
    draft: {
      stem: spec.stem,
      options: spec.options,
      keyIndex: spec.keyIndex,
      perOptionFeedback,
      generatorModel: 'prepplan-phase1-authoring-pilot (human review pending)',
      card: {
        conceptId: spec.outcomeId,
        conceptName: spec.conceptName,
        cognition: spec.cognition,
        itemForm: spec.itemForm,
        difficulty: spec.intendedDifficulty,
        solution: spec.solution,
        distractorDiagnoses: spec.distractors.map(d => ({
          optionIndex: d.optionIndex,
          errorCode: d.errorCode,
          description: d.description,
        })),
        exactNumericValues: spec.exactNumericValues,
        isNumeric: spec.isNumeric,
      },
    },
  }
}

export const PHASE1_PILOT_ITEMS: PilotItemRecord[] = [
  // =========================================================================
  // Reading 32 (FSA): Analysis of Inventories
  // =========================================================================
  makeItem({
    id: 'pp-2027-r032-a-easy',
    familyId: 'fam-pp-2027-r032-a-nrv-def',
    readingId: 'r032',
    outcomeId: 'r032-a',
    conceptName: 'Describe lower of cost and net realizable value measurement',
    packId: 'prepplan-r032-a-lcnrv',
    cognition: 'recall',
    itemForm: 'direct',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    estimatedSeconds: 35,
    tierRationale: 'Tests one explicit Level I definition (IFRS net realizable value) without scenario distractions.',
    calculationAndAssumptions: 'Qualitative definition under IFRS: NRV = estimated selling price - estimated completion costs - estimated selling costs.',
    stem: 'Under IFRS, a distributor measures ending inventory at the lower of cost and net realizable value (NRV). Which expression best defines NRV?',
    options: [
      'Estimated selling price minus estimated completion and selling costs',
      'Estimated selling price minus a normal profit margin and selling costs',
      'Current replacement cost bounded between selling price and purchase cost',
    ],
    keyIndex: 0,
    solution: 'Under IFRS, net realizable value equals the estimated selling price in the ordinary course of business minus estimated costs of completion and estimated costs necessary to make the sale.',
    keyFeedback: 'Correct. IFRS defines NRV as estimated selling price less estimated completion and selling costs.',
    distractors: [
      {
        optionIndex: 1,
        errorCode: 'C',
        description: 'Deducts a normal profit margin, confusing IFRS NRV with the US GAAP lower-of-cost-or-market floor.',
        feedback: 'Incorrect. Deducting a normal profit margin defines the US GAAP market floor, not IFRS NRV.',
      },
      {
        optionIndex: 2,
        errorCode: 'G',
        description: 'Uses current replacement cost, which belongs to US GAAP lower of cost or market for LIFO/retail.',
        feedback: 'Incorrect. Replacement cost is used under US GAAP lower of cost or market, not IFRS NRV.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r032-a-medium',
    familyId: 'fam-pp-2027-r032-a-writedown-calc',
    readingId: 'r032',
    outcomeId: 'r032-a',
    conceptName: 'Describe lower of cost and net realizable value measurement',
    packId: 'prepplan-r032-a-lcnrv',
    cognition: 'calculate',
    itemForm: 'calculation',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    estimatedSeconds: 55,
    tierRationale: 'Requires two connected steps under IFRS: compute per-unit NRV after both completion and selling costs, then multiply the per-unit shortfall by units.',
    calculationAndAssumptions: 'IFRS; 400 units; cost = $50/unit; selling price = $52/unit; completion = $4/unit; selling = $3/unit. NRV = 52 - 4 - 3 = $45. Write-down = 400 * (50 - 45) = $2,000.',
    stem: 'A manufacturer reporting under IFRS holds 400 units of inventory with a carrying cost of $50.00 per unit. At year-end, the estimated selling price is $52.00 per unit, estimated costs to complete are $4.00 per unit, and estimated selling costs are $3.00 per unit. What total inventory write-down must the company recognize?',
    options: ['$800', '$1,600', '$2,000'],
    keyIndex: 2,
    solution: 'NRV per unit is $52.00 - $4.00 - $3.00 = $45.00. Because cost ($50.00) exceeds NRV ($45.00), the write-down is $5.00 per unit, or 400 x $5.00 = $2,000.',
    keyFeedback: 'Correct. NRV is $45.00 per unit, requiring a $5.00 per-unit write-down across 400 units ($2,000).',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'I',
        description: 'Omits selling costs from NRV, computing NRV = $48.00 and write-down = 400 * ($50 - $48) = $800.',
        feedback: 'Incorrect. Selling costs must also be deducted from estimated selling price to determine NRV.',
      },
      {
        optionIndex: 1,
        errorCode: 'R',
        description: 'Reports total completion costs (400 * $4 = $1,600) instead of the excess of cost over NRV.',
        feedback: 'Incorrect. Completion costs reduce NRV rather than directly equaling the write-down.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { units: 400, cost: 50, sp: 52, comp: 4, sell: 3 },
    keyFormula: 'units * (cost - (sp - comp - sell))',
    distractorFormulas: {
      '0': 'units * (cost - (sp - comp))',
      '1': 'units * comp',
    },
  }),

  makeItem({
    id: 'pp-2027-r032-a-hard',
    familyId: 'fam-pp-2027-r032-a-gaap-lcm-ceiling',
    readingId: 'r032',
    outcomeId: 'r032-a',
    conceptName: 'Describe lower of cost and net realizable value measurement',
    packId: 'prepplan-r032-a-lcnrv',
    cognition: 'apply',
    itemForm: 'scenario',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    estimatedSeconds: 70,
    tierRationale: 'Applies the US GAAP LIFO lower-of-cost-or-market boundary condition where replacement cost exceeds the NRV ceiling.',
    calculationAndAssumptions: 'US GAAP LIFO uses lower of cost or market. NRV (ceiling) = 95 - 7 = 88. Floor = 88 - 10 = 78. Replacement = 92 > ceiling (88), so market = 88. Carrying amount = min(cost=94, market=88) = $88.',
    stem: 'A US retailer using LIFO holds inventory with a historical cost of $94 per unit and a current replacement cost of $92 per unit. The estimated selling price is $95 per unit, estimated disposal costs are $7 per unit, and a normal profit margin is $10 per unit. Under US GAAP, what carrying amount per unit should the retailer report?',
    options: ['$78', '$88', '$92'],
    keyIndex: 1,
    solution: 'Under US GAAP for LIFO inventory, market is replacement cost ($92) bounded by the ceiling (NRV = $95 - $7 = $88) and the floor ($88 - $10 = $78). Because replacement cost exceeds the ceiling, market is $88, and the lower of cost ($94) and market ($88) is $88.',
    keyFeedback: 'Correct. Replacement cost ($92) is capped at the NRV ceiling ($88), which is below historical cost ($94).',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'C',
        description: 'Selects the market floor (NRV - normal profit = $78) instead of the ceiling ($88).',
        feedback: 'Incorrect. $78 is the market floor, which binds only when replacement cost falls below it.',
      },
      {
        optionIndex: 2,
        errorCode: 'I',
        description: 'Uses current replacement cost ($92) directly without applying the NRV ceiling cap.',
        feedback: 'Incorrect. Under US GAAP, market cannot exceed the NRV ceiling ($88).',
      },
    ],
    isNumeric: true,
    exactNumericValues: { cost: 94, replacement: 92, sp: 95, sell: 7, normalProfit: 10 },
    keyFormula: 'min(cost, max(sp - sell - normalProfit, min(replacement, sp - sell)))',
    distractorFormulas: {
      '0': 'sp - sell - normalProfit',
      '2': 'min(cost, replacement)',
    },
  }),

  makeItem({
    id: 'pp-2027-r032-b-easy',
    itemVersion: 3,
    revisionHistory: [
      { fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: test COGS and ending inventory directly instead of current ratio.' },
      { fromVersion: 2, toVersion: 3, reason: 'Codex Part B finding: replaced distractor B so both wrong options do not claim higher FIFO COGS (learner cannot eliminate two options using COGS alone).' },
    ],
    codexBlindSolve: { versionSolved: 3, status: 'matched_key' },
    familyId: 'fam-pp-2027-r032-b-fifo-lifo-direction',
    readingId: 'r032',
    outcomeId: 'r032-b',
    conceptName: 'Calculate and explain how inventory methods affect statements and ratios',
    packId: 'prepplan-r032-b-methods',
    cognition: 'compare',
    itemForm: 'direct',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    comparativeTierRationale: 'Easy (1-step qualitative direction: COGS and ending inventory under FIFO vs LIFO) < Medium (2-step COGS restatement using change in LIFO reserve) < Hard (multi-step restatement of both COGS and average inventory to compute turnover).',
    estimatedSeconds: 35,
    tierRationale: 'Tests one direct Level I comparison of COGS and ending inventory between FIFO and LIFO under rising unit costs.',
    calculationAndAssumptions: 'Rising unit costs + stable quantities: FIFO expenses older lower costs (lower COGS) and retains newer higher costs in ending inventory (higher ending inventory).',
    stem: 'During a period of rising unit purchase costs and stable inventory quantities, a company using FIFO rather than LIFO will most likely report:',
    options: [
      'Higher cost of goods sold and lower ending inventory',
      'Lower cost of goods sold and lower ending inventory',
      'Lower cost of goods sold and higher ending inventory',
    ],
    keyIndex: 2,
    solution: 'With rising prices, FIFO assigns older, lower costs to COGS and newer, higher costs to ending inventory, resulting in lower COGS and higher ending inventory than LIFO.',
    keyFeedback: 'Correct. FIFO yields lower COGS and higher ending inventory when unit costs are rising.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'S',
        description: 'Reverses both the COGS and ending inventory effects of FIFO vs LIFO under rising prices.',
        feedback: 'Incorrect. Higher COGS and lower ending inventory occur under LIFO, not FIFO, when prices rise.',
      },
      {
        optionIndex: 1,
        errorCode: 'S',
        description: 'Correctly identifies lower COGS under FIFO but incorrectly pairs it with lower ending inventory.',
        feedback: 'Incorrect. Because lower costs are expensed into COGS, the newer higher costs remain in ending inventory, making ending inventory higher.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r032-b-medium',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A calibration check: upgraded from 1-step ending-inventory addition to 2-step FIFO COGS restatement using the change in LIFO reserve while ignoring the irrelevant ending inventory.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r032-b-lifo-reserve-inv',
    readingId: 'r032',
    outcomeId: 'r032-b',
    conceptName: 'Calculate and explain how inventory methods affect statements and ratios',
    packId: 'prepplan-r032-b-methods',
    cognition: 'calculate',
    itemForm: 'calculation',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    comparativeTierRationale: 'Easy (qualitative COGS/inventory direction) < Medium (2-step FIFO COGS restatement requiring selection of reserve change and sign direction while ignoring ending inventory) < Hard (restating both COGS and average inventory for turnover).',
    estimatedSeconds: 55,
    tierRationale: 'Requires selecting the change in the LIFO reserve (ignoring ending inventory as a distractor) and subtracting it from LIFO COGS.',
    calculationAndAssumptions: 'FIFO COGS = LIFO COGS - (Ending LIFO Reserve - Beginning LIFO Reserve) = 620 - (43 - 28) = 620 - 15 = $605 million.',
    stem: 'A US manufacturing firm using LIFO reports cost of goods sold of $620 million and ending inventory of $165 million. Its footnotes disclose a beginning LIFO reserve of $28 million and an ending LIFO reserve of $43 million. What would cost of goods sold have been on a FIFO basis?',
    options: ['$577 million', '$605 million', '$635 million'],
    keyIndex: 1,
    solution: 'FIFO COGS equals LIFO COGS minus the increase in the LIFO reserve during the period: $620 million - ($43 million - $28 million) = $605 million.',
    keyFeedback: 'Correct. Subtracting the $15 million increase in the LIFO reserve from LIFO COGS gives $605 million.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'I',
        description: 'Subtracts the full ending LIFO reserve ($43 million) instead of the period change ($15 million): $620 - $43 = $577 million.',
        feedback: 'Incorrect. Only the change in the LIFO reserve adjusts COGS; the cumulative ending reserve adjusts ending inventory.',
      },
      {
        optionIndex: 2,
        errorCode: 'S',
        description: 'Adds the change in the LIFO reserve to LIFO COGS instead of subtracting it: $620 + $15 = $635 million.',
        feedback: 'Incorrect. Because the LIFO reserve grew, LIFO COGS exceeded FIFO COGS, so the change is subtracted.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { lifoCogs: 620, lifoInv: 165, begRes: 28, endRes: 43 },
    keyFormula: 'lifoCogs - (endRes - begRes)',
    distractorFormulas: {
      '0': 'lifoCogs - endRes',
      '2': 'lifoCogs + (endRes - begRes)',
    },
  }),

  makeItem({
    id: 'pp-2027-r032-b-hard',
    familyId: 'fam-pp-2027-r032-b-fifo-turnover-restate',
    readingId: 'r032',
    outcomeId: 'r032-b',
    conceptName: 'Calculate and explain how inventory methods affect statements and ratios',
    packId: 'prepplan-r032-b-methods',
    cognition: 'calculate',
    itemForm: 'data_table',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    estimatedSeconds: 80,
    tierRationale: 'Two linked adjustments: restate COGS using the change in LIFO reserve AND restate average inventory using the average LIFO reserve before computing turnover.',
    calculationAndAssumptions: 'FIFO COGS = 840 - (50 - 30) = 820. Avg LIFO inv = (180 + 200)/2 = 190. Avg reserve = (30 + 50)/2 = 40. Avg FIFO inv = 190 + 40 = 230. Turnover = 820 / 230 = 3.5652 -> 3.57x.',
    stem: 'An analyst restates a US GAAP LIFO company to FIFO using the following year-end data ($ millions):\n- LIFO cost of goods sold: $840\n- Beginning LIFO inventory: $180 | Ending LIFO inventory: $200\n- Beginning LIFO reserve: $30 | Ending LIFO reserve: $50\nUsing average inventory, the company\'s restated FIFO inventory turnover ratio is closest to:',
    options: ['3.57x', '3.65x', '4.32x'],
    keyIndex: 0,
    solution: 'FIFO COGS = $840 - ($50 - $30) = $820 million. Average FIFO inventory = ($180 + $30 + $200 + $50) / 2 = $230 million. FIFO inventory turnover = $820 / $230 = 3.57x.',
    keyFeedback: 'Correct. Both COGS ($820 million) and average inventory ($230 million) are restated to FIFO, giving 3.57x.',
    distractors: [
      {
        optionIndex: 1,
        errorCode: 'I',
        description: 'Restates average inventory to FIFO ($230 million) but leaves COGS unadjusted at $840 million (840 / 230 = 3.65x).',
        feedback: 'Incorrect. COGS must also be reduced by the $20 million increase in the LIFO reserve.',
      },
      {
        optionIndex: 2,
        errorCode: 'I',
        description: 'Restates COGS to FIFO ($820 million) but leaves average inventory on a LIFO basis ($190 million; 820 / 190 = 4.32x).',
        feedback: 'Incorrect. Average inventory must also be increased by the average LIFO reserve ($40 million).',
      },
    ],
    isNumeric: true,
    exactNumericValues: { lifoCogs: 840, begInv: 180, endInv: 200, begRes: 30, endRes: 50 },
    keyFormula: '(lifoCogs - (endRes - begRes)) / ((begInv + begRes + endInv + endRes) / 2)',
    distractorFormulas: {
      '1': 'lifoCogs / ((begInv + begRes + endInv + endRes) / 2)',
      '2': '(lifoCogs - (endRes - begRes)) / ((begInv + endInv) / 2)',
    },
  }),

  makeItem({
    id: 'pp-2027-r032-c-easy',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: narrowed to U.S. SEC registrant with material LIFO-liquidation income, noted footnote or parenthetical income statement disclosure, avoided implying universal footnote requirement, and made distractor A accurate for the specified scope.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r032-c-gaap-disclosure',
    readingId: 'r032',
    outcomeId: 'r032-c',
    conceptName: 'Explain inventory presentation and disclosures',
    packId: 'prepplan-r032-c-disclosure',
    cognition: 'recall',
    itemForm: 'direct',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    comparativeTierRationale: 'Easy (standard-specific disclosure rule for a U.S. SEC registrant) < Medium (interpreting concurrent inventory composition and write-down signals) < Hard (quantifying periodic LIFO liquidation profit against current replacement cost).',
    estimatedSeconds: 40,
    tierRationale: 'Tests one explicit standard-specific disclosure distinction for a U.S. SEC registrant under US GAAP vs IFRS.',
    calculationAndAssumptions: 'U.S. SEC registrants using LIFO must disclose material income effects from LIFO liquidations (in footnotes or parenthetically on the income statement); IFRS prohibits LIFO and requires write-down reversal disclosures.',
    stem: 'For a U.S. SEC registrant experiencing material LIFO-liquidation income, which inventory disclosure is specific to US GAAP/SEC reporting rather than IFRS?',
    options: [
      'Inventory accounting policies and cost formulas used',
      'Reversals of prior inventory write-downs recognized in profit',
      'Material income effects from LIFO liquidations (in a note or parenthetically)',
    ],
    keyIndex: 2,
    solution: 'IFRS prohibits LIFO, so disclosing material income from LIFO liquidations (either in the footnotes or parenthetically on the income statement under SEC guidance) applies only to US GAAP/SEC reporting.',
    keyFeedback: 'Correct. Material LIFO-liquidation income is disclosed under US GAAP/SEC guidance (in a note or parenthetically) and does not apply under IFRS.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'C',
        description: 'Identifies a shared disclosure (inventory accounting policies and cost formulas) required under both US GAAP and IFRS.',
        feedback: 'Incorrect. Both US GAAP and IFRS require disclosure of inventory accounting policies and cost formulas.',
      },
      {
        optionIndex: 1,
        errorCode: 'G',
        description: 'Attributes an IFRS-only disclosure (write-down reversals) to US GAAP, where reversals are prohibited.',
        feedback: 'Incorrect. Write-down reversals are permitted and disclosed under IFRS, whereas US GAAP prohibits reversals.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r032-c-medium',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: tightened rationale so falling raw materials and flat unit sales support possible obsolescence/inventory buildup without overclaiming reduced purchasing or slowing demand, and used more credible competing interpretations.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r032-c-composition-signal',
    readingId: 'r032',
    outcomeId: 'r032-c',
    conceptName: 'Explain inventory presentation and disclosures',
    packId: 'prepplan-r032-c-disclosure',
    cognition: 'interpret',
    itemForm: 'scenario',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    comparativeTierRationale: 'Easy (US GAAP/SEC vs IFRS disclosure rule) < Medium (interpreting concurrent inventory composition and write-down signals) < Hard (quantifying periodic LIFO liquidation profit).',
    estimatedSeconds: 50,
    tierRationale: 'Requires weighing competing operational interpretations of rising finished goods and doubled write-downs alongside falling raw materials and flat unit sales.',
    calculationAndAssumptions: 'Rising finished goods + doubling write-downs + flat unit sales + falling raw materials supports possible obsolescence or finished-goods buildup warranting margin scrutiny.',
    stem: 'Over the past three quarters, a manufacturer\'s raw materials balance declined by 18% while finished goods rose by 34% and inventory write-downs doubled, even though unit sales remained flat. Which conclusion is most reasonable for an analyst?',
    options: [
      'Possible inventory obsolescence or finished-goods buildup warrants margin scrutiny',
      'The company is expanding raw-material buffers ahead of an expected order surge',
      'A switch from periodic to perpetual inventory tracking explains the write-downs',
    ],
    keyIndex: 0,
    solution: 'A 34% rise in finished goods alongside flat unit sales and doubled write-downs indicates possible obsolescence or excess finished-goods buildup that could pressure future margins, whereas falling raw materials does not indicate input stockpiling.',
    keyFeedback: 'Correct. Rising finished goods and doubled write-downs with flat sales point to possible obsolescence or inventory buildup.',
    distractors: [
      {
        optionIndex: 1,
        errorCode: 'S',
        description: 'Interprets falling raw materials as expanding input buffers.',
        feedback: 'Incorrect. Raw materials declined by 18%, which is inconsistent with expanding raw-material buffers.',
      },
      {
        optionIndex: 2,
        errorCode: 'C',
        description: 'Attributes operational write-downs and finished-goods accumulation to a tracking-system change (periodic vs perpetual).',
        feedback: 'Incorrect. Periodic vs perpetual tracking does not cause inventory write-downs to double when unit costs/NRV are unchanged.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r032-c-hard',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: stated periodic LIFO explicitly and defined the incremental gross-profit benchmark as replacing the 300 prior-layer units at the current year\'s $68 purchase cost.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r032-c-lifo-liquidation-profit',
    readingId: 'r032',
    outcomeId: 'r032-c',
    conceptName: 'Explain inventory presentation and disclosures',
    packId: 'prepplan-r032-c-disclosure',
    cognition: 'calculate',
    itemForm: 'scenario',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    comparativeTierRationale: 'Easy (disclosure rule) < Medium (qualitative signal interpretation) < Hard (quantifying periodic LIFO liquidation profit against current replacement cost).',
    estimatedSeconds: 75,
    tierRationale: 'Requires identifying the exact liquidated layer under periodic LIFO (most recent prior layer, not oldest) and measuring incremental gross profit relative to replacing those 300 units at the current year\'s $68 cost.',
    calculationAndAssumptions: 'Periodic LIFO; sold 1200, purchased 900 at $68 -> 300 units liquidated from most recent prior layer ($58, not $45). Incremental gross profit vs replacing at $68 = 300 * (68 - 58) = $3,000.',
    stem: 'A US GAAP distributor using periodic LIFO sells 1,200 units during the year at $90 per unit while purchasing 900 units at $68 per unit. Beginning inventory consisted of two LIFO layers: 400 units at $45 per unit (oldest) and 300 units at $58 per unit (most recent). Relative to replacing the 300 prior-layer units at the current year\'s $68 purchase cost, what incremental gross profit is attributable to LIFO liquidation?',
    options: ['$3,000', '$6,900', '$9,600'],
    keyIndex: 0,
    solution: 'Under periodic LIFO, sales exceed current-year purchases by 1,200 - 900 = 300 units, liquidating the most recent beginning layer (300 units at $58). Relative to replacing those 300 units at the current-year cost of $68, COGS is lower—and gross profit higher—by 300 x ($68 - $58) = $3,000.',
    keyFeedback: 'Correct. Liquidating 300 units from the $58 layer rather than replacing them at $68 adds $3,000 to gross profit.',
    distractors: [
      {
        optionIndex: 1,
        errorCode: 'F',
        description: 'Draws the 300 liquidated units from the oldest $45 layer instead of the most recent $58 layer: 300 * ($68 - $45) = $6,900.',
        feedback: 'Incorrect. Under periodic LIFO, the most recent prior layer ($58) is liquidated before the oldest layer ($45).',
      },
      {
        optionIndex: 2,
        errorCode: 'R',
        description: 'Computes total gross profit on the 300 liquidated units: 300 * ($90 - $58) = $9,600.',
        feedback: 'Incorrect. Incremental LIFO liquidation profit compares the $58 liquidated layer cost against the $68 current replacement cost, not the $90 selling price.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { sold: 1200, price: 90, purchased: 900, currCost: 68, oldUnits: 400, oldCost: 45, newUnits: 300, newCost: 58 },
    keyFormula: '(sold - purchased) * (currCost - newCost)',
    distractorFormulas: {
      '1': '(sold - purchased) * (currCost - oldCost)',
      '2': '(sold - purchased) * (price - newCost)',
    },
  }),

  // =========================================================================
  // Reading 4 (Quant): The Time Value of Money in Finance
  // =========================================================================
  makeItem({
    id: 'pp-2027-r004-a-easy',
    familyId: 'fam-pp-2027-r004-a-perpetuity-pv',
    readingId: 'r004',
    outcomeId: 'r004-a',
    conceptName: 'Value fixed-income and equity cash flows by present value',
    packId: 'prepplan-r004-a-pv',
    cognition: 'calculate',
    itemForm: 'calculation',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    estimatedSeconds: 35,
    tierRationale: 'Direct single-step perpetuity valuation using PV = C / r.',
    calculationAndAssumptions: 'Level perpetuity starting at t = 1; C = $4.50; r = 7.5% = 0.075. PV = 4.50 / 0.075 = $60.00.',
    stem: 'A preferred share pays a fixed annual dividend of $4.50 at the end of each year in perpetuity, starting one year from today. If the required annual rate of return is 7.5%, the present value of the share is closest to:',
    options: ['$55.81', '$60.00', '$64.50'],
    keyIndex: 1,
    solution: 'The present value of an ordinary level perpetuity is C / r = $4.50 / 0.075 = $60.00.',
    keyFeedback: 'Correct. PV = $4.50 / 0.075 = $60.00.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'T',
        description: 'Discounts the perpetuity value one extra period: ($4.50 / 0.075) / 1.075 = $55.81.',
        feedback: 'Incorrect. Because the first dividend is at t = 1, C / r already gives the value at t = 0.',
      },
      {
        optionIndex: 2,
        errorCode: 'T',
        description: 'Treats the ordinary perpetuity as a perpetuity due: ($4.50 / 0.075) * 1.075 = $64.50.',
        feedback: 'Incorrect. The first dividend occurs at the end of Year 1, not today.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { div: 4.5, r: 0.075 },
    keyFormula: 'div / r',
    distractorFormulas: {
      '0': 'div / (r * (1 + r))',
      '2': '(div / r) * (1 + r)',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-a-medium',
    familyId: 'fam-pp-2027-r004-a-semiannual-bond',
    readingId: 'r004',
    outcomeId: 'r004-a',
    conceptName: 'Value fixed-income and equity cash flows by present value',
    packId: 'prepplan-r004-a-pv',
    cognition: 'calculate',
    itemForm: 'calculation',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    estimatedSeconds: 70,
    tierRationale: 'Requires aligning coupon payment, discount rate, and number of periods to semiannual compounding for a fixed-coupon bond.',
    calculationAndAssumptions: 'Par = $1,000; 2 years -> N = 4; 6% annual coupon semiannually -> PMT = $30; 8% YTM compounded semiannually -> r = 4% = 0.04. PV = 30*(1 - 1.04^-4)/0.04 + 1000/1.04^4 = 963.70.',
    stem: 'A 2-year, $1,000 par-value corporate bond pays a 6.0% annual coupon rate semiannually ($30 every six months). If the annual yield to maturity (compounded semiannually) is 8.0%, the bond\'s current price is closest to:',
    options: ['$834.39', '$963.70', '$964.33'],
    keyIndex: 1,
    solution: 'With 4 semiannual periods, a $30 semiannual coupon, and a 4.0% semiannual discount rate, PV = $30 x [1 - (1.04)^(-4)] / 0.04 + $1,000 / (1.04)^4 = $108.90 + $854.80 = $963.70.',
    keyFeedback: 'Correct. Discounting 4 semiannual coupons of $30 and $1,000 par at 4.0% per period yields $963.70.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'T',
        description: 'Uses the $30 semiannual coupon with the 8.0% annual rate over 4 periods: $834.39.',
        feedback: 'Incorrect. The 8.0% annual yield must be halved to 4.0% per semiannual period.',
      },
      {
        optionIndex: 2,
        errorCode: 'T',
        description: 'Uses annual discounting (N = 2, PMT = $60, r = 8.0%) instead of semiannual compounding: $964.33.',
        feedback: 'Incorrect. Semiannual coupon bonds require semiannual discounting (4 periods at 4.0%).',
      },
    ],
    isNumeric: true,
    exactNumericValues: { par: 1000, couponRate: 0.06, ytm: 0.08, years: 2, freq: 2 },
    keyFormula: '(par * couponRate / freq) * (1 - (1 + ytm / freq)^(-(years * freq))) / (ytm / freq) + par / (1 + ytm / freq)^(years * freq)',
    distractorFormulas: {
      '0': '(par * couponRate / freq) * (1 - (1 + ytm)^(-(years * freq))) / ytm + par / (1 + ytm)^(years * freq)',
      '2': '(par * couponRate) * (1 - (1 + ytm)^(-years)) / ytm + par / (1 + ytm)^years',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-a-hard',
    familyId: 'fam-pp-2027-r004-a-deferred-growing-perp',
    readingId: 'r004',
    outcomeId: 'r004-a',
    conceptName: 'Value fixed-income and equity cash flows by present value',
    packId: 'prepplan-r004-a-pv',
    cognition: 'calculate',
    itemForm: 'scenario',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    estimatedSeconds: 75,
    tierRationale: 'Two-step deferred growing perpetuity valuation requiring exact timing alignment (value at t = 3, then discount 3 periods to t = 0).',
    calculationAndAssumptions: 'First CF at t = 4 is $120,000; g = 2.5%; r = 8.5%. Value at t = 3 is 120000 / (0.085 - 0.025) = 2,000,000. PV at t = 0 = 2000000 / 1.085^3 = $1,565,816.',
    stem: 'An infrastructure asset is expected to generate its first annual net cash flow of $120,000 at the end of Year 4, with subsequent annual cash flows growing at 2.5% per year indefinitely. If the required annual return is 8.5%, the present value of the asset today (at t = 0) is closest to:',
    options: ['$1,443,149', '$1,565,816', '$1,698,911'],
    keyIndex: 1,
    solution: 'The growing perpetuity formula applied to the Year 4 cash flow gives the value at t = 3: $120,000 / (0.085 - 0.025) = $2,000,000. Discounting back 3 years to t = 0 gives $2,000,000 / (1.085)^3 = $1,565,816.',
    keyFeedback: 'Correct. Valuing the growing perpetuity at t = 3 ($2,000,000) and discounting 3 years to t = 0 yields $1,565,816.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'T',
        description: 'Discounts the $2,000,000 perpetuity value 4 years instead of 3 years: $2,000,000 / 1.085^4 = $1,443,149.',
        feedback: 'Incorrect. Because the first cash flow is at t = 4, the perpetuity value sits at t = 3 and is discounted 3 years, not 4.',
      },
      {
        optionIndex: 2,
        errorCode: 'T',
        description: 'Discounts the $2,000,000 perpetuity value only 2 years: $2,000,000 / 1.085^2 = $1,698,911.',
        feedback: 'Incorrect. Discounting 2 years gives the value at t = 1 rather than t = 0.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { cf4: 120000, g: 0.025, r: 0.085, startYear: 4 },
    keyFormula: '(cf4 / (r - g)) / (1 + r)^(startYear - 1)',
    distractorFormulas: {
      '0': '(cf4 / (r - g)) / (1 + r)^startYear',
      '2': '(cf4 / (r - g)) / (1 + r)^(startYear - 2)',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-b-easy',
    familyId: 'fam-pp-2027-r004-b-zero-coupon-cagr',
    readingId: 'r004',
    outcomeId: 'r004-b',
    conceptName: 'Derive implied return and implied growth',
    packId: 'prepplan-r004-b-implied',
    cognition: 'calculate',
    itemForm: 'calculation',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    estimatedSeconds: 40,
    tierRationale: 'Direct single-formula calculation of compound implied return from PV, FV, and T.',
    calculationAndAssumptions: 'FV = 1000; PV = 762.90; T = 4. r = (1000 / 762.90)^(1/4) - 1 = 7.00%.',
    stem: 'A 4-year zero-coupon note with a face value of $1,000 currently trades at $762.90. Its implied annual compound rate of return is closest to:',
    options: ['5.93%', '7.00%', '7.77%'],
    keyIndex: 1,
    solution: 'The implied annual compound return is (FV / PV)^(1/T) - 1 = ($1,000 / $762.90)^(1/4) - 1 = 7.00%.',
    keyFeedback: 'Correct. ($1,000 / $762.90)^(1/4) - 1 = 7.00%.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'F',
        description: 'Divides total discount by face value and by 4 years: (1000 - 762.90) / 1000 / 4 = 5.93%.',
        feedback: 'Incorrect. Return is measured relative to the purchase price with compounding, not as a simple discount on face value.',
      },
      {
        optionIndex: 2,
        errorCode: 'F',
        description: 'Computes simple arithmetic annual return without compounding: ((1000 / 762.90) - 1) / 4 = 7.77%.',
        feedback: 'Incorrect. Dividing the 4-year cumulative return by 4 ignores compounding.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { fv: 1000, pv: 762.9, t: 4 },
    keyFormula: '((fv / pv)^(1 / t) - 1) * 100',
    distractorFormulas: {
      '0': '((fv - pv) / fv / t) * 100',
      '2': '((fv / pv - 1) / t) * 100',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-b-medium',
    familyId: 'fam-pp-2027-r004-b-price-implied-return-effect',
    readingId: 'r004',
    outcomeId: 'r004-b',
    conceptName: 'Derive implied return and implied growth',
    packId: 'prepplan-r004-b-implied',
    cognition: 'interpret',
    itemForm: 'scenario',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    estimatedSeconds: 45,
    tierRationale: 'Requires linking a market price change to the implied required return equation r = (D1 / P0) + g while holding D1 and g constant.',
    calculationAndAssumptions: 'r = (D1 / P0) + g. Holding D1 and g constant, an increase in P0 lowers D1 / P0 and therefore lowers implied required return r.',
    stem: 'An analyst tracks a stable-growth company using the constant-growth dividend discount model. Following a market rally, the share price rises by 15% while next year\'s expected dividend and the constant dividend growth projection remain unchanged. How does the stock\'s implied required return change?',
    options: [
      'It rises because a higher share price signals stronger expected earnings',
      'It stays unchanged because the dividend growth rate did not change',
      'It falls because the forward dividend yield shrinks while growth is constant',
    ],
    keyIndex: 2,
    solution: 'Under the constant-growth model, implied required return is r = (D1 / P0) + g. When P0 rises while D1 and g are unchanged, the forward dividend yield (D1 / P0) declines, reducing r.',
    keyFeedback: 'Correct. A higher P0 lowers the forward dividend yield D1 / P0, which lowers implied required return r.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'S',
        description: 'Assumes higher stock price implies higher required return, reversing the inverse price-yield relationship.',
        feedback: 'Incorrect. With expected cash flows fixed, a higher price implies a lower expected return.',
      },
      {
        optionIndex: 1,
        errorCode: 'I',
        description: 'Focuses only on constant growth g and ignores the dividend yield component D1 / P0.',
        feedback: 'Incorrect. Implied return equals forward dividend yield plus growth, so a change in P0 alters the dividend yield.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r004-b-hard',
    itemVersion: 3,
    revisionHistory: [
      { fromVersion: 1, toVersion: 2, reason: 'Codex Part A calibration check: elevated from single algebraic rearrangement to two linked decisions (g = b * ROE, then implied required return).' },
      { fromVersion: 2, toVersion: 3, reason: 'Codex Part B finding: explicitly stated constant retention ratio, constant ROE, and dividends growing at the same rate as earnings, and grounded g = b * ROE in prepplan-r004-b-implied Fact 5.' },
    ],
    codexBlindSolve: { versionSolved: 3, status: 'matched_key' },
    familyId: 'fam-pp-2027-r004-b-ddm-implied-growth',
    readingId: 'r004',
    outcomeId: 'r004-b',
    conceptName: 'Derive implied return and implied growth',
    packId: 'prepplan-r004-b-implied',
    cognition: 'integrate',
    itemForm: 'scenario',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    comparativeTierRationale: 'Easy (single-step zero-coupon CAGR) < Medium (qualitative P0 shock on implied return) < Hard (two linked steps: derive constant growth g = b * ROE, adjust D0 to D1, and solve implied required return r).',
    estimatedSeconds: 75,
    tierRationale: 'Two linked decisions: compute constant dividend growth g from constant retention ratio and ROE, then convert D0 to D1 to derive implied required return.',
    calculationAndAssumptions: 'Constant b = 0.60, constant ROE = 10.0%, dividends grow with earnings -> g = 0.60 * 0.10 = 6.00%. D0 = $2.00 -> D1 = 2.00 * 1.06 = $2.12. P0 = $53.00 -> r = (2.12 / 53.00) + 0.06 = 0.04 + 0.06 = 10.00%.',
    stem: 'A mature company maintains a constant earnings retention ratio of 60% and a constant return on equity of 10.0%, and its dividends grow at the same rate as earnings. It just paid an annual dividend (D0) of $2.00 per share and currently trades at $53.00 per share. Under the constant-growth dividend discount model, the market\'s implied required annual return is closest to:',
    options: ['4.00%', '9.77%', '10.00%'],
    keyIndex: 2,
    solution: 'Sustainable dividend growth is g = retention ratio x ROE = 0.60 x 10.0% = 6.00%. Expected next dividend is D1 = $2.00 x 1.06 = $2.12. Implied required return is r = (D1 / P0) + g = ($2.12 / $53.00) + 6.00% = 4.00% + 6.00% = 10.00%.',
    keyFeedback: 'Correct. Sustainable growth is 6.00% and D1 is $2.12, giving an implied return of 4.00% + 6.00% = 10.00%.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'I',
        description: 'Reports only the forward dividend yield D1 / P0 = $2.12 / $53.00 = 4.00% and omits growth g.',
        feedback: 'Incorrect. Total implied required return equals forward dividend yield plus the constant growth rate g.',
      },
      {
        optionIndex: 1,
        errorCode: 'T',
        description: 'Uses D0 ($2.00) instead of D1 ($2.12): ($2.00 / $53.00) + 6.00% = 9.77%.',
        feedback: 'Incorrect. The Gordon growth model requires next year\'s expected dividend D1 = D0(1 + g).',
      },
    ],
    isNumeric: true,
    exactNumericValues: { b: 0.6, roe: 0.1, d0: 2, p0: 53 },
    keyFormula: '(d0 * (1 + b * roe) / p0 + b * roe) * 100',
    distractorFormulas: {
      '0': '(d0 * (1 + b * roe) / p0) * 100',
      '1': '(d0 / p0 + b * roe) * 100',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-c-easy',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: explicitly stated frictionless trading and shorting assumptions (no transaction costs, taxes, or short-sale constraints) in the stem.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r004-c-additivity-arb',
    readingId: 'r004',
    outcomeId: 'r004-c',
    conceptName: 'Explain cash flow additivity, no-arbitrage, forward rates and option values',
    packId: 'prepplan-r004-c-additivity',
    cognition: 'apply',
    itemForm: 'direct',
    intendedDifficulty: 'foundation',
    legacyTierLabel: 'Easy',
    comparativeTierRationale: 'Easy (direct law-of-one-price arbitrage trade under frictionless markets) < Medium (breakeven reinvestment forward rate in a rollover vs 2-year bond scenario) < Hard (no-arbitrage binomial option replication).',
    estimatedSeconds: 40,
    tierRationale: 'Direct application of the law of one price / cash flow additivity under explicit frictionless market assumptions.',
    calculationAndAssumptions: 'Frictionless markets (no transaction costs, taxes, or short-sale constraints); identical cash flows in every state and period -> buy cheaper (X), short dearer (Y) for riskless profit.',
    stem: 'In a frictionless market with no transaction costs, taxes, or short-sale constraints, Portfolio X and Portfolio Y deliver identical cash flows in every future period and state of the world, yet Portfolio X trades at a lower price than Portfolio Y. Under the cash flow additivity principle, what does no-arbitrage imply?',
    options: [
      'Buying Portfolio X and selling short Portfolio Y locks in a riskless profit today',
      'Portfolio X must carry greater systematic risk than Portfolio Y to justify its lower price',
      'Portfolio Y will outperform Portfolio X in every future state of the world',
    ],
    keyIndex: 0,
    solution: 'Because both portfolios produce identical future cash flows in every state and trading is frictionless, buying the cheaper portfolio (X) and shorting the more expensive portfolio (Y) cancels all future cash flows and captures the price difference risk-free today.',
    keyFeedback: 'Correct. Buying the underpriced portfolio and shorting the overpriced one locks in an immediate riskless profit.',
    distractors: [
      {
        optionIndex: 1,
        errorCode: 'C',
        description: 'Claims identical cash flows can have different systematic risk.',
        feedback: 'Incorrect. Identical cash flows in every state have identical risk.',
      },
      {
        optionIndex: 2,
        errorCode: 'S',
        description: 'Reverses the return direction: paying more for Y lowers its return relative to X.',
        feedback: 'Incorrect. Paying a higher price for identical cash flows yields a lower return, not outperformance.',
      },
    ],
    isNumeric: false,
    exactNumericValues: {},
  }),

  makeItem({
    id: 'pp-2027-r004-c-medium',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A calibration check: reframed from bare spot-forward formula substitution into a 2-year vs 1-year rollover breakeven scenario.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r004-c-forward-rate',
    readingId: 'r004',
    outcomeId: 'r004-c',
    conceptName: 'Explain cash flow additivity, no-arbitrage, forward rates and option values',
    packId: 'prepplan-r004-c-additivity',
    cognition: 'apply',
    itemForm: 'scenario',
    intendedDifficulty: 'standard',
    legacyTierLabel: 'Medium',
    comparativeTierRationale: 'Easy (qualitative law-of-one-price arbitrage) < Medium (translating a 2-year vs 1-year rollover equivalence scenario into the implied Year-2 breakeven rate) < Hard (multi-step binomial option replication).',
    estimatedSeconds: 55,
    tierRationale: 'Requires translating a two-strategy bond rollover scenario into no-arbitrage spot-forward equivalence (1 + z2)^2 = (1 + z1)(1 + f1,1).',
    calculationAndAssumptions: 'z1 = 4.00%, z2 = 6.00% (annual compounding). Breakeven 1-year reinvestment rate in Year 2: f1,1 = (1.06^2 / 1.04) - 1 = 8.0385% -> 8.04%.',
    stem: 'An investor can either lock in a 2-year zero-coupon government bond yielding 6.00% per year (annual compounding) or buy a 1-year zero-coupon bond yielding 4.00% and reinvest the proceeds for Year 2. Under no-arbitrage, what 1-year reinvestment rate in Year 2 makes the two strategies have the same terminal value?',
    options: ['1.92%', '5.00%', '8.04%'],
    keyIndex: 2,
    solution: 'No-arbitrage requires equal 2-year terminal wealth: (1.06)^2 = (1.04)(1 + f1,1). Thus f1,1 = (1.06^2 / 1.04) - 1 = (1.1236 / 1.04) - 1 = 8.04%.',
    keyFeedback: 'Correct. (1.06^2 / 1.04) - 1 = 8.04%.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'F',
        description: 'Omits compounding over 2 years, computing (1.06 / 1.04) - 1 = 1.92%.',
        feedback: 'Incorrect. The 2-year bond compounds over 2 years, so (1 + z2) must be squared.',
      },
      {
        optionIndex: 1,
        errorCode: 'F',
        description: 'Takes the simple average of the two yields: (4.00% + 6.00%) / 2 = 5.00%.',
        feedback: 'Incorrect. The breakeven Year-2 rate must make up for the lower 4.00% Year-1 return, so it exceeds 6.00%.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { z1: 0.04, z2: 0.06 },
    keyFormula: '((1 + z2)^2 / (1 + z1) - 1) * 100',
    distractorFormulas: {
      '0': '((1 + z2) / (1 + z1) - 1) * 100',
      '1': '((z1 + z2) / 2) * 100',
    },
  }),

  makeItem({
    id: 'pp-2027-r004-c-hard',
    itemVersion: 2,
    revisionHistory: [{ fromVersion: 1, toVersion: 2, reason: 'Codex Part A finding: corrected distractor C description so it does not claim 50/50 is a physical probability supplied by the stem; described it accurately as an unsupported equal-weight (50/50) average of the two payoffs discounted at the risk-free rate.' }],
    codexBlindSolve: { versionSolved: 2, status: 'matched_key' },
    familyId: 'fam-pp-2027-r004-c-binomial-call',
    readingId: 'r004',
    outcomeId: 'r004-c',
    conceptName: 'Explain cash flow additivity, no-arbitrage, forward rates and option values',
    packId: 'prepplan-r004-c-additivity',
    cognition: 'calculate',
    itemForm: 'scenario',
    intendedDifficulty: 'difficult',
    legacyTierLabel: 'Hard',
    comparativeTierRationale: 'Easy (law-of-one-price arbitrage) < Medium (spot-forward rollover equivalence) < Hard (multi-step no-arbitrage binomial option replication).',
    estimatedSeconds: 85,
    tierRationale: 'Multi-step no-arbitrage binomial option valuation: compute payoffs, hedge ratio delta, risk-free borrowing, and t=0 replicating portfolio cost.',
    calculationAndAssumptions: 'S0=50, Su=65, Sd=40, K=52, rf=4%. cu=13, cd=0. delta = (13-0)/(65-40) = 0.52. B = -(0.52*40)/1.04 = -20. c0 = 0.52*50 - 20 = $6.00.',
    stem: 'A non-dividend-paying stock currently trades at $50.00. Over one period, the stock will either rise to $65.00 or fall to $40.00, and the risk-free rate for the period is 4.0%. Using a no-arbitrage replicating portfolio, the current value of a one-period European call option with a strike price of $52.00 is closest to:',
    options: ['$5.20', '$6.00', '$6.25'],
    keyIndex: 1,
    solution: 'Call payoffs are cu = max(0, $65 - $52) = $13 and cd = $0. The hedge ratio is delta = ($13 - $0) / ($65 - $40) = 0.52 shares. To match the $0 down-state payoff, borrow $20.80 / 1.04 = $20.00 today. Replicating cost = 0.52 x $50.00 - $20.00 = $6.00.',
    keyFeedback: 'Correct. Replicating with 0.52 shares and $20.00 of risk-free borrowing costs $26.00 - $20.00 = $6.00.',
    distractors: [
      {
        optionIndex: 0,
        errorCode: 'T',
        description: 'Fails to discount the down-state borrowing at the risk-free rate: 0.52 * ($50 - $40) = $5.20.',
        feedback: 'Incorrect. The $20.80 debt repayment at t = 1 must be discounted by 1 + rf (1.04) to $20.00 at t = 0.',
      },
      {
        optionIndex: 2,
        errorCode: 'F',
        description: 'Applies an unsupported equal-weight (50/50) average of the two payoffs discounted at the risk-free rate: (0.5 * $13 + 0.5 * $0) / 1.04 = $6.25, ignoring replicating hedge weights.',
        feedback: 'Incorrect. Option pricing by no-arbitrage uses replicating hedge weights (or risk-neutral probabilities), not an arbitrary 50/50 average of payoffs.',
      },
    ],
    isNumeric: true,
    exactNumericValues: { s0: 50, su: 65, sd: 40, k: 52, rf: 0.04 },
    keyFormula: '((max(0, su - k) - max(0, sd - k)) / (su - sd)) * s0 - (((max(0, su - k) - max(0, sd - k)) / (su - sd)) * sd - max(0, sd - k)) / (1 + rf)',
    distractorFormulas: {
      '0': '((max(0, su - k) - max(0, sd - k)) / (su - sd)) * (s0 - sd)',
      '2': '(0.5 * max(0, su - k) + 0.5 * max(0, sd - k)) / (1 + rf)',
    },
  }),
]
