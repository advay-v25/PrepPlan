/** Hosted development verification. Every fixture write is rolled back.
 * Requires an explicit confirmed project and .env.staging.local; never reads app credentials.
 * This is a database/RLS test, not an Auth HTTP or browser test.
 */
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { parse } = require('dotenv');
const { configuration } = require('./lib/migrations.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !/^--confirm-target=[a-z0-9]+$/.test(args[0])) throw Error('Supply exactly --confirm-target=<disposable-development-project-ref>.');
  const env = parse(fs.readFileSync(path.join(__dirname, '../.env.staging.local')));
  const config = configuration(['--env=staging', '--apply', args[0]], env);
  if (env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== config.identity) throw Error('The target file must explicitly mark E2E_CONFIRMED_DISPOSABLE_PROJECT_REF.');
  const client = new Client(config.connection);
  const fixtureIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [owner, stranger, incomplete, unverified] = fixtureIds;
  const taskIds = [];
  let passed = 0, transaction = false;
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
  const scalar = async (sql, values) => Object.values((await client.query(sql, values)).rows[0])[0];
  const asUser = async (id, fn) => {
    await client.query('set local role authenticated');
    await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)", [id, JSON.stringify({ sub: id, role: 'authenticated' })]);
    const result = await fn();
    await client.query('reset role');
    return result;
  };
  const call = (uid, taskId, execution = 'completed', revision = 1, minutes = null, userArg = uid) => asUser(uid, async () => (
    await client.query('select public.set_task_execution($1,$2,$3,$4,$5,null) as result', [userArg, taskId, revision, execution, minutes])
  ).rows[0].result);
  const rejected = async (fn, code) => {
    await client.query('savepoint expected_rejection');
    let error;
    try { await fn(); } catch (e) { error = e; }
    await client.query('rollback to savepoint expected_rejection');
    await client.query('release savepoint expected_rejection');
    assert.equal(error?.code, code);
  };
  try {
    await client.connect();
    await client.query('begin'); transaction = true;
    await client.query("set local lock_timeout = '3s'");
    await client.query("set local statement_timeout = '10s'");
    await check('hosted function and receipt table enforce intended privileges', async () => {
      const fn = (await client.query("select p.oid,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') as anon,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated from pg_proc p where p.oid='public.set_task_execution(uuid,text,integer,text,integer,text)'::regprocedure")).rows[0];
      assert.equal(fn.prosecdef, true); assert.equal(fn.anon, false); assert.equal(fn.authenticated, true);
      assert.ok(fn.proconfig.some(c => c === 'search_path=""'));
      assert.equal(await scalar("select relrowsecurity from pg_class where oid='public.task_execution_commands'::regclass"), true);
      for (const verb of ['INSERT', 'UPDATE', 'DELETE']) assert.equal(await scalar("select has_table_privilege('authenticated','public.task_execution_commands',$1)", [verb]), false);
      assert.equal(await scalar("select has_table_privilege('anon','public.task_execution_commands','SELECT')"), false);
    });
    // Auth rows are private transactional fixtures, never usable sign-in accounts.
    // No password, session, email or external Auth API request is created here.
    for (const id of fixtureIds) {
      await client.query('insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data,aud,role) values ($1,$2,$3,$4,$5,$6)',
        [id, `roadmap-transaction-${id}@example.com`, id === unverified ? null : new Date(), JSON.stringify({ full_name: 'Transactional QA fixture' }), 'authenticated', 'authenticated']);
      await client.query('update public.profiles set onboarding_status=$2 where id=$1', [id, id === incomplete ? 'in_progress' : 'complete']);
    }
    const outcomeId = await scalar('select id from public.reading_los order by id limit 1');
    assert.ok(outcomeId, 'The development curriculum must contain at least one LOS');
    const makeTask = async (uid, execution = 'not_started') => {
      const id = `qa-atomic-${randomUUID()}`; taskIds.push(id);
      await client.query(`insert into public.plan_blocks
        (id,user_id,day,title,duration,detail,local_date,duration_minutes,placement,execution,task_type,outcome_id)
        values ($1,$2,'2026-10-28','Transactional QA block','45','Disposable verification fixture','2026-10-28',45,'day_preferred',$3,'study',$4)`, [id, uid, execution, outcomeId]);
      return id;
    };
    const task = await makeTask(owner);
    await check('hosted completion writes task + history + receipt and preserves LOS', async () => {
      const result = await call(owner, task);
      assert.equal(result.ok, true); assert.equal(result.replayed, false);
      assert.equal(result.task.revision, 2); assert.equal(result.task.outcome_id, outcomeId);
      const events = (await client.query('select * from public.task_events where task_id=$1', [task])).rows;
      assert.equal(events.length, 1); assert.equal(events[0].event_type, 'completed');
      assert.equal(events[0].actual_duration_minutes, null); assert.equal(events[0].previous.execution, 'not_started');
      assert.equal(await scalar('select count(*)::int from public.task_execution_commands where task_id=$1', [task]), 1);
    });
    await check('identical hosted retry creates no duplicate activity or minutes', async () => {
      assert.equal((await call(owner, task)).replayed, true);
      assert.equal(await scalar('select count(*)::int from public.task_events where task_id=$1', [task]), 1);
    });
    await check('conflicting retry returns the current revision without overwriting it', async () => {
      const result = await call(owner, task, 'partial');
      assert.equal(result.code, 'REVISION_MISMATCH'); assert.equal(result.current.execution, 'completed');
      assert.equal(result.current.revision, 2);
    });
    await check('partial progress and explicit zero remain distinct from completion/unknown', async () => {
      const id = await makeTask(owner);
      const result = await call(owner, id, 'partial', 1, 0);
      assert.equal(result.task.execution, 'partial'); assert.equal(result.task.outcome_id, outcomeId);
      assert.equal(await scalar('select actual_duration_minutes from public.task_events where task_id=$1', [id]), 0);
    });
    await check('all six supported states produce schema-compatible history', async () => {
      for (const [state, event] of Object.entries({ not_started: 'undone', in_progress: 'started', partial: 'partial', completed: 'completed', skipped: 'skipped', deferred: 'deferred' })) {
        const id = await makeTask(owner);
        const result = await call(owner, id, state, 1, 25);
        assert.equal(result.task.revision, 2);
        assert.equal(await scalar('select event_type from public.task_events where task_id=$1', [id]), event);
      }
    });
    await check('cross-user lookup and forged owner are rejected; receipts stay private', async () => {
      await rejected(() => call(stranger, task), 'P0002');
      await rejected(() => call(stranger, task, 'completed', 1, null, owner), '42501');
      assert.equal(await asUser(stranger, () => scalar('select count(*)::int from public.task_execution_commands')), 0);
    });
    await check('unfinished setup and unverified email cannot update tasks', async () => {
      for (const id of [incomplete, unverified]) {
        const t = await makeTask(id);
        await rejected(() => call(id, t), '42501');
        assert.equal(await scalar('select execution from public.plan_blocks where id=$1', [t]), 'not_started');
      }
    });
    await check('cancelled tasks and invalid duration cannot create activity', async () => {
      const cancelled = await makeTask(owner, 'cancelled');
      await rejected(() => call(owner, cancelled), '22023');
      const invalid = await makeTask(owner);
      await rejected(() => call(owner, invalid, 'completed', 1, -1), '22023');
      assert.equal(await scalar('select count(*)::int from public.task_events where task_id=any($1)', [[cancelled, invalid]]), 0);
    });
    await check('activity creates no diagnostic evidence', async () => {
      assert.equal(await scalar('select count(*)::int from public.evidence_events where user_id=any($1)', [fixtureIds]), 0);
    });
    await client.query('rollback'); transaction = false;
    await check('rollback leaves no test accounts, tasks, history or receipts', async () => {
      assert.equal(await scalar('select count(*)::int from auth.users where id=any($1)', [fixtureIds]), 0);
      for (const table of ['profiles', 'plan_blocks', 'task_events', 'task_execution_commands']) {
        const column = table === 'profiles' ? 'id' : 'user_id';
        assert.equal(await scalar(`select count(*)::int from public.${table} where ${column}=any($1)`, [fixtureIds]), 0);
      }
    });
    console.log(`\n${passed} hosted development database scenarios passed. All fixture writes rolled back.`);
  } finally {
    try { if (transaction) await client.query('rollback'); }
    finally { await client.end(); }
  }
}

main().catch(error => {
  // No database error details, fixture rows, connection strings or credentials in logs.
  console.error(error instanceof assert.AssertionError ? `Development verification assertion failed: ${error.message}` : `Development verification failed (${error.code ?? 'configuration or connection'}).`);
  process.exitCode = 1;
});
