-- Short-lived, server-owned state. No client Data API table access.
create schema if not exists roadmap_security;
revoke all on schema roadmap_security from public, anon, authenticated;

create table roadmap_security.rate_limits (
  scope text not null,
  subject_hash text not null,
  expires_at timestamptz not null,
  hits integer not null,
  primary key (scope, subject_hash)
);
create index rate_limits_expiry on roadmap_security.rate_limits (expires_at);

create table roadmap_security.recovery_grants (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  request_id uuid not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);

create or replace function public.security_take_rate_limit(p_scope text, p_subject_hash text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_max integer;
  v_window interval;
  v_until timestamptz;
begin
  select p.maximum, p.period into v_max, v_window
  from (values
    ('auth_signin_ip', 25, interval '5 minutes'),
    ('auth_signin_shared', 480, interval '5 minutes'),
    ('auth_email_ip', 25, interval '10 minutes'),
    ('auth_email_shared', 120, interval '10 minutes'),
    ('auth_email_address', 6, interval '1 hour'),
    ('auth_verify_ip', 50, interval '5 minutes'),
    ('auth_verify_shared', 300, interval '5 minutes'),
    ('study_activation', 25, interval '5 minutes'),
    ('paper_preflight', 90, interval '5 minutes'),
    ('paper_start', 40, interval '5 minutes'),
    ('account_export', 12, interval '10 minutes'),
    ('account_delete', 8, interval '15 minutes')
  ) as p(scope, maximum, period)
  where p.scope = p_scope;
  if v_max is null or p_subject_hash is null or p_subject_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate limit input' using errcode = '22023';
  end if;

  -- Keep expired keys bounded without relying on an external scheduler.
  if random() < 0.05 then
    delete from roadmap_security.rate_limits where ctid in (
      select ctid from roadmap_security.rate_limits
      where expires_at < v_now - interval '1 day'
      order by expires_at limit 256 for update skip locked
    );
    delete from roadmap_security.recovery_grants where ctid in (
      select ctid from roadmap_security.recovery_grants
      where expires_at < v_now - interval '1 day' limit 256 for update skip locked
    );
  end if;

  insert into roadmap_security.rate_limits as r (scope, subject_hash, expires_at, hits)
    values (p_scope, p_subject_hash, v_now + v_window, 1)
    on conflict (scope, subject_hash) do update set
      hits = case when r.expires_at <= v_now then 1 else r.hits + 1 end,
      expires_at = case when r.expires_at <= v_now then excluded.expires_at else r.expires_at end
    where r.expires_at <= v_now or r.hits < v_max
    returning expires_at into v_until;
  if found then return 0; end if;
  select expires_at into v_until from roadmap_security.rate_limits where scope = p_scope and subject_hash = p_subject_hash;
  return greatest(1, ceil(extract(epoch from (v_until - clock_timestamp())))::integer);
end;
$$;

create or replace function public.security_password_recovery(p_action text, p_user uuid, p_session uuid, p_request uuid default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_action = 'open' and p_request is not null then
    insert into roadmap_security.recovery_grants (session_id, request_id, expires_at)
    select id, p_request, v_now + interval '10 minutes'
    from auth.sessions where id = p_session and user_id = p_user
    on conflict do nothing;
    return found;
  end if;
  if p_action = 'check' then
    return exists (
      select 1 from roadmap_security.recovery_grants g join auth.sessions s on s.id = g.session_id
      where g.session_id = p_session and s.user_id = p_user and g.used_at is null and g.expires_at > v_now
    );
  end if;
  if p_action = 'take' then
    update roadmap_security.recovery_grants g set used_at = v_now
    from auth.sessions s
    where g.session_id = p_session and s.id = g.session_id and s.user_id = p_user
      and g.used_at is null and g.expires_at > clock_timestamp();
    return found;
  end if;
  raise exception 'Invalid recovery input' using errcode = '22023';
end;
$$;

create or replace function public.security_session_is_active(p_user uuid, p_session uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.sessions where id = p_session and user_id = p_user)
$$;

revoke all on function public.security_take_rate_limit(text, text) from public, anon, authenticated;
revoke all on function public.security_password_recovery(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.security_session_is_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.security_take_rate_limit(text, text) to service_role;
grant execute on function public.security_password_recovery(text, uuid, uuid, uuid) to service_role;
grant execute on function public.security_session_is_active(uuid, uuid) to service_role;
