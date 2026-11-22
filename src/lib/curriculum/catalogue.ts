/**
 * The CFA Level I curriculum graph.
 *
 * Topic weights are CFA Institute's published Level I ranges. Module names and
 * summaries are written here to describe standard finance content in our own
 * words — the structure is a scope reference for planning, not a reproduction
 * of any publisher's table of contents.
 *
 * `effortBand` is relative, 1–5. It never claims hours. It says Financial
 * Statement Analysis is roughly twice the work of Derivatives; the exam date
 * decides what that means in weeks, and observed completion later corrects it.
 *
 * `difficulty` is separate from effort: a topic can be short and hard
 * (Derivatives pricing) or long and gentle (Alternative Investments features).
 */

export type TopicSeed = {
  id: string
  name: string
  weightMin: number
  weightMax: number
  sequence: number
  summary: string
}

export type ModuleSeed = {
  id: string
  topic: string
  name: string
  effortBand: 1 | 2 | 3 | 4 | 5
  difficulty: 1 | 2 | 3 | 4 | 5
  sequence: number
  summary: string
}

export type EdgeSeed = {
  from: string
  to: string
  kind: 'prerequisite' | 'reinforces' | 'applied_in'
  rationale: string
}

export const TOPICS: TopicSeed[] = [
  { id: 'quant', name: 'Quantitative Methods', weightMin: 6, weightMax: 9, sequence: 2,
    summary: 'The mathematics the rest of the syllabus assumes: time value of money, distributions, and inference.' },
  { id: 'econ', name: 'Economics', weightMin: 6, weightMax: 9, sequence: 3,
    summary: 'Microeconomic behaviour, macroeconomic aggregates, policy, and exchange rates.' },
  { id: 'fsa', name: 'Financial Statement Analysis', weightMin: 11, weightMax: 14, sequence: 4,
    summary: 'Reading and interrogating the three statements, and the judgement behind the numbers.' },
  { id: 'ci', name: 'Corporate Issuers', weightMin: 6, weightMax: 9, sequence: 5,
    summary: 'How firms are governed, funded, and how they choose between investments.' },
  { id: 'eq', name: 'Equity Investments', weightMin: 11, weightMax: 14, sequence: 6,
    summary: 'Market structure, efficiency, and the valuation of ownership claims.' },
  { id: 'fi', name: 'Fixed Income', weightMin: 11, weightMax: 14, sequence: 7,
    summary: 'Debt instruments, their pricing, and the sensitivity of that price to rates and credit.' },
  { id: 'deriv', name: 'Derivatives', weightMin: 5, weightMax: 8, sequence: 8,
    summary: 'Forwards, futures, swaps and options, and the arbitrage logic that prices them.' },
  { id: 'alt', name: 'Alternative Investments', weightMin: 7, weightMax: 10, sequence: 9,
    summary: 'Private markets, real assets, and hedge funds — their structures, fees, and risks.' },
  { id: 'pm', name: 'Portfolio Management', weightMin: 8, weightMax: 12, sequence: 10,
    summary: 'Combining assets: risk and return, the efficient frontier, and planning for an investor.' },
  { id: 'eth', name: 'Ethical and Professional Standards', weightMin: 15, weightMax: 20, sequence: 1,
    summary: 'The Code and Standards, applied to situations rather than recited. One of the most heavily weighted topics on the exam, and the one that decides borderline results — which is why it comes first and is revisited, rather than being left to the end.' },
]

export const MODULES: ModuleSeed[] = [
  // ── Quantitative Methods ────────────────────────────────────────────────
  { id: 'quant-rates', topic: 'quant', name: 'Rates, Returns and the Time Value of Money', effortBand: 4, difficulty: 3, sequence: 1,
    summary: 'Interest rate interpretations, present and future value, annuities, and return measures. Almost every other topic leans on this.' },
  { id: 'quant-stats', topic: 'quant', name: 'Describing Data and Summary Measures', effortBand: 3, difficulty: 2, sequence: 2,
    summary: 'Central tendency, dispersion, skewness and kurtosis, and how a summary can mislead.' },
  { id: 'quant-prob', topic: 'quant', name: 'Probability and Expected Value', effortBand: 3, difficulty: 3, sequence: 3,
    summary: 'Conditional and joint probability, Bayes, expected value, covariance and correlation.' },
  { id: 'quant-dist', topic: 'quant', name: 'Common Probability Distributions', effortBand: 3, difficulty: 3, sequence: 4,
    summary: 'Normal, lognormal, binomial and uniform distributions, and where each is the right model.' },
  { id: 'quant-sampling', topic: 'quant', name: 'Sampling and Estimation', effortBand: 2, difficulty: 3, sequence: 5,
    summary: 'Sampling distributions, the central limit theorem, confidence intervals, and sampling bias.' },
  { id: 'quant-hypothesis', topic: 'quant', name: 'Hypothesis Testing', effortBand: 3, difficulty: 4, sequence: 6,
    summary: 'Framing a test, choosing a statistic, and reading a result without overclaiming from it.' },
  { id: 'quant-regression', topic: 'quant', name: 'Simple Linear Regression', effortBand: 3, difficulty: 4, sequence: 7,
    summary: 'Fitting and interpreting a single-variable regression, and the assumptions behind it.' },

  // ── Economics ───────────────────────────────────────────────────────────
  { id: 'econ-demand', topic: 'econ', name: 'Demand, Supply and Elasticity', effortBand: 3, difficulty: 2, sequence: 1,
    summary: 'Market equilibrium, elasticity, consumer and producer surplus.' },
  { id: 'econ-firm', topic: 'econ', name: 'The Firm and Market Structures', effortBand: 3, difficulty: 3, sequence: 2,
    summary: 'Cost curves, returns to scale, and behaviour under perfect competition through monopoly.' },
  { id: 'econ-macro', topic: 'econ', name: 'Aggregate Output, Prices and Growth', effortBand: 3, difficulty: 3, sequence: 3,
    summary: 'GDP and its measurement, aggregate demand and supply, and sources of growth.' },
  { id: 'econ-cycles', topic: 'econ', name: 'Business Cycles and Inflation', effortBand: 3, difficulty: 3, sequence: 4,
    summary: 'Phases of the cycle, indicators, unemployment, and the measurement of inflation.' },
  { id: 'econ-policy', topic: 'econ', name: 'Monetary and Fiscal Policy', effortBand: 3, difficulty: 3, sequence: 5,
    summary: 'Policy tools, transmission, and the limits of each in practice.' },
  { id: 'econ-fx', topic: 'econ', name: 'Exchange Rates and International Trade', effortBand: 3, difficulty: 4, sequence: 6,
    summary: 'Quoting conventions, parity relationships, the balance of payments, and trade restrictions.' },

  // ── Financial Statement Analysis ────────────────────────────────────────
  { id: 'fsa-intro', topic: 'fsa', name: 'Introduction to Financial Statement Analysis', effortBand: 2, difficulty: 2, sequence: 1,
    summary: 'The role of the statements, the audit, and the analyst framework applied to them.' },
  { id: 'fsa-income', topic: 'fsa', name: 'Analyzing the Income Statement', effortBand: 4, difficulty: 3, sequence: 2,
    summary: 'Revenue and expense recognition, EPS, and the judgement embedded in reported profit.' },
  { id: 'fsa-balance', topic: 'fsa', name: 'Analyzing the Balance Sheet', effortBand: 3, difficulty: 3, sequence: 3,
    summary: 'Measurement bases, classification, and what the balance sheet does not show.' },
  { id: 'fsa-cashflow', topic: 'fsa', name: 'Analyzing the Statement of Cash Flows', effortBand: 4, difficulty: 4, sequence: 4,
    summary: 'Direct and indirect methods, the link between the three statements, and free cash flow.' },
  { id: 'fsa-inventories', topic: 'fsa', name: 'Inventories and Cost of Goods Sold', effortBand: 3, difficulty: 3, sequence: 5,
    summary: 'Cost flow assumptions, their effect on income and inventory, and write-downs.' },
  { id: 'fsa-longlived', topic: 'fsa', name: 'Long-Lived Assets', effortBand: 3, difficulty: 3, sequence: 6,
    summary: 'Capitalisation versus expensing, depreciation choices, impairment and derecognition.' },
  { id: 'fsa-tax-debt', topic: 'fsa', name: 'Income Taxes and Non-Current Liabilities', effortBand: 4, difficulty: 4, sequence: 7,
    summary: 'Deferred tax assets and liabilities, bond accounting, leases and pension basics.' },
  { id: 'fsa-ratios', topic: 'fsa', name: 'Ratio Analysis and Reporting Quality', effortBand: 4, difficulty: 3, sequence: 8,
    summary: 'Common-size and ratio analysis, DuPont decomposition, and signals of low-quality reporting.' },

  // ── Corporate Issuers ───────────────────────────────────────────────────
  { id: 'ci-structures', topic: 'ci', name: 'Organisational Forms and Corporate Governance', effortBand: 2, difficulty: 2, sequence: 1,
    summary: 'Business structures, the principal–agent problem, and governance mechanisms.' },
  { id: 'ci-stakeholders', topic: 'ci', name: 'Stakeholders and ESG Considerations', effortBand: 2, difficulty: 2, sequence: 2,
    summary: 'Competing stakeholder claims and how ESG factors enter investment analysis.' },
  { id: 'ci-workingcap', topic: 'ci', name: 'Working Capital and Liquidity', effortBand: 3, difficulty: 3, sequence: 3,
    summary: 'The cash conversion cycle, short-term funding, and managing liquidity.' },
  { id: 'ci-investments', topic: 'ci', name: 'Capital Investments and Project Analysis', effortBand: 3, difficulty: 3, sequence: 4,
    summary: 'NPV, IRR, and why the two can disagree about the same project.' },
  { id: 'ci-capstructure', topic: 'ci', name: 'Capital Structure and Cost of Capital', effortBand: 4, difficulty: 4, sequence: 5,
    summary: 'WACC, the effect of leverage, and the theories that explain observed structures.' },
  { id: 'ci-measures', topic: 'ci', name: 'Business Models and Corporate Measures', effortBand: 2, difficulty: 2, sequence: 6,
    summary: 'How a business model shapes the numbers an analyst should expect to see.' },

  // ── Equity Investments ──────────────────────────────────────────────────
  { id: 'eq-markets', topic: 'eq', name: 'Market Organisation and Structure', effortBand: 3, difficulty: 2, sequence: 1,
    summary: 'Assets, intermediaries, order types, margin, and how trades actually happen.' },
  { id: 'eq-indexes', topic: 'eq', name: 'Security Market Indexes', effortBand: 2, difficulty: 2, sequence: 2,
    summary: 'Weighting methods, rebalancing, and the consequences of index construction choices.' },
  { id: 'eq-efficiency', topic: 'eq', name: 'Market Efficiency', effortBand: 2, difficulty: 3, sequence: 3,
    summary: 'Forms of efficiency, documented anomalies, and what they imply for active management.' },
  { id: 'eq-features', topic: 'eq', name: 'Equity Securities and Their Features', effortBand: 3, difficulty: 2, sequence: 4,
    summary: 'Types of equity claim, private versus public, and the effect on risk and return.' },
  { id: 'eq-industry', topic: 'eq', name: 'Industry and Company Analysis', effortBand: 4, difficulty: 3, sequence: 5,
    summary: 'Classifying an industry, competitive position, and building a revenue forecast.' },
  { id: 'eq-dcf', topic: 'eq', name: 'Discounted Dividend Valuation', effortBand: 4, difficulty: 4, sequence: 6,
    summary: 'Dividend discount models including Gordon growth, and the sensitivity of the output to its inputs.' },
  { id: 'eq-multiples', topic: 'eq', name: 'Multiples and Asset-Based Valuation', effortBand: 3, difficulty: 3, sequence: 7,
    summary: 'Price and enterprise multiples, comparables, and asset-based approaches.' },

  // ── Fixed Income ────────────────────────────────────────────────────────
  { id: 'fi-features', topic: 'fi', name: 'Fixed-Income Instruments and Features', effortBand: 3, difficulty: 2, sequence: 1,
    summary: 'Bond structures, indentures, covenants, and embedded options.' },
  { id: 'fi-issuance', topic: 'fi', name: 'Issuance, Trading and Funding', effortBand: 2, difficulty: 2, sequence: 2,
    summary: 'Primary and secondary markets, and how sovereigns, corporates and banks fund themselves.' },
  { id: 'fi-pricing', topic: 'fi', name: 'Bond Pricing and Yield Measures', effortBand: 4, difficulty: 4, sequence: 3,
    summary: 'Pricing from cash flows, yield to maturity, and the conventions that trip candidates up.' },
  { id: 'fi-curves', topic: 'fi', name: 'Spot, Par and Forward Curves', effortBand: 4, difficulty: 5, sequence: 4,
    summary: 'Deriving one curve from another, and reading what the shape implies.' },
  { id: 'fi-yieldspreads', topic: 'fi', name: 'Yield Spreads and Credit Analysis', effortBand: 3, difficulty: 4, sequence: 5,
    summary: 'Spread measures, credit risk components, and the four Cs of credit.' },
  { id: 'fi-duration', topic: 'fi', name: 'Duration and Interest Rate Risk', effortBand: 4, difficulty: 4, sequence: 6,
    summary: 'Macaulay, modified and effective duration, and estimating a price change from a rate move.' },
  { id: 'fi-convexity', topic: 'fi', name: 'Convexity and Portfolio Measures', effortBand: 3, difficulty: 4, sequence: 7,
    summary: 'Second-order price effects, and duration and convexity at portfolio level.' },
  { id: 'fi-securitised', topic: 'fi', name: 'Asset-Backed and Securitised Products', effortBand: 3, difficulty: 4, sequence: 8,
    summary: 'The securitisation process, tranching, and prepayment risk.' },

  // ── Derivatives ─────────────────────────────────────────────────────────
  { id: 'deriv-intro', topic: 'deriv', name: 'Derivative Instruments and Markets', effortBand: 2, difficulty: 2, sequence: 1,
    summary: 'What a derivative is, why they exist, and exchange-traded versus over-the-counter.' },
  { id: 'deriv-forwards', topic: 'deriv', name: 'Forwards and Futures', effortBand: 3, difficulty: 3, sequence: 2,
    summary: 'Forward commitments, marking to market, and the difference the exchange makes.' },
  { id: 'deriv-swaps', topic: 'deriv', name: 'Swaps and Their Uses', effortBand: 2, difficulty: 3, sequence: 3,
    summary: 'Swaps as a series of forwards, and the exposures they are used to change.' },
  { id: 'deriv-options', topic: 'deriv', name: 'Options and Payoff Structures', effortBand: 3, difficulty: 4, sequence: 4,
    summary: 'Calls and puts, moneyness, payoff and profit diagrams, and put–call parity.' },
  { id: 'deriv-pricing', topic: 'deriv', name: 'Arbitrage, Replication and Pricing', effortBand: 3, difficulty: 5, sequence: 5,
    summary: 'The no-arbitrage argument, replication, and binomial valuation. The hardest reasoning in the topic.' },

  // ── Alternative Investments ─────────────────────────────────────────────
  { id: 'alt-features', topic: 'alt', name: 'Alternative Investment Features and Structures', effortBand: 3, difficulty: 2, sequence: 1,
    summary: 'What separates alternatives from traditional assets, and how vehicles are structured.' },
  { id: 'alt-pe', topic: 'alt', name: 'Private Equity and Private Debt', effortBand: 3, difficulty: 3, sequence: 2,
    summary: 'Buyouts, venture capital, private credit, and how returns are generated and measured.' },
  { id: 'alt-realassets', topic: 'alt', name: 'Real Estate and Infrastructure', effortBand: 3, difficulty: 3, sequence: 3,
    summary: 'Direct and indirect property investment, REITs, and long-lived infrastructure assets.' },
  { id: 'alt-hedge', topic: 'alt', name: 'Hedge Fund Strategies', effortBand: 2, difficulty: 3, sequence: 4,
    summary: 'Strategy families, leverage, and the risk characteristics each brings.' },
  { id: 'alt-performance', topic: 'alt', name: 'Performance, Fees and Due Diligence', effortBand: 3, difficulty: 4, sequence: 5,
    summary: 'Management and incentive fees, hurdle rates and high-water marks, and reported-return caveats.' },

  // ── Portfolio Management ────────────────────────────────────────────────
  { id: 'pm-process', topic: 'pm', name: 'The Portfolio Management Process', effortBand: 2, difficulty: 2, sequence: 1,
    summary: 'Why a portfolio perspective changes the answer, and the steps of the process.' },
  { id: 'pm-risk-return', topic: 'pm', name: 'Risk, Return and the Efficient Frontier', effortBand: 4, difficulty: 4, sequence: 2,
    summary: 'Portfolio risk and return, diversification, and the efficient frontier.' },
  { id: 'pm-capm', topic: 'pm', name: 'Capital Asset Pricing and Beta', effortBand: 3, difficulty: 4, sequence: 3,
    summary: 'The capital market line, the security market line, beta, and CAPM\'s assumptions.' },
  { id: 'pm-planning', topic: 'pm', name: 'Investor Profiles and the IPS', effortBand: 3, difficulty: 2, sequence: 4,
    summary: 'Objectives and constraints, and turning a client situation into a policy statement.' },
  { id: 'pm-behavioural', topic: 'pm', name: 'Behavioural Biases in Investing', effortBand: 2, difficulty: 2, sequence: 5,
    summary: 'Cognitive errors and emotional biases, and where they show up in portfolios.' },
  { id: 'pm-fintech', topic: 'pm', name: 'Technology and Analytics in Investment Management', effortBand: 2, difficulty: 2, sequence: 6,
    summary: 'Data, algorithms and automation as they are used across the investment process.' },

  // ── Ethics ──────────────────────────────────────────────────────────────
  { id: 'eth-framework', topic: 'eth', name: 'Ethics and the Investment Profession', effortBand: 3, difficulty: 2, sequence: 1,
    summary: 'Why the profession needs a code, and a framework for working through a dilemma.' },
  { id: 'eth-standards-i-ii', topic: 'eth', name: 'Professionalism and Market Integrity', effortBand: 4, difficulty: 3, sequence: 2,
    summary: 'Knowledge of the law, independence, misrepresentation, misconduct, and material non-public information.' },
  { id: 'eth-standards-iii-iv', topic: 'eth', name: 'Duties to Clients and Employers', effortBand: 4, difficulty: 3, sequence: 3,
    summary: 'Loyalty and care, fair dealing, suitability, confidentiality, and duties to an employer.' },
  { id: 'eth-standards-v-vii', topic: 'eth', name: 'Analysis, Conflicts and Programme Responsibilities', effortBand: 4, difficulty: 3, sequence: 4,
    summary: 'Diligence, record retention, disclosure of conflicts, and responsibilities as a candidate.' },
  { id: 'eth-gips', topic: 'eth', name: 'Global Investment Performance Standards', effortBand: 2, difficulty: 2, sequence: 5,
    summary: 'What GIPS is for, who can claim compliance, and the shape of its requirements.' },
]

/**
 * Prerequisites bind sequencing; the other kinds are the linkage the product
 * exists to make visible — where a topic quietly depends on another, and where
 * understanding one strengthens another.
 */
export const EDGES: EdgeSeed[] = [
  // Quant is the spine most calculation topics hang from.
  { from: 'quant-rates', to: 'quant-stats', kind: 'prerequisite', rationale: 'Return measures come before describing distributions of them.' },
  { from: 'quant-stats', to: 'quant-prob', kind: 'prerequisite', rationale: 'Summary measures precede probability over them.' },
  { from: 'quant-prob', to: 'quant-dist', kind: 'prerequisite', rationale: 'Distributions are probability applied to named shapes.' },
  { from: 'quant-dist', to: 'quant-sampling', kind: 'prerequisite', rationale: 'Sampling distributions assume the underlying ones.' },
  { from: 'quant-sampling', to: 'quant-hypothesis', kind: 'prerequisite', rationale: 'A test statistic is an estimate with a known sampling distribution.' },
  { from: 'quant-hypothesis', to: 'quant-regression', kind: 'prerequisite', rationale: 'Regression coefficients are tested the same way.' },

  { from: 'quant-rates', to: 'fi-pricing', kind: 'prerequisite', rationale: 'A bond price is a present value; without TVM this is memorisation.' },
  { from: 'quant-rates', to: 'eq-dcf', kind: 'prerequisite', rationale: 'Dividend discount models are time value with a growth assumption.' },
  { from: 'quant-rates', to: 'ci-investments', kind: 'prerequisite', rationale: 'NPV and IRR are TVM applied to a project.' },
  { from: 'quant-stats', to: 'pm-risk-return', kind: 'prerequisite', rationale: 'Portfolio risk is variance and covariance.' },

  // Economics builds forward.
  { from: 'econ-demand', to: 'econ-firm', kind: 'prerequisite', rationale: 'Firm behaviour assumes demand and elasticity.' },
  { from: 'econ-macro', to: 'econ-cycles', kind: 'prerequisite', rationale: 'Cycles are movements in the aggregates.' },
  { from: 'econ-cycles', to: 'econ-policy', kind: 'prerequisite', rationale: 'Policy responds to the cycle.' },
  { from: 'econ-policy', to: 'econ-fx', kind: 'prerequisite', rationale: 'Rate differentials drive exchange rate relationships.' },

  // FSA has the tightest internal ordering in the syllabus.
  { from: 'fsa-intro', to: 'fsa-income', kind: 'prerequisite', rationale: 'The framework comes before the statements.' },
  { from: 'fsa-intro', to: 'fsa-balance', kind: 'prerequisite', rationale: 'The framework comes before the statements.' },
  { from: 'fsa-income', to: 'fsa-inventories', kind: 'prerequisite', rationale: 'Cost flow assumptions are an expense recognition choice.' },
  { from: 'fsa-balance', to: 'fsa-longlived', kind: 'prerequisite', rationale: 'Long-lived assets are a balance sheet measurement problem.' },
  { from: 'fsa-balance', to: 'fsa-tax-debt', kind: 'prerequisite', rationale: 'Deferred tax and debt are balance sheet items.' },
  { from: 'fsa-income', to: 'fsa-cashflow', kind: 'prerequisite', rationale: 'The indirect method starts from net income.' },
  { from: 'fsa-balance', to: 'fsa-cashflow', kind: 'prerequisite', rationale: 'Cash flow is reconstructed from balance sheet changes.' },
  { from: 'fsa-cashflow', to: 'fsa-ratios', kind: 'prerequisite', rationale: 'Quality of earnings analysis needs all three statements.' },

  // Corporate issuers.
  { from: 'ci-structures', to: 'ci-capstructure', kind: 'prerequisite', rationale: 'Capital structure is a governance and ownership question first.' },
  { from: 'ci-investments', to: 'ci-capstructure', kind: 'prerequisite', rationale: 'The cost of capital is the hurdle a project is judged against.' },

  // Equity.
  { from: 'eq-markets', to: 'eq-indexes', kind: 'prerequisite', rationale: 'An index is built from the market it measures.' },
  { from: 'eq-indexes', to: 'eq-efficiency', kind: 'prerequisite', rationale: 'Efficiency is argued against a benchmark.' },
  { from: 'eq-features', to: 'eq-dcf', kind: 'prerequisite', rationale: 'Valuing a claim requires knowing what the claim is.' },
  { from: 'eq-dcf', to: 'eq-multiples', kind: 'prerequisite', rationale: 'Multiples are a shorthand for a discounted value.' },
  { from: 'fsa-ratios', to: 'eq-industry', kind: 'prerequisite', rationale: 'Company analysis is ratio analysis with a competitive story attached.' },

  // Fixed income.
  { from: 'fi-features', to: 'fi-pricing', kind: 'prerequisite', rationale: 'Cash flows must be known before they can be discounted.' },
  { from: 'fi-features', to: 'fi-securitised', kind: 'prerequisite', rationale: 'Securitised products are structured bonds.' },
  { from: 'fi-pricing', to: 'fi-curves', kind: 'prerequisite', rationale: 'Curve construction is repeated pricing.' },
  { from: 'fi-pricing', to: 'fi-yieldspreads', kind: 'prerequisite', rationale: 'A spread is a difference between yields.' },
  { from: 'fi-pricing', to: 'fi-duration', kind: 'prerequisite', rationale: 'Duration measures how a price responds to rates.' },
  { from: 'fi-duration', to: 'fi-convexity', kind: 'prerequisite', rationale: 'Convexity is the second-order term duration misses.' },

  // Derivatives.
  { from: 'deriv-intro', to: 'deriv-forwards', kind: 'prerequisite', rationale: 'Forward commitments are the first instrument family.' },
  { from: 'deriv-intro', to: 'deriv-options', kind: 'prerequisite', rationale: 'Contingent claims follow the general introduction.' },
  { from: 'deriv-forwards', to: 'deriv-swaps', kind: 'prerequisite', rationale: 'A swap is a series of forwards.' },
  { from: 'deriv-forwards', to: 'deriv-pricing', kind: 'prerequisite', rationale: 'No-arbitrage pricing is developed on forwards first.' },
  { from: 'deriv-options', to: 'deriv-pricing', kind: 'prerequisite', rationale: 'Replication and binomial valuation apply to options.' },

  // Alternatives and portfolio management.
  { from: 'alt-features', to: 'alt-performance', kind: 'prerequisite', rationale: 'Fee structures follow from vehicle structures.' },
  { from: 'pm-risk-return', to: 'pm-capm', kind: 'prerequisite', rationale: 'CAPM sits on the efficient frontier.' },
  { from: 'pm-process', to: 'pm-planning', kind: 'prerequisite', rationale: 'The IPS is the output of the planning step.' },
  { from: 'eth-framework', to: 'eth-standards-i-ii', kind: 'prerequisite', rationale: 'The framework precedes applying it to the standards.' },

  // Linkage that is not sequencing: where one topic makes another click.
  { from: 'fi-duration', to: 'deriv-swaps', kind: 'reinforces', rationale: 'Swaps are used to change duration; each explains the other.' },
  { from: 'quant-dist', to: 'deriv-pricing', kind: 'reinforces', rationale: 'Binomial valuation is a probability tree.' },
  { from: 'fsa-ratios', to: 'ci-capstructure', kind: 'reinforces', rationale: 'Leverage ratios are read off the statements.' },
  { from: 'econ-policy', to: 'fi-curves', kind: 'reinforces', rationale: 'The curve reflects expected policy.' },
  { from: 'quant-regression', to: 'pm-capm', kind: 'reinforces', rationale: 'Beta is a regression slope.' },
  { from: 'eq-efficiency', to: 'pm-behavioural', kind: 'reinforces', rationale: 'Behavioural biases are the standing objection to efficiency.' },
  { from: 'fsa-cashflow', to: 'eq-dcf', kind: 'applied_in', rationale: 'Free cash flow feeds valuation directly.' },
  { from: 'quant-hypothesis', to: 'quant-regression', kind: 'applied_in', rationale: 'Coefficient significance is a hypothesis test.' },
  { from: 'eth-standards-iii-iv', to: 'pm-planning', kind: 'applied_in', rationale: 'Suitability is where the standards meet portfolio construction.' },
]

/** Midpoint of the published range, used as the planning weight for a topic. */
export function topicPlanningWeight(topic: TopicSeed): number {
  return (topic.weightMin + topic.weightMax) / 2
}
