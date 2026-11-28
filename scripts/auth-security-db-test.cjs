/** Disposable Postgres only. Proves fixed quotas and one-use recovery under concurrent connections. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { randomUUID } = require('node:crypto')
const { Client, Pool } = require('pg')
const pg = require('./beta/local-pg.cjs')

const port = 55489
const dir = pg.tmp()
const config = { host: '127.0.0.1', port, user: 'postgres', database: 'postgres' }
const client = new Client(config)
const pool = new Pool({ ...config, max: 8 })
let passes = 0
const check = (condition, name) => { assert.ok(condition, name); passes++; console.log('  pass ' + name) }
async function value(db, query, args = []) { return (await db.query(query, args)).rows[0].value }

async function main() {
  pg.start(dir, port)
  await client.connect()
  await client.query(fs.readFileSync('supabase/baseline/local-supabase-stub.sql', 'utf8'))
  await client.query(fs.readFileSync('supabase/migrations/20270126_auth_security.sql', 'utf8'))
  check(await value(client, "select not has_schema_privilege('authenticated','roadmap_security','USAGE') and not has_schema_privilege('anon','roadmap_security','USAGE') value"), 'private security tables are outside student access')
  check(await value(client, `select bool_and(not has_function_privilege('anon',oid,'EXECUTE')
    and not has_function_privilege('authenticated',oid,'EXECUTE')
    and has_function_privilege('service_role',oid,'EXECUTE')) value
    from pg_proc where pronamespace='public'::regnamespace and proname in ('security_password_recovery','security_session_is_active','security_take_rate_limit')`),
  'only the service role can call all three commands')
  const take = (scope, subject) => value(pool, 'select public.security_take_rate_limit($1,$2) value', [scope, subject])
  const hash = '1'.repeat(64)
  const concurrent = await Promise.all(Array.from({ length: 14 }, () => take('account_delete', hash)))
  check(concurrent.filter(seconds => seconds === 0).length === 8, 'concurrent account-delete requests take exactly eight places')
  check(concurrent.filter(seconds => seconds > 0).length === 6, 'denied requests receive a positive Retry-After')
  check((await take('account_delete', '2'.repeat(64))) === 0 && (await take('account_export', hash)) === 0, 'quotas are separate per scope and identity')
  await client.query("update roadmap_security.rate_limits set expires_at = clock_timestamp() - interval '1 second' where subject_hash=$1", [hash])
  check((await take('account_delete', hash)) === 0, 'quota resets after expiry')
  await assert.rejects(take('undefined', hash), { code: '22023' })
  passes++

  const u1 = randomUUID(), u2 = randomUUID(), s1 = randomUUID(), s2 = randomUUID(), s3 = randomUUID()
  await client.query('insert into auth.users(id) values($1),($2)', [u1, u2])
  await client.query('insert into auth.sessions(id,user_id) values($1,$2),($3,$2),($4,$5)', [s1, u1, s2, s3, u2])
  const grant = (action, user, session, request = null) => value(pool, 'select public.security_password_recovery($1,$2,$3,$4) value', [action, user, session, request])
  const key = randomUUID()
  check(!(await grant('open', u2, s1, key)), 'a recovery proof cannot be issued to a foreign session')
  check(await grant('open', u1, s1, key), 'a verified session can get a proof from the server')
  check(!(await grant('open', u1, s2, key)), 'one reset email only opens one session grant')
  check(await grant('check', u1, s1) && !(await grant('check', u1, s2)), 'only the bound session can see the proof')
  const consumers = await Promise.all([1, 2, 3, 4].map(() => grant('take', u1, s1)))
  check(consumers.filter(Boolean).length === 1 && !(await grant('check', u1, s1)), 'concurrent consumers take it exactly once')
  check(await grant('open', u1, s2, randomUUID()), 'a separate email can get a new recovery grant')
  await client.query("update roadmap_security.recovery_grants set expires_at=clock_timestamp()-interval '1 second' where session_id=$1", [s2])
  check(!(await grant('check', u1, s2)) && !(await grant('take', u1, s2)), 'an expired proof cannot be used')
  await client.query('delete from auth.sessions where id=$1', [s1])
  check(!(await value(client, 'select public.security_session_is_active($1,$2) value', [u1, s1])), 'a revoked provider session no longer qualifies for sensitive actions')
  check(!(await value(client, 'select exists(select from roadmap_security.recovery_grants where session_id=$1) value', [s1])), 'provider session deletion cascades to the proof')

  await client.query(`
    create table public.assessment_blueprints (id uuid primary key);
    create table public.assessment_forms (id uuid primary key, blueprint_id uuid references public.assessment_blueprints);
    create table public.assessment_attempts (user_id uuid, form_id uuid references public.assessment_forms);
    create table public.user_roles (user_id uuid);
    create table public.curriculum_notes (user_id uuid);
    create table public.questions (id uuid);
    create table public.source_references (id uuid);
    alter table public.assessment_blueprints enable row level security;
    alter table public.assessment_forms enable row level security;
    alter table public.assessment_attempts enable row level security;
    create policy forms_read_all on public.assessment_forms for select using (true);
    create policy blueprints_read_all on public.assessment_blueprints for select using (true);
    create policy attempts_own on public.assessment_attempts to authenticated using (user_id=auth.uid());
    grant all on all tables in schema public to anon, authenticated;
  `)
  const b1 = randomUUID(), b2 = randomUUID(), f1 = randomUUID(), f2 = randomUUID()
  await client.query('insert into public.assessment_blueprints values($1),($2)', [b1, b2])
  await client.query('insert into public.assessment_forms values($1,$2),($3,$4)', [f1, b1, f2, b2])
  await client.query('insert into public.assessment_attempts values($1,$2),($3,$4)', [u1, f1, u2, f2])
  await client.query(fs.readFileSync('supabase/migrations/20270127_private_assessment_metadata.sql', 'utf8'))
  check(await value(client, "select not has_table_privilege('anon', 'public.assessment_forms', 'SELECT') and not has_table_privilege('anon', 'public.assessment_blueprints', 'SELECT') value"), 'guests cannot read paper metadata')
  check(await value(client, "select not has_table_privilege('authenticated', 'public.questions', 'SELECT') and not has_table_privilege('authenticated', 'public.source_references', 'SELECT') value"), 'students cannot read the legacy question and source stores')
  check(await value(client, "select not has_table_privilege('authenticated', 'public.curriculum_notes', 'UPDATE') and not has_table_privilege('authenticated', 'public.user_roles', 'INSERT') value"), 'students cannot bypass note validation or directly write roles')
  await client.query('begin')
  await client.query('set local role authenticated')
  await client.query("select set_config('request.jwt.claim.sub',$1,true)", [u1])
  const linked = (await client.query('select f.id form, b.id blueprint from public.assessment_forms f join public.assessment_blueprints b on b.id=f.blueprint_id')).rows
  await client.query('rollback')
  check(linked.length === 1 && linked[0].form === f1 && linked[0].blueprint === b1, 'one student reads their form and blueprint only')

  await client.query(`
    alter table auth.users add column if not exists raw_user_meta_data jsonb;
    create table public.profiles (id uuid primary key, display_name text, untouched boolean);
    insert into public.profiles (id, display_name) values ('${u1}', 'Old123');
  `)
  await client.query(fs.readFileSync('supabase/migrations/20270129_profile_name_validation.sql', 'utf8'))
  await client.query('create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()')
  const created = randomUUID()
  await client.query('insert into auth.users (id, raw_user_meta_data) values ($1,$2)', [created, { full_name: 'Name42' }])
  check(await value(client, "select display_name = 'Student' value from public.profiles where id = $1", [created]), 'unexpected provider metadata gets a safe profile name')
  await client.query('update public.profiles set untouched=true where id=$1', [u1])
  await assert.rejects(client.query('update public.profiles set display_name=$2 where id=$1', [u1, 'Name42']), { code: '23514' })
  passes++
  for (const bad of ["-Anne", "Anne-", "Anne--Marie", "O''Brien", "O'-Brien", "Anne - Marie", "O'"]) await assert.rejects(client.query('update public.profiles set display_name=$2 where id=$1', [u1, bad]), { code: '23514' })
  passes++
  for (const good of ['Anne-Marie', "O'Brien", 'O’Brien']) await client.query('update public.profiles set display_name=$2 where id=$1', [u1, good])
  passes++
  const imported = randomUUID()
  await client.query('insert into auth.users (id, raw_user_meta_data) values ($1,$2)', [imported, { full_name: 'Anne-Marie  O’Brien' }])
  check(await value(client, "select display_name = 'Anne-Marie O’Brien' value from public.profiles where id = $1", [imported]), 'Google-imported hyphen and apostrophe names are kept and tidied')
  await client.query('update public.profiles set display_name=$2 where id=$1', [u1, 'आदित्य शिंदे'])
  check(await value(client, 'select untouched and display_name = $2 value from public.profiles where id=$1', [u1, 'आदित्य शिंदे']), 'legacy profiles remain editable and legitimate Unicode names save')
  check(await value(client, "select not has_function_privilege('anon','public.valid_profile_name(text)','EXECUTE') value"), 'database name validation is private')
  console.log(passes + ' database security checks passed')
}

main().catch(error => { console.error(error.message); process.exitCode = 1 }).finally(async () => {
  await pool.end()
  await client.end()
  pg.stop(dir)
  fs.rmSync(dir, { recursive: true, force: true })
})
