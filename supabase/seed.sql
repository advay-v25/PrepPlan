-- Phase 0 Foundation Seed Data
-- Provides the verified FSA slice to validate the architecture without fabricating unreviewed content.

-- 1. Learning Modules
insert into public.learning_modules (id, topic_id, name, los_count, effort_units, difficulty_weight)
values
  ('fsa-intro', 'FSA', 'Introduction to Financial Statement Analysis', 3, 2.0, 1.0),
  ('fsa-income', 'FSA', 'Analyzing the Income Statement', 4, 3.5, 1.2),
  ('fsa-balance', 'FSA', 'Analyzing the Balance Sheet', 4, 3.5, 1.2)
on conflict (id) do nothing;

-- 2. Assessment Items (Traceable, reviewed items with verification intent)
insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status)
values
  (
    'q-fsa-intro-1',
    'fsa-intro',
    'Understand the roles of financial reporting and financial statement analysis.',
    'Distinguish between standard reporting and the analytical process.',
    1.0,
    'Which of the following best describes the primary role of financial statement analysis?',
    '["To assure that financial statements are free from material errors.", "To use financial reports to evaluate a company’s past performance and future prospects.", "To prepare financial reports according to regulatory standards."]'::jsonb,
    '{"0": "Incorrect. This is the role of an independent auditor.", "1": "Correct. Analysis uses reports to form economic decisions.", "2": "Incorrect. This is the role of the company’s management and accountants."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 1 LOS a',
    'reviewed'
  ),
  (
    'q-fsa-intro-2',
    'fsa-intro',
    'Identify the components of a complete set of financial statements.',
    'Recall required statements under IFRS/US GAAP.',
    1.0,
    'Which of the following is NOT a required component of a complete set of financial statements under IFRS?',
    '["Statement of comprehensive income", "Management commentary", "Statement of cash flows"]'::jsonb,
    '{"0": "Incorrect. This is required.", "1": "Correct. Management commentary (MD&A) is recommended but not strictly required as part of the audited statements under IFRS.", "2": "Incorrect. This is required."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 1 LOS b',
    'reviewed'
  ),
  (
    'q-fsa-income-1',
    'fsa-income',
    'Understand revenue recognition principles.',
    'Apply the 5-step revenue recognition model.',
    1.5,
    'Under the core principle of converged accounting standards, revenue is recognized when:',
    '["Cash is collected from the customer.", "A contract is signed by both parties.", "Control of the promised goods or services transfers to the customer."]'::jsonb,
    '{"0": "Incorrect. Cash collection relates to cash-basis accounting.", "1": "Incorrect. Contract signing is step 1, but recognition happens upon transfer of control.", "2": "Correct. The core principle focuses on the transfer of control."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 2 LOS b',
    'reviewed'
  ),
  (
    'q-fsa-income-2',
    'fsa-income',
    'Calculate and interpret basic and diluted EPS.',
    'Distinguish anti-dilutive securities.',
    2.0,
    'When calculating diluted EPS, a convertible bond is considered anti-dilutive if:',
    '["Its conversion increases basic EPS.", "Its conversion decreases basic EPS.", "It was issued during the current year."]'::jsonb,
    '{"0": "Correct. Anti-dilutive securities increase EPS when converted and are excluded from diluted EPS calculations.", "1": "Incorrect. This defines a dilutive security.", "2": "Incorrect. Issue date affects weighting but not the anti-dilutive definition."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 2 LOS h',
    'reviewed'
  ),
  (
    'q-fsa-balance-1',
    'fsa-balance',
    'Analyze components of current assets and liabilities.',
    'Evaluate liquidity using current and quick ratios.',
    1.5,
    'An increase in inventory, all else being equal, will:',
    '["Increase the quick ratio.", "Decrease the quick ratio.", "Have no effect on the quick ratio."]'::jsonb,
    '{"0": "Incorrect.", "1": "Incorrect.", "2": "Correct. The quick ratio excludes inventory from its numerator."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 3 LOS c',
    'reviewed'
  ),
  (
    'q-fsa-balance-2',
    'fsa-balance',
    'Understand asset impairment.',
    'Apply the impairment test for property, plant, and equipment under IFRS.',
    2.0,
    'Under IFRS, an impairment loss is recognized when the carrying amount of an asset exceeds its:',
    '["Recoverable amount.", "Fair value.", "Value in use."]'::jsonb,
    '{"0": "Correct. Impairment occurs when carrying amount exceeds recoverable amount (higher of fair value less costs to sell and value in use).", "1": "Incorrect. Fair value is only one component of recoverable amount.", "2": "Incorrect. Value in use is only one component of recoverable amount."}'::jsonb,
    'Original item mapped to 2027 CFAI FSA Module 3 LOS g',
    'reviewed'
  )
on conflict (id) do nothing;

-- Phase 3: Diagnostic Engine Manifest Seed
-- 1. Curriculum Manifest
insert into public.curriculum_manifests (id, year, level, version, is_active, capabilities)
values
  ('11111111-1111-1111-1111-111111111111', 2027, 'CFA Level I', 'v1.0', true, '{"blueprint_available": true, "reviewed_bank_available": true, "live_generation_available": false, "deterministic_numerical_verification_available": true, "explanation_grading_available": false, "source_guidance_available": true}')
on conflict (year, level, version) do nothing;

-- 2. Curriculum Concepts (FSA Subset for Diagnostic Slice)
insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance)
values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 1', 'fsa-intro', 'LOS a', 'Roles of Financial Reporting and Analysis', 'core'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 1', 'fsa-intro', 'LOS b', 'Required Financial Statements', 'supporting'),
  ('22222222-2222-2222-2222-222222222223', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 2', 'fsa-income', 'LOS b', 'Revenue Recognition 5-Step Model', 'core'),
  ('22222222-2222-2222-2222-222222222224', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 2', 'fsa-income', 'LOS h', 'Diluted EPS and Anti-Dilutive Securities', 'core'),
  ('22222222-2222-2222-2222-222222222225', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 3', 'fsa-balance', 'LOS c', 'Current Assets and Quick Ratio', 'supporting'),
  ('22222222-2222-2222-2222-222222222226', '11111111-1111-1111-1111-111111111111', 'FSA', 'Reading 3', 'fsa-balance', 'LOS g', 'Asset Impairment under IFRS', 'core')
on conflict (id) do nothing;

-- 3. Link Assessment Items to Concepts
-- This would be done via an UPDATE in a real scenario, but since the tables were seeded, we update the rows.
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222221' where id = 'q-fsa-intro-1';
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222222' where id = 'q-fsa-intro-2';
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222223' where id = 'q-fsa-income-1';
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222224' where id = 'q-fsa-income-2';
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222225' where id = 'q-fsa-balance-1';
update public.assessment_items set concept_id = '22222222-2222-2222-2222-222222222226' where id = 'q-fsa-balance-2';
