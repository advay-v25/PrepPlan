/** Rehearses 20261106_checkpoint_commands.sql on the REAL development schema inside a transaction that is ALWAYS rolled back.
 *  npm run checkpoint:rehearse -- --confirm-target=<project-ref> [--already-applied]   (prints facts only, never row data) */
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
  const cmd = async (u, key, command, args, hash) => (await c.query('select public.checkpoint_command($1,$2,$3,$4,$5::jsonb) as r', [u, key, command, hash ?? `h-${command}-${JSON.stringify(args)}`, JSON.stringify(args)])).rows[0].r
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='60s'")
    if (!args.includes('--already-applied')) await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261106_checkpoint_commands.sql'), 'utf8')))
    const [a, b] = [await one('select gen_random_uuid()'), await one('select gen_random_uuid()')]
    for (const u of [a, b]) {
      await c.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [u, `ck+${String(u).slice(0, 8)}@example.invalid`])
      await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [u])
    }
    const prof = async (u) => (await c.query('select mock_id, mock_version, mock_date::text d, mock_label, onboarding_context_version v from public.profiles where id=$1', [u])).rows[0]
    const cnt = async (t, u) => Number(await one(`select count(*) from public.${t} where user_id=$1`, [u]))
    const evidence = async (u) => JSON.stringify(await Promise.all(['evidence_events', 'assessment_attempts', 'assessment_responses', 'repair_threads', 'coach_proposals'].map(t => cnt(t, u))))

    console.log('Identity, versions and receipts')
    const r1 = await cmd(a, 'key-save-0001', 'save', { checkpointId: null, expectedVersion: null, date: '2030-06-10', kind: 'provider_mock', label: 'Coaching mock', startTime: '10:00', durationMinutes: 180 })
    ok('creating a checkpoint gives it an identity and version 1', r1.ok === true && !!r1.checkpointId && r1.version === 1)
    const id = r1.checkpointId
    const again = await cmd(a, 'key-save-0001', 'save', { checkpointId: null, expectedVersion: null, date: '2030-06-10', kind: 'provider_mock', label: 'Coaching mock', startTime: '10:00', durationMinutes: 180 })
    ok('repeating the request returns the original receipt, not a second effect', again.replayed === true && again.checkpointId === id && (await prof(a)).mock_version === 1)
    const reused = await cmd(a, 'key-save-0001', 'save', { checkpointId: id, expectedVersion: 1, date: '2030-06-11', kind: 'other' }, 'h-different')
    ok('the same key with a different payload is refused and changes nothing', reused.code === 'KEY_REUSED' && (await prof(a)).d === '2030-06-10')
    const moved = await cmd(a, 'key-save-0002', 'save', { checkpointId: id, expectedVersion: 1, date: '2030-06-17', kind: 'provider_mock', label: 'Coaching mock' })
    ok('an edit made at the current version succeeds, keeps the identity and bumps the version', moved.ok && moved.checkpointId === id && moved.version === 2)
    const stale = await cmd(a, 'key-save-0003', 'save', { checkpointId: id, expectedVersion: 1, date: '2030-07-01', kind: 'other' })
    ok('a request made against an older version cannot change the newer checkpoint', stale.code === 'CHECKPOINT_CHANGED' && (await prof(a)).d === '2030-06-17')
    const strayCancel = await cmd(a, 'key-cancel-stale', 'cancel', { checkpointId: id, expectedVersion: 1, weekStart: '2030-06-10' })
    ok('an old cancel cannot clear a newer checkpoint', strayCancel.code === 'CHECKPOINT_CHANGED' && (await prof(a)).mock_id === id)
    ok('another student’s profile is untouched by any of it', (await prof(b)).mock_id === null)
    ok('an unrelated writer (the existing onboarding save) still gets an identity and a bumped version from the trigger', await (async () => {
      await c.query("select public.onboarding_replace_position($1,'revising_or_mocks','[]'::jsonb,null,null,true,$2::jsonb)", [b, JSON.stringify({ date: '2030-08-01', kind: 'other' })])
      const p = await prof(b); return !!p.mock_id && p.mock_version === 1
    })())

    console.log('Atomicity')
    await c.query("insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-06-17','later')", [a])
    const before = { p: await prof(a), o: await cnt('mock_outcomes', a), k: await cnt('checkpoint_commands', a) }
    await c.query('SAVEPOINT s1')
    await c.query("create function pg_temp.boom() returns trigger language plpgsql as $$ begin raise exception 'forced failure'; end $$")
    // The choice is written LAST in the outcome command; failing there must undo the outcome row and the profile change as well.
    await c.query("create trigger boom before update on public.cycle_assessment_choices for each row execute function pg_temp.boom()")
    let failed = false
    try { await cmd(a, 'key-boom-0001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'taken', actualDate: '2030-06-01', today: '2030-06-02', weekStart: '2030-06-17', choice: 'keep_paper' }) } catch { failed = true }
    await c.query('ROLLBACK TO s1')
    const after = { p: await prof(a), o: await cnt('mock_outcomes', a), k: await cnt('checkpoint_commands', a) }
    ok('a failure after earlier writes rolls the whole command back (profile, outcome, choice, receipt)', failed && JSON.stringify(before) === JSON.stringify(after))
    ok('and a retry with the same key then works normally (no half-recorded state to trip over)', (await cmd(a, 'key-boom-0001', 'choice', { checkpointId: id, expectedVersion: 2, weekStart: '2030-06-17', choice: 'keep_paper' })).ok)

    console.log('Outcomes')
    const ev0 = await evidence(a)
    const future = await cmd(a, 'key-future-001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'taken', actualDate: '2030-06-05', today: '2030-06-02', weekStart: '2030-06-17' })
    ok('a future actual date is refused and records nothing', future.code === 'INVALID_ACTUAL_DATE' && (await cnt('mock_outcomes', a)) === 0 && (await prof(a)).mock_id === id)
    ok('a result cannot be recorded for a mock that was not taken', (await cmd(a, 'key-result-001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'not_taken', result: '70%', today: '2030-06-02', weekStart: '2030-06-17' })).code === 'INVALID_RESULT')
    const taken = await cmd(a, 'key-taken-0001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'taken', actualDate: '2030-06-01', today: '2030-06-02', weekStart: '2030-06-17', result: '62%' })
    const row = (await c.query('select planned_date::text pd, actual_date::text ad, outcome, reported_result, choice_at_record ch, checkpoint_id from public.mock_outcomes where user_id=$1', [a])).rows[0]
    ok('taking it early keeps the planned date and records the actual date separately', taken.ok && row.pd === '2030-06-17' && row.ad === '2030-06-01' && row.checkpoint_id === id)
    ok('the assessment choice in force is stored with the outcome (keep the paper)', row.ch === 'keep_paper')
    ok('the checkpoint is retired in the same transaction', (await prof(a)).mock_id === null && (await cnt('cycle_assessment_choices', a)) === 0)
    const replay = await cmd(a, 'key-taken-0001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'taken', actualDate: '2030-06-01', today: '2030-06-02', weekStart: '2030-06-17', result: '62%' })
    ok('repeating the same request AFTER the checkpoint was cleared returns the original receipt', replay.replayed === true && replay.outcomeId === taken.outcomeId && (await cnt('mock_outcomes', a)) === 1)
    ok('a different new request after clearance says there is no checkpoint', (await cmd(a, 'key-late-00001', 'outcome', { checkpointId: id, expectedVersion: 2, outcome: 'not_taken', today: '2030-06-02', weekStart: '2030-06-17' })).code === 'NO_CHECKPOINT')
    ok('an external report wrote no evidence, attempts, answers, repair threads or proposals', ev0 === await evidence(a))
    const mk = await cmd(a, 'key-save-0010', 'save', { checkpointId: null, expectedVersion: null, date: '2030-06-17', kind: 'provider_mock' })
    ok('the same planned date can be planned again later as a new checkpoint (history is not fabricated or overwritten)', mk.ok && mk.checkpointId !== id && (await cnt('mock_outcomes', a)) === 1)
    const id2 = mk.checkpointId
    const post = await cmd(a, 'key-post-00001', 'outcome', { checkpointId: id2, expectedVersion: 1, outcome: 'postponed', newDate: '2030-06-24', today: '2030-06-02', weekStart: '2030-06-17' })
    if (!(post.ok && post.moved)) console.log('post=', JSON.stringify(post), JSON.stringify(await prof(a)), await cnt('mock_outcomes', a))
    ok('postponing with a new date moves the same checkpoint and records the outcome together', post.ok && post.moved && (await prof(a)).d === '2030-06-24' && (await prof(a)).mock_id === id2 && (await cnt('mock_outcomes', a)) === 2)

    console.log('Suggestions and the weekly paper')
    const cyc = await one('select gen_random_uuid()')
    await c.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '7 days','2030-06-17','2030-06-23','UTC','active')", [cyc, a])
    const p = await prof(a)
    const sug = { checkpointId: id2, expectedVersion: p.mock_version, suggestionId: 'prepare-1', title: 'Prepare for Coaching mock', detail: 'x', date: '2030-06-18', startsAt: '2030-06-18T18:00:00Z', minutes: 45, cycleId: cyc }
    const s1 = await cmd(a, 'key-sug-00001', 'add_suggestion', sug)
    const s2 = await cmd(a, 'key-sug-00002', 'add_suggestion', sug)
    ok('two requests (two devices, two keys) for the same suggestion give one task', s1.ok && s2.ok && s1.taskId === s2.taskId && s2.alreadyAdded === true && (await cnt('plan_blocks', a)) === 1)
    ok('one creation event, linked to the checkpoint', (await cnt('task_events', a)) === 1 && Number(await one("select count(*) from public.checkpoint_suggestion_tasks where user_id=$1 and checkpoint_id=$2", [a, id2])) === 1)
    ok('the task is the student’s own optional review, not evidence or scope', (await one('select origin from public.plan_blocks where id=$1', [s1.taskId])) === 'student')
    ok('the older checkpoint version cannot add a suggestion', (await cmd(a, 'key-sug-00003', 'add_suggestion', { ...sug, suggestionId: 'prepare-2', expectedVersion: p.mock_version - 1 })).code === 'CHECKPOINT_CHANGED')
    const rm = await cmd(a, 'key-rm-000001', 'remove_related', { taskId: s1.taskId, expectedRevision: Number(await one('select revision from public.plan_blocks where id=$1', [s1.taskId])) })
    ok('a related task is removed by cancellation: the row and its history stay', rm.ok && (await one('select cancelled_at is not null from public.plan_blocks where id=$1', [s1.taskId])) === true)
    const s3 = await cmd(a, 'key-sug-00004', 'add_suggestion', sug)
    ok('a removed suggestion can be added again as a new task', s3.ok && s3.taskId !== s1.taskId && s3.alreadyAdded === false)
    ok('a started task is never removed by a checkpoint command', await (async () => {
      await c.query("update public.plan_blocks set execution='in_progress' where id=$1", [s3.taskId])
      return (await cmd(a, 'key-rm-000002', 'remove_related', { taskId: s3.taskId, expectedRevision: 99 })).code === 'TASK_STARTED'
    })())

    const paper = 'paper-' + String(a).slice(0, 8)
    const mkPaper = async (exec) => c.query("insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,rationale,assessment_scope,created_by) values ($1,$2,$3,'Weekly paper','','diagnostic','diagnostic','core','day_preferred',$4,'2030-06-23','2030-06-23',45,'45','x','{\"kind\":\"weekly_paper\"}'::jsonb,'algorithm')", [paper, a, cyc, exec])
    await mkPaper('not_started')
    const pv = (await prof(a))
    const c0 = await cmd(a, 'key-use-000001', 'choice', { checkpointId: id2, expectedVersion: pv.mock_version, weekStart: '2030-06-17', choice: 'use_mock' })
    ok('choosing the mock while an unstarted paper exists requires an explicit decision', c0.code === 'PAPER_DECISION_REQUIRED' && (await one('select cancelled_at is null from public.plan_blocks where id=$1', [paper])) === true)
    const c1 = await cmd(a, 'key-use-000002', 'choice', { checkpointId: id2, expectedVersion: pv.mock_version, weekStart: '2030-06-17', choice: 'use_mock', paperAction: 'replace' })
    ok('replacing it cancels (not deletes) the unstarted paper and records the cancellation', c1.ok && c1.cancelledPaperTaskId === paper && (await one('select cancelled_at is not null from public.plan_blocks where id=$1', [paper])) === true && Number(await one("select count(*) from public.task_events where task_id=$1 and event_type='cancelled'", [paper])) === 1)
    await c.query('delete from public.plan_blocks where id=$1', [paper]); await mkPaper('in_progress')
    const c2 = await cmd(a, 'key-use-000003', 'choice', { checkpointId: id2, expectedVersion: pv.mock_version, weekStart: '2030-06-17', choice: 'use_mock', paperAction: 'replace' })
    ok('a started paper is preserved: choosing the mock is refused and the paper is untouched', c2.code === 'PAPER_STARTED' && (await one('select cancelled_at is null from public.plan_blocks where id=$1', [paper])) === true)
    ok('keeping the paper (alongside the mock) is always allowed', (await cmd(a, 'key-keep-000001', 'choice', { checkpointId: id2, expectedVersion: pv.mock_version, weekStart: '2030-06-17', choice: 'keep_paper' })).ok)

    console.log('Ownership')
    const as = async (u, fn) => { await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [u, JSON.stringify({ sub: u, role: 'authenticated' })]); try { return await fn() } finally { await c.query('RESET ROLE') } }
    const denied = (u, sql, p) => as(u, async () => { try { await c.query('SAVEPOINT s'); await c.query(sql, p); await c.query('RELEASE s'); return false } catch (e) { await c.query('ROLLBACK TO s'); return /permission denied/.test(e.message) } })
    ok('a student reads only their own receipts and suggestion tasks', (await as(b, async () => (await c.query('select 1 from public.checkpoint_commands')).rowCount)) === 0 && (await as(a, async () => (await c.query('select 1 from public.checkpoint_commands')).rowCount)) > 0)
    ok('a student cannot run the command, write receipts or write suggestion tasks', await denied(b, "select public.checkpoint_command($1,'k-denied-0001','save','h','{}'::jsonb)", [b]) && await denied(b, "insert into public.checkpoint_commands (user_id,key,command,payload_hash,receipt) values ($1,'k-denied-0002','save','h','{}')", [b]) && await denied(b, "delete from public.checkpoint_suggestion_tasks"))
    console.log(`\n${n} checks passed`)
  } catch (e) { console.error('ERR:', e.message); throw e } finally { await c.query('ROLLBACK').catch(() => {}); console.log('Rolled back; the database is unchanged.'); await c.end().catch(() => {}) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
