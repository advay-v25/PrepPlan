-- Phase 6: private-beta admission (server-owned invitations bound to the VERIFIED identity), account-deletion audit, and the reminder queue.
-- Additive. Service role writes; students read only their own reminder rows.

-- 1. Admission -------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.beta_settings (key text primary key, value text not null, updated_at timestamptz not null default now());
insert into public.beta_settings (key, value) values ('admission', 'open') on conflict (key) do nothing;   -- the beta project sets 'invite_only'

create table if not exists public.beta_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role text not null default 'candidate' check (role in ('candidate', 'reviewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  expires_at timestamptz not null,
  created_by text not null default 'owner',
  note text check (note is null or char_length(note) <= 200),
  accepted_user_id uuid references auth.users on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists beta_invitations_one_open_per_email on public.beta_invitations (email) where status in ('pending', 'accepted');
alter table public.beta_settings enable row level security;
alter table public.beta_invitations enable row level security;
revoke all on public.beta_settings, public.beta_invitations from public, anon, authenticated;

create or replace function public.beta_invite_only() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.beta_settings where key = 'admission'), 'open') = 'invite_only'
$$;

-- The database refuses the account itself when the email has no live invitation (so a direct API signup cannot bypass the pages).
create or replace function public.enforce_beta_invitation() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if public.beta_invite_only() and not exists (
    select 1 from public.beta_invitations i where i.email = lower(btrim(new.email)) and (i.status = 'accepted' or (i.status = 'pending' and i.expires_at > now()))) then
    raise exception 'NOT_INVITED: this email has no valid beta invitation' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists enforce_beta_invitation on auth.users;
create trigger enforce_beta_invitation before insert on auth.users for each row execute function public.enforce_beta_invitation();

-- Admission is bound to the VERIFIED identity: only once the email is confirmed is the invitation accepted for this user id and any reviewer role granted.
create or replace function public.accept_beta_invitation() returns trigger language plpgsql security definer set search_path = '' as $$
declare v public.beta_invitations%rowtype;
begin
  if new.email_confirmed_at is null then return new; end if;
  select * into v from public.beta_invitations where email = lower(btrim(new.email)) and status in ('pending', 'accepted') for update;
  if not found then return new; end if;
  if v.status = 'pending' then
    if v.expires_at <= now() then return new; end if;
    update public.beta_invitations set status = 'accepted', accepted_user_id = new.id, accepted_at = now() where id = v.id;
  elsif v.accepted_user_id is distinct from new.id then
    return new;      -- an accepted invitation belongs to the identity that verified it
  end if;
  if v.role = 'reviewer' then
    insert into public.user_roles (user_id, role) values (new.id, 'diagnostic_reviewer') on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists accept_beta_invitation on auth.users;
create trigger accept_beta_invitation after insert or update of email_confirmed_at on auth.users for each row execute function public.accept_beta_invitation();

create or replace function public.is_beta_admitted(p_user uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select not public.beta_invite_only() or exists (select 1 from public.beta_invitations i where i.accepted_user_id = p_user and i.status = 'accepted')
$$;
revoke all on function public.is_beta_admitted(uuid), public.beta_invite_only() from public, anon, authenticated;

-- The owner's way to invite (service role / owner script only). Re-inviting an expired or revoked email makes a fresh invitation.
create or replace function public.create_beta_invitation(p_email text, p_role text, p_days int, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); v_id uuid;
begin
  if p_role not in ('candidate', 'reviewer') or p_days not between 1 and 60 then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  update public.beta_invitations set status = 'revoked' where email = v_email and status = 'pending' and expires_at <= now();
  if exists (select 1 from public.beta_invitations where email = v_email and status in ('pending', 'accepted')) then return jsonb_build_object('ok', false, 'code', 'ALREADY_INVITED'); end if;
  insert into public.beta_invitations (email, role, expires_at, note) values (v_email, p_role, now() + make_interval(days => p_days), p_note) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.create_beta_invitation(text, text, int, text) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then
  grant execute on function public.is_beta_admitted(uuid) to service_role; grant execute on function public.create_beta_invitation(text, text, int, text) to service_role;
  grant execute on function public.beta_invite_only() to service_role; end if; end $$;

-- 2. Account deletion audit: that a deletion happened, never who (a one-way hash of the id) -----------------------------------------------------
create table if not exists public.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_hash text not null,
  deleted_at timestamptz not null default now(),
  outcome text not null check (outcome in ('deleted', 'failed'))
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from public, anon, authenticated;

-- 3. Reminders --------------------------------------------------------------------------------------------------------------------------------
create table if not exists public.reminder_prefs (
  user_id uuid primary key references auth.users on delete cascade,
  assessment_reminders boolean not null default false,      -- opt-in
  weekly_review_reminders boolean not null default false,   -- opt-in
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  updated_at timestamptz not null default now()
);
create table if not exists public.reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('assessment_upcoming', 'weekly_review_ready')),
  ref_id text not null,                                      -- appointment id / cycle id
  job_key text not null unique,                              -- durable identity: kind:user:ref:day
  send_at timestamptz not null,
  link text not null check (link like '/app%'),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'cancelled', 'failed', 'uncertain')),
  attempts int not null default 0,
  lease_until timestamptz,
  last_error text,
  cancelled_reason text,
  sent_at timestamptz,
  provider_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reminder_jobs_due on public.reminder_jobs (send_at) where status in ('pending', 'sending');
alter table public.reminder_prefs enable row level security;
alter table public.reminder_jobs enable row level security;
revoke all on public.reminder_prefs, public.reminder_jobs from public, anon, authenticated;
grant select on public.reminder_prefs, public.reminder_jobs to authenticated;
drop policy if exists "own reminder prefs" on public.reminder_prefs;
create policy "own reminder prefs" on public.reminder_prefs for select using (auth.uid() = user_id);
drop policy if exists "own reminder jobs" on public.reminder_jobs;
create policy "own reminder jobs" on public.reminder_jobs for select using (auth.uid() = user_id);

-- Claim due jobs for sending: one worker wins each row (lease), retries after the lease expires, and a job that may have been sent is never resent.
create or replace function public.claim_reminder_jobs(p_limit int, p_lease_seconds int) returns setof public.reminder_jobs
language plpgsql security definer set search_path = '' as $$
begin
  return query
  update public.reminder_jobs j set status = 'sending', attempts = j.attempts + 1, lease_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
   where j.id in (select id from public.reminder_jobs where send_at <= now() and (status = 'pending' or (status = 'sending' and lease_until < now() and attempts < 3)) order by send_at limit p_limit for update skip locked)
  returning j.*;
end $$;
revoke all on function public.claim_reminder_jobs(int, int) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.claim_reminder_jobs(int, int) to service_role; end if; end $$;
notify pgrst, 'reload schema';
