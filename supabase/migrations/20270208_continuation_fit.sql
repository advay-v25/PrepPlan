-- Weekly acceptance checked only the generated next-week rows. Placed continuations (v_actions[].continuation.placement.date) were inserted
-- afterwards with no fit check, and never counted against the rows they share a day with. The same whole-gap helper now sees both together.
-- Patched in place from the effective definition; fails loudly on drift. Floating continuations (no date) are not a day claim and are not checked.
do $patch$
declare definition text; needle text; replacement text;
begin
  definition := pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure);
  needle := E'clock_timestamp(), v_next->''rows'', ''local_date'', ''duration_minutes'', ''task_type'', ''placement'')';
  replacement := E'clock_timestamp(), coalesce(v_next->''rows'', ''[]''::jsonb) || coalesce((select jsonb_agg(jsonb_build_object(''local_date'', a->''continuation''->''placement''->>''date'', ''duration_minutes'', (a->''continuation''->>''minutes'')::int, ''task_type'', coalesce(b.task_type, ''study''), ''placement'', ''day_preferred'')) from jsonb_array_elements(v_actions) a left join public.plan_blocks b on b.id = a->>''taskId'' and b.user_id = v_user where jsonb_typeof(a->''continuation'') = ''object'' and nullif(a->''continuation''->''placement''->>''date'', '''') is not null), ''[]''::jsonb), ''local_date'', ''duration_minutes'', ''task_type'', ''placement'')';
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_weekly_transition definition'; end if;
  execute replace(definition, needle, replacement);
end
$patch$;
notify pgrst, 'reload schema';
