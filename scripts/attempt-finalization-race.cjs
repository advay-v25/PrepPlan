/** Proves, on the REAL development schema with two real connections, that finalisation and answer-saving cannot interleave:
 *  once an attempt is scored no answer is accepted and the stored responses do not change, whichever side gets the lock first.
 *  Uses COMMITTED owned fixtures (a race needs them) and deletes every row it created.
 *  npm run attempt:race -- --confirm-target=<project-ref> */
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: deadline reached (fixtures may remain; re-run to clean).'); process.exit(2) }, 150000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const [a, b, m] = [mk(), mk(), mk()]; await a.connect(); await b.connect(); await m.connect(); let n = 0
  const ok = (name, v) => { assert.ok(v, name); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const ids = {}
  const cleanup = async () => {
    for (const [sql, p] of [['delete from public.evidence_events where user_id=$1', [ids.uid]], ['delete from public.repair_threads where user_id=$1', [ids.uid]], ['delete from public.assessment_responses where attempt_id = any($1)', [ids.attempts ?? []]], ['delete from public.assessment_attempts where id = any($1)', [ids.attempts ?? []]],
      ['delete from public.form_items where form_id = any($1)', [ids.forms ?? []]], ['delete from public.assessment_forms where id = any($1)', [ids.forms ?? []]], ['delete from public.assessment_blueprints where id = any($1)', [ids.bps ?? []]],
      ['delete from auth.users where id=$1', [ids.uid]]]) { if (!p[0] || (Array.isArray(p[0]) && !p[0].length)) continue; await a.query(sql, p).catch(e => console.error('cleanup:', e.message)) }
  }
  // Papers may only use questions approved for their exact version, so the race runs on a test-only approved fixture bank.
  const bankFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'race-bank-')), 'bank.json'), target = `--confirm-target=${cfg.identity}`
  execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'create', target, `--out=${bankFile}`, '--readings=r028', '--per-outcome=2', '--variants=0'], { stdio: 'ignore' })
  const bank = JSON.parse(fs.readFileSync(bankFile, 'utf8'))
  try {
    const cs = (await a.query("select i.concept_id, c.manifest_id from public.student_eligible_items i join public.curriculum_concepts c on c.id=i.concept_id where i.id = any($1) and i.concept_id is not null group by 1,2 having count(*) >= 2 order by 1 limit 1", [bank.items])).rows[0]
    if (!cs) { console.log('  (no concept with 2 usable items: skipped)'); return }
    const items = (await a.query("select id from public.student_eligible_items where concept_id=$1 and id = any($2) order by id limit 2", [cs.concept_id, bank.items])).rows.map(r => r.id)
    ids.uid = await one(a, 'select gen_random_uuid()'); const cyc = await one(a, 'select gen_random_uuid()')
    await a.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [ids.uid, `race+${String(ids.uid).slice(0, 8)}@example.invalid`])
    await a.query("insert into public.profiles (id) values ($1) on conflict (id) do nothing", [ids.uid]); await a.query("update public.profiles set onboarding_status='complete' where id=$1", [ids.uid])
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, ids.uid])
    const mkAttempt = async () => {
      const bp = await one(a, "insert into public.assessment_blueprints (manifest_id,purpose,requested_scope,constraints) values ($1,'weekly_cumulative','{}','{}') returning id", [cs.manifest_id])
      const form = await one(a, "insert into public.assessment_forms (blueprint_id,delivery_mode) values ($1,'fixed') returning id", [bp])
      for (const [i, it] of items.entries()) await a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,$3)', [form, it, i + 1])
      const att = await one(a, "insert into public.assessment_attempts (user_id,form_id,delivery_mode,status,attempt_kind,cycle_id) values ($1,$2,'fixed','in_progress','weekly',$3) returning id", [ids.uid, form, cyc])
      for (const it of items) await a.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,0,false,3)', [att, it, ids.uid])
      ;(ids.bps ??= []).push(bp); (ids.forms ??= []).push(form); (ids.attempts ??= []).push(att); return att
    }
    const begin = async c => { await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [ids.uid, JSON.stringify({ sub: ids.uid, role: 'authenticated' })]) }
    const snap = att => a.query("select item_id, selected_option_index, self_reported_confidence from public.assessment_responses where attempt_id=$1 order by item_id", [att]).then(r => JSON.stringify(r.rows))
    const timing = att => a.query('select item_id, active_seconds, interrupted_seconds, visits, flagged from public.attempt_item_progress where attempt_id=$1 order by item_id', [att]).then(r => JSON.stringify(r.rows))
    // A third, privileged connection watches for the lock wait (the two actors run as the student role and cannot see other sessions).
    const blocked = async () => { for (let i = 0; i < 40; i++) { if (Number(await one(m, "select count(*) from pg_stat_activity where wait_event_type='Lock' and datname=current_database() and (query ilike '%save_attempt_answer%' or query ilike '%finalize_assessment_attempt%')")) > 0) return true; await new Promise(r => setTimeout(r, 100)) } return false }

    // 1. Finalise holds the lock; a concurrent answer must wait, then be refused.
    const att1 = await mkAttempt(), before1 = await snap(att1)
    await begin(a); const fin = await one(a, "select public.finalize_assessment_attempt($1,'1.0','1.0')", [att1]); ok('finalisation succeeds', fin.ok === true)
    await begin(b); await b.query("SET LOCAL lock_timeout='20s'")
    const saving = b.query("select public.save_attempt_answer($1,$2,1,5,5,0,false,1)", [att1, items[0]]).then(() => ({ ok: true }), e => ({ ok: false, msg: e.message }))
    ok('the concurrent answer is held behind the finalising transaction', await blocked())
    await a.query('COMMIT'); const r1 = await saving; await b.query('ROLLBACK')
    ok('and is refused once the attempt is scored', r1.ok === false && /Attempt is scored/.test(r1.msg), r1.msg)
    ok('stored responses are unchanged', before1 === await snap(att1))

    // 2. Answer holds the lock; finalisation waits and scores the committed answer.
    const att2 = await mkAttempt()
    await begin(b); const answer = await one(b, "select public.save_attempt_answer($1,$2,1,5,5,0,false,1)", [att2, items[0]])
    await begin(a); await a.query("SET LOCAL lock_timeout='20s'")
    const finalising = a.query("select public.finalize_assessment_attempt($1,'1.0','1.0') r", [att2]).then(r => r.rows[0].r, e => ({ ok: false, msg: e.message }))
    ok('finalisation waits for the in-flight answer', await blocked())
    await b.query('COMMIT'); const f2 = await finalising; await a.query('COMMIT')
    const rows2 = (await a.query('select item_id, selected_option_index, is_correct from public.assessment_responses where attempt_id=$1', [att2])).rows
    const att2row = (await a.query('select status, score from public.assessment_attempts where id=$1', [att2])).rows[0]
    ok('the attempt is scored once, after the in-flight answer was committed', f2.ok === true && att2row.status === 'scored' && rows2.find(r => r.item_id === items[0]).selected_option_index === 1)
    const timed = await timing(att2)
    ok('answer and its bounded timing were committed in the same transaction', answer.ok && answer.activeSeconds > 0 && answer.activeSeconds <= 5
      && JSON.parse(timed).some(row => row.item_id === items[0] && row.active_seconds === answer.activeSeconds))

    // 3. After scoring, every later answer is refused with no write.
    const before3 = await snap(att2)
    await begin(b); let late
    try { await b.query('SAVEPOINT s'); await b.query("select public.save_attempt_answer($1,$2,2,5,5,0,false,2)", [att2, items[1]]); late = { ok: true } } catch (e) { late = { ok: false, msg: e.message } }
    await b.query('ROLLBACK')
    ok('a later answer is refused', late.ok === false && /Attempt is scored/.test(late.msg), late.msg)
    ok('and writes no answer or timing', before3 === await snap(att2) && timed === await timing(att2))

    const att3 = await mkAttempt()
    await begin(b); await b.query("select public.save_attempt_answer($1,$2,1,5,6,0,false,5)", [att3, items[0]]); await b.query('COMMIT')
    const before4 = await snap(att3), timingBefore = await timing(att3)
    await begin(b)
    const stale = await b.query("select public.save_attempt_answer($1,$2,0,3,8,0,true,4)", [att3, items[0]]).then(() => '', e => e.code)
    await b.query('ROLLBACK')
    ok('a stale answer rolls back timing and flags as well', stale === 'ST409' && before4 === await snap(att3) && timingBefore === await timing(att3))
    console.log(`\n${n} checks passed`)
  } finally {
    await a.query('ROLLBACK').catch(() => {}); await b.query('ROLLBACK').catch(() => {})
    await cleanup()
    try { execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'destroy', target, `--file=${bankFile}`], { stdio: 'inherit' }) } catch (e) { console.error('fixture cleanup failed:', e.message) }
    const left = ids.uid ? Number(await one(a, 'select count(*) from public.assessment_attempts where user_id=$1', [ids.uid]).catch(() => 0)) + Number(await one(a, 'select count(*) from auth.users where id=$1', [ids.uid]).catch(() => 0)) : 0
    console.log(left === 0 ? 'Fixtures removed.' : `WARNING: ${left} fixture rows remain for ${ids.uid}`)
    await a.end().catch(() => {}); await b.end().catch(() => {}); await m.end().catch(() => {})
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
