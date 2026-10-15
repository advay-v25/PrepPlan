const fs = require('fs');

let content = fs.readFileSync('supabase/schema.sql', 'utf8');

// Replace CREATE POLICY "name" on public.table with DROP POLICY IF EXISTS "name" ON public.table; CREATE POLICY...
content = content.replace(/create policy "([^"]+)" on (public\.[^\s]+) (.*);/gi, 'drop policy if exists "$1" on $2;\ncreate policy "$1" on $2 $3;');

fs.writeFileSync('supabase/schema.sql', content);
