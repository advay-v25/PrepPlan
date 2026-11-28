/**
 * Phase 3 item-by-item adaptive practice SQL/RPC contract test in disposable local Postgres:
 * Proves migration 20270203_adaptive_item_practice.sql, start at Easy, ladder/clamps,
 * replay, KEY_CONFLICT, ALREADY_SCORED, invalidation before/after reserve, shortage,
 * zero evidence_events/repair_threads writes, and RLS isolation.
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')
const pg = require('./beta/local-pg.cjs')
const { installFresh, installBaseline } = require('./beta/install.cjs')
const { configuration, readMigrations, migrate } = require('./lib/migrations.cjs')
const { create: createBank } = require('./fixture-bank.cjs')

async function main() {
  const dir = pg.tmp()
  const cluster = path.join(dir, 'pg')
  const port = 54353
  const database = 'phase3_adaptive_item'
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
    if (process.argv.includes('--upgrade')) {
      await installBaseline(db)
      const files = readMigrations(path.join(__dirname, '../supabase/migrations'))
      await migrate(new Client(cfg.connection), files.filter(f => f.version < '20270205'), cfg)
      assert.equal(await value("select has_table_privilege('authenticated', 'public.adaptive_item_steps', 'SELECT') as value"), true)
      const upgraded = await migrate(new Client(cfg.connection), files, cfg)
      assert.deepEqual(upgraded.pending, files.filter(f => f.version >= '20270205').map(f => f.version))
      assert.ok(upgraded.pending.includes('20270205_private_adaptive_item_snapshots'))
      assert.equal((await migrate(new Client(cfg.connection), files, { ...cfg, apply: false })).pending.length, 0)
      console.log('PASS upgrade from pre-private-snapshot schema; checksum runner has zero pending migrations')
    } else {
      const install = await installFresh(db, cfg)
      assert.equal(install.pendingAfter, 0)
    }

    const manifest = await value('select id as value from public.curriculum_manifests where is_active')
    const student = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'p3-student@example.invalid',now()) returning id as value")
    const other = await value("insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'p3-other@example.invalid',now()) returning id as value")

    const file = path.join(dir, 'bank.json')
    await createBank([`--out=${file}`, '--readings=r032', '--per-outcome=6'], async () => {
      const client = new Client(cfg.connection)
      await client.connect()
      return client
    })
    const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
    const items = (await db.query(
      `select distinct on (e.family_id) e.id, e.item_version, e.family_id, e.key_index, e.stem, d.level
       from public.student_eligible_items e
       join public.item_confirmed_difficulty d on d.item_id = e.id and d.item_version = e.item_version
       where e.id=any($1) and e.outcome_id='r032-a' order by e.family_id, e.id`,
      [bank.items]
    )).rows
    const easy = items.filter(i => i.level === 'foundation')
    const med = items.filter(i => i.level === 'standard')
    assert.ok(easy.length >= 2 && med.length >= 2, 'expected >=2 easy and >=2 medium fixture items')

    // 1. Start at Easy (foundation) + replay
    const start1 = await as('service_role', null, 'select public.adaptive_item_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', [
      student, 'start-k1', 'h-start-1', manifest, 'r032', ['r032-a'], easy[0].id, easy[0].item_version, easy[0].family_id, null,
    ])
    assert.equal(start1.ok, true, JSON.stringify(start1))
    assert.equal(start1.targetTier, 'foundation')
    assert.equal(start1.seq, 1)
    assert.equal(await value(
      "select has_column_privilege('authenticated', 'public.adaptive_item_steps', 'key_index', 'SELECT') as value",
    ), false, 'pinned answers must be server-only')
    assert.equal(await value(
      "select has_table_privilege('service_role', 'public.adaptive_item_steps', 'SELECT') as value",
    ), true, 'the owned run service must still read pinned steps')

    const startReplay = await as('service_role', null, 'select public.adaptive_item_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value', [
      student, 'start-k1', 'h-start-1', manifest, 'r032', ['r032-a'], easy[0].id, easy[0].item_version, easy[0].family_id, null,
    ])
    assert.equal(startReplay.ok, true)
    assert.equal(startReplay.replay, true)
    assert.equal(startReplay.runId, start1.runId)

    // 1b. Retire easy[0] AFTER delivery -> student_eligible_items drops it, while step 1 still grades against its PINNED key_index & retains pinned stem!
    const origKey = easy[0].key_index
    const mutatedKey = (origKey + 1) % 3
    await db.query(`update public.assessment_items set review_status='deprecated' where id=$1`, [easy[0].id])
    assert.equal(await value(`select count(*)::int as value from public.student_eligible_items where id=$1`, [easy[0].id]), 0)

    // 1c. Passing wrong-tier next item (easy[1] when nextTier is standard) must fail with BANK_CHANGED
    const badNext = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 1, 'c-bad-next', 'h-bad-next', origKey, 'correct', 'standard', easy[1].id, easy[1].item_version, easy[1].family_id, null,
    ])
    assert.equal(badNext.ok, false)
    assert.equal(badNext.code, 'BANK_CHANGED')

    // 2. Commit step 1 with origKey (correct -> standard) + replay + KEY_CONFLICT + ALREADY_SCORED
    const c1 = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 1, 'c-k1', 'h-c1', origKey, 'correct', 'standard', med[0].id, med[0].item_version, med[0].family_id, null,
    ])
    assert.equal(c1.ok, true, JSON.stringify(c1))
    assert.equal(c1.outcome, 'correct', 'must grade against pinned key_index even after assessment_items edit')
    assert.equal(c1.nextTier, 'standard')
    assert.equal(c1.nextSeq, 2)
    const pinnedStem = await value('select stem as value from public.adaptive_item_steps where run_id=$1 and seq=1', [start1.runId])
    assert.equal(pinnedStem, easy[0].stem, 'pinned stem must remain unchanged after assessment_items edit')

    const c1Replay = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 1, 'c-k1', 'h-c1', origKey, 'correct', 'standard', med[0].id, med[0].item_version, med[0].family_id, null,
    ])
    assert.equal(c1Replay.replay, true)

    const c1Mutated = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 1, 'c-k1', 'h-c1-DIFF', mutatedKey, 'incorrect', 'foundation', med[0].id, med[0].item_version, med[0].family_id, null,
    ])
    assert.equal(c1Mutated.ok, false)
    assert.equal(c1Mutated.code, 'KEY_CONFLICT')

    const c1SecondKey = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 1, 'c-k1-second', 'h-c1-2', mutatedKey, 'incorrect', 'foundation', med[1].id, med[1].item_version, med[1].family_id, null,
    ])
    assert.equal(c1SecondKey.ok, false)
    assert.equal(c1SecondKey.code, 'ALREADY_SCORED')

    // 3. Invalidate step 1 AFTER step 2 was reserved -> step 2 stays, targetTier recomputes to foundation
    const inv = await as('service_role', null, 'select public.adaptive_item_invalidate($1,$2,$3,$4) as value', [
      student, start1.runId, 1, 'void',
    ])
    assert.equal(inv.ok, true)
    assert.equal(inv.targetTier, 'foundation')
    const stepCount = await value('select count(*)::int as value from public.adaptive_item_steps where run_id=$1', [start1.runId])
    assert.equal(stepCount, 2, 'already-reserved step 2 must stay frozen')

    // 4. Commit step 2 with shortage (nextItemId = null) -> finished_shortage
    const c2Short = await as('service_role', null, 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value', [
      student, start1.runId, 2, 'c-k2', 'h-c2', med[0].key_index, 'correct', 'standard', null, null, null, 'No eligible Medium routine item remains.',
    ])
    assert.equal(c2Short.ok, true)
    assert.equal(c2Short.status, 'finished_shortage')
    assert.equal(c2Short.shortageTier, 'standard')

    // 5. Practice isolation: 0 evidence_events & 0 repair_threads + RLS blocks other user
    assert.equal(await value('select count(*)::int as value from public.evidence_events where user_id=$1', [student]), 0)
    assert.equal(await value('select count(*)::int as value from public.repair_threads where user_id=$1', [student]), 0)
    const otherVisible = await as('authenticated', other, 'select count(*)::int as value from public.adaptive_item_runs where id=$1', [start1.runId])
    assert.equal(otherVisible, 0, 'RLS must block other users from reading adaptive_item_runs')

    // Separate connections reproduce same-key races rather than serialising in the test client.
    const race = async (sql, args) => Promise.all([1, 2, 3].map(async () => {
      const client = new Client(cfg.connection)
      await client.connect()
      try {
        await client.query('set role service_role')
        return (await client.query(sql, args)).rows[0].value
      } finally { await client.end() }
    }))
    const startSql = 'select public.adaptive_item_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as value'
    const commitSql = 'select public.adaptive_item_commit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as value'
    const starts = await race(startSql, [other, 'race-start', 'race-start-hash', manifest, 'r032', ['r032-a'], easy[1].id, easy[1].item_version, easy[1].family_id, null])
    assert.ok(starts.every(r => r.ok))
    assert.equal(new Set(starts.map(r => r.runId)).size, 1)
    assert.equal(starts.filter(r => r.replay).length, 2)
    const runId = starts[0].runId
    const commits = await race(commitSql, [other, runId, 1, 'race-commit', 'race-commit-hash', easy[1].key_index, 'correct', 'standard', med[1].id, med[1].item_version, med[1].family_id, null])
    assert.ok(commits.every(r => r.ok))
    assert.equal(commits.filter(r => r.replay).length, 2)
    assert.equal(await value('select count(*)::int as value from public.adaptive_item_steps where run_id=$1', [runId]), 2)
    assert.equal(await value('select revision as value from public.adaptive_item_runs where id=$1', [runId]), 2)

    const foreign = (await db.query(`select e.id,e.item_version,e.family_id from public.student_eligible_items e join public.item_confirmed_difficulty d on d.item_id=e.id and d.item_version=e.item_version where e.outcome_id='r032-b' and d.level='foundation' limit 1`)).rows[0]
    assert.ok(foreign)
    const narrow = await as('service_role', null, startSql, [other, 'foreign-start', 'foreign-hash', manifest, 'r032', ['r032-a'], foreign.id, foreign.item_version, foreign.family_id, null])
    assert.equal(narrow.code, 'BANK_CHANGED', 'reservation must enforce the selected outcome')
    const exposed = await as('service_role', null, startSql, [other, 'exposed-start', 'exposed-hash', manifest, 'r032', ['r032-a'], easy[1].id, easy[1].item_version, easy[1].family_id, null])
    assert.equal(exposed.code, 'BANK_CHANGED', 'a different start key cannot reuse an exposed family')
    const staleStop = await as('service_role', null, 'select public.adaptive_item_stop($1,$2,$3) as value', [other, runId, 1])
    assert.equal(staleStop.code, 'STALE_RUN')
    const stopped = await as('service_role', null, 'select public.adaptive_item_stop($1,$2,$3) as value', [other, runId, 2])
    assert.equal(stopped.status, 'stopped')
    const closed = await as('service_role', null, commitSql, [other, runId, 2, 'closed-commit', 'closed-hash', null, 'omitted', 'standard', null, null, null, 'none'])
    assert.equal(closed.code, 'RUN_CLOSED')
    assert.equal(await value('select count(*)::int as value from public.evidence_events where user_id=$1', [other]), 0)
    console.log('PASS Phase 3 adaptive_item SQL/RPC, concurrent receipts, narrow scope, exposure, stop and RLS contracts')
  } finally {
    await db.end().catch(() => {})
    if (started) pg.stop(cluster)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(e => { console.error(e); process.exit(1) })
