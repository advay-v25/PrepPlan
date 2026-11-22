-- Replacing a roadmap is one transaction: retire the previous draft/active roadmap, insert the replacement and ALL its milestones, or nothing.
-- Before, the client code did these as separate requests, so a failed milestone insert could leave no active roadmap or a half-built one while the
-- UI said "nothing changed". Serialised with the student's other planning writers (scope_lock). A repeat of the same request (same input hash,
-- e.g. a lost response) returns the existing roadmap instead of building another. Service-role only.
create or replace function public.replace_roadmap(p_user uuid, p_activate boolean, p_roadmap jsonb, p_milestones jsonb, p_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_existing uuid;
begin
  if p_user is null or p_hash is null or length(p_hash) < 8 then raise exception 'Invalid roadmap request'; end if;
  perform public.scope_lock(p_user);
  select id into v_existing from public.study_roadmaps
   where user_id = p_user and inputs->>'hash' = p_hash and (status = 'active' or (status = 'draft' and not p_activate))
   order by generated_at desc limit 1;
  if v_existing is not null then return jsonb_build_object('ok', true, 'id', v_existing, 'replayed', true); end if;

  update public.study_roadmaps set status = 'superseded'
   where user_id = p_user and status = any (case when p_activate then array['draft', 'active'] else array['draft'] end);
  insert into public.study_roadmaps (user_id, exam_window_id, target_date, route, status, phases, inputs, feasibility, accepted_at)
  values (p_user, nullif(p_roadmap->>'exam_window_id', '')::uuid, (p_roadmap->>'target_date')::date, p_roadmap->>'route',
          case when p_activate then 'active' else 'draft' end, p_roadmap->'phases', coalesce(p_roadmap->'inputs', '{}'::jsonb) || jsonb_build_object('hash', p_hash),
          p_roadmap->'feasibility', case when p_activate then now() end)
  returning id into v_id;
  insert into public.roadmap_milestones (roadmap_id, user_id, phase, topic_ref, sequence, planned_start_week, planned_end_week, planned_start_date, planned_end_date, effort_weight)
  select v_id, p_user, m->>'phase', m->>'topic_ref', (m->>'sequence')::smallint, (m->>'planned_start_week')::smallint, (m->>'planned_end_week')::smallint,
         (m->>'planned_start_date')::date, (m->>'planned_end_date')::date, coalesce((m->>'effort_weight')::numeric, 0)
    from jsonb_array_elements(coalesce(p_milestones, '[]'::jsonb)) m;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.replace_roadmap(uuid, boolean, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.replace_roadmap(uuid, boolean, jsonb, jsonb, text) to service_role;
