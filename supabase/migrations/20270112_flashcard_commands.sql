-- Flashcard commands. 20261003 let the signed-in client write the table directly and the route used `reps` as a compare-and-set token, but `Again` resets reps to 0,
-- so it is not a monotonic version: a repeated or competing rating could apply twice or be mistaken for a replay; an edit had no protection at all; the quota was
-- two separate count reads before an insert (a race, and a failed count read counted as zero). Additive; 20261003 is untouched.
--   * flashcards.revision: monotonic, +1 on every edit / review (delete removes the row).
--   * flashcard_commands: one receipt per (user, request key). Exact retry => the ORIGINAL result, nothing applied twice. Same key, different request => KEY_REUSED.
--   * flashcard_apply(): create / update / delete / review in ONE transaction, serialised per user: validation, the atomic quota, the revision check and the receipt.
--     A stale revision changes nothing and returns the CURRENT card, so the UI can show it and keep the student's local text.
--   * flashcard_draft_allow(): per-user throttle for optional note-to-card drafting (counted before a provider is ever called).
--   * The signed-in role can no longer write flashcards directly (reads stay own-rows); every write goes through the command above.
-- Card reviews never write evidence, coverage, repair state or weekly-paper credit: this migration touches none of those tables.
alter table public.flashcards add column if not exists revision integer not null default 1;
do $$ begin
  alter table public.flashcards drop constraint if exists flashcards_source_check;
  alter table public.flashcards add constraint flashcards_source_check check (source in ('manual', 'outcome_prompt', 'note_draft'));
end $$;

create table if not exists public.flashcard_commands (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_key text not null check (char_length(request_key) between 8 and 100),
  fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_key)
);
create index if not exists flashcard_commands_created on public.flashcard_commands (created_at);
alter table public.flashcard_commands enable row level security;
revoke all on public.flashcard_commands from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select, insert, update, delete on public.flashcard_commands to service_role; end if; end $$;

create table if not exists public.flashcard_draft_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists flashcard_draft_requests_user on public.flashcard_draft_requests (user_id, created_at desc);
alter table public.flashcard_draft_requests enable row level security;
revoke all on public.flashcard_draft_requests from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant select, insert, delete on public.flashcard_draft_requests to service_role; end if; end $$;

-- Reads stay own-rows; writes only through the commands.
drop policy if exists flashcards_own on public.flashcards;
create policy flashcards_own on public.flashcards for select using (auth.uid() = user_id);
revoke insert, update, delete on public.flashcards from authenticated, anon;

create or replace function public.flashcard_card_json(c public.flashcards) returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'scope_type', c.scope_type, 'scope_id', c.scope_id, 'front', c.front, 'back', c.back, 'source', c.source, 'due_at', c.due_at,
    'interval_days', c.interval_days, 'ease', c.ease, 'reps', c.reps, 'lapses', c.lapses, 'last_reviewed_at', c.last_reviewed_at, 'suspended', c.suspended, 'revision', c.revision)
$$;

create or replace function public.flashcard_apply(p_key text, p_action text, p_card uuid, p_expected int, p_f jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_fp text; v_prev public.flashcard_commands%rowtype; v_c public.flashcards%rowtype; v_res jsonb;
  v_front text := btrim(coalesce(p_f->>'front', '')); v_back text := btrim(coalesce(p_f->>'back', ''));
  v_scope_t text := p_f->>'scopeType'; v_scope_i text := p_f->>'scopeId'; v_n int; v_total int;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then raise exception 'Verify your email first.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = v_uid and onboarding_status = 'complete') then raise exception 'Complete setup first.' using errcode = '42501'; end if;
  if p_key is null or char_length(p_key) not between 8 and 100 then return jsonb_build_object('ok', false, 'code', 'BAD_KEY', 'error', 'A request key of 8 to 100 characters is required.'); end if;
  if p_action not in ('create', 'update', 'delete', 'review') then return jsonb_build_object('ok', false, 'code', 'BAD_ACTION', 'error', 'Unknown action.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('flashcards:' || v_uid::text, 0));          -- one command at a time per student: the quota and the revision checks cannot race
  v_fp := md5(p_action || '|' || coalesce(p_card::text, '') || '|' || coalesce(p_expected::text, '') || '|' || coalesce(p_f::text, ''));
  select * into v_prev from public.flashcard_commands where user_id = v_uid and request_key = p_key;
  if found then
    if v_prev.fingerprint <> v_fp then return jsonb_build_object('ok', false, 'code', 'KEY_REUSED', 'error', 'That request key was already used for a different change. Nothing was changed.'); end if;
    return v_prev.result || jsonb_build_object('replay', true);
  end if;

  if p_action = 'create' then
    if v_scope_t not in ('subject', 'reading') or v_scope_i is null or char_length(v_scope_i) not between 1 and 60 then return jsonb_build_object('ok', false, 'code', 'BAD_SCOPE', 'error', 'Unknown subject or reading.'); end if;
    if (v_scope_t = 'subject' and not exists (select 1 from public.topics where id = v_scope_i)) or (v_scope_t = 'reading' and not exists (select 1 from public.curriculum_readings where id = v_scope_i and is_active)) then
      return jsonb_build_object('ok', false, 'code', 'BAD_SCOPE', 'error', 'Unknown subject or reading.'); end if;
    if char_length(v_front) not between 1 and 1000 or char_length(v_back) not between 1 and 2000 then return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'Write both sides of the card (front up to 1,000, back up to 2,000 characters).'); end if;
    select count(*) filter (where scope_type = v_scope_t and scope_id = v_scope_i), count(*) into v_n, v_total from public.flashcards where user_id = v_uid;
    if v_n >= 300 or v_total >= 3000 then return jsonb_build_object('ok', false, 'code', 'LIMIT', 'error', 'You have reached the card limit here.', 'inScope', v_n, 'total', v_total); end if;
    insert into public.flashcards (user_id, scope_type, scope_id, front, back, source) values (v_uid, v_scope_t, v_scope_i, v_front, v_back, case when p_f->>'source' in ('outcome_prompt', 'note_draft') then p_f->>'source' else 'manual' end) returning * into v_c;
    v_res := jsonb_build_object('ok', true, 'card', public.flashcard_card_json(v_c));
  else
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
      if (p_f->>'dueAt') is null or (p_f->>'ease')::numeric not between 1.3 and 3.5 or (p_f->>'intervalDays')::numeric not between 0 and 365 or (p_f->>'reps')::int < 0 or (p_f->>'lapses')::int < 0 then
        return jsonb_build_object('ok', false, 'code', 'INVALID', 'error', 'That review could not be recorded.'); end if;
      update public.flashcards set interval_days = (p_f->>'intervalDays')::numeric, ease = (p_f->>'ease')::numeric, reps = (p_f->>'reps')::int, lapses = (p_f->>'lapses')::int,
        due_at = (p_f->>'dueAt')::timestamptz, last_reviewed_at = now(), revision = revision + 1, updated_at = now() where id = p_card returning * into v_c;
      v_res := jsonb_build_object('ok', true, 'card', public.flashcard_card_json(v_c));
    end if;
  end if;
  insert into public.flashcard_commands (user_id, request_key, fingerprint, result) values (v_uid, p_key, v_fp, v_res);
  return v_res || jsonb_build_object('replay', false);
end $$;

create or replace function public.flashcard_draft_allow(p_max int default 10, p_window interval default interval '1 hour') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flashcard-draft:' || v_uid::text, 0));
  delete from public.flashcard_draft_requests where user_id = v_uid and created_at < now() - p_window;
  select count(*) into v_n from public.flashcard_draft_requests where user_id = v_uid;
  if v_n >= p_max then return jsonb_build_object('ok', false, 'code', 'THROTTLED', 'error', 'You have asked for drafts several times in the last hour. Write cards by hand, or try again later.'); end if;
  insert into public.flashcard_draft_requests (user_id) values (v_uid);
  return jsonb_build_object('ok', true, 'remaining', p_max - v_n - 1);
end $$;

revoke all on function public.flashcard_apply(text, text, uuid, int, jsonb), public.flashcard_draft_allow(int, interval), public.flashcard_card_json(public.flashcards) from public, anon;
grant execute on function public.flashcard_apply(text, text, uuid, int, jsonb), public.flashcard_draft_allow(int, interval) to authenticated;
grant execute on function public.flashcard_card_json(public.flashcards) to authenticated, service_role;
notify pgrst, 'reload schema';
