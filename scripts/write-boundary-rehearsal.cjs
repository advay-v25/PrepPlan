/** Proves the write boundary on the REAL development schema as an actual `authenticated` database role, inside a transaction that is ALWAYS rolled back.
 *  npm run boundary:rehearse -- --confirm-target=<project-ref> [--already-applied]  (reads only .env.staging.local; prints facts, never row data) */
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
    if (!args.includes('--already-applied')) await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261101_write_boundary.sql'), 'utf8')))
    const [a, b] = [await one('select gen_random_uuid()'), await one('select gen_random_uuid()')]
    for (const u of [a, b]) {
      await c.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [u, `boundary+${String(u).slice(0, 8)}@example.invalid`])
      await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [u])
    }
    await c.query("update public.profiles set onboarding_status='in_progress', display_name='Orig' where id = any($1)", [[a, b]])
    const cyc = await one('select gen_random_uuid()')
    await c.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, a])
    await c.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,day,duration,detail,duration_minutes,task_type,priority,placement,execution,origin,created_by,learning_objective,suggested_approach,completion_meaning,local_date) values ('bnd-task',$1,$2,'T','2030-01-08','45','d',45,'study','core','day_preferred','not_started','planner','algorithm','O','A','D',date '2030-01-08')`, [a, cyc])
    const as = async (u, fn) => { await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [u, JSON.stringify({ sub: u, role: 'authenticated' })]); try { return await fn() } finally { await c.query('RESET ROLE') } }
    const denied = (u, sql, p) => as(u, async () => { try { await c.query('SAVEPOINT s'); await c.query(sql, p); await c.query('RELEASE s'); return false } catch (e) { await c.query('ROLLBACK TO s'); return /permission denied/.test(e.message) } })
    const rows = (u, sql, p) => as(u, async () => (await c.query(sql, p)).rowCount)

    ok('a student cannot insert a task', await denied(a, "insert into public.plan_blocks (id,user_id,title,day,duration) values ('x',$1,'x','Mon','1')", [a]))
    ok('a student cannot edit or delete a task', await denied(a, "update public.plan_blocks set title='x' where id='bnd-task'") && await denied(a, "delete from public.plan_blocks where id='bnd-task'"))
    ok('a student cannot write cycles, drafts or task history', await denied(a, "update public.planning_cycles set status='closed' where id=$1", [cyc]) && await denied(a, "delete from public.plan_drafts") && await denied(a, "delete from public.task_events"))
    ok('a student still reads their own task and not another student’s', (await rows(a, "select 1 from public.plan_blocks where id='bnd-task'")) === 1 && (await rows(b, "select 1 from public.plan_blocks where id='bnd-task'")) === 0)
    if (args.includes('--with-attempt-revoke')) ok('a student cannot create an assessment attempt', await denied(a, "insert into public.assessment_attempts (user_id,status) values ($1,'scored')", [a]))
    ok('a student cannot set their own onboarding status', await denied(a, "update public.profiles set onboarding_status='complete' where id=$1", [a]))
    ok('a student cannot create or delete profiles', await denied(b, "insert into public.profiles (id) values (gen_random_uuid())") && await denied(a, "delete from public.profiles where id=$1", [a]))
    const own = args.includes('--with-state-ownership')
    if (own) {
      ok('a student cannot write their profile directly (Settings goes through the validated route)', await denied(a, "update public.profiles set display_name='New' where id=$1", [a]))
      for (const t of ['exam_attempts', 'calendar_commitments', 'commitment_exceptions', 'coach_messages', 'user_module_state', 'study_roadmaps', 'roadmap_milestones'])
        ok(`a student cannot write ${t}`, await denied(a, `delete from public.${t} where user_id=$1`, [a]))
    } else {
      ok('Settings and classes-completed edits still work', (await rows(a, "update public.profiles set display_name='New', max_session_minutes=90, prep_mode=prep_mode, classes_completed_at=null, updated_at=now() where id=$1", [a])) === 1)
    }
    ok('a student cannot edit another student’s profile', own ? await denied(a, "update public.profiles set display_name='Hacked' where id=$1", [b]) : (await rows(a, "update public.profiles set display_name='Hacked' where id=$1", [b])) === 0)
    ok('onboarding status was not changed by any of this', (await one("select onboarding_status from public.profiles where id=$1", [a])) === 'in_progress')
    if (own) {
      const cpt = (await c.query('select id, manifest_id from public.curriculum_concepts limit 1')).rows[0]
      const lo = (await c.query('select id from public.reading_los limit 1')).rows[0]
      await c.query("insert into public.repair_threads (user_id, concept_id, manifest_id, status, latest_evidence_at) values ($1,$2,$3,'open',now())", [a, cpt.id, cpt.manifest_id])
      const snap = async () => JSON.stringify([(await c.query('select status, occurrence_count, closed_at from public.repair_threads where user_id=$1', [a])).rows, (await c.query('select count(*) from public.evidence_events where user_id=$1', [a])).rows])
      const before = await snap()
      const bands = (await one("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.evidence_overrides'::regclass and contype='c' limit 1")) || ''
      const band = (bands.match(/'([a-z_]+)'/) || [])[1] || 'verified'
      await as(a, async () => { try { await c.query('SAVEPOINT eo'); await c.query("insert into public.evidence_overrides (user_id, outcome_id, overridden_band, reason) values ($1,$2,$3,'I know this')", [a, lo.id, band]); await c.query('RELEASE eo') } catch (e) { await c.query('ROLLBACK TO eo'); throw e } })
      ok('marking an outcome understood (an override) changes no evidence and closes no repair thread', before === await snap())
      const tok = async () => one('select public.weekly_source_version($1,$2)', [a, cyc])
      const t0 = await tok()
      await c.query("update public.profiles set classes_completed_at = current_date where id=$1", [a])
      ok('the weekly change token reacts to classes_completed_at', t0 !== await tok())
      const t1 = await tok()
      const cols = (await c.query("select column_name from information_schema.columns where table_schema='public' and table_name='exam_attempts' and column_name not in ('id','user_id') and is_generated='NEVER' and column_default is null or (table_name='exam_attempts' and column_name in ('status'))")).rows.map(r => r.column_name)
      const list = [...new Set(cols)].map(x => `"${x}"`).join(',')
      const cloned = await c.query(`insert into public.exam_attempts (user_id, ${list}) select $1, ${list} from public.exam_attempts where status='active' limit 1`, [a])
      if (!cloned.rowCount) console.log('  (no template exam_attempts row to clone; exam-target token check skipped)')
      await c.query("update public.exam_attempts set target_exam_date = target_exam_date + 1 where user_id=$1 and status='active'", [a])
      if (cloned.rowCount) ok('the weekly change token reacts to the exam target', t1 !== await tok())
    }
    await c.query("update public.profiles set onboarding_status='complete' where id=$1", [a]) // as the server would; the command itself refuses incomplete setup
    const res = await as(a, async () => { try { await c.query('SAVEPOINT r'); const r = (await c.query("select public.set_task_execution($1,'bnd-task',(select revision from public.plan_blocks where id='bnd-task'),'completed',40,null) r", [a])).rows[0].r; await c.query('RELEASE r'); return r } catch (e) { await c.query('ROLLBACK TO r'); return { err: e.message } } })
    console.log('  command result:', JSON.stringify(res).slice(0, 200))
    ok('the task command still works for the student (definer path)', !res.err && (await one("select execution from public.plan_blocks where id='bnd-task'")) === 'completed')
    console.log(`\n${n} checks passed`)
  } catch (e) { console.error('ERR:', e.message, (e.stack||'').split('\n').filter(l => l.includes('write-boundary')).slice(0,2).join(' | ')); throw e } finally { await c.query('ROLLBACK').catch(() => {}); console.log('Rolled back; the database is unchanged.'); await c.end().catch(() => {}) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
