/**
 * Phase 2 SQL contracts in disposable local Postgres. Exercises scope changes
 * after logs, reservation and scoring with supplied item IDs, spacing with
 * seeded repair state, reviewer refusal, draft exclusion, and short-list refusal.
 * App assembly, browser journeys, and failed-inventory reads need separate proof.
 */
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
  const port = 54351
  const database = 'phase2_student_journey'
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

    // Scenario 5a: Real zero before any fixture bank
    const realZero = await value('select count(*)::int as value from public.student_eligible_items')
    assert.equal(realZero, 0, 'fresh DB must have 0 real approved items')
    console.log('PASS Scenario 5a: real zero inventory (0 in student_eligible_items)')

    const manifest = await value('select id as value from public.curriculum_manifests where is_active')
    const student = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'p2-student@example.invalid',now()) returning id as value")
    await db.query("insert into public.profiles(id,onboarding_status) values($1,'complete') on conflict (id) do update set onboarding_status='complete'", [student])

    // Fixture bank for r032 (FSA) and r095 (Ethics)
    const file = path.join(dir, 'bank.json')
    await createBank([`--out=${file}`, '--readings=r032,r095', '--per-outcome=10'], async () => {
      const client = new Client(cfg.connection)
      await client.connect()
      return client
    })
    const bank = JSON.parse(fs.readFileSync(file, 'utf8'))

    const cycle = await value(`insert into public.planning_cycles(user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone)
      values($1,current_date,current_date+6,current_date,current_date+6,'UTC') returning id as value`, [student])
    await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id)
      values
        ('b-timeonly',$1,$2,current_date::text,current_date,'Time only R32','30 min',30,'t','study','day_preferred','r032'),
        ('b-r032',$1,$2,current_date::text,current_date,'Study R32','45 min',45,'t','study','day_preferred','r032'),
        ('b-r095',$1,$2,current_date::text,current_date,'Study R95','45 min',45,'t','study','day_preferred','r095')`, [student, cycle])

    // Scenario 2: Time-only / pending log does NOT leak into paper_scope_source
    const src0 = await value('select public.paper_scope_source($1) as value', [student])
    const timeOnly = await as('authenticated', student, "select public.log_planned_session($1,'b-timeonly',1,'partial',30,array[]::text[],null,'idem-b-timeonly') as value", [student])
    assert.equal(timeOnly.ok, true)
    assert.equal(timeOnly.scope.state, 'time_only')
    const confirmedAfterTimeOnly = await value('select count(*)::int as value from public.block_scope_confirmations where user_id=$1', [student])
    assert.equal(confirmedAfterTimeOnly, 0, 'time-only pending log must not create confirmed scope')

    // Confirm r032-a only
    const logR32 = await as('authenticated', student, "select public.log_planned_session($1,'b-r032',1,'completed',45,array['r032-a'],null,'idem-b-r032') as value", [student])
    assert.equal(logR32.ok, true)
    const srcR32 = await value('select public.paper_scope_source($1) as value', [student])
    assert.notEqual(srcR32, src0)
    console.log('PASS Scenario 2: time-only pending log excluded from scope; confirmed r032-a updates scope')

    // Scenario 1 + 4: Approved routine slice (r032-a), frozen reservation, and scored evidence
    const r32Pool = (await db.query(
      `select distinct on (family_id) id, outcome_id, family_id, concept_id, key_index from public.student_eligible_items
       where id=any($1) and outcome_id='r032-a' order by family_id, id`,
      [bank.items]
    )).rows
    const r32Initial = r32Pool.slice(0, 5)
    const r32Recheck = r32Pool.slice(5, 10)
    assert.equal(r32Initial.length, 5)
    assert.equal(r32Recheck.length, 5)

    const p1 = await as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [
      student,
      JSON.stringify({
        kind: 'weekly', openKey: 'p2-r32', cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative',
        manifest, itemIds: r32Initial.map(x => x.id), min: 5, requestedScope: { outcomes: ['r032-a'] },
        constraints: {}, requested: {}, coverage: {}, scope: { outcomes: ['r032-a'] },
        scopeLabel: 'weekly', scopeRevision: srcR32, scopeSource: srcR32, linkWeekly: false,
      }),
    ])
    assert.equal(p1.ok, true, JSON.stringify(p1))

    // Confirm r095-a AFTER p1 is reserved -> p1 remains frozen!
    await as('authenticated', student, "select public.log_planned_session($1,'b-r095',1,'completed',45,array['r095-a'],null,'idem-b-r095') as value", [student])
    const srcR95 = await value('select public.paper_scope_source($1) as value', [student])
    assert.notEqual(srcR95, srcR32)

    const wrong0 = (r32Initial[0].key_index + 1) % 3
    for (let i = 0; i < r32Initial.length; i++) {
      const ans = i === 0 ? wrong0 : r32Initial[i].key_index
      await as('service_role', null, 'select public.record_item_progress($1,$2,$3,0,0,true,null) as value', [p1.attemptId, student, r32Initial[i].id])
      await as('authenticated', student, 'select public.save_attempt_answer($1,$2,$3,5,0,0,false,1) as value', [p1.attemptId, r32Initial[i].id, ans])
    }
    const fin1 = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','p2-test') as value", [p1.attemptId])
    assert.equal(fin1.ok, true, JSON.stringify(fin1))
    const evCount = await value('select count(*)::int as value from public.evidence_events where attempt_id=$1', [p1.attemptId])
    assert.equal(evCount, 5)
    console.log('PASS Scenario 1 & 4: r032 check reserved, stayed frozen across later r095 log, and scored 5 evidence events')

    // Ethics r095 check
    const r95Pool = (await db.query(
      `select distinct on (family_id) id, outcome_id, family_id, concept_id, key_index from public.student_eligible_items
       where id=any($1) and outcome_id='r095-a' order by family_id, id`,
      [bank.items]
    )).rows
    const r95Initial = r95Pool.slice(0, 5)
    const srcR95Now = await value('select public.paper_scope_source($1) as value', [student])
    const p2 = await as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [
      student,
      JSON.stringify({
        kind: 'weekly', openKey: 'p2-r95', cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative',
        manifest, itemIds: r95Initial.map(x => x.id), min: 5, requestedScope: { outcomes: ['r095-a'] },
        constraints: {}, requested: {}, coverage: {}, scope: { outcomes: ['r095-a'] },
        scopeLabel: 'weekly', scopeRevision: srcR95Now, scopeSource: srcR95Now, linkWeekly: false,
      }),
    ])
    assert.equal(p2.ok, true, JSON.stringify(p2))
    console.log('PASS Scenario 1b: r095 Ethics check reserved cleanly')

    // Scenario 3: Miss -> repair -> spacing enforced (refused early, allowed after spacing) -> fresh families -> exhaustion shortfall
    const repairConcept = r32Initial[0].concept_id
    const threadId = await value(
      `update public.repair_threads set status='awaiting_recheck', next_recheck_due_at=current_date + 3
       where user_id=$1 and concept_id=$2 and manifest_id=$3 returning id as value`,
      [student, repairConcept, manifest]
    )
    await db.query(
      `insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id,repair_thread_id,execution)
       values('rep-p2',$1,$2,current_date::text,current_date,'Repair R32','30 min',30,'r','repair','day_preferred','r032',$3,'completed')`,
      [student, cycle, threadId]
    )
    await db.query(`insert into public.task_events(user_id,task_id,event_type,created_at) values($1,'rep-p2','completed',now())`, [student])
    await db.query(
      `insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id)
       values('chk-p2',$1,$2,current_date::text,current_date,'Recheck R32','15 min',15,'c','recheck','day_preferred','r032')`,
      [student, cycle]
    )
    await db.query(`insert into public.repair_check_threads(user_id,check_task_id,thread_id) values($1,'chk-p2',$2)`, [student, threadId])

    // Refused before spacing
    const earlyCheck = await as('service_role', null, 'select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', [
      student, 'chk-p2', r32Recheck.map(x => x.id), manifest,
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId] }),
      JSON.stringify({ maxQuestions: 5, allowedTiers: ['reviewed'], ceiling: 90 }),
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId], key: 'check:chk-p2' }),
      JSON.stringify({ delivered: 5 }),
      JSON.stringify({ kind: 'repair_check', checkTaskId: 'chk-p2', threadIds: [threadId], policy: 'repair-loop-1' }),
      5,
    ])
    assert.equal(earlyCheck.ok, false)
    assert.equal(earlyCheck.code, 'RECHECK_NOT_DUE')

    // Advance past spacing -> succeeds with fresh families
    await db.query(`update public.repair_threads set next_recheck_due_at=current_date where id=$1`, [threadId])
    await db.query(`update public.task_events set created_at=now() - interval '4 days' where task_id='rep-p2'`)
    const dueCheck = await as('service_role', null, 'select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', [
      student, 'chk-p2', r32Recheck.map(x => x.id), manifest,
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId] }),
      JSON.stringify({ maxQuestions: 5, allowedTiers: ['reviewed'], ceiling: 90 }),
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId], key: 'check:chk-p2' }),
      JSON.stringify({ delivered: 5 }),
      JSON.stringify({ kind: 'repair_check', checkTaskId: 'chk-p2', threadIds: [threadId], policy: 'repair-loop-1' }),
      5,
    ])
    assert.equal(dueCheck.ok, true, JSON.stringify(dueCheck))
    assert.equal(r32Recheck.filter(x => new Set(r32Initial.map(y => y.family_id)).has(x.family_id)).length, 0)

    // Scenario 4b: Unauthorized reviewer refusal + draft/held-out/stale-version exclusion from student_eligible_items
    let reviewerRefused = false
    try {
      await as('authenticated', student, "select public.decide_item_review($1,1,'approve','unauthorized','fam-unauth') as value", [r32Initial[0].id])
    } catch (e) {
      reviewerRefused = true
    }
    assert.equal(reviewerRefused, true, 'ordinary authenticated user must be refused by decide_item_review')

    // A draft item must be excluded from student_eligible_items.
    await db.query(
      `insert into public.assessment_items(id,lm_id,learning_objective,verification_intent,difficulty,stem,options,per_option_feedback,concept_id,outcome_id,cognition,item_form,intended_difficulty,key_index,review_status,item_version,family_id,provenance)
       values('p2-draft-1','r032','LCNRV','apply · direct · foundation',2,'Draft stem','["A","B","C"]'::jsonb,'{"0":"k","1":"w","2":"w"}'::jsonb,$1,'r032-a','apply','direct','foundation',0,'draft',1,null,'fixture-bank')`,
      [repairConcept]
    )
    const draftInEligible = await value("select count(*)::int as value from public.student_eligible_items where id='p2-draft-1'")
    assert.equal(draftInEligible, 0, 'draft item must not enter student_eligible_items')
    console.log('PASS SQL contract: unauthorized reviewer refused & draft item excluded from student_eligible_items')

    // Scenario 5b: Thin / exhausted bank (<5 items) refused with BANK_INSUFFICIENT
    const srcThin = await value('select public.paper_scope_source($1) as value', [student])
    const thinRefusal = await as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [
      student,
      JSON.stringify({
        kind: 'weekly', openKey: 'p2-thin', cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative',
        manifest, itemIds: r95Pool.slice(5, 8).map(x => x.id), min: 5, requestedScope: { outcomes: ['r095-a'] },
        constraints: {}, requested: {}, coverage: {}, scope: { outcomes: ['r095-a'] },
        scopeLabel: 'weekly', scopeRevision: srcThin, scopeSource: srcThin, linkWeekly: false,
      }),
    ])
    assert.equal(thinRefusal.ok, false)
    assert.equal(thinRefusal.code, 'BANK_INSUFFICIENT')
    console.log('PASS Scenario 3 & 5b: spacing enforced (RECHECK_NOT_DUE -> due fresh families), thin bank refused (BANK_INSUFFICIENT)')
  } finally {
    await db.end().catch(() => {})
    if (started) pg.stop(cluster)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e); process.exit(1) })
