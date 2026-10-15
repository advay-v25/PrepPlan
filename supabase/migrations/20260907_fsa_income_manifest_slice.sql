-- Curriculum manifest slice for fsa-income (spec §2.2, §5.1)
--
-- curriculum_concepts previously hung off a manifest with free-text topic /
-- reading / module strings and carried no statement of what a concept covers.
-- The generator cannot be held to a scope that is not written down, and the
-- verifier's scope gate had no ground truth to check against.

-- 1. Real link to the planning layer -----------------------------------------
alter table public.curriculum_concepts add column if not exists lm_id text references public.learning_modules(id);
update public.curriculum_concepts c
set lm_id = m.id
from public.learning_modules m
where c.lm_id is null and c.module = m.id;

-- 2. The fields that make a concept generatable against -----------------------
-- scope_notes: what the concept covers, in the terms an item may use.
-- excluded_or_superseded: the guardrail that stops drift into Level II or into
--   treatments the current curriculum no longer examines (§2.2).
-- verification_status: a concept must be verified before it can back a
--   released item (§5.1).
alter table public.curriculum_concepts add column if not exists scope_notes text;
alter table public.curriculum_concepts add column if not exists excluded_or_superseded text;
alter table public.curriculum_concepts add column if not exists verification_status text not null default 'pending'
  check (verification_status in ('pending', 'drafted', 'verified'));

create index if not exists curriculum_concepts_lm_idx on public.curriculum_concepts (lm_id, verification_status);

-- 3. The slice ----------------------------------------------------------------
-- Eight concepts covering Analyzing the Income Statement. Scope is drafted from
-- general CFA Level I coverage; it is authoring-time guidance for the generator
-- and the verifier, never shown to a learner as a citation.
-- verification_status stays 'drafted' until signed off by hand.

insert into public.curriculum_concepts
  (id, manifest_id, topic, reading, module, lm_id, los, name, importance, scope_notes, excluded_or_superseded, verification_status)
values
  ('22222222-2222-2222-2222-222222222227', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS c',
   'Expense Recognition and Inventory Cost Flow', 'core',
   'Matching principle. FIFO and weighted average cost cost-flow assumptions and their effect on COGS, gross profit, and ending inventory in rising and falling price environments. Periodic versus perpetual systems. Inventory write-down to net realisable value under IFRS and reversal of that write-down.',
   'LIFO is a US GAAP treatment excluded from IFRS; do not test LIFO reserve conversions here. Exclude Level II inventory analysis of ratio adjustment across firms.',
   'drafted'),

  ('22222222-2222-2222-2222-222222222228', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS d',
   'Depreciation and Amortisation Methods', 'core',
   'Straight-line, declining balance (including double declining), and units-of-production depreciation. Effect of useful life, salvage value, and method choice on reported income in early versus late years. Amortisation of finite-lived intangibles. Partial-year conventions.',
   'Exclude component depreciation under IFRS revaluation model and Level II analysis of depreciation as an earnings-quality signal.',
   'drafted'),

  ('22222222-2222-2222-2222-222222222229', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS g',
   'Basic EPS and Weighted Average Shares', 'core',
   'Basic EPS as income available to common shareholders divided by the weighted average number of ordinary shares outstanding. Deduction of preferred dividends. Time-weighting of shares issued or repurchased mid-period. Retroactive treatment of stock splits and stock dividends for all periods presented.',
   'Diluted EPS is covered by its own concept; do not test convertibles or options here. Exclude two-class method and participating securities.',
   'drafted'),

  ('22222222-2222-2222-2222-22222222222a', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS e',
   'Non-Recurring Items and Discontinued Operations', 'supporting',
   'Presentation and analytical treatment of discontinued operations, unusual or infrequent items, and changes in accounting policy versus accounting estimate. Which items are reported net of tax and below income from continuing operations, and why an analyst separates them when forecasting.',
   'Exclude extraordinary items, which are no longer a separate US GAAP category. Exclude Level II normalised-earnings modelling.',
   'drafted'),

  ('22222222-2222-2222-2222-22222222222b', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS f',
   'Gross Profit, Operating Profit and Margin Analysis', 'core',
   'Construction of the income statement from revenue through gross profit, operating profit, and net income. Calculation and interpretation of gross profit margin, operating profit margin, and net profit margin. Effect of a change in cost structure, pricing, or volume on each margin.',
   'Exclude segment-level margin analysis and DuPont decomposition, which belong to the ratio-analysis module.',
   'drafted'),

  ('22222222-2222-2222-2222-22222222222c', '11111111-1111-1111-1111-111111111111', 'FSA',
   'Analyzing Income Statements', 'fsa-income', 'fsa-income', 'LOS i',
   'Common-Size Income Statement Analysis', 'supporting',
   'Vertical common-size analysis expressing each line item as a percentage of revenue. Use in comparing a company across periods and against peers of different size. Interpretation of a shift in a common-size line as a change in cost structure rather than in scale.',
   'Exclude horizontal (trend) common-size analysis using a base year, and exclude cross-statement common-size work on the balance sheet.',
   'drafted')
on conflict (id) do update set
  scope_notes = excluded.scope_notes,
  excluded_or_superseded = excluded.excluded_or_superseded,
  lm_id = excluded.lm_id;

-- 4. Scope for the two fsa-income concepts that were already seeded ------------
update public.curriculum_concepts set
  scope_notes = 'The five-step revenue recognition model: identify the contract, identify the performance obligations, determine the transaction price, allocate that price to the obligations, and recognise revenue as each obligation is satisfied. Recognition over time versus at a point in time. Effect of the timing of recognition on reported revenue relative to cash collection.',
  excluded_or_superseded = 'Exclude principal-versus-agent gross/net presentation and long-term contract percentage-of-completion mechanics beyond the general over-time principle.',
  verification_status = 'drafted'
where id = '22222222-2222-2222-2222-222222222223';

update public.curriculum_concepts set
  scope_notes = 'Diluted EPS using the if-converted method for convertible debt and convertible preferred stock, and the treasury stock method for options and warrants. Identification of antidilutive securities, which are excluded from the diluted calculation. The tax effect of assumed conversion of convertible debt.',
  excluded_or_superseded = 'Exclude contingently issuable shares and the two-class method. Exclude Level II dilution modelling of share-based compensation.',
  verification_status = 'drafted'
where id = '22222222-2222-2222-2222-222222222224';

notify pgrst, 'reload schema';
