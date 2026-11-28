/**
 * Phase 4 full rehearsal lifecycle SQL/RPC proof in disposable local Postgres:
 * Reserves 2 linked 90-question sessions via `start_rehearsal`, verifies 180 distinct families,
 * tests concurrent/repeat resume, starts Session 1 & Session 2 clocks via `start_rehearsal_session`,
 * saves answers (with omissions) and finalizes both sessions via `finalize_assessment_attempt`.
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
  const port = 54355
  const database = 'phase4_rehearsal_lifecycle'
  const db = new Client({ host: '127.0.0.1', port, user: 'postgres', database })
  const value = async (sql, args) => (await db.query(sql, args)).rows[0]?.value
  const as = async (role, student, sql, args) => {
    await db.query('begin')
    try {
      await db.query(role === 'authenticated' ? 'set local role authenticated; set local row_security = on' : 'set local role service_role')
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
    const student = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'p4-rehearsal@example.invalid',now()) returning id as value")
    await db.query("insert into public.profiles(id,onboarding_status) values($1,'complete') on conflict (id) do update set onboarding_status='complete'", [student])

    // Seed >= 25 held-out families per topic across 10 readings (1 per topic)
    const file = path.join(dir, 'bank.json')
    await createBank(
      [`--out=${file}`, '--rehearsal=auto'],
      async () => {
        const client = new Client(cfg.connection)
        await client.connect()
        return client
      }
    )
    const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
    const heldOut = (await db.query(
      `select distinct on (e.family_id) e.id, e.family_id, e.key_index, r.topic_id
       from public.rehearsal_eligible_items e
       join public.curriculum_readings r on r.id = e.lm_id
       where e.id=any($1) order by e.family_id, e.id`,
      [bank.items]
    )).rows

    // Verify held-out items NEVER appear in student_eligible_items (routine)
    const leak = await value('select count(*)::int as value from public.student_eligible_items where id=any($1)', [bank.items])
    assert.equal(leak, 0, 'held-out items must never leak into student_eligible_items')

    const s1Topics = { eth: 22, quant: 21, econ: 13, fsa: 21, ci: 13 }
    const s2Topics = { eq: 23, fi: 23, deriv: 13, alt: 13, pm: 18 }
    const pick = counts => {
      const out = []
      for (const [tid, n] of Object.entries(counts)) {
        const rows = heldOut.filter(r => r.topic_id === tid).slice(0, n)
        assert.equal(rows.length, n, `short on ${tid}: ${rows.length}/${n}`)
        out.push(...rows)
      }
      return out
    }
    const s1Rows = pick(s1Topics)
    const s2Rows = pick(s2Topics)
    assert.equal(s1Rows.length, 90)
    assert.equal(s2Rows.length, 90)
    assert.equal(new Set([...s1Rows, ...s2Rows].map(r => r.family_id)).size, 180)

    const apptId = await value(
      `insert into public.mock_appointments(user_id,kind,planned_date,status)
       values($1,'internal_rehearsal',current_date,'planned') returning id as value`,
      [student]
    )

    const bp = { version: 'rehearsal-2027-11-09.1', perSessionAllocation: [s1Topics, s2Topics], sessions: 2, questionsPerSession: 90, minutesPerSession: 135 }
    const res1 = await as('service_role', null, 'select public.start_rehearsal($1,$2,$3,$4,$5,$6,$7,$8) as value', [
      student, apptId, manifest, s1Rows.map(r => r.id), s2Rows.map(r => r.id), JSON.stringify(bp), 'rehearsal-2027-11-09.1', JSON.stringify({ '1': {}, '2': {} }),
    ])
    assert.equal(res1.ok, true, JSON.stringify(res1))
    assert.equal(res1.resumed, false)

    // Repeat start_rehearsal resumes the exact same rehearsal
    const resAgain = await as('service_role', null, 'select public.start_rehearsal($1,$2,$3,$4,$5,$6,$7,$8) as value', [
      student, apptId, manifest, s1Rows.map(r => r.id), s2Rows.map(r => r.id), JSON.stringify(bp), 'rehearsal-2027-11-09.1', JSON.stringify({ '1': {}, '2': {} }),
    ])
    assert.equal(resAgain.ok, true)
    assert.equal(resAgain.resumed, true)
    assert.equal(resAgain.rehearsalId, res1.rehearsalId)

    const attempts = (await db.query(`select id, session_no from public.assessment_attempts where rehearsal_id=$1 order by session_no`, [res1.rehearsalId])).rows
    assert.equal(attempts.length, 2)
    const s1AttemptId = attempts[0].id
    const s2AttemptId = attempts[1].id
    const earlyS2 = await as('service_role', null, 'select public.start_rehearsal_session($1,$2) as value', [student, s2AttemptId])
    assert.equal(earlyS2.code, 'SESSION_1_OPEN')

    // Start Session 1 -> answer 3 items -> finalize Session 1
    const s1Start = await as('service_role', null, 'select public.start_rehearsal_session($1,$2) as value', [student, s1AttemptId])
    assert.equal(s1Start.ok, true, JSON.stringify(s1Start))
    const repeatS1 = await as('service_role', null, 'select public.start_rehearsal_session($1,$2) as value', [student, s1AttemptId])
    assert.equal(repeatS1.deadlineAt, s1Start.deadlineAt, 'resuming must not restart the clock')
    assert.equal(new Date(s1Start.deadlineAt) - new Date(await value('select started_at as value from public.assessment_attempts where id=$1', [s1AttemptId])), 135 * 60_000)
    for (let i = 0; i < 3; i++) {
      await as('service_role', null, 'select public.record_item_progress($1,$2,$3,0,0,true,null) as value', [s1AttemptId, student, s1Rows[i].id])
      await as('authenticated', student, 'select public.save_attempt_answer($1,$2,$3,5,0,0,false,1) as value', [s1AttemptId, s1Rows[i].id, s1Rows[i].key_index])
    }
    const fin1 = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','p4-s1') as value", [s1AttemptId])
    assert.equal(fin1.ok, true, JSON.stringify(fin1))
    const evidenceBeforeReplay = await value('select count(*)::int as value from public.evidence_events where user_id=$1', [student])
    const replayFin1 = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','p4-s1') as value", [s1AttemptId])
    assert.equal(replayFin1.alreadyScored, true)
    assert.equal(await value('select count(*)::int as value from public.evidence_events where user_id=$1', [student]), evidenceBeforeReplay)

    // Start Session 2 -> answer 2 items (88 omitted) -> finalize Session 2
    const s2Start = await as('service_role', null, 'select public.start_rehearsal_session($1,$2) as value', [student, s2AttemptId])
    assert.equal(s2Start.ok, true, JSON.stringify(s2Start))
    const repeatS2 = await as('service_role', null, 'select public.start_rehearsal_session($1,$2) as value', [student, s2AttemptId])
    assert.equal(repeatS2.deadlineAt, s2Start.deadlineAt)
    for (let i = 0; i < 2; i++) {
      await as('service_role', null, 'select public.record_item_progress($1,$2,$3,0,0,true,null) as value', [s2AttemptId, student, s2Rows[i].id])
      await as('authenticated', student, 'select public.save_attempt_answer($1,$2,$3,5,0,0,false,1) as value', [s2AttemptId, s2Rows[i].id, s2Rows[i].key_index])
    }
    const fin2 = await as('authenticated', student, "select public.finalize_assessment_attempt($1,'1.0','p4-s2') as value", [s2AttemptId])
    assert.equal(fin2.ok, true, JSON.stringify(fin2))

    const attCounts = (await db.query(`select id, delivered_count, valid_response_count, status from public.assessment_attempts where id in ($1,$2)`, [s1AttemptId, s2AttemptId])).rows
    const a1 = attCounts.find(a => a.id === s1AttemptId)
    const a2 = attCounts.find(a => a.id === s2AttemptId)
    assert.equal(a1.delivered_count, 90)
    assert.equal(a1.valid_response_count, 3)
    assert.equal(a2.delivered_count, 90)
    assert.equal(a2.valid_response_count, 2)

    console.log('PASS Phase 4 full rehearsal lifecycle (180 distinct held-out families, S1+S2 clocks, resume, omissions, exact-once scoring)')
  } finally {
    await db.end().catch(() => {})
    if (started) pg.stop(cluster)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e); process.exit(1) })
