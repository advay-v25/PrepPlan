-- Redistribution of missed work, made exact. Each missed task is absorbed AT MOST ONCE (a receipt per source task), in one transaction,
-- into later sessions of the same reading, and the receipt records the minutes actually committed so Undo can reverse exactly those.
create table if not exists public.redistribution_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cycle_id uuid,
  source_task_id text not null,
  source_minutes integer not null,
  placed_minutes integer not null,
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  reversed_at timestamptz
);
create unique index if not exists redistribution_receipts_active_idx on public.redistribution_receipts(source_task_id) where reversed_at is null;
alter table public.redistribution_receipts enable row level security;
revoke all on public.redistribution_receipts from anon, authenticated;

create or replace function public.apply_redistribution(p_user uuid, p_source text, p_changes jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_src public.plan_blocks%rowtype; v_rec public.redistribution_receipts%rowtype; v_c jsonb; v_row public.plan_blocks%rowtype;
  v_new integer; v_out jsonb := '[]'::jsonb; v_placed integer := 0;
begin
  select * into v_src from public.plan_blocks where id = p_source and user_id = p_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if v_src.execution not in ('deferred', 'skipped') then return jsonb_build_object('ok', false, 'code', 'NOT_MISSED'); end if;
  select * into v_rec from public.redistribution_receipts where source_task_id = p_source and reversed_at is null;
  if found then return jsonb_build_object('ok', true, 'replayed', true, 'placed', v_rec.placed_minutes, 'changes', v_rec.changes); end if;
  for v_c in select value from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) order by value->>'task_id' loop
    select * into v_row from public.plan_blocks where id = v_c->>'task_id' and user_id = p_user for update;
    if not found or v_row.execution <> 'not_started' or v_row.cancelled_at is not null or v_row.revision <> (v_c->>'expected_revision')::int then
      raise exception 'REDISTRIBUTION_STALE: a session changed while this was being planned';
    end if;
    v_new := v_row.duration_minutes + (v_c->>'add_minutes')::int;
    if v_new > 180 or (v_c->>'add_minutes')::int <= 0 then raise exception 'REDISTRIBUTION_INVALID: a session cannot take that many minutes'; end if;
    update public.plan_blocks set duration_minutes = v_new, duration = v_new::text where id = v_row.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('task_id', v_row.id, 'title', v_row.title, 'date', v_row.local_date, 'before', v_row.duration_minutes, 'after', v_new));
    v_placed := v_placed + (v_c->>'add_minutes')::int;
  end loop;
  if v_placed = 0 then return jsonb_build_object('ok', true, 'replayed', false, 'placed', 0, 'changes', '[]'::jsonb); end if;
  insert into public.redistribution_receipts(user_id, cycle_id, source_task_id, source_minutes, placed_minutes, changes)
    values (p_user, v_src.cycle_id, p_source, v_src.duration_minutes, v_placed, v_out);
  return jsonb_build_object('ok', true, 'replayed', false, 'placed', v_placed, 'changes', v_out);
end $$;

-- Undo / re-placement of the missed task takes back exactly what its receipt added, where the receiving session is still as it was left.
create or replace function public.reverse_redistribution(p_user uuid, p_source text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare v_rec public.redistribution_receipts%rowtype; v_c jsonb; v_row public.plan_blocks%rowtype; v_back jsonb := '[]'::jsonb; v_kept jsonb := '[]'::jsonb;
begin
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
revoke all on function public.apply_redistribution(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.reverse_redistribution(uuid, text) from public, anon, authenticated;
grant execute on function public.apply_redistribution(uuid, text, jsonb) to service_role;
grant execute on function public.reverse_redistribution(uuid, text) to service_role;
