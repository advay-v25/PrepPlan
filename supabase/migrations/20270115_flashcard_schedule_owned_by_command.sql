-- flashcard_apply (20270112/13) accepted intervalDays, ease, reps, lapses and dueAt from the CALLER (the route computed them, but an authenticated student could call
-- the command directly and write any due date or counters within range; a missing value also became null and failed later as an infrastructure error).
-- The command now takes ONLY the rating for a review and derives the next schedule itself from the locked card, that rating and the database clock, using the same
-- algorithm as src/lib/curriculum/flashcards.ts (Again/Hard/Good/Easy, ten-minute Again rule, 1.3-3.5 ease, 365-day cap). Anything else in the review payload is
-- ignored; a missing or unknown rating is refused cleanly before any write. The receipt fingerprint is (card, expected revision, rating): the student's intent,
-- never a derived time, so an exact retry replays the ORIGINAL committed result and a changed derived schedule can never alter a committed receipt.
-- Additive: 20270112-14 are untouched; this replaces the effective function and restates its ACL.
create or replace function public.flashcard_next_schedule(p_interval numeric, p_ease numeric, p_reps int, p_lapses int, p_rating text, p_now timestamptz)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_interval numeric := p_interval; v_ease numeric := p_ease; v_reps int := p_reps; v_lapses int := p_lapses; v_due timestamptz;
begin
  if p_rating = 'again' then
    v_lapses := v_lapses + 1; v_reps := 0; v_interval := 0; v_ease := least(3.5, greatest(1.3, round((v_ease - 0.2) * 100) / 100));
    v_due := p_now + interval '10 minutes';
  else
    if p_rating = 'hard' then
      v_interval := case when v_reps = 0 then 1 else greatest(1, round(v_interval * 1.2)) end; v_ease := least(3.5, greatest(1.3, round((v_ease - 0.15) * 100) / 100));
    elsif p_rating = 'good' then
      v_interval := case when v_reps = 0 then 1 when v_reps = 1 then 3 else greatest(1, round(v_interval * v_ease)) end;
    elsif p_rating = 'easy' then
      v_interval := case when v_reps = 0 then 3 else greatest(2, round(v_interval * v_ease * 1.3)) end; v_ease := least(3.5, greatest(1.3, round((v_ease + 0.15) * 100) / 100));
    else
      raise exception 'unknown rating' using errcode = '22023';
    end if;
    v_interval := least(365, v_interval); v_reps := v_reps + 1;
    v_due := p_now + make_interval(days => v_interval::int);
  end if;
  return jsonb_build_object('intervalDays', v_interval, 'ease', v_ease, 'reps', v_reps, 'lapses', v_lapses, 'dueAt', v_due);
end $$;
revoke all on function public.flashcard_next_schedule(numeric, numeric, int, int, text, timestamptz) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.flashcard_next_schedule(numeric, numeric, int, int, text, timestamptz) to service_role; end if; end $$;

create or replace function public.flashcard_apply(p_key text, p_action text, p_card uuid, p_expected int, p_f jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_fp text; v_prev public.flashcard_commands%rowtype; v_c public.flashcards%rowtype; v_res jsonb; v_next jsonb;
  v_f jsonb := coalesce(p_f, '{}'::jsonb);
  v_front text := btrim(coalesce(v_f->>'front', '')); v_back text := btrim(coalesce(v_f->>'back', ''));
  v_scope_t text := v_f->>'scopeType'; v_scope_i text := v_f->>'scopeId'; v_rating text := v_f->>'rating'; v_n int; v_total int;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then raise exception 'Verify your email first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarding_status = 'complete') then raise exception 'Complete setup first.' using errcode = '42501'; end if;
  if p_key is null or char_length(p_key) not between 8 and 100 then return jsonb_build_object('ok', false, 'code', 'BAD_KEY', 'error', 'A request key of 8 to 100 characters is required.'); end if;
  if p_action is null or p_action not in ('create', 'update', 'delete', 'review') then return jsonb_build_object('ok', false, 'code', 'BAD_ACTION', 'error', 'Unknown action.'); end if;
  if jsonb_typeof(v_f) <> 'object' then return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'The request could not be read.'); end if;
  if p_action = 'review' and coalesce(v_rating, '') not in ('again', 'hard', 'good', 'easy') then return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'Choose Again, Hard, Good or Easy.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('flashcards:' || v_uid::text, 0));
  v_fp := md5(p_action || '|' || coalesce(p_card::text, '') || '|' || coalesce(p_expected::text, '') || '|' || case when p_action = 'review' then v_rating else v_f::text end);
  select * into v_prev from public.flashcard_commands where user_id = v_uid and request_key = p_key;
  if found then
    if v_prev.fingerprint <> v_fp then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED', 'error', 'That request key was already used for a different change. Nothing was changed.'); end if;
    return v_prev.result || jsonb_build_object('replay', true);
  end if;

  if p_action = 'create' then
    if v_scope_t is null or v_scope_t not in ('subject', 'reading') or v_scope_i is null or char_length(v_scope_i) not between 1 and 60 then return jsonb_build_object('ok', false, 'code', 'BAD_SCOPE', 'error', 'Unknown subject or reading.'); end if;
    if (v_scope_t = 'subject' and not exists (select 1 from public.topics where id = v_scope_i)) or (v_scope_t = 'reading' and not exists (select 1 from public.curriculum_readings where id = v_scope_i and is_active)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_SCOPE', 'error', 'Unknown subject or reading.'); end if;
    if char_length(v_front) not between 1 and 1000 or char_length(v_back) not between 1 and 2000 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'Write both sides of the card (front up to 1,000, back up to 2,000 characters).'); end if;
    select count(*) filter (where scope_type = v_scope_t and scope_id = v_scope_i), count(*) into v_n, v_total from public.flashcards where user_id = v_uid;
    if v_n >= 300 or v_total >= 3000 then return jsonb_build_object('ok', false, 'code', 'LIMIT', 'error', 'You have reached the card limit here.', 'inScope', v_n, 'total', v_total); end if;
    insert into public.flashcards (user_id, scope_type, scope_id, front, back, source) values (v_uid, v_scope_t, v_scope_i, v_front, v_back, case when v_f->>'source' in ('outcome_prompt', 'note_draft') then v_f->>'source' else 'manual' end) returning * into v_c;
    v_res := jsonb_build_object('ok', true, 'card', public.flashcard_card_json(v_c));
  else
    if p_card is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'That card no longer exists.'); end if;
    select * into v_c from public.flashcards where id = p_card and user_id = v_uid for update;
    if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'error', 'That card no longer exists.'); end if;
    if p_expected is null or v_c.revision <> p_expected then
      return jsonb_build_object('ok', false, 'code', 'STALE_CARD', 'error', 'This card changed somewhere else. Nothing was applied; the current card is shown.', 'card', public.flashcard_card_json(v_c));
    end if;
    if p_action = 'update' then
      if char_length(v_front) not between 1 and 1000 or char_length(v_back) not between 1 and 2000 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'Write both sides of the card.'); end if;
      update public.flashcards set front = v_front, back = v_back, revision = revision + 1, updated_at = now() where id = p_card returning * into v_c;
      v_res := jsonb_build_object('ok', true, 'card', public.flashcard_card_json(v_c));
    elsif p_action = 'delete' then
      delete from public.flashcards where id = p_card;
      v_res := jsonb_build_object('ok', true, 'deleted', true, 'cardId', p_card);
    else
      v_next := public.flashcard_next_schedule(v_c.interval_days, v_c.ease, v_c.reps, v_c.lapses, v_rating, now());
      update public.flashcards set interval_days = (v_next->>'intervalDays')::numeric, ease = (v_next->>'ease')::numeric, reps = (v_next->>'reps')::int, lapses = (v_next->>'lapses')::int,
        due_at = (v_next->>'dueAt')::timestamptz, last_reviewed_at = now(), revision = revision + 1, updated_at = now() where id = p_card returning * into v_c;
      v_res := jsonb_build_object('ok', true, 'card', public.flashcard_card_json(v_c));
    end if;
  end if;
  insert into public.flashcard_commands (user_id, request_key, fingerprint, result) values (v_uid, p_key, v_fp, v_res);
  return v_res || jsonb_build_object('replay', false);
end $$;
revoke all on function public.flashcard_apply(text, text, uuid, int, jsonb) from public, anon;
grant execute on function public.flashcard_apply(text, text, uuid, int, jsonb) to authenticated;
notify pgrst, 'reload schema';
