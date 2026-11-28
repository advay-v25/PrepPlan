/** Planned logging and paper reservation against a fresh local install. No hosted credentials or content. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const pg = require('./beta/local-pg.cjs')
const { installFresh } = require('./beta/install.cjs')
const { configuration } = require('./lib/migrations.cjs')
const { create: createBank } = require('./fixture-bank.cjs')

async function main() {
  const dir = pg.tmp()
  const cluster = path.join(dir, 'pg')
  const port = 54347
  const database = 'phase1_frozen_paper'
  const db = new Client({ host: '127.0.0.1', port, user: 'postgres', database })
  const value = async (sql, args) => (await db.query(sql, args)).rows[0]?.value
  const as = async (role, student, sql, args) => {
    await db.query('begin')
    try {
      await db.query(role === 'authenticated' ? 'set local role authenticated' : 'set local role service_role')
      if (student) await db.query("select set_config('request.jwt.claim.sub', $1, true)", [student])
      const result = await value(sql, args)
      await db.query('commit')
      return result
    } catch (error) {
      await db.query('rollback')
      throw error
    }
  }
  let started = false
  try {
    pg.start(cluster, port)
    started = true
    pg.run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', database])
    await db.connect()
    await db.query(fs.readFileSync(path.join(__dirname, '../supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    const cfg = configuration(['--env=local', '--apply', `--confirm-target=local:${database}`], {
      MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${port}/${database}`,
      MIGRATION_EXPECTED_DATABASE: database,
    })
    const install = await installFresh(db, cfg)
    assert.equal(install.pendingAfter, 0)
    const file = path.join(dir, 'bank.json')
    await createBank([`--out=${file}`, '--readings=r028', '--per-outcome=5'], async () => {
      const client = new Client(cfg.connection)
      await client.connect()
      return client
    })
    const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
    assert.ok(bank.approvals > 5)
    assert.equal(bank.approvals, bank.items.length)

    const student = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'frozen@example.invalid',now()) returning id as value")
    await db.query("insert into public.profiles(id,onboarding_status) values($1,'complete') on conflict (id) do update set onboarding_status='complete'", [student])
    const cycle = await value(`insert into public.planning_cycles(user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone)
      values($1,current_date,current_date+6,current_date,current_date+6,'UTC') returning id as value`, [student])
    const targets = (await db.query('select id from public.reading_los where reading_id=$1 order by id limit 2', ['r028'])).rows.map(row => row.id)
    const manifest = await value('select id as value from public.curriculum_manifests where is_active')
    const approved = (await db.query('select distinct on (family_id) id, outcome_id, key_index from public.student_eligible_items where id=any($1) and outcome_id=any($2) order by family_id, id', [bank.items, targets])).rows
    const originalItems = approved.filter(row => row.outcome_id === targets[0])
    assert.equal(originalItems.length, 5)
    for (const id of ['first-study', 'second-study']) {
      await db.query(`insert into public.plan_blocks (id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id)
        values ($1,$2,$3,current_date::text,current_date,'Study a reading','45 min',45,'Local test','study','day_preferred','r028')`, [id, student, cycle])
    }
    const log = async (id, minutes, target) => {
      const receipt = await as('authenticated', student, "select public.log_planned_session($1,$2,1,'partial',$3,$4,null,$2) as value", [student, id, minutes, [target]])
      assert.equal(receipt.ok, true)
      assert.equal(receipt.minutes, minutes)
      assert.deepEqual(receipt.scope, { state: 'confirmed', confirmed: 1 })
    }
    const source = () => value('select public.paper_scope_source($1) as value', [student])
    const selection = (key, scopeSource, outcomes, items) => ({
      kind: 'weekly', openKey: key, cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative', manifest, itemIds: items.map(row => row.id), min: 5,
      requestedScope: { outcomes }, constraints: {}, requested: {}, coverage: {}, scope: { outcomes },
      scopeLabel: 'weekly', scopeRevision: scopeSource, scopeSource, linkWeekly: false,
    })
    const reserve = paper => as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [student, JSON.stringify(paper)])
    const snapshot = id => value(`select jsonb_build_object('form',a.form_id,'policy',f.scoring_policy,'scope',s.scope,'revision',s.revision,
      'items',(select jsonb_agg(to_jsonb(i) order by i.sequence_number) from public.form_items i where i.form_id=f.id)) as value
      from public.assessment_attempts a join public.assessment_forms f on f.id=a.form_id
      join public.paper_scope_snapshots s on s.attempt_id=a.id where a.id=$1`, [id])
    const paperCounts = () => value(`select jsonb_build_array((select count(*) from public.assessment_attempts),
      (select count(*) from public.assessment_forms),(select count(*) from public.paper_scope_snapshots)) as value`)

    await log('first-study', 25, targets[0])
    const earlier = await source()
    const original = selection('original-paper', earlier, [targets[0]], originalItems)
    const attempt = await reserve(original)
    assert.equal(attempt.ok, true, JSON.stringify(attempt))
    const frozen = await snapshot(attempt.attemptId)
    assert.equal(frozen.policy, 'paper-score.1')
    assert.deepEqual(frozen.scope, { outcomes: [targets[0]] })
    assert.deepEqual(frozen.items.map(item => [item.item_id, item.item_version]), originalItems.map(item => [item.id, 1]))
    assert.equal(await source(), earlier)
    console.log('PASS reserved form pins approved item versions, order, scope and score policy')

    await log('second-study', 20, targets[1])
    const current = await source()
    assert.notEqual(current, earlier)
    assert.deepEqual(await value('select array_agg(outcome_id order by outcome_id) as value from public.block_scope_confirmations where user_id=$1', [student]), targets)
    assert.equal(await value('select count(*)::int as value from public.evidence_events where user_id=$1', [student]), 0)
    const beforeRefusal = await paperCounts()
    const stale = await reserve({ ...original, openKey: 'unreserved-stale-paper' })
    assert.equal(stale.code, 'SCOPE_CHANGED')
    assert.deepEqual(await paperCounts(), beforeRefusal)
    console.log('PASS new logging changes current scope, creates no evidence and refuses an unreserved stale preview')

    const resume = await reserve(original)
    assert.equal(resume.resumed, true)
    assert.equal(resume.attemptId, attempt.attemptId)
    assert.deepEqual(await snapshot(attempt.attemptId), frozen)
    assert.deepEqual(await paperCounts(), beforeRefusal)
    console.log('PASS the original reservation resumes with an identical frozen form after a new log')

    const item = originalItems[0]
    await as('service_role', null, 'select public.record_item_progress($1,$2,$3,0,0,true,null) as value', [attempt.attemptId, student, item.id])
    const answer = await as('authenticated', student, 'select public.save_attempt_answer($1,$2,$3,5,0,0,false,1) as value', [attempt.attemptId, item.id, item.key_index])
    assert.equal(answer.ok, true, JSON.stringify(answer))
    const result = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','phase1-test') as value", [attempt.attemptId])
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(await value('select jsonb_build_array(delivered_count, valid_response_count, scoring_policy_version, score) as value from public.assessment_attempts where id=$1', [attempt.attemptId]), [5, 1, 'paper-score.1', 20])
    assert.deepEqual(await value('select array_agg(item_id) as value from public.evidence_events where attempt_id=$1', [attempt.attemptId]), [item.id])
    assert.deepEqual(await snapshot(attempt.attemptId), frozen)
    console.log('PASS scoring uses the original five delivered questions and records evidence for the one answered item')

    const next = await reserve(selection('new-scope-paper', await source(), targets, approved.filter(row => row.outcome_id === targets[1])))
    assert.equal(next.ok, true, JSON.stringify(next))
    assert.notEqual(next.attemptId, attempt.attemptId)
    assert.deepEqual((await snapshot(next.attemptId)).scope, { outcomes: targets })
    console.log('PASS a new reservation can use the updated scope and items for the newly confirmed outcome')
  } finally {
    await db.end()
    if (started) pg.stop(cluster)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
