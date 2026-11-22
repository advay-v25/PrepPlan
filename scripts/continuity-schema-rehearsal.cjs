/**
 * Rehearses the weekly-continuity migration and one full closure against the REAL development schema,
 * inside a transaction that is ALWAYS rolled back. Nothing persists: no table, column, row or function.
 *
 *   npm run continuity:schema:rehearse -- --confirm-target=<project-ref>
 *   npm run continuity:schema:rehearse -- --confirm-target=<project-ref> --already-applied
 *
 * With --already-applied the migration is NOT applied; the objects that are already in the database are
 * exercised exactly as deployed. Use it after the migration has been loaded.
 *
 * Safety: reads only .env.staging.local; refuses unless the project is the user-confirmed disposable one
 * (E2E_CONFIRMED_DISPOSABLE_PROJECT_REF == MIGRATION_EXPECTED_PROJECT_REF == the URL's project) and the
 * --confirm-target argument names it; verifies TLS; prints schema facts and pass/fail, never row data.
 * It does not replace the browser rehearsal (W4); it proves the command is compatible with the real schema.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { parse } = require('dotenv');
const { configuration, transactionalSql } = require('./lib/migrations.cjs');

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..');
  const envFile = path.join(root, '.env.staging.local');
  if (!fs.existsSync(envFile)) throw Error('Missing .env.staging.local; no other environment will be used.');
  const env = parse(fs.readFileSync(envFile));
  const config = configuration(['--env=staging', '--dry-run'], env);
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== config.identity) {
    throw Error('This project is not the user-confirmed disposable one; refusing.');
  }
  if (!args.includes(`--confirm-target=${config.identity}`)) throw Error(`Pass --confirm-target=${config.identity} to run.`);

  const migration = transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261029_weekly_continuity.sql'), 'utf8'));
  const c = new Client({ ...config.connection, connectionTimeoutMillis: 45000 });
  await c.connect();
  let passed = 0;
  const check = (name, ok) => { assert.ok(ok, name); passed++; console.log(`  ✓ ${name}`); };
  try {
    await c.query('BEGIN');
    await c.query("SET LOCAL statement_timeout = '60s'");
    await c.query("SET LOCAL lock_timeout = '15s'");
    console.log(`Rehearsing on ${config.identity} (transaction will be rolled back)`);
    const q = async (sql, a) => (await c.query(sql, a)).rows;
    const scalar = async (sql, a) => Object.values((await q(sql, a))[0] ?? { v: null })[0];

    const deployed = args.includes('--already-applied');
    const already = await scalar("select to_regclass('public.weekly_transition_drafts') is not null");
    if (already && !deployed) throw Error('The migration is already applied here. Re-run with --already-applied to exercise it as deployed.');
    if (!already && deployed) throw Error('--already-applied was given but the migration is not in the database.');
    if (deployed) check('the migration is present in the database (exercising it as deployed)', true);
    else { await c.query(migration); check('the migration applies cleanly on the real schema', true); }

    // A throwaway learner. Everything below disappears with the rollback.
    const uid = (await q('select gen_random_uuid() as id'))[0].id;
    await c.query("insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())", [uid, `rehearsal+${uid.slice(0, 8)}@example.invalid`]);
    await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [uid]);
    await c.query("update public.profiles set onboarding_status = 'complete' where id = $1", [uid]);
    const c1 = (await q('select gen_random_uuid() as id'))[0].id, c2 = (await q('select gen_random_uuid() as id'))[0].id;
    await c.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '7 days','2030-01-07','2030-01-13','UTC','active')", [c1, uid]);
    const los = (await q('select id, reading_id from public.reading_los limit 1'))[0];
    const task = (id, extra = '') => c.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,day,duration,detail,duration_minutes,task_type,priority,placement,execution,origin,created_by,outcome_id,learning_objective,suggested_approach,completion_meaning,local_date) values ($1,$2,$3,'Rehearsal task','2030-01-08','45','d',45,'study','core','day_preferred','partial','planner','algorithm',$4,'Objective','Approach','Done when',date '2030-01-08')${extra}`, [id, uid, c1, los?.id ?? null]);
    await task('rehearsal-pred');
    await c.query("update public.plan_blocks set rationale='r' where id='rehearsal-pred'");
    check('a task row inserts with the real NOT NULL columns', true);

    const version = await scalar('select public.weekly_source_version($1,$2)', [uid, c1]);
    check('the change token computes against the real tables and columns', typeof version === 'string' && version.length === 32);
    const proposal = {
      next: { starts_at_local: '2030-01-14', ends_at_local: '2030-01-20', timezone: 'UTC', anchor_day: 1, rows: [{
        id: 'rehearsal-new', title: 'New', detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started',
        local_date: '2030-01-15', day: '2030-01-15', starts_at: '', duration_minutes: 60, duration: '60', lm_id: '', repair_thread_id: '', rationale: 'r', assessment_scope: null, created_by: 'algorithm',
        concept_id: '', learning_objective: 'Cover X', suggested_approach: 'Approach', completion_meaning: 'Done' }] },
      actions: [{ taskId: 'rehearsal-pred', setExecution: null, cancel: false, unknown: false, continuation: { minutes: 45, intent: 'continue', provisional: true, placement: { date: '2030-01-16', reason: null, note: null } } }],
      recap: {},
    };
    const draftId = await scalar(`insert into public.weekly_transition_drafts (user_id,cycle_id,closure_kind,no_paper_reason,choices,proposal,source_version) values ($1,$2,'no_paper','rehearsal','{}',$3,$4) returning id`, [uid, c1, proposal, version]);

    // Act as the learner: the same role and claims a signed-in request carries.
    await c.query('SET LOCAL ROLE authenticated');
    await c.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const result = (await q('select public.accept_weekly_transition($1) as r', [draftId]))[0].r;
    await c.query('RESET ROLE');
    check('the closure command succeeds for a signed-in learner on the real schema', result.ok === true && result.continued === 1);

    const succ = (await q("select *, local_date::text as ld from public.plan_blocks where continued_from_task_id='rehearsal-pred'"))[0];
    check('one continuation exists, placed exactly where the preview said', succ && succ.ld === '2030-01-16' && succ.placement === 'day_preferred' && succ.day === '2030-01-16');
    check('planning context carried over (mapping, objective, method, meaning)', succ.outcome_id === (los?.id ?? null) && succ.learning_objective === 'Objective' && succ.suggested_approach === 'Approach' && succ.completion_meaning === 'Done when');
    check('occurrence state is reset (not started, revision 1, no evidence/class/attempt link)', succ.execution === 'not_started' && succ.revision === 1 && succ.evidence_event_id === null && succ.class_session_id === null && succ.attempt_id === null && succ.starts_at === null);
    const pred = (await q("select execution, cycle_id from public.plan_blocks where id='rehearsal-pred'"))[0];
    check('the original is untouched: still partial, still in its own week', pred.execution === 'partial' && pred.cycle_id === c1);
    const fresh = (await q("select learning_objective, suggested_approach, completion_meaning, local_date::text as ld from public.plan_blocks where id='rehearsal-new'"))[0];
    check('a newly generated task keeps its guidance and date', fresh.learning_objective === 'Cover X' && fresh.suggested_approach === 'Approach' && fresh.completion_meaning === 'Done' && fresh.ld === '2030-01-15');
    check('the old closure command is no longer callable by a signed-in student',
      !(await scalar("select has_function_privilege('authenticated','public.accept_weekly_review(uuid,text,text,jsonb,jsonb,jsonb)','execute')")));
    check('the superseded original is protected on the real table', await (async () => {
      try { await c.query('SAVEPOINT s'); await c.query("update public.plan_blocks set execution='completed' where id='rehearsal-pred'"); await c.query('ROLLBACK TO s'); return false; }
      catch (e) { await c.query('ROLLBACK TO s'); return /continues in a later week/.test(e.message); }
    })());
    console.log(`\n${passed} real-schema checks passed. Rolling back: nothing persists.`);
  } finally {
    try { await c.query('ROLLBACK'); } catch { /* connection already closed */ }
    const draftsAfter = await c.query("select to_regclass('public.weekly_transition_drafts') as t").then(r => r.rows[0].t).catch(() => 'unknown');
    const leftoverRows = await c.query("select (select count(*) from public.plan_blocks where id like 'rehearsal-%') as blocks").then(r => Number(r.rows[0].blocks)).catch(() => -1);
    const unchanged = leftoverRows === 0 && (args.includes('--already-applied') ? draftsAfter !== null : draftsAfter === null);
    console.log(unchanged ? 'Confirmed: the database is unchanged (no rehearsal rows remain).' : `WARNING: could not confirm rollback (drafts: ${draftsAfter}, rehearsal rows: ${leftoverRows}).`);
    await c.end().catch(() => {});
  }
}
main().catch(e => { console.error(`Rehearsal failed: ${e.message}`); process.exitCode = 1; });
