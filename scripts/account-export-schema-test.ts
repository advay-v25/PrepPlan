/** Scoped, read-only schema-drift check for the personal-data export and deletion graph. Needs SUPABASE_DB_PASSWORD (read-only queries). */
import { createRequire } from 'node:module'
import path from 'node:path'
import { OWNED_TABLES, PARENT_OWNED, EXCLUDED_TABLES } from '../src/lib/account/export'
const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs')
let p = 0, f = 0
const ok = (n: string, c: boolean, d = '') => { c ? (p++, console.log('  ✓', n)) : (f++, console.log('  ✗', n, d)) }
;(async () => {
  const c = connect(); await c.connect()
  try {
    const q = async (s: string, a: unknown[] = []) => (await c.query(s, a)).rows
    const live = (await q(`select distinct c.table_name t from information_schema.columns c join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema and t.table_type='BASE TABLE' where c.table_schema='public' and c.column_name='user_id'`)).map(r => r.t as string).sort()
    const owned = Object.keys(OWNED_TABLES).sort()
    ok('OWNED_TABLES equals every public table with a user_id column', JSON.stringify(owned) === JSON.stringify(live), JSON.stringify({ missing: live.filter(t => !owned.includes(t)), stale: owned.filter(t => !live.includes(t)) }))
    const pks = Object.fromEntries((await q(`select cl.relname t, array_agg(a.attname::text order by x.ord) cols from pg_constraint k join pg_class cl on cl.oid=k.conrelid join pg_namespace n on n.oid=cl.relnamespace cross join lateral unnest(k.conkey) with ordinality x(attnum,ord) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=x.attnum where k.contype='p' and n.nspname='public' group by 1`)).map(r => [r.t, r.cols as string[]]))
    const wrong = [...Object.entries(OWNED_TABLES), ...PARENT_OWNED.map(x => [x.table, x.key] as const)].filter(([t, k]) => t !== 'user_rate_estimate' && JSON.stringify(pks[t]) !== JSON.stringify(k)).map(([t]) => t)
    ok('every paging key is the live primary key (deterministic, unique ordering)', wrong.length === 0, wrong.join())
    const known = new Set([...owned, ...PARENT_OWNED.map(x => x.table), ...Object.keys(EXCLUDED_TABLES), 'profiles'])
    const fk = await q(`select distinct cl.relname child from pg_constraint k join pg_class cl on cl.oid=k.conrelid join pg_namespace n on n.oid=cl.relnamespace join pg_class cf on cf.oid=k.confrelid join pg_namespace nf on nf.oid=cf.relnamespace where k.contype='f' and n.nspname='public' and ((nf.nspname='auth' and cf.relname='users') or (nf.nspname='public' and cf.relname = any($1)))`, [[...owned, 'profiles']])
    const unknown = fk.map(r => r.child as string).filter(t => !known.has(t))
    ok('every table that references an account or an owned row is exported, parent-owned, or excluded with a reason', unknown.length === 0, unknown.join())
    let parentOk = true
    for (const x of PARENT_OWNED) parentOk &&= (await q(`select 1 from pg_constraint k join pg_class cl on cl.oid=k.conrelid join pg_class cf on cf.oid=k.confrelid join pg_attribute a on a.attrelid=k.conrelid and a.attnum=k.conkey[1] where k.contype='f' and cl.relname=$1 and cf.relname=$2 and a.attname=$3`, [x.table, x.parent, x.fk])).length === 1
    ok('each parent-owned table really references its declared parent column', parentOk)
  } finally { await c.end() }
  console.log(`\n${p} passed, ${f} failed`); process.exit(f ? 1 : 0)
})()
