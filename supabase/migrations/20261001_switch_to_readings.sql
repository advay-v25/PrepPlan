-- Switch the planning spine from the 63 paraphrased modules to the 102 readings
-- of the 2027 curriculum.
--
-- learning_modules stays the table the engine keys off; its ACTIVE rows become
-- the readings (id r001..r102). The old 63 rows are kept (is_active = false):
-- nothing is deleted, so old plan_blocks, evidence and audit rows keep their
-- foreign keys, and rolling back is flipping the flags. Effort is the reading's
-- page-derived effort_units (scaled to the same ~189 total as before).
--
-- Student self-reported coverage is carried over ADDITIVELY (insert only):
--   * readings with a direct legacy module take that module's state;
--   * other readings take the first old module of their topic (topic-level
--     self-report was expanded to every module of the topic);
--   * 'verified' is never copied onto a reading that no paper has verified.

insert into public.learning_modules (id, topic_id, name, los_count, effort_units, difficulty_weight, topic_ref, effort_band, sequence_hint, summary, is_active)
select r.id, r.topic_id, r.title,
       greatest(1, (select count(*) from public.reading_los l where l.reading_id = r.id))::smallint,
       r.effort_units, 3, r.topic_id, r.effort_band, r.sequence::smallint, r.summary, true
from public.curriculum_readings r
on conflict (id) do update set
  name = excluded.name, los_count = excluded.los_count, effort_units = excluded.effort_units,
  topic_ref = excluded.topic_ref, effort_band = excluded.effort_band, sequence_hint = excluded.sequence_hint,
  summary = excluded.summary, is_active = true;

-- Carry self-reported coverage across before the old modules go inactive.
with mapped(reading_id, legacy_id) as (
  values ('r027', 'fsa-intro'), ('r028', 'fsa-income'), ('r029', 'fsa-balance')
),
topic_first as (
  select distinct on (m.topic_ref) m.topic_ref, m.id as legacy_id
  from public.learning_modules m
  where m.id not in (select id from public.curriculum_readings)
    and m.id not in ('fsa-intro', 'fsa-income', 'fsa-balance')
  order by m.topic_ref, m.sequence_hint
)
insert into public.user_module_state (user_id, lm_id, coverage_state, source, last_verified_at, planned_hours_consumed, verification_passes)
select s.user_id, r.id,
       case when mp.legacy_id is null and s.coverage_state = 'verified' then 'studied' else s.coverage_state end,
       case when mp.legacy_id is null then 'self_report' else s.source end,
       case when mp.legacy_id is null then null else s.last_verified_at end,
       0,
       case when mp.legacy_id is null then 0 else s.verification_passes end
from public.curriculum_readings r
left join mapped mp on mp.reading_id = r.id
left join topic_first tf on tf.topic_ref = r.topic_id
join public.user_module_state s on s.lm_id = coalesce(mp.legacy_id, tf.legacy_id)
on conflict (user_id, lm_id) do nothing;

update public.learning_modules set is_active = false where id not in (select id from public.curriculum_readings);

-- Prerequisites: reading order within a subject, plus the five cross-subject links
-- the old graph had, re-pointed at the readings that carry those ideas.
insert into public.lm_edges (from_lm, to_lm, kind)
select a.id, b.id, 'prerequisite'
from public.curriculum_readings a
join public.curriculum_readings b on b.topic_id = a.topic_id and b.sequence = a.sequence + 1
on conflict do nothing;

insert into public.lm_edges (from_lm, to_lm, kind) values
  ('r004', 'r056', 'prerequisite'), -- time value of money -> bond valuation
  ('r004', 'r044', 'prerequisite'), -- time value of money -> DCF equity models
  ('r004', 'r024', 'prerequisite'), -- time value of money -> capital investments
  ('r005', 'r087', 'prerequisite'), -- statistics -> portfolio risk and return
  ('r037', 'r047', 'prerequisite')  -- ratio analysis -> industry and competitive analysis
on conflict do nothing;

-- Test concepts and items now belong to the reading of the outcome they evidence.
update public.curriculum_concepts c set lm_id = l.reading_id
from public.concept_outcome_map m join public.reading_los l on l.id = m.outcome_id
where m.concept_id = c.id;

update public.assessment_items i set lm_id = c.lm_id
from public.curriculum_concepts c
where i.concept_id = c.id and c.lm_id in (select id from public.curriculum_readings);
