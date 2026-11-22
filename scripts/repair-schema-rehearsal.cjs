/** Runs the repair-loop migration and one full journey on the REAL development schema, inside a transaction that is ALWAYS rolled back.
 *  npm run repair:schema:rehearse -- --confirm-target=<project-ref> [--already-applied]
 *  Reads only .env.staging.local; refuses unless it is the user-confirmed disposable project; prints facts, never row data. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration, transactionalSql } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..')
  const env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const deployed = args.includes('--already-applied')
  setTimeout(() => { console.error('Stopped: the database stopped responding. Nothing persists.'); process.exit(2) }, 180000).unref()
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 70000 })
  await c.connect(); let n = 0
  const ok = (name, v) => { assert.ok(v, name); n++; console.log(`  ✓ ${name}`) }
  const q = async (s, a) => (await c.query(s, a)).rows, one = async (s, a) => Object.values((await q(s, a))[0] ?? { v: null })[0]
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='60s'"); await c.query("SET LOCAL lock_timeout='15s'")
    const present = await one("select to_regclass('public.repair_check_threads') is not null")
    if (present !== deployed) throw Error(present ? 'Already applied: re-run with --already-applied.' : '--already-applied given but the migration is not present.')
    if (!deployed) await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261031_repair_loop.sql'), 'utf8')))
    ok(deployed ? 'the migration is present (exercised as deployed)' : 'the migration applies cleanly on the real schema', true)

    // Real bank depth is about three usable questions per concept, so the journey uses three concepts: one miss each, then a combined check.
    const cs = await q(`select i.concept_id, c.manifest_id from public.assessment_items i join public.curriculum_concepts c on c.id=i.concept_id
      where i.review_status = 'reviewed' and i.concept_id is not null group by 1,2 having count(*) >= 3 order by 1 limit 3`)
    if (cs.length < 3) { console.log('  (fewer than 3 concepts with 3+ usable questions: skipping the scored journey)'); return }
    const manifest = cs[0].manifest_id
    const byConcept = []; for (const k of cs) byConcept.push((await q("select id from public.assessment_items where concept_id=$1 and review_status = 'reviewed' order by id limit 3", [k.concept_id])).map(r => r.id))
    const uid = await one('select gen_random_uuid()'); const cyc = await one('select gen_random_uuid()')
    await c.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [uid, `rehearsal+${String(uid).slice(0, 8)}@example.invalid`])
    await c.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [uid]); await c.query("update public.profiles set onboarding_status='complete' where id=$1", [uid])
    await c.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, uid])
    const bp = await one("insert into public.assessment_blueprints (manifest_id,purpose,requested_scope,constraints) values ($1,'weekly_cumulative','{}','{}') returning id", [manifest])
    const form = await one("insert into public.assessment_forms (blueprint_id,delivery_mode) values ($1,'fixed') returning id", [bp])
    const first = byConcept.map(x => x[0])
    for (const [i, it] of first.entries()) await c.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,$3)', [form, it, i + 1])
    const attempt = await one("insert into public.assessment_attempts (user_id,form_id,delivery_mode,status,attempt_kind,cycle_id) values ($1,$2,'fixed','in_progress','weekly',$3) returning id", [uid, form, cyc])
    for (const it of first) await c.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,0,false,4)', [attempt, it, uid])
    const as = async (fn) => { await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })]); try { return await fn() } finally { await c.query('RESET ROLE') } }

    const fin = await as(() => one("select public.finalize_assessment_attempt($1,'1.0','1.0')", [attempt]))
    ok('scoring works on the real schema', fin.ok === true)
    const th = await q('select * from public.repair_threads where user_id=$1 order by id', [uid])
    ok('one miss on each of three concepts is three threads, one episode each', th.length === 3 && th.every(t => t.occurrence_count === 1 && t.status === 'open'))
    ok('events are written for the threads', Number(await one("select count(*) from public.repair_thread_events where event_type='opened' and thread_id = any($1)", [th.map(t => t.id)])) === 3)

    const writeBlocked = await as(async () => { try { await c.query('SAVEPOINT s'); await c.query("update public.repair_threads set status='closed' where user_id=$1", [uid]); await c.query('RELEASE s'); return false } catch (e) { await c.query('ROLLBACK TO s'); return /permission denied/.test(e.message) } })
    ok('a signed-in student cannot close their own repair threads', writeBlocked)

    const ids = th.map(t => t.id)
    const version = await one('select public.repair_source_version($1,$2,$3,$4)', [uid, cyc, ids, attempt])
    const day = await one("select (current_date + 1)::text")
    const changes = { attemptId: attempt, threadIds: ids,
      tasks: ids.map((id, i) => ({ id: `task-${uid}-r${i}`, title: 'Repair', detail: 'd', local_date: day, duration_minutes: 30, repair_thread_id: id, rationale: 'r', suggested_approach: 'a', completion_meaning: 'm', learning_objective: 'o' })),
      check: { id: `task-${uid}-c`, title: 'Re-check', detail: 'd', local_date: await one("select (current_date + 5)::text"), duration_minutes: 15, rationale: 'r', threadIds: ids }, waitingChecks: [] }
    const pid = await one("insert into public.coach_proposals (user_id,intent,origin,target_cycle_id,status,expires_at,source_version,proposed_changes,reasoning) values ($1,'diagnostic_repair','diagnostic',$2,'pending',now()+interval '1 hour',$3,$4,'t') returning id", [uid, cyc, version, changes])
    const acc = await as(() => one('select public.accept_repair_proposal($1,$2)', [pid, 'rehearsal-key-1']))
    ok('acceptance succeeds on the real tables and constraints', acc.ok === true && acc.taskIds.length === 4)
    ok('every thread followed its task (scheduled) and one check links all three', Number(await one("select count(*) from public.repair_threads where user_id=$1 and status='scheduled'", [uid])) === 3 && Number(await one('select count(*) from public.repair_check_threads where check_task_id=$1', [`task-${uid}-c`])) === 3)
    const again = await as(() => one('select public.accept_repair_proposal($1,$2)', [pid, 'rehearsal-key-1']))
    ok('a retry returns the same receipt and adds nothing', again.replayed === true && Number(await one("select count(*) from public.plan_blocks where user_id=$1", [uid])) === 4)

    const waiting = (await c.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5) as r', [uid, `task-${uid}-c`, byConcept.flatMap(x => x.slice(1)), manifest, {}, {}, {}, {}, {}])).rows[0].r
    ok('the check refuses to start while any repair is unfinished', waiting.ok === false && waiting.code === 'WAITING_ON_REPAIRS' && waiting.threadIds.length === 3)
    for (let i = 0; i < 3; i++) await as(() => c.query("select public.set_task_execution($1,$2,1,'completed',20,null)", [uid, `task-${uid}-r${i}`]))
    ok('finishing every repair makes every thread ready for its check', Number(await one("select count(*) from public.repair_threads where user_id=$1 and status='awaiting_recheck'", [uid])) === 3)

    const start = (await c.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5) as r', [uid, `task-${uid}-c`, byConcept.flatMap(x => x.slice(1)), manifest, { kind: 'repair' }, { ceiling: 90 }, { kind: 'repair' }, { delivered: 6 }, { threadIds: ids }])).rows[0].r
    ok('the check starts atomically with exactly the linked concepts', start.ok === true && start.questions === 6)
    ok('starting again resumes the same paper', (await c.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5) as r', [uid, `task-${uid}-c`, [], manifest, {}, {}, {}, {}, {}])).rows[0].r.resumed === true)
    const odd = (await q("select id from public.assessment_items where concept_id is not null and concept_id <> all($1) and review_status = 'reviewed' limit 1", [cs.map(k => k.concept_id)]))[0]
    if (odd) { let rejected = false; try { await c.query('SAVEPOINT s2'); await c.query("update public.plan_blocks set attempt_id=null where id=$1", [`task-${uid}-c`]); await c.query("update public.assessment_attempts set status='abandoned' where user_id=$1", [uid]); await c.query('select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,5)', [uid, `task-${uid}-c`, [...byConcept.flatMap(x => x.slice(1)).slice(0, 4), odd.id], manifest, {}, {}, {}, {}, {}]) } catch (e) { rejected = /outside the repairs/.test(e.message) } await c.query('ROLLBACK TO s2'); ok('a question from an unrelated concept is refused on the real schema', rejected) }

    await c.query('delete from auth.users where id=$1', [uid])
    ok('deleting the account removes every repair row without error', Number(await one('select (select count(*) from public.repair_threads where user_id=$1)+(select count(*) from public.plan_blocks where user_id=$1)+(select count(*) from public.coach_proposals where user_id=$1)+(select count(*) from public.repair_check_threads where user_id=$1)', [uid])) === 0)
    console.log(`\n${n} real-schema checks passed. Rolling back: nothing persists.`)
  } finally {
    try { await c.query('ROLLBACK') } catch {}
    const left = await c.query("select to_regclass('public.repair_check_threads') as t").then(r => r.rows[0].t).catch(() => 'unknown')
    console.log(deployed ? (left ? 'Confirmed: migration still present, rehearsal rows rolled back.' : 'WARNING: unexpected state.') : (left === null ? 'Confirmed: the database is unchanged.' : `WARNING: could not confirm rollback (${left}).`))
    await c.end().catch(() => {})
  }
}
main().catch(e => { console.error(`Rehearsal failed: ${e.message}`); process.exitCode = 1 })
