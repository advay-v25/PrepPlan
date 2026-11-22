/** Starts and stops its OWN temporary loopback-only Postgres cluster.
 * Never reads .env files or accepts a database URL. Requires local Postgres binaries.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { migrate, transactionalSql } = require('./lib/migrations.cjs');

async function main() {
  let bindir;
  try { bindir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); }
  catch { throw Error('Install local Postgres to run this isolated test. Hosted database fallback is intentionally disabled.'); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-foundation-'));
  const data = path.join(root, 'pgdata');
  const log = path.join(root, 'postgres.log');
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const pg = (name, args) => execFileSync(path.join(bindir, name), args, { stdio: 'pipe' });
  const connection = { host: '127.0.0.1', port, database: 'postgres', user: 'roadmap_test', ssl: false };
  const makeClient = () => new Client(connection);
  const config = { connection, apply: false, target: 'local', identity: 'local:postgres' };
  const clients = [];
  let started = false, passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
  const connect = async () => { const c = makeClient(); clients.push(c); await c.connect(); return c; };
  try {
    pg('initdb', ['-D', data, '-U', 'roadmap_test', '--auth-local=trust', '--auth-host=trust', '--no-locale']);
    pg('pg_ctl', ['-D', data, '-l', log, '-o', `-p ${port} -h 127.0.0.1 -k ${root}`, '-w', 'start']); started = true;
    const admin = await connect();
    const scalar = async (sql, args) => Object.values((await admin.query(sql, args)).rows[0])[0];
    const first = { version: 'test_one', checksum: 'one', sql: transactionalSql('begin; create table proof_one(id int); commit;') };
    const broken = { version: 'test_two', checksum: 'two', sql: 'create table proof_two(id int); select definitely_missing_function();' };
    await check('real dry-run leaves an empty schema empty', async () => {
      await migrate(makeClient(), [first], config);
      assert.equal(await scalar("select to_regclass('public.schema_migrations')"), null);
      assert.equal(await scalar("select to_regclass('public.proof_one')"), null);
    });
    await check('failed first migration rolls back its DDL AND new ledger', async () => {
      await assert.rejects(migrate(makeClient(), [broken], { ...config, apply: true }));
      assert.equal(await scalar("select to_regclass('public.schema_migrations')"), null);
      assert.equal(await scalar("select to_regclass('public.proof_two')"), null);
    });
    await check('upgrade failure preserves prior history and rolls back only failed migration', async () => {
      await migrate(makeClient(), [first], { ...config, apply: true });
      await assert.rejects(migrate(makeClient(), [first, broken], { ...config, apply: true }));
      assert.equal(await scalar('select count(*)::int from public.schema_migrations'), 1);
      assert.equal(await scalar("select to_regclass('public.proof_two')"), null);
      await assert.rejects(migrate(makeClient(), [{ ...first, checksum: 'changed' }], config), /Checksum drift/);
    });
    // The cluster belongs solely to this test. Clear its synthetic proof schema
    // before installing the deliberately small task-command fixture.
    await admin.query('drop table public.proof_one, public.schema_migrations');
    await admin.query(fs.readFileSync(path.join(__dirname, 'fixtures/task-execution.sql'), 'utf8'));
    // Use the REAL revision trigger, not a test reimplementation.
    const editing = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260908_c2_calendar_editing.sql'), 'utf8');
    await admin.query(editing.split('-- 2. Recurrence')[0]);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261028_atomic_task_execution.sql'), 'utf8');
    await admin.query('BEGIN');
    try { await admin.query(migration); await admin.query('COMMIT'); }
    catch (e) { await admin.query('ROLLBACK'); throw e; }
    await admin.query(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261028_task_scope_and_split.sql'), 'utf8'));

    const owner = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const incomplete = '00000000-0000-4000-8000-000000000003';
    const unverified = '00000000-0000-4000-8000-000000000004';
    for (const id of [owner, other, incomplete, unverified]) {
      await admin.query('insert into auth.users values ($1, $2)', [id, id === unverified ? null : new Date()]);
      await admin.query('insert into public.profiles values ($1, $2)', [id, id === incomplete ? 'in_progress' : 'complete']);
    }
    const task = async (id, user = owner, execution = 'not_started') => admin.query(
      "insert into public.plan_blocks (id,user_id,title,local_date,duration_minutes,placement,execution,outcome_id) values ($1,$2,'Test task','2026-10-28',45,'day_preferred',$3,'fsa-original-outcome')", [id, user, execution]);
    const asUser = async id => {
      const c = await connect(); await c.query('set role authenticated');
      await c.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); return c;
    };
    const learner = await asUser(owner);
    const call = async (c, id, execution = 'completed', revision = 1, minutes = null, note = null, user = owner) => (
      await c.query('select public.set_task_execution($1,$2,$3,$4,$5,$6) as result', [user, id, revision, execution, minutes, note])
    ).rows[0].result;
    const historyCount = id => scalar('select count(*)::int from public.task_events where task_id=$1', [id]);

    await check('completion saves one event, preserves scope and leaves unknown duration null', async () => {
      await task('done'); const r = await call(learner, 'done');
      assert.equal(r.task.execution, 'completed'); assert.equal(r.task.revision, 2);
      assert.equal(r.task.outcome_id, 'fsa-original-outcome'); assert.equal(r.task.duration_minutes, 45);
      assert.equal(await historyCount('done'), 1);
      const event = (await admin.query("select * from public.task_events where task_id='done'")).rows[0];
      assert.equal(event.actual_duration_minutes, null); assert.equal(event.previous.execution, 'not_started');
      assert.equal(await scalar('select count(*)::int from public.evidence_events'), 0);
    });
    await check('exact retry reuses event; conflicting edit returns current revision', async () => {
      assert.equal((await call(learner, 'done')).replayed, true);
      assert.equal(await historyCount('done'), 1);
      const conflict = await call(learner, 'done', 'partial');
      assert.equal(conflict.code, 'REVISION_MISMATCH'); assert.equal(conflict.current.revision, 2);
    });
    await check('same-state observation advances revision once and records actual zero truthfully', async () => {
      await task('observation', owner, 'in_progress');
      const r = await call(learner, 'observation', 'in_progress', 1, 0);
      assert.equal(r.task.revision, 2);
      assert.equal(await scalar("select actual_duration_minutes from public.task_events where task_id='observation'"), 0);
      assert.equal((await call(learner, 'observation', 'in_progress', 1, 0)).replayed, true);
    });
    await check('every supported execution state uses the canonical event type without changing scope', async () => {
      const states = { not_started: 'undone', in_progress: 'started', partial: 'partial', completed: 'completed', skipped: 'skipped', deferred: 'deferred' };
      for (const [execution, eventType] of Object.entries(states)) {
        await task(`state-${execution}`);
        const r = await call(learner, `state-${execution}`, execution, 1, 25);
        assert.equal(r.task.outcome_id, 'fsa-original-outcome');
        assert.equal(r.task.execution, execution);
        assert.equal(await scalar('select event_type from public.task_events where task_id=$1', [`state-${execution}`]), eventType);
        assert.equal(await scalar('select actual_duration_minutes from public.task_events where task_id=$1', [`state-${execution}`]), 25);
      }
    });
    await admin.query(`create function public.fail_test_event() returns trigger language plpgsql as $$
      begin if new.notes = 'force_event_failure' then raise exception 'test event failure'; end if; return new; end; $$;
      create trigger test_event_failure before insert on public.task_events for each row execute function public.fail_test_event();
      create function public.fail_test_receipt() returns trigger language plpgsql as $$
      begin if new.request->>'note' = 'force_receipt_failure' then raise exception 'test receipt failure'; end if; return new; end; $$;
      create trigger test_receipt_failure before insert on public.task_execution_commands for each row execute function public.fail_test_receipt();`);
    for (const failure of ['force_event_failure', 'force_receipt_failure']) {
      await check(`${failure}: no task change, no history and no receipt survives`, async () => {
        await task(failure);
        await assert.rejects(call(learner, failure, 'completed', 1, 30, failure));
        const row = (await admin.query('select execution,revision from public.plan_blocks where id=$1', [failure])).rows[0];
        assert.deepEqual(row, { execution: 'not_started', revision: 1 });
        assert.equal(await historyCount(failure), 0);
        assert.equal(await scalar('select count(*)::int from public.task_execution_commands where task_id=$1', [failure]), 0);
      });
    }
    await check('two devices: identical simultaneous retries create exactly one event', async () => {
      await task('parallel'); const second = await asUser(owner);
      const results = await Promise.all([call(learner, 'parallel'), call(second, 'parallel')]);
      assert.equal(results.filter(r => r.replayed).length, 1); assert.equal(await historyCount('parallel'), 1);
    });
    await check('two devices: conflicting simultaneous commands accept exactly one', async () => {
      await task('race'); const second = await asUser(owner);
      const results = await Promise.all([call(learner, 'race', 'completed'), call(second, 'race', 'deferred')]);
      assert.equal(results.filter(r => r.ok).length, 1);
      assert.equal(results.filter(r => r.code === 'REVISION_MISMATCH').length, 1);
      assert.equal(await historyCount('race'), 1);
    });
    await check('another learner cannot read a task through the RPC or forge its owner', async () => {
      const stranger = await asUser(other);
      await assert.rejects(call(stranger, 'done', 'completed', 1, null, null, other), e => e.code === 'P0002');
      await assert.rejects(call(stranger, 'done'), e => e.code === '42501');
      assert.equal((await stranger.query('select * from public.task_execution_commands')).rows.length, 0);
    });
    await check('unverified, incomplete and anonymous access cannot change tasks', async () => {
      for (const id of [incomplete, unverified]) {
        await task(id, id); const c = await asUser(id);
        await assert.rejects(call(c, id, 'completed', 1, null, null, id), e => e.code === '42501');
        assert.equal(await historyCount(id), 0);
      }
      const anon = await connect(); await anon.query('set role anon');
      await assert.rejects(call(anon, 'done'), e => e.code === '42501');
    });
    await check('invalid actual duration and cancelled origins fail without changing state', async () => {
      await task('invalid'); await task('cancelled', owner, 'cancelled');
      for (const minutes of [-1, 1441]) await assert.rejects(call(learner, 'invalid', 'completed', 1, minutes), e => e.code === '22023');
      await assert.rejects(call(learner, 'cancelled'), e => e.code === '22023');
      assert.equal(await historyCount('invalid'), 0); assert.equal(await historyCount('cancelled'), 0);
      await assert.rejects(learner.query("delete from public.task_execution_commands where task_id='done'"), e => e.code === '42501');
    });
    const split = async (c, id, revision = 1, minutes = null) => (await c.query('select public.split_study_task($1,$2,$3,$4) as result', [owner,id,revision,minutes])).rows[0].result;
    await check('atomic split preserves scope, objective, origin and total time; remainder is unplaced', async () => {
      await task('split'); await admin.query("update public.plan_blocks set learning_objective='Original goal',suggested_approach='Original method',lm_id='reading' where id='split'");
      const rev = await scalar("select revision from public.plan_blocks where id='split'");
      const r = await split(learner, 'split', rev);
      const child = (await admin.query('select * from public.plan_blocks where id=$1', [r.secondId])).rows[0];
      assert.equal(child.outcome_id, 'fsa-original-outcome'); assert.equal(child.lm_id,'reading');
      assert.equal(child.learning_objective,'Original goal'); assert.equal(child.suggested_approach,'Original method');
      assert.equal(child.origin,r.task.origin); assert.equal(child.scope_group_id,r.task.scope_group_id);
      assert.equal(r.task.duration_minutes+child.duration_minutes,45); assert.equal(child.local_date,null); assert.equal(child.placement,'floating');
      assert.equal((await split(learner,'split',rev)).secondId,r.secondId);
      assert.equal(await historyCount('split'),1);
    });
    await check('simultaneous split retries make one child, two history events and one group', async () => {
      await task('split-race'); const otherDevice = await asUser(owner);
      const results = await Promise.all([split(learner,'split-race'),split(otherDevice,'split-race')]);
      assert.equal(results[0].secondId,results[1].secondId);
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where scope_group_id=$1',[results[0].task.scope_group_id]),2);
    });
    await check('splitting a sitting again grows its existing group without duplicating scope', async () => {
      await task('split-again'); await admin.query("update public.plan_blocks set duration_minutes=120 where id='split-again'");
      const r = await split(learner,'split-again',await scalar("select revision from public.plan_blocks where id='split-again'"));
      await split(learner,r.secondId);
      assert.equal(await scalar('select expected_parts from public.task_scope_groups where id=$1',[r.task.scope_group_id]),3);
      assert.equal(await scalar('select sum(duration_minutes)::int from public.plan_blocks where scope_group_id=$1',[r.task.scope_group_id]),120);
    });
    await admin.query(`create function public.fail_test_split() returns trigger language plpgsql as $$ begin
      if new.payload->>'splitFrom'='split-failure' then raise exception 'forced child event failure'; end if; return new; end $$;
      create trigger test_split_failure before insert on public.task_events for each row execute function public.fail_test_split();`);
    await check('failure after creating the second sitting rolls back every split write', async () => {
      await task('split-failure'); await assert.rejects(split(learner,'split-failure'));
      const row = (await admin.query("select duration_minutes,revision,scope_group_id from public.plan_blocks where id='split-failure'")).rows[0];
      assert.deepEqual(row,{duration_minutes:45,revision:1,scope_group_id:null});
      assert.equal(await historyCount('split-failure'),0);
      assert.equal(await scalar("select count(*)::int from public.task_scope_groups where original_task_id='split-failure'"),0);
    });
    await check('completed, cancelled, protected and test blocks cannot be split', async () => {
      for (const state of ['completed','cancelled']) { await task(`cannot-${state}`,owner,state); await assert.rejects(split(learner,`cannot-${state}`)); }
      await task('protected'); await admin.query("update public.plan_blocks set is_protected_commitment=true where id='protected'");
      await assert.rejects(split(learner,'protected',await scalar("select revision from public.plan_blocks where id='protected'")));
      await task('paper'); await admin.query("update public.plan_blocks set task_type='diagnostic' where id='paper'");
      await assert.rejects(split(learner,'paper',await scalar("select revision from public.plan_blocks where id='paper'")));
    });
    const cycle='00000000-0000-4000-8000-000000000099';
    await admin.query("insert into public.planning_cycles values ($1,$2,'active')",[cycle,owner]);
    await admin.query("insert into public.reading_los values ('fsa-original-outcome','reading'),('los-b','reading')");
    const confirm = async (id,rev,ids) => (await learner.query('select public.confirm_task_scope($1,$2,$3,$4) as result',[owner,id,rev,ids])).rows[0].result;
    await check('partial LOS confirmation is atomic, mapped-only and revision guarded', async () => {
      await task('confirm',owner,'partial'); await admin.query('update public.plan_blocks set cycle_id=$1 where id=$2',[cycle,'confirm']);
      const rev = await scalar("select revision from public.plan_blocks where id='confirm'");
      await assert.rejects(confirm('confirm',rev,['los-b']));
      const r=await confirm('confirm',rev,['fsa-original-outcome']); assert.equal(r.confirmed,1);
      assert.equal((await confirm('confirm',rev,['fsa-original-outcome'])).replayed,true);
      assert.equal((await confirm('confirm',rev,[])).code,'REVISION_MISMATCH');
    });
    await admin.query(`create function public.fail_test_confirmation() returns trigger language plpgsql as $$ begin
      if new.block_id='confirm-failure' and new.outcome_id='los-b' then raise exception 'forced confirmation failure'; end if; return new; end $$;
      create trigger test_confirmation_failure before insert on public.block_scope_confirmations for each row execute function public.fail_test_confirmation();`);
    await check('failed scope replacement preserves prior confirmations and task revision', async () => {
      await task('confirm-failure',owner,'partial'); await admin.query('update public.plan_blocks set cycle_id=$1,outcome_id=null,lm_id=$2 where id=$3',[cycle,'reading','confirm-failure']);
      const rev=await scalar("select revision from public.plan_blocks where id='confirm-failure'");
      const r=await confirm('confirm-failure',rev,['fsa-original-outcome']);
      await assert.rejects(confirm('confirm-failure',r.task.revision,['los-b']));
      assert.equal(await scalar("select outcome_id from public.block_scope_confirmations where block_id='confirm-failure'"),'fsa-original-outcome');
      assert.equal(await scalar("select revision from public.plan_blocks where id='confirm-failure'"),r.task.revision);
    });
    await check('split and scope confirmation cannot access another learner or their receipts', async () => {
      const outsider=await asUser(other);
      await assert.rejects(outsider.query('select public.split_study_task($1,$2,1,null)',[other,'split']),e=>e.code==='P0002');
      await assert.rejects(outsider.query('select public.confirm_task_scope($1,$2,1,$3)',[other,'confirm',['fsa-original-outcome']]),e=>e.code==='P0002');
      assert.equal((await outsider.query('select * from public.task_scope_groups')).rows.length,0);
      assert.equal((await outsider.query('select * from public.task_split_commands')).rows.length,0);
    });
    console.log(`\n${passed} isolated Postgres scenarios passed. No hosted database used.`);
  } finally {
    await Promise.allSettled(clients.map(c => c.end()));
    if (started) {
      try { pg('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']); }
      catch { throw Error(`Could not stop isolated Postgres. Test directory retained at ${root}.`); }
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
