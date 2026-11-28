/** Phase 5 proof, TWO CONNECTIONS, real development schema: a scope mutation and a paper reservation share one lock, so a confirmation
 *  (or block completion) cannot slip in between the source comparison and the paper being written.
 *  Uses a TEST-ONLY approved fixture bank and throwaway students; every row is removed by recorded id.
 *  npm run scope:race:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { Client } = require('pg')
const { openStage } = require('./lib/stage.cjs')

async function main(args = process.argv.slice(2)) {
  const stage = await openStage(args), cfg = stage.cfg; global.__stage = stage
  setTimeout(() => { console.error('Stopped: deadline reached (fixtures may remain; run fixture destroy by the recorded file).'); process.exit(2) }, 280000).unref()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'race-fixture-')), 'bank.json')
  await stage.create(file, ['--readings=r028', '--per-outcome=9', '--variants=0'])
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Bounded by construction: a lock wait, a statement or an abandoned transaction can never outlive the test (the server ends it).
  const open = []
  const mk = () => { const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000, options: '-c lock_timeout=25s -c statement_timeout=50s -c idle_in_transaction_session_timeout=45s' }); open.push(c); return c }
  const closeAll = async () => { for (const c of open) { try { await c.query('ROLLBACK') } catch {} try { await c.end() } catch {} } }
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { closeAll().finally(() => process.exit(130)) })
  const a = mk(); await a.connect(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const tag = Date.now().toString(36), users = [], cycles = [], blocks = []
  const record = path.join(path.dirname(file), 'students.json')   // recorded as created, so an interrupted run can be cleaned by id
  const save = () => fs.writeFileSync(record, JSON.stringify({ users, cycles, blocks }))
  const man = await one(a, 'select id from public.curriculum_manifests where is_active limit 1')
  const items = (await a.query('select id from public.assessment_items where id = any($1) order by id', [bank.items])).rows.map(r => r.id)
  const outs = (await a.query("select id from public.reading_los where reading_id='r028' order by id limit 4")).rows.map(r => r.id)
  const student = async () => {
    const id = await one(a, 'select gen_random_uuid()'); users.push(id)
    await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `sr-${tag}-${users.length}@example.invalid`]); await a.query('insert into public.profiles (id) values ($1) on conflict do nothing', [id])
    const cyc = await one(a, 'select gen_random_uuid()'); cycles.push(cyc)
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, id])
    const b = `sr-${tag}-${users.length}`; blocks.push(b)
    await a.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment)
      values ($1,$2,$3,'Study','d','study','planner','core','day_preferred','not_started',current_date,current_date::text,30,'30','algorithm',false)`, [b, id, cyc])
    save(); return { id, cyc, block: b }
  }
  const source = (c, u) => one(c, 'select public.paper_scope_source($1)', [u])
  const reserve = async (c, u, key, src, ids = items.slice(0, 6)) => (await c.query('select public.start_assessment_paper($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) as r', [
    u.id, 'weekly', key, u.cyc, 'diagnostic', 'weekly_cumulative', man, ids, 5, '{}', '{}', '{}', '{}', JSON.stringify({ targets: [], tag }), 'race', 'rev', null, null, false, src])).rows[0].r
  const footprint = async u => JSON.stringify(await Promise.all([
    "select count(*) from public.assessment_attempts where user_id=$1",
    "select count(*) from public.form_items fi join public.assessment_attempts t on t.form_id=fi.form_id where t.user_id=$1",
    "select count(*) from public.paper_scope_snapshots where user_id=$1",
    "select count(*) from public.assessment_blueprints b join public.assessment_forms f on f.blueprint_id=b.id join public.assessment_attempts t on t.form_id=f.id where t.user_id=$1"].map(s => one(a, s, [u.id]))))
  const confirm = (c, u, outcome) => c.query('insert into public.block_scope_confirmations (user_id, block_id, outcome_id) values ($1,$2,$3)', [u.id, u.block, outcome])
  const waitsOn = async promise => { let settled = false; promise.then(() => { settled = true }, () => { settled = true }); await sleep(1800); return !settled }
  const auth = async (c, id) => {
    await c.query('set local role authenticated')
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
  }
  const classReport = async u => {
    const sid = await one(a, "insert into public.class_sessions (user_id,cycle_id,class_date,kind,version,idempotency_key) values ($1,$2,current_date,'covered',1,$3) returning id", [u.id, u.cyc, `race-class-log-${tag}`])
    await a.query("insert into public.class_session_items (session_id,outcome_id,extent,studied_in_class,planned_minutes) values ($1,$2,'full',false,0)", [sid, outs[0]])
    return sid
  }
  const correctClass = async (c, u, sid, version, extent) => {
    await auth(c, u.id)
    return one(c, 'select public.apply_class_log_update(null,$1,$2,$3,false,$4,\'[]\') as r',
      [sid, `race-class-${tag}-${version}`, version, JSON.stringify([{ outcome_id: outs[0], extent, studied_in_class: false, planned_minutes: 0 }])])
  }
  const frozenPaper = async u => one(a, `select md5(jsonb_build_object(
    'scope', (select jsonb_agg(to_jsonb(s) order by s.attempt_id) from public.paper_scope_snapshots s where s.user_id = $1),
    'forms', (select jsonb_agg(to_jsonb(f) order by f.id) from public.assessment_forms f join public.assessment_attempts t on t.form_id=f.id where t.user_id=$1),
    'items', (select jsonb_agg(to_jsonb(i) order by to_jsonb(i)::text) from public.form_items i join public.assessment_attempts t on t.form_id=i.form_id where t.user_id=$1),
    'attempts', (select jsonb_agg(to_jsonb(t) order by t.id) from public.assessment_attempts t where t.user_id=$1))::text)`, [u.id])

  let x = null, x2 = null, y = null
  try {
    console.log('\nA confirmation lands at the old race point (between the source read and the paper being written)')
    const s1 = await student(); x = mk(); y = mk(); await x.connect(); await y.connect()
    const s0 = await source(a, s1.id)
    const before = await footprint(s1)
    await x.query('BEGIN'); await confirm(x, s1, outs[0])                       // confirmation in flight, uncommitted
    const pa = reserve(y, s1, `race-a-${tag}`, s0)
    ok('the reservation WAITS for the in-flight confirmation instead of racing past it', await waitsOn(pa))
    await x.query('COMMIT')
    const ra = await pa
    ok('once it commits, the reservation sees the changed scope and refuses SCOPE_CHANGED', ra.ok === false && ra.code === 'SCOPE_CHANGED', JSON.stringify(ra))
    ok('the refused reservation left no attempt, form item, blueprint or snapshot', (await footprint(s1)) === before)

    console.log('\nA reservation is in flight when a confirmation arrives')
    const s2src = await source(a, s1.id)
    await y.query('BEGIN'); const rb = await reserve(y, s1, `race-b-${tag}`, s2src)
    ok('the reservation (current source) succeeds inside its transaction', rb.ok === true && rb.resumed === false, JSON.stringify(rb))
    await x.query('BEGIN'); const pc = confirm(x, s1, outs[1])
    ok('a new confirmation WAITS until the reservation has committed', await waitsOn(pc))
    await y.query('COMMIT'); await pc; await x.query('COMMIT')
    const afterB = await one(a, "select count(*) from public.assessment_attempts where user_id=$1 and open_key=$2", [s1.id, `race-b-${tag}`])
    ok('the paper is whole and reflects the scope as it was when the student reviewed it (6 pinned questions)', Number(afterB) === 1 && Number(await one(a, 'select count(*) from public.form_items fi join public.assessment_attempts t on t.form_id=fi.form_id where t.open_key=$1', [`race-b-${tag}`])) === 6)
    const rb2 = await reserve(a, s1, `race-b2-${tag}`, s2src, items.slice(10, 16))
    ok('a later reservation from the OLD source now refuses (the confirmation counts)', rb2.code === 'SCOPE_CHANGED')
    const fresh = await reserve(a, s1, `race-b3-${tag}`, await source(a, s1.id), items.slice(10, 16))
    ok('and succeeds from the current source', fresh.ok === true)

    console.log('\nA block is completed at the race point')
    const s3 = await student(), srcC = await source(a, s3.id), beforeC = await footprint(s3)
    await x.query('BEGIN'); await x.query("update public.plan_blocks set execution='completed' where id=$1", [s3.block])
    const pd = reserve(y, s3, `race-c-${tag}`, srcC)
    ok('the reservation waits for the block update', await waitsOn(pd))
    await x.query('COMMIT'); const rc = await pd
    ok('and refuses, leaving nothing behind', rc.code === 'SCOPE_CHANGED' && (await footprint(s3)) === beforeC)

    console.log('\nIsolation and liveness')
    const s4 = await student(), s5 = await student()
    await x.query('BEGIN'); await confirm(x, s5, outs[0])                         // another student's in-flight confirmation
    const t0 = Date.now(); const rd = await reserve(y, s4, `race-d-${tag}`, await source(a, s4.id), items.slice(20, 26))
    ok('another student\'s in-flight confirmation never delays this reservation', rd.ok === true && Date.now() - t0 < 5000)
    await x.query('COMMIT')
    const s6 = await student(); x2 = mk(); await x2.connect()
    await x.query('BEGIN'); await x2.query('BEGIN')
    await confirm(x, s6, outs[2])                                   // x holds the student's scope lock until it commits
    const p2 = confirm(x2, s6, outs[3]).then(() => 'ok', e => e.message)
    ok('a second writer for the same student queues behind the first (one lock, no deadlock)', await waitsOn(p2))
    await x.query('COMMIT'); const r2 = await p2; await x2.query('COMMIT')
    ok('and then proceeds', r2 === 'ok', String(r2))
    ok('two concurrent confirmations for one student both commit without deadlock', Number(await one(a, 'select count(*) from public.block_scope_confirmations where user_id=$1', [s6.id])) === 2)
    ok('a reservation with no source (practice, baseline) takes no scope lock and is unaffected', (await reserve(a, s6, `race-e-${tag}`, null, items.slice(30, 36))).ok === true)

    console.log('\nA correction with zero tasks races reservation and weekly review')
    const study = await student(), sid = await classReport(study)
    await a.query("update public.profiles set onboarding_status='complete' where id=$1", [study.id])
    const oldScope = await source(a, study.id), beforeClass = await footprint(study)
    const weekly = (await a.query(`insert into public.weekly_transition_drafts
      (user_id, cycle_id, source_version, closure_kind, no_paper_reason, choices, proposal, expires_at)
      values ($1,$2,public.weekly_source_version($1,$2),'no_paper','Test cohort','{}',
        jsonb_build_object('next',jsonb_build_object('starts_at_local',current_date+9,'ends_at_local',current_date+15,'timezone','UTC','rows','[]'::jsonb),'actions','[]'::jsonb),
        now()+interval '1 hour') returning id`, [study.id, study.cyc])).rows[0].id
    await x.query('begin')
    const corrected = await correctClass(x, study, sid, 1, 'part')
    ok('the real correction command creates no tasks', corrected.tasks === 0)
    const pendingPaper = reserve(y, study, `race-class-first-${tag}`, oldScope)
    await x2.query('begin')
    await auth(x2, study.id)
    const pendingWeek = one(x2, 'select public.accept_weekly_transition($1) as r', [weekly])
    ok('reservation and weekly accept both wait behind the class correction', await waitsOn(Promise.race([pendingPaper, pendingWeek])))
    await x.query('commit')
    const paperAfter = await pendingPaper
    const weekAfter = await pendingWeek
    await x2.query('commit')
    ok('a correction-winning race refuses the stale paper with no reservation footprint', paperAfter.code === 'SCOPE_CHANGED' && beforeClass === await footprint(study))
    ok('the stale weekly draft cannot close the cycle or write another task', weekAfter.code === 'STALE_PROPOSAL'
      && Number(await one(a, 'select count(*) from public.planning_cycles where user_id=$1', [study.id])) === 1
      && Number(await one(a, 'select count(*) from public.plan_blocks where user_id=$1', [study.id])) === 1)

    const refreshed = await source(a, study.id), key = `race-paper-first-${tag}`
    await y.query('begin')
    const paper = await reserve(y, study, key, refreshed)
    ok('an up-to-date paper reserves first', paper.ok === true)
    const snapshot = await frozenPaper(study) // the snapshot is invisible until the commit
    await x.query('begin')
    const pendingCorrection = correctClass(x, study, sid, 2, 'full')
    ok('the next correction waits for that reservation', await waitsOn(pendingCorrection))
    await y.query('commit')
    const frozen = await frozenPaper(study)
    await pendingCorrection
    await x.query('commit')
    ok('the scope snapshot, frozen form, timing and score policy stay intact after correction', frozen !== snapshot && frozen === await frozenPaper(study))
    const resumed = await reserve(a, study, key, refreshed)
    ok('resuming after correction returns the original reservation', resumed.ok === true && resumed.resumed === true && resumed.attemptId === paper.attemptId)
    await x.end(); await x2.end(); await y.end(); x = x2 = y = null
    console.log(`\n${n} checks passed`)
  } finally {
    for (const c of [x, x2, y]) { if (c) { try { await c.query('ROLLBACK') } catch {} } }   // the in-flight connections first, so cleanup is never blocked by their locks
    const run = async (sql, p) => { try { await a.query(sql, p) } catch (e) { console.error('cleanup:', e.message) } }
    try { await stage.destroy(file) } catch (e) { console.error('fixture destroy failed; rerun by recorded file', file) }
    await run('delete from public.block_scope_confirmations where user_id = any($1)', [users]); await run('delete from public.plan_blocks where id = any($1)', [blocks])
    await run('delete from public.planning_cycles where id = any($1)', [cycles]); await run('delete from public.profiles where id = any($1)', [users]); await run('delete from auth.users where id = any($1)', [users])
    console.log(JSON.stringify({ studentsLeft: Number(await one(a, 'select count(*) from auth.users where id = any($1)', [users])) })); await a.end()
  }
}
main().then(() => global.__stage?.stop()).catch(async e => { console.error('FAILED:', e.message); await global.__stage?.stop(); process.exit(1) })
