-- "My classes have finished" as a reviewable, reversible EFFECTIVE-DATE change. Before: only profiles.classes_completed_at moved (roadmap phase label) while the
-- weekly class series stayed active forever, so Calendar kept expecting classes and the next cycle kept its class anchor.
-- Now, in ONE transaction under the student's scope lock: the profile date is set through the existing update_planning_profile command AND every active weekly
-- class series that would run past that date is ended on it (its previous end is remembered). Past occurrences, class logs, the accepted current cycle and
-- recorded work are untouched. Undo restores exactly the series this command ended (not unrelated cancellations) and clears the date.
alter table public.calendar_commitments add column if not exists ends_on_before_completion date;
alter table public.calendar_commitments add column if not exists ended_by_completion boolean not null default false;

create or replace function public.set_classes_finished(p_user uuid, p_done boolean, p_date date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n integer;
begin
  perform public.scope_lock(p_user);
  if p_done then
    update public.calendar_commitments set ends_on_before_completion = ends_on, ended_by_completion = true, ends_on = p_date
     where user_id = p_user and kind = 'class' and recurrence = 'weekly' and status = 'active' and not ended_by_completion and (ends_on is null or ends_on > p_date);
    get diagnostics v_n = row_count;
    perform public.update_planning_profile(p_user, jsonb_build_object('classes_completed_at', p_date::text));
    return jsonb_build_object('ok', true, 'seriesEnded', v_n, 'effective', p_date);
  end if;
  update public.calendar_commitments set ends_on = ends_on_before_completion, ends_on_before_completion = null, ended_by_completion = false
   where user_id = p_user and kind = 'class' and ended_by_completion;
  get diagnostics v_n = row_count;
  perform public.update_planning_profile(p_user, jsonb_build_object('classes_completed_at', null));
  return jsonb_build_object('ok', true, 'seriesRestored', v_n);
end $$;
revoke all on function public.set_classes_finished(uuid, boolean, date) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.set_classes_finished(uuid, boolean, date) to service_role; end if; end $$;
notify pgrst, 'reload schema';
