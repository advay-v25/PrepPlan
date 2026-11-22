/** The repair loop, proven in its OWN temporary loopback-only Postgres cluster.
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
const REVIEWER = '00000000-0000-4000-8000-000000000005';
const FUTURE = { start: '2031-03-03', end: '2031-03-09' };      // a week safely in the future, so "not in the past" never interferes

async function main() {
  let bindir;
  try { bindir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim(); }
  catch { throw Error('Install local Postgres to run this isolated test. Hosted database fallback is intentionally disabled.'); }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-repair-'));
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
    const rows = async (q, args) => (await admin.query(q, args)).rows;

    // The real migrations, in order, on top of small dependency fixtures.
    await admin.query(sql('fixtures/task-execution.sql'));
    await admin.query(sql('../supabase/migrations/20260908_c2_calendar_editing.sql').split('-- 2. Recurrence')[0]);
    await admin.query(sql('../supabase/migrations/20261028_atomic_task_execution.sql'));
    await admin.query(sql('../supabase/migrations/20261028_task_scope_and_split.sql'));
    await admin.query(sql('fixtures/weekly-continuity.sql'));
    await admin.query(sql('../supabase/migrations/20261029_weekly_continuity.sql'));
    await admin.query(sql('../supabase/migrations/20261029_weekly_continuity_account_delete.sql'));
    await admin.query(sql('fixtures/repair-loop.sql'));
    await admin.query('BEGIN');
    try { await admin.query(sql('../supabase/migrations/20261031_repair_loop.sql')); await admin.query(sql('../supabase/migrations/20270110_recheck_due_date_explicit_zone.sql')); await admin.query('COMMIT'); }
    catch (e) { await admin.query('ROLLBACK'); throw e; }

    for (const id of [OWNER, OTHER, INCOMPLETE, UNVERIFIED, REVIEWER]) {
      await admin.query('insert into auth.users values ($1, $2)', [id, id === UNVERIFIED ? null : new Date()]);
      await admin.query('insert into public.profiles(id, onboarding_status) values ($1, $2)', [id, id === INCOMPLETE ? 'in_progress' : 'complete']);
    }
    await admin.query("insert into public.user_roles(user_id, role) values ($1, 'diagnostic_reviewer')", [REVIEWER]);
    const manifest = await scalar('insert into public.curriculum_manifests default values returning id');
    const asUser = async id => { const c = await connect(); await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claim.sub', $1, false)", [id]); return c; };
    const learner = await asUser(OWNER), reviewer = await asUser(REVIEWER);

    // ---- builders -----------------------------------------------------------------------------------------
    let seq = 0;
    const concept = async name => scalar('insert into public.curriculum_concepts(manifest_id, name) values ($1, $2) returning id', [manifest, name]);
    const item = async (concept_id, status = 'reviewed') => { const id = `item-${++seq}`; await admin.query('insert into public.assessment_items(id, lm_id, concept_id, review_status, item_card) values ($1, $2, $3, $4, $5)', [id, 'reading', concept_id, status, {}]); return id; };
    /** A scored-ready paper: answers = [{ item, correct, conf }]. Returns the attempt id, in progress with responses saved. */
    const paper = async (answers, { user = OWNER, purpose = 'weekly_cumulative', cycle = null, taskId = null } = {}) => {
      const bp = await scalar("insert into public.assessment_blueprints(manifest_id, purpose) values ($1, $2) returning id", [manifest, purpose]);
      const form = await scalar("insert into public.assessment_forms(blueprint_id) values ($1) returning id", [bp]);
      for (const [i, a] of answers.entries()) await admin.query('insert into public.form_items(form_id, item_id, sequence_number) values ($1, $2, $3)', [form, a.item, i + 1]);
      const attempt = await scalar("insert into public.assessment_attempts(user_id, form_id, status, attempt_kind, cycle_id) values ($1, $2, 'in_progress', $3, $4) returning id", [user, form, purpose === 'repair_recheck' ? 'repair' : 'weekly', cycle]);
      for (const a of answers) await admin.query('insert into public.assessment_responses(attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1, $2, $3, 0, $4, $5)', [attempt, a.item, user, a.correct, a.conf ?? 3]);
      if (taskId) await admin.query('update public.plan_blocks set attempt_id = $1 where id = $2', [attempt, taskId]);
      return attempt;
    };
    const finalize = async (attempt, client = learner) => (await client.query("select public.finalize_assessment_attempt($1, '1.0', '1.0') as r", [attempt])).rows[0].r;
    const thread = async (conceptId, user = OWNER) => (await rows("select * from public.repair_threads where user_id = $1 and concept_id = $2 and status not in ('closed','cancelled','superseded')", [user, conceptId]))[0];
    const cycle = async (id, start, end, status = 'active', user = OWNER) => {
      if (status === 'active') await admin.query("update public.planning_cycles set status='closed' where user_id=$1 and status='active'", [user]);
      await admin.query('insert into public.planning_cycles(id,user_id,status,starts_at_local,ends_at_local,timezone) values ($1,$2,$3,$4,$5,$6)', [id, user, status, start, end, 'UTC']);
      return id;
    };
    const uuid = () => scalar('select gen_random_uuid()');
    const task = (id, o = {}) => admin.query(
      `insert into public.plan_blocks (id,user_id,cycle_id,title,local_date,day,duration_minutes,placement,execution,task_type,repair_thread_id,outcome_id)
       values ($1,$2,$3,$4,$5,$10,$6,'day_preferred',$7,$8,$9,null)`,
      [id, o.user ?? OWNER, o.cycle, o.title ?? `Task ${id}`, o.date ?? FUTURE.start, o.minutes ?? 30, o.execution ?? 'not_started', o.type ?? 'repair', o.thread ?? null, o.date ?? FUTURE.start]);
    const planned = (id, threadId, date, minutes = 30) => ({ id, title: `Repair ${id}`, detail: 'd', local_date: date, duration_minutes: minutes, repair_thread_id: threadId, rationale: 'r', suggested_approach: 'Rework it from your own course material.', completion_meaning: 'Worked on the gap.', learning_objective: 'Close the gap' });
    /** A saved proposal exactly as the server would store it. */
    const proposal = async ({ cycleId, threadIds, tasks, check = null, waiting = [], attempt, user = OWNER, expires = '1 hour' }) => {
      const version = await scalar('select public.repair_source_version($1,$2,$3,$4)', [user, cycleId, threadIds, attempt]);
      return scalar(`insert into public.coach_proposals(user_id, intent, origin, target_cycle_id, status, expires_at, source_version, proposed_changes, reasoning)
        values ($1,'diagnostic_repair','diagnostic',$2,'pending', now() + $3::interval, $4, $5, 'test') returning id`,
        [user, cycleId, expires, version, { attemptId: attempt, threadIds, tasks, check, waitingChecks: waiting }]);
    };
    const accept = async (id, key = 'key-12345678', client = learner) => (await client.query('select public.accept_repair_proposal($1,$2) as r', [id, key])).rows[0].r;

    // =========================================================================================================
    // Scoring: one episode per concept per PAPER
    // =========================================================================================================
    let conceptA, conceptB, conceptC, firstAttempt;
    await check('several wrong answers on one concept in ONE paper are one repair episode, not several', async () => {
      conceptA = await concept('Concept A'); conceptB = await concept('Concept B'); conceptC = await concept('Concept C');
      const a1 = await item(conceptA), a2 = await item(conceptA), a3 = await item(conceptA), b1 = await item(conceptB), c1 = await item(conceptC), c2 = await item(conceptC);
      firstAttempt = await paper([{ item: a1, correct: false }, { item: a2, correct: false }, { item: a3, correct: false }, { item: b1, correct: false }, { item: c1, correct: true }, { item: c2, correct: true }]);
      const r = await finalize(firstAttempt); assert.equal(r.ok, true);
      assert.equal((await thread(conceptA)).occurrence_count, 1); assert.equal((await thread(conceptB)).occurrence_count, 1);
      assert.equal(await thread(conceptC), undefined);                                // correct and confident: nothing to repair
      assert.equal(await scalar('select count(*)::int from public.evidence_events where attempt_id=$1', [firstAttempt]), 6);
      assert.equal(await scalar("select count(*)::int from public.repair_threads where user_id=$1", [OWNER]), 2);
    });
    await check('submitting twice, or from two devices, creates no second episode', async () => {
      const again = await finalize(firstAttempt); assert.equal(again.alreadyScored, true);
      assert.equal((await thread(conceptA)).occurrence_count, 1);
      const second = await asUser(OWNER);
      const fresh = await paper([{ item: await item(conceptB), correct: false }]);
      const [x, y] = await Promise.allSettled([finalize(fresh), finalize(fresh, second)]);
      assert.ok(x.status === 'fulfilled' && y.status === 'fulfilled');
      assert.equal((await thread(conceptB)).occurrence_count, 2);                      // one new episode from the second paper, not two
      assert.equal(await scalar("select count(*)::int from public.evidence_events where attempt_id=$1", [fresh]), 1);
    });
    await check('a miss on a later paper updates the SAME thread; a confident correct answer elsewhere changes nothing', async () => {
      const before = await thread(conceptA);
      const later = await paper([{ item: await item(conceptA), correct: false }, { item: await item(conceptC), correct: true }]);
      await finalize(later);
      const after = await thread(conceptA);
      assert.equal(after.id, before.id); assert.equal(after.occurrence_count, 2); assert.equal(after.latest_attempt_id, later);
      assert.equal(await scalar("select count(*)::int from public.repair_threads where concept_id=$1", [conceptA]), 1);
    });
    await check('a correct but unsure answer is an unstable thread; an unreviewed question creates no evidence at all', async () => {
      const unsure = await concept('Concept D');
      await finalize(await paper([{ item: await item(unsure), correct: true, conf: 1 }]));
      assert.equal((await thread(unsure)).severity, 'unstable');
      const draft = await concept('Concept E');
      const practice = await paper([{ item: await item(draft, 'draft'), correct: false }]);
      assert.equal((await finalize(practice)).mode, 'practice');
      assert.equal(await thread(draft), undefined);
      assert.equal(await scalar('select count(*)::int from public.evidence_events where attempt_id=$1', [practice]), 0);
    });

    // =========================================================================================================
    // Permissions: a student cannot write evidence or repair state
    // =========================================================================================================
    await check('a signed-in student cannot write evidence, threads, events, proposals, challenges or responses', async () => {
      const t = await thread(conceptA);
      for (const [stmt, args] of [
        ["update public.repair_threads set status='closed', closure_reason='mine' where id=$1", [t.id]],
        ["delete from public.repair_threads where id=$1", [t.id]],
        ["insert into public.repair_thread_events(thread_id, event_type) values ($1,'closed')", [t.id]],
        ["update public.evidence_events set validity='voided'", []],
        ["insert into public.evidence_events(user_id, concept_id, evidence_state) values ($1,$2,'supported')", [OWNER, conceptA]],
        ["update public.assessment_responses set is_correct = true", []],
        ["update public.assessment_attempts set status='scored', score=100", []],
        ["update public.coach_proposals set status='executed'", []],
        ["update public.item_challenges set status='resolved_voided'", []],
      ]) await assert.rejects(learner.query(stmt, args), /permission denied/, stmt);
      assert.equal((await thread(conceptA)).status, 'open');
      assert.equal((await learner.query('select count(*)::int n from public.repair_threads')).rows[0].n > 0, true);   // reading their own is still fine
    });
    await check('the legacy applier that trusted caller-supplied rows is retired', async () => {
      await assert.rejects(learner.query("select public.apply_diagnostic_repair_proposal($1, '[]')", [await uuid()]), /permission denied/);
    });

    // =========================================================================================================
    // Acceptance: one saved proposal -> one traceable set of tasks
    // =========================================================================================================
    const C1 = await cycle('00000000-0000-4000-8000-0000000000c1', FUTURE.start, FUTURE.end);
    let tA, tB, accepted;
    await check('accepting a saved proposal writes the exact tasks, a linked check, thread state, history and the receipt together', async () => {
      tA = await thread(conceptA); tB = await thread(conceptB);
      const id = await proposal({ cycleId: C1, threadIds: [tA.id, tB.id], attempt: firstAttempt,
        tasks: [planned('rep-a1', tA.id, '2031-03-04', 30), planned('rep-a2', tA.id, '2031-03-05', 15), planned('rep-b1', tB.id, '2031-03-05', 30)],
        check: { id: 'chk-1', title: 'Re-check', detail: 'd', local_date: '2031-03-08', duration_minutes: 15, rationale: 'r', threadIds: [tA.id, tB.id] } });
      accepted = await accept(id);
      assert.equal(accepted.ok, true); assert.equal(accepted.replayed, false); assert.equal(accepted.taskIds.length, 4); assert.equal(accepted.checkTaskId, 'chk-1');
      const t1 = (await rows("select *, local_date::text as ld from public.plan_blocks where id='rep-a1'"))[0];
      assert.equal(t1.ld, '2031-03-04'); assert.equal(t1.duration_minutes, 30); assert.equal(t1.repair_thread_id, tA.id); assert.equal(t1.concept_id, conceptA);
      assert.equal(t1.suggested_approach, 'Rework it from your own course material.'); assert.equal(t1.completion_meaning, 'Worked on the gap.');
      assert.equal(t1.attempt_id, firstAttempt); assert.equal(t1.execution, 'not_started'); assert.equal(t1.origin, 'diagnostic');
      assert.equal((await thread(conceptA)).status, 'scheduled'); assert.equal((await thread(conceptB)).status, 'scheduled');
      assert.deepEqual((await rows("select thread_id from public.repair_check_threads where check_task_id='chk-1' order by thread_id")).map(r => r.thread_id).sort(), [tA.id, tB.id].sort());
      assert.equal(await scalar("select count(*)::int from public.task_events where task_id in ('rep-a1','rep-a2','rep-b1','chk-1') and event_type='created'"), 4);
      assert.equal(await scalar('select status from public.coach_proposals where id=$1', [id]), 'executed');
    });
    await check('an exact retry returns the original receipt and creates nothing; a different key is a clear conflict', async () => {
      const id = (await rows("select id from public.coach_proposals where status='executed' and user_id=$1", [OWNER]))[0].id;
      const again = await accept(id); assert.equal(again.replayed, true); assert.deepEqual(again.taskIds, accepted.taskIds);
      assert.equal((await accept(id, 'a-different-key')).code, 'ALREADY_ACCEPTED');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where repair_thread_id = $1", [tA.id]), 2);
    });

    const freshThreads = async (n, label) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const c = await concept(`${label}-${i}`);
        await finalize(await paper([{ item: await item(c), correct: false }]));
        out.push(await thread(c));
      }
      return out;
    };
    await check('two devices accepting the same proposal at once produce one task set and one receipt', async () => {
      const cid = await cycle('00000000-0000-4000-8000-0000000000c2', '2031-04-07', '2031-04-13');
      const [t] = await freshThreads(1, 'race');
      const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('race-1', t.id, '2031-04-08')] });
      const second = await asUser(OWNER);
      const [a, b] = await Promise.all([accept(id, 'key-race-aaaa'), accept(id, 'key-race-aaaa', second)]);
      assert.ok(a.ok && b.ok); assert.deepEqual(a.taskIds, b.taskIds);
      assert.equal([a, b].filter(r => r.replayed).length, 1);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='race-1'"), 1);
    });
    await check('a change made after the preview makes the proposal stale and writes nothing', async () => {
      const cid = await cycle('00000000-0000-4000-8000-0000000000c3', '2031-05-05', '2031-05-11');
      const [t] = await freshThreads(1, 'stale');
      await task('existing', { cycle: cid, type: 'study', date: '2031-05-06' });
      const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('stale-1', t.id, '2031-05-07')] });
      await learner.query("select public.set_task_execution($1,'existing',1,'in_progress',null,null)", [OWNER]);
      assert.equal((await accept(id)).code, 'STALE_PROPOSAL');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='stale-1'"), 0);
      assert.equal(await scalar('select status from public.coach_proposals where id=$1', [id]), 'pending');
      assert.equal((await thread(t.concept_id)).status, 'open');
    });
    await check('a repair that arrived by another route (thread already scheduled) cannot be added twice', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c3';
      const dup = await proposal({ cycleId: cid, threadIds: [tA.id], attempt: firstAttempt, tasks: [planned('dup-1', tA.id, '2031-05-07')] });
      assert.equal((await accept(dup)).code, 'STALE_PROPOSAL');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='dup-1'"), 0);
    });
    await check('a proposal cannot touch another learner, another cycle, the past or work outside its repairs', async () => {
      const cid = await cycle('00000000-0000-4000-8000-0000000000c4', '2031-06-02', '2031-06-08');
      const [mine] = await freshThreads(1, 'guard');
      const theirConcept = await concept('theirs'); await finalize(await paper([{ item: await item(theirConcept, 'reviewed'), correct: false }], { user: OTHER }), await asUser(OTHER));
      const theirs = await thread(theirConcept, OTHER);
      const attempt = mine.opened_from_attempt_id;
      const tryTasks = async (tasks, threadIds = [mine.id]) => accept(await proposal({ cycleId: cid, threadIds, attempt, tasks }), `key-${++seq}-aaaaaa`);
      await assert.rejects(tryTasks([planned('x1', theirs.id, '2031-06-03')]), /not part of this follow-up/);
      await assert.rejects(tryTasks([planned('x2', mine.id, '2031-06-20')]), /inside your open week/);
      await assert.rejects(tryTasks([planned('x3', mine.id, '2031-05-30')]), /inside your open week/);
      await assert.rejects(tryTasks([planned('x4', mine.id, '2031-06-03', 400)]), /5 to 180/);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id like 'x_'"), 0);
      assert.equal((await thread(theirConcept, OTHER)).status, 'open');
      // a proposal that names someone else's thread fails the ownership check, not just the task check
      assert.equal((await accept(await proposal({ cycleId: cid, threadIds: [theirs.id], attempt, tasks: [] }), `key-${++seq}-bbbbbb`)).code, 'STALE_PROPOSAL');
    });
    await check('a repair is never placed in the past', async () => {
      const today = await scalar("select (now() at time zone 'UTC')::date::text");
      const cid = await cycle('00000000-0000-4000-8000-0000000000c5', await scalar("select ($1::date - 3)::text", [today]), await scalar("select ($1::date + 3)::text", [today]));
      const [t] = await freshThreads(1, 'past');
      const past = await scalar("select ($1::date - 1)::text", [today]);
      await assert.rejects(accept(await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('past-1', t.id, past)] }), 'key-past-aaaaaa'), /today or later/);
      assert.equal((await accept(await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('today-1', t.id, today)] }), 'key-today-aaaa')).ok, true);
    });
    await admin.query(`create function public.fail_repair_event() returns trigger language plpgsql as $$
      begin if new.payload->>'proposalId' is not null and new.task_id = 'boom-2' then raise exception 'forced failure mid-acceptance'; end if; return new; end $$;
      create trigger test_repair_failure before insert on public.task_events for each row execute function public.fail_repair_event();`);
    await check('a failure part-way through acceptance leaves no task, link, thread change or executed proposal', async () => {
      const cid = await cycle('00000000-0000-4000-8000-0000000000c6', '2031-07-07', '2031-07-13');
      const [t] = await freshThreads(1, 'boom');
      const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('boom-1', t.id, '2031-07-08'), planned('boom-2', t.id, '2031-07-09')],
        check: { id: 'boom-chk', title: 'c', detail: 'd', local_date: '2031-07-12', duration_minutes: 15, rationale: 'r', threadIds: [t.id] } });
      await assert.rejects(accept(id), /forced failure/);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id like 'boom%'"), 0);
      assert.equal(await scalar("select count(*)::int from public.repair_check_threads where check_task_id='boom-chk'"), 0);
      assert.equal(await scalar('select status from public.coach_proposals where id=$1', [id]), 'pending');
      assert.equal((await thread(t.concept_id)).status, 'open');
    });
    await check('an unverified account, an incomplete setup and a different learner cannot accept', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c6';
      const [t] = await freshThreads(1, 'acl');
      const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('acl-1', t.id, '2031-07-10')] });
      await assert.rejects((await asUser(OTHER)).query('select public.accept_repair_proposal($1,$2)', [id, 'key-other-aaaa']), e => e.code === 'P0002');
      await assert.rejects((await asUser(UNVERIFIED)).query('select public.accept_repair_proposal($1,$2)', [id, 'key-unver-aaaa']), e => e.code === '42501');
      await assert.rejects((await asUser(INCOMPLETE)).query('select public.accept_repair_proposal($1,$2)', [id, 'key-incom-aaaa']), e => e.code === '42501');
      await assert.rejects(learner.query('select public.accept_repair_proposal($1,$2)', [id, 'short']), /request key/);
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where id='acl-1'"), 0);
    });
    await check('an expired proposal is unavailable', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c6';
      const [t] = await freshThreads(1, 'exp');
      const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: t.opened_from_attempt_id, tasks: [planned('exp-1', t.id, '2031-07-10')], expires: '-1 minute' });
      assert.equal((await accept(id)).code, 'PROPOSAL_UNAVAILABLE');
    });

    // =========================================================================================================
    // A thread follows its repair work; the check waits for the LAST portion
    // =========================================================================================================
    const run = async (id, execution, minutes = null) => {
      const rev = await scalar('select revision from public.plan_blocks where id=$1', [id]);
      return (await learner.query('select public.set_task_execution($1,$2,$3,$4,$5,null) as r', [OWNER, id, rev, execution, minutes])).rows[0].r;
    };
    const status = c => thread(c).then(t => t?.status);
    await check('finishing the first portion does not make a repair ready for its check; finishing the last does', async () => {
      await run('rep-a1', 'completed', 30);
      assert.equal(await status(conceptA), 'in_progress');
      assert.equal((await rows("select 1 from public.repair_threads where id=$1 and status='awaiting_recheck'", [tA.id])).length, 0);
      await run('rep-a2', 'completed', 15);
      assert.equal(await status(conceptA), 'awaiting_recheck');
      assert.equal(await status(conceptB), 'scheduled');                                   // B has not started: unaffected
    });
    await check('a deferred or partly done portion keeps the repair out of the check', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c2';
      const [t] = await freshThreads(1, 'defer');
      await task('d-1', { cycle: cid, thread: t.id, date: '2031-04-09' }); await task('d-2', { cycle: cid, thread: t.id, date: '2031-04-10' });
      assert.equal(await status(t.concept_id), 'scheduled');
      await run('d-1', 'completed', 20); await run('d-2', 'deferred');
      assert.equal(await status(t.concept_id), 'in_progress');
      await run('d-2', 'partial', 10);
      assert.equal(await status(t.concept_id), 'in_progress');
      await run('d-2', 'completed', 15);
      assert.equal(await status(t.concept_id), 'awaiting_recheck');
    });
    await check('cancelling every portion reopens the repair; a continuation keeps ONE logical episode', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c2';
      const [t] = await freshThreads(1, 'cont');
      await task('k-1', { cycle: cid, thread: t.id, date: '2031-04-09' });
      assert.equal(await status(t.concept_id), 'scheduled');
      await admin.query("update public.plan_blocks set cancelled_at = now() where id='k-1'");
      assert.equal(await status(t.concept_id), 'open');
      const [u] = await freshThreads(1, 'cont2');
      await task('m-1', { cycle: cid, thread: u.id, date: '2031-04-09' }); await run('m-1', 'partial', 10);
      const later = await cycle('00000000-0000-4000-8000-0000000000c7', '2031-08-04', '2031-08-10');
      await admin.query("select set_config('roadmap.continuation_command','on',false)");
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type,repair_thread_id,continued_from_task_id) values ('m-2',$1,$2,'x','2031-08-04',30,'floating','not_started','repair',$3,'m-1')", [OWNER, later, u.id]);
      await admin.query("select set_config('roadmap.continuation_command','',false)");
      assert.equal(await status(u.concept_id), 'scheduled');                               // the partly done original no longer counts; its continuation does
      await run('m-2', 'completed', 25);
      assert.equal(await status(u.concept_id), 'awaiting_recheck');
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where repair_thread_id=$1 and not exists (select 1 from public.plan_blocks s where s.continued_from_task_id = plan_blocks.id)", [u.id]), 1);
    });

    // =========================================================================================================
    // The re-check: exactly the repaired scope, dependency-safe, atomic, resumable
    // =========================================================================================================
    const items = async (c, n) => { const out = []; for (let i = 0; i < n; i++) out.push(await item(c)); return out; };
    const start = async (taskId, itemIds, o = {}) => (await admin.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as r',
      [o.user ?? OWNER, taskId, itemIds, manifest, { kind: 'repair' }, { ceiling: 90 }, { kind: 'repair' }, { delivered: itemIds.length }, { threadIds: o.threadIds ?? [], policy: 'repair-loop-1' }, o.min ?? 5])).rows[0].r;
    await check('a check waits while any repair it covers has work left, and names what it is waiting on', async () => {
      const r = await start('chk-1', await items(conceptA, 5));
      assert.equal(r.ok, false); assert.equal(r.code, 'WAITING_ON_REPAIRS'); assert.deepEqual(r.threadIds, [tB.id]);          // A is done, B is not
      assert.equal(await scalar("select attempt_id from public.plan_blocks where id='chk-1'"), null);
      assert.equal(await scalar('select count(*)::int from public.assessment_blueprints where purpose=$1', ['repair_recheck']), 0);
    });
    await check('once every covered repair is finished the check can start', async () => {
      await run('rep-b1', 'completed', 30);
      assert.equal(await status(conceptB), 'awaiting_recheck');
      const ia = await items(conceptA, 3), ib = await items(conceptB, 3);
      const r = await start('chk-1', [...ia, ...ib], { threadIds: [tA.id, tB.id] });
      assert.equal(r.ok, true); assert.equal(r.resumed, false); assert.equal(r.questions, 6);
      assert.equal(await scalar("select attempt_id is not null from public.plan_blocks where id='chk-1'"), true);
      assert.equal(await scalar("select count(*)::int from public.form_items where form_id = (select form_id from public.assessment_attempts where id = (select attempt_id from public.plan_blocks where id='chk-1'))"), 6);
      assert.deepEqual((await rows("select scope->'threadIds' as t, purpose from public.paper_scope_snapshots where attempt_id = (select attempt_id from public.plan_blocks where id='chk-1')"))[0].t, [tA.id, tB.id]);
    });
    await check('starting again resumes the same paper, even when its own questions are no longer "unseen"', async () => {
      const attempt = await scalar("select attempt_id from public.plan_blocks where id='chk-1'");
      const before = await scalar('select count(*)::int from public.assessment_blueprints');
      for (const it of await rows('select item_id from public.form_items where form_id = (select form_id from public.assessment_attempts where id=$1)', [attempt]))
        await admin.query("insert into public.assessment_responses(attempt_id, item_id, user_id) values ($1,$2,$3) on conflict do nothing", [attempt, it.item_id, OWNER]);
      const again = await start('chk-1', await items(conceptA, 5), { threadIds: [tA.id] });
      assert.equal(again.ok, true); assert.equal(again.resumed, true); assert.equal(again.attemptId, attempt);
      assert.equal(await scalar('select count(*)::int from public.assessment_blueprints'), before);
    });
    await check('a check never accepts a question about an unrelated concept, a question already seen, or fewer than five', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c2';
      const [t] = await freshThreads(1, 'scope');
      await task('s-1', { cycle: cid, thread: t.id, date: '2031-04-09' });
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type) values ('s-chk',$1,$2,'check','2031-04-11',15,'day_preferred','not_started','recheck')", [OWNER, cid]);
      await admin.query('insert into public.repair_check_threads(check_task_id, thread_id, user_id) values ($1,$2,$3)', ['s-chk', t.id, OWNER]);
      await run('s-1', 'completed', 30);
      const mine = await items(t.concept_id, 4), stranger = await item(conceptC);
      await assert.rejects(start('s-chk', [...mine, stranger]), /outside the repairs/);
      assert.equal((await start('s-chk', mine)).code, 'BANK_INSUFFICIENT');                  // 4 < 5: three-versus-five is one rule, enforced here too
      const seen = await item(t.concept_id);
      await admin.query("insert into public.assessment_responses(attempt_id, item_id, user_id) values ($1,$2,$3)", [await paper([{ item: await item(conceptC), correct: true }]), seen, OWNER]);
      assert.equal((await start('s-chk', [...mine, seen])).code, 'BANK_CHANGED');
      assert.equal(await scalar("select attempt_id from public.plan_blocks where id='s-chk'"), null);
    });
    await admin.query(`create function public.fail_snapshot() returns trigger language plpgsql as $$
      begin if new.scope->>'boom' = 'yes' then raise exception 'forced failure while freezing scope'; end if; return new; end $$;
      create trigger test_snapshot_failure before insert on public.paper_scope_snapshots for each row execute function public.fail_snapshot();`);
    await check('a failure part-way through starting leaves no orphan paper, form, questions or attempt', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c2';
      const [t] = await freshThreads(1, 'orphan');
      await task('o-1', { cycle: cid, thread: t.id, date: '2031-04-09' });
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type) values ('o-chk',$1,$2,'check','2031-04-11',15,'day_preferred','not_started','recheck')", [OWNER, cid]);
      await admin.query('insert into public.repair_check_threads(check_task_id, thread_id, user_id) values ($1,$2,$3)', ['o-chk', t.id, OWNER]);
      await run('o-1', 'completed', 30);
      const counts = async () => rows('select (select count(*) from public.assessment_blueprints)::int b, (select count(*) from public.assessment_forms)::int f, (select count(*) from public.form_items)::int i, (select count(*) from public.assessment_attempts)::int a');
      const before = (await counts())[0];
      await assert.rejects(admin.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5)', [OWNER, 'o-chk', await items(t.concept_id, 5), manifest, {}, {}, {}, {}, { boom: 'yes' }]), /forced failure/);
      assert.deepEqual((await counts())[0], before);
      assert.equal(await scalar("select attempt_id from public.plan_blocks where id='o-chk'"), null);
    });
    await check('only the server may start a check: a student cannot call the start command directly', async () => {
      await assert.rejects(learner.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5)', [OWNER, 'chk-1', [], manifest, {}, {}, {}, {}, {}]), /permission denied/);
    });

    // =========================================================================================================
    // What a scored check does to its threads
    // =========================================================================================================
    await check('a failed check reopens the SAME thread; a supported one is recorded but does not close it; an unassessed one stays open', async () => {
      const attempt = await scalar("select attempt_id from public.plan_blocks where id='chk-1'");
      const forms = await rows('select item_id from public.form_items where form_id = (select form_id from public.assessment_attempts where id=$1) order by sequence_number', [attempt]);
      // The paper has 3 questions on A and 3 on B. Answer A fully correctly with confidence; miss B.
      await admin.query('delete from public.assessment_responses where attempt_id=$1', [attempt]);
      for (const it of forms) {
        const concept_id = await scalar('select concept_id from public.assessment_items where id=$1', [it.item_id]);
        await admin.query('insert into public.assessment_responses(attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1,$2,$3,0,$4,4)', [attempt, it.item_id, OWNER, concept_id === conceptA]);
      }
      const beforeB = await thread(conceptB);
      await finalize(attempt);
      const a = await thread(conceptA), b = await thread(conceptB);
      assert.equal(a.latest_check_state, 'supported'); assert.equal(a.status, 'awaiting_recheck'); assert.equal(a.closed_at, null);   // recorded, not closed: no resolution policy yet
      assert.equal(b.id, beforeB.id); assert.equal(b.status, 'open'); assert.equal(b.latest_check_state, 'still_needs_work'); assert.equal(b.occurrence_count, beforeB.occurrence_count + 1);
      assert.equal(await scalar("select count(*)::int from public.repair_thread_events where thread_id=$1 and event_type='check_supported'", [tA.id]), 1);
    });
    await check('a thread the check could not assess stays open and says "not assessed" instead of closing by omission', async () => {
      const cid = '00000000-0000-4000-8000-0000000000c2';
      const [t1, t2] = await freshThreads(2, 'na');
      for (const [n, t] of [['na-1', t1], ['na-2', t2]]) { await task(n, { cycle: cid, thread: t.id, date: '2031-04-09' }); await run(n, 'completed', 20); }
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type) values ('na-chk',$1,$2,'check','2031-04-12',15,'day_preferred','not_started','recheck')", [OWNER, cid]);
      for (const t of [t1, t2]) await admin.query('insert into public.repair_check_threads(check_task_id, thread_id, user_id) values ($1,$2,$3)', ['na-chk', t.id, OWNER]);
      const r = await start('na-chk', await items(t1.concept_id, 5), { threadIds: [t1.id, t2.id] });         // only t1's concept has questions
      const attempt = r.attemptId;
      for (const it of await rows('select item_id from public.form_items where form_id=(select form_id from public.assessment_attempts where id=$1)', [attempt]))
        await admin.query('insert into public.assessment_responses(attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1,$2,$3,0,true,4)', [attempt, it.item_id, OWNER]);
      await finalize(attempt);
      assert.equal((await thread(t1.concept_id)).latest_check_state, 'supported');
      const open2 = await thread(t2.concept_id);
      assert.equal(open2.latest_check_state, 'not_assessed'); assert.equal(open2.status, 'awaiting_recheck');
    });
    await check('an older "supported" never sits beside a newer miss: newer evidence reopens the gap and retires the verdict', async () => {
      const a = await thread(conceptA); assert.equal(a.latest_check_state, 'supported');
      await finalize(await paper([{ item: await item(conceptA), correct: false }]));
      const after = await thread(conceptA);
      assert.equal(after.id, a.id); assert.equal(after.status, 'open'); assert.equal(after.latest_check_state, null); assert.equal(after.occurrence_count, a.occurrence_count + 1);
    });

    await check('a due re-check is added to the open week once, linked to exactly the finished repairs', async () => {
      const today = await scalar("select (now() at time zone 'UTC')::date::text");
      const cid = await cycle('00000000-0000-4000-8000-0000000000c8', await scalar("select ($1::date - 2)::text", [today]), await scalar("select ($1::date + 5)::text", [today]));
      const [t1, t2] = await freshThreads(2, 'place');
      await task('pl-1', { cycle: cid, thread: t1.id, date: today }); await run('pl-1', 'completed', 20);
      const call = (ids, key) => learner.query('select public.place_repair_check($1,$2) as r', [ids, key]).then(r => r.rows[0].r);
      assert.equal((await call([t1.id, t2.id], 'place-aaaa-1')).code, 'NOT_READY');            // t2 has no finished repair
      const r = await call([t1.id], 'place-aaaa-2'); assert.equal(r.ok, true);
      assert.deepEqual((await rows('select thread_id from public.repair_check_threads where check_task_id=$1', [r.checkTaskId])).map(x => x.thread_id), [t1.id]);
      assert.equal((await call([t1.id], 'place-aaaa-2')).replayed, true);                       // same key: same task
      assert.equal((await call([t1.id], 'place-aaaa-3')).code, 'ALREADY_PLANNED');              // new key: not a second check
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where task_type='recheck' and id like 'task-chk-place%'"), 1);
    });
    // A re-check due date is a CALENDAR DATE kept in a timestamptz (midnight UTC by convention). Writing it with `date::timestamptz` and reading it with `::date` used the
    // SESSION zone, so a Kolkata session stored the date a day early and a Los Angeles session read it a day early. The same fixed inputs must give the same date in any zone.
    await check('the re-check due date written and read by the database does not depend on the session time zone', async () => {
      for (const zone of ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
        const today = await scalar("select (now() at time zone 'UTC')::date::text"), due = await scalar("select ($1::date + 3)::text", [today]);
        const cid = await cycle(await uuid(), await scalar("select ($1::date - 2)::text", [today]), await scalar("select ($1::date + 9)::text", [today]));
        const [t] = await freshThreads(1, `zone-${zone}`);
        const lz = await asUser(OWNER); await lz.query('select set_config($1,$2,false)', ['timezone', zone]);
        assert.equal((await lz.query('show timezone')).rows[0].TimeZone, zone);
        const id = await proposal({ cycleId: cid, threadIds: [t.id], attempt: firstAttempt, tasks: [], waiting: [{ threadIds: [t.id], earliestDate: due }] });
        const r = await accept(id, `zone-key-${zone.replace(/\W/g, '')}`, lz); assert.equal(r.ok, true, `${zone}: ${JSON.stringify(r)}`);
        assert.equal(await scalar("select (next_recheck_due_at at time zone 'UTC')::date::text from public.repair_threads where id=$1", [t.id]), due, `${zone}: stored date`);
        await task(`zt-${zone.replace(/\W/g, '')}`, { cycle: cid, thread: t.id, date: today }); await run(`zt-${zone.replace(/\W/g, '')}`, 'completed', 20);
        await admin.query("update public.repair_threads set status='awaiting_recheck' where id=$1", [t.id]);
        const placed = (await lz.query('select public.place_repair_check($1,$2) as r', [[t.id], `zone-place-${zone.replace(/\W/g, '')}`])).rows[0].r;
        assert.equal(placed.ok, true, `${zone}: ${JSON.stringify(placed)}`); assert.equal(placed.date, due, `${zone}: placed on the stored date`);
      }
    });
    // =========================================================================================================
    // Challenges: a pending challenge hides nothing permanently; an authorised void removes only its own contribution
    // =========================================================================================================
    const chal = async (answers) => {
      const c = await concept(`chal-${++seq}`);
      const its = []; for (const a of answers) its.push(await item(c));
      const attempt = await paper(answers.map((a, i) => ({ item: its[i], correct: a.correct, conf: a.conf })));
      await finalize(attempt);
      return { c, its, attempt, t: await thread(c) };
    };
    const raise = (x, i = 0) => learner.query('select public.raise_item_challenge($1,$2,$3,$4) as id', [x.attempt, x.its[i], 'looks wrong', 'wrong_key']).then(r => r.rows[0].id);
    await check('a pending challenge marks the evidence as disputed but cancels no work', async () => {
      const x = await chal([{ correct: false }]);
      const cid = '00000000-0000-4000-8000-0000000000c2';
      await task('ch-1', { cycle: cid, thread: x.t.id, date: '2031-04-09' });
      await raise(x);
      assert.equal(await scalar("select validity from public.evidence_events where attempt_id=$1", [x.attempt]), 'disputed');
      assert.equal((await thread(x.c)).status, 'scheduled'); assert.equal(await scalar("select cancelled_at is null from public.plan_blocks where id='ch-1'"), true);
    });
    await check('keeping the question restores the evidence and changes nothing else', async () => {
      const x = await chal([{ correct: false }]);
      const id = await raise(x);
      await reviewer.query('select public.resolve_item_challenge($1,$2)', [id, 'resolved_kept']);
      assert.equal(await scalar("select validity from public.evidence_events where attempt_id=$1", [x.attempt]), 'valid');
      assert.equal((await thread(x.c)).status, 'open');
    });
    await check('an authorised void cancels only unstarted work no longer justified; started and finished work and the history stay', async () => {
      const x = await chal([{ correct: false }]);
      const cid = '00000000-0000-4000-8000-0000000000c2';
      for (const [n, ex] of [['v-open', 'not_started'], ['v-later', 'deferred'], ['v-going', 'in_progress'], ['v-done', 'completed']]) await task(n, { cycle: cid, thread: x.t.id, date: '2031-04-09', execution: ex });
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type) values ('v-chk',$1,$2,'check','2031-04-12',15,'day_preferred','not_started','recheck')", [OWNER, cid]);
      await admin.query('insert into public.repair_check_threads(check_task_id, thread_id, user_id) values ($1,$2,$3)', ['v-chk', x.t.id, OWNER]);
      const id = await raise(x);
      const r = (await reviewer.query('select public.resolve_item_challenge($1,$2) as r', [id, 'resolved_voided'])).rows[0].r;
      assert.equal(r.cancelledThreads, 1); assert.equal(r.cancelledTasks, 3);                       // v-open, v-later and the now-pointless check
      const cancelled = id2 => scalar('select cancelled_at is not null from public.plan_blocks where id=$1', [id2]);
      assert.equal(await cancelled('v-open'), true); assert.equal(await cancelled('v-later'), true); assert.equal(await cancelled('v-chk'), true);
      assert.equal(await cancelled('v-going'), false); assert.equal(await cancelled('v-done'), false);
      assert.equal(await scalar("select cancellation_reason from public.plan_blocks where id='v-open'"), 'evidence_voided');
      assert.equal((await rows('select status, closure_reason from public.repair_threads where id=$1', [x.t.id]))[0].status, 'cancelled');
      assert.equal(await scalar("select status from public.assessment_attempts where id=$1", [x.attempt]), 'scored');   // the student can still read their result
      assert.equal(await scalar("select result_revision from public.assessment_attempts where id=$1", [x.attempt]), 2);
      assert.equal(await scalar("select count(*)::int from public.task_events where task_id='v-open' and event_type='origin_invalidated'"), 1);
    });
    await check('a void leaves the repair in place when another valid answer still justifies it', async () => {
      const x = await chal([{ correct: false }]);
      await finalize(await paper([{ item: await item(x.c), correct: false }]));                      // a second, separate miss on the same concept
      const id = await raise(x);
      const r = (await reviewer.query('select public.resolve_item_challenge($1,$2) as r', [id, 'resolved_voided'])).rows[0].r;
      assert.equal(r.cancelledThreads, 0); assert.equal((await thread(x.c)).status, 'open');
    });
    await check('only an authorised reviewer can resolve a challenge', async () => {
      const x = await chal([{ correct: false }]);
      const id = await raise(x);
      await assert.rejects(learner.query('select public.resolve_item_challenge($1,$2)', [id, 'resolved_voided']), /Unauthorized/);
      assert.equal(await scalar('select status from public.item_challenges where id=$1', [id]), 'pending');
    });

    // =========================================================================================================
    // Deleting an account with repair history still works
    // =========================================================================================================
    await check('deleting an account removes its threads, history, links, proposals and tasks without error', async () => {
      await admin.query('alter table public.profiles drop constraint profiles_id_fkey, add constraint profiles_id_fkey foreign key (id) references auth.users(id) on delete cascade').catch(() => {});
      const D = '00000000-0000-4000-8000-0000000000dd';
      await admin.query('insert into auth.users values ($1, now())', [D]); await admin.query("insert into public.profiles(id, onboarding_status) values ($1,'complete')", [D]);
      const dc = await concept('delete-me'); await finalize(await paper([{ item: await item(dc), correct: false }], { user: D }), await asUser(D));
      const t = await thread(dc, D);
      const cid = await cycle('00000000-0000-4000-8000-0000000000dc', '2031-09-01', '2031-09-07', 'active', D);
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type,repair_thread_id) values ('del-r',$1,$2,'r','2031-09-02',30,'day_preferred','not_started','repair',$3)", [D, cid, t.id]);
      await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,duration_minutes,placement,execution,task_type) values ('del-c',$1,$2,'c','2031-09-05',15,'day_preferred','not_started','recheck')", [D, cid]);
      await admin.query("insert into public.repair_check_threads(check_task_id, thread_id, user_id) values ('del-c',$1,$2)", [t.id, D]);
      await admin.query("insert into public.repair_thread_events(thread_id, event_type) values ($1,'note')", [t.id]);
      await admin.query("insert into public.coach_proposals(user_id, intent, origin, status) values ($1,'diagnostic_repair','diagnostic','pending')", [D]);
      await admin.query('delete from auth.users where id = $1', [D]);
      for (const q of ['select count(*) from public.repair_threads where user_id=$1', 'select count(*) from public.plan_blocks where user_id=$1', 'select count(*) from public.repair_check_threads where user_id=$1', 'select count(*) from public.coach_proposals where user_id=$1'])
        assert.equal(await scalar(q.replace('select count(*)', 'select count(*)::int'), [D]), 0, q);
      assert.equal(await scalar("select count(*)::int from public.repair_thread_events where thread_id=$1", [t.id]), 0);
    });

    // Exercise the latest reservation guard after the historical fixtures above (which deliberately use future planning dates).
    if (process.env.REPAIR_START_WITHOUT_GUARD !== '1') await admin.query(sql('../supabase/migrations/20270111_recheck_start_date_guard.sql'));
    const today0 = await scalar("select to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD')");
    const plus = async days => scalar("select ($1::date + $2::int)::text", [today0, days]);
    const guardCycle = await cycle('00000000-0000-4000-8000-0000000000ef', await plus(-7), await plus(7));
    const [guardThread] = await freshThreads(1, 'date-guard');
    await task('date-guard-repair', { cycle: guardCycle, thread: guardThread.id, date: today0 });
    await run('date-guard-repair', 'completed', 20);
    await admin.query("update public.task_events set created_at=clock_timestamp()-interval '4 days' where task_id='date-guard-repair' and event_type='completed'");
    await admin.query("update public.repair_threads set next_recheck_due_at=($1::date::timestamp at time zone 'UTC') where id=$2", [today0, guardThread.id]);
    await admin.query("insert into public.plan_blocks(id,user_id,cycle_id,title,day,local_date,duration_minutes,placement,execution,task_type) values ('date-guard-check',$1,$2,'check',$3::text,$3::date,15,'day_preferred','not_started','recheck')", [OWNER, guardCycle, await plus(1)]);
    await admin.query("insert into public.repair_check_threads(check_task_id,thread_id,user_id) values ('date-guard-check',$1,$2)", [guardThread.id, OWNER]);
    const guardItems = await items(guardThread.concept_id, 5);
    const allocationCounts = async () => rows('select (select count(*) from public.assessment_blueprints)::int b, (select count(*) from public.assessment_forms)::int f, (select count(*) from public.assessment_attempts)::int a, (select count(*) from public.form_items)::int q');
    const noReservation = async work => { const before = await allocationCounts(); await work(); assert.deepEqual(await allocationCounts(), before); assert.equal(await scalar("select attempt_id from public.plan_blocks where id='date-guard-check'"), null); };
    await check('transactional Start refuses a future planned date and creates no paper', async () => noReservation(async () => {
      const r = await start('date-guard-check', guardItems); assert.equal(r.code, 'RECHECK_NOT_DUE'); assert.equal(r.earliestDate, await plus(1));
    }));
    await check('moving the check earlier cannot skip completion plus three local days', async () => noReservation(async () => {
      await admin.query("update public.plan_blocks set local_date=$1::date where id='date-guard-check'", [today0]);
      await admin.query("update public.task_events set created_at=clock_timestamp() where task_id='date-guard-repair' and event_type='completed'");
      const r = await start('date-guard-check', guardItems); assert.equal(r.code, 'RECHECK_NOT_DUE'); assert.equal(r.earliestDate, await plus(3));
    }));
    await check('a later advertised due date still wins after repair spacing has elapsed', async () => noReservation(async () => {
      await admin.query("update public.task_events set created_at=clock_timestamp()-interval '4 days' where task_id='date-guard-repair' and event_type='completed'");
      await admin.query("update public.repair_threads set next_recheck_due_at=($1::date::timestamp at time zone 'UTC') where id=$2", [await plus(2), guardThread.id]);
      const r = await start('date-guard-check', guardItems); assert.equal(r.code, 'RECHECK_NOT_DUE'); assert.equal(r.earliestDate, await plus(2));
    }));
    for (const zone of ['Asia/Kolkata', 'Europe/London', 'America/Los_Angeles']) await check(`SQL Start uses the ${zone} student's dates even in an Auckland database session`, async () => noReservation(async () => {
      await admin.query("set timezone='Pacific/Auckland'");
      await admin.query('update public.profiles set timezone=$1 where id=$2', [zone, OWNER]);
      const due = await scalar("select ((clock_timestamp() at time zone $1)::date+2)::text", [zone]);
      await admin.query("update public.repair_threads set next_recheck_due_at=($1::date::timestamp at time zone 'UTC') where id=$2", [due, guardThread.id]);
      const r = await start('date-guard-check', guardItems); assert.equal(r.code, 'RECHECK_NOT_DUE'); assert.equal(r.earliestDate, due);
      await admin.query("set timezone='UTC'");
      await admin.query("update public.profiles set timezone='UTC' where id=$1", [OWNER]);
    }));
    await check('a missing completion event cannot be used to reserve a check', async () => noReservation(async () => {
      await admin.query("delete from public.task_events where task_id='date-guard-repair' and event_type='completed'");
      const r = await start('date-guard-check', guardItems); assert.equal(r.code, 'WAITING_ON_REPAIRS'); assert.match(r.message, /completion time/);
    }));
    await check('an eligible check starts and subsequent calls resume despite a later date change', async () => {
      await admin.query("insert into public.task_events(user_id,task_id,event_type,created_at) values ($1,'date-guard-repair','completed',clock_timestamp()-interval '4 days')", [OWNER]);
      await admin.query("update public.repair_threads set next_recheck_due_at=($1::date::timestamp at time zone 'UTC') where id=$2", [today0, guardThread.id]);
      const first = await start('date-guard-check', guardItems); assert.equal(first.ok, true); assert.equal(first.resumed, false);
      await admin.query("update public.plan_blocks set local_date=$1::date where id='date-guard-check'", [await plus(1)]);
      const resumed = await start('date-guard-check', guardItems); assert.equal(resumed.ok, true); assert.equal(resumed.resumed, true); assert.equal(resumed.attemptId, first.attemptId);
    });

    console.log(`\n${passed} repair-loop scenarios passed in isolated Postgres. No hosted database used.`);
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
