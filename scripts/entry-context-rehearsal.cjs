/** Rehearses 20261104_entry_context.sql on the REAL development schema inside a transaction that is ALWAYS rolled back.
 *  npm run entry:rehearse -- --confirm-target=<project-ref> [--already-applied]   (prints facts only, never row data) */
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
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='60s'")
    if (!args.includes('--already-applied')) await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261104_entry_context.sql'), 'utf8')))
    const [a, b] = [await one('select gen_random_uuid()'), await one('select gen_random_uuid()')]
    for (const u of [a, b]) {
      await c.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [u, `entry+${String(u).slice(0, 8)}@example.invalid`])
      await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [u])
    }
    const tops = (await c.query("select topic_id, array_agg(id order by sequence_hint) ids from public.learning_modules where topic_id is not null group by topic_id having count(*) >= 3 order by topic_id limit 3")).rows
    const [t1, t2, t3] = tops
    const state = async (u) => JSON.stringify((await c.query("select lm_id, coverage_state, source from public.user_module_state where user_id=$1 order by lm_id", [u])).rows)
    const counts = async (u) => JSON.stringify(await Promise.all(['plan_blocks', 'task_events', 'repair_threads', 'evidence_events', 'assessment_attempts', 'assessment_responses'].map(t => one(`select count(*) from public.${t} where user_id=$1`, [u]))))
    const before = await counts(a)

    // Coverage: a topic claim expands to its readings, a reading override refines one, another stays untouched.
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway',$2::jsonb)", [a, JSON.stringify([{ topic_id: t1.topic_id, recency: 'recent' }, { topic_id: t2.topic_id, recency: 'current' }])])
    const rows = (await c.query("select lm_id, coverage_state from public.user_module_state where user_id=$1", [a])).rows
    ok('the old 3-argument call still works (no new field required)', rows.length === t1.ids.length + t2.ids.length)
    ok('covered once becomes studied and partly covered becomes taught, per reading', rows.filter(r => t1.ids.includes(r.lm_id)).every(r => r.coverage_state === 'studied') && rows.filter(r => t2.ids.includes(r.lm_id)).every(r => r.coverage_state === 'taught'))
    ok('an unanswered topic has no coverage rows (not reported is not "not started")', !rows.some(r => t3.ids.includes(r.lm_id)))
    ok('no uncertainty or mock was invented', (await one('select count(*) from public.user_entry_uncertainty where user_id=$1', [a])) === '0' && (await one('select mock_date from public.profiles where id=$1', [a])) === null)

    // Another student's, and a class-sourced, row are never touched.
    await c.query("insert into public.user_module_state (user_id, lm_id, coverage_state, source) values ($1,$2,'studied','class')", [a, t3.ids[0]])
    await c.query("insert into public.user_module_state (user_id, lm_id, coverage_state, source) values ($1,$2,'studied','diagnostic')", [b, t1.ids[0]])
    const bState = await state(b)
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway',$2::jsonb,$3::jsonb)", [a, JSON.stringify([{ topic_id: t3.topic_id, recency: 'current' }]), JSON.stringify([{ lm_id: t3.ids[1], state: 'covered' }, { lm_id: t3.ids[2], state: 'not_started' }])])
    const after = Object.fromEntries((await c.query("select lm_id, coverage_state, source from public.user_module_state where user_id=$1", [a])).rows.map(r => [r.lm_id, `${r.coverage_state}/${r.source}`]))
    ok('a class-sourced row is not overwritten by a claim', after[t3.ids[0]] === 'studied/class')
    ok('a reading override refines the topic answer', after[t3.ids[1]] === 'studied/self_report')
    ok('"not started" on one reading removes that reading from the claim', after[t3.ids[2]] === undefined)
    ok('earlier topic claims were replaced by the new save, as before', !Object.keys(after).some(id => t1.ids.includes(id)))
    ok('another student’s rows are untouched', bState === await state(b))

    // Uncertainty: independent of coverage; null leaves it, [] clears it, 'none' is a real answer.
    const u1 = JSON.stringify([{ topic_id: t1.topic_id, level: 'several', lm_ids: [t1.ids[0]] }, { topic_id: t2.topic_id, level: 'none', lm_ids: [] }])
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway','[]'::jsonb,null,$2::jsonb)", [a, u1])
    ok('uncertainty is saved with an explicit "none" distinct from unanswered', (await one("select count(*) from public.user_entry_uncertainty where user_id=$1", [a])) === '2' && (await one("select level from public.user_entry_uncertainty where user_id=$1 and topic_id=$2", [a, t2.topic_id])) === 'none')
    ok('uncertainty needs no coverage (it was saved with an empty coverage claim)', (await one("select count(*) from public.user_module_state where user_id=$1 and source='self_report'", [a])) === '0')
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway','[]'::jsonb)", [a])
    ok('a save that does not mention uncertainty leaves it alone', (await one("select count(*) from public.user_entry_uncertainty where user_id=$1", [a])) === '2')
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway','[]'::jsonb,null,'[]'::jsonb)", [a])
    ok('an empty list clears it', (await one("select count(*) from public.user_entry_uncertainty where user_id=$1", [a])) === '0')

    // Mock: optional, kept when not mentioned, cleared when null, and tied to its kind.
    await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb,null,null,true,$2::jsonb)", [a, JSON.stringify({ date: '2030-06-01', kind: 'provider_mock' })])
    ok('a mock is saved', (await one("select mock_kind from public.profiles where id=$1", [a])) === 'provider_mock')
    await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb)", [a])
    ok('a save that does not mention the mock keeps it', (await one("select mock_kind from public.profiles where id=$1", [a])) === 'provider_mock')
    await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb,null,null,true,null)", [a])
    ok('null clears it', (await one("select mock_date from public.profiles where id=$1", [a])) === null)
    await c.query('SAVEPOINT m')
    let rejected = false
    try { await c.query("update public.profiles set mock_kind='other' where id=$1", [a]) } catch { rejected = true }
    await c.query('ROLLBACK TO m')
    ok('a mock kind without a date is refused by the database', rejected)

    // Evidence integrity: none of the above created a task, minute, answer, evidence or repair row.
    ok('claims created no tasks, minutes, evidence, answers or repair threads', before === await counts(a))

    // The weekly change token reacts to each new input.
    const cyc = await one('select gen_random_uuid()')
    const tok = () => one('select public.weekly_source_version($1,$2)', [a, cyc])
    const t0 = await tok()
    await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb,null,$2::jsonb)", [a, JSON.stringify([{ topic_id: t1.topic_id, level: 'few', lm_ids: [] }])])
    const t1k = await tok(); ok('the weekly change token reacts to reported uncertainty', t0 !== t1k)
    await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb,null,null,true,$2::jsonb)", [a, JSON.stringify({ date: '2030-06-01', kind: 'other' })])
    const t2k = await tok(); ok('the weekly change token reacts to the mock', t1k !== t2k)
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway','[]'::jsonb)", [a])
    ok('the weekly change token reacts to the starting stage', t2k !== await tok())

    // Ownership: a student can read their own uncertainty and never write it, nor the mock fields.
    await c.query("select public.onboarding_replace_position($1,'first_pass_underway','[]'::jsonb,null,$2::jsonb)", [b, JSON.stringify([{ topic_id: t1.topic_id, level: 'most', lm_ids: [] }])])
    const as = async (u, fn) => { await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [u, JSON.stringify({ sub: u, role: 'authenticated' })]); try { return await fn() } finally { await c.query('RESET ROLE') } }
    const denied = (u, sql, p) => as(u, async () => { try { await c.query('SAVEPOINT s'); await c.query(sql, p); await c.query('RELEASE s'); return false } catch (e) { await c.query('ROLLBACK TO s'); return /permission denied/.test(e.message) } })
    ok('a student reads their own uncertainty and not another student’s', (await as(b, async () => (await c.query('select 1 from public.user_entry_uncertainty')).rowCount)) === 1)
    ok('a student cannot write uncertainty', await denied(b, "insert into public.user_entry_uncertainty (user_id, topic_id, level) values ($1,'x','few')", [b]) && await denied(b, "delete from public.user_entry_uncertainty"))
    ok('a student cannot write their mock or stage directly', await denied(b, "update public.profiles set mock_date = current_date + 5, mock_kind='other' where id=$1", [b]) && await denied(b, "update public.profiles set stage='starting_fresh' where id=$1", [b]))
    ok('a student cannot call the position command', await denied(b, "select public.onboarding_replace_position($1,'starting_fresh','[]'::jsonb)", [b]))
    console.log(`\n${n} checks passed`)
  } catch (e) { console.error('ERR:', e.message); throw e } finally { await c.query('ROLLBACK').catch(() => {}); console.log('Rolled back; the database is unchanged.'); await c.end().catch(() => {}) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
