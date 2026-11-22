import { checkItemFormat } from '../src/lib/diagnostic/formatRules'

/** Defect-labelled corpus: each case names the defects it MUST raise and the ones it must NOT. These are format facts only, not finance. */
let pass = 0, fail = 0
const ok = (n: string, c: boolean, d?: unknown) => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${c ? '' : ' — ' + JSON.stringify(d)}`) }
const codes = (stem: string, o: string[]) => checkItemFormat(stem, o).map(d => d.code)
const A = ['Increase', 'Decrease', 'No change']

const must: [string, string, string[], string][] = [
  ['except construction', 'All of the following are inventory cost components EXCEPT:', ['Freight-in', 'Purchase price', 'Storage after sale'], 'FORMAT_EXCEPT'],
  ['bare negative lead-in', 'Which of the following is not a characteristic of a perpetuity?', ['Level payments', 'Infinite life', 'A final maturity date'], 'FORMAT_NEGATIVE_LEAD_IN'],
  ['incorrect-statement template', 'Which of the following statements is incorrect?', ['Alpha', 'Beta', 'Gamma'], 'FORMAT_NEGATIVE_LEAD_IN'],
  ['true/false lead-in', 'Which of the following statements is true?', ['Alpha holds', 'Beta holds', 'Gamma holds'], 'FORMAT_TRUE_FALSE'],
  ['true/false options', 'Higher leverage raises the equity beta, other things equal.', ['True', 'False', 'Cannot tell'], 'FORMAT_TRUE_FALSE'],
  ['all of the above', 'Which items affect free cash flow?', ['Capex', 'Working capital', 'All of the above'], 'FORMAT_COMPOUND_OPTION'],
  ['A and B', 'Which items affect free cash flow?', ['Capex', 'Working capital', 'A and B'], 'FORMAT_COMPOUND_OPTION'],
  ['unordered numbers', 'The yield is closest to:', ['4.5%', '3.1%', '5.0%'], 'FORMAT_NUMERIC_ORDER'],
  ['mixed number/word options', 'The result is closest to:', ['4.5%', 'Lower', 'Higher'], 'FORMAT_MIXED_OPTION_TYPES'],
  ['one option three times longer', 'The best explanation is:', ['Lower demand', 'Weaker pricing', 'A one-off charge that was recognised in the prior period and is expected to reverse next year'], 'FORMAT_OPTION_LENGTH'],
  ['no question', 'The analyst should now', ['revise', 'hold', 'sell'], 'FORMAT_NO_QUESTION'],
]
for (const [name, stem, o, code] of must) ok(`flags: ${name}`, codes(stem, o).includes(code), codes(stem, o))

const mustNot: [string, string, string[]][] = [
  ['"least likely" is the permitted negative form', 'Which of the following is least likely to increase operating leverage?', ['Higher fixed costs', 'Lower variable costs', 'Higher unit prices']],
  ['a negation in the scenario, not in the question', 'The company did not capitalise the development cost because it failed the criteria. The effect on current-year profit is most likely:', A],
  ['negative numbers ascending', 'The net change in cash is closest to:', ['-$1,200', '$300', '$2,500']],
  ['accounting negatives descending', 'The adjustment is closest to:', ['$500', '$(200)', '$(900)']],
  ['standards terminology: not-for-profit', 'For a not-for-profit entity, the most appropriate treatment is to:', ['expense it', 'capitalise it', 'defer it']],
  ['sentence completion with a blank', 'A bond trading at a premium has a coupon rate that is _____ its yield to maturity.', ['above', 'equal to', 'below']],
  ['direct recall question', 'Which of the following best describes a financial covenant?', ['A restriction on leverage ratios', 'A fixed coupon payment', 'A call feature on the bond']],
  ['"most likely true" is not a bare truth template', 'Which statement is most likely true?', ['Alpha holds', 'Beta holds', 'Gamma holds']],
]
for (const [name, stem, o] of mustNot) ok(`does not flag: ${name}`, codes(stem, o).length === 0, codes(stem, o))

console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
