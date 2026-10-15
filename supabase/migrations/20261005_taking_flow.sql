-- 2027 exam weights, and the taking flow: mandatory per-question confidence, active-time
-- tracking, pause/resume, timed sessions and idempotent submission.

-- Official 2027 Level I topic weights (ranges) and names.
update public.topics set exam_weight_min = 10, exam_weight_max = 15, name = 'Ethical and Professional Standards' where id = 'eth';
update public.topics set exam_weight_min = 11, exam_weight_max = 14 where id = 'quant';
update public.topics set exam_weight_min = 6,  exam_weight_max = 9  where id = 'econ';
update public.topics set exam_weight_min = 11, exam_weight_max = 14 where id = 'fsa';
update public.topics set exam_weight_min = 6,  exam_weight_max = 9,  name = 'Corporate Finance' where id = 'ci';
update public.topics set exam_weight_min = 11, exam_weight_max = 14, name = 'Equities' where id = 'eq';
update public.topics set exam_weight_min = 11, exam_weight_max = 14 where id = 'fi';
update public.topics set exam_weight_min = 6,  exam_weight_max = 9,  name = 'Derivatives and Risk Management' where id = 'deriv';
update public.topics set exam_weight_min = 6,  exam_weight_max = 9  where id = 'alt';
update public.topics set exam_weight_min = 8,  exam_weight_max = 12 where id = 'pm';

-- Attempts: kind, timing and pause state.
alter table public.assessment_attempts add column if not exists attempt_kind text
  check (attempt_kind in ('weekly', 'reading', 'subject', 'repair', 'mock', 'module', 'other'));
alter table public.assessment_attempts add column if not exists paper_kind text check (paper_kind in ('diagnostic', 'revisionary', 'mixed'));
alter table public.assessment_attempts add column if not exists cycle_id uuid references public.planning_cycles(id) on delete set null;
alter table public.assessment_attempts add column if not exists time_limit_minutes integer;
alter table public.assessment_attempts add column if not exists deadline_at timestamptz;
alter table public.assessment_attempts add column if not exists paused_at timestamptz;
alter table public.assessment_attempts add column if not exists paused_seconds integer not null default 0;
alter table public.assessment_attempts add column if not exists submitted_at timestamptz;
alter table public.assessment_attempts add column if not exists requested_blueprint jsonb;
alter table public.assessment_attempts add column if not exists delivered_coverage jsonb;

-- Responses: how the answer was reached.
alter table public.assessment_responses add column if not exists active_seconds integer;
alter table public.assessment_responses add column if not exists interrupted_seconds integer not null default 0;
alter table public.assessment_responses add column if not exists flagged boolean not null default false;
alter table public.assessment_responses add column if not exists answered_at timestamptz;
alter table public.assessment_responses add column if not exists changed_count integer not null default 0;

-- Per-question progress, including questions not yet answered (so time survives a refresh).
create table if not exists public.attempt_item_progress (
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  item_id text not null references public.assessment_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  active_seconds integer not null default 0 check (active_seconds >= 0),
  interrupted_seconds integer not null default 0 check (interrupted_seconds >= 0),
  visits integer not null default 1,
  flagged boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (attempt_id, item_id)
);
alter table public.attempt_item_progress enable row level security;
drop policy if exists attempt_item_progress_read_own on public.attempt_item_progress;
create policy attempt_item_progress_read_own on public.attempt_item_progress for select using (auth.uid() = user_id);
-- Written only by the server after an ownership check.

-- Saves (or changes, before submission) one answer. Confidence is mandatory.
create or replace function public.save_attempt_response(
  p_attempt_id uuid,
  p_item_id text,
  p_selected_option integer,
  p_confidence integer,
  p_active_seconds integer,
  p_interrupted_seconds integer,
  p_flagged boolean
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_attempt public.assessment_attempts%rowtype;
  v_key smallint;
  v_options jsonb;
  v_correct boolean;
  v_existing public.assessment_responses%rowtype;
  v_id uuid;
begin
  if v_user is null then raise exception 'Unauthorized'; end if;
  if p_confidence is null or p_confidence not in (1, 3, 5) then raise exception 'Confidence is required'; end if;

  select * into v_attempt from public.assessment_attempts where id = p_attempt_id and user_id = v_user for update;
  if not found then raise exception 'Attempt not found'; end if;
  if v_attempt.status not in ('ready', 'in_progress', 'assembling') then raise exception 'Attempt is %', v_attempt.status; end if;
  if v_attempt.paused_at is not null then raise exception 'Attempt is paused'; end if;
  -- A timed session accepts answers until its deadline (plus a few seconds' grace for the last save).
  if v_attempt.deadline_at is not null and now() > v_attempt.deadline_at + interval '10 seconds' then raise exception 'Time is up'; end if;

  if not exists (select 1 from public.form_items where form_id = v_attempt.form_id and item_id = p_item_id) then raise exception 'Item not in form'; end if;
  select key_index, options into v_key, v_options from public.assessment_items where id = p_item_id;
  if v_key is null then raise exception 'Item not found'; end if;
  if p_selected_option is null or p_selected_option < 0 or p_selected_option >= jsonb_array_length(v_options) then raise exception 'That option does not exist'; end if;
  v_correct := (p_selected_option = v_key);

  select * into v_existing from public.assessment_responses where attempt_id = p_attempt_id and item_id = p_item_id;
  if found then
    update public.assessment_responses set
      selected_option_index = p_selected_option, is_correct = v_correct, self_reported_confidence = p_confidence,
      active_seconds = greatest(coalesce(active_seconds, 0), coalesce(p_active_seconds, 0)),
      interrupted_seconds = greatest(interrupted_seconds, coalesce(p_interrupted_seconds, 0)),
      flagged = coalesce(p_flagged, flagged), answered_at = now(),
      changed_count = changed_count + case when selected_option_index is distinct from p_selected_option or self_reported_confidence is distinct from p_confidence then 1 else 0 end,
      elapsed_seconds = greatest(coalesce(elapsed_seconds, 0), coalesce(p_active_seconds, 0))
    where id = v_existing.id returning id into v_id;
  else
    insert into public.assessment_responses (user_id, attempt_id, item_id, selected_option_index, is_correct, self_reported_confidence,
      elapsed_seconds, active_seconds, interrupted_seconds, flagged, answered_at)
    values (v_user, p_attempt_id, p_item_id, p_selected_option, v_correct, p_confidence,
      p_active_seconds, p_active_seconds, coalesce(p_interrupted_seconds, 0), coalesce(p_flagged, false), now())
    returning id into v_id;
  end if;

  if v_attempt.status in ('ready', 'assembling') then
    update public.assessment_attempts set status = 'in_progress', started_at = coalesce(started_at, now()) where id = p_attempt_id;
  end if;
  return json_build_object('id', v_id);
end;
$$;
revoke all on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean) from public, anon;
grant execute on function public.save_attempt_response(uuid, text, integer, integer, integer, integer, boolean) to authenticated;
