import type { Question, Subject } from './types'

export const subjects: Subject[] = [
  { id: 'fixed-income', name: 'Fixed Income', short: 'FI', readiness: 43, coverage: 51, color: 'amber', modules: ['Bond valuation', 'Spot, par & forward curves', 'Duration', 'Credit risk'] },
  { id: 'quant', name: 'Quantitative Methods', short: 'QM', readiness: 72, coverage: 76, color: 'green', modules: ['Financial returns', 'Time value of money', 'Distributions', 'Regression'] },
  { id: 'fsa', name: 'Financial Statement Analysis', short: 'FSA', readiness: 58, coverage: 64, color: 'blue', modules: ['Income statements', 'Cash flows', 'Inventories', 'Ratio analysis'] },
  { id: 'equity', name: 'Equities', short: 'EQ', readiness: 65, coverage: 61, color: 'green', modules: ['Equity instruments', 'Industry analysis', 'DCF valuation', 'Relative valuation'] },
  { id: 'ethics', name: 'Ethical & Professional Standards', short: 'ETH', readiness: 80, coverage: 68, color: 'green', modules: ['Professionalism', 'Duties to clients', 'Conflicts of interest', 'Code application'] },
]

export const questions: Question[] = [
  {
    id: 'fi-spot-1', subject: 'fixed-income', module: 'Spot, par & forward curves', prerequisite: 'Time value of money', los: 'Calculate a bond price using spot rates', cognitive: 'interpretation', difficulty: 2,
    stem: 'An analyst values a three-year annual-pay bond using spot rates. Which change would most likely increase the bond’s value?',
    options: ['An increase in the three-year spot rate', 'A decrease in the two-year spot rate', 'An increase in the one-year spot rate'], answer: 1,
    rationale: 'The second coupon is discounted at the two-year spot rate. Lowering that rate increases the present value of that cash flow.',
    why: 'Tests whether you discount each cash flow at its matching spot rate.', misconception: 'Uses one yield for every cash flow instead of matching maturities.'
  },
  {
    id: 'fi-price-1', subject: 'fixed-income', module: 'Bond valuation', prerequisite: 'Time value of money', los: 'Interpret the relationship between price and yield', cognitive: 'interpretation', difficulty: 1,
    stem: 'For an option-free fixed-rate bond, an increase in the required yield will most likely cause the bond price to:',
    options: ['Increase', 'Remain unchanged', 'Decrease'], answer: 2,
    rationale: 'A higher discount rate reduces the present value of the bond’s promised cash flows.',
    why: 'Checks the foundational inverse price–yield relationship.', misconception: 'Treats higher yield as an additional cash flow received by the investor.'
  },
  {
    id: 'fi-duration-1', subject: 'fixed-income', module: 'Duration', prerequisite: 'Bond valuation', los: 'Interpret modified duration', cognitive: 'calculation', difficulty: 2,
    stem: 'A bond has modified duration of 5.2. If its yield rises by 25 basis points, its price will change by approximately:',
    options: ['−1.30%', '−0.13%', '+1.30%'], answer: 0,
    rationale: 'Approximate percentage price change is −modified duration × change in yield: −5.2 × 0.0025 = −1.30%.',
    why: 'Separates formula selection from basis-point conversion.', misconception: 'Converts 25 basis points incorrectly or loses the negative sign.'
  },
  {
    id: 'fi-credit-1', subject: 'fixed-income', module: 'Credit risk', los: 'Describe probability of default and loss severity', cognitive: 'interpretation', difficulty: 2,
    stem: 'Holding other factors constant, a lower recovery rate after default most directly increases:',
    options: ['Loss given default', 'Probability of default', 'Risk-free rate'], answer: 0,
    rationale: 'Loss given default equals one minus the recovery rate.',
    why: 'Checks whether the two components of expected credit loss are distinguished.', misconception: 'Confuses default likelihood with the severity of loss after default.'
  },
  {
    id: 'qm-tvm-1', subject: 'quant', module: 'Time value of money', los: 'Calculate present value', cognitive: 'calculation', difficulty: 1,
    stem: 'At a positive discount rate, the present value of ₹100 received two years from now is most likely:',
    options: ['Less than ₹100', 'Equal to ₹100', 'Greater than ₹100'], answer: 0,
    rationale: 'Future cash flows are discounted, so their present value is below the future amount when rates are positive.',
    why: 'Checks the intuition needed before using TVM in valuation.', misconception: 'Compounds a future amount instead of discounting it.'
  },
  {
    id: 'qm-return-1', subject: 'quant', module: 'Financial returns', los: 'Compare money-weighted and time-weighted returns', cognitive: 'interpretation', difficulty: 2,
    stem: 'A portfolio manager has no control over client cash-flow timing. The most appropriate performance measure is generally the:',
    options: ['Money-weighted return', 'Time-weighted return', 'Holding-period return'], answer: 1,
    rationale: 'Time-weighted return removes the effect of external cash-flow timing and better measures manager performance.',
    why: 'Tests selection of a return measure based on decision responsibility.', misconception: 'Chooses money-weighted return whenever cash flows vary.'
  },
  {
    id: 'qm-dist-1', subject: 'quant', module: 'Distributions', los: 'Interpret skewness', cognitive: 'interpretation', difficulty: 2,
    stem: 'For a positively skewed return distribution, the mean is most likely:',
    options: ['Below the median', 'Equal to the median', 'Above the median'], answer: 2,
    rationale: 'Large positive observations pull the mean toward the right tail.',
    why: 'Checks whether distribution shape is translated into location measures.', misconception: 'Associates positive skew with most observations being positive.'
  },
  {
    id: 'fsa-cfs-1', subject: 'fsa', module: 'Cash flows', los: 'Classify cash flows under IFRS', cognitive: 'judgment', difficulty: 2,
    stem: 'Under IFRS, interest paid may be classified in the cash flow statement as:',
    options: ['Operating or financing', 'Operating only', 'Financing only'], answer: 0,
    rationale: 'IFRS permits interest paid to be classified as operating or financing when applied consistently.',
    why: 'Checks a high-frequency IFRS versus US GAAP distinction.', misconception: 'Applies the US GAAP classification rule to IFRS.'
  },
  {
    id: 'fsa-inv-1', subject: 'fsa', module: 'Inventories', los: 'Compare inventory methods during inflation', cognitive: 'interpretation', difficulty: 2,
    stem: 'During rising prices, compared with FIFO, weighted-average cost will most likely report:',
    options: ['Higher ending inventory', 'Lower cost of sales', 'Lower gross profit'], answer: 2,
    rationale: 'Weighted-average cost exceeds older FIFO costs during inflation, producing higher cost of sales and lower gross profit.',
    why: 'Tests the direction of inventory-method effects rather than formula recall.', misconception: 'Reverses the flow of older and newer inventory costs.'
  },
  {
    id: 'eq-dcf-1', subject: 'equity', module: 'DCF valuation', prerequisite: 'Capital structure', los: 'Interpret required return in DCF', cognitive: 'transfer', difficulty: 2,
    stem: 'Holding expected cash flows constant, an increase in the required return will most likely cause estimated intrinsic value to:',
    options: ['Decrease', 'Remain unchanged', 'Increase'], answer: 0,
    rationale: 'A higher required return increases the discount rate and reduces present value.',
    why: 'Checks whether valuation mechanics transfer from TVM into equity.', misconception: 'Treats required return as growth in investor wealth rather than a discount rate.'
  },
  {
    id: 'eq-relative-1', subject: 'equity', module: 'Relative valuation', los: 'Interpret valuation multiples', cognitive: 'judgment', difficulty: 2,
    stem: 'A low P/E multiple is least likely, by itself, to prove that a stock is:',
    options: ['Undervalued', 'Expected to grow slowly', 'Perceived as risky'], answer: 0,
    rationale: 'A low multiple can reflect weak growth or high risk; it does not alone establish undervaluation.',
    why: 'Tests whether a multiple is interpreted rather than used mechanically.', misconception: 'Equates a low valuation multiple automatically with a bargain.'
  },
  {
    id: 'ethics-independence-1', subject: 'ethics', module: 'Professionalism', los: 'Apply independence and objectivity', cognitive: 'judgment', difficulty: 2,
    stem: 'An issuer offers an analyst economy travel and modest lodging for a remote site visit. The analyst should most appropriately:',
    options: ['Reject all issuer-paid travel in every case', 'Accept if the arrangement does not threaten objectivity', 'Accept only after publishing the report'], answer: 1,
    rationale: 'Modest arrangements may be acceptable when commercial travel is unavailable and objectivity is not threatened.',
    why: 'Tests application of the standard to context rather than a blanket rule.', misconception: 'Applies an absolute prohibition without considering necessity and modesty.'
  },
  {
    id: 'ethics-priority-1', subject: 'ethics', module: 'Duties to clients', los: 'Apply priority of transactions', cognitive: 'judgment', difficulty: 2,
    stem: 'A portfolio manager learns that a client order will likely move a security’s price. Before placing the client order, the manager should:',
    options: ['Trade personally if the position is small', 'Wait until the client order is completed before personal trading', 'Trade personally after telling the compliance officer'], answer: 1,
    rationale: 'Client transactions must take priority over transactions in which the member is the beneficial owner.',
    why: 'Checks recognition of beneficiary priority in a realistic sequence.', misconception: 'Assumes disclosure cures trading ahead of a client.'
  }
]

export const weekBlocks = [
  { id: 'mon-ethics', day: 'MON', date: 'SEP 1', title: 'Ethics', duration: '25 min', state: 'done', subjectId: 'ethics', detail: 'Scenario retrieval' },
  { id: 'tue-quant', day: 'TUE', date: 'SEP 2', title: 'Quant', duration: '60 min', state: 'planned', subjectId: 'quant', detail: 'TVM bridge + 6 probes' },
  { id: 'wed-fsa', day: 'WED', date: 'SEP 3', title: 'FSA class', duration: '90 min', state: 'class', subjectId: 'fsa', detail: 'Coaching lecture' },
  { id: 'thu-fi', day: 'THU', date: 'SEP 4', title: 'Fixed Income', duration: '60 min', state: 'planned', subjectId: 'fixed-income', detail: 'Spot-rate repair' },
  { id: 'fri-equity', day: 'FRI', date: 'SEP 5', title: 'Equities', duration: '45 min', state: 'planned', subjectId: 'equity', detail: 'DCF application' },
  { id: 'sat-mock', day: 'SAT', date: 'SEP 6', title: 'Mock test', duration: '90 min', state: 'risk', detail: 'Mixed topic verification' },
  { id: 'sun-buffer', day: 'SUN', date: 'SEP 7', title: 'Buffer', duration: '45 min', state: 'empty', detail: 'Protected recovery capacity' },
] satisfies import('./types').PlanBlock[]
