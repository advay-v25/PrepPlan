-- A generator failure has no draft to store. The rejected-drafts table required
-- one, so generation errors were dropped instead of entering the §11.2
-- defect-labelled corpus — losing exactly the failures worth learning from.
alter table public.rejected_item_drafts alter column draft drop not null;
alter table public.rejected_item_drafts add column if not exists stage text not null default 'verification'
  check (stage in ('generation', 'verification'));

notify pgrst, 'reload schema';
