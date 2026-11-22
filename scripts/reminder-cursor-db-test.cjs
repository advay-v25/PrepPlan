const assert = require('node:assert/strict')
const fs = require('node:fs')
const net = require('node:net')
const { Client } = require('pg')
const local = require('./beta/local-pg.cjs')

async function availablePort() {
  const probe = net.createServer()
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve))
  const { port } = probe.address()
  await new Promise(resolve => probe.close(resolve))
  return port
}

async function main() {
  const port = await availablePort()
  const dir = local.tmp()
  const db = new Client({ user: 'postgres', database: 'postgres', host: '127.0.0.1', port, statement_timeout: 10_000 })
  try {
    local.start(dir, port)
    await db.connect()
    await db.query(`
      create role anon; create role authenticated; create role service_role;
      create schema roadmap_security;
      create table public.reminder_prefs(user_id uuid primary key, assessment_reminders boolean, weekly_review_reminders boolean);
      insert into public.reminder_prefs
      select gen_random_uuid(), n % 3 = 0, n % 3 = 1 from generate_series(1, 1807) n
    `)
    await db.query(fs.readFileSync('supabase/migrations/20270128_reminder_sync_cursor.sql', 'utf8'))
    const one = async (sql, params) => (await db.query(sql, params)).rows[0].result
    const claim = async () => one('select public.claim_reminder_sync_batch() as result')
    const finish = async (batch, last) => one('select public.finish_reminder_sync_batch($1,$2) as result', [batch.leaseId, last])
    const eligible = (await db.query('select user_id from public.reminder_prefs where assessment_reminders or weekly_review_reminders order by user_id')).rows.map(r => r.user_id)
    assert.equal(eligible.length, 1205)

    const grants = (await db.query(`
      select role, has_function_privilege(role, 'public.claim_reminder_sync_batch()', 'execute') as claim,
        has_function_privilege(role, 'public.finish_reminder_sync_batch(uuid,uuid)', 'execute') as finish
      from unnest(array['anon','authenticated','service_role']) as role order by role
    `)).rows
    assert.deepEqual(grants.map(row => [row.claim, row.finish]), [[false, false], [false, false], [true, true]])

    const first = await claim()
    assert.deepEqual(first.userIds, eligible.slice(0, 72))
    assert.equal(await claim(), null)
    assert.equal(await finish(first, first.userIds[19]), true)
    assert.equal(await finish(first, first.userIds[71]), false)

    const second = await claim()
    assert.equal(second.userIds[0], eligible[20])
    await db.query("update roadmap_security.reminder_sync_cursor set lease_until = clock_timestamp() - interval '1 second'")
    const replacement = await claim()
    assert.deepEqual(replacement.userIds, second.userIds)
    assert.notEqual(replacement.leaseId, second.leaseId)
    assert.equal(await finish(second, second.userIds.at(-1)), false)

    const scanned = first.userIds.slice(0, 20)
    let batch = replacement
    while (scanned.length < eligible.length) {
      assert.ok(batch.userIds.length > 0 && batch.userIds.length <= 72)
      scanned.push(...batch.userIds)
      assert.equal(await finish(batch, batch.userIds.at(-1)), true)
      if (scanned.length < eligible.length) batch = await claim()
    }
    assert.deepEqual(scanned, eligible)
    const nextSweep = await claim()
    assert.deepEqual(nextSweep.userIds, eligible.slice(0, 72))
    await db.query('update public.reminder_prefs set assessment_reminders = false, weekly_review_reminders = false')
    assert.equal(await finish(nextSweep, null), true)
    assert.deepEqual((await claim()).userIds, [])
    console.log('Reminder cursor passed with 1,205 opted-in students, partial ticks, expiry, replay and role limits.')
  } finally {
    await db.end().catch(() => {})
    local.stop(dir)
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1 })
