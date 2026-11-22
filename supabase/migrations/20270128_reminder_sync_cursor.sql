create table roadmap_security.reminder_sync_cursor (
  singleton boolean primary key default true check (singleton),
  after_user uuid,
  lease_id uuid,
  lease_until timestamptz
);
insert into roadmap_security.reminder_sync_cursor default values;

create index reminder_prefs_opted_in on public.reminder_prefs(user_id)
  where assessment_reminders or weekly_review_reminders;

create or replace function public.claim_reminder_sync_batch()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_cursor roadmap_security.reminder_sync_cursor%rowtype;
  v_users uuid[];
  v_lease uuid := gen_random_uuid();
begin
  select * into v_cursor from roadmap_security.reminder_sync_cursor where singleton for update;
  if v_cursor.lease_until > clock_timestamp() then return null; end if;
  select array_agg(batch.user_id order by batch.user_id) into v_users from (
    select user_id from public.reminder_prefs
    where (assessment_reminders or weekly_review_reminders) and (v_cursor.after_user is null or user_id > v_cursor.after_user)
    order by user_id limit 72
  ) batch;
  if v_users is null and v_cursor.after_user is not null then
    v_cursor.after_user := null;
    select array_agg(batch.user_id order by batch.user_id) into v_users from (
      select user_id from public.reminder_prefs
      where assessment_reminders or weekly_review_reminders order by user_id limit 72
    ) batch;
  end if;
  update roadmap_security.reminder_sync_cursor
    set after_user = v_cursor.after_user, lease_id = v_lease, lease_until = clock_timestamp() + interval '45 seconds'
    where singleton;
  return jsonb_build_object('leaseId', v_lease, 'userIds', coalesce(v_users, array[]::uuid[]));
end;
$$;

create or replace function public.finish_reminder_sync_batch(p_lease_id uuid, p_last_user uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update roadmap_security.reminder_sync_cursor
    set after_user = coalesce(p_last_user, after_user), lease_id = null, lease_until = null
    where singleton and lease_id = p_lease_id and lease_until > clock_timestamp();
  return found;
end;
$$;

revoke all on function public.claim_reminder_sync_batch(), public.finish_reminder_sync_batch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_reminder_sync_batch(), public.finish_reminder_sync_batch(uuid, uuid) to service_role;
