-- Two additions, for the two halves of this feature.
--
-- 1. A variable-pattern student's week boundary is derived from classes, like a fixed-pattern student's, but
--    there is no recurring weekday to derive it from — only whichever next class they last told us about. A
--    one-off class commitment needs to say whether it is THAT (so the week boundary should anchor to it) or
--    just an extra session (a doubt-clearing class, a makeup) that blocks time but is not part of the pattern.
alter table public.calendar_commitments add column if not exists defines_cycle boolean not null default false;
comment on column public.calendar_commitments.defines_cycle is
  'True only for a one-off class added through "Add next class" for a variable schedule. It anchors the week''s paper day to the day before it. An ad-hoc class (e.g. a doubt session) added through the ordinary Calendar "Add commitment" control leaves this false: it blocks time and can still be logged for coverage, but does not move the week boundary.';

-- 2. Whether a class-led or hybrid student's classes have finished. ends_on on the recurring class rows gives
--    this automatically when a student provided it (optional at setup), but many will not have, and a
--    variable pattern has no "ends_on" concept at all — there is no recurring row to carry it. This is the
--    explicit fallback: a student says "my classes are done" once, and the roadmap moves them into the same
--    consolidation/revision/final structure a self-study student reaches after their first pass.
alter table public.profiles add column if not exists classes_completed_at date;
comment on column public.profiles.classes_completed_at is
  'Set when a class-led or hybrid student confirms their classes have finished (manual fallback for when no class commitment carries an end date). Null means classes are still assumed ongoing.';
