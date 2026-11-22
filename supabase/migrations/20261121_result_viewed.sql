-- A scored result's follow-up has a completion condition: the student has opened the result, and no repair from it still needs a decision.
-- Home stops recommending the same result once that is true. Additive; nothing reads it for scoring or evidence.
alter table public.assessment_attempts add column if not exists result_viewed_at timestamptz;
