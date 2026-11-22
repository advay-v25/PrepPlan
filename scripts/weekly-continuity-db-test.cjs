/** Weekly continuity, proven in its OWN temporary loopback-only Postgres cluster.
 * Never reads .env files or accepts a database URL. Requires local Postgres binaries.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { Client } = require('pg');

const OWNER = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const INCOMPLETE = '00000000-0000-4000-8000-000000000003';
const UNVERIFIED = '00000000-0000-4000-8000-000000000004';
const C1 = '00000000-0000-4000-8000-0000000000c1';
const C2 = '00000000-0000-4000-8000-0000000000c2';
const C3 = '00000000-0000-4000-8000-0000000000c3';

async function main() {
  let bindir;
  try { bindir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); }
  catch { throw Error('Install local Postgres to run this isolated test. Hosted database fallback is intentionally disabled.'); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-continuity-'));
  const data = path.join(root, 'pgdata');
  const port = await new Promise((resolve, reject) => {
    const s = net.createServer(); s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const pg = (name, args) => execFileSync(path.join(bindir, name), args, { stdio: 'pipe' });
  const connection = { host: '127.0.0.1', port, database: 'postgres', user: 'roadmap_test', ssl: false };
  const clients = [];
  let started = false, passed = 0;
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`); };
  const connect = async () => { const c = new Client(connection); clients.push(c); await c.connect(); return c; };
  const sql = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
  try {
    pg('initdb', ['-D', data, '-U', 'roadmap_test', '--auth-local=trust', '--auth-host=trust', '--no-locale']);
    pg('pg_ctl', ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1 -k ${root}`, '-w', 'start']); started = true;
    const admin = await connect();
    const scalar = async (q, args) => Object.values((await admin.query(q, args)).rows[0] ?? { v: null })[0];

    // Real migrations, in order, on top of the small dependency fixtures.
    await admin.query(sql('fixtures/task-execution.sql'));
    await admin.query(sql('../supabase/migrations/20260908_c2_calendar_editing.sql').split('-- 2. Recurrence')[0]);
    await admin.query(sql('../supabase/migrations/20261028_atomic_task_execution.sql'));
    await admin.query(sql('../supabase/migrations/20261028_task_scope_and_split.sql'));
    await admin.query(sql('fixtures/weekly-continuity.sql'));
    await admin.query('BEGIN');
    try { await admin.query(sql('../supabase/migrations/20261029_weekly_continuity.sql')); await admin.query('COMMIT'); }
    catch (e) { await admin.query('ROLLBACK'); throw e; }
    await admin.query(sql('../supabase/migrations/20261029_weekly_continuity_account_delete.sql'));

    for (const id of [OWNER, OTHER, INCOMPLETE, UNVERIFIED]) {
      await admin.query('insert into auth.users values ($1, $2)', [id, id === UNVERIFIED ? null : new Date()]);
      await admin.query('insert into public.profiles(id, onboarding_status) values ($1, $2)', [id, id === INCOMPLETE ? 'in_progress' : 'complete']);
    }
    await admin.query("insert into public.reading_los values ('los-a','reading'),('los-b','reading')");
    const cycle = async (id, start, end, status = 'active', user = OWNER) => {
      if (status === 'active') await admin.query("update public.planning_cycles set status='closed' where user_id=$1 and status='active'", [user]);
      return admin.query('insert into public.planning_cycles(id,user_id,status,starts_at_local,ends_at_local,timezone) values ($1,$2,$3,$4,$5,$6)', [id, user, status, start, end, 'UTC']);
    };
    await cycle(C1, '2026-10-26', '2026-11-01');

    const asUser = async id => { const c = await connect(); await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); return c; };
    const learner = await asUser(OWNER);
    const mk = (id, o = {}) => admin.query(
      `insert into public.plan_blocks (id,user_id,cycle_id,title,local_date,day,duration_minutes,placement,execution,outcome_id,lm_id,task_type,learning_objective,suggested_approach,repair_thread_id)
       values ($1,$2,$3,$4,$5,$12,$6,$7,$8,$9,'reading',coalesce($11,'study'),'Objective: ' || $4,'Active recall',$10)`,
      [id, o.user ?? OWNER, o.cycle ?? C1, o.title ?? `Task ${id}`, o.date === undefined ? '2026-10-28' : o.date, o.minutes ?? 60, o.placement ?? 'day_preferred', o.execution ?? 'not_started', o.outcome === undefined ? 'los-a' : o.outcome, o.repair ?? null, o.type ?? null, (o.date === undefined ? '2026-10-28' : o.date) ?? '2026-10-26']);
    const row = id => admin.query('select * from public.plan_blocks where id=$1', [id]).then(r => r.rows[0]);
    const events = id => admin.query('select event_type,payload,actual_duration_minutes from public.task_events where task_id=$1 order by created_at,event_type', [id]).then(r => r.rows);
    const act = (taskId, o = {}) => ({ taskId, setExecution: null, cancel: false, unknown: false, continuation: null, ...o });
    const cont = (minutes = 45, intent = 'continue', provisional = false, date = null, reason = null) => ({ minutes, intent, provisional, placement: { date, reason: date ? null : (reason ?? 'Not placed yet.'), note: null } });
    const generated = (id, o = {}) => ({ id, title: 'New reading', detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started',
      local_date: '2026-11-03', day: '2026-11-03', starts_at: '', duration_minutes: 60, duration: '60', lm_id: '', repair_thread_id: '', rationale: 'r', assessment_scope: null, created_by: 'algorithm',
      concept_id: '', learning_objective: 'Cover X (this portion).', suggested_approach: 'Work through it in your own material.', completion_meaning: 'Done when covered.', ...o });
    const draft = async (cycleId, actions, o = {}) => {
      await admin.query("update public.weekly_transition_drafts set status='superseded' where cycle_id=$1 and status='ready'", [cycleId]);
      const version = await scalar('select public.weekly_source_version($1,$2)', [o.user ?? OWNER, cycleId]);
      const proposal = { next: { starts_at_local: o.start ?? '2026-11-02', ends_at_local: o.end ?? '2026-11-08', timezone: 'UTC', anchor_day: 1, rows: o.rows ?? [] }, actions, recap: { planned: actions.length } };
      return scalar(`insert into public.weekly_transition_drafts(user_id,cycle_id,closure_kind,no_paper_reason,choices,proposal,source_version)
        values ($1,$2,'no_paper','The bank cannot support a paper this week.','{}',$3,$4) returning id`, [o.user ?? OWNER, cycleId, proposal, version]);
    };
    const accept = async (draftId, client = learner) => (await client.query('select public.accept_weekly_transition($1) as r', [draftId])).rows[0].r;

    // ---- the main acceptance example -------------------------------------------------------------------
    let wk2cycle, secondSitting, firstSitting;
    await check('split 45+45: the unplaced sitting continues exactly once, the first week keeps its history', async () => {
      await mk('wk1-task', { minutes: 90 });
      const split = (await learner.query('select public.split_study_task($1,$2,1,45) as r', [OWNER, 'wk1-task'])).rows[0].r;
      firstSitting = 'wk1-task'; secondSitting = split.secondId;
      await admin.query("update public.plan_blocks set cycle_id=$1 where id=$2", [C1, secondSitting]);
      const done = (await learner.query("select public.set_task_execution($1,$2,$3,'completed',40,null) as r", [OWNER, firstSitting, (await row(firstSitting)).revision])).rows[0].r;
      assert.equal(done.task.execution, 'completed');
      const d = await draft(C1, [act(firstSitting), act(secondSitting, { continuation: cont(45, 'continue') })]);
      const r = await accept(d);
      assert.equal(r.ok, true); assert.equal(r.continued, 1); wk2cycle = r.nextCycleId;

      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [C1]), 'closed');
      const succ = (await admin.query('select * from public.plan_blocks where continued_from_task_id=$1', [secondSitting])).rows;
      assert.equal(succ.length, 1);
      assert.equal(succ[0].cycle_id, wk2cycle); assert.equal(succ[0].execution, 'not_started'); assert.equal(succ[0].local_date, null);
      assert.equal(succ[0].placement, 'floating'); assert.equal(succ[0].duration_minutes, 45); assert.equal(succ[0].carry_intent, 'continue');
      // planning context is inherited
      assert.equal(succ[0].scope_group_id, (await row(secondSitting)).scope_group_id); assert.equal(succ[0].outcome_id, 'los-a');
      assert.equal(succ[0].learning_objective, 'Objective: Task wk1-task'); assert.equal(succ[0].suggested_approach, 'Active recall');
      // the group still has two sittings: a continuation is not a third
      assert.equal(await scalar('select expected_parts from public.task_scope_groups where id=$1', [succ[0].scope_group_id]), 2);
      // week one is untouched: first sitting still completed, its 40 reported minutes and event are where they were
      assert.equal((await row(firstSitting)).execution, 'completed'); assert.equal((await row(firstSitting)).cycle_id, C1);
      const ev = await events(firstSitting); assert.ok(ev.some(e => e.event_type === 'completed' && e.actual_duration_minutes === 40));
      // none of week one's activity was copied to the new task
      assert.deepEqual((await events(succ[0].id)).map(e => e.event_type), ['created']);
      assert.equal(await scalar('select count(*)::int from public.block_scope_confirmations where block_id=$1', [succ[0].id]), 0);
    });

    await check('a partly done task keeps its progress, minutes and confirmations; the successor starts clean', async () => {
      await cycle(C2, '2026-11-02', '2026-11-08', 'active');   // fresh cycle for an independent scenario
      await admin.query("update public.planning_cycles set status='closed' where id=$1", [wk2cycle]);
      await mk('partial-1', { cycle: C2, execution: 'partial', date: '2026-11-03' });
      await learner.query("select public.set_task_execution($1,$2,$3,'partial',20,null)", [OWNER, 'partial-1', (await row('partial-1')).revision]);
      await admin.query("insert into public.block_scope_confirmations(user_id,block_id,outcome_id) values ($1,'partial-1','los-a')", [OWNER]);
      const d = await draft(C2, [act('partial-1', { continuation: cont(45, 'continue', true) })], { start: '2026-11-09', end: '2026-11-15' });
      const r = await accept(d); assert.equal(r.ok, true);
      const old = await row('partial-1'); assert.equal(old.execution, 'partial'); assert.equal(old.cycle_id, C2);
      assert.equal(await scalar("select count(*)::int from public.block_scope_confirmations where block_id='partial-1'"), 1);
      assert.equal(await scalar("select sum(actual_duration_minutes)::int from public.task_events where task_id='partial-1'"), 20);
      const succ = (await admin.query("select * from public.plan_blocks where continued_from_task_id='partial-1'")).rows[0];
      assert.equal(succ.estimate_provisional, true); assert.equal(succ.execution, 'not_started');
      assert.equal(await scalar('select count(*)::int from public.block_scope_confirmations where block_id=$1', [succ.id]), 0);
      assert.equal(await scalar('select coalesce(sum(actual_duration_minutes),0)::int from public.task_events where task_id=$1', [succ.id]), 0);
    });

    await check('retrying a saved review makes nothing new; a different review of a closed week is refused', async () => {
      await cycle(C3, '2026-11-16', '2026-11-22'); await mk('retry', { cycle: C3 });
      const d = await draft(C3, [act('retry', { setExecution: 'completed' })], { start: '2026-11-23', end: '2026-11-29' });
      const first = await accept(d); const again = await accept(d);
      assert.equal(first.ok, true); assert.equal(first.alreadyClosed, false);
      assert.equal(again.alreadyClosed, true); assert.equal(again.nextCycleId, first.nextCycleId);
      assert.equal(await scalar("select count(*)::int from public.planning_cycles where starts_at_local='2026-11-23'"), 1);
      assert.equal(await scalar("select count(*)::int from public.task_events where task_id='retry' and event_type='completed'"), 1);
      const other = await draft(C3, [], { start: '2026-11-23', end: '2026-11-29' });
      assert.equal((await accept(other)).code, 'ALREADY_CLOSED');
    });

    // ---- protection, atomicity, access -----------------------------------------------------------------
    const open = async (id, minutes = 60, extra = {}) => { const cid = extra.cycle ?? `00000000-0000-4000-8000-${String(Math.floor(Math.random() * 1e12)).padStart(12, '0')}`;
      if (!extra.cycle) await cycle(cid, extra.start ?? '2027-01-04', extra.end ?? '2027-01-10');
      await mk(id, { cycle: cid, minutes, ...extra }); return cid; };
    await check('a continued task is history: it cannot be completed, moved, split, confirmed, cancelled or deleted', async () => {
      const cid = await open('hist', 60, { execution: 'partial' });
      const d = await draft(cid, [act('hist', { continuation: cont(60) })], { start: '2027-01-11', end: '2027-01-17' });
      assert.equal((await accept(d)).ok, true);
      const rev = (await row('hist')).revision;
      await assert.rejects(learner.query("select public.set_task_execution($1,$2,$3,'completed',null,null)", [OWNER, 'hist', rev]), /continues in a later week/);
      await assert.rejects(learner.query('select public.split_study_task($1,$2,$3,null)', [OWNER, 'hist', rev]), /continues in a later week/);
      await assert.rejects(learner.query('select public.confirm_task_scope($1,$2,$3,$4)', [OWNER, 'hist', rev, ['los-a']]));
      await assert.rejects(admin.query("insert into public.block_scope_confirmations(user_id,block_id,outcome_id) values ($1,'hist','los-a')", [OWNER]), /confirmed outcomes are history/);
      await assert.rejects(admin.query("update public.plan_blocks set cancelled_at=now() where id='hist'"), /can no longer be changed/);
      await assert.rejects(admin.query("update public.plan_blocks set local_date='2027-01-05' where id='hist'"), /can no longer be changed/);
      await assert.rejects(admin.query("delete from public.plan_blocks where id='hist'"), /can no longer be deleted/);
      const succ = (await admin.query("select id from public.plan_blocks where continued_from_task_id='hist'")).rows[0].id;
      await assert.rejects(admin.query('delete from public.plan_blocks where id=$1', [succ]), /cannot be deleted/);
      assert.equal((await row('hist')).execution, 'partial');
    });
    await check('continuations are server-created only: forward, same owner, one per original', async () => {
      const c = await open('lin-a', 60, { start: '2027-02-01', end: '2027-02-07' });
      const later = '00000000-0000-4000-8000-0000000000d1'; await cycle(later, '2027-02-08', '2027-02-14');
      const ins = (id, from, cyc, user = OWNER) => admin.query(
        "insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,continued_from_task_id) values ($1,$2,$3,'x','2027-02-08',30,'floating','not_started',$4)", [id, user, cyc, from]);
      await ins('forge', 'lin-a', later);                              // accepted, but it is not a continuation
      assert.equal(await scalar("select continued_from_task_id from public.plan_blocks where id='forge'"), null);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='lin-a'"), 0);
      await admin.query("select set_config('roadmap.continuation_command','on',false)");
      await assert.rejects(ins('backward', 'lin-a', c), /later week/);
      await assert.rejects(ins('foreign', 'lin-a', later, OTHER), /your own tasks/);
      await ins('fwd', 'lin-a', later);
      await assert.rejects(ins('second', 'lin-a', later), /duplicate key|one_successor/);
      await assert.rejects(admin.query("update public.plan_blocks set continued_from_task_id=null where id='fwd'"), /cannot be changed/);
      await admin.query("select set_config('roadmap.continuation_command','',false)");
    });
    await check('splitting a continuation makes a genuine extra sitting, not a second successor', async () => {
      const cid = await open('sp-a', 90, { start: '2027-09-06', end: '2027-09-12' });
      const split = (await learner.query('select public.split_study_task($1,$2,$3,45) as r', [OWNER, 'sp-a', (await row('sp-a')).revision])).rows[0].r;
      const group = (await row('sp-a')).scope_group_id;
      await admin.query('update public.plan_blocks set cycle_id=$1 where id=$2', [cid, split.secondId]);
      const r1 = await accept(await draft(cid, [act('sp-a', { setExecution: 'completed' }), act(split.secondId, { continuation: cont(45) })], { start: '2027-09-13', end: '2027-09-19' }));
      const cont1 = (await admin.query('select * from public.plan_blocks where continued_from_task_id=$1', [split.secondId])).rows[0];
      assert.equal(cont1.cycle_id, r1.nextCycleId);
      const again = (await learner.query('select public.split_study_task($1,$2,$3,15) as r', [OWNER, cont1.id, cont1.revision])).rows[0].r;
      const sibling = await row(again.secondId);
      assert.equal(sibling.continued_from_task_id, null);           // a sibling, not another successor of the same task
      assert.equal(sibling.scope_group_id, group); assert.equal(sibling.carry_intent, null);
      assert.equal(await scalar('select expected_parts from public.task_scope_groups where id=$1', [group]), 3);
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where continued_from_task_id=$1', [split.secondId]), 1);
    });
    await check('a stale proposal is refused and nothing changes; the student can rebuild', async () => {
      const cid = await open('stale', 60, { start: '2027-03-01', end: '2027-03-07' });
      const d = await draft(cid, [act('stale', { continuation: cont() })], { start: '2027-03-08', end: '2027-03-14' });
      await learner.query("select public.set_task_execution($1,$2,$3,'in_progress',null,null)", [OWNER, 'stale', (await row('stale')).revision]);
      const r = await accept(d); assert.equal(r.code, 'STALE_PROPOSAL');
      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [cid]), 'active');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='stale'"), 0);
      assert.equal(await scalar("select status from public.weekly_transition_drafts where id=$1", [d]), 'ready');
    });
    await admin.query(`create function public.fail_continuation_event() returns trigger language plpgsql as $$
      begin if new.event_type='created' and new.payload->>'continuedFrom'='rollback-task' then raise exception 'forced failure after continuation'; end if; return new; end $$;
      create trigger test_continuation_failure before insert on public.task_events for each row execute function public.fail_continuation_event();`);
    await check('a failure after the continuation begins rolls back the whole closure', async () => {
      const cid = await open('rollback-task', 60, { start: '2027-04-05', end: '2027-04-11' });
      await mk('rollback-sibling', { cycle: cid, execution: 'not_started' });
      const d = await draft(cid, [act('rollback-sibling', { setExecution: 'completed' }), act('rollback-task', { setExecution: 'deferred', continuation: cont(60, 'later') })], { start: '2027-04-12', end: '2027-04-18', rows: [generated('rb-new')] });
      await assert.rejects(accept(d), /forced failure/);
      assert.equal((await row('rollback-sibling')).execution, 'not_started'); assert.equal((await row('rollback-task')).execution, 'not_started');
      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [cid]), 'active');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='rb-new' or continued_from_task_id='rollback-task'"), 0);
      assert.equal(await scalar("select count(*)::int from public.planning_cycles where starts_at_local='2027-04-12'"), 0);
      assert.equal(await scalar("select count(*)::int from public.task_events where task_id in ('rollback-sibling','rollback-task')"), 0);
      assert.equal(await scalar("select count(*)::int from public.weekly_reviews where cycle_id=$1", [cid]), 0);
      assert.equal(await scalar("select status from public.weekly_transition_drafts where id=$1", [d]), 'ready');
    });
    await check('two devices accepting the same review at once create exactly one next week', async () => {
      const cid = await open('race', 60, { start: '2027-05-03', end: '2027-05-09' });
      const d = await draft(cid, [act('race', { continuation: cont() })], { start: '2027-05-10', end: '2027-05-16' });
      const second = await asUser(OWNER);
      const [a, b] = await Promise.all([accept(d), accept(d, second)]);
      assert.equal(a.ok && b.ok, true); assert.equal(a.nextCycleId, b.nextCycleId);
      assert.equal([a, b].filter(r => r.alreadyClosed).length, 1);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='race'"), 1);
      assert.equal(await scalar("select count(*)::int from public.planning_cycles where starts_at_local='2027-05-10'"), 1);
    });
    await check('every kind of answer is recorded in the task history with its reason', async () => {
      const cid = await open('h-done', 60, { start: '2027-06-07', end: '2027-06-13' });
      for (const id of ['h-skip', 'h-defer', 'h-part', 'h-gone', 'h-unsure']) await mk(id, { cycle: cid });
      const d = await draft(cid, [act('h-done', { setExecution: 'completed' }), act('h-skip', { setExecution: 'skipped' }),
        act('h-defer', { setExecution: 'deferred', continuation: cont(60, 'later') }), act('h-part', { setExecution: 'partial', continuation: cont(60, 'continue', true) }),
        act('h-gone', { cancel: true }), act('h-unsure', { unknown: true, continuation: cont(60, 'continue', true) })], { start: '2027-06-14', end: '2027-06-20' });
      const r = await accept(d); assert.equal(r.ok, true);
      for (const [id, type] of [['h-done', 'completed'], ['h-skip', 'skipped'], ['h-defer', 'deferred'], ['h-part', 'partial'], ['h-gone', 'cancelled']]) {
        const e = (await events(id)).find(x => x.event_type === type);
        assert.ok(e, `${id} has a ${type} event`); assert.equal(e.payload.source, 'weekly_review');
      }
      assert.equal((await row('h-gone')).cancelled_at !== null, true); assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='h-gone'"), 0);
      assert.equal((await row('h-unsure')).execution, 'not_started');   // not sure leaves the record exactly as it was
      assert.deepEqual(await scalar("select unknown_task_ids from public.weekly_reviews where cycle_id=$1", [cid]), ['h-unsure']);
      assert.equal(await scalar("select carry_intent from public.plan_blocks where continued_from_task_id='h-defer'"), 'later');
    });
    await check('an empty next week is accepted, not a dead end', async () => {
      const cid = await open('empty-src', 60, { start: '2027-07-05', end: '2027-07-11' });
      const d = await draft(cid, [act('empty-src', { setExecution: 'completed' })], { start: '2027-07-12', end: '2027-07-18', rows: [] });
      const r = await accept(d); assert.equal(r.ok, true);
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where cycle_id=$1', [r.nextCycleId]), 0);
      assert.equal(await scalar('select status from public.planning_cycles where id=$1', [r.nextCycleId]), 'active');
    });
    await check('another learner, an unverified account and an incomplete setup cannot accept a review', async () => {
      const cid = await open('access', 60, { start: '2027-08-02', end: '2027-08-08' });
      const d = await draft(cid, [act('access')], { start: '2027-08-09', end: '2027-08-15' });
      await assert.rejects((await asUser(OTHER)).query('select public.accept_weekly_transition($1)', [d]), e => e.code === 'P0002');
      await assert.rejects((await asUser(UNVERIFIED)).query('select public.accept_weekly_transition($1)', [d]), e => e.code === '42501');
      await assert.rejects((await asUser(INCOMPLETE)).query('select public.accept_weekly_transition($1)', [d]), e => e.code === '42501');
      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [cid]), 'active');
    });
    await check('drafts are readable only by their owner and cannot be written by a student', async () => {
      const outsider = await asUser(OTHER);
      assert.equal((await outsider.query('select * from public.weekly_transition_drafts')).rows.length, 0);
      await assert.rejects(learner.query("insert into public.weekly_transition_drafts(user_id,cycle_id,closure_kind,choices,proposal,source_version) values ($1,$2,'no_paper','{}','{}','x')", [OWNER, C1]), /permission denied/);
      await assert.rejects(learner.query("update public.weekly_transition_drafts set status='ready'"), /permission denied/);
    });
    await check('deleting a week still works: guards stand down for cascades', async () => {
      const a = '00000000-0000-4000-8000-0000000000e1', b = '00000000-0000-4000-8000-0000000000e2';
      await cycle(a, '2028-01-03', '2028-01-09'); await cycle(b, '2028-01-10', '2028-01-16');
      await mk('casc-pred', { cycle: a });
      await admin.query("select set_config('roadmap.continuation_command','on',false)");
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,continued_from_task_id) values ('casc-succ',$1,$2,'x','2028-01-10',30,'floating','not_started','casc-pred')", [OWNER, b]);
      await admin.query("select set_config('roadmap.continuation_command','',false)");
      await admin.query('delete from public.planning_cycles where id=$1', [a]);   // cascades the original; the continuation survives, unlinked
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='casc-pred'"), 0);
      assert.equal(await scalar("select continued_from_task_id from public.plan_blocks where id='casc-succ'"), null);
      await admin.query('delete from public.planning_cycles where id=$1', [b]);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='casc-succ'"), 0);
    });
    await check('the change token moves when anything the proposal depends on changes, and only then', async () => {
      const cid = await open('token', 60, { start: '2028-02-07', end: '2028-02-13' });
      const v = () => scalar('select public.weekly_source_version($1,$2)', [OWNER, cid]);
      const base = await v(); assert.equal(await v(), base);
      await admin.query("insert into public.block_scope_confirmations(user_id,block_id,outcome_id) values ($1,'token','los-b')", [OWNER]);
      const withConfirmation = await v(); assert.notEqual(withConfirmation, base);
      await admin.query("insert into public.calendar_commitments(user_id) values ($1)", [OWNER]);
      assert.notEqual(await v(), withConfirmation);
      await admin.query("insert into public.calendar_commitments(user_id) values ($1)", [OTHER]);   // someone else's change is not mine
      const mine = await v(); await admin.query("insert into public.calendar_commitments(user_id) values ($1)", [OTHER]); assert.equal(await v(), mine);
    });

    await check('the placements saved in the preview are exactly what the new week contains', async () => {
      const cid = await open('pl-a', 45, { start: '2029-01-01', end: '2029-01-07' });
      for (const id of ['pl-b', 'pl-c']) await mk(id, { cycle: cid });
      const d = await draft(cid, [
        act('pl-a', { continuation: cont(45, 'continue', false, '2029-01-10') }),
        act('pl-b', { continuation: cont(30, 'later', false, null, 'Kept for later, as you chose.') }),
        act('pl-c', { continuation: cont(60, 'continue', false, null, 'There is no room this week.') })], { start: '2029-01-08', end: '2029-01-14' });
      const r = await accept(d); assert.equal(r.ok, true);
      const placed = (await admin.query("select *, local_date::text as ld from public.plan_blocks where continued_from_task_id='pl-a'")).rows[0];
      assert.equal(placed.ld, '2029-01-10'); assert.equal(placed.placement, 'day_preferred');
      assert.equal(placed.state, 'planned'); assert.equal(placed.day, '2029-01-10'); assert.equal(placed.duration_minutes, 45);
      for (const id of ['pl-b', 'pl-c']) {
        const u = (await admin.query('select * from public.plan_blocks where continued_from_task_id=$1', [id])).rows[0];
        assert.equal(u.local_date, null); assert.equal(u.placement, 'floating'); assert.equal(u.state, 'floating');
        assert.equal(u.day, '2029-01-08');                                   // day is text NOT NULL: the week's first day, never a stale date
      }
      assert.equal(await scalar("select carry_intent from public.plan_blocks where continued_from_task_id='pl-b'"), 'later');
    });
    await check('a placement outside the next week is refused and nothing is saved', async () => {
      const cid = await open('pl-out', 45, { start: '2029-02-05', end: '2029-02-11' });
      const d = await draft(cid, [act('pl-out', { continuation: cont(45, 'continue', false, '2029-03-01') })], { start: '2029-02-12', end: '2029-02-18' });
      await assert.rejects(accept(d), /inside the next week/);
      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [cid]), 'active');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='pl-out'"), 0);
    });
    await check('planning context carries over; evidence, class, attempt, cancellation and date do not', async () => {
      const cid = await open('ctx', 60, { start: '2029-03-05', end: '2029-03-11', execution: 'partial' });
      const ev = await scalar("insert into public.evidence_events(user_id) values ($1) returning id", [OWNER]);
      await admin.query(`update public.plan_blocks set evidence_event_id=$2, class_session_id=gen_random_uuid(), attempt_id=gen_random_uuid(), assessment_scope='{"kind":"x"}',
        cancellation_reason='r', cancellation_source_id='s', focus_distinction='Not X, but Y', verification_intent='Check Y', curriculum_reference='Ref 4.2',
        completion_meaning='Done when Y', dependencies='["a"]', source_pointer='{"p":1}', policy_version='v9', block_type='b', subject_id='fsa' where id=$1`, ['ctx', ev]);
      const r = await accept(await draft(cid, [act('ctx', { continuation: cont(60, 'continue', true, '2029-03-13') })], { start: '2029-03-12', end: '2029-03-18' })); assert.equal(r.ok, true);
      const s = (await admin.query("select * from public.plan_blocks where continued_from_task_id='ctx'")).rows[0];
      for (const k of ['learning_objective', 'suggested_approach', 'focus_distinction', 'verification_intent', 'curriculum_reference', 'completion_meaning', 'policy_version', 'block_type', 'subject_id', 'outcome_id', 'lm_id', 'scope_group_id'])
        assert.equal(s[k], (await row('ctx'))[k], `${k} carries over`);
      assert.deepEqual(s.dependencies, ['a']); assert.deepEqual(s.source_pointer, { p: 1 });
      for (const k of ['evidence_event_id', 'class_session_id', 'attempt_id', 'assessment_scope', 'cancellation_reason', 'cancellation_source_id', 'cancelled_at', 'starts_at'])
        assert.equal(s[k], null, `${k} is reset`);
      assert.equal((await row('ctx')).evidence_event_id, ev);                    // the original keeps its own evidence
      assert.equal(s.execution, 'not_started'); assert.equal(s.revision, 1); assert.equal(s.estimate_provisional, true);
    });
    await check('newly generated tasks keep their guidance, not only continuations', async () => {
      const cid = await open('gen-src', 60, { start: '2029-04-02', end: '2029-04-08' });
      const r = await accept(await draft(cid, [act('gen-src', { setExecution: 'completed' })], { start: '2029-04-09', end: '2029-04-15', rows: [generated('gen-new')] })); assert.equal(r.ok, true);
      const g = await row('gen-new');
      assert.equal(await scalar("select local_date::text from public.plan_blocks where id='gen-new'"), '2026-11-03');
      assert.equal(g.learning_objective, 'Cover X (this portion).'); assert.equal(g.suggested_approach, 'Work through it in your own material.');
      assert.equal(g.completion_meaning, 'Done when covered.'); assert.equal(g.concept_id, null); assert.equal(g.cycle_id, r.nextCycleId);
    });
    await check('the change token notices evidence being invalidated, not only evidence being added', async () => {
      const cid = await open('tok-ev', 60, { start: '2029-05-07', end: '2029-05-13' });
      const ev = await scalar("insert into public.evidence_events(user_id) values ($1) returning id", [OWNER]);
      const v = () => scalar('select public.weekly_source_version($1,$2)', [OWNER, cid]);
      const withEvidence = await v(); assert.equal(await v(), withEvidence);
      await admin.query("update public.evidence_events set validity='voided', validity_reason='challenged' where id=$1", [ev]);
      const voided = await v(); assert.notEqual(voided, withEvidence);
      await admin.query("update public.evidence_events set validity='valid', validity_reason=null where id=$1", [ev]);
      assert.equal(await v(), withEvidence);                                       // and it is a deterministic function of the rows
    });
    await check('a task change committed while acceptance waits for the lock makes the proposal stale', async () => {
      const cid = await open('lock-t', 60, { start: '2029-06-04', end: '2029-06-10' });
      const d = await draft(cid, [act('lock-t', { continuation: cont() })], { start: '2029-06-11', end: '2029-06-17' });
      const editor = await connect();
      await editor.query('BEGIN');
      await editor.query("update public.plan_blocks set execution='in_progress' where id='lock-t'");   // uncommitted: holds the row lock
      const pending = accept(d);                                                                          // must wait for the lock, THEN compare
      await new Promise(r => setTimeout(r, 400));
      await editor.query('COMMIT');
      const result = await pending;
      assert.equal(result.code, 'STALE_PROPOSAL');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id='lock-t'"), 0);
      assert.equal(await scalar("select status from public.planning_cycles where id=$1", [cid]), 'active');
    });

    await check('account deletion removes owned continuation chains and history without touching another learner', async () => {
      const uid = '00000000-0000-4000-8000-00000000dead';
      const a = '00000000-0000-4000-8000-00000000dea1';
      const b = '00000000-0000-4000-8000-00000000dea2';
      await admin.query('insert into auth.users values ($1, now())', [uid]);
      await admin.query("insert into public.profiles(id,onboarding_status) values ($1, 'complete')", [uid]);
      await cycle(a, '2029-07-02', '2029-07-08', 'closed', uid);
      await cycle(b, '2029-07-09', '2029-07-15', 'active', uid);
      await mk('delete-pred', { user: uid, cycle: a, execution: 'partial' });
      await admin.query("select set_config('roadmap.continuation_command','on',false)");
      // Lineage must be established on insert, never attached by an ordinary edit.
      await admin.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,day,local_date,duration_minutes,execution,placement,continued_from_task_id,carry_intent)
        values ('delete-succ',$1,$2,'Remaining study','2029-07-09','2029-07-09',45,'not_started','day_preferred','delete-pred','continue')`, [uid,b]);
      await admin.query("select set_config('roadmap.continuation_command','',false)");
      await admin.query("insert into public.task_events(user_id,task_id,event_type,actual_duration_minutes) values ($1,'delete-pred','partial',20)", [uid]);
      await assert.rejects(admin.query("delete from public.plan_blocks where id='delete-pred'"), /can no longer be deleted/);
      const otherTasks = await scalar('select count(*)::int from public.plan_blocks where user_id=$1',[OWNER]);
      await admin.query('delete from auth.users where id=$1',[uid]);
      assert.equal(await scalar('select count(*)::int from public.profiles where id=$1',[uid]),0);
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where user_id=$1',[uid]),0);
      assert.equal(await scalar('select count(*)::int from public.task_events where user_id=$1',[uid]),0);
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where user_id=$1',[OWNER]),otherTasks);
    });

    console.log(`\n${passed} weekly-continuity scenarios passed in isolated Postgres. No hosted database used.`);
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
