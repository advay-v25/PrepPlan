/**
 * C4: Versioned repairs for baseline 536 drafts.
 * - C4.1: 4 overlap-flagged carried-forward items -> v2 with original prose
 * - C4.2: 4 near-match pairs -> explicit provisional family grouping
 * - C4.3: 6 identical distractor description items + 79 giveaway-absolute distractors -> v2
 * Preserves v1 snapshots in baseline-2026-11-25/ and phase1/phase2 fixture files.
 */

export type ItemPatch = {
  newVersion: number
  reason: string
  stem?: string
  optionRewrites?: { match: string; replace: string }[]
  solution?: string
  distractorDiagnoses?: { optionIndex: number; errorCode: string; description: string }[]
  familyId?: string
  familyNote?: string
}

export const C4_ITEM_PATCHES: Record<string, ItemPatch> = {
  // === C4.1: 4 overlap-flagged carried-forward items ===
  'pp-2027-r032-a-easy': {
    newVersion: 2,
    reason: 'C4.1: Rewrote stem and solution in original prose to remove verbatim IAS 2 / textbook 8-gram overlap.',
    stem: 'Under IFRS, a distributor values ending inventory at the smaller of historical cost and net realizable value (NRV). Which formula defines NRV?',
    solution: 'Under IFRS, NRV equals the expected selling price less the estimated costs required to finish the goods and complete the sale.',
  },
  'pp-2027-r095-a-easy': {
    newVersion: 2,
    reason: 'C4.1 & C4.3: Rewrote stem, distractor B (removed "always"), and solution in original prose to clear 8-gram overlap.',
    stem: 'When local securities rules permit a practice that the CFA Institute Code and Standards prohibit, Standard I(A) requires a CFA charterholder to:',
    optionRewrites: [
      { match: 'Follow local securities regulations because statutory law always governs', replace: 'Follow local securities rules because domestic statutes take precedence' },
    ],
    solution: 'Standard I(A) obligates members and candidates to obey whichever requirement imposes the higher ethical or legal threshold.',
  },
  'pp-2027-r095-b-easy': {
    newVersion: 2,
    reason: 'C4.1: Rewrote solution in original prose to remove verbatim Standard I(B) 8-gram overlap.',
    solution: 'Standard I(B) prohibits accepting gifts or benefits that might impair independent professional judgment; disclosure alone does not cure an impairing gift.',
  },
  'pp-2027-r095-e-easy': {
    newVersion: 2,
    reason: 'C4.1 & C4.3: Rewrote distractor A (removed "solely") and solution in original prose to clear 8-gram overlap.',
    optionRewrites: [
      { match: "Rely solely on the product issuer's marketing brochure for risk disclosures", replace: "Rely primarily on the product issuer's marketing brochure for risk disclosures" },
    ],
    solution: 'Standard I(E) requires a member or candidate to attain and maintain sufficient technical skill and knowledge before advising clients on unfamiliar instruments.',
  },

  // === C4.2: 4 near-match pairs (8 items) ===
  'pp-ref2027-r029-d-medium': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r029-d-hard under one provisional construction family (same bond issue scenario).',
    familyId: 'fam-2027-r029-d-effective-interest',
    familyNote: 'Same $1,000 / 5% / $950 / 6% bond scenario as r029-d-hard; shares construction family.',
  },
  'pp-ref2027-r029-d-hard': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r029-d-medium under one provisional construction family (same bond issue scenario).',
    familyId: 'fam-2027-r029-d-effective-interest',
    familyNote: 'Same $1,000 / 5% / $950 / 6% bond scenario as r029-d-medium; shares construction family.',
  },
  'pp-ref2027-r033-c-easy': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r033-c-medium under one provisional construction family (same depreciation scenario).',
    familyId: 'fam-2027-r033-c-depreciation-age',
    familyNote: 'Same $1,000 gross / $600 accum depr / $100 annual depr scenario as r033-c-medium; shares construction family.',
  },
  'pp-ref2027-r033-c-medium': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r033-c-easy under one provisional construction family (same depreciation scenario).',
    familyId: 'fam-2027-r033-c-depreciation-age',
    familyNote: 'Same $1,000 gross / $600 accum depr / $100 annual depr scenario as r033-c-easy; shares construction family.',
  },
  'pp-ref2027-r035-c-easy': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r035-c-medium under one provisional construction family (same tax scenario).',
    familyId: 'fam-2027-r035-c-tax-rates',
    familyNote: 'Same $300 pre-tax / $84 tax expense scenario as r035-c-medium; shares construction family.',
  },
  'pp-ref2027-r035-c-medium': {
    newVersion: 1,
    reason: 'C4.2: Grouped with pp-ref2027-r035-c-easy under one provisional construction family (same tax scenario).',
    familyId: 'fam-2027-r035-c-tax-rates',
    familyNote: 'Same $300 pre-tax / $84 tax expense scenario as r035-c-easy; shares construction family.',
  },
  'pp-ref2027-r037-d-easy': {
    newVersion: 1,
    reason: 'C4.2: Reviewed near-match with r037-d-medium; distinct 3-step vs 5-step DuPont formulas, flagged for human family confirmation.',
    familyNote: 'Shared DuPont vocabulary with r037-d-medium, but tests 3-step ROE rather than 5-step ROE.',
  },
  'pp-ref2027-r037-d-medium': {
    newVersion: 1,
    reason: 'C4.2: Reviewed near-match with r037-d-easy; distinct 5-step vs 3-step DuPont formulas, flagged for human family confirmation.',
    familyNote: 'Shared DuPont vocabulary with r037-d-easy, but tests 5-step ROE rather than 3-step ROE.',
  },

  // === C4.3: 6 identical distractor diagnosis items ===
  'pp-ref2027-r027-b-hard': {
    newVersion: 2,
    reason: 'C4.3: Replaced identical generic distractor diagnoses with distinct role-specific explanations.',
    distractorDiagnoses: [
      { optionIndex: 1, errorCode: 'M', description: 'Confuses management’s primary duty to prepare financial statements with an incorrect statement; the question asks for the least accurate role.' },
      { optionIndex: 2, errorCode: 'C', description: 'Misattributes the external auditor’s attestation role to the analyst; auditors do opine on fair presentation.' },
    ],
  },
  'pp-ref2027-r093-b-hard': {
    newVersion: 2,
    reason: 'C4.3: Replaced identical generic distractor diagnoses with distinct purpose-specific explanations.',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'C', description: 'Overlooks that self-assessment against a shared benchmark is a core function of a professional code of ethics.' },
      { optionIndex: 2, errorCode: 'M', description: 'Confuses public expectation-setting with an unrealistic claim; communicating expected conduct to clients is a primary role of a code.' },
    ],
  },
  'pp-ref2027-r093-g-hard': {
    newVersion: 2,
    reason: 'C4.3: Replaced identical generic distractor diagnoses with distinct ethics-vs-law explanations.',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'C', description: 'Fails to recognize that disclosure laws and ethical transparency frequently reinforce each other.' },
      { optionIndex: 2, errorCode: 'M', description: 'Assumes stakeholder expectations are uniform; different stakeholders legitimately hold differing ethical perspectives on the same act.' },
    ],
  },
  'pp-ref2027-r094-a-hard': {
    newVersion: 2,
    reason: 'C4.3: Replaced incoherent negative lead-in and non-parallel Option C via closeout-revisions.',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'M', description: 'Overlooks that self-disclosure on the annual Professional Conduct Statement directly triggers PCP review.' },
      { optionIndex: 1, errorCode: 'C', description: 'Assumes the PCP ignores public media or regulatory notices; both are valid grounds for opening an inquiry.' },
    ],
  },
  'pp-ref2027-r094-c-easy': {
    newVersion: 2,
    reason: 'C4.3: Replaced identical distractor diagnoses with standard-specific explanations.',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'M', description: 'Confuses Standard III(E) Preservation of Confidentiality (long-standing) with the newly added Competence standard.' },
      { optionIndex: 1, errorCode: 'C', description: 'Confuses Standard IV(C) Responsibilities of Supervisors (long-standing) with the 2023 addition of Standard I(E) Competence.' },
    ],
  },
  'pp-ref2027-r098-b-hard': {
    newVersion: 2,
    reason: 'C4.3: Rewrote "OUTSIDE" lead-in to "least likely to require written consent under Standard IV(B)" and wrote distinct diagnoses.',
    stem: 'Which form of compensation is least likely to require written consent from all parties under Standard IV(B) Additional Compensation Arrangements?',
    distractorDiagnoses: [
      { optionIndex: 0, errorCode: 'C', description: 'Fails to recognize that third-party fees for potentially competing services require prior written consent under Standard IV(B).' },
      { optionIndex: 1, errorCode: 'M', description: 'Assumes client-paid performance bonuses are exempt; Standard IV(B) covers additional compensation from clients as well as third parties.' },
    ],
  },
}

// === C4.3: Programmatic map for the remaining giveaway-absolute distractors ===
export const GIVEAWAY_OPTION_REWRITES: Record<string, { match: string; replace: string }[]> = {
  "pp-ref2027-r004-c-medium": [
    {
      "match": "Both prices can persist solely because their labels differ",
      "replace": "Both prices can persist indefinitely because their labels differ"
    }
  ],
  "pp-ref2027-r008-b-medium": [
    {
      "match": "An inefficient portfolio solely because it uses diversification",
      "replace": "An inefficient portfolio because diversification lowers expected return"
    },
    {
      "match": "A guaranteed loss-free portfolio",
      "replace": "A portfolio with zero downside variance"
    }
  ],
  "pp-ref2027-r010-d-medium": [
    {
      "match": "A guaranteed positive abnormal return",
      "replace": "A positive abnormal return independent of market moves"
    }
  ],
  "pp-ref2027-r014-b-medium": [
    {
      "match": "Guaranteed repayment without future fiscal consequences",
      "replace": "Automatic debt retirement without future fiscal adjustments"
    }
  ],
  "pp-ref2027-r014-d-medium": [
    {
      "match": "Any increase in spending is always expansionary overall",
      "replace": "Higher government spending is uniformly expansionary across cycles"
    }
  ],
  "pp-ref2027-r020-b-medium": [
    {
      "match": "All company debts become the seller’s personal debts",
      "replace": "Corporate debts transfer to the departing shareholder personally"
    }
  ],
  "pp-ref2027-r020-c-medium": [
    {
      "match": "Guaranteed cheaper funding with no new obligations",
      "replace": "Lower funding costs with fewer reporting obligations"
    }
  ],
  "pp-ref2027-r023-b-medium": [
    {
      "match": "Inventories must be valued at zero for all liquidity analysis",
      "replace": "Inventories are excluded from every measure of liquidity"
    }
  ],
  "pp-ref2027-r023-c-medium": [
    {
      "match": "A guaranteed increase in product selling prices",
      "replace": "An automatic increase in product selling prices"
    }
  ],
  "pp-ref2027-r024-c-medium": [
    {
      "match": "Include it solely because it was large",
      "replace": "Include it because the cash outlay was substantial"
    }
  ],
  "pp-ref2027-r025-d-medium": [
    {
      "match": "A rule that all firms should finance entirely with debt",
      "replace": "A rule that firms should finance operations primarily with debt"
    }
  ],
  "pp-ref2027-r029-a-easy": [
    {
      "match": "Always expensed as incurred, together with research costs",
      "replace": "Expensed as incurred, together with research outlays"
    },
    {
      "match": "Always capitalized, whether or not any criteria are met",
      "replace": "Capitalized upon outlay, even before technical feasibility is shown"
    }
  ],
  "pp-ref2027-r031-a-medium": [
    {
      "match": "Nothing unusual, because operating cash flow is always volatile from year to year",
      "replace": "Normal seasonal variation, because operating cash flow fluctuates widely"
    }
  ],
  "pp-ref2027-r034-c-hard": [
    {
      "match": "None, because options are excluded from the financial statements",
      "replace": "Zero, because employee options are off-balance-sheet items"
    }
  ],
  "pp-ref2027-r035-a-medium": [
    {
      "match": "A permanent difference, because it is never reversed",
      "replace": "A permanent difference, because the tax basis remains unchanged"
    }
  ],
  "pp-ref2027-r036-e-hard": [
    {
      "match": "It guarantees that all misreporting is found within a year",
      "replace": "It ensures misreporting is detected within the same fiscal year"
    },
    {
      "match": "It has no deterrent effect, since most filings are never reviewed",
      "replace": "It provides minimal deterrence, since most filings receive limited review"
    }
  ],
  "pp-ref2027-r036-f-medium": [
    {
      "match": "The exclusion is always required by the accounting standards",
      "replace": "The exclusion is mandated by the applicable accounting standards"
    }
  ],
  "pp-ref2027-r037-e-hard": [
    {
      "match": "Industry-specific measures are always identical across firms",
      "replace": "Industry-specific measures are standardized across peer firms"
    }
  ],
  "pp-ref2027-r037-f-hard": [
    {
      "match": "Margins can never be used for forecasting",
      "replace": "Historical margins have limited value for forward forecasting"
    },
    {
      "match": "Acquisitions never affect margins",
      "replace": "Acquisitions leave consolidated operating margins unchanged"
    }
  ],
  "pp-ref2027-r038-c-easy": [
    {
      "match": "Avoid all changes in input costs",
      "replace": "Eliminate changes in underlying input costs"
    }
  ],
  "pp-ref2027-r038-d-easy": [
    {
      "match": "Fall sharply, since costs always rise faster than prices",
      "replace": "Fall sharply, since input costs tend to outpace selling prices"
    }
  ],
  "pp-ref2027-r040-a-medium": [
    {
      "match": "Their dividend entitlement solely because votes differ",
      "replace": "Their dividend entitlement simply because voting rights differ"
    }
  ],
  "pp-ref2027-r041-d-medium": [
    {
      "match": "A broad-market index solely because it contains several firms",
      "replace": "A broad-market index simply because it contains multiple firms"
    }
  ],
  "pp-ref2027-r042-a-medium": [
    {
      "match": "A guaranteed increase in the total value of the holding",
      "replace": "A proportionate increase in the total value of the holding"
    }
  ],
  "pp-ref2027-r042-b-medium": [
    {
      "match": "The buyer always receives it because settlement occurs later",
      "replace": "The buyer receives the dividend because settlement occurs later"
    }
  ],
  "pp-ref2027-r043-a-medium": [
    {
      "match": "The market price must immediately equal the estimate",
      "replace": "The model estimate is more reliable than market price"
    }
  ],
  "pp-ref2027-r046-b-medium": [
    {
      "match": "Whether retained cash is always worthless",
      "replace": "Whether retained cash adds no incremental equity value"
    }
  ],
  "pp-ref2027-r047-b-medium": [
    {
      "match": "Classification guarantees that all segments have identical economics",
      "replace": "Classification implies that grouped segments share identical economics"
    }
  ],
  "pp-ref2027-r050-b-medium": [
    {
      "match": "It assumes all risk is company-specific",
      "replace": "It assumes equity risk is primarily company-specific"
    }
  ],
  "pp-ref2027-r054-c-medium": [
    {
      "match": "A guaranteed lower spread solely because credit risk is higher",
      "replace": "A narrower spread despite higher underlying credit risk"
    }
  ],
  "pp-ref2027-r055-b-medium": [
    {
      "match": "Government and corporate debt always have identical default risk",
      "replace": "Government and corporate debt carry comparable default risk"
    }
  ],
  "pp-ref2027-r056-c-medium": [
    {
      "match": "An assumption that all bonds have the same coupon",
      "replace": "An assumption that comparable bonds share identical coupons"
    }
  ],
  "pp-ref2027-r058-a-medium": [
    {
      "match": "Always exactly at par regardless of the margins",
      "replace": "Continuously at par regardless of changes in credit margins"
    }
  ],
  "pp-ref2027-r059-b-medium": [
    {
      "match": "A coupon guaranteed to remain the current market yield forever",
      "replace": "A coupon fixed at the current market yield through maturity"
    }
  ],
  "pp-ref2027-r060-a-medium": [
    {
      "match": "Only the final maturity principal that the investor never receives",
      "replace": "Only the final maturity principal that the investor forfeits"
    }
  ],
  "pp-ref2027-r062-c-medium": [
    {
      "match": "It guarantees immunity to all changes in the yield curve",
      "replace": "It insulates the portfolio from parallel and nonparallel curve shifts"
    }
  ],
  "pp-ref2027-r063-a-medium": [
    {
      "match": "It assumes all cash flows remain fixed regardless of exercise",
      "replace": "It assumes bond cash flows remain fixed regardless of call exercise"
    }
  ],
  "pp-ref2027-r066-c-medium": [
    {
      "match": "All claims must receive identical recoveries",
      "replace": "Senior and subordinated claims receive pro-rata equal recoveries"
    }
  ],
  "pp-ref2027-r067-a-medium": [
    {
      "match": "A guarantee that the loans can never default",
      "replace": "Assurance that the underlying loans carry negligible default risk"
    },
    {
      "match": "Automatic elimination of all capital and legal requirements",
      "replace": "Removal of regulatory capital and legal documentation requirements"
    }
  ],
  "pp-ref2027-r068-b-medium": [
    {
      "match": "Equal loss absorption by every tranche at all times",
      "replace": "Pro-rata loss allocation across tranches from the first dollar"
    },
    {
      "match": "A guarantee that collateral value never falls",
      "replace": "Protection ensuring collateral market values remain above par"
    }
  ],
  "pp-ref2027-r069-b-easy": [
    {
      "match": "It grows solely because the coupon rate is fixed",
      "replace": "It rises steadily because the coupon rate is fixed"
    }
  ],
  "pp-ref2027-r069-c-medium": [
    {
      "match": "A permanent separation from all mortgage-credit exposure",
      "replace": "A complete transfer of underlying mortgage-credit exposure"
    }
  ],
  "pp-ref2027-r069-d-medium": [
    {
      "match": "The assumption that all principal was already amortized",
      "replace": "The assumption that scheduled principal has already amortized"
    }
  ],
  "pp-ref2027-r071-c-medium": [
    {
      "match": "Both parties must always exchange the asset at maturity",
      "replace": "Both parties must physically exchange the underlying asset at maturity"
    }
  ],
  "pp-ref2027-r072-a-medium": [
    {
      "match": "Creating a guaranteed speculative profit",
      "replace": "Generating an arbitrage profit without basis risk"
    },
    {
      "match": "Eliminating all operating risks of the business",
      "replace": "Neutralizing the operating risks of the core business"
    }
  ],
  "pp-ref2027-r075-a-medium": [
    {
      "match": "The underlying can never be the same",
      "replace": "The underlying asset cannot be standardized across contracts"
    },
    {
      "match": "The futures buyer never faces gains or losses",
      "replace": "The futures buyer avoids daily mark-to-market variation"
    }
  ],
  "pp-ref2027-r075-b-hard": [
    {
      "match": "It necessarily makes both prices identical under all conditions",
      "replace": "It forces forward and futures prices to remain equal under varying rates"
    }
  ],
  "pp-ref2027-r077-b-medium": [
    {
      "match": "Its holder must always buy the underlying",
      "replace": "Its holder is obligated to purchase the underlying asset"
    },
    {
      "match": "Its payoff is always a fixed amount",
      "replace": "Its payoff at expiration is a predetermined fixed sum"
    }
  ],
  "pp-ref2027-r079-b-medium": [
    {
      "match": "They prove investors are literally indifferent to all risks",
      "replace": "They show investors are indifferent to portfolio risk"
    }
  ],
  "pp-ref2027-r080-b-medium": [
    {
      "match": "A purchase solely of the fund’s pooled units",
      "replace": "A passive purchase of the fund’s pooled units"
    }
  ],
  "pp-ref2027-r080-c-medium": [
    {
      "match": "A guaranteed fixed coupon paid by every portfolio company",
      "replace": "A fixed periodic coupon paid by each portfolio company"
    }
  ],
  "pp-ref2027-r081-a-medium": [
    {
      "match": "The elimination of all selection effects",
      "replace": "The removal of survivorship and selection biases"
    }
  ],
  "pp-ref2027-r083-b-medium": [
    {
      "match": "Listing removes all real estate cash-flow risk",
      "replace": "Public listing eliminates underlying property cash-flow risk"
    }
  ],
  "pp-ref2027-r084-a-medium": [
    {
      "match": "A requirement to harvest all trees immediately at any price",
      "replace": "A mandate to harvest timber immediately regardless of spot prices"
    }
  ],
  "pp-ref2027-r086-c-medium": [
    {
      "match": "The assumption that all operational risks vanish",
      "replace": "The assumption that operational and custody risks disappear"
    }
  ],
  "pp-ref2027-r086-d-medium": [
    {
      "match": "All digital assets have identical liquidity and custody risk",
      "replace": "Comparable digital assets share uniform liquidity and custody risk"
    }
  ],
  "pp-ref2027-r087-c-medium": [
    {
      "match": "A portfolio with a guaranteed realized return equal to its expectation",
      "replace": "A portfolio whose realized return equals its expected return"
    }
  ],
  "pp-ref2027-r087-f-easy": [
    {
      "match": "A guaranteed elimination of all portfolio risk",
      "replace": "Complete elimination of systematic portfolio risk"
    }
  ],
  "pp-ref2027-r088-d-medium": [
    {
      "match": "A guaranteed positive alpha",
      "replace": "A positive risk-adjusted alpha"
    }
  ],
  "pp-ref2027-r089-a-easy": [
    {
      "match": "A rule to select each asset solely by its own past return",
      "replace": "A rule to select each asset based on its standalone past return"
    }
  ],
  "pp-ref2027-r090-c-medium": [
    {
      "match": "Treat all inflation assumptions as realized certainties",
      "replace": "Treat projected inflation assumptions as fixed certainties"
    }
  ],
  "pp-ref2027-r092-b-medium": [
    {
      "match": "A requirement to abandon all quantitative analysis",
      "replace": "A requirement to set aside quantitative risk analysis"
    }
  ],
  "pp-ref2027-r092-d-medium": [
    {
      "match": "Risk tolerance must be inferred solely from recent market returns",
      "replace": "Risk tolerance should be inferred primarily from recent market returns"
    }
  ],
  "pp-ref2027-r093-a-hard": [
    {
      "match": "Common practice can never be ethical, so anything that is widely done should be avoided",
      "replace": "Common industry practice is rarely ethical, so widely adopted norms should be avoided"
    }
  ],
  "pp-ref2027-r093-b-medium": [
    {
      "match": "Codes never influence conduct, so the firm has lost nothing by leaving it unexplained",
      "replace": "Written codes have little effect on conduct, so leaving them unexplained carries low cost"
    }
  ],
  "pp-ref2027-r093-f-medium": [
    {
      "match": "Their belief that they are honest people who would never do such a thing",
      "replace": "Their belief that personal integrity prevents them from making biased choices"
    }
  ],
  "pp-ref2027-r093-g-easy": [
    {
      "match": "Conduct that is legal is always ethical, so a lawful act needs no further ethical scrutiny",
      "replace": "Conduct that is legal requires no further ethical scrutiny"
    },
    {
      "match": "Ethical standards and legal requirements never overlap in any area of professional life",
      "replace": "Ethical standards and legal requirements operate in separate domains without overlap"
    }
  ],
  "pp-ref2027-r096-a-easy": [
    {
      "match": "It has already been reported in a company's regulatory filings and is available to all",
      "replace": "It has already been reported in a company’s regulatory filings and is broadly accessible"
    }
  ],
  "pp-ref2027-r098-a-medium": [
    {
      "match": "No violation, because clients are always free to choose whichever adviser they wish",
      "replace": "No violation, because clients remain free to choose whichever adviser they prefer"
    }
  ],
  "pp-ref2027-r098-c-easy": [
    {
      "match": "Be responsible only for violations that they personally commit and never for others",
      "replace": "Be responsible only for violations that they personally commit"
    }
  ],
  "pp-ref2027-r099-b-hard": [
    {
      "match": "The note contains a forecast, and a forecast is never permitted in a research note",
      "replace": "The note contains a forecast, and forecasts are prohibited in research notes"
    }
  ],
  "pp-ref2027-r099-b-medium": [
    {
      "match": "Acceptable, because clients can always ask if they want to know about changes",
      "replace": "Acceptable, because clients can inquire if they want details on process changes"
    }
  ],
  "pp-ref2027-r100-a-hard": [
    {
      "match": "Adequate, because disclosure is always an acceptable alternative to avoiding a conflict",
      "replace": "Adequate, because disclosure serves as a standard substitute for avoiding a conflict"
    }
  ],
  "pp-ref2027-r100-c-hard": [
    {
      "match": "Once a year, in the firm's general annual report to all clients",
      "replace": "Once a year, in the firm’s general annual report to clients"
    }
  ],
  "pp-ref2027-r102-b-hard": [
    {
      "match": "Leave it as it is, because prospects can always ask about fees if they want to know",
      "replace": "Leave it as it is, because prospects can inquire about fees if they wish"
    }
  ],
  "pp-2027-r095-b-medium": [
    {
      "match": "Attend the weekend and allocate trades solely on execution quality",
      "replace": "Attend the weekend and allocate trades based on execution quality"
    }
  ],
  "pp-2027-r095-e-hard": [
    {
      "match": "He avoids an I(E) issue because outdated accounting inputs fall solely under diligence, not competence",
      "replace": "He avoids an I(E) issue because outdated accounting inputs fall under diligence rather than competence"
    }
  ]
}
