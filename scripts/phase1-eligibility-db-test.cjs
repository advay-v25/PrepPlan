/**
 * Phase 1 eligibility & spaced fresh-family re-check proof in disposable local Postgres:
 * 1) Proves unapproved pilot items ('verified' / 'draft' without exact-version human approval) never enter `student_eligible_items` or `start_paper_checked`.
 * 2) Drives an ordinary r032 reading check + spaced fresh-family re-check using isolated test-only approved fixtures, recording initial & re-check item/family IDs.
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
  const port = 54349
  const database = 'phase1_eligibility_proof'
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

    const manifest = await value('select id as value from public.curriculum_manifests where is_active')
    const student = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'p1-elig@example.invalid',now()) returning id as value")
    await db.query("insert into public.profiles(id,onboarding_status) values($1,'complete') on conflict (id) do update set onboarding_status='complete'", [student])

    // 1. Insert unapproved pilot items ('verified', unpublished, no item_review_decisions row) -> must NEVER enter student_eligible_items or start_paper_checked
    const unapprovedIds = ['pp-unapproved-1', 'pp-unapproved-2', 'pp-unapproved-3', 'pp-unapproved-4', 'pp-unapproved-5']
    const conceptId = await value('select gen_random_uuid() as value')
    await db.query(
      `insert into public.curriculum_concepts(id,manifest_id,topic,reading,module,los,name,lm_id,verification_status)
       values($1,$2,'FSA','Reading 32','fsa-r032','LOS a','LCNRV test concept','r032','pending')`,
      [conceptId, manifest]
    )
    await db.query(`insert into public.concept_outcome_map(concept_id,outcome_id,approximate) values($1,'r032-a',false)`, [conceptId])
    for (let i = 0; i < unapprovedIds.length; i++) {
      await db.query(
        `insert into public.assessment_items(id,lm_id,learning_objective,verification_intent,difficulty,stem,options,per_option_feedback,concept_id,outcome_id,cognition,item_form,intended_difficulty,key_index,review_status,item_version,family_id,provenance)
         values($1,'r032','LCNRV','apply · direct · foundation',2,$2,'["A","B","C"]'::jsonb,'{"0":"k","1":"w","2":"w"}'::jsonb,$3,'r032-a','apply','direct','foundation',0,'verified',1,null,'prepplan-phase1-pilot')`,
        [unapprovedIds[i], `Unapproved pilot stem ${i}`, conceptId]
      )
    }
    const eligibleUnapproved = await value('select count(*)::int as value from public.student_eligible_items where id=any($1)', [unapprovedIds])
    assert.equal(eligibleUnapproved, 0, 'unapproved pilot items must never appear in student_eligible_items')

    const cycle = await value(`insert into public.planning_cycles(user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone)
      values($1,current_date,current_date+6,current_date,current_date+6,'UTC') returning id as value`, [student])
    await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id)
      values('study-r032',$1,$2,current_date::text,current_date,'Study R32','45 min',45,'Local test','study','day_preferred','r032')`, [student, cycle])
    const logRes = await as('authenticated', student, "select public.log_planned_session($1,'study-r032',1,'completed',45,array['r032-a'],null,'study-r032') as value", [student])
    assert.equal(logRes.ok, true)
    const scopeSrc = await value('select public.paper_scope_source($1) as value', [student])
    const refusedUnapproved = await as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [
      student,
      JSON.stringify({
        kind: 'weekly', openKey: 'unapproved-try', cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative',
        manifest, itemIds: unapprovedIds, min: 5, requestedScope: { outcomes: ['r032-a'] },
        constraints: {}, requested: {}, coverage: {}, scope: { outcomes: ['r032-a'] },
        scopeLabel: 'weekly', scopeRevision: scopeSrc, scopeSource: scopeSrc, linkWeekly: false,
      }),
    ])
    assert.equal(refusedUnapproved.ok, false, 'start_paper_checked must refuse unapproved pilot items')
    console.log('PASS unapproved pilot items excluded from student_eligible_items and refused by start_paper_checked')

    // 2. Approved test-only fixtures sized for both an ordinary reading check and a spaced fresh-family re-check (>=10 families on r032-a)
    const file = path.join(dir, 'bank.json')
    await createBank([`--out=${file}`, '--readings=r032', '--per-outcome=10'], async () => {
      const client = new Client(cfg.connection)
      await client.connect()
      return client
    })
    const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
    const eligible = (await db.query(
      `select distinct on (family_id) id, outcome_id, family_id, concept_id, key_index from public.student_eligible_items
       where id=any($1) and outcome_id='r032-a' order by family_id, id`,
      [bank.items]
    )).rows
    assert.ok(eligible.length >= 10, `expected >=10 approved fixture families for r032-a, got ${eligible.length}`)

    const initialFive = eligible.slice(0, 5)
    const recheckFive = eligible.slice(5, 10)
    const start1 = await as('service_role', null, 'select public.start_paper_checked($1,null,null,$2) as value', [
      student,
      JSON.stringify({
        kind: 'weekly', openKey: 'r032-initial', cycle, paperKind: 'diagnostic', purpose: 'weekly_cumulative',
        manifest, itemIds: initialFive.map(x => x.id), min: 5, requestedScope: { outcomes: ['r032-a'] },
        constraints: {}, requested: {}, coverage: {}, scope: { outcomes: ['r032-a'] },
        scopeLabel: 'weekly', scopeRevision: scopeSrc, scopeSource: scopeSrc, linkWeekly: false,
      }),
    ])
    assert.equal(start1.ok, true, JSON.stringify(start1))

    // Score initial check with wrong answer on item 0 so a repair is justified
    const wrongIdx = (initialFive[0].key_index + 1) % 3
    for (let i = 0; i < initialFive.length; i++) {
      const ans = i === 0 ? wrongIdx : initialFive[i].key_index
      await as('service_role', null, 'select public.record_item_progress($1,$2,$3,0,0,true,null) as value', [start1.attemptId, student, initialFive[i].id])
      const sv = await as('authenticated', student, 'select public.save_attempt_answer($1,$2,$3,5,0,0,false,1) as value', [start1.attemptId, initialFive[i].id, ans])
      assert.equal(sv.ok, true, JSON.stringify(sv))
    }
    const fin1 = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','phase1-elig') as value", [start1.attemptId])
    assert.equal(fin1.ok, true, JSON.stringify(fin1))

    // Create/advance repair thread (created by finalize_assessment_attempt on the miss), completed repair task (dated 4 days ago), and re-check block
    const repairConcept = initialFive[0].concept_id
    const threadId = await value(
      `update public.repair_threads set status='awaiting_recheck', next_recheck_due_at=current_date
       where user_id=$1 and concept_id=$2 and manifest_id=$3 returning id as value`,
      [student, repairConcept, manifest]
    )
    assert.ok(threadId, 'expected repair thread created by finalize_assessment_attempt')
    await db.query(
      `insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id,repair_thread_id,execution)
       values('rep-1',$1,$2,(current_date-4)::text,current_date-4,'Repair LCNRV','30 min',30,'Repair','repair','day_preferred','r032',$3,'completed')`,
      [student, cycle, threadId]
    )
    await db.query(
      `insert into public.task_events(user_id,task_id,event_type,created_at) values($1,'rep-1','completed',now() - interval '4 days')`,
      [student]
    )
    await db.query(
      `insert into public.plan_blocks(id,user_id,cycle_id,day,local_date,title,duration,duration_minutes,detail,task_type,placement,lm_id)
       values('recheck-1',$1,$2,current_date::text,current_date,'Recheck LCNRV','15 min',15,'Recheck','recheck','day_preferred','r032')`,
      [student, cycle]
    )
    await db.query(`insert into public.repair_check_threads(user_id,check_task_id,thread_id) values($1,'recheck-1',$2)`, [student, threadId])

    const recheckStart = await as('service_role', null, 'select public.start_repair_check($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', [
      student,
      'recheck-1',
      recheckFive.map(x => x.id),
      manifest,
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId] }),
      JSON.stringify({ maxQuestions: 5, allowedTiers: ['reviewed'], ceiling: 90 }),
      JSON.stringify({ kind: 'repair', label: 'repair_check', threadIds: [threadId], key: 'check:recheck-1' }),
      JSON.stringify({ delivered: 5 }),
      JSON.stringify({ kind: 'repair_check', checkTaskId: 'recheck-1', threadIds: [threadId], policy: 'repair-loop-1' }),
      5,
    ])
    assert.equal(recheckStart.ok, true, JSON.stringify(recheckStart))

    const initialFamSet = new Set(initialFive.map(x => x.family_id))
    const recheckFamOverlap = recheckFive.filter(x => initialFamSet.has(x.family_id))
    assert.equal(recheckFamOverlap.length, 0, 're-check must use 100% fresh independent families')

    console.log(JSON.stringify({
      ok: true,
      initialCheck: { attemptId: start1.attemptId, items: initialFive.map(x => ({ id: x.id, familyId: x.family_id })) },
      spacedRecheck: { attemptId: recheckStart.attemptId, items: recheckFive.map(x => ({ id: x.id, familyId: x.family_id })) },
      familyOverlap: recheckFamOverlap.length,
    }, null, 2))
  } finally {
    await db.end().catch(() => {})
    if (started) pg.stop(cluster)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e); process.exit(1) })
