import assert from 'node:assert/strict'

export const OFFICIAL_2027_WEIGHTS = [
  {id:'eth',min:10,max:15},{id:'quant',min:11,max:14},{id:'econ',min:6,max:9},
  {id:'fsa',min:11,max:14},{id:'ci',min:6,max:9},{id:'eq',min:11,max:14},
  {id:'fi',min:11,max:14},{id:'deriv',min:6,max:9},{id:'alt',min:6,max:9},{id:'pm',min:8,max:12},
]

/** Shorten answer-bearing explanations into parallel answer choices; retain working in the solution. */
const keyText: Record<string,string> = {
  'pp-2027-c5-r007-c-hard':'A one-sample sign test against the hypothesized median',
  'pp-mock1-r010-a-easy-1':'The observed value minus its fitted regression value',
  'pp-2027-c5-r040-b-hard':'Cumulative voting concentrates votes; straight voting lets a majority sweep',
  'pp-2027-c5-r042-a-hard':'Both preserve wealth under the stated frictionless assumptions',
  'pp-2027-c5-r044-c-easy':'The perpetual-growth model has no finite valid value when growth exceeds the required return',
  'pp-2027-c5-r050-a-hard':'Stale prices can depress measured beta; forward risk may differ',
  'pp-2027-c5-r053-a-hard':'Liability horizons and risk constraints create different investor habitats',
  'pp-mock1-r054-a-medium-1':'Drawing on a revolving bank credit facility',
  'pp-mock1-r054-b-medium-1':'To buffer the lender against collateral losses following default',
  'pp-2027-c5-r056-c-easy':'When comparable bonds trade but the target lacks a reliable recent price',
  'pp-2027-c5-r058-b-easy':'Discount yield uses par; add-on yield uses purchase price',
  'pp-2027-c5-r067-a-hard':'True-sale isolation and structural credit enhancement support the senior debt',
  'pp-2027-c5-r068-c-hard':'Auto-loan prepayment is usually less rate-sensitive than mortgage refinancing',
  'pp-2027-c5-r069-b-hard':'The ARM shifts payment-reset risk to the borrower; fixed rates stabilize payments',
  'pp-2027-c5-r076-a-hard':'One blended fixed rate balances total present values across periods',
  'pp-mock1-r088-b-medium-1':'7.0%',
  'pp-2027-c5-r088-d-hard':'Factor exposures explain the strong return; adjusted selection alpha is negative',
  'pp-mock1-r090-c-medium-1':'8.0%',
  'pp-mock1-r096-a-hard-1':'No; passive receipt does not permit trading on material nonpublic information',
  'pp-mock1-r097-c-hard-1':'Discuss the conflict with the IPS and resolve mandate/suitability before acting',
  'pp-mock1-r100-c-easy-1':'Before a formal agreement, disclose the arrangement and estimated compensation',
  'pp-2027-c5-r005-c-hard':'Zero correlation need not imply independence',
  'pp-mock1-r009-b-easy-1':'Bootstrap resamples observed data; Monte Carlo simulates a specified model',
  'pp-2027-c5-r010-b-easy':'The fraction of dependent-variable variation explained by the fitted model',
  'pp-2027-c5-r010-d-easy':'Average excess return unexplained by market beta',
  'pp-2027-c5-r011-a-easy':'It lacks a predefined tabular schema',
  'pp-2027-c5-r013-a-medium':'The business-cycle peak',
  'pp-2027-c5-r013-c-easy':'A coincident indicator',
  'pp-2027-c5-r016-e-easy':'Targeted asset freezes and trade tariffs',
  'pp-2027-c5-r017-a-hard':'Broad consumer gains coexist with concentrated adjustment losses',
  'pp-2027-c5-r017-b-easy':'Tariffs raise tax revenue; unauctioned quota rents accrue to license holders',
  'pp-mock1-r032-c-medium-1':'It increases reported margin through release of older low-cost layers',
  'pp-mock1-r035-a-medium-1':'A deferred tax liability (DTL)',
  'pp-2027-c5-r041-b-easy':'Orders match in an order book; dealer markets use quoted bid/ask prices',
  'pp-2027-c5-r043-b-easy':'Equity value + debt + preferred + minority interest − cash',
  'pp-2027-c5-r043-c-hard':'Observable asset values can inform a sum-of-the-parts estimate',
  'pp-2027-c5-r045-b-hard':'They reduce financing distortions; EBITDAR also adjusts for rent',
  'pp-2027-c5-r045-c-hard':'Their capital intensity, growth and regulation differ substantially',
  'pp-2027-c5-r046-a-easy':'Link operating assumptions to consistent statements and valuation',
  'pp-2027-c5-r049-b-hard':'Issuer relationships and trading incentives can influence sell-side ratings',
  'pp-2027-c5-r051-a-hard':'Offshore-currency issuance versus foreign-issuer domestic-currency issuance',
  'pp-2027-c5-r052-a-hard':'Full amortization retires principal by maturity; partial leaves a balloon; sinking funds retire portions',
  'pp-2027-c5-r053-c-easy':'Bonds mainly use dealer OTC markets; listed equities mainly use exchanges',
  'pp-2027-c5-r054-b-easy':'The seller/repurchaser borrows cash; the buyer/reseller lends cash',
  'pp-mock1-r055-a-easy-1':'Government-created or sponsored public-policy entities',
  'pp-2027-c5-r060-a-easy':'Cash payments, coupon reinvestment income, and sale-price gains or losses',
  'pp-2027-c5-r065-a-easy':'Foreign-currency debt depends on access to currency the issuer cannot create',
  'pp-2027-c5-r065-a-hard':'GO credit depends on broad fiscal capacity; revenue credit on project cash flow',
  'pp-2027-c5-r069-a-easy':'Contraction risk and extension risk',
  'pp-2027-c5-r069-a-hard':'A absorbs early principal; C waits longer and bears more extension exposure',
  'pp-2027-c5-r069-c-easy':'Agency/GSE credit support versus privately structured credit protection',
  'pp-mock1-r070-a-easy-1':'The reference variable that determines the contract payoff',
  'pp-mock1-r075-b-hard-1':'Futures tends to be higher because of favorable margin reinvestment timing',
  'pp-mock1-r077-a-easy-1':'Out of the money',
  'pp-mock1-r077-c-medium-1':'It decreases as expected dividends reduce the terminal stock payoff',
  'pp-2027-c5-r078-a-easy':'A long call plus a bond paying the strike at expiration',
  'pp-2027-c5-r082-a-easy':'VC funds young growth firms; LBOs use debt to acquire mature firms',
  'pp-2027-c5-r085-c-easy':'Some strategies combine frequent modest gains with occasional severe losses',
  'pp-mock1-r086-a-easy-1':'Self-executing rules deployed on a distributed ledger',
  'pp-2027-c5-r086-b-easy':'They lack contractual cash flows for conventional DCF valuation',
  'pp-2027-c5-r088-d-easy':'The firm-specific residual return component',
  'pp-2027-c5-r088-f-hard':'Unrestricted borrowing/lending and short selling in frictionless markets',
  'pp-2027-c5-r088-h-easy':'Undervalued',
  'pp-2027-c5-r089-b-medium':'The execution step',
  'pp-2027-c5-r089-e-easy':'Active seeks benchmark outperformance; passive seeks index replication',
  'pp-2027-c5-r089-e-hard':'Niche active capacity is more constrained; passive economics favor scale',
  'pp-2027-c5-r089-f-easy':'Mutual funds transact at daily NAV; ETFs trade intraday at market prices',
  'pp-2027-c5-r089-f-hard':'In-kind ETF redemptions and lower turnover can reduce gain distributions',
  'pp-2027-c5-r090-a-hard':'It preserves institutional objectives and constraints across managers',
  'pp-2027-c5-r090-f-hard':'Overlapping classifications conceal a concentration in similar equities',
  'pp-2027-c5-r091-c-easy':'It evaluates separate mental buckets instead of the total portfolio',
  'pp-2027-c5-r092-b-hard':'Risk governance and independent oversight',
  'pp-2027-c5-r092-e-easy':'Allocating acceptable risk across exposures, strategies or desks',
  'pp-2027-c5-r092-f-hard':'Operational failure, market-liquidity impact, then regulatory exposure',
  'pp-mock1-r097-a-medium-1':'A loyalty violation: the personal benefit does not serve client investments',
}

export function applyCloseoutRevisions(items: any[], priorById: Map<string,any>) {
  const log: any[] = []
  for (const i of items) {
    const previous = priorById.get(i.id)
    const before = JSON.stringify(i.draft)
    const changes: string[] = []
    const meaning = (d: any) => JSON.stringify([d.stem,d.options,d.keyIndex,d.perOptionFeedback,d.card.solution,d.card.distractorDiagnoses])
    if (previous && meaning(i.draft)!==meaning(previous.draft)) changes.push('Apply earlier C4 option-index patches against their original 536-item baseline order; preserve correct answer meaning after seeded expansion.')
    if (keyText[i.id]) {
      i.draft.options[i.draft.keyIndex] = keyText[i.id]
      changes.push('Separate the concise answer choice from its worked explanation; remove answer-length cue.')
    }
    if (/^\[Mock1-S[12]\]\s*/.test(i.draft.stem)) {
      i.draft.stem = i.draft.stem.replace(/^\[Mock1-S[12]\]\s*/, '')
      changes.push('Keep pool/session routing in metadata rather than in the question stem.')
    }
    if (i.id === 'pp-2027-c5-r052-a-hard') {
      i.draft.card.solution = 'A fully amortizing schedule retires the balance by maturity. Under level total debt-service payments, interest falls and the principal portion rises; equal payments do not imply equal principal installments. Partial amortization leaves a final balloon. A sinking fund retires portions according to its covenant.'
      changes.push('Correct equal-principal claim for level-payment amortization.')
    }
    if (i.id === 'pp-2027-c5-r010-b-easy') {
      i.draft.card.solution = 'With an intercept, R-squared equals explained sum of squares divided by total sum of squares, equivalently one minus residual sum of squares divided by total sum of squares. It measures explained variation, not causation.'
      changes.push('Remove ambiguous RSS notation: distinguish explained from residual sum of squares.')
    }
    if (i.id === 'pp-2027-c5-r007-c-hard') {
      i.draft.card.solution = 'For a median test without a symmetry or normality assumption, compare observations above and below the hypothesized median with a sign test, treating ties appropriately. A Wilcoxon signed-rank location test additionally needs an appropriate symmetry assumption.'
      changes.push('Distinguish the sign test from the additional assumptions of a signed-rank test.')
    }
    if (i.id === 'pp-mock1-r012-e-medium-1') {
      i.draft.options = ['24.5%','60.0%','80.0%']; i.draft.keyIndex = 2
      i.draft.card.solution = 'Add the three largest market shares: 35% + 25% + 20% = 80%. The normalized Herfindahl sum of squared shares is a different concentration measure.'
      i.draft.card.distractorDiagnoses = [{optionIndex:0,errorCode:'M',description:'Substitutes the normalized squared-share concentration measure for the top-three share sum.'},{optionIndex:1,errorCode:'I',description:'Includes only the two largest firms rather than three.'}]
      changes.push('Use comparable percentage choices and distinguish CR3 from the squared-share concentration measure.')
    }
    if (i.id === 'pp-mock1-r090-c-medium-1') {
      i.draft.options = i.draft.options.map((s: string) => s.replace(' nominal return',''))
    }
    if (i.id === 'pp-2027-c5-r088-f-hard') {
      i.draft.card.solution = 'Different borrowing and lending rates violate the common frictionless funding assumption; short-sale limits add a separate trading constraint. These facts alone do not establish a particular empirical security-market-line slope.'
      changes.push('Remove unsupported empirical SML consequence from a CAPM assumption question.')
    }
    if (i.id === 'pp-mock1-r077-c-medium-1') {
      i.draft.stem = 'For a European call with no dividend-related contract adjustment, hold spot, strike, interest rates and volatility fixed. How does an increase in an ordinary cash dividend expected before expiration affect the call value?'
      changes.push('Specify ordinary dividends and no strike adjustment; avoid special-dividend contract ambiguity.')
    }
    if (i.id === 'pp-2027-c5-r049-b-hard') {
      i.draft.stem = 'A brokerage earns investment-banking and trading revenue, while a buy-side team evaluates research for its own portfolio. Which incentive difference could contribute to more favorable published sell-side ratings?'
      i.draft.card.solution = 'Issuer relationships and trading business can create incentives around published recommendations. These incentives warrant critical assessment; they do not prove bias in every report or imply that buy-side teams have no conflicts.'
      changes.push('Replace unsupported statistical universal with a bounded incentive scenario.')
    }
    if (i.id === 'pp-ref2027-r094-a-hard') {
      i.draft.stem = 'Which statement most accurately describes information that can initiate a CFA Institute Professional Conduct Program inquiry?'
      i.draft.options[i.draft.keyIndex] = 'Public information, complaints or a member’s own disclosure can prompt an inquiry'
      for (const d of i.draft.card.distractorDiagnoses) {
        i.draft.options[d.optionIndex] = d.optionIndex === [0,1,2].find(n=>n!==i.draft.keyIndex) ? 'An inquiry requires a formal client complaint before other evidence is considered' : 'Self-disclosure prevents the Professional Conduct Program from opening an inquiry'
        d.description = d.optionIndex === [0,1,2].find(n=>n!==i.draft.keyIndex) ? 'The Program can act on several information sources; a client complaint is not a prerequisite.' : 'Disclosure supplies information for review; it does not confer immunity from an inquiry.'
      }
      i.draft.card.solution = 'Potential sources include member disclosures, complaints and public information. Investigation initiation is not confined to a client complaint and does not itself establish a violation.'
      i.draft.card.cognition = 'interpret'; i.draft.card.itemForm = 'direct'
      changes.push('Replace incoherent negative lead-in with a supported, self-contained inquiry-source question; proposed hard label still needs reviewer reassessment.')
    }
    // Unlike the shared legacy formatter, a prose reference to a number is not a numeric answer.
    const plain = (s: string) => /^[+−-]?[$£€]?\d[\d,.]*(?:%|x)?$/.test(s.trim())
    if (i.draft.options.every(plain)) {
      const value = (s: string) => Number(s.replace(/[,$£€%x]/g,'').replace('−','-'))
      const order = i.draft.options.map((text: string,old: number)=>({text,old})).sort((a: any,b: any)=>value(a.text)-value(b.text))
      const feedback = i.draft.perOptionFeedback, diagnoses = i.draft.card.distractorDiagnoses, oldKey = i.draft.keyIndex
      i.draft.options = order.map((o: any)=>o.text); i.draft.keyIndex = order.findIndex((o: any)=>o.old===oldKey)
      i.draft.perOptionFeedback = Object.fromEntries(order.map((o: any,n: number)=>[n,feedback[o.old]]))
      i.draft.card.distractorDiagnoses = order.flatMap((o: any,n: number)=>{const d=diagnoses.find((d: any)=>d.optionIndex===o.old);return d?[{...d,optionIndex:n}]:[]})
    }
    if (JSON.stringify(i.draft) !== before || changes.length) {
      i.draft.perOptionFeedback[String(i.draft.keyIndex)] = `Correct. ${i.draft.card.solution}`
      for (const d of i.draft.card.distractorDiagnoses) i.draft.perOptionFeedback[String(d.optionIndex)] = `Incorrect. ${d.description}`
      i.priorVersion = previous?.itemVersion ?? i.itemVersion
      i.itemVersion = (previous?.itemVersion ?? i.itemVersion) + 1
      i.modelBlindSolve = { status:'invalidated_by_closeout_revision',note:'Earlier solves do not verify this revised version.' }
      i.changes.push(...changes)
      log.push({id:i.id,priorVersion:i.priorVersion,itemVersion:i.itemVersion,changes})
    }
    if (previous && meaning(i.draft)!==meaning(previous.draft)) {
      assert.ok(i.itemVersion>previous.itemVersion, `${i.id}: changed content must advance its version`)
    }
  }
  assert.equal(Object.keys(keyText).filter(id=>!items.some(i=>i.id===id)).length,0,'A closeout patch targets a missing item')
  return log
}
