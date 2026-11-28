# quant: answer and review companion

Draft keys require human verification; not publication approval.

## pp-ref2027-r001-a-easy v1 (routine)

Key: B

The cash gain plus the dividend is divided by the purchase price; the return is 12.50%. Calculation: ((87)-(80)+(3)) ÷ (80) × 100 = 12.50%.

- A [F]: Omits the cash distribution.
- C [I]: Reports gross wealth rather than net return.

Difficulty rationale: Proposed foundation based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r001-a-easy (provisional)

## pp-2027-c5-r001-a-hard v1 (routine)

Key: B

Arithmetic mean = (20 − 10 + 8)/3 = 6.00%. Geometric mean = (1.20 × 0.90 × 1.08)^(1/3) − 1 = 1.1664^(1/3) − 1 = 5.2646%. Difference = 6.0000% − 5.2646% = 0.7354% ≈ 74 bps. Calculation: ((((20)+(-10)+(8)) ÷ 3 ÷ 100) - (((1+(20) ÷ 100) × (1+(-10) ÷ 100) × (1+(8) ÷ 100))^(1 ÷ 3) - 1)) × 10000 = 74.

- A [F]: Compared the arithmetic annual mean against the 3-year cumulative return rather than the annualized geometric mean.
- C [I]: Reported the geometric mean in basis points instead of the arithmetic-minus-geometric spread.

Difficulty rationale: Multi-step computation comparing arithmetic and geometric means in basis points.
Family proposal: pp-2027-c5-r001-a-hard (provisional)

## pp-2027-c5-r001-a-medium v1 (routine)

Key: B

The geometric mean links subperiod wealth relatives ((1+r1)(1+r2)(1+r3))^(1/3) − 1, measuring the true compound annual return.

- A [C]: Overstates multi-period compounded growth when returns vary over time.
- C [M]: Harmonic mean is used for averaging ratios like P/E or equal-dollar cost averaging, not multi-period compounding.

Difficulty rationale: Compares mean return concepts in a multi-period compounding context.
Family proposal: pp-2027-c5-r001-a-medium (provisional)

## pp-mock1-r001-a-medium-1 v2 (held_out_mock)

Key: A

Wealth relative = 1.25 × 0.80 = 1.00 → geometric mean = sqrt(1.00) − 1 = 0.00%. Calculation: (sqrt((1+(25) ÷ 100) × (1+(-20) ÷ 100))-1) × 100 = 0.00%.

- B [F]: Used the arithmetic mean (+2.50%) instead of the geometric compound return (0.00%).
- C [I]: Summed the two annual returns (+5.00%) without accounting for compounding or annualization.

Difficulty rationale: Tests arithmetic vs. geometric mean contrast on a +25% / −20% round-trip.
Family proposal: mock1-s1-quant-01 (provisional)

## pp-mock1-r001-a-medium-2 v1 (held_out_mock)

Key: A

A unit of initial wealth becomes 1.06 × 0.96 = 1.0176; cumulative return is 1.76%. Calculation: ((1+(0.06)) × (1+(-0.04))-1) × 100 = 1.76%.

- B [F]: Adds annual returns instead of compounding wealth.
- C [S]: Subtracts an already negative second-period return.

Difficulty rationale: Requires distinguishing cumulative wealth growth from arithmetic return addition.
Family proposal: closeout-geometric-wealth (provisional)

## pp-2027-c5-r001-b-easy v1 (routine)

Key: A

Required nominal return = real risk-free rate + expected inflation + relevant risk premiums (default, liquidity, maturity).

- B [M]: Past equity dividend yields do not define bond required return components.
- C [C]: Corporate tax rates affect issuer WACC, not the investor’s gross required return components.

Difficulty rationale: Direct recall of required return building blocks.
Family proposal: pp-2027-c5-r001-b-easy (provisional)

## pp-2027-c5-r001-b-hard v1 (routine)

Key: C

(1 + r) = (1.025)(1.030)(1.040) − 1 = 1.09798 − 1 = 9.80%. Calculation: ((1+(2.5) ÷ 100) × (1+(3) ÷ 100) × (1+(4) ÷ 100)-1) × 100 = 9.80%.

- A [I]: Computed the nominal risk-free rate without incorporating the 4.0% risk premium.
- B [F]: Used simple additive approximation instead of compounding the Fisher and risk-premium factors.

Difficulty rationale: Applies the exact multiplicative Fisher equation combined with a multiplicative risk premium.
Family proposal: pp-2027-c5-r001-b-hard (provisional)

## pp-ref2027-r001-b-medium v1 (routine)

Key: C

Add the real baseline, inflation compensation and the security-specific risk premium: 9.0%. Calculation: (2)+(3)+(4) = 9.0%.

- A [F]: Drops expected inflation.
- B [I]: Drops the real risk-free component.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r001-b-medium (provisional)

## pp-2027-c5-r002-a-easy v1 (routine)

Key: C

HPR = (984 − 960 + 48) / 960 = 72 / 960 = 7.50%. Calculation: ((984)-(960)+(48)) ÷ (960) × 100 = 7.50%.

- A [I]: Computed price return only and omitted the coupon income.
- B [F]: Divided total dollar return by ending price instead of beginning price.

Difficulty rationale: Direct single-period holding-period return calculation.
Family proposal: pp-2027-c5-r002-a-easy (provisional)

## pp-2027-c5-r002-a-hard v1 (routine)

Key: C

EAR = (1 + 0.08/4)^4 − 1 = (1.02)^4 − 1 = 8.24%. Calculation: ((1+((8) ÷ 100) ÷ 4)^4-1) × 100 = 8.24%.

- A [C]: Confused the stated nominal annual rate with the effective annual rate.
- B [T]: Applied semiannual compounding instead of quarterly compounding.

Difficulty rationale: Converts stated nominal rate with intra-year compounding to effective annual rate.
Family proposal: pp-2027-c5-r002-a-hard (provisional)

## pp-ref2027-r002-a-medium v1 (routine)

Key: B

Multiply the two gross returns, then subtract the original capital: 3.04%. Calculation: ((1+(12) ÷ 100) × (1+(-8) ÷ 100)-1) × 100 = 3.04%.

- A [I]: Reports an arithmetic annual mean, not a cumulative return.
- C [F]: Adds annual returns instead of compounding.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r002-a-medium (provisional)

## pp-mock1-r002-a-medium-1 v2 (held_out_mock)

Key: C

EAR = e^0.06 − 1 = 1.061837 − 1 = 6.18%. Calculation: (exp((6) ÷ 100)-1) × 100 = 6.18%.

- A [C]: Reported the continuously compounded nominal rate without converting to EAR.
- B [T]: Used monthly compounding instead of continuous compounding e^r − 1.

Difficulty rationale: Converts continuous rate to effective annual rate.
Family proposal: mock1-s1-quant-02 (provisional)

## pp-mock1-r002-a-medium-2 v1 (held_out_mock)

Key: B

Divide the gross nominal wealth factor by the gross price-level factor, then subtract one. Calculation: ((1+(0.08)) ÷ (1+(0.03))-1) × 100 = 4.85%.

- A [I]: Reverses the purchasing-power ratio.
- C [F]: Uses the subtraction approximation instead of the requested exact adjustment.

Difficulty rationale: Discriminates exact purchasing-power adjustment from the common subtraction approximation.
Family proposal: closeout-real-return-exact (provisional)

## pp-2027-c5-r003-a-easy v1 (routine)

Key: C

Money-weighted return (MWR) is the discount rate that equates the present value of cash inflows and terminal value to the initial outlay and contributions.

- A [M]: Time-weighted return chains subperiod returns and is insensitive to cash-flow size/timing.
- B [C]: Price return excludes income and does not solve for cash-flow IRR.

Difficulty rationale: Direct recall of money-weighted return definition.
Family proposal: pp-2027-c5-r003-a-easy (provisional)

## pp-2027-c5-r003-a-hard v1 (routine)

Key: A

Year 1 return r1 = (118 + 2)/100 − 1 = 20.0%. Year 2 return r2 = (115 + 3)/118 − 1 = 0.0%. TWR = sqrt(1.20 × 1.00) − 1 = 9.54%. Calculation: (sqrt((((118)+(2)) ÷ (100)) × (((115)+(3)) ÷ (118)))-1) × 100 = 9.54%.

- B [F]: Averaged the two subperiod returns arithmetically instead of geometrically linking them.
- C [C]: Ignored the Year 1 share purchase and intermediate valuation at t = 1.

Difficulty rationale: Computes subperiod returns with dividends and geometrically links them for TWR.
Family proposal: pp-2027-c5-r003-a-hard (provisional)

## pp-ref2027-r003-a-medium v1 (routine)

Key: A

Linking subperiod returns removes the effect of externally directed contributions and withdrawals.

- B [C]: Allows the client’s cash-flow timing to influence the measure.
- C [M]: Measures only one component of investment return.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r003-a-medium (provisional)

## pp-mock1-r003-a-medium-1 v2 (held_out_mock)

Key: B

TWR is the industry standard for evaluating discretionary managers who do not control client cash-flow timing.

- A [C]: Money-weighted return penalizes/rewards external cash-flow timing outside the manager’s control.
- C [M]: Both metrics use market valuations; TWR isolates manager performance.

Difficulty rationale: Compares TWR vs. MWR for manager performance attribution.
Family proposal: mock1-s1-quant-03 (provisional)

## pp-2027-c5-r003-b-easy v1 (routine)

Key: C

Because market-cap weights are proportional to price × shares, price appreciation naturally increases a stock’s weight in a cap-weighted index.

- A [M]: Describes equal-weighted index rebalancing rather than market-cap weighting.
- B [C]: Market-cap weights float dynamically with market capitalization.

Difficulty rationale: Direct recall of market-cap index weighting dynamics.
Family proposal: pp-2027-c5-r003-b-easy (provisional)

## pp-2027-c5-r003-b-hard v1 (routine)

Key: B

Initial price sum = 150 + 50 = 200. Ending price sum = 180 + 30 = 210. Price-weighted index return = 210/200 − 1 = 5.00%. Calculation: (((180)+(30)) ÷ ((150)+(50))-1) × 100 = 5.00%.

- A [F]: Computed an equal-weighted return instead of a price-weighted return.
- C [I]: Tracked only the higher-priced stock and ignored Stock Y.

Difficulty rationale: Computes price-weighted index return and contrasts it with equal-weighted average.
Family proposal: pp-2027-c5-r003-b-hard (provisional)

## pp-ref2027-r003-b-medium v1 (routine)

Key: A

A price-weighted index allocates weight in proportion to share price, rather than shares outstanding or company value.

- B [C]: Gives each constituent the same weight.
- C [M]: Identical market capitalizations imply identical weights.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r003-b-medium (provisional)

## pp-mock1-r003-b-medium-1 v1 (held_out_mock)

Key: C

Price changes create weight drift. Restoring equal target weights trims relative winners and adds to laggards.

- A [M]: Confuses restoring equal weights with reinforcing recent performance.
- B [C]: Unchanged quantities allow weights to drift with prices.

Difficulty rationale: Applies index maintenance to a relative-price change.
Family proposal: closeout-index-rebalance (provisional)

## pp-ref2027-r004-a-easy v1 (routine)

Key: A

Discount the future payment for both years at the stated effective annual rate. The present value is $1,200.00. Calculation: (1452) ÷ (1+(10) ÷ 100)^(2) = $1,200.00.

- B [F]: Discounts only one of the two years.
- C [I]: Compounds a future payment forward rather than discounting it.

Difficulty rationale: Proposed foundation based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r004-a-easy (provisional)

## pp-mock1-r004-a-medium-1 v2 (held_out_mock)

Key: B

FV = 5,000 × [(1.06^4 − 1) / 0.06] = 5,000 × 4.374616 = $21,873.08. Calculation: (5000) × (((1+(6) ÷ 100)^(4)-1) ÷ ((6) ÷ 100)) = $21,873.08.

- A [F]: Ignored multi-year compounding across the four annual deposits.
- C [T]: Used the annuity-due formula (beginning-of-year deposits) instead of ordinary annuity.

Difficulty rationale: Computes future value of an ordinary annuity.
Family proposal: mock1-s1-quant-04 (provisional)

## pp-mock1-r004-a-medium-2 v1 (held_out_mock)

Key: A

Discount the single future cash flow by the compound accumulation factor over three years. Calculation: (7500) ÷ (1+(0.05))^(3) = $6,478.78.

- B [F]: Discounts with simple interest rather than annual compounding.
- C [I]: Compounds the future payment forward instead of discounting it.

Difficulty rationale: Applies compound discounting with explicit timing and rate convention.
Family proposal: closeout-single-payment-discount (provisional)

## pp-ref2027-r004-b-medium v1 (routine)

Key: A

Solve the compound-growth equation for the annual rate: (future value / present value) raised to the inverse holding period, less one. Calculation: (((968) ÷ (800))^(1 ÷ (2))-1) × 100 = 10.00%.

- B [I]: Divides cumulative growth instead of finding the compound rate.
- C [F]: Uses the cumulative return as an annual return.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r004-b-medium (provisional)

## pp-ref2027-r004-c-medium v2 (routine)

Key: C

Identical dated payoffs cancel, leaving a positive initial receipt from selling the more expensive replicating portfolio.

- A [C]: Contradicts the stated identical cash-flow premise.
- B [M]: Labels do not alter a replicating payoff.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r004-c-medium (provisional)

## pp-ref2027-r005-a-easy v1 (routine)

Key: B

Sum the three observations and divide by three. The arithmetic mean is 7.0%. Calculation: ((3)+(6)+(12)) ÷ 3 = 7.0%.

- A [I]: Substitutes the median for the mean.
- C [F]: Does not divide by the number of observations.

Difficulty rationale: Proposed foundation based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r005-a-easy (provisional)

## pp-2027-c5-r005-a-hard v1 (routine)

Key: C

Mean = (2+6+4+8)/4 = 5%. Sum of squared deviations = (−3)^2 + 1^2 + (−1)^2 + 3^2 = 9 + 1 + 1 + 9 = 20. Sample variance = 20 / (4 − 1) = 6.67. Calculation: (((2)-((2)+(6)+(4)+(8)) ÷ 4)^2+((6)-((2)+(6)+(4)+(8)) ÷ 4)^2+((4)-((2)+(6)+(4)+(8)) ÷ 4)^2+((8)-((2)+(6)+(4)+(8)) ÷ 4)^2) ÷ 3 = 6.67.

- A [R]: Computed sample standard deviation instead of sample variance.
- B [F]: Divided by n = 4 (population variance) instead of n − 1 = 3 (sample variance).

Difficulty rationale: Computes sample variance using Bessel’s correction (n − 1) and avoids std-dev confusion.
Family proposal: pp-2027-c5-r005-a-hard (provisional)

## pp-2027-c5-r005-a-medium v1 (routine)

Key: A

When a distribution has extreme outliers or strong skewness, the median resists distortion better than the arithmetic mean.

- B [C]: Arithmetic mean is heavily pulled upward by the extreme 18.0x outlier.
- C [M]: Range measures dispersion, not central tendency.

Difficulty rationale: Applies central-tendency selection to a skewed outlier-laden sample.
Family proposal: pp-2027-c5-r005-a-medium (provisional)

## pp-2027-c5-r005-b-easy v1 (routine)

Key: B

A long right tail pulls the mean above the median, while the mode remains at the peak on the left.

- A [S]: Describes a negatively skewed (left-skewed) distribution.
- C [C]: In a unimodal skewed distribution, the median always sits between the mode and the mean.

Difficulty rationale: Direct recall of mean-median-mode ordering under positive skewness.
Family proposal: pp-2027-c5-r005-b-easy (provisional)

## pp-2027-c5-r005-b-hard v1 (routine)

Key: C

Normal models assume zero skewness and zero excess kurtosis; negative skew plus fat tails produce larger and more frequent downside tail losses.

- A [C]: Positive excess kurtosis indicates heavier tails and sharper peak, increasing extreme tail probability.
- B [S]: Negative skewness lengthens the left (loss) tail.

Difficulty rationale: Diagnoses normal-distribution tail-risk understatement under negative skew and positive excess kurtosis.
Family proposal: pp-2027-c5-r005-b-hard (provisional)

## pp-ref2027-r005-b-medium v1 (routine)

Key: C

An unusually long or extreme left tail produces negative skewness; the average return may still be positive.

- A [C]: Places the unusually long tail on the gain side.
- B [M]: Tail asymmetry alone does not determine the mean.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r005-b-medium (provisional)

## pp-mock1-r005-b-medium-1 v2 (held_out_mock)

Key: B

Positive skewness indicates upside asymmetry where right-tail outliers pull the mean above the median.

- A [S]: Describes negative skewness, not positive skewness.
- C [C]: Symmetric distributions have zero skewness.

Difficulty rationale: Interprets positive skewness direction.
Family proposal: mock1-s1-quant-05 (provisional)

## pp-2027-c5-r005-c-easy v1 (routine)

Key: A

Standardizing covariance by the product of the two standard deviations bounds correlation strictly to [−1, +1].

- B [C]: Omits negative linear relationships.
- C [M]: Describes covariance, which is unbounded and unit-dependent, rather than standardized correlation.

Difficulty rationale: Direct recall of correlation bounds.
Family proposal: pp-2027-c5-r005-c-easy (provisional)

## pp-2027-c5-r005-c-hard v2 (routine)

Key: B

Because Y = X^2 is symmetric around X = 0, positive and negative cross-products cancel, yielding zero linear correlation despite exact deterministic dependence.

- A [C]: Zero correlation does not prove statistical independence when dependence is nonlinear.
- C [M]: Y takes values 0, 1, 4 and clearly has positive variance.

Difficulty rationale: Diagnoses the linear-only limitation of Pearson correlation.
Family proposal: pp-2027-c5-r005-c-hard (provisional)

## pp-ref2027-r005-c-medium v1 (routine)

Key: A

Correlation is covariance divided by the product of the two standard deviations; it is unitless. Calculation: (60) ÷ ((20) × (10)) = 0.30.

- B [F]: Divides by a sum rather than the product of standard deviations.
- C [I]: Confuses covariance with its standardized measure.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r005-c-medium (provisional)

## pp-mock1-r005-c-medium-1 v1 (held_out_mock)

Key: B

Using matching percentage-point units, correlation equals covariance divided by the product of the two standard deviations. Calculation: (48) ÷ ((8) × (12)) = 0.50.

- A [F]: Squares the denominator even though covariance already has squared-return units.
- C [F]: Divides covariance by a sum rather than a product of standard deviations.

Difficulty rationale: Separates unit-free correlation from covariance with explicit units.
Family proposal: closeout-covariance-to-correlation (provisional)

## pp-2027-c5-r005-d-easy v2 (routine)

Key: B

Coefficient of variation = standard deviation / mean = 18% / 12% = 1.50. Calculation: (18) ÷ (12) = 1.50.

- A [S]: Inverted the ratio (computed return per unit of risk instead of risk per unit of return).
- C [F]: Subtracted mean return from standard deviation instead of dividing.

Difficulty rationale: Direct calculation of the coefficient of variation.
Family proposal: pp-2027-c5-r005-d-easy (provisional)

## pp-2027-c5-r005-d-hard v1 (routine)

Key: A

Shortfalls below 2%: month 2 has (2 − (−2)) = 4 → 16; month 3 has (2 − 0) = 2 → 4; months 1 and 4 exceed target (0). Target semideviation = sqrt((16 + 4) / (4 − 1)) = sqrt(6.6667) = 2.58%. Calculation: sqrt((max(0,(2)-(6))^2+max(0,(2)-(-2))^2+max(0,(2)-(0))^2+max(0,(2)-(8))^2) ÷ 3) = 2.58%.

- B [F]: Divided by (observations below target) instead of total (n − 1) = 3.
- C [C]: Included upside deviations above the 2% target.

Difficulty rationale: Computes target semideviation accurately using full-sample n − 1 denominator and zeroing upside deviations.
Family proposal: pp-2027-c5-r005-d-hard (provisional)

## pp-ref2027-r005-d-medium v1 (routine)

Key: B

Target semideviation measures squared shortfalls below the target rather than all departures from the mean.

- A [C]: Scales total standard deviation by the mean.
- C [M]: Includes both upside and downside extremes.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r005-d-medium (provisional)

## pp-ref2027-r006-a-easy v1 (routine)

Key: A

Weight each possible return by its probability and sum the weighted returns. Calculation: (0.4) × (18)+(1-(0.4)) × (-2) = 6.0%.

- B [I]: Omits the adverse outcome.
- C [F]: Assumes equal probabilities despite the stated distribution.

Difficulty rationale: Proposed foundation based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r006-a-easy (provisional)

## pp-mock1-r006-a-easy-1 v2 (held_out_mock)

Key: A

E(R) = 0.2(20%) + 0.5(8%) + 0.3(−5%) = 4.0% + 4.0% − 1.5% = 6.5%. Calculation: (20) × (0.2)+(8) × (0.5)+(-5) × (0.3) = 6.5%.

- B [C]: Used unweighted average instead of probability-weighted expectation.
- C [I]: Omitted the adverse −5% state.

Difficulty rationale: Computes three-state probability-weighted expected return.
Family proposal: mock1-s1-quant-06 (provisional)

## pp-2027-c5-r006-a-hard v1 (routine)

Key: A

E(RA) = 10%, E(RB) = 4%. State 1 dev: (+6)(+6) = 36; State 2 dev: (−6)(−6) = 36. Cov = 0.5(36) + 0.5(36) = 36.00. Calculation: 0.5 × ((16)-((16)+(4)) ÷ 2) × ((10)-((10)+(-2)) ÷ 2)+0.5 × ((4)-((16)+(4)) ÷ 2) × ((-2)-((10)+(-2)) ÷ 2) = 36.00.

- B [C]: Forgot to weight each state’s cross-product by its 0.50 probability.
- C [F]: Computed E(RA × RB) without subtracting the means E(RA) and E(RB).

Difficulty rationale: Computes probability-weighted covariance from joint state outcomes.
Family proposal: pp-2027-c5-r006-a-hard (provisional)

## pp-2027-c5-r006-a-medium v1 (routine)

Key: B

Var(R) = 0.40 × (20 − 8)^2 + 0.60 × (0 − 8)^2 = 0.40 × 144 + 0.60 × 64 = 57.6 + 38.4 = 96.00. Calculation: (0.4) × ((20)-(8))^2+(0.6) × ((0)-(8))^2 = 96.00.

- A [F]: Omitted squaring the deviations from the expected return (yields zero).
- C [C]: Used equal 0.50 weights instead of the stated probability distribution.

Difficulty rationale: Computes probability-weighted variance from a discrete distribution.
Family proposal: pp-2027-c5-r006-a-medium (provisional)

## pp-2027-c5-r006-b-easy v1 (routine)

Key: C

A binomial distribution counts successes across n independent Bernoulli trials each with probability p.

- A [M]: Uniform distribution assigns equal density over a continuous interval, not discrete counts.
- B [M]: Lognormal is a positive continuous distribution used for asset prices.

Difficulty rationale: Direct recall of the binomial distribution.
Family proposal: pp-2027-c5-r006-b-easy (provisional)

## pp-2027-c5-r006-b-hard v2 (routine)

Key: A

Under normality, P(R < RL) = N((RL − E(R)) / σ) = N(−0.50) ≈ 30.85%.

- B [F]: Ignores standard deviation and normal-tail standardization.
- C [S]: Since threshold 3% is below the 9% mean, shortfall probability is below 50% (left tail).

Difficulty rationale: Integrates normal standardization with Roy’s safety-first shortfall probability.
Family proposal: pp-2027-c5-r006-b-hard (provisional)

## pp-ref2027-r006-b-medium v1 (routine)

Key: B

Exponentiating normally distributed log returns produces a positive, lognormally distributed price.

- A [C]: Would permit negative prices under that model.
- C [M]: Does not follow from normal logarithmic returns.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r006-b-medium (provisional)

## pp-mock1-r006-b-medium-1 v1 (held_out_mock)

Key: C

A finite outcome set is discrete; each assigned probability is nonnegative and the probabilities sum to one.

- A [C]: A finite list of outcomes is discrete rather than continuous.
- B [M]: A valid probability model must assign total probability one.

Difficulty rationale: Recognizes distribution type from support rather than a named formula.
Family proposal: closeout-finite-distribution-support (provisional)

## pp-2027-c5-r006-c-easy v1 (routine)

Key: B

By the total probability rule for expectation: E(R) = 0.70(15%) + 0.30(−5%) = 10.5% − 1.5% = 9.0%. Calculation: (0.7) × (15)+(0.3) × (-5) = 9.0%.

- A [C]: Used simple average ignoring the 70/30 state probabilities.
- C [I]: Omitted the slowdown branch.

Difficulty rationale: Direct calculation of unconditional expectation from conditional expectations.
Family proposal: pp-2027-c5-r006-c-easy (provisional)

## pp-2027-c5-r006-c-hard v2 (routine)

Key: C

By the law of total variance, Var(R) = E[Var(R|Regime)] + Var(E[R|Regime]); regime-mean differences add an extra variance component.

- A [C]: Omits the between-regime variance term whenever conditional means differ across regimes.
- B [S]: Mixing regimes with different means adds dispersion rather than reducing it.

Difficulty rationale: Integrates the law of total variance across conditional regimes.
Family proposal: pp-2027-c5-r006-c-hard (provisional)

## pp-ref2027-r006-c-medium v1 (routine)

Key: A

Use probabilities conditional on recession, not unconditional market probabilities, and include both branches. Calculation: (0.25) × (14)+(1-(0.25)) × (-6) = -1.0%.

- B [I]: Omits the weak-demand branch.
- C [F]: Ignores the conditional probability weights.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r006-c-medium (provisional)

## pp-2027-c5-r006-d-easy v1 (routine)

Key: A

Bayes’ theorem updates the initial prior probability with new likelihood evidence to produce a posterior probability.

- B [M]: Describes the posterior probability rather than the prior.
- C [C]: Describes a false-positive conditional likelihood, not the prior.

Difficulty rationale: Direct recall of Bayesian terminology.
Family proposal: pp-2027-c5-r006-d-easy (provisional)

## pp-ref2027-r006-d-hard v1 (routine)

Key: B

Bayes’ rule divides the joint probability of default and warning by the total probability of a warning, including false alarms. Calculation: ((80) ÷ 100 × (5) ÷ 100) ÷ ((80) ÷ 100 × (5) ÷ 100+(10) ÷ 100 × (1-(5) ÷ 100)) × 100 = 29.63%.

- A [I]: Fails to update the prior after observing the warning.
- C [F]: Confuses sensitivity with the posterior probability.

Difficulty rationale: Proposed difficult based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r006-d-hard (provisional)

## pp-mock1-r006-d-hard-1 v2 (held_out_mock)

Key: B

P(Rec & Inv) = 0.20 × 0.80 = 0.16. P(NoRec & Inv) = 0.80 × 0.10 = 0.08. Posterior = 0.16 / 0.24 = 66.67%. Calculation: ((20) ÷ 100 × (80) ÷ 100) ÷ (((20) ÷ 100 × (80) ÷ 100)+((1-(20) ÷ 100) × (10) ÷ 100)) × 100 = 66.67%.

- A [I]: Reported joint probability instead of dividing by total probability of inversion.
- C [C]: Confused P(Inversion | Recession) with P(Recession | Inversion).

Difficulty rationale: Applies Bayes’ theorem to a macro recession signal.
Family proposal: mock1-s1-quant-07 (provisional)

## pp-2027-c5-r006-d-medium v1 (routine)

Key: B

P(Beat & Signal) = 0.40 × 0.75 = 0.30. P(Miss & Signal) = 0.60 × 0.25 = 0.15. Total P(Signal) = 0.45. Posterior = 0.30 / 0.45 = 66.67%. Calculation: ((40) ÷ 100 × (75) ÷ 100) ÷ (((40) ÷ 100 × (75) ÷ 100)+((1-(40) ÷ 100) × (25) ÷ 100)) × 100 = 66.67%.

- A [I]: Computed the joint probability P(Beat and Signal) without dividing by total P(Signal).
- C [C]: Confused P(Signal | Beat) with the inverse conditional P(Beat | Signal).

Difficulty rationale: Standard Bayesian posterior update calculation.
Family proposal: pp-2027-c5-r006-d-medium (provisional)

## pp-2027-c5-r007-a-easy v1 (routine)

Key: B

Stratified random sampling partitions the population into homogeneous strata (sectors) and samples proportionally from each.

- A [M]: Convenience sampling selects easily accessible items without proportional representation.
- C [C]: Stratified sampling draws from every stratum, whereas single-stage cluster sampling selects whole clusters.

Difficulty rationale: Direct recall of sampling methods.
Family proposal: pp-2027-c5-r007-a-easy (provisional)

## pp-2027-c5-r007-a-hard v1 (routine)

Key: B

Standard error = 4.0% / sqrt(64) = 0.50%. Margin of error = 1.96 × 0.50% = 0.98%. Full width = 2 × 0.98% = 1.96%. Calculation: 2 × (1.96) × ((4) ÷ sqrt((64))) = 1.96%.

- A [I]: Reported the half-width (margin of error) instead of the full interval width.
- C [F]: Forgot to divide the sample standard deviation by sqrt(n) to obtain the standard error.

Difficulty rationale: Computes full confidence-interval width using standard error and avoids half-width confusion.
Family proposal: pp-2027-c5-r007-a-hard (provisional)

## pp-ref2027-r007-a-medium v1 (routine)

Key: A

The central limit theorem concerns the distribution of repeated sample means, rather than the population or individual draws.

- B [C]: Sampling does not change the population’s shape.
- C [M]: Individual draws retain the original population distribution.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r007-a-medium (provisional)

## pp-2027-c5-r007-b-easy v2 (routine)

Key: C

Statistical power equals 1 − β, where β is the Type II error rate (failing to reject a false null).

- A [M]: Describes significance level α (Type I error probability), not power.
- B [C]: Degrees of freedom/sample ratio does not define test power.

Difficulty rationale: Direct recall of statistical power.
Family proposal: pp-2027-c5-r007-b-easy (provisional)

## pp-2027-c5-r007-b-hard v1 (routine)

Key: B

With fixed n, α and β move inversely: reducing α from 5% to 1% cuts false rejections (Type I) at the expense of higher missed rejections (Type II) and lower power.

- A [C]: For a fixed sample size, lowering α raises the rejection threshold and increases β (Type II error).
- C [S]: A stricter 1% threshold requires stronger evidence to reject, reducing power to catch a flawed model.

Difficulty rationale: Integrates the α–β–power trade-off for a fixed sample size.
Family proposal: pp-2027-c5-r007-b-hard (provisional)

## pp-ref2027-r007-b-medium v1 (routine)

Key: C

A false rejection is a Type I error. The chosen significance level controls its probability under the testing assumptions.

- A [C]: Means failing to reject a false null.
- B [M]: Power concerns rejection when the null is false.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r007-b-medium (provisional)

## pp-mock1-r007-b-medium-1 v2 (held_out_mock)

Key: B

The p-value is the smallest significance level at which H0 is rejected; 0.021 < 0.05 leads to rejecting H0.

- A [C]: Smaller p-values provide stronger evidence against the null; rejection occurs when p <= α.
- C [M]: At α = 1%, 0.021 > 0.01 fails to reject H0, and hypothesis tests never "prove" a null true.

Difficulty rationale: Applies p-value decision rule in hypothesis testing.
Family proposal: mock1-s1-quant-08 (provisional)

## pp-2027-c5-r007-c-easy v1 (routine)

Key: A

When population variances are unknown and sample sizes are small, tests on means use the t-distribution.

- B [M]: Chi-square tests variance or contingency independence, not difference in means.
- C [C]: Wilcoxon is a non-parametric test for paired differences, not a parametric t-test.

Difficulty rationale: Direct recall of parametric mean-comparison test selection.
Family proposal: pp-2027-c5-r007-c-easy (provisional)

## pp-2027-c5-r007-c-hard v2 (routine)

Key: B

For a median test without a symmetry or normality assumption, compare observations above and below the hypothesized median with a sign test, treating ties appropriately. A Wilcoxon signed-rank location test additionally needs an appropriate symmetry assumption.

- A [M]: An F-test compares variances between two samples, not a single-sample median against 10%.
- C [C]: n = 18 with extreme skewness/outliers is below typical CLT comfort and distorts sample mean and SD.

Difficulty rationale: Integrates sample size, outlier sensitivity, and parametric vs. non-parametric test choice.
Family proposal: pp-2027-c5-r007-c-hard (provisional)

## pp-ref2027-r007-c-medium v1 (routine)

Key: C

Rank-based methods use order information and can avoid the distributional assumptions of the corresponding parametric procedure.

- A [C]: Does not address the ordinal-data restriction.
- B [M]: Ranked data still require a test and a decision criterion.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r007-c-medium (provisional)

## pp-2027-c5-r008-a-easy v1 (routine)

Key: A

E(Rp) = 0.40(11%) + 0.60(6%) = 4.4% + 3.6% = 8.0%. Calculation: ((40) ÷ 100) × (11)+((60) ÷ 100) × (6) = 8.0%.

- B [C]: Used equal 50/50 weights instead of 40/60 weights.
- C [F]: Swapped the weights of Asset 1 and Asset 2.

Difficulty rationale: Direct calculation of two-asset portfolio expected return.
Family proposal: pp-2027-c5-r008-a-easy (provisional)

## pp-2027-c5-r008-a-hard v1 (routine)

Key: B

w1^2 s1^2 = 0.25(100) = 25; w2^2 s2^2 = 0.25(400) = 100. Cross term = 145 − 125 = 20 = 2(0.5)(0.5)(10)(20)ρ = 100ρ → ρ = 0.20. Calculation: ((145) - ((50) ÷ 100)^2 × (10)^2 - ((50) ÷ 100)^2 × (20)^2) ÷ (2 × ((50) ÷ 100) × ((50) ÷ 100) × (10) × (20)) = 0.20.

- A [F]: Forgot to divide by 2 × w1 × w2 when backing out covariance/correlation.
- C [C]: Divided portfolio SD by weighted-average SD instead of solving the variance equation.

Difficulty rationale: Inverts the two-asset portfolio variance equation to solve for correlation.
Family proposal: pp-2027-c5-r008-a-hard (provisional)

## pp-ref2027-r008-a-medium v1 (routine)

Key: A

Combine the weighted variances and the covariance term, then take the square root. The correlation enters the cross-product term; it does not eliminate either asset’s variance. Calculation: sqrt((0.35)^2 × (13)^2+(0.65)^2 × (19)^2+2 × (0.35) × (0.65) × (13) × (19) × (0.2)) = 13.99%.

- B [F]: Assumes perfect positive correlation.
- C [I]: Reports portfolio variance as standard deviation.

Difficulty rationale: Proposed standard based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r008-a-medium (provisional)

## pp-mock1-r008-a-medium-1 v2 (held_out_mock)

Key: A

Var = 0.36(100) + 0.16(400) + 2(0.6)(0.4)(10)(20)(0.5) = 36 + 64 + 48 = 148 → SD = sqrt(148) = 12.17%. Calculation: sqrt(((60) ÷ 100)^2 × (10)^2+((40) ÷ 100)^2 × (20)^2+2 × ((60) ÷ 100) × ((40) ÷ 100) × (10) × (20) × (0.5)) = 12.17%.

- B [C]: Used weighted average SD (valid only for ρ = 1.0).
- C [I]: Reported portfolio variance rather than standard deviation.

Difficulty rationale: Computes two-asset portfolio SD with positive partial correlation.
Family proposal: mock1-s1-quant-09 (provisional)

## pp-2027-c5-r008-b-easy v1 (routine)

Key: A

The Markowitz efficient frontier consists of all minimum-variance portfolios at or above the global minimum-variance portfolio.

- B [S]: Lower-half portfolios are dominated by upper-half portfolios with the same risk and higher return.
- C [C]: The minimum-variance frontier is formed from risky assets before introducing a risk-free asset.

Difficulty rationale: Direct recall of the Markowitz efficient frontier.
Family proposal: pp-2027-c5-r008-b-easy (provisional)

## pp-2027-c5-r008-b-hard v1 (routine)

Key: B

Diversification depends on covariance/correlation as well as standalone risk; low correlation allows a small allocation to lower overall portfolio variance or expand the frontier.

- A [C]: Ignores the diversification benefit in the covariance term.
- C [M]: Only correlation −1.0 with exact weights can eliminate variance; +0.10 reduces but does not zero risk.

Difficulty rationale: Integrates standalone volatility vs. correlation in expanding the minimum-variance frontier.
Family proposal: pp-2027-c5-r008-b-hard (provisional)

## pp-ref2027-r008-b-medium v2 (routine)

Key: C

Minimum variance is defined relative to a required expected return. Only the upper portion of the minimum-variance frontier is efficient.

- A [C]: Diversification does not make a portfolio inefficient.
- B [M]: A risk minimum need not have zero risk.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r008-b-medium (provisional)

## pp-2027-c5-r008-c-easy v1 (routine)

Key: B

Every combination of Rf and risky portfolio P lies on a straight line in (σ, E(R)) space with intercept Rf and slope equal to P’s Sharpe ratio.

- A [C]: Beta is the x-axis/slope variable of the Security Market Line (SML), not the CAL.
- C [F]: Uses variance and wrong denominator.

Difficulty rationale: Direct recall of the CAL slope.
Family proposal: pp-2027-c5-r008-c-easy (provisional)

## pp-ref2027-r008-c-hard v1 (routine)

Key: C

Risk aversion changes the chosen location on the optimal capital allocation line, while the tangency risky portfolio can remain the same.

- A [C]: The premise gives them identical expectations.
- B [M]: Risk exposure can be reduced without abandoning the tangency portfolio.

Difficulty rationale: Proposed difficult based on integrate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r008-c-hard (provisional)

## pp-2027-c5-r008-c-medium v1 (routine)

Key: A

Weight in M = σtarget / σM = 18% / 15% = 1.20 (120%), funded by borrowing 20% at Rf.

- B [S]: Lending 20% reduces standard deviation to 12.0%, below 15.0%.
- C [C]: Optimal leveraged portfolios stay on the CML using Portfolio M.

Difficulty rationale: Applies CML leverage calculation to hit a target volatility above the tangency portfolio.
Family proposal: pp-2027-c5-r008-c-medium (provisional)

## pp-2027-c5-r009-a-easy v1 (routine)

Key: C

Historical simulation cannot generate stress scenarios or structural regimes that never occurred in the chosen historical sample.

- A [C]: Historical simulation is non-parametric and uses empirical past returns directly.
- B [M]: Historical simulation applies easily to multi-asset portfolios using historical joint moves.

Difficulty rationale: Direct recall of historical simulation’s key limitation.
Family proposal: pp-2027-c5-r009-a-easy (provisional)

## pp-2027-c5-r009-a-hard v2 (routine)

Key: A

Because historical simulation draws strictly from past realized days, a short calm lookback window misses rare regime breaks.

- B [C]: Historical simulation underestimates risk whenever the lookback window was abnormally calm.
- C [M]: Historical simulation does not assume normality; its blind spot here was sample-window stationarity.

Difficulty rationale: Diagnoses lookback-window regime blindness in historical simulation.
Family proposal: pp-2027-c5-r009-a-hard (provisional)

## pp-ref2027-r009-a-medium v1 (routine)

Key: B

Historical simulation revalues current exposure under observed past market moves and inherits the limitations of that historical window.

- A [C]: Historical simulation uses observed changes rather than a chosen parametric generator.
- C [M]: No resampling is described; the historical changes are applied directly.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r009-a-medium (provisional)

## pp-ref2027-r009-b-easy v1 (routine)

Key: A

The bootstrap treats the observed sample as an empirical distribution and draws replacement samples from it.

- B [C]: Replacement permits an observation to appear repeatedly.
- C [M]: Resampling estimates a distribution rather than discounting one fixed cash-flow path.

Difficulty rationale: Proposed foundation based on interpret cognitive demand within Level I scope.
Family proposal: pp-ref2027-r009-b-easy (provisional)

## pp-mock1-r009-b-easy-1 v2 (held_out_mock)

Key: B

Bootstrap leverages the empirical sample distribution; Monte Carlo uses an explicit parametric/stochastic model.

- A [C]: Bootstrap is non-parametric and resamples directly from empirical data.
- C [M]: Monte Carlo samples from modeled stochastic processes, not historical resampling without replacement.

Difficulty rationale: Direct comparison of bootstrap vs. Monte Carlo simulation.
Family proposal: mock1-s1-quant-10 (provisional)

## pp-2027-c5-r009-b-hard v1 (routine)

Key: C

Standard i.i.d. bootstrap breaks time-series dependence; block bootstrap is needed to preserve serial correlation when estimating multi-period risk.

- A [C]: Sampling with replacement specifically allows repeated observations.
- B [S]: Positive autocorrelation compounds trends and widens multi-year variance relative to i.i.d. draws.

Difficulty rationale: Integrates time-series autocorrelation with bootstrap i.i.d. independence assumptions.
Family proposal: pp-2027-c5-r009-b-hard (provisional)

## pp-2027-c5-r009-b-medium v1 (routine)

Key: A

Bootstrap treats the observed 36-month sample as the empirical distribution and resamples with replacement to estimate standard errors and confidence intervals.

- B [C]: Describes parametric Monte Carlo rather than empirical bootstrap.
- C [M]: Bootstrap preserves the full empirical sample and draws with replacement.

Difficulty rationale: Applies bootstrap resampling to small-sample non-normal inference.
Family proposal: pp-2027-c5-r009-b-medium (provisional)

## pp-mock1-r009-b-medium-1 v1 (held_out_mock)

Key: A

Bootstrap draws from the empirical distribution with replacement; it does not require a normal-population assumption.

- B [C]: The stated replacement permits repeated selection of the same observation.
- C [M]: The analyst uses the empirical sample rather than a specified parametric population.

Difficulty rationale: Identifies the resampling mechanism rather than comparing long definitions.
Family proposal: closeout-bootstrap-mechanism (provisional)

## pp-2027-c5-r009-c-easy v1 (routine)

Key: B

Monte Carlo handles path-dependent features (like Asian or barrier options) and multi-factor joint distributions where analytical formulas do not exist.

- A [C]: Simple averages do not require Monte Carlo simulation.
- C [M]: Single deterministic cash flows have direct closed-form PV.

Difficulty rationale: Direct recall of Monte Carlo simulation use cases.
Family proposal: pp-2027-c5-r009-c-easy (provisional)

## pp-2027-c5-r009-c-hard v1 (routine)

Key: C

Increasing simulation paths reduces Monte Carlo sampling error, not model specification or calibration error.

- A [C]: With 10,000 paths, Monte Carlo sampling noise is small; systematic 4% gaps point to model/calibration error.
- B [M]: Monte Carlo readily simulates stochastic interest-rate models.

Difficulty rationale: Distinguishes Monte Carlo sampling error from model misspecification risk.
Family proposal: pp-2027-c5-r009-c-hard (provisional)

## pp-ref2027-r009-c-medium v1 (routine)

Key: B

Monte Carlo simulation samples modeled paths; its flexibility does not remove parameter, model or implementation risk.

- A [C]: One deterministic average cannot represent path dependence and dispersion.
- C [M]: Generated outcomes still depend on model assumptions and calibration.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r009-c-medium (provisional)

## pp-ref2027-r010-a-easy v1 (routine)

Key: A

OLS chooses coefficients to minimize squared differences between observed dependent values and fitted values.

- B [C]: That objective defines a different fitting procedure.
- C [M]: The observations of the explanatory variable are not chosen by the regression fit.

Difficulty rationale: Proposed foundation based on interpret cognitive demand within Level I scope.
Family proposal: pp-ref2027-r010-a-easy (provisional)

## pp-mock1-r010-a-easy-1 v2 (held_out_mock)

Key: C

OLS minimizes the sum of squared residuals ei = Yi − Yi_hat.

- A [M]: b1 is the fitted slope, not an observation-level residual.
- B [C]: X_bar is the mean of the explanatory variable.

Difficulty rationale: Direct recall of OLS residual definition.
Family proposal: mock1-s1-quant-11 (provisional)

## pp-2027-c5-r010-a-hard v1 (routine)

Key: B

Slope b1 = Cov(X,Y)/Var(X) = 24/16 = 1.5. Intercept b0 = mean(Y) − b1 × mean(X) = 12 − 1.5(5) = 4.5. Calculation: (12)-((24) ÷ (16)) × (5) = 4.5.

- A [I]: Reported the slope b1 instead of solving for the intercept b0.
- C [F]: Inverted the slope formula as Var(X)/Cov(X,Y).

Difficulty rationale: Computes OLS slope from covariance/variance and solves for the intercept.
Family proposal: pp-2027-c5-r010-a-hard (provisional)

## pp-2027-c5-r010-a-medium v1 (routine)

Key: A

The slope b1 represents the expected change in the dependent variable Y per one-unit change in the independent variable X.

- B [C]: Confuses slope with intercept and reverses X and Y.
- C [M]: Explained variance is R^2 (bounded between 0 and 1), not the regression slope.

Difficulty rationale: Applies slope interpretation in simple linear regression.
Family proposal: pp-2027-c5-r010-a-medium (provisional)

## pp-2027-c5-r010-b-easy v2 (routine)

Key: C

With an intercept, R-squared equals explained sum of squares divided by total sum of squares, equivalently one minus residual sum of squares divided by total sum of squares. It measures explained variation, not causation.

- A [C]: Correlation and R^2 measure linear association, not causation.
- B [M]: R^2 is a dimensionless proportion of explained sum of squares (RSS/SST).

Difficulty rationale: Direct recall of R^2 definition.
Family proposal: pp-2027-c5-r010-b-easy (provisional)

## pp-2027-c5-r010-b-hard v1 (routine)

Key: B

Regression Sum of Squares RSS = 500 − 100 = 400 (df = 1). MSE = SSE / (n − 2) = 100 / 20 = 5.0. F = MSR / MSE = 400 / 5.0 = 80.0. Calculation: (((500)-(100)) ÷ 1) ÷ ((100) ÷ ((22)-2)) = 80.0.

- A [R]: Computed R^2 instead of the ANOVA F-statistic.
- C [F]: Used n instead of (n − 2) for error degrees of freedom.

Difficulty rationale: Derives ANOVA F-statistic from SST, SSE, and sample size degrees of freedom.
Family proposal: pp-2027-c5-r010-b-hard (provisional)

## pp-ref2027-r010-b-medium v1 (routine)

Key: C

Increasing residual spread is evidence of heteroskedasticity, which affects conventional standard-error calculations.

- A [C]: An intercept can be present with nonconstant variance.
- B [M]: Changing residual dispersion does not imply a perfect fit.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r010-b-medium (provisional)

## pp-mock1-r010-b-medium-1 v2 (held_out_mock)

Key: A

Serially correlated errors understate standard errors under positive autocorrelation, inflating t-stats and Type I errors.

- B [C]: Serial correlation does not make R^2 negative; it invalidates naive standard-error inference.
- C [M]: OLS slope remains unbiased if strict exogeneity holds, though inference (SEs/t-stats) is biased.

Difficulty rationale: Diagnoses serial correlation in regression residuals.
Family proposal: mock1-s1-quant-12 (provisional)

## pp-mock1-r010-b-medium-2 v1 (held_out_mock)

Key: B

Changing residual variance indicates heteroskedasticity; coefficient and standard-error implications depend on the estimation assumptions.

- A [C]: The observed changing residual spread is inconsistent with constant variance.
- C [M]: A residual diagnostic does not establish causal identification.

Difficulty rationale: Interprets a residual diagnostic without claiming causality.
Family proposal: closeout-regression-residual-spread (provisional)

## pp-ref2027-r010-c-easy v1 (routine)

Key: B

Insert the specified explanatory value into the intercept-plus-slope model. This point prediction is not a prediction interval. Calculation: (2)+(1.5) × (4) = 8.0.

- A [F]: Omits the intercept.
- C [I]: Multiplies the intercept by x.

Difficulty rationale: Proposed foundation based on calculate cognitive demand within Level I scope.
Family proposal: pp-ref2027-r010-c-easy (provisional)

## pp-2027-c5-r010-c-hard v1 (routine)

Key: A

Prediction-interval variance is s_e^2 [1 + 1/n + (X* − X_bar)^2 / Σ(Xi − X_bar)^2], so extrapolating far from X_bar widens the interval.

- B [C]: Ignores coefficient estimation uncertainty that scales with (X* − X_bar)^2.
- C [S]: Extrapolating away from the sample mean always widens uncertainty.

Difficulty rationale: Integrates prediction-interval geometry and extrapolation uncertainty.
Family proposal: pp-2027-c5-r010-c-hard (provisional)

## pp-2027-c5-r010-c-medium v1 (routine)

Key: C

ln(Revenue) = 2.0 + 0.10(5) = 2.50 → Predicted Revenue = e^2.50 = 12.18. Calculation: exp((2)+(0.1) × (5)) = 12.18.

- A [F]: Reported ln(Revenue) instead of exponentiating to obtain Revenue.
- B [C]: Exponentiated only the intercept without the slope term.

Difficulty rationale: Transforms a log-linear regression prediction back to level units.
Family proposal: pp-2027-c5-r010-c-medium (provisional)

## pp-2027-c5-r010-d-easy v2 (routine)

Key: B

In Ri − Rf = α + β(Rm − Rf) + ε, a positive statistically significant α indicates outperformance relative to CAPM expectations.

- A [M]: Market sensitivity is the slope (beta), not the intercept.
- C [C]: Because returns are in excess of Rf, the CAPM predicts an intercept of zero, not Rf.

Difficulty rationale: Direct recall of CAPM regression intercept interpretation.
Family proposal: pp-2027-c5-r010-d-easy (provisional)

## pp-2027-c5-r010-d-hard v1 (routine)

Key: A

With t = 0.85, we cannot reject H0: α = 0 at 5%, whereas β = 1.25 (t = 6.20) is highly significant.

- B [C]: Treats +0.18% point estimate as significant despite a t-stat of 0.85 (< ~2.0).
- C [M]: R^2 = 0.52 shows 52% of return variance is explained by the market factor.

Difficulty rationale: Integrates regression parameter estimates with t-statistic hypothesis testing in CAPM.
Family proposal: pp-2027-c5-r010-d-hard (provisional)

## pp-ref2027-r010-d-medium v3 (routine)

Key: C

The slope estimates beta: sensitivity of the stock’s excess return to market excess return.

- A [C]: Beta describes market covariance exposure, not total volatility.
- B [M]: The slope alone establishes no persistent alpha.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r010-d-medium (provisional)

## pp-2027-c5-r011-a-easy v3 (routine)

Key: C

Alternative and big data frequently arrive in unstructured text, image, or sensor formats requiring NLP or feature extraction.

- A [C]: Audited financial statements are classic structured numeric data.
- B [M]: Unstructured data are stored digitally as text, audio, or images.

Difficulty rationale: Direct recall of structured vs. unstructured data.
Family proposal: pp-2027-c5-r011-a-easy (provisional)

## pp-2027-c5-r011-a-hard v1 (routine)

Key: B

Complex ML models with many parameters can memorize idiosyncratic noise in-sample (overfitting), requiring cross-validation, regularization, and out-of-sample testing.

- A [C]: 400 features with huge in-sample vs. out-of-sample gap indicates overfitting, not underfitting.
- C [M]: Sharpe collapse across months reflects model generalization failure, not CPU latency.

Difficulty rationale: Diagnoses overfitting in high-dimensional ML investment models.
Family proposal: pp-2027-c5-r011-a-hard (provisional)

## pp-ref2027-r011-a-medium v1 (routine)

Key: A

Labeled target outcomes distinguish supervised learning; out-of-sample validation is still needed to assess prediction quality.

- B [C]: The training outcomes are explicitly labeled.
- C [M]: Prediction remains subject to error and changing data.

Difficulty rationale: Proposed standard based on apply cognitive demand within Level I scope.
Family proposal: pp-ref2027-r011-a-medium (provisional)

## pp-mock1-r011-a-medium-1 v2 (held_out_mock)

Key: A

Unsupervised learning discovers hidden groupings or structure (e.g., clustering, PCA) in unlabeled data.

- B [M]: Supervised learning requires labeled target outcomes (Y).
- C [C]: Clustering unlabeled features is unsupervised learning, not sequential reinforcement learning.

Difficulty rationale: Applies supervised vs. unsupervised ML classification.
Family proposal: mock1-s1-quant-13 (provisional)

## pp-2027-r004-a-easy v1 (routine)

Key: B

The present value of an ordinary level perpetuity is C / r = $4.50 / 0.075 = $60.00.

- A [T]: Discounts the perpetuity value one extra period: ($4.50 / 0.075) / 1.075 = $55.81.
- C [T]: Treats the ordinary perpetuity as a perpetuity due: ($4.50 / 0.075) * 1.075 = $64.50.

Difficulty rationale: Carried-forward pilot/slice rationale (foundation).
Family proposal: pp-2027-r004-a-easy (provisional)

## pp-2027-r004-a-medium v1 (routine)

Key: B

With 4 semiannual periods, a $30 semiannual coupon, and a 4.0% semiannual discount rate, PV = $30 x [1 - (1.04)^(-4)] / 0.04 + $1,000 / (1.04)^4 = $108.90 + $854.80 = $963.70.

- A [T]: Uses the $30 semiannual coupon with the 8.0% annual rate over 4 periods: $834.39.
- C [T]: Uses annual discounting (N = 2, PMT = $60, r = 8.0%) instead of semiannual compounding: $964.33.

Difficulty rationale: Carried-forward pilot/slice rationale (standard).
Family proposal: pp-2027-r004-a-medium (provisional)

## pp-2027-r004-a-hard v1 (routine)

Key: B

The growing perpetuity formula applied to the Year 4 cash flow gives the value at t = 3: $120,000 / (0.085 - 0.025) = $2,000,000. Discounting back 3 years to t = 0 gives $2,000,000 / (1.085)^3 = $1,565,816.

- A [T]: Discounts the $2,000,000 perpetuity value 4 years instead of 3 years: $2,000,000 / 1.085^4 = $1,443,149.
- C [T]: Discounts the $2,000,000 perpetuity value only 2 years: $2,000,000 / 1.085^2 = $1,698,911.

Difficulty rationale: Carried-forward pilot/slice rationale (difficult).
Family proposal: pp-2027-r004-a-hard (provisional)

## pp-2027-r004-b-easy v1 (routine)

Key: B

The implied annual compound return is (FV / PV)^(1/T) - 1 = ($1,000 / $762.90)^(1/4) - 1 = 7.00%.

- A [F]: Divides total discount by face value and by 4 years: (1000 - 762.90) / 1000 / 4 = 5.93%.
- C [F]: Computes simple arithmetic annual return without compounding: ((1000 / 762.90) - 1) / 4 = 7.77%.

Difficulty rationale: Carried-forward pilot/slice rationale (foundation).
Family proposal: pp-2027-r004-b-easy (provisional)

## pp-2027-r004-b-medium v1 (routine)

Key: C

Under the constant-growth model, implied required return is r = (D1 / P0) + g. When P0 rises while D1 and g are unchanged, the forward dividend yield (D1 / P0) declines, reducing r.

- A [S]: Assumes higher stock price implies higher required return, reversing the inverse price-yield relationship.
- B [I]: Focuses only on constant growth g and ignores the dividend yield component D1 / P0.

Difficulty rationale: Carried-forward pilot/slice rationale (standard).
Family proposal: pp-2027-r004-b-medium (provisional)

## pp-2027-r004-b-hard v3 (routine)

Key: C

Sustainable dividend growth is g = retention ratio x ROE = 0.60 x 10.0% = 6.00%. Expected next dividend is D1 = $2.00 x 1.06 = $2.12. Implied required return is r = (D1 / P0) + g = ($2.12 / $53.00) + 6.00% = 4.00% + 6.00% = 10.00%.

- A [I]: Reports only the forward dividend yield D1 / P0 = $2.12 / $53.00 = 4.00% and omits growth g.
- B [T]: Uses D0 ($2.00) instead of D1 ($2.12): ($2.00 / $53.00) + 6.00% = 9.77%.

Difficulty rationale: Carried-forward pilot/slice rationale (difficult).
Family proposal: pp-2027-r004-b-hard (provisional)

## pp-2027-r004-c-easy v2 (routine)

Key: A

Because both portfolios produce identical future cash flows in every state and trading is frictionless, buying the cheaper portfolio (X) and shorting the more expensive portfolio (Y) cancels all future cash flows and captures the price difference risk-free today.

- B [C]: Claims identical cash flows can have different systematic risk.
- C [S]: Reverses the return direction: paying more for Y lowers its return relative to X.

Difficulty rationale: Carried-forward pilot/slice rationale (foundation).
Family proposal: pp-2027-r004-c-easy (provisional)

## pp-2027-r004-c-medium v2 (routine)

Key: C

No-arbitrage requires equal 2-year terminal wealth: (1.06)^2 = (1.04)(1 + f1,1). Thus f1,1 = (1.06^2 / 1.04) - 1 = (1.1236 / 1.04) - 1 = 8.04%.

- A [F]: Omits compounding over 2 years, computing (1.06 / 1.04) - 1 = 1.92%.
- B [F]: Takes the simple average of the two yields: (4.00% + 6.00%) / 2 = 5.00%.

Difficulty rationale: Carried-forward pilot/slice rationale (standard).
Family proposal: pp-2027-r004-c-medium (provisional)

## pp-2027-r004-c-hard v2 (routine)

Key: B

Call payoffs are cu = max(0, $65 - $52) = $13 and cd = $0. The hedge ratio is delta = ($13 - $0) / ($65 - $40) = 0.52 shares. To match the $0 down-state payoff, borrow $20.80 / 1.04 = $20.00 today. Replicating cost = 0.52 x $50.00 - $20.00 = $6.00.

- A [T]: Fails to discount the down-state borrowing at the risk-free rate: 0.52 * ($50 - $40) = $5.20.
- C [F]: Applies an unsupported equal-weight (50/50) average of the two payoffs discounted at the risk-free rate: (0.5 * $13 + 0.5 * $0) / 1.04 = $6.25, ignoring replicating hedge weights.

Difficulty rationale: Carried-forward pilot/slice rationale (difficult).
Family proposal: pp-2027-r004-c-hard (provisional)
