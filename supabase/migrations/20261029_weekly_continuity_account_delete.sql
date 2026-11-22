-- Auth account deletion cascades through profiles. The original plan_blocks FK
-- omitted its delete action, so any study task prevented the account deletion.
-- Keep task history protected against ordinary edits/deletion; remove the user's
-- owned tasks only when their profile is deleted through the existing account flow.
alter table public.plan_blocks
  drop constraint plan_blocks_user_id_fkey,
  add constraint plan_blocks_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
