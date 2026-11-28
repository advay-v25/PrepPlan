/**
 * Passes D & E revisions:
 * - D1: Eliminates all 63 strict giveaway-absolute distractors & 22 8-gram overlap phrases
 * - D3: Upgrades r023-a-hard & r094-a-hard to genuine difficult integration/diagnosis demand
 * - E: Replaces 4 high-similarity cross-pool mock items with genuinely distinct constructions
 */

export const PASS_D_STRICT_ABSOLUTE_REWRITES: Record<string, { match: string; replace: string }[]> = {
  'pp-2027-c5-r006-b-hard': [{ match: 'Use N(+0.50) because shortfall probability is always above 50%', replace: 'Use N(+0.50) because shortfall probability measures the upper tail above the mean' }],
  'pp-2027-c5-r006-c-hard': [{ match: 'Unconditional variance is always smaller than the smaller conditional variance', replace: 'Unconditional variance is smaller than the conditional variances due to diversification across regimes' }],
  'pp-2027-c5-r009-a-hard': [{ match: 'A programming error because historical simulation must always overestimate VaR', replace: 'A rounding artifact because 250-day historical simulation overstates tail VaR' }],
  'pp-2027-c5-r011-a-easy': [{ match: 'It consists exclusively of audited quarterly balance sheets', replace: 'It consists primarily of standardized quarterly balance-sheet line items' }],
  'pp-2027-c5-r014-b-easy': [{ match: 'Government debt is never repaid through future taxation or inflation', replace: 'Government debt is retired through central-bank grants without fiscal impact' }],
  'pp-2027-c5-r015-a-hard': [{ match: 'Financial stability and price stability never conflict over any horizon', replace: 'Financial stability and price stability move in lockstep across credit cycles' }],
  'pp-2027-c5-r015-c-easy': [{ match: 'It guarantees that inflation will always remain exactly 0.0%', replace: 'It enforces a zero-inflation ceiling across every calendar quarter' }],
  'pp-2027-c5-r016-b-hard': [{ match: 'Economic globalization and unrestricted national policy autonomy never experience trade-offs', replace: 'Economic globalization and unrestricted national policy autonomy operate independently without tension' }],
  'pp-2027-c5-r016-c-hard': [{ match: 'Both institutions focus exclusively on short-term emergency liquidity loans', replace: 'Both institutions focus primarily on short-term balance-of-payments liquidity loans' }],
  'pp-2027-c5-r017-a-hard': [{ match: 'Export-sector workers always lose wages under free trade', replace: 'Export-sector workers suffer wage declines as comparative-advantage output expands' }],
  'pp-2027-c5-r018-a-hard': [{ match: 'The real exchange rate stayed unchanged because purchasing power parity always holds exactly each year', replace: 'The real exchange rate stayed unchanged because nominal exchange moves match inflation gaps each year' }],
  'pp-2027-c5-r020-b-hard': [{ match: 'Corporate cash belongs exclusively to bondholders until all debt matures', replace: 'Corporate cash is held in trust for bondholders until debt matures' }],
  'pp-mock1-r023-b-medium-1': [{ match: 'Peer B, because inventory is always more liquid than Treasury bills', replace: 'Peer B, because finished inventory converts to operating cash faster than Treasury bills' }],
  'pp-2027-c5-r024-b-hard': [{ match: 'Project Alpha, because a higher IRR always maximizes shareholder wealth', replace: 'Project Alpha, because selecting the higher IRR maximizes dollar wealth creation' }],
  'pp-2027-c5-r043-a-easy': [{ match: 'The market price is guaranteed to reach $78 within 30 days', replace: 'The market price will converge to $78 within one reporting quarter' }],
  'pp-ref2027-r043-a-medium': [{ match: 'The estimate is guaranteed correct because it differs from price', replace: 'The market price reflects temporary noise that disappears within days' }],
  'pp-2027-c5-r045-c-hard': [{ match: 'Regulated utilities have zero debt, whereas software firms always carry high debt', replace: 'Regulated utilities operate with minimal leverage, whereas software firms carry heavy debt' }],
  'pp-2027-c5-r046-a-hard': [{ match: 'Higher revenue always reduces accounts receivable and inventory', replace: 'Higher revenue lowers working-capital balances as turnover accelerates' }],
  'pp-2027-c5-r049-b-easy': [{ match: 'Sell-side reports are strictly confidential internal memos never shared with clients', replace: 'Sell-side reports are confidential internal memos restricted to proprietary traders' }],
  'pp-2027-c5-r052-b-hard': [{ match: 'Zero-coupon OID bonds are taxed solely as long-term capital gains at maturity', replace: 'Zero-coupon OID bonds are taxed as long-term capital gains only upon maturity' }],
  'pp-2027-c5-r053-c-easy': [{ match: 'Corporate bonds trade exclusively on centralized stock exchanges with penny bid-ask spreads', replace: 'Corporate bonds trade primarily on centralized stock exchanges with tight penny spreads' }],
  'pp-2027-c5-r054-c-easy': [{ match: 'High-yield bonds carry zero covenants because buyers rely solely on coupon size', replace: 'High-yield bonds carry minimal covenants because higher coupons substitute for legal protection' }],
  'pp-mock1-r058-b-medium-1': [{ match: 'The bank CD, because add-on yields always understate true return', replace: 'The bank CD, because add-on yields understate effective return relative to discount yields' }],
  'pp-2027-c5-r059-b-easy': [{ match: 'Always identical to the 1-day overnight repo rate', replace: 'Equal to the 1-day overnight repo rate across maturities' }],
  'pp-2027-c5-r060-a-hard': [
    { match: 'Because rising yields always increase a bond’s market price immediately', replace: 'Because rising yields lift a bond’s market price immediately' },
    { match: 'Because a 10-year bond always has a Macaulay duration of 10 years', replace: 'Because a 10-year coupon bond has a Macaulay duration equal to its 10-year maturity' },
  ],
  'pp-2027-c5-r063-d-easy': [{ match: 'Empirical duration assumes credit spreads never correlate with Treasury yields', replace: 'Empirical duration assumes credit spreads remain uncorrelated with Treasury yields' }],
  'pp-2027-c5-r064-b-hard': [{ match: 'Rating agencies always upgrade borderline BBB− issuers during recessions', replace: 'Rating agencies tend to upgrade borderline BBB− issuers during recessions' }],
  'pp-2027-c5-r065-a-easy': [
    { match: 'Foreign-currency debt never carries interest', replace: 'Foreign-currency sovereign debt carries zero coupon interest' },
    { match: 'Domestic-currency debt is always defaulted on before foreign-currency debt', replace: 'Domestic-currency debt defaults ahead of foreign-currency debt in crises' },
  ],
  'pp-2027-c5-r066-a-hard': [{ match: 'Cyclical miners always have higher debt capacity than regulated utilities', replace: 'Cyclical miners have higher debt capacity than regulated utilities' }],
  'pp-2027-c5-r069-d-easy': [
    { match: 'Commercial borrowers never refinance because commercial interest rates never fall', replace: 'Commercial borrowers rarely refinance because commercial rates remain static' },
    { match: 'CMBS loans are guaranteed against default by the federal government', replace: 'CMBS loans carry federal agency credit guarantees against borrower default' },
  ],
  'pp-2027-c5-r072-a-easy': [{ match: 'Guaranteed positive returns for speculative participants', replace: 'Riskless positive returns for speculative participants' }],
  'pp-2027-c5-r072-b-easy': [{ match: 'Issuers use derivatives exclusively for short-term equity speculation', replace: 'Issuers use derivatives primarily for short-term equity speculation' }],
  'pp-2027-c5-r075-b-easy': [
    { match: 'Futures prices are always higher than forward prices', replace: 'Futures prices exceed forward prices regardless of rate-price correlation' },
    { match: 'Forward prices are always double futures prices', replace: 'Forward prices equal double the corresponding futures prices' },
  ],
  'pp-2027-c5-r076-a-hard': [{ match: 'Floating rates are guaranteed to equal 3.98% in both years', replace: 'Floating rates are fixed at 3.98% in both settlement years' }],
  'pp-2027-c5-r077-b-hard': [{ match: 'The call’s hedge ratio is always negative because calls gain when stocks fall', replace: 'The call’s hedge ratio is negative because calls gain when stocks fall' }],
  'pp-2027-c5-r079-b-hard': [{ match: 'Binomial option pricing assumes the underlying stock never moves down', replace: 'Binomial option pricing assumes the underlying stock moves upward only' }],
  'pp-2027-c5-r082-a-easy': [{ match: 'LBOs target pre-revenue startups exclusively', replace: 'LBOs target pre-revenue startups rather than mature cash-flowing firms' }],
  'pp-2027-c5-r083-b-easy': [{ match: 'Commercial leases never allow rent escalations', replace: 'Commercial leases prohibit rent escalations over the lease term' }],
  'pp-2027-c5-r083-c-easy': [{ match: 'Greenfield assets are always publicly traded equities while brownfield assets are bonds', replace: 'Greenfield assets are publicly traded equities while brownfield assets are corporate bonds' }],
  'pp-2027-c5-r083-d-hard': [{ match: 'Assuming brownfield assets always require greenfield construction permits', replace: 'Assuming brownfield assets require greenfield construction permitting' }],
  'pp-2027-c5-r084-a-easy': [{ match: 'Quarterly fixed coupon payments guaranteed by a central bank', replace: 'Quarterly fixed coupon payments backed by a central bank' }],
  'pp-2027-c5-r084-b-easy': [{ match: 'By purchasing shares exclusively in commercial banks', replace: 'By purchasing shares in commercial depository banks' }],
  'pp-2027-c5-r085-b-hard': [{ match: 'Guaranteed higher gross alpha from identical trades', replace: 'Higher gross alpha from identical underlying trades' }],
  'pp-2027-c5-r085-c-hard': [
    { match: 'The fund’s correlation was miscalculated because bonds never lose value', replace: 'The fund’s correlation was miscalculated because fixed-income assets avoid market drawdowns' },
    { match: 'Equities and fixed income always have a correlation of +1.0 in all regimes', replace: 'Equities and fixed income maintain a constant +1.0 correlation across regimes' },
  ],
  'pp-2027-c5-r086-b-easy': [{ match: 'They are backed by guaranteed sovereign tax revenues', replace: 'They are backed by sovereign tax-revenue pledges' }],
  'pp-2027-c5-r086-d-easy': [{ match: 'Guaranteed principal protection from deposit insurance', replace: 'Principal protection under commercial bank deposit insurance' }],
  'pp-2027-c5-r088-b-hard': [{ match: 'Because individual stocks are always overpriced in equilibrium', replace: 'Because individual stocks trade above equilibrium value' }],
  'pp-2027-c5-r088-c-hard': [{ match: 'Because nonsystematic risk is always smaller in magnitude than systematic risk for individual stocks', replace: 'Because nonsystematic variance is smaller than systematic variance for individual stocks' }],
  'pp-2027-c5-r089-a-hard': [{ match: 'Three-stock portfolios always have lower systematic beta than 40-stock portfolios', replace: 'Three-stock portfolios carry lower systematic beta than 40-stock portfolios' }],
  'pp-2027-c5-r089-f-hard': [{ match: 'Open-end mutual funds never distribute realized capital gains to shareholders', replace: 'Open-end mutual funds retain realized capital gains without distributing them' }],
  'pp-2027-c5-r090-d-easy': [{ match: 'Ability and willingness are always identical for every investor', replace: 'Ability and willingness move together identically for investors' }],
  'pp-mock1-r090-d-medium-1': [{ match: 'High overall risk tolerance, because client willingness always overrides ability', replace: 'High overall risk tolerance, because client willingness overrides financial ability' }],
  'pp-2027-c5-r092-a-hard': [{ match: 'Generating guaranteed speculative trading profits from fuel derivatives', replace: 'Generating riskless speculative trading profits from fuel derivatives' }],
  'pp-2027-c5-r092-f-hard': [{ match: 'Exclusively accounting translation risk', replace: 'Pure accounting currency-translation risk' }],
  'pp-mock1-r093-a-easy-1': [{ match: 'Regulatory fines always cover every ethical lapse automatically', replace: 'Regulatory fines capture every ethical lapse in investment practice' }],
  'pp-mock1-r093-c-medium-1': [{ match: 'Higher-fee clients should always receive 100% of scarce allocations', replace: 'Higher-fee clients should receive priority allocation of scarce IPO shares' }],
  'pp-mock1-r097-c-hard-1': [{ match: 'Buy 100% immediately because client requests always override IPS suitability', replace: 'Buy 100% immediately because an unsolicited client request overrides IPS suitability' }],
  'pp-mock1-r098-c-hard-1': [{ match: 'Yes, because supervisors are never responsible for rogue traders', replace: 'Yes, because supervisors bear no responsibility for rogue trader actions' }],
}

export function applyPassDERevisions(items: any[]) {
  const log: any[] = []
  const byId = new Map<string, any>(items.map(i => [i.id, i]))

  const bump = (it: any, reason: string) => {
    it.priorVersion = it.itemVersion
    it.itemVersion += 1
    it.modelBlindSolve = { status: 'invalidated_by_pass_de_edit', note: 'Prior solve invalidated by Pass D/E revision.' }
    it.changes.push(reason)
    log.push({ id: it.id, version: it.itemVersion, reason })
  }

  // 1. D1: Rewrite strict giveaway-absolute distractors
  for (const [id, rewrites] of Object.entries(PASS_D_STRICT_ABSOLUTE_REWRITES)) {
    const it = byId.get(id)
    if (!it) continue
    let changed = false
    for (const r of rewrites) {
      const idx = it.draft.options.findIndex((o: string) => o === r.match)
      if (idx >= 0 && idx !== it.draft.keyIndex) {
        it.draft.options[idx] = r.replace
        changed = true
      }
    }
    if (changed) bump(it, 'D1: Replaced giveaway-absolute distractor wording with nuanced domain misconception.')
  }

  // 2. D1: Resolve the 22 remaining 8-gram overlap phrases cleanly
  const overlapPatches: Record<string, (it: any) => void> = {
    'pp-2027-c5-r005-d-easy': it => { it.draft.stem = 'A portfolio offers a 12% expected return alongside an 18% standard deviation. What is its coefficient of variation (CV)?' },
    'pp-2027-c5-r007-b-easy': it => {
      it.draft.options[it.draft.keyIndex] = 'The likelihood of rejecting a false null hypothesis (1 minus Type II error)'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r030-b-medium-1': it => { it.draft.stem = 'A firm reports net income of $140, depreciation of $30, an accounts receivable rise of $25, and an accounts payable rise of $15. Under the indirect method, what is operating cash flow?' },
    'pp-mock1-r034-b-easy-1': it => {
      it.draft.options[it.draft.keyIndex] = 'Records an ROU asset alongside a lease liability measured at the present value of lease payments'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r044-b-hard': it => { it.draft.stem = 'A company just paid D0 = $2.00. Dividends grow at 15% for Years 1 and 2, then settle to a constant 5% pace from Year 3 onward. At a 10% equity discount rate, what is the intrinsic share value today?' },
    'pp-mock1-r052-a-medium-1': it => {
      it.draft.options[it.draft.keyIndex] = 'The holder may exercise the put for par ($100) redemption and reinvest at higher market yields'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r053-a-medium': it => {
      it.draft.card.solution = 'Money markets trade short-term debt maturing in up to one year, offering high liquidity and minimal duration exposure.'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r068-a-easy': it => {
      it.draft.options[it.draft.keyIndex] = 'Covered bonds stay on the bank’s balance sheet with dual recourse to issuer and cover pool, whereas standard ABS uses non-recourse SPEs'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r076-a-easy': it => {
      it.draft.card.solution = 'A plain-vanilla swap mirrors a bundle of off-market FRAs priced at one blended fixed swap rate.'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r076-a-medium-1': it => {
      const k = it.draft.keyIndex
      it.draft.options[k] = 'Use a $100M swap paying a fixed rate and receiving floating SOFR'
      const wIdx = it.draft.options.findIndex((o: string) => /receive-fixed, pay-floating/i.test(o))
      if (wIdx >= 0 && wIdx !== k) it.draft.options[wIdx] = 'Use a swap receiving a fixed rate and paying floating SOFR'
      it.draft.perOptionFeedback[String(k)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r078-b-easy': it => {
      it.draft.options[it.draft.keyIndex] = 'The discounted forward price, F0(T) / (1 + r)^T'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r079-a-easy': it => { it.draft.stem = 'Using a one-period binomial tree, the risk-neutral up-state probability is 0.60. A call pays $12 in the up state and $0 in the down state. At a 5% one-period risk-free rate, what is the option value today?' },
    'pp-2027-c5-r079-a-medium': it => { it.draft.stem = 'A stock priced at $40 moves to either $48 or $34 over one period, while the one-period risk-free rate is 6%. Compute the risk-neutral up-state probability.' },
    'pp-2027-c5-r087-g-easy': it => {
      it.draft.options[it.draft.keyIndex] = 'The feasible risky-asset portfolio achieving the minimum standard deviation across all combinations'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-2027-c5-r088-g-medium': it => { it.draft.stem = 'Given a 4.0% risk-free rate, a 10.0% market portfolio expected return, and a security beta of 0.75, what is the CAPM expected return on the SML?' },
    'pp-2027-c5-r089-b-hard': it => { it.draft.stem = 'A client receives a tax-free inheritance and faces a medical expense two years out while equities rally 25% past target weights. During the ongoing feedback stage, what two actions are needed?' },
    'pp-mock1-r094-b-easy-1': it => {
      it.draft.options[it.draft.keyIndex] = 'Acting ethically with integrity, competence, diligence, and respect toward clients, colleagues, and the public'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r094-c-medium-1': it => {
      const idx = it.draft.options.findIndex((o: string) => /Standard VII/i.test(o))
      if (idx >= 0 && idx !== it.draft.keyIndex) it.draft.options[idx] = 'Standard VII: Member & Candidate Conduct'
    },
    'pp-mock1-r097-e-medium-1': it => {
      it.draft.options[it.draft.keyIndex] = 'When required by law/court order, involving illegal client conduct, or to the PCP during an inquiry'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r099-b-hard-1': it => {
      it.draft.options[it.draft.keyIndex] = 'Standard V(B): Communication with Clients'
      const idx = it.draft.options.findIndex((o: string) => /Standard VII\(A\)/i.test(o))
      if (idx >= 0 && idx !== it.draft.keyIndex) it.draft.options[idx] = 'Standard VII(A): Exam Conduct'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r101-a-medium-1': it => {
      it.draft.options[it.draft.keyIndex] = 'Standard VII(A): CFA Program Participant Conduct'
      it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${it.draft.card.solution}`
    },
    'pp-mock1-r101-b-medium-1': it => { it.draft.stem = 'Which business-card format complies with Standard VII(B) governing CFA designation references?' },
  }

  for (const [id, fn] of Object.entries(overlapPatches)) {
    const it = byId.get(id)
    if (!it) continue
    fn(it)
    bump(it, 'D1: Rewrote 8-gram phrase to original phrasing while preserving technical meaning.')
  }

  // 3. D3: Upgrade the 2 hard-recall/interpret items to genuine integration/diagnosis
  const r023 = byId.get('pp-2027-c5-r023-a-hard')
  if (r023) {
    r023.draft.stem = 'Company A operates with a −12 day cash conversion cycle (CCC), whereas competitor B has a +48 day CCC with similar gross margins. During a sudden 25% revenue contraction, why might Company A still face sharper short-term cash outflow pressure than Company B?'
    r023.draft.options = [
      'As sales drop, falling new inventory purchases reduce new payables faster than old supplier bills mature, reversing negative working-capital funding',
      'A negative CCC means Company A holds excess unsold inventory that must be written down immediately',
      'Company B collects customer receivables faster than Company A during revenue contractions',
    ]
    r023.draft.keyIndex = 0
    r023.draft.card.cognition = 'integrate'
    r023.draft.card.solution = 'A negative CCC turns working capital into a source of cash while sales grow, but when revenue contracts sharply, supplier payables shrink faster than inflows, creating a working-capital cash drain.'
    r023.draft.card.distractorDiagnoses = [
      { optionIndex: 1, errorCode: 'C', description: 'Negative CCC reflects fast inventory/receivables turnover and long DPO, not excess unsold inventory.' },
      { optionIndex: 2, errorCode: 'S', description: 'Reverses the CCC comparison; +48 days ties up cash longer in receivables/inventory than −12 days.' },
    ]
    r023.draft.perOptionFeedback = {
      '0': `Correct. ${r023.draft.card.solution}`,
      '1': `Incorrect. ${r023.draft.card.distractorDiagnoses[0].description}`,
      '2': `Incorrect. ${r023.draft.card.distractorDiagnoses[1].description}`,
    }
    r023.difficultyRationale = 'Integrates negative CCC supplier-funded working capital with reverse cash-flow dynamics during a revenue contraction.'
    bump(r023, 'D3: Upgraded r023-a-hard from interpret to integrate scenario on negative-CCC contraction risk.')
  }

  const r094 = byId.get('pp-ref2027-r094-a-hard')
  if (r094) {
    r094.draft.stem = 'A CFA charterholder leaves her firm after a dispute; a regulator later fines her for off-channel messaging, which she reports on her annual Professional Conduct Statement. No client ever files a complaint. Can the Professional Conduct Program (PCP) still open an inquiry?'
    r094.draft.options = [
      'Yes; both regulatory notices and self-disclosure on the Professional Conduct Statement independently authorize a PCP inquiry without a client complaint',
      'No; the PCP may initiate an investigation only after receiving a signed written complaint from an injured client',
      'No; self-disclosure on the annual Professional Conduct Statement grants automatic immunity from further PCP review',
    ]
    r094.draft.keyIndex = 0
    r094.draft.card.cognition = 'diagnose'
    r094.draft.card.itemForm = 'scenario'
    r094.draft.card.solution = 'The PCP initiates inquiries from multiple sources—including annual Professional Conduct Statement self-disclosures, regulatory/public media notices, and third-party or client complaints—so lack of a client complaint does not bar review.'
    r094.draft.card.distractorDiagnoses = [
      { optionIndex: 1, errorCode: 'C', description: 'Erroneously treats a formal client complaint as a prerequisite for PCP action.' },
      { optionIndex: 2, errorCode: 'M', description: 'Confuses mandatory annual self-disclosure with immunity from disciplinary review.' },
    ]
    r094.draft.perOptionFeedback = {
      '0': `Correct. ${r094.draft.card.solution}`,
      '1': `Incorrect. ${r094.draft.card.distractorDiagnoses[0].description}`,
      '2': `Incorrect. ${r094.draft.card.distractorDiagnoses[1].description}`,
    }
    r094.difficultyRationale = 'Diagnoses multi-source PCP inquiry authority under interacting regulatory-notice and self-disclosure facts without a client complaint.'
    bump(r094, 'D3: Upgraded r094-a-hard to genuine difficult diagnose scenario on PCP inquiry authority.')
  }

  // 4. Pass E: Replace the 4 highest-similarity cross-pool mock items with genuinely distinct constructions
  const mockReplacements: Record<string, (it: any) => void> = {
    'pp-mock1-r019-a-medium-1': it => {
      it.draft.stem = 'An analyst observes JPY/USD = 148.50 and USD/GBP = 1.2600. If the yen weakens so JPY/USD moves to 154.00 while USD/GBP stays at 1.2600, what happens to the JPY/GBP cross-rate?'
      it.draft.options = ['Falls from 187.11 to 180.43 JPY per GBP', 'Rises from 187.11 to 194.04 JPY per GBP', 'Stays unchanged at 187.11 JPY per GBP']
      it.draft.keyIndex = 1
      it.draft.card.cognition = 'apply'
      it.draft.card.itemForm = 'scenario'
      it.draft.card.solution = 'Initial JPY/GBP = 148.50 × 1.2600 = 187.11. After yen depreciation: 154.00 × 1.2600 = 194.04 JPY per GBP (GBP buys more yen).'
      it.draft.card.distractorDiagnoses = [
        { optionIndex: 0, errorCode: 'S', description: 'Reversed the direction of yen depreciation on the cross-rate.' },
        { optionIndex: 2, errorCode: 'C', description: 'Assumed USD/GBP stability prevents JPY/GBP from moving when JPY/USD shifts.' },
      ]
      it.draft.perOptionFeedback = {
        '0': `Incorrect. ${it.draft.card.distractorDiagnoses[0].description}`,
        '1': `Correct. ${it.draft.card.solution}`,
        '2': `Incorrect. ${it.draft.card.distractorDiagnoses[1].description}`,
      }
      it.difficultyRationale = 'Distinct construction testing dynamic cross-rate transmission from a single-leg FX move.'
    },
    'pp-mock1-r087-e-medium-1': it => {
      it.draft.stem = 'Two assets have identical standalone volatilities of 16%. When combined equally (50%/50%), the resulting portfolio standard deviation is 11.31%. Which correlation between the two assets is most consistent with this portfolio volatility?'
      it.draft.options = ['−0.50', '0.00', '+0.50']
      it.draft.keyIndex = 1
      it.draft.card.cognition = 'apply'
      it.draft.card.itemForm = 'scenario'
      it.draft.card.solution = 'With equal weights and equal σ = 16%, ρ = 0 gives σp = 16% / sqrt(2) = 11.31%. (ρ = −0.50 gives 8.00%; ρ = +0.50 gives 13.86%).'
      it.draft.card.distractorDiagnoses = [
        { optionIndex: 0, errorCode: 'F', description: 'Assumes negative correlation is needed to halve variance (ρ = −0.50 gives 8.00%).' },
        { optionIndex: 2, errorCode: 'C', description: 'Overestimates diversification at +0.50 correlation (gives 13.86%).' },
      ]
      it.draft.perOptionFeedback = {
        '0': `Incorrect. ${it.draft.card.distractorDiagnoses[0].description}`,
        '1': `Correct. ${it.draft.card.solution}`,
        '2': `Incorrect. ${it.draft.card.distractorDiagnoses[1].description}`,
      }
      it.difficultyRationale = 'Distinct inverse-inference construction backing out correlation from observed portfolio volatility.'
    },
    'pp-mock1-r025-a-medium-1': it => {
      it.draft.stem = 'A firm currently funded 100% by equity (cost of equity 10.0%) issues debt at a 5.0% pre-tax yield to reach 30% debt / 70% equity, with a 25% corporate tax rate. Holding equity cost at 10.5% after leverage, by how much does WACC change?'
      it.draft.options = ['Decreases by 153 bps to 8.48%', 'Increases by 50 bps to 10.50%', 'Stays unchanged at 10.00%']
      it.draft.keyIndex = 0
      it.draft.card.cognition = 'apply'
      it.draft.card.itemForm = 'scenario'
      it.draft.card.solution = 'Initial WACC = 10.00%. New WACC = 0.30 × 5.0%(1 − 0.25) + 0.70 × 10.5% = 1.125% + 7.350% = 8.475% ≈ 8.48% (a 152.5 bps decrease).'
      it.draft.card.distractorDiagnoses = [
        { optionIndex: 1, errorCode: 'C', description: 'Looked only at the higher levered cost of equity (10.5%) while ignoring lower-cost tax-shielded debt.' },
        { optionIndex: 2, errorCode: 'G', description: 'Applied no-tax MM irrelevance despite the stated 25% corporate tax rate.' },
      ]
      it.draft.perOptionFeedback = {
        '0': `Correct. ${it.draft.card.solution}`,
        '1': `Incorrect. ${it.draft.card.distractorDiagnoses[0].description}`,
        '2': `Incorrect. ${it.draft.card.distractorDiagnoses[1].description}`,
      }
      it.difficultyRationale = 'Distinct comparative-statics WACC shift construction rather than static plug-in.'
    },
    'pp-mock1-r071-b-medium-1': it => {
      it.draft.stem = 'A trader pays $4.50 for a European put option with a $70 strike. What is the breakeven stock price at expiration, and what is the trader’s maximum possible profit per share?'
      it.draft.options = ['Breakeven $65.50; maximum profit $65.50', 'Breakeven $74.50; maximum profit unlimited', 'Breakeven $70.00; maximum profit $70.00']
      it.draft.keyIndex = 0
      it.draft.card.cognition = 'apply'
      it.draft.card.itemForm = 'scenario'
      it.draft.card.solution = 'Long put breaks even at K − premium = $70.00 − $4.50 = $65.50. Because stock price cannot fall below $0, maximum profit occurs at ST = $0: $70.00 − $4.50 = $65.50.'
      it.draft.card.distractorDiagnoses = [
        { optionIndex: 1, errorCode: 'S', description: 'Applied long call breakeven (K + premium) and unlimited call upside.' },
        { optionIndex: 2, errorCode: 'I', description: 'Omitted the $4.50 option premium from both breakeven and maximum profit.' },
      ]
      it.draft.perOptionFeedback = {
        '0': `Correct. ${it.draft.card.solution}`,
        '1': `Incorrect. ${it.draft.card.distractorDiagnoses[0].description}`,
        '2': `Incorrect. ${it.draft.card.distractorDiagnoses[1].description}`,
      }
      it.difficultyRationale = 'Distinct breakeven-and-boundary construction rather than single-point ST payoff.'
    },
  }

  for (const [id, fn] of Object.entries(mockReplacements)) {
    const it = byId.get(id)
    if (!it) continue
    it.numericSpec = null
    it.numericDistractors = null
    it.draft.card.isNumeric = false
    fn(it)
    bump(it, 'Pass E: Replaced high-similarity mock item with genuinely independent construction.')
  }

  return log
}
