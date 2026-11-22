/** A comparable fingerprint of the public schema: per category, a sorted list of object names and one hash of their definitions. Read-only. */
const crypto = require('node:crypto')
/** Cleared reference/curriculum tables the baseline carries (never accounts, attempts, items, concepts or batches). Shared with make-baseline. */
const REFERENCE = ['beta_settings', 'topics', 'exam_windows', 'curriculum_manifests', 'learning_modules', 'curriculum_readings', 'reading_modules', 'reading_los', 'lm_edges', 'institutes', 'class_templates']
const h = rows => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16)
async function inventory(client) {
  await client.query("set time zone 'UTC'")   // row text renders timestamptz in the SESSION zone: the comparison must not depend on either server's zone
  const q = async (sql) => (await client.query(sql)).rows.map(r => Object.values(r).join('|')).sort()   // sorted here: database collations differ
  const cat = {
    tables: await q("select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1"),
    columns: await q("select table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') from information_schema.columns where table_schema='public' order by 1"),
    constraints: await q("select conrelid::regclass::text||'.'||conname||':'||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and contype<>'n' order by 1"),
    functions: await q("select p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1"),
    policies: await q("select tablename||'.'||policyname||':'||cmd||':'||coalesce(qual,'')||':'||coalesce(with_check,'') from pg_policies where schemaname='public' order by 1"),
    triggers: await q("select tgrelid::regclass::text||'.'||tgname||':'||md5(pg_get_triggerdef(t.oid)) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not tgisinternal order by 1"),
    authTriggers: await q("select tgname||':'||md5(regexp_replace(pg_get_triggerdef(t.oid), 'public\\.', '', 'g')) from pg_trigger t where tgrelid='auth.users'::regclass and not tgisinternal order by 1"),
    views: await q("select table_name||':'||md5(view_definition) from information_schema.views where table_schema='public' order by 1"),
    rls: await q("select relname||':'||relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1"),
    tableGrants: await q("select table_name||':'||grantee||':'||string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated','service_role') group by table_name, grantee order by 1"),
    indexes: await q("select tablename||'.'||indexname||':'||md5(indexdef) from pg_indexes where schemaname='public' order by 1"),
    ledger: await q('select version||\':\'||checksum from public.schema_migrations order by 1'),
    functionGrants: await q("select p.oid::regprocedure::text||':'||r.rolname from pg_proc p cross join pg_roles r where p.pronamespace='public'::regnamespace and r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid,p.oid,'execute') and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e') order by 1"),
  }
  const ref = []; for (const t of REFERENCE) ref.push((await client.query(`select '${t}:'||count(*)||':'||coalesce(md5(string_agg(x::text, '|' order by x::text)), '') v from public.${t} x`)).rows[0].v)
  cat.referenceData = ref.sort()
  return Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, { n: v.length, hash: h(v), list: v }]))
}
function compare(a, b) {
  const out = {}
  for (const k of Object.keys(a)) {
    const sa = new Set(a[k].list), sb = new Set(b[k].list)
    out[k] = { same: a[k].hash === b[k].hash, a: a[k].n, b: b[k].n, onlyA: [...sa].filter(x => !sb.has(x)).slice(0, 5), onlyB: [...sb].filter(x => !sa.has(x)).slice(0, 5) }
  }
  return out
}
module.exports = { inventory, compare, REFERENCE }
