-- A cell whose grounding is missing or contradictory is recorded as a precise BLOCKED cell at creation: terminal, no provider call, countable.
do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('public.create_item_batch(text,text,jsonb,jsonb)'::regprocedure) into v_def;
  if position('BLOCKED' in v_def) > 0 then return; end if;
  v_new := replace(v_def, E'  insert into public.item_batch_cells(batch_id, ordinal, cell)\n    select v_id, t.ord::int, t.cell from jsonb_array_elements(p_cells) with ordinality as t(cell, ord);',
    E'  insert into public.item_batch_cells(batch_id, ordinal, cell, status, verdict, defect_codes, failure_reason)\n    select v_id, t.ord::int, t.cell,\n      case when jsonb_array_length(coalesce(t.cell->''blocked'', ''[]''::jsonb)) > 0 then ''failed'' else ''pending'' end,\n      case when jsonb_array_length(coalesce(t.cell->''blocked'', ''[]''::jsonb)) > 0 then ''BLOCKED'' end,\n      case when jsonb_array_length(coalesce(t.cell->''blocked'', ''[]''::jsonb)) > 0 then (select array_agg(x) from jsonb_array_elements_text(t.cell->''blocked'') x) else ''{}''::text[] end,\n      case when jsonb_array_length(coalesce(t.cell->''blocked'', ''[]''::jsonb)) > 0 then left(coalesce(t.cell->>''blockedDetail'', ''Grounding is missing or contradictory.''), 600) end\n    from jsonb_array_elements(p_cells) with ordinality as t(cell, ord);\n  if not exists (select 1 from public.item_batch_cells where batch_id = v_id and status = ''pending'') then\n    update public.item_batches set status = ''failed'', finished_at = now(), last_error = ''Every cell was blocked before any provider call.'' where id = v_id;\n  end if;');
  if v_new = v_def then raise exception 'create_item_batch anchor not found; refusing to patch blindly'; end if;
  execute v_new;
end $$;
notify pgrst, 'reload schema';
