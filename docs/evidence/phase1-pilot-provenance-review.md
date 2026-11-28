# Question-Bank Phase 1 Pilot — Answer & Provenance View

All 18 candidates remain **unpublished** (`published: false`, `reviewerConfirmedDifficulty: null`). Original source-pack fact text is kept private in `content/source-packs/private/prepplan/`.

## pp-2027-r032-a-easy (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-a` · Concept `b4241dd2-67f9-4954-8395-0a6b6ba23053`
- **Family:** `fam-pp-2027-r032-a-nrv-def` · Fingerprint `70a5a069`
- **Pack & Rights:** `prepplan-r032-a-lcnrv@1` · factsHash `e0d34721932c825a...` · packetHash `3560eb1305888a3a...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 35s
- **Tier Rationale:** Tests one explicit Level I definition (IFRS net realizable value) without scenario distractions.
- **Key:** **A** (Estimated selling price minus estimated completion and selling costs)
- **Calculation & Assumptions:** Qualitative definition under IFRS: NRV = estimated selling price - estimated completion costs - estimated selling costs.
- **Worked Rationale:** Under IFRS, net realizable value equals the estimated selling price in the ordinary course of business minus estimated costs of completion and estimated costs necessary to make the sale.
- **Distractor B [C]:** Deducts a normal profit margin, confusing IFRS NRV with the US GAAP lower-of-cost-or-market floor.
- **Distractor C [G]:** Uses current replacement cost, which belongs to US GAAP lower of cost or market for LIFO/retail.
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-a-medium (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-a` · Concept `b4241dd2-67f9-4954-8395-0a6b6ba23053`
- **Family:** `fam-pp-2027-r032-a-writedown-calc` · Fingerprint `b06d1f4c`
- **Pack & Rights:** `prepplan-r032-a-lcnrv@1` · factsHash `e0d34721932c825a...` · packetHash `eff9edd9556d8fdd...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 55s
- **Tier Rationale:** Requires two connected steps under IFRS: compute per-unit NRV after both completion and selling costs, then multiply the per-unit shortfall by units.
- **Key:** **C** ($2,000)
- **Calculation & Assumptions:** IFRS; 400 units; cost = $50/unit; selling price = $52/unit; completion = $4/unit; selling = $3/unit. NRV = 52 - 4 - 3 = $45. Write-down = 400 * (50 - 45) = $2,000.
- **Key Formula:** `units * (cost - (sp - comp - sell))` → `2000`
- **Worked Rationale:** NRV per unit is $52.00 - $4.00 - $3.00 = $45.00. Because cost ($50.00) exceeds NRV ($45.00), the write-down is $5.00 per unit, or 400 x $5.00 = $2,000.
- **Distractor A [I]:** Omits selling costs from NRV, computing NRV = $48.00 and write-down = 400 * ($50 - $48) = $800. (formula `units * (cost - (sp - comp))` → `800`)
- **Distractor B [R]:** Reports total completion costs (400 * $4 = $1,600) instead of the excess of cost over NRV. (formula `units * comp` → `1600`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-a-hard (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-a` · Concept `b4241dd2-67f9-4954-8395-0a6b6ba23053`
- **Family:** `fam-pp-2027-r032-a-gaap-lcm-ceiling` · Fingerprint `e4b4c079`
- **Pack & Rights:** `prepplan-r032-a-lcnrv@1` · factsHash `e0d34721932c825a...` · packetHash `b2e15acac5dd93dc...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 70s
- **Tier Rationale:** Applies the US GAAP LIFO lower-of-cost-or-market boundary condition where replacement cost exceeds the NRV ceiling.
- **Key:** **B** ($88)
- **Calculation & Assumptions:** US GAAP LIFO uses lower of cost or market. NRV (ceiling) = 95 - 7 = 88. Floor = 88 - 10 = 78. Replacement = 92 > ceiling (88), so market = 88. Carrying amount = min(cost=94, market=88) = $88.
- **Key Formula:** `min(cost, max(sp - sell - normalProfit, min(replacement, sp - sell)))` → `88`
- **Worked Rationale:** Under US GAAP for LIFO inventory, market is replacement cost ($92) bounded by the ceiling (NRV = $95 - $7 = $88) and the floor ($88 - $10 = $78). Because replacement cost exceeds the ceiling, market is $88, and the lower of cost ($94) and market ($88) is $88.
- **Distractor A [C]:** Selects the market floor (NRV - normal profit = $78) instead of the ceiling ($88). (formula `sp - sell - normalProfit` → `78`)
- **Distractor C [I]:** Uses current replacement cost ($92) directly without applying the NRV ceiling cap. (formula `min(cost, replacement)` → `92`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-b-easy (v3)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-b` · Concept `74d32cb4-1422-4f30-842b-0aa16acb5d84`
- **Family:** `fam-pp-2027-r032-b-fifo-lifo-direction` · Fingerprint `f65b7ff8`
- **Pack & Rights:** `prepplan-r032-b-methods@1` · factsHash `30552b93a7bf75d1...` · packetHash `40a40b902a9278cc...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 35s
- **Tier Rationale:** Tests one direct Level I comparison of COGS and ending inventory between FIFO and LIFO under rising unit costs.
- **Key:** **C** (Lower cost of goods sold and higher ending inventory)
- **Calculation & Assumptions:** Rising unit costs + stable quantities: FIFO expenses older lower costs (lower COGS) and retains newer higher costs in ending inventory (higher ending inventory).
- **Worked Rationale:** With rising prices, FIFO assigns older, lower costs to COGS and newer, higher costs to ending inventory, resulting in lower COGS and higher ending inventory than LIFO.
- **Distractor A [S]:** Reverses both the COGS and ending inventory effects of FIFO vs LIFO under rising prices.
- **Distractor B [S]:** Correctly identifies lower COGS under FIFO but incorrectly pairs it with lower ending inventory.
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-b-medium (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-b` · Concept `74d32cb4-1422-4f30-842b-0aa16acb5d84`
- **Family:** `fam-pp-2027-r032-b-lifo-reserve-inv` · Fingerprint `800701c3`
- **Pack & Rights:** `prepplan-r032-b-methods@1` · factsHash `30552b93a7bf75d1...` · packetHash `f1c41b73586715b4...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 55s
- **Tier Rationale:** Requires selecting the change in the LIFO reserve (ignoring ending inventory as a distractor) and subtracting it from LIFO COGS.
- **Key:** **B** ($605 million)
- **Calculation & Assumptions:** FIFO COGS = LIFO COGS - (Ending LIFO Reserve - Beginning LIFO Reserve) = 620 - (43 - 28) = 620 - 15 = $605 million.
- **Key Formula:** `lifoCogs - (endRes - begRes)` → `605`
- **Worked Rationale:** FIFO COGS equals LIFO COGS minus the increase in the LIFO reserve during the period: $620 million - ($43 million - $28 million) = $605 million.
- **Distractor A [I]:** Subtracts the full ending LIFO reserve ($43 million) instead of the period change ($15 million): $620 - $43 = $577 million. (formula `lifoCogs - endRes` → `577`)
- **Distractor C [S]:** Adds the change in the LIFO reserve to LIFO COGS instead of subtracting it: $620 + $15 = $635 million. (formula `lifoCogs + (endRes - begRes)` → `635`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-b-hard (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-b` · Concept `74d32cb4-1422-4f30-842b-0aa16acb5d84`
- **Family:** `fam-pp-2027-r032-b-fifo-turnover-restate` · Fingerprint `95f70d8f`
- **Pack & Rights:** `prepplan-r032-b-methods@1` · factsHash `30552b93a7bf75d1...` · packetHash `d5e84c4554722722...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 80s
- **Tier Rationale:** Two linked adjustments: restate COGS using the change in LIFO reserve AND restate average inventory using the average LIFO reserve before computing turnover.
- **Key:** **A** (3.57x)
- **Calculation & Assumptions:** FIFO COGS = 840 - (50 - 30) = 820. Avg LIFO inv = (180 + 200)/2 = 190. Avg reserve = (30 + 50)/2 = 40. Avg FIFO inv = 190 + 40 = 230. Turnover = 820 / 230 = 3.5652 -> 3.57x.
- **Key Formula:** `(lifoCogs - (endRes - begRes)) / ((begInv + begRes + endInv + endRes) / 2)` → `3.5652173913043477`
- **Worked Rationale:** FIFO COGS = $840 - ($50 - $30) = $820 million. Average FIFO inventory = ($180 + $30 + $200 + $50) / 2 = $230 million. FIFO inventory turnover = $820 / $230 = 3.57x.
- **Distractor B [I]:** Restates average inventory to FIFO ($230 million) but leaves COGS unadjusted at $840 million (840 / 230 = 3.65x). (formula `lifoCogs / ((begInv + begRes + endInv + endRes) / 2)` → `3.652173913043478`)
- **Distractor C [I]:** Restates COGS to FIFO ($820 million) but leaves average inventory on a LIFO basis ($190 million; 820 / 190 = 4.32x). (formula `(lifoCogs - (endRes - begRes)) / ((begInv + endInv) / 2)` → `4.315789473684211`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-c-easy (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-c` · Concept `e1f7fa06-4ef4-4919-8825-46c7e9ebeacd`
- **Family:** `fam-pp-2027-r032-c-gaap-disclosure` · Fingerprint `5177273a`
- **Pack & Rights:** `prepplan-r032-c-disclosure@1` · factsHash `4511f098f5c2cd29...` · packetHash `7faaf12dfe09ead2...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 40s
- **Tier Rationale:** Tests one explicit standard-specific disclosure distinction for a U.S. SEC registrant under US GAAP vs IFRS.
- **Key:** **C** (Material income effects from LIFO liquidations (in a note or parenthetically))
- **Calculation & Assumptions:** U.S. SEC registrants using LIFO must disclose material income effects from LIFO liquidations (in footnotes or parenthetically on the income statement); IFRS prohibits LIFO and requires write-down reversal disclosures.
- **Worked Rationale:** IFRS prohibits LIFO, so disclosing material income from LIFO liquidations (either in the footnotes or parenthetically on the income statement under SEC guidance) applies only to US GAAP/SEC reporting.
- **Distractor A [C]:** Identifies a shared disclosure (inventory accounting policies and cost formulas) required under both US GAAP and IFRS.
- **Distractor B [G]:** Attributes an IFRS-only disclosure (write-down reversals) to US GAAP, where reversals are prohibited.
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-c-medium (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-c` · Concept `e1f7fa06-4ef4-4919-8825-46c7e9ebeacd`
- **Family:** `fam-pp-2027-r032-c-composition-signal` · Fingerprint `f0dc2bf8`
- **Pack & Rights:** `prepplan-r032-c-disclosure@1` · factsHash `4511f098f5c2cd29...` · packetHash `57fd119492e2b029...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 50s
- **Tier Rationale:** Requires weighing competing operational interpretations of rising finished goods and doubled write-downs alongside falling raw materials and flat unit sales.
- **Key:** **A** (Possible inventory obsolescence or finished-goods buildup warrants margin scrutiny)
- **Calculation & Assumptions:** Rising finished goods + doubling write-downs + flat unit sales + falling raw materials supports possible obsolescence or finished-goods buildup warranting margin scrutiny.
- **Worked Rationale:** A 34% rise in finished goods alongside flat unit sales and doubled write-downs indicates possible obsolescence or excess finished-goods buildup that could pressure future margins, whereas falling raw materials does not indicate input stockpiling.
- **Distractor B [S]:** Interprets falling raw materials as expanding input buffers.
- **Distractor C [C]:** Attributes operational write-downs and finished-goods accumulation to a tracking-system change (periodic vs perpetual).
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r032-c-hard (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r032` · Outcome `r032-c` · Concept `e1f7fa06-4ef4-4919-8825-46c7e9ebeacd`
- **Family:** `fam-pp-2027-r032-c-lifo-liquidation-profit` · Fingerprint `c05835f0`
- **Pack & Rights:** `prepplan-r032-c-disclosure@1` · factsHash `4511f098f5c2cd29...` · packetHash `d570848df6e61931...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 75s
- **Tier Rationale:** Requires identifying the exact liquidated layer under periodic LIFO (most recent prior layer, not oldest) and measuring incremental gross profit relative to replacing those 300 units at the current year's $68 cost.
- **Key:** **A** ($3,000)
- **Calculation & Assumptions:** Periodic LIFO; sold 1200, purchased 900 at $68 -> 300 units liquidated from most recent prior layer ($58, not $45). Incremental gross profit vs replacing at $68 = 300 * (68 - 58) = $3,000.
- **Key Formula:** `(sold - purchased) * (currCost - newCost)` → `3000`
- **Worked Rationale:** Under periodic LIFO, sales exceed current-year purchases by 1,200 - 900 = 300 units, liquidating the most recent beginning layer (300 units at $58). Relative to replacing those 300 units at the current-year cost of $68, COGS is lower—and gross profit higher—by 300 x ($68 - $58) = $3,000.
- **Distractor B [F]:** Draws the 300 liquidated units from the oldest $45 layer instead of the most recent $58 layer: 300 * ($68 - $45) = $6,900. (formula `(sold - purchased) * (currCost - oldCost)` → `6900`)
- **Distractor C [R]:** Computes total gross profit on the 300 liquidated units: 300 * ($90 - $58) = $9,600. (formula `(sold - purchased) * (price - newCost)` → `9600`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-a-easy (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-a` · Concept `79641ac2-e773-40e9-8946-cd2b6b928efc`
- **Family:** `fam-pp-2027-r004-a-perpetuity-pv` · Fingerprint `7a18ca55`
- **Pack & Rights:** `prepplan-r004-a-pv@1` · factsHash `2eae9e8b75e0c45d...` · packetHash `758b1196cd437df8...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 35s
- **Tier Rationale:** Direct single-step perpetuity valuation using PV = C / r.
- **Key:** **B** ($60.00)
- **Calculation & Assumptions:** Level perpetuity starting at t = 1; C = $4.50; r = 7.5% = 0.075. PV = 4.50 / 0.075 = $60.00.
- **Key Formula:** `div / r` → `60`
- **Worked Rationale:** The present value of an ordinary level perpetuity is C / r = $4.50 / 0.075 = $60.00.
- **Distractor A [T]:** Discounts the perpetuity value one extra period: ($4.50 / 0.075) / 1.075 = $55.81. (formula `div / (r * (1 + r))` → `55.8139534883721`)
- **Distractor C [T]:** Treats the ordinary perpetuity as a perpetuity due: ($4.50 / 0.075) * 1.075 = $64.50. (formula `(div / r) * (1 + r)` → `64.5`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-a-medium (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-a` · Concept `79641ac2-e773-40e9-8946-cd2b6b928efc`
- **Family:** `fam-pp-2027-r004-a-semiannual-bond` · Fingerprint `819c4e39`
- **Pack & Rights:** `prepplan-r004-a-pv@1` · factsHash `2eae9e8b75e0c45d...` · packetHash `c4c943c79cff6df6...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 70s
- **Tier Rationale:** Requires aligning coupon payment, discount rate, and number of periods to semiannual compounding for a fixed-coupon bond.
- **Key:** **B** ($963.70)
- **Calculation & Assumptions:** Par = $1,000; 2 years -> N = 4; 6% annual coupon semiannually -> PMT = $30; 8% YTM compounded semiannually -> r = 4% = 0.04. PV = 30*(1 - 1.04^-4)/0.04 + 1000/1.04^4 = 963.70.
- **Key Formula:** `(par * couponRate / freq) * (1 - (1 + ytm / freq)^(-(years * freq))) / (ytm / freq) + par / (1 + ytm / freq)^(years * freq)` → `963.7010477574314`
- **Worked Rationale:** With 4 semiannual periods, a $30 semiannual coupon, and a 4.0% semiannual discount rate, PV = $30 x [1 - (1.04)^(-4)] / 0.04 + $1,000 / (1.04)^4 = $108.90 + $854.80 = $963.70.
- **Distractor A [T]:** Uses the $30 semiannual coupon with the 8.0% annual rate over 4 periods: $834.39. (formula `(par * couponRate / freq) * (1 - (1 + ytm)^(-(years * freq))) / ytm + par / (1 + ytm)^(years * freq)` → `834.3936579977833`)
- **Distractor C [T]:** Uses annual discounting (N = 2, PMT = $60, r = 8.0%) instead of semiannual compounding: $964.33. (formula `(par * couponRate) * (1 - (1 + ytm)^(-years)) / ytm + par / (1 + ytm)^years` → `964.334705075446`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-a-hard (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-a` · Concept `79641ac2-e773-40e9-8946-cd2b6b928efc`
- **Family:** `fam-pp-2027-r004-a-deferred-growing-perp` · Fingerprint `5c37628d`
- **Pack & Rights:** `prepplan-r004-a-pv@1` · factsHash `2eae9e8b75e0c45d...` · packetHash `b852378d44c7448b...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 75s
- **Tier Rationale:** Two-step deferred growing perpetuity valuation requiring exact timing alignment (value at t = 3, then discount 3 periods to t = 0).
- **Key:** **B** ($1,565,816)
- **Calculation & Assumptions:** First CF at t = 4 is $120,000; g = 2.5%; r = 8.5%. Value at t = 3 is 120000 / (0.085 - 0.025) = 2,000,000. PV at t = 0 = 2000000 / 1.085^3 = $1,565,816.
- **Key Formula:** `(cf4 / (r - g)) / (1 + r)^(startYear - 1)` → `1565816.1968614585`
- **Worked Rationale:** The growing perpetuity formula applied to the Year 4 cash flow gives the value at t = 3: $120,000 / (0.085 - 0.025) = $2,000,000. Discounting back 3 years to t = 0 gives $2,000,000 / (1.085)^3 = $1,565,816.
- **Distractor A [T]:** Discounts the $2,000,000 perpetuity value 4 years instead of 3 years: $2,000,000 / 1.085^4 = $1,443,149. (formula `(cf4 / (r - g)) / (1 + r)^startYear` → `1443148.5685359065`)
- **Distractor C [T]:** Discounts the $2,000,000 perpetuity value only 2 years: $2,000,000 / 1.085^2 = $1,698,911. (formula `(cf4 / (r - g)) / (1 + r)^(startYear - 2)` → `1698910.5735946822`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-b-easy (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-b` · Concept `4583e798-a9c0-43d5-80b7-9fcea2266e1d`
- **Family:** `fam-pp-2027-r004-b-zero-coupon-cagr` · Fingerprint `41d24d24`
- **Pack & Rights:** `prepplan-r004-b-implied@1` · factsHash `5d2317465b67b2b3...` · packetHash `ac83b5ee51b4a8af...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 40s
- **Tier Rationale:** Direct single-formula calculation of compound implied return from PV, FV, and T.
- **Key:** **B** (7.00%)
- **Calculation & Assumptions:** FV = 1000; PV = 762.90; T = 4. r = (1000 / 762.90)^(1/4) - 1 = 7.00%.
- **Key Formula:** `((fv / pv)^(1 / t) - 1) * 100` → `6.999832116882776`
- **Worked Rationale:** The implied annual compound return is (FV / PV)^(1/T) - 1 = ($1,000 / $762.90)^(1/4) - 1 = 7.00%.
- **Distractor A [F]:** Divides total discount by face value and by 4 years: (1000 - 762.90) / 1000 / 4 = 5.93%. (formula `((fv - pv) / fv / t) * 100` → `5.927500000000001`)
- **Distractor C [F]:** Computes simple arithmetic annual return without compounding: ((1000 / 762.90) - 1) / 4 = 7.77%. (formula `((fv / pv - 1) / t) * 100` → `7.769694586446457`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-b-medium (v1)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-b` · Concept `4583e798-a9c0-43d5-80b7-9fcea2266e1d`
- **Family:** `fam-pp-2027-r004-b-price-implied-return-effect` · Fingerprint `64c80285`
- **Pack & Rights:** `prepplan-r004-b-implied@1` · factsHash `5d2317465b67b2b3...` · packetHash `dab5cc3e8fa778a6...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 45s
- **Tier Rationale:** Requires linking a market price change to the implied required return equation r = (D1 / P0) + g while holding D1 and g constant.
- **Key:** **C** (It falls because the forward dividend yield shrinks while growth is constant)
- **Calculation & Assumptions:** r = (D1 / P0) + g. Holding D1 and g constant, an increase in P0 lowers D1 / P0 and therefore lowers implied required return r.
- **Worked Rationale:** Under the constant-growth model, implied required return is r = (D1 / P0) + g. When P0 rises while D1 and g are unchanged, the forward dividend yield (D1 / P0) declines, reducing r.
- **Distractor A [S]:** Assumes higher stock price implies higher required return, reversing the inverse price-yield relationship.
- **Distractor B [I]:** Focuses only on constant growth g and ignores the dividend yield component D1 / P0.
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-b-hard (v3)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-b` · Concept `4583e798-a9c0-43d5-80b7-9fcea2266e1d`
- **Family:** `fam-pp-2027-r004-b-ddm-implied-growth` · Fingerprint `c88e1bc6`
- **Pack & Rights:** `prepplan-r004-b-implied@1` · factsHash `5d2317465b67b2b3...` · packetHash `1dab2fe0a999d198...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 75s
- **Tier Rationale:** Two linked decisions: compute constant dividend growth g from constant retention ratio and ROE, then convert D0 to D1 to derive implied required return.
- **Key:** **C** (10.00%)
- **Calculation & Assumptions:** Constant b = 0.60, constant ROE = 10.0%, dividends grow with earnings -> g = 0.60 * 0.10 = 6.00%. D0 = $2.00 -> D1 = 2.00 * 1.06 = $2.12. P0 = $53.00 -> r = (2.12 / 53.00) + 0.06 = 0.04 + 0.06 = 10.00%.
- **Key Formula:** `(d0 * (1 + b * roe) / p0 + b * roe) * 100` → `10`
- **Worked Rationale:** Sustainable dividend growth is g = retention ratio x ROE = 0.60 x 10.0% = 6.00%. Expected next dividend is D1 = $2.00 x 1.06 = $2.12. Implied required return is r = (D1 / P0) + g = ($2.12 / $53.00) + 6.00% = 4.00% + 6.00% = 10.00%.
- **Distractor A [I]:** Reports only the forward dividend yield D1 / P0 = $2.12 / $53.00 = 4.00% and omits growth g. (formula `(d0 * (1 + b * roe) / p0) * 100` → `4`)
- **Distractor B [T]:** Uses D0 ($2.00) instead of D1 ($2.12): ($2.00 / $53.00) + 6.00% = 9.77%. (formula `(d0 / p0 + b * roe) * 100` → `9.773584905660377`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-c-easy (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-c` · Concept `fe38c0a2-bdcf-4d35-898f-1feb5def9f46`
- **Family:** `fam-pp-2027-r004-c-additivity-arb` · Fingerprint `f95df6cf`
- **Pack & Rights:** `prepplan-r004-c-additivity@1` · factsHash `ddfa2bcd97eab537...` · packetHash `e37e0a46c5ccfcfd...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `foundation` (Easy) · reviewerConfirmedDifficulty `null` · est. 40s
- **Tier Rationale:** Direct application of the law of one price / cash flow additivity under explicit frictionless market assumptions.
- **Key:** **A** (Buying Portfolio X and selling short Portfolio Y locks in a riskless profit today)
- **Calculation & Assumptions:** Frictionless markets (no transaction costs, taxes, or short-sale constraints); identical cash flows in every state and period -> buy cheaper (X), short dearer (Y) for riskless profit.
- **Worked Rationale:** Because both portfolios produce identical future cash flows in every state and trading is frictionless, buying the cheaper portfolio (X) and shorting the more expensive portfolio (Y) cancels all future cash flows and captures the price difference risk-free today.
- **Distractor B [C]:** Claims identical cash flows can have different systematic risk.
- **Distractor C [S]:** Reverses the return direction: paying more for Y lowers its return relative to X.
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-c-medium (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-c` · Concept `fe38c0a2-bdcf-4d35-898f-1feb5def9f46`
- **Family:** `fam-pp-2027-r004-c-forward-rate` · Fingerprint `ac757575`
- **Pack & Rights:** `prepplan-r004-c-additivity@1` · factsHash `ddfa2bcd97eab537...` · packetHash `9819cbe91a95e72c...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `standard` (Medium) · reviewerConfirmedDifficulty `null` · est. 55s
- **Tier Rationale:** Requires translating a two-strategy bond rollover scenario into no-arbitrage spot-forward equivalence (1 + z2)^2 = (1 + z1)(1 + f1,1).
- **Key:** **C** (8.04%)
- **Calculation & Assumptions:** z1 = 4.00%, z2 = 6.00% (annual compounding). Breakeven 1-year reinvestment rate in Year 2: f1,1 = (1.06^2 / 1.04) - 1 = 8.0385% -> 8.04%.
- **Key Formula:** `((1 + z2)^2 / (1 + z1) - 1) * 100` → `8.03846153846155`
- **Worked Rationale:** No-arbitrage requires equal 2-year terminal wealth: (1.06)^2 = (1.04)(1 + f1,1). Thus f1,1 = (1.06^2 / 1.04) - 1 = (1.1236 / 1.04) - 1 = 8.04%.
- **Distractor A [F]:** Omits compounding over 2 years, computing (1.06 / 1.04) - 1 = 1.92%. (formula `((1 + z2) / (1 + z1) - 1) * 100` → `1.9230769230769162`)
- **Distractor B [F]:** Takes the simple average of the two yields: (4.00% + 6.00%) / 2 = 5.00%. (formula `((z1 + z2) / 2) * 100` → `5`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS

## pp-2027-r004-c-hard (v2)
- **Scope:** Edition 2027 · Manifest `11111111-1111-1111-1111-111111111111` · Reading `r004` · Outcome `r004-c` · Concept `fe38c0a2-bdcf-4d35-898f-1feb5def9f46`
- **Family:** `fam-pp-2027-r004-c-binomial-call` · Fingerprint `3b44486a`
- **Pack & Rights:** `prepplan-r004-c-additivity@1` · factsHash `ddfa2bcd97eab537...` · packetHash `2d429d92e58b2859...` · rights `cleared` (PrepPlan / Roadmap first-party authoring (Phase 1 pilot, 2026-11-24))
- **Package:** rubric `phase1-rubric.1` · prompts `{"blueprint":"blueprint.2","writer":"writer.3","solver":"solver.2","summary":"summary.2","schema":"draft.3","checks":"checks.1"}`
- **Difficulty:** intended `difficult` (Hard) · reviewerConfirmedDifficulty `null` · est. 85s
- **Tier Rationale:** Multi-step no-arbitrage binomial option valuation: compute payoffs, hedge ratio delta, risk-free borrowing, and t=0 replicating portfolio cost.
- **Key:** **B** ($6.00)
- **Calculation & Assumptions:** S0=50, Su=65, Sd=40, K=52, rf=4%. cu=13, cd=0. delta = (13-0)/(65-40) = 0.52. B = -(0.52*40)/1.04 = -20. c0 = 0.52*50 - 20 = $6.00.
- **Key Formula:** `((max(0, su - k) - max(0, sd - k)) / (su - sd)) * s0 - (((max(0, su - k) - max(0, sd - k)) / (su - sd)) * sd - max(0, sd - k)) / (1 + rf)` → `6`
- **Worked Rationale:** Call payoffs are cu = max(0, $65 - $52) = $13 and cd = $0. The hedge ratio is delta = ($13 - $0) / ($65 - $40) = 0.52 shares. To match the $0 down-state payoff, borrow $20.80 / 1.04 = $20.00 today. Replicating cost = 0.52 x $50.00 - $20.00 = $6.00.
- **Distractor A [T]:** Fails to discount the down-state borrowing at the risk-free rate: 0.52 * ($50 - $40) = $5.20. (formula `((max(0, su - k) - max(0, sd - k)) / (su - sd)) * (s0 - sd)` → `5.2`)
- **Distractor C [F]:** Applies an unsupported equal-weight (50/50) average of the two payoffs discounted at the risk-free rate: (0.5 * $13 + 0.5 * $0) / 1.04 = $6.25, ignoring replicating hedge weights. (formula `(0.5 * max(0, su - k) + 0.5 * max(0, sd - k)) / (1 + rf)` → `6.25`)
- **Automated Verdict:** OFFLINE_DETERMINISTIC_PASS
