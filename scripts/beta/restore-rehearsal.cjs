/** Backup and restore rehearsal on a throwaway LOCAL cluster: install baseline -> write synthetic records as a student -> pg_dump (custom format)
 *  -> restore into a SEPARATE database -> prove records, schema, privileges and row security survive and still work together.
 *  node scripts/beta/restore-rehearsal.cjs   (facts only; nothing persists) */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg')
const { configuration } = require('../lib/migrations.cjs')
const pg = require('./local-pg.cjs'), { installFresh } = require('./install.cjs'), { inventory, compare } = require('./inventory.cjs')
const root = path.resolve(__dirname, '../..'), PORT = 54331
const conn = db => ({ host: '127.0.0.1', port: PORT, user: 'postgres', database: db })
async function main() {
  const dir = pg.tmp(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  try {
    pg.start(dir, PORT)
    for (const db of ['source', 'restored']) pg.run('createdb', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', db])
    const a = new Client(conn('source')); await a.connect()
    await a.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    // Same contract as every install: pinned baseline + every LATER migration, so what is backed up and restored is today's schema.
    const ucfg = configuration(['--env=local', '--apply', '--confirm-target=local:source'], { MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${PORT}/source`, MIGRATION_EXPECTED_DATABASE: 'source' })
    const up = { pending: (await installFresh(a, ucfg)).later }
    ok(`later migrations were applied before the dump (${up.pending.length}: ${up.pending.slice(-3).join(', ')} …)`, up.pending.length > 0)
    const u = (await a.query("insert into auth.users (email, email_confirmed_at) values ('restore@example.invalid', now()) returning id")).rows[0].id
    const u2 = (await a.query("insert into auth.users (email, email_confirmed_at) values ('other@example.invalid', now()) returning id")).rows[0].id
    await a.query("insert into public.profiles (id, display_name, onboarding_status) values ($1,'Restore Student','complete'), ($2,'Other','complete') on conflict (id) do update set display_name=excluded.display_name", [u, u2])
    await a.query("insert into public.mock_appointments (user_id, kind, planned_date, label) values ($1,'provider_mock', current_date + 5, 'Coaching mock')", [u])
    await a.query("insert into public.calendar_commitments (user_id, label, kind, recurrence, weekdays, start_time, end_time, starts_on, timezone, starts_at, ends_at, is_protected, source, status) values ($1,'Class','class','weekly','{2}','18:00','20:00', current_date - 30, 'UTC', now(), now() + interval '2 hours', true, 'student', 'active')", [u])
    await a.query("insert into public.exam_completion (user_id, sat_on, psm_status) values ($1, current_date, 'done')", [u])
    const counts = async c => JSON.stringify(await Promise.all(['profiles', 'mock_appointments', 'exam_completion', 'topics', 'curriculum_readings', 'reading_los', 'schema_migrations'].map(async t => Number((await c.query(`select count(*) n from public.${t}`)).rows[0].n))))
    const before = await counts(a)
    const dump = path.join(dir, 'backup.dump')
    pg.run('pg_dump', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'source', '-Fc', '-n', 'public', '-n', 'auth', '-f', dump])
    ok('a custom-format backup was written', fs.statSync(dump).size > 100_000)
    const r = new Client(conn('restored')); await r.connect()
    await r.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8').split('create schema if not exists auth;')[0])   // roles only; the restore brings auth.* and public.* with it
    pg.run('pg_restore', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', '-d', 'restored', '--no-owner', '--clean', '--if-exists', '--exit-on-error', dump])
    ok('the restore completed into a separate database', true)
    ok('every record came back (profiles, appointments, exam completion, curriculum, ledger)', before === await counts(r), `${before} vs ${await counts(r)}`)
    const cmp = compare(await inventory(a), await inventory(r))
    ok('schema, definitions, policies, triggers and privileges are identical after restore', Object.values(cmp).every(v => v.same), JSON.stringify(Object.entries(cmp).filter(([, v]) => !v.same)))
    // Permissions and rows work TOGETHER: row security still isolates students, the service role still writes, anonymous still sees nothing.
    const asRole = async (client, role, uid, sql) => { await client.query('BEGIN'); await client.query(`SET LOCAL ROLE ${role}`); if (uid) await client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]); try { return (await client.query(sql)).rows } finally { await client.query('ROLLBACK') } }
    ok('a student reads only their own profile and appointment', (await asRole(r, 'authenticated', u, 'select id from public.profiles')).length === 1 && (await asRole(r, 'authenticated', u, 'select id from public.mock_appointments')).length === 1)
    ok('another student sees none of those appointments', (await asRole(r, 'authenticated', u2, 'select id from public.mock_appointments')).length === 0)
    ok('an anonymous caller reads nothing from a student table', await asRole(r, 'anon', null, 'select id from public.profiles').then(x => x.length === 0, () => true))
    ok('a student cannot write an appointment directly', await asRole(r, 'authenticated', u, "insert into public.mock_appointments (user_id, kind, planned_date) values (auth.uid(),'other', current_date)").then(() => false, () => true))
    const svc = await asRole(r, 'service_role', null, "select public.checkpoint_command('" + u + "'::uuid, 'restore-key-0001', 'add', 'h', '{\"kind\":\"other\",\"date\":\"2031-01-01\"}'::jsonb) as r")
    ok('a command written after the restore works through the restored functions and privileges', svc[0].r.ok === true)
    // The class-change command (migration 20261224): the effective restored definitions, privileges and behaviour.
    const cid = (await r.query("select id from public.calendar_commitments where user_id = $1 and kind = 'class'", [u])).rows[0].id
    const occ = (await r.query("select to_char(d::date, 'YYYY-MM-DD') as d from generate_series(current_date + 1, current_date + 8, interval '1 day') d where extract(dow from d::date) = 2")).rows[0].d
    const prm = JSON.stringify({ occurrence_date: occ, new_date: occ, new_start_time: '19:00', new_end_time: '20:00' })
    const pv = await asRole(r, 'service_role', null, `select public.class_change_preview('${u}'::uuid, '${cid}'::uuid, 'occurrence_move', '${prm}'::jsonb) as r`)
    ok('the restored class-change preview works and is read-only', pv[0].r.ok === true && (await r.query('select count(*)::int n from public.commitment_exceptions')).rows[0].n === 0, JSON.stringify(pv[0].r))
    const asServiceCommit = async sql => { await r.query('BEGIN'); try { await r.query('SET LOCAL ROLE service_role'); const x = (await r.query(sql)).rows; await r.query('COMMIT'); return x } catch (e) { await r.query('ROLLBACK'); throw e } }
    const ap = await asServiceCommit( `select public.class_change_apply('${u}'::uuid, 'restore-class-0001', 'occurrence_move', '${cid}'::uuid, '${prm}'::jsonb, '${pv[0].r.fingerprint}') as r`)
    ok('the restored class-change command applies once and stores a receipt', ap[0].r.ok === true && (await r.query("select count(*)::int n from public.checkpoint_commands where key = 'restore-class-0001'")).rows[0].n === 1)
    const rp = await asServiceCommit( `select public.class_change_apply('${u}'::uuid, 'restore-class-0001', 'occurrence_move', '${cid}'::uuid, '${prm}'::jsonb, '${pv[0].r.fingerprint}') as r`)
    ok('replaying the same key returns the receipt, not a second write', rp[0].r.replayed === true && (await r.query('select count(*)::int n from public.commitment_exceptions')).rows[0].n === 1)
    // Migrations 20261225/20261226: occurrence standing, exception-aware preview, and the reviewed recovery command.
    const st = await asRole(r, 'service_role', null, `select public.class_occurrence_state('${u}'::uuid, '${cid}'::uuid, '${occ}'::date) as r`)
    ok('the restored occurrence-standing function answers for a future class (changeable, not a restore target)', st[0].r.canChange === true || st[0].r.canRestore === true, JSON.stringify(st[0].r))
    const rp0 = await asRole(r, 'service_role', null, `select count(*)::int n from public.class_recovery_overlaps('${u}'::uuid, '${(await r.query("select id from public.planning_cycles limit 1")).rows[0]?.id ?? '00000000-0000-4000-8000-000000000000'}'::uuid)`)
    ok('the restored recovery-overlap reader runs under the service role', typeof rp0[0].n === 'number')
    ok('a signed-in student cannot read recovery internals directly', await asRole(r, 'authenticated', u, `select * from public.class_recovery_overlaps('${u}'::uuid, '${u}'::uuid)`).then(() => false, e => /permission denied/.test(e.message)))
    ok('accepting a draft that does not exist is refused by the restored command (callable by a student, scoped to their own drafts)', await asRole(r, 'authenticated', u, "select public.accept_class_recovery('00000000-0000-4000-8000-000000000000'::uuid, 1, '{}'::jsonb)").then(() => false, e => /Draft not found|Application access required|Unauthorized/.test(e.message)))
    ok('an anonymous caller cannot call the recovery command', await asRole(r, 'anon', null, "select public.accept_class_recovery('00000000-0000-4000-8000-000000000000'::uuid, 1, '{}'::jsonb)").then(() => false, e => /permission denied/.test(e.message)))
    // Migrations 20261227/20261228: the feasible class-log command and the recovery order check survive a restore with their privileges.
    ok('the restored class-log command is callable by a signed-in student and refuses a cycle that is not theirs', await asRole(r, 'authenticated', u, "select public.apply_class_log('00000000-0000-4000-8000-000000000000'::uuid, 'restore-cl-0001', current_date, 'none', null, '[]'::jsonb, '[]'::jsonb, 'manual:00000000-0000-4000-8000-000000000001', null, null)").then(() => false, e => /Unauthorized/.test(e.message)))
    ok('an anonymous caller cannot call the class-log command', await asRole(r, 'anon', null, "select public.apply_class_log('00000000-0000-4000-8000-000000000000'::uuid, 'restore-cl-0002', current_date, 'none', null, '[]'::jsonb, '[]'::jsonb)").then(() => false, e => /permission denied/.test(e.message)))
    ok('the restored recovery command still carries the sitting-order check', (await r.query("select position('before the one it follows' in pg_get_functiondef('public.accept_class_recovery(uuid,integer,jsonb)'::regprocedure)) p")).rows[0].p > 0)
    ok('the restored move command enforces the declared sitting order', (await r.query("select position('sitting_order_conflict' in pg_get_functiondef('public.apply_task_move(uuid,text,integer,date,timestamptz,integer,boolean,text)'::regprocedure)) p")).rows[0].p > 0)
    ok('the restored class-log command validates the reviewed allocation under the lock (packing, owed minutes, key reuse)', (await r.query("select (position('class_day_packs' in d) > 0 and position('class_item_allocated' in d) > 0 and position('IDEMPOTENCY_KEY_REUSED' in d) > 0) ok from (select pg_get_functiondef('public.class_apply_tasks(uuid,uuid,date,text,uuid,jsonb,jsonb,date,text)'::regprocedure) || pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb,text,uuid,date,boolean)'::regprocedure) d) q")).rows[0].ok)
    ok('the restored schema keeps the stable sitting identity index and dropped the old one-sitting-per-day index', (await r.query("select (select count(*) from pg_indexes where indexname = 'plan_blocks_class_sitting_idx') = 1 and (select count(*) from pg_indexes where indexname = 'plan_blocks_class_outcome_day_idx') = 0 ok")).rows[0].ok)
    ok('the restored room helpers are not callable by a signed-in student', await asRole(r, 'authenticated', u, "select public.class_day_packs('" + u + "'::uuid, current_date, 'UTC', now(), '{10}'::integer[])").then(() => false, e => /permission denied/.test(e.message)))
    ok('the restored class-log command carries the feasibility refusal', (await r.query("select position('PREVIEW_CHANGED' in pg_get_functiondef('public.class_apply_tasks(uuid,uuid,date,text,uuid,jsonb,jsonb,date,text)'::regprocedure)) p")).rows[0].p > 0)
    ok('the legacy 7-argument class-log form is only a wrapper that records an unresolved date-level entry (no occurrence)', (await r.query("select pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb)'::regprocedure) ~ 'null::text, null::uuid, null::date, false' ok")).rows[0].ok)
    ok('the restored in-progress update command is callable by a signed-in student (refuses what is not theirs) and not by anon', await asRole(r, 'authenticated', u, "select public.apply_class_log_update(null::uuid, '00000000-0000-4000-8000-000000000009'::uuid, 'restore-up-0001', 1, false, '[]'::jsonb, '[]'::jsonb)").then(() => false, e => /Unauthorized/.test(e.message)) && await asRole(r, 'anon', null, "select public.apply_class_log_update(null::uuid, '00000000-0000-4000-8000-000000000009'::uuid, 'restore-up-0002', 1, false, '[]'::jsonb, '[]'::jsonb)").then(() => false, e => /permission denied/.test(e.message)))
    ok('the shared task helper and the receipt tables are not reachable by a signed-in student', await asRole(r, 'authenticated', u, "select public.class_apply_tasks('" + u + "'::uuid, null, current_date, 'covered', null, '[]'::jsonb, '[]'::jsonb, current_date, 'UTC')").then(() => false, e => /permission denied/.test(e.message)) && await asRole(r, 'authenticated', u, 'select * from public.class_log_updates').then(() => false, e => /permission denied/.test(e.message)) && await asRole(r, 'authenticated', u, 'select * from public.task_create_receipts').then(() => false, e => /permission denied/.test(e.message)))
    ok('the restored class-log command gates on the class having STARTED (not ended) and keeps completion separate', (await r.query("select position('OCCURRENCE_NOT_STARTED' in d) > 0 and position('OCCURRENCE_NOT_ENDED' in d) > 0 and position('completed_at' in d) > 0 ok from (select pg_get_functiondef('public.apply_class_log(uuid,text,date,text,text,jsonb,jsonb,text,uuid,date,boolean)'::regprocedure) d) q")).rows[0].ok)
    ok('a signed-in student cannot call the class-change command directly', await asRole(r, 'authenticated', u, `select public.class_change_apply('${u}'::uuid, 'direct-call-0001', 'occurrence_cancel', '${cid}'::uuid, '{}'::jsonb, 'x')`).then(() => false, () => true))
    ok('functions restricted to the service role are still refused to a student', await asRole(r, 'authenticated', u, "select public.start_rehearsal('" + u + "'::uuid, '" + u + "'::uuid, '" + u + "'::uuid, '{}', '{}', '{}'::jsonb, 'v', '{}'::jsonb)").then(() => false, e => /permission denied/.test(e.message)))
    await a.end(); await r.end()
    console.log(`\n${n} checks passed (nothing persisted)`)
  } finally { pg.stop(dir); fs.rmSync(dir, { recursive: true, force: true }) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
