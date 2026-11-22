-- A resolved challenge now changes the STORED score, not just the read-time view.
--  * Item validity lives in item_challenges (pending = disputed and still scoreable; resolved_voided = set aside once; resolved_kept = valid).
--    It no longer depends on an evidence_events row, so practice papers and omitted items work.
--  * public._rescore_attempt is the single SQL ledger for an adjustment. It keeps the form's own policy ('1.0' answered-only stays
--    answered-only; 'paper-score.1' stays over delivered items), records old/new values, and is idempotent per challenge.
--  * Lock order everywhere: attempt row first, then challenge row. finalize already locks the attempt first.
--  * A student may report an owned, DELIVERED question of a started paper without having answered it.
-- finalize_assessment_attempt and resolve_item_challenge are patched from their LIVE definitions (never rebuilt from an old file), so the
-- approval-trust, practice-exclusion, repair and grant behaviour they already have is retained. An unexpected shape stops the migration.

alter table public.assessment_attempts add column if not exists scoreable_count integer;

create table if not exists public.attempt_score_adjustments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.assessment_attempts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  challenge_id uuid not null unique references public.item_challenges(id) on delete cascade,
  revision integer not null,
  policy text not null,
  reason text not null,
  previous jsonb not null,
  after jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.attempt_score_adjustments enable row level security;
drop policy if exists attempt_score_adjustments_read_own on public.attempt_score_adjustments;
create policy attempt_score_adjustments_read_own on public.attempt_score_adjustments for select using (auth.uid() = user_id);
revoke insert, update, delete, truncate on public.attempt_score_adjustments from anon, authenticated;
create index if not exists attempt_score_adjustments_attempt on public.attempt_score_adjustments(attempt_id, revision);

-- The ledger. Internal: no direct execution by students.
create or replace function public._rescore_attempt(p_attempt_id uuid, p_challenge_id uuid, p_reason text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  a record; v_pol text; v_delivered int; v_voided int; v_correct int; v_incorrect int; v_scoreable int; v_score int; v_omitted int; v_prev jsonb; v_after jsonb; v_rev int; v_void_items text[];
begin
  select * into a from public.assessment_attempts where id = p_attempt_id for update;
  if a is null then raise exception 'Attempt not found'; end if;
  if a.status not in ('scored', 'partially_voided', 'rescored') then return jsonb_build_object('ok', true, 'skipped', 'not_scored'); end if;
  v_pol := coalesce(a.scoring_policy_version, '1.0');
  if v_pol not in ('1.0', 'paper-score.1') then raise exception 'Unsupported scoring policy %', v_pol; end if;

  select count(*) into v_delivered from public.form_items where form_id = a.form_id;
  select coalesce(array_agg(distinct c.item_id), '{}') into v_void_items from public.item_challenges c
    where c.attempt_id = p_attempt_id and c.user_id = a.user_id and c.status = 'resolved_voided'
      and (a.form_id is null or exists (select 1 from public.form_items fi where fi.form_id = a.form_id and fi.item_id = c.item_id));
  v_voided := coalesce(array_length(v_void_items, 1), 0);
  select count(*) filter (where r.is_correct), count(*) filter (where not coalesce(r.is_correct, false)) into v_correct, v_incorrect
    from public.assessment_responses r where r.attempt_id = p_attempt_id and r.user_id = a.user_id and r.selected_option_index is not null
      and not (r.item_id = any(v_void_items));

  v_prev := jsonb_build_object('score', a.score, 'answered', a.valid_response_count, 'correct', a.correct_response_count, 'omitted', a.omitted_count, 'scoreable', a.scoreable_count, 'delivered', a.delivered_count);
  if v_pol = 'paper-score.1' then
    v_scoreable := greatest(v_delivered - v_voided, 0);
    v_score := case when v_scoreable > 0 then round((v_correct::numeric / v_scoreable::numeric) * 100) else null end;
    v_omitted := greatest(v_scoreable - v_correct - v_incorrect, 0);
  else
    v_scoreable := v_correct + v_incorrect;
    v_score := case when v_scoreable > 0 then round((v_correct::numeric / v_scoreable::numeric) * 100) else null end;
    v_omitted := 0;
  end if;
  v_rev := a.result_revision + 1;
  update public.assessment_attempts set score = v_score, valid_response_count = v_correct + v_incorrect, correct_response_count = v_correct,
    omitted_count = v_omitted, scoreable_count = v_scoreable, result_revision = v_rev, rescored_at = now() where id = p_attempt_id;
  v_after := jsonb_build_object('score', v_score, 'answered', v_correct + v_incorrect, 'correct', v_correct, 'omitted', v_omitted, 'scoreable', v_scoreable, 'delivered', a.delivered_count);
  insert into public.attempt_score_adjustments(attempt_id, user_id, challenge_id, revision, policy, reason, previous, after)
    values (p_attempt_id, a.user_id, p_challenge_id, v_rev, v_pol, p_reason, v_prev, v_after) on conflict (challenge_id) do nothing;
  return jsonb_build_object('ok', true, 'revision', v_rev, 'policy', v_pol, 'previous', v_prev, 'after', v_after);
end;
$function$;
revoke all on function public._rescore_attempt(uuid, uuid, text) from public, anon, authenticated;

-- Reporting a problem needs only an owned, delivered question of a started paper (no saved answer required).
create or replace function public.raise_item_challenge(p_attempt_id uuid, p_item_id text, p_comment text, p_reason_code text)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare
  v_user_id uuid; v_att record; v_id uuid; v_challenge_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then raise exception 'Unauthorized'; end if;
  select * into v_att from public.assessment_attempts where id = p_attempt_id and user_id = v_user_id for update;
  -- One message for every refusal: a foreign attempt, an unseen (reserved only) question and a question not on the form look alike.
  if v_att is null or v_att.status not in ('in_progress', 'submitted', 'scored', 'partially_voided', 'rescored', 'expired')
     or not (exists (select 1 from public.form_items fi where fi.form_id = v_att.form_id and fi.item_id = p_item_id)
             or exists (select 1 from public.assessment_responses r where r.attempt_id = p_attempt_id and r.item_id = p_item_id and r.user_id = v_user_id)) then
    raise exception 'Response not found';
  end if;
  select id into v_id from public.item_challenges where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  insert into public.item_challenges (user_id, item_id, attempt_id, comment, reason_code, status)
    values (v_user_id, p_item_id, p_attempt_id, p_comment, coalesce(p_reason_code, 'other'), 'pending') returning id into v_challenge_id;
  update public.evidence_events set validity = 'disputed', validity_reason = 'challenge_pending'
    where attempt_id = p_attempt_id and item_id = p_item_id and user_id = v_user_id and validity = 'valid';
  return v_challenge_id;
end;
$function$;

do $$
declare d text;
begin
  ------------------------------------------------------------------ resolve_item_challenge
  select pg_get_functiondef('public.resolve_item_challenge(uuid,text)'::regprocedure) into d;
  if position('_rescore_attempt' in d) = 0 then
    if position($o$  v_task record;
begin$o$ in d) = 0
       or position($o$select * into v_challenge from public.item_challenges where id = p_challenge_id for update;$o$ in d) = 0
       or position($o$update public.assessment_attempts set result_revision = result_revision + 1, rescored_at = now() where id = v_challenge.attempt_id;$o$ in d) = 0 then
      raise exception 'resolve_item_challenge has an unexpected shape; refusing to patch it';
    end if;
    d := replace(d, $o$  v_task record;
begin$o$, $n$  v_task record;
  v_att uuid;
begin$n$);
    -- attempt first, then challenge (same order as finalize)
    d := replace(d, $o$select * into v_challenge from public.item_challenges where id = p_challenge_id for update;$o$, $n$select attempt_id into v_att from public.item_challenges where id = p_challenge_id;
  if v_att is null then raise exception 'Challenge not found'; end if;
  perform 1 from public.assessment_attempts where id = v_att for update;
  select * into v_challenge from public.item_challenges where id = p_challenge_id for update;$n$);
    d := replace(d, $o$update public.assessment_attempts set result_revision = result_revision + 1, rescored_at = now() where id = v_challenge.attempt_id;$o$,
      $n$perform public._rescore_attempt(v_challenge.attempt_id, p_challenge_id, 'challenge_voided');$n$);
    execute d;
  end if;

  ------------------------------------------------------------------ finalize_assessment_attempt
  select pg_get_functiondef('public.finalize_assessment_attempt(uuid,text,text)'::regprocedure) into d;
  if position('resolved_voided' in d) = 0 then
    if position($o$  v_answered_correct int := 0;
begin$o$ in d) = 0
       or position($o$for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id loop$o$ in d) = 0
       or position($o$select count(*) into v_delivered from public.form_items where form_id = v_attempt.form_id;$o$ in d) = 0
       or position($o$round((v_correct::numeric / v_delivered::numeric) * 100) else null end;$o$ in d) = 0
       or position($o$omitted_count = greatest(v_delivered - v_total, 0),$o$ in d) = 0
       or position($o$join public.assessment_items ai on ar.item_id = ai.id where ar.attempt_id = p_attempt_id loop$o$ in d) = 0
       or position($o$-- ONE decision per concept per paper.$o$ in d) = 0 then
      raise exception 'finalize_assessment_attempt has an unexpected shape; refusing to patch it';
    end if;
    d := replace(d, $o$  v_answered_correct int := 0;
begin$o$, $n$  v_answered_correct int := 0;
  v_voided int := 0;
begin$n$);
    -- Items a reviewer already set aside (challenge resolved before submission) are not scored and make no evidence.
    d := replace(d, $o$for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id loop$o$,
      $n$select count(distinct c.item_id) into v_voided from public.item_challenges c where c.attempt_id = p_attempt_id and c.user_id = v_user_id and c.status = 'resolved_voided'
    and exists (select 1 from public.form_items fi where fi.form_id = v_attempt.form_id and fi.item_id = c.item_id);
  for v_response in select * from public.assessment_responses where attempt_id = p_attempt_id
      and item_id not in (select c.item_id from public.item_challenges c where c.attempt_id = p_attempt_id and c.status = 'resolved_voided') loop$n$);
    d := replace(d, $o$round((v_correct::numeric / v_delivered::numeric) * 100) else null end;$o$,
      $n$round((v_correct::numeric / greatest(v_delivered - v_voided, 1)::numeric) * 100) else null end;$n$);
    d := replace(d, $o$case when v_delivered > 0 then round($o$, $n$case when v_delivered - v_voided > 0 then round($n$);
    d := replace(d, $o$omitted_count = greatest(v_delivered - v_total, 0),$o$, $n$omitted_count = greatest(v_delivered - v_voided - v_total, 0), scoreable_count = case when v_paper then v_delivered - v_voided else v_total end,$n$);
    d := replace(d, $o$join public.assessment_items ai on ar.item_id = ai.id where ar.attempt_id = p_attempt_id loop$o$,
      $n$join public.assessment_items ai on ar.item_id = ai.id where ar.attempt_id = p_attempt_id
          and ar.item_id not in (select c.item_id from public.item_challenges c where c.attempt_id = p_attempt_id and c.status = 'resolved_voided') loop$n$);
    -- A question still under review is counted, but its evidence is provisional ('disputed') before any repair decision uses it.
    d := replace(d, $o$-- ONE decision per concept per paper.$o$, $n$update public.evidence_events e set validity = 'disputed', validity_reason = 'challenge_pending'
      where e.attempt_id = p_attempt_id and e.user_id = v_user_id and e.validity = 'valid'
        and e.item_id in (select c.item_id from public.item_challenges c where c.attempt_id = p_attempt_id and c.status = 'pending');
    -- ONE decision per concept per paper.$n$);
    d := replace(d, $o$'omitted', greatest(v_delivered - v_total, 0))$o$, $n$'omitted', greatest(v_delivered - v_voided - v_total, 0))$n$);
    if position('resolved_voided' in d) = 0 or position('item_review_decisions' in d) = 0 or position($p$attempt_kind = 'practice'$p$ in d) = 0 or position('paper-score.1' in d) = 0 then
      raise exception 'finalize_assessment_attempt patch did not apply';
    end if;
    execute d;
  end if;
end $$;
