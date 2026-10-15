-- Account deletion (DELETE /api/account/delete) calls admin.auth.admin.deleteUser,
-- which relies on every table referencing auth.users having ON DELETE CASCADE to
-- actually remove the student's data. Five foreign keys never got one, added across
-- several earlier migrations before this was audited end to end: a student who had
-- logged a class, had a repair thread open, had done a weekly review, or (for a
-- reviewer) had granted/received a role, got a 500 on delete and nothing was removed
-- (the transaction rolls back, so at least no orphaned data — but deletion simply
-- didn't work). This is the complete list; every other auth.users reference in the
-- schema already cascades correctly.

alter table public.repair_threads drop constraint if exists repair_threads_user_id_fkey;
alter table public.repair_threads
  add constraint repair_threads_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.user_roles drop constraint if exists user_roles_user_id_fkey;
alter table public.user_roles
  add constraint user_roles_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

-- granted_by records who gave the role, not whose role it is — deleting the granter
-- should null out provenance, not cascade-delete someone else's still-valid role.
alter table public.user_roles drop constraint if exists user_roles_granted_by_fkey;
alter table public.user_roles
  add constraint user_roles_granted_by_fkey foreign key (granted_by) references auth.users(id) on delete set null;

alter table public.weekly_reviews drop constraint if exists weekly_reviews_user_id_fkey;
alter table public.weekly_reviews
  add constraint weekly_reviews_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.class_sessions drop constraint if exists class_sessions_user_id_fkey;
alter table public.class_sessions
  add constraint class_sessions_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
