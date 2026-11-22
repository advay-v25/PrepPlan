-- Mock checkpoint: one canonical record, three additions. Everything here is student-reported planning context, never evidence.
--   1. Optional timing on the checkpoint that already lives on the profile (mock_date / mock_kind): a start time, an expected
--      duration and a plain label such as "Coaching mock". A date alone stays valid; nothing is invented when time is unknown.
--   2. cycle_assessment_choices: the student's reviewable choice for the week that contains the mock (use the mock as that
--      week's assessment, keep the weekly paper as well, or decide later). Keyed by the week's first day so it exists before the
--      week's cycle does. No row = not decided yet.
--   3. mock_outcomes: what happened to an external mock (taken / postponed / not taken) with an optional self-reported result.
--      Never question responses, concept evidence, readiness or repair threads. One row per planned date, so a retry replays.
-- Reads for the student (own rows only); every write goes through service-role routes. The weekly change token covers all of it,
-- so moving or cancelling a mock makes an unaccepted weekly draft stale.

alter table public.profiles
  add column if not exists mock_start_time time,
  add column if not exists mock_duration_minutes smallint,
  add column if not exists mock_label text;
alter table public.profiles drop constraint if exists profiles_mock_timing_check;
alter table public.profiles add constraint profiles_mock_timing_check check (
  (mock_date is not null or (mock_start_time is null and mock_duration_minutes is null and mock_label is null))
  and (mock_duration_minutes is null or mock_duration_minutes between 15 and 480)
  and (mock_label is null or char_length(mock_label) between 1 and 80)
);

-- Clearing the checkpoint (from onboarding, Settings or Calendar) clears its timing in the same write.
create or replace function public.profiles_clear_mock_timing() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.mock_date is null then
    new.mock_start_time := null; new.mock_duration_minutes := null; new.mock_label := null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_clear_mock_timing on public.profiles;
create trigger profiles_clear_mock_timing before insert or update of mock_date on public.profiles
  for each row execute function public.profiles_clear_mock_timing();

create table if not exists public.cycle_assessment_choices (
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null,
  choice text not null check (choice in ('use_mock', 'keep_paper', 'later')),
  decided_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
create table if not exists public.mock_outcomes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  planned_date date not null,
  kind text not null check (kind in ('provider_mock', 'school_checkpoint', 'other')),
  label text check (label is null or char_length(label) between 1 and 80),
  outcome text not null check (outcome in ('taken', 'postponed', 'not_taken')),
  -- Free text the student typed ("62%", "Level II pass band"). Never parsed, never used as a score.
  reported_result text check (reported_result is null or char_length(reported_result) between 1 and 80),
  notes text check (notes is null or char_length(notes) <= 500),
  recorded_at timestamptz not null default now(),
  unique (user_id, planned_date)
);
alter table public.cycle_assessment_choices enable row level security;
alter table public.mock_outcomes enable row level security;
drop policy if exists "Users read their own assessment choices" on public.cycle_assessment_choices;
create policy "Users read their own assessment choices" on public.cycle_assessment_choices for select using (auth.uid() = user_id);
drop policy if exists "Users read their own mock outcomes" on public.mock_outcomes;
create policy "Users read their own mock outcomes" on public.mock_outcomes for select using (auth.uid() = user_id);
revoke all on public.cycle_assessment_choices, public.mock_outcomes from public, anon, authenticated;
grant select on public.cycle_assessment_choices, public.mock_outcomes to authenticated;

create or replace function public.weekly_source_version(p_user uuid, p_cycle uuid) returns text
language sql stable security definer set search_path = '' as $$
  select md5(concat_ws('|',
    (select coalesce(string_agg(concat_ws(':', id, revision, execution, coalesce(cancelled_at::text, ''), coalesce(local_date::text, ''), coalesce(duration_minutes::text, '')), ',' order by id), '')
       from public.plan_blocks where user_id = p_user and cycle_id = p_cycle),
    (select coalesce(string_agg(c.block_id || ':' || c.outcome_id, ',' order by c.block_id, c.outcome_id), '')
       from public.block_scope_confirmations c where c.user_id = p_user
        and c.block_id in (select id from public.plan_blocks where user_id = p_user and cycle_id = p_cycle)),
    (select coalesce(string_agg(a.id::text || ':' || a.status, ',' order by a.id::text), '')
       from public.assessment_attempts a where a.user_id = p_user and a.cycle_id = p_cycle),
    (select coalesce(string_agg(to_jsonb(k)::text, ',' order by k.id::text), '')
       from public.calendar_commitments k where k.user_id = p_user and k.status = 'active'),
    (select coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id::text), '')
       from public.commitment_exceptions x where x.user_id = p_user),
    (select coalesce(string_agg(to_jsonb(e)::text, ',' order by e.id::text), '')
       from public.exam_attempts e where e.user_id = p_user and e.status = 'active'),
    (select p.classes_completed_at::text from public.profiles p where p.id = p_user),
    (select coalesce(string_agg(to_jsonb(w)::text, ',' order by w.id::text), '')
       from public.availability_windows w where w.user_id = p_user and w.status = 'active'),
    (select coalesce(string_agg(to_jsonb(r)::text, ',' order by r.id::text), '')
       from public.repair_threads r where r.user_id = p_user and r.status in ('open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck')),
    (select coalesce(string_agg(m.lm_id || ':' || m.coverage_state, ',' order by m.lm_id), '')
       from public.user_module_state m where m.user_id = p_user),
    (select coalesce(string_agg(u.topic_id || ':' || u.level || ':' || array_to_string(u.lm_ids, '+'), ',' order by u.topic_id), '')
       from public.user_entry_uncertainty u where u.user_id = p_user),
    (select coalesce(string_agg(c.week_start::text || ':' || c.choice, ',' order by c.week_start), '')
       from public.cycle_assessment_choices c where c.user_id = p_user),
    (select coalesce(string_agg(o.planned_date::text || ':' || o.outcome, ',' order by o.planned_date), '')
       from public.mock_outcomes o where o.user_id = p_user),
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone', j->>'stage', j->>'mock_date', j->>'mock_kind',
                      j->>'mock_start_time', j->>'mock_duration_minutes', j->>'mock_label')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;
