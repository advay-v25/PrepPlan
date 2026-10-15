-- Onboarding rebuild — data layer.
--
-- Onboarding currently writes a JSON blob to onboarding_sessions.answers and
-- nothing else. As a result availability_rules has no writer anywhere in the
-- codebase, and profiles.timezone / diagnostic_day / reminder_at are never
-- written at all — so every user silently gets Asia/Kolkata, Sunday, 18:00.
-- These three columns define every user's study week.
--
-- This migration makes the tables onboarding must write to coherent enough to
-- write to.

-- 1. One weekday convention ---------------------------------------------------
-- Three conventions were in use in tables a single onboarding screen has to
-- populate:
--   availability_rules.weekday      ISO 1-7, Monday = 1
--   calendar_commitments.weekdays   0-6, Sunday = 0 (no constraint at all)
--   profiles.diagnostic_day         0-6, Sunday = 0
-- Standardise on 0-6 Sunday-first: it matches Date#getDay, src/lib/planning/
-- studyWeek.ts, and the newer tables. availability_rules is empty, so the
-- conversion is free — but it is written anyway so a populated database
-- migrates correctly.
alter table public.availability_rules drop constraint if exists availability_rules_weekday_check;
update public.availability_rules set weekday = weekday % 7;
alter table public.availability_rules add constraint availability_rules_weekday_check
  check (weekday between 0 and 6);

-- calendar_commitments.weekdays had no constraint, so nothing stopped an ISO
-- 7 (Sunday) being stored where 0 was meant.
alter table public.calendar_commitments drop constraint if exists calendar_commitments_weekdays_check;
alter table public.calendar_commitments add constraint calendar_commitments_weekdays_check
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]);

-- 2. Availability needs real times --------------------------------------------
-- A day-part ("Monday evening") can size a week's capacity but can never place
-- a task at a time. Onboarding now captures the part first and confirms real
-- windows second, so the rows need somewhere to put them.
alter table public.availability_rules add column if not exists start_time time;
alter table public.availability_rules add column if not exists end_time time;
alter table public.availability_rules add column if not exists updated_at timestamptz not null default now();

alter table public.availability_rules drop constraint if exists availability_rules_window_check;
alter table public.availability_rules add constraint availability_rules_window_check
  check (start_time is null or end_time is null or end_time > start_time);

-- 3. Four preparation routes --------------------------------------------------
-- The old check allowed 'coaching' | 'self-study' | 'both', while
-- roadmapService.ts tested for 'hybrid' — a value the constraint would have
-- rejected. The four routes distinguish a recorded course a student paces
-- themselves from live classes where a teacher decides what is covered when.
-- Only the latter may anchor the roadmap's sequence.
update public.profiles set prep_mode = case prep_mode
  when 'self-study' then 'self_study'
  when 'coaching'   then 'instructor_led'
  when 'both'       then 'hybrid'
  else prep_mode
end
where prep_mode is not null;

alter table public.profiles drop constraint if exists profiles_prep_mode_check;
alter table public.profiles add constraint profiles_prep_mode_check
  check (prep_mode is null or prep_mode in ('self_study', 'self_paced_course', 'instructor_led', 'hybrid'));

-- study_mode exists in the deployed database but in no migration, so a fresh
-- deploy would break loadRoadmapInputs' select. prep_mode is the single source
-- of truth; this keeps the column present but unused until the reference is
-- removed from the code.
alter table public.profiles add column if not exists study_mode text;

-- 4. Onboarding progress ------------------------------------------------------
-- Six screens need six steps. The old check topped out at 5, and nothing ever
-- wrote the column anyway.
alter table public.profiles drop constraint if exists profiles_onboarding_step_check;
alter table public.profiles add constraint profiles_onboarding_step_check
  check (onboarding_step between 0 and 6);

-- 5. Where the student says their classes are ---------------------------------
-- calendar_commitments.source already reserves 'onboarding'; no change needed.
-- Recording which screen produced a row makes it possible to re-run a screen
-- without duplicating what it wrote last time.
create index if not exists calendar_commitments_source_idx
  on public.calendar_commitments(user_id, source, kind);

notify pgrst, 'reload schema';
