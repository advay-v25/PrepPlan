-- Security review of 20270112: flashcard_draft_allow(p_max, p_window) took its limits from the CALLER, and the signed-in role can execute it. A student could call it
-- directly with a tiny window (it deletes rows older than the window) and reset their own throttle, or with a huge maximum, so the route's limit protected nothing.
-- The limit is now fixed inside the function (10 per hour), takes no arguments, and the parameterised version is removed. Additive; 20270112 is untouched.
drop function if exists public.flashcard_draft_allow(int, interval);
create or replace function public.flashcard_draft_allow() returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_n int;
  c_max constant int := 10; c_window constant interval := interval '1 hour';
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('flashcard-draft:' || v_uid::text, 0));
  delete from public.flashcard_draft_requests where user_id = v_uid and created_at < now() - c_window;
  select count(*) into v_n from public.flashcard_draft_requests where user_id = v_uid;
  if v_n >= c_max then return jsonb_build_object('ok', false, 'code', 'THROTTLED', 'error', 'You have asked for drafts several times in the last hour. Write cards by hand, or try again later.'); end if;
  insert into public.flashcard_draft_requests (user_id) values (v_uid);
  return jsonb_build_object('ok', true, 'remaining', c_max - v_n - 1);
end $$;
revoke all on function public.flashcard_draft_allow() from public, anon;
grant execute on function public.flashcard_draft_allow() to authenticated;
notify pgrst, 'reload schema';
