/** Rehearses 20261105_mock_checkpoint.sql on the REAL development schema inside a transaction that is ALWAYS rolled back.
 *  npm run mock:rehearse -- --confirm-target=<project-ref> [--already-applied]   (prints facts only, never row data) */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration, transactionalSql } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..')
  const env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: the database stopped responding. Nothing persists.'); process.exit(2) }, 180000).unref()
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 70000 })
  await c.connect(); let n = 0
  const ok = (name, v) => { assert.ok(v, name); n++; console.log(`  ✓ ${name}`) }
  const one = async (s, a) => Object.values((await c.query(s, a)).rows[0] ?? { v: null })[0]
  const refuses = async (sql, p) => { await c.query('SAVEPOINT r'); try { await c.query(sql, p); await c.query('RELEASE r'); return false } catch { await c.query('ROLLBACK TO r'); return true } }
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='60s'")
    if (!args.includes('--already-applied')) await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261105_mock_checkpoint.sql'), 'utf8')))
    const [a, b] = [await one('select gen_random_uuid()'), await one('select gen_random_uuid()')]
    for (const u of [a, b]) {
      await c.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [u, `mock+${String(u).slice(0, 8)}@example.invalid`])
      await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [u])
    }
    // Timing lives with the existing checkpoint; a date alone is valid; clearing the date clears the timing.
    await c.query("update public.profiles set mock_date='2030-06-01', mock_kind='provider_mock' where id=$1", [a])
    ok('a date-only checkpoint is valid (no time, length or label invented)', (await one('select mock_start_time is null and mock_duration_minutes is null and mock_label is null from public.profiles where id=$1', [a])) === true)
    await c.query("update public.profiles set mock_start_time='14:30', mock_duration_minutes=180, mock_label='Coaching mock' where id=$1", [a])
    await c.query("update public.profiles set mock_date='2030-06-08' where id=$1", [a])
    ok('moving the date keeps the details the student gave', (await one('select mock_label from public.profiles where id=$1', [a])) === 'Coaching mock' && (await one('select mock_duration_minutes from public.profiles where id=$1', [a])) === 180)
    await c.query("update public.profiles set mock_date=null, mock_kind=null where id=$1", [a])
    ok('clearing the date clears its timing in the same write', (await one('select mock_start_time is null and mock_duration_minutes is null and mock_label is null from public.profiles where id=$1', [a])) === true)
    ok('timing without a date is refused', await refuses("update public.profiles set mock_start_time='09:00' where id=$1", [a]))
    await c.query("update public.profiles set mock_date='2030-06-01', mock_kind='other' where id=$1", [a])
    ok('a length outside 15 min to 8 h is refused', await refuses("update public.profiles set mock_duration_minutes=5 where id=$1", [a]) && await refuses("update public.profiles set mock_duration_minutes=600 where id=$1", [a]))
    ok('an empty or over-long label is refused', await refuses("update public.profiles set mock_label='' where id=$1", [a]) && await refuses("update public.profiles set mock_label=$2 where id=$1", [a, 'x'.repeat(81)]))

    // Choice: one per student per week; only the three values.
    await c.query("insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-05-27','later')", [a])
    ok('one choice per week (a second is refused, not duplicated)', await refuses("insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-05-27','use_mock')", [a]))
    ok('an unknown choice is refused', await refuses("insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-06-03','both')", [a]))

    // Outcome: one row per planned date, three outcomes, nothing that looks like a score or response.
    // Since 20261106 outcomes are append-only history: one per (checkpoint, planned date). Legacy rows (no checkpoint) are not constrained.
    const ck = await one('select gen_random_uuid()')
    await c.query("insert into public.mock_outcomes (user_id, checkpoint_id, planned_date, kind, outcome, reported_result) values ($1,$2,'2030-06-01','other','taken','62%')", [a, ck])
    ok('an outcome is recorded once per checkpoint and planned date', await refuses("insert into public.mock_outcomes (user_id, checkpoint_id, planned_date, kind, outcome) values ($1,$2,'2030-06-01','other','not_taken')", [a, ck]))
    ok('an unknown outcome is refused', await refuses("insert into public.mock_outcomes (user_id, planned_date, kind, outcome) values ($1,'2030-06-09','other','passed')", [a]))
    const noScoreColumns = (await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='mock_outcomes'")).rows.map(r => r.column_name)
    ok('the outcome table has no score, response, concept or readiness column', !noScoreColumns.some(x => /score|response|concept|readiness|correct/.test(x)))

    // Evidence integrity.
    const counts = async (u) => JSON.stringify(await Promise.all(['plan_blocks', 'task_events', 'repair_threads', 'evidence_events', 'assessment_attempts', 'assessment_responses'].map(t => one(`select count(*) from public.${t} where user_id=$1`, [u]))))
    ok('recording a checkpoint, choice and outcome created no tasks, evidence, answers or repair threads', await counts(a) === await counts(b))

    // The weekly change token reacts.
    const cyc = await one('select gen_random_uuid()')
    const tok = () => one('select public.weekly_source_version($1,$2)', [a, cyc])
    const t0 = await tok()
    await c.query("update public.profiles set mock_start_time='09:00' where id=$1", [a]); const t1 = await tok(); ok('the weekly change token reacts to the mock’s time', t0 !== t1)
    await c.query("update public.cycle_assessment_choices set choice='use_mock' where user_id=$1", [a]); const t2 = await tok(); ok('the weekly change token reacts to the assessment choice', t1 !== t2)
    await c.query("update public.mock_outcomes set outcome='not_taken', reported_result=null where user_id=$1", [a]); ok('the weekly change token reacts to a recorded outcome', t2 !== await tok())

    // Ownership.
    const as = async (u, fn) => { await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [u, JSON.stringify({ sub: u, role: 'authenticated' })]); try { return await fn() } finally { await c.query('RESET ROLE') } }
    const denied = (u, sql, p) => as(u, async () => { try { await c.query('SAVEPOINT s'); await c.query(sql, p); await c.query('RELEASE s'); return false } catch (e) { await c.query('ROLLBACK TO s'); return /permission denied/.test(e.message) } })
    ok('a student reads their own choice and outcome, and not another student’s', (await as(a, async () => (await c.query('select 1 from public.cycle_assessment_choices')).rowCount)) === 1 && (await as(b, async () => (await c.query('select 1 from public.mock_outcomes')).rowCount)) === 0)
    ok('a student cannot write choices or outcomes', await denied(b, "insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-06-03','later')", [b]) && await denied(b, "insert into public.mock_outcomes (user_id, planned_date, kind, outcome) values ($1,'2030-06-09','other','taken')", [b]) && await denied(a, "delete from public.mock_outcomes"))
    ok('a student cannot write their mock details directly', await denied(b, "update public.profiles set mock_label='x' where id=$1", [b]))
    console.log(`\n${n} checks passed`)
  } catch (e) { console.error('ERR:', e.message); throw e } finally { await c.query('ROLLBACK').catch(() => {}); console.log('Rolled back; the database is unchanged.'); await c.end().catch(() => {}) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
