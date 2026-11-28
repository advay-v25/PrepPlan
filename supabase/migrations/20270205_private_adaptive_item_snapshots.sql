-- The server is the only reader of pinned answers. The owned API exposes feedback
-- only after the step has been committed.
revoke select on table public.adaptive_item_steps from public, anon, authenticated;

-- Serialize receipt lookup with starts and answers for the same student.
do $$
declare
  fn regprocedure;
  definition text;
  marker text := '  select * into v_rec from public.adaptive_item_receipts';
  lock_call text := '  perform pg_advisory_xact_lock(hashtextextended(''adaptive-item:'' || p_user::text, 0));';
begin
  foreach fn in array array[
    'public.adaptive_item_start(uuid,text,text,uuid,text,text[],text,integer,uuid,text)'::regprocedure,
    'public.adaptive_item_commit(uuid,uuid,integer,text,text,integer,text,text,text,integer,uuid,text)'::regprocedure
  ] loop
    definition := pg_get_functiondef(fn);
    if strpos(definition, marker) = 0 then raise exception 'Adaptive receipt lookup is missing in %', fn; end if;
    definition := replace(definition, marker, lock_call || E'\n' || marker);
    if fn::text like 'adaptive_item_start(%' or fn::text like 'public.adaptive_item_start(%' then
      definition := replace(definition, '      and e.lm_id = p_reading_id',
        E'      and e.lm_id = p_reading_id\n      and (coalesce(cardinality(p_outcome_ids), 0) = 0 or e.outcome_id = any(p_outcome_ids))');
    else
      definition := replace(definition, '      and e.lm_id = v_run.reading_id',
        E'      and e.lm_id = v_run.reading_id\n      and (cardinality(v_run.outcome_ids) = 0 or e.outcome_id = any(v_run.outcome_ids))');
      definition := replace(definition, '  if p_next_item_id is not null then', $guard$
  if p_next_tier is distinct from (
    case v_committed_outcome
      when 'correct' then case v_run.target_tier when 'foundation' then 'standard' else 'difficult' end
      when 'incorrect' then case v_run.target_tier when 'difficult' then 'standard' else 'foundation' end
      else v_run.target_tier
    end
  ) then
    return jsonb_build_object('ok', false, 'code', 'BANK_CHANGED');
  end if;

  if p_next_item_id is not null then$guard$);
    end if;
    execute definition;
  end loop;
end $$;
