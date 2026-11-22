-- plan_blocks.detail is NOT NULL: recovery sittings with no extra note store an empty string, like every other planner path.
-- In-place patch of the effective definition (checked anchor); ACLs preserved by CREATE OR REPLACE.
do $patch$
declare definition text; needle text := $old$t->>'title', nullif(t->>'detail', ''), t->>'task_type'$old$;
begin
  definition := pg_get_functiondef('public.accept_mock_recovery(uuid,text,uuid,integer,uuid,jsonb,jsonb)'::regprocedure);
  if position(needle in definition) = 0 then raise exception 'Unexpected accept_mock_recovery definition'; end if;
  execute replace(definition, needle, $new$t->>'title', coalesce(t->>'detail', ''), t->>'task_type'$new$);
end
$patch$;
