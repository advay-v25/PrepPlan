-- Adaptive entry context. Three additions, all student-reported planning context (never evidence):
--   1. An optional upcoming mock/checkpoint on the profile (a date and a plain type). It is not a second exam date.
--   2. Reported uncertainty per topic, independent of coverage. A row with level 'none' is an explicit "nothing shaky"; no row is "not answered".
--   3. onboarding_replace_position also saves reading-level refinements, uncertainty and the mock, in the same transaction as coverage.
-- Coverage itself stays where it already lives (user_module_state, source 'self_report'); this adds no parallel store.
-- The weekly change token also covers all of it, so editing any of it makes an unaccepted weekly draft stale.

alter table public.profiles
  add column if not exists mock_date date,
  add column if not exists mock_kind text,
  add column if not exists entry_reported_at timestamptz;
alter table public.profiles drop constraint if exists profiles_mock_check;
alter table public.profiles add constraint profiles_mock_check
  check ((mock_date is null and mock_kind is null) or (mock_date is not null and mock_kind in ('provider_mock', 'school_checkpoint', 'other')));

create table if not exists public.user_entry_uncertainty (
  user_id uuid not null references auth.users on delete cascade,
  topic_id text not null,
  level text not null check (level in ('none', 'few', 'several', 'most')),
  -- Optional narrowing to specific readings. Empty means the whole topic at that level.
  lm_ids text[] not null default '{}',
  reported_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);
alter table public.user_entry_uncertainty enable row level security;
drop policy if exists "Users read their own entry uncertainty" on public.user_entry_uncertainty;
create policy "Users read their own entry uncertainty" on public.user_entry_uncertainty for select using (auth.uid() = user_id);
revoke all on public.user_entry_uncertainty from public, anon, authenticated;
grant select on public.user_entry_uncertainty to authenticated;

-- Replaces the 3-argument function. A new migration may do this; the applied one stays as it was.
-- Argument meaning: NULL = leave unchanged, so a client that does not know about a field cannot erase it.
--   p_readings    [{lm_id, state: not_started|partly|covered}] refines the topic-level expansion for single readings
--   p_uncertainty [{topic_id, level, lm_ids}] replaces ALL uncertainty (an empty array clears it)
--   p_mock_set    true when p_mock is meant (p_mock NULL then clears it); p_mock is {date, kind}
drop function if exists public.onboarding_replace_position(uuid, text, jsonb);
create function public.onboarding_replace_position(
  p_user uuid, p_stage text, p_exposure jsonb,
  p_readings jsonb default null, p_uncertainty jsonb default null, p_mock_set boolean default false, p_mock jsonb default null
) returns void language plpgsql as $$
declare e jsonb; v_state text;
begin
  update public.profiles set stage = p_stage, entry_reported_at = now() where id = p_user;
  if not found then raise exception 'no profile for user'; end if;

  -- As before, this screen rewrites the student's own self-reported taught/studied rows. Class and diagnostic rows are never
  -- touched, and a claim never replaces one of those (do nothing on conflict). Logged study is re-derived from completed blocks.
  delete from public.user_topic_exposure where user_id = p_user and source = 'self_report';
  delete from public.user_module_state
   where user_id = p_user and source = 'self_report' and coverage_state in ('taught', 'studied');

  for e in select * from jsonb_array_elements(coalesce(p_exposure, '[]'::jsonb)) loop
    insert into public.user_topic_exposure (user_id, topic_id, recency, source)
    values (p_user, e->>'topic_id', e->>'recency', 'self_report');

    v_state := case e->>'recency' when 'current' then 'taught' else 'studied' end;
    insert into public.user_module_state (user_id, lm_id, coverage_state, source, updated_at)
    select p_user, m.id, v_state, 'self_report', now()
      from public.learning_modules m
     where m.topic_id = e->>'topic_id'
    on conflict (user_id, lm_id) do nothing;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_readings, '[]'::jsonb)) loop
    delete from public.user_module_state
     where user_id = p_user and lm_id = e->>'lm_id' and source = 'self_report' and coverage_state in ('taught', 'studied');
    if e->>'state' in ('partly', 'covered') then
      insert into public.user_module_state (user_id, lm_id, coverage_state, source, updated_at)
      values (p_user, e->>'lm_id', case e->>'state' when 'partly' then 'taught' else 'studied' end, 'self_report', now())
      on conflict (user_id, lm_id) do nothing;
    end if;
  end loop;

  if p_uncertainty is not null then
    delete from public.user_entry_uncertainty where user_id = p_user;
    insert into public.user_entry_uncertainty (user_id, topic_id, level, lm_ids)
    select p_user, u->>'topic_id', u->>'level', coalesce(array(select jsonb_array_elements_text(u->'lm_ids')), '{}')
      from jsonb_array_elements(p_uncertainty) u;
  end if;

  if p_mock_set then
    update public.profiles set mock_date = (p_mock->>'date')::date, mock_kind = p_mock->>'kind' where id = p_user;
  end if;
end $$;

revoke all on function public.onboarding_replace_position(uuid, text, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.onboarding_replace_position(uuid, text, jsonb, jsonb, jsonb, boolean, jsonb) to service_role;

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
    -- Which events exist AND whether each still counts: a voided or disputed answer changes the plan.
    (select coalesce(md5(string_agg(e.id::text || ':' || e.validity || ':' || coalesce(e.validity_reason, '') || ':' || coalesce(e.superseded_by_event_id::text, ''), ',' order by e.id::text)), '')
       from public.evidence_events e where e.user_id = p_user),
    (select concat_ws(',', j->>'exam_window_id', j->>'exam_date', j->>'prep_mode', j->>'class_pattern', j->>'max_session_minutes', j->>'timezone', j->>'stage', j->>'mock_date', j->>'mock_kind')
       from (select to_jsonb(p) as j from public.profiles p where p.id = p_user) x)
  ))
$$;
