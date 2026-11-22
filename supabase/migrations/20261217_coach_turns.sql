-- Coach turns: one durable, idempotent record per student question.
-- A retry with the same turn key never adds a second student message, a second answer or a second set of pending proposals, and the
-- hourly allowance is counted once per turn, under a per-student lock (the earlier count-then-insert could be raced). Additive.

alter table public.coach_messages add column if not exists turn_key text;
alter table public.coach_messages drop constraint if exists coach_messages_turn_key_check;
alter table public.coach_messages add constraint coach_messages_turn_key_check check (turn_key is null or char_length(turn_key) between 8 and 80);
create unique index if not exists coach_messages_turn_role_uidx on public.coach_messages (user_id, turn_key, role) where turn_key is not null;

-- Begin a turn: replay it, resume it, refuse it for the allowance, or record the student's message. Atomic per student.
create or replace function public.coach_turn_begin(p_user uuid, p_key text, p_body text, p_intent text, p_limit int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_s public.coach_messages%rowtype; v_c public.coach_messages%rowtype; v_n int;
begin
  if p_key is null or char_length(p_key) not between 8 and 80 then raise exception 'bad turn key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  select * into v_s from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'student';
  if found then
    select * into v_c from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'coach';
    if found then return jsonb_build_object('state', 'replay', 'studentId', v_s.id, 'coachId', v_c.id); end if;
    return jsonb_build_object('state', 'resume', 'studentId', v_s.id);
  end if;
  select count(*) into v_n from public.coach_messages where user_id = p_user and role = 'student' and created_at >= now() - interval '1 hour';
  if v_n >= p_limit then return jsonb_build_object('state', 'limited'); end if;
  insert into public.coach_messages (user_id, role, body, intent, turn_key) values (p_user, 'student', left(p_body, 4000), p_intent, p_key) returning * into v_s;
  return jsonb_build_object('state', 'new', 'studentId', v_s.id);
end $$;

-- Finish a turn: the answer and its proposals are written together, once. A second finish returns the first.
create or replace function public.coach_turn_finish(p_user uuid, p_key text, p_body text, p_intent text, p_links jsonb, p_cycle uuid, p_proposals jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c public.coach_messages%rowtype; v_ids uuid[]; v_p jsonb; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('coach_turn:' || p_user::text, 0));
  select * into v_c from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'coach';
  if found then return jsonb_build_object('coachId', v_c.id, 'replayed', true); end if;
  if not exists (select 1 from public.coach_messages where user_id = p_user and turn_key = p_key and role = 'student') then
    return jsonb_build_object('error', 'NO_TURN');   -- history was cleared mid-turn: nothing is added
  end if;
  insert into public.coach_messages (user_id, role, body, intent, links, turn_key)
    values (p_user, 'coach', left(p_body, 4000), p_intent, coalesce(p_links, '[]'::jsonb), p_key) returning * into v_c;
  v_ids := '{}';
  for v_p in select value from jsonb_array_elements(coalesce(p_proposals, '[]'::jsonb)) loop
    insert into public.coach_proposals (user_id, message_id, intent, kind, title, reasoning, proposed_changes, origin, status, target_cycle_id)
      values (p_user, v_c.id, v_p->>'kind', v_p->>'kind', v_p->>'title', v_p->>'reasoning', v_p->'changes', 'coach', 'pending', p_cycle) returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  update public.coach_messages set proposal_ids = v_ids where id = v_c.id;
  return jsonb_build_object('coachId', v_c.id, 'replayed', false);
end $$;

revoke all on function public.coach_turn_begin(uuid, text, text, text, int) from public, anon, authenticated;
revoke all on function public.coach_turn_finish(uuid, text, text, text, jsonb, uuid, jsonb) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.coach_turn_begin(uuid, text, text, text, int) to service_role;
  grant execute on function public.coach_turn_finish(uuid, text, text, text, jsonb, uuid, jsonb) to service_role;
end if; end $$;
