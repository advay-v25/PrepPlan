/** Phase 5 guard rails on the REAL development schema: the hold-out exception exists ONLY inside the service-role reservation command.
 *  Reads a fixture-bank record made with `fixture-bank create … --rehearsal=auto` (it neither creates nor removes fixtures) and uses one throwaway student.
 *  npm run rehearsal:db:test -- --confirm-target=<project-ref> --bank=<record file> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const bankFile = (args.find(a => a.startsWith('--bank=')) ?? '').slice(7); if (!bankFile) throw Error('--bank=<fixture record> is required')
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8'))
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 }); await c.connect(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const fails = async (p, re) => { try { await p; return false } catch (e) { return re.test(e.message) } }
  const u = await one('select gen_random_uuid()'); let appt = null
  try {
    await c.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [u, `rdb-${Date.now()}@example.invalid`]); await c.query('insert into public.profiles (id) values ($1) on conflict do nothing', [u])
    const man = await one('select id from public.curriculum_manifests where is_active limit 1')
    appt = await one("insert into public.mock_appointments (user_id, kind, planned_date) values ($1,'internal_rehearsal', current_date + 3) returning id", [u])
    const some = bank.items.slice(0, 5)
    const call = (s1, s2, a = appt) => c.query('select public.start_rehearsal($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb) as r', [u, a, man, s1, s2, '{}', 'test', '{}']).then(r => r.rows[0].r)

    console.log('The command refuses anything that is not two whole, independent, held-out sessions')
    const small = await call(some, some)
    ok('fewer than 90 + 90 questions is BANK_INSUFFICIENT and creates nothing', small.code === 'BANK_INSUFFICIENT' && Number(await one('select count(*) from public.mock_rehearsals where user_id=$1', [u])) === 0)
    const ninety = bank.items.slice(0, 90), dup = [...ninety.slice(0, 89), ninety[0]]
    const r1 = await call(dup, bank.items.slice(90, 180))
    ok('a repeated question is refused with the exact code', r1.code === 'BANK_CHANGED' && r1.defects.some(d => d.code === 'DUPLICATE_ITEM'), JSON.stringify(r1).slice(0, 200))
    const overlap = await call(ninety, [...ninety.slice(0, 5), ...bank.items.slice(90, 175)])
    ok('a question (or its family) shared by both sessions is refused', overlap.code === 'BANK_CHANGED' && overlap.defects.some(d => d.code === 'DUPLICATE_ITEM' || d.code === 'DUPLICATE_FAMILY'))
    ok('a refused reservation leaves no rehearsal, form, attempt or blueprint', Number(await one('select count(*) from public.mock_rehearsals where user_id=$1', [u])) === 0
      && Number(await one('select count(*) from public.assessment_attempts where user_id=$1', [u])) === 0)
    ok('an unknown appointment is refused', (await call(ninety, bank.items.slice(90, 180), await one('select gen_random_uuid()'))).code === 'NO_APPOINTMENT')
    const ext = await one("insert into public.mock_appointments (user_id, kind, planned_date) values ($1,'provider_mock', current_date + 4) returning id", [u])
    ok('an external mock cannot have a rehearsal', (await call(ninety, bank.items.slice(90, 180), ext)).code === 'NOT_INTERNAL')

    console.log('The hold-out exception does not exist outside the command')
    const blk = `rdb-${Date.now()}`
    await c.query('BEGIN')   // rolled back: nothing from this probe may persist
    ok('inserting a held-out question into a form directly is refused (no request or session can enable it)', await fails((async () => {
      const bp = await one("insert into public.assessment_blueprints (manifest_id, purpose, requested_scope, constraints) values ($1,'x','{}','{}') returning id", [man])
      const f = await one("insert into public.assessment_forms (blueprint_id, delivery_mode) values ($1,'fixed') returning id", [bp])
      await c.query('insert into public.form_items (form_id, item_id, sequence_number) values ($1,$2,1)', [f, some[0]])
    })(), /ITEM_HELD_OUT/))
    await c.query('ROLLBACK')
    ok('the setting is transaction-local: it is not on in this session', (await one("select coalesce(current_setting('app.holdout_form', true), 'unset')")) !== 'on')
    for (const [fn, sig] of [['start_rehearsal', 'uuid,uuid,uuid,text[],text[],jsonb,text,jsonb'], ['start_rehearsal_session', 'uuid,uuid'], ['rehearsal_item_defects', 'uuid,text[]']]) {
      ok(`${fn} is not executable by a signed-in student or anonymous caller`, (await one(`select has_function_privilege('authenticated','public.${fn}(${sig})','execute') or has_function_privilege('anon','public.${fn}(${sig})','execute')`)) === false)
    }
    ok('the held-out view is not readable by students', (await one("select has_table_privilege('authenticated','public.rehearsal_eligible_items','select') or has_table_privilege('anon','public.rehearsal_eligible_items','select')")) === false)
    ok('students cannot write appointments or rehearsals directly (writes go through commands)', (await one("select has_table_privilege('authenticated','public.mock_appointments','insert') or has_table_privilege('authenticated','public.mock_rehearsals','update')")) === false)
    ok('and cannot read another student’s appointments (row security on)', (await one("select relrowsecurity from pg_class where oid='public.mock_appointments'::regclass")) === true)
    console.log(`\n${n} checks passed`)
  } finally {
    await c.query('delete from public.mock_rehearsals where user_id=$1', [u]).catch(() => {}); await c.query('delete from public.mock_appointments where user_id=$1', [u]).catch(() => {})
    await c.query('delete from public.profiles where id=$1', [u]).catch(() => {}); await c.query('delete from auth.users where id=$1', [u]).catch(() => {}); await c.end()
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
