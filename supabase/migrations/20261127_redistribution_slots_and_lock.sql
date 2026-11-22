-- Redistribution validates again where it commits. apply_redistribution now takes the shared planning lock (scope_lock, the lock every
-- planning writer takes), refuses if ANY planning input changed since the plan was computed (current_week_source_hash, supplied by the
-- caller), and refuses a timed session whose extended interval would overlap another timed task. A competing placement, availability or
-- commitment edit therefore produces a stale refusal that the caller recomputes, never an overlap. reverse_redistribution takes the same lock.
drop function if exists public.apply_redistribution(uuid, text, jsonb);
create or replace function public.apply_redistribution(p_user uuid, p_source text, p_changes jsonb, p_input_hash text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_src public.plan_blocks%rowtype; v_rec public.redistribution_receipts%rowtype; v_c jsonb; v_row public.plan_blocks%rowtype;
  v_new integer; v_out jsonb := '[]'::jsonb; v_placed integer := 0; v_end timestamptz;
begin
  perform public.scope_lock(p_user);
  select * into v_src from public.plan_blocks where id = p_source and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_src.execution not in ('deferred', 'skipped') then return jsonb_build_object('ok', false, 'code', 'NOT_MISSED'); end if;
  select * into v_rec from public.redistribution_receipts where source_task_id = p_source and reversed_at is null;
  if found then return jsonb_build_object('ok', true, 'replayed', true, 'placed', v_rec.placed_minutes, 'changes', v_rec.changes); end if;
  if v_src.cycle_id is null or p_input_hash is distinct from public.current_week_source_hash(p_user, v_src.cycle_id) then
    raise exception 'REDISTRIBUTION_STALE: the week changed while this was being planned';
  end if;
  for v_c in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) order by value->>'task_id' loop
    select * into v_row from public.plan_blocks where id = v_c->>'task_id' and user_id = p_user for update;
    if not found or v_row.execution <> 'not_started' or v_row.cancelled_at is not null or v_row.revision <> (v_c->>'expected_revision')::int then
      raise exception 'REDISTRIBUTION_STALE: a session changed while this was being planned';
    end if;
    v_new := v_row.duration_minutes + (v_c->>'add_minutes')::int;
    if v_new > 180 or (v_c->>'add_minutes')::int <= 0 then raise exception 'REDISTRIBUTION_INVALID: a session cannot take that many minutes'; end if;
    if v_row.placement = 'timed' and v_row.starts_at is not null then
      v_end := v_row.starts_at + make_interval(mins => v_new);
      if exists (select 1 from public.plan_blocks o where o.user_id = p_user and o.id <> v_row.id and o.cancelled_at is null and o.execution not in ('cancelled')
                   and o.placement = 'timed' and o.starts_at is not null and o.starts_at < v_end and o.starts_at + make_interval(mins => coalesce(o.duration_minutes, 30)) > v_row.starts_at) then
        raise exception 'REDISTRIBUTION_OVERLAP: the longer session would overlap another timed task';
      end if;
    end if;
    update public.plan_blocks set duration_minutes = v_new, duration = v_new::text where id = v_row.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('task_id', v_row.id, 'title', v_row.title, 'date', v_row.local_date, 'before', v_row.duration_minutes, 'after', v_new));
    v_placed := v_placed + (v_c->>'add_minutes')::int;
  end loop;
  if v_placed = 0 then return jsonb_build_object('ok', true, 'replayed', false, 'placed', 0, 'changes', '[]'::jsonb); end if;
  insert into public.redistribution_receipts(user_id, cycle_id, source_task_id, source_minutes, placed_minutes, changes)
    values (p_user, v_src.cycle_id, p_source, v_src.duration_minutes, v_placed, v_out);
  return jsonb_build_object('ok', true, 'replayed', false, 'placed', v_placed, 'changes', v_out);
end $$;
revoke all on function public.apply_redistribution(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.apply_redistribution(uuid, text, jsonb, text) to service_role;

create or replace function public.reverse_redistribution(p_user uuid, p_source text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_rec public.redistribution_receipts%rowtype; v_c jsonb; v_row public.plan_blocks%rowtype; v_back jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb;
begin
  perform public.scope_lock(p_user);
  select * into v_rec from public.redistribution_receipts where source_task_id = p_source and user_id = p_user and reversed_at is null for update;
  if not found then return jsonb_build_object('ok', true, 'reversed', '[]'::jsonb, 'kept', '[]'::jsonb); end if;
  for v_c in select value from jsonb_array_elements(v_rec.changes) order by value->>'task_id' loop
    select * into v_row from public.plan_blocks where id = v_c->>'task_id' and user_id = p_user for update;
    if found and v_row.execution = 'not_started' and v_row.duration_minutes = (v_c->>'after')::int then
      update public.plan_blocks set duration_minutes = (v_c->>'before')::int, duration = (v_c->>'before') where id = v_row.id;
      v_back := v_back || jsonb_build_array(v_c);
    else v_kept := v_kept || jsonb_build_array(v_c); end if;
  end loop;
  update public.redistribution_receipts set reversed_at = now() where id = v_rec.id;
  return jsonb_build_object('ok', true, 'reversed', v_back, 'kept', v_kept);
end $$;
