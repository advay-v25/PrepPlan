-- Phase 5 follow-up: a held-out question pinned to one open rehearsal cannot be pinned to a second one for the same student.
create or replace function public.rehearsal_item_defects(p_user uuid, p_item_ids text[]) returns jsonb
language sql stable security definer set search_path = '' as $$
  with ids as (select x.id, x.ord from unnest(p_item_ids) with ordinality as x(id, ord)),
  exposed as (
    select r.item_id from public.assessment_responses r where r.user_id = p_user
    union
    select fi.item_id from public.form_items fi join public.assessment_attempts a on a.form_id = fi.form_id
     where a.user_id = p_user and a.status not in ('ready', 'assembling')),
  pinned as (
    select fi.item_id from public.form_items fi join public.assessment_attempts a on a.form_id = fi.form_id
      join public.mock_rehearsals r on r.id = a.rehearsal_id
     where a.user_id = p_user and r.status in ('ready', 'in_progress')),
  seen_fam as (select distinct i.family_id from (select item_id from exposed union select item_id from pinned) e join public.assessment_items i on i.id = e.item_id where i.family_id is not null),
  rows as (
    select ids.id, ids.ord, i.family_id, i.review_status, i.held_out, i.item_version,
           row_number() over (partition by ids.id order by ids.ord) as dup_item,
           case when i.family_id is null then 1 else row_number() over (partition by i.family_id order by ids.ord) end as dup_family
      from ids left join public.assessment_items i on i.id = ids.id)
  select coalesce(jsonb_agg(jsonb_build_object('itemId', d.id, 'code', d.code) order by d.ord), '[]'::jsonb) from (
    select r.id, r.ord, case
      when r.review_status is null then 'NOT_FOUND'
      when r.dup_item > 1 then 'DUPLICATE_ITEM'
      when r.review_status <> 'reviewed' then 'NOT_REVIEWED'
      when not r.held_out then 'NOT_HELD_OUT'
      when not exists (select 1 from public.item_review_decisions d where d.item_id = r.id and d.item_version = r.item_version and d.decision = 'approve') then 'NO_APPROVAL'
      when exists (select 1 from exposed e where e.item_id = r.id) then 'SEEN'
      when exists (select 1 from pinned p where p.item_id = r.id) then 'PINNED_ELSEWHERE'
      when r.family_id is not null and exists (select 1 from seen_fam s where s.family_id = r.family_id) then 'SEEN_FAMILY'
      when r.family_id is null then 'UNKNOWN_FAMILY'
      when r.dup_family > 1 then 'DUPLICATE_FAMILY'
      else null end as code
    from rows r) d
  where d.code is not null
$$;
revoke all on function public.rehearsal_item_defects(uuid, text[]) from public, anon, authenticated;
do $$ begin if to_regrole('service_role') is not null then grant execute on function public.rehearsal_item_defects(uuid, text[]) to service_role; end if; end $$;
notify pgrst, 'reload schema';
