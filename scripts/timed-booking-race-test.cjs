/** Timed-booking guard on an ISOLATED full schema (throwaway local Postgres: platform stub -> baseline -> every later migration through the checksum runner).
 *    node scripts/timed-booking-race-test.cjs
 * Two real connections, controlled barriers, both write orders: mock vs mock, mock vs task, mock vs protected occurrence. Nothing touches the shared dev database. */
const fs = require('node:fs'), path = require('node:path')
const { Client } = require('pg')
const { configuration, migrate, readMigrations } = require('./lib/migrations.cjs')
const { installBaseline } = require('./beta/install.cjs')
const pg = require('./beta/local-pg.cjs')
const root = path.resolve(__dirname, '..'), PORT = 54331, DB = 'roadmap_booking'
let passed = 0, failed = 0
const check = (n, ok, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const conn = async () => { const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', database: DB }); await c.connect(); return c }
const refused = e => e && e.code === 'BK409'
const D = '2030-03-12', TZ = 'Europe/London'   // a Tuesday; winter, so local time = UTC

async function newUser(c, tz = TZ) {
  const { rows } = await c.query(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${Math.random().toString(36).slice(2)}@example.com`])
  const id = rows[0].id
  await c.query(`insert into public.profiles (id, timezone) values ($1, $2) on conflict (id) do update set timezone = excluded.timezone`, [id, tz])
  return id
}
const mock = (c, u, date, start, mins, label = 'M') => c.query(`insert into public.mock_appointments (user_id, kind, planned_date, start_time, duration_minutes, label) values ($1,'provider_mock',$2,$3,$4,$5) returning id`, [u, date, start, mins, label])
const task = (c, u, id, startIso, mins) => c.query(`insert into public.plan_blocks (id, user_id, title, detail, task_type, origin, priority, placement, execution, local_date, day, starts_at, duration_minutes, duration, created_by) values ($1,$2,$1,'d','study','student','core','timed','not_started',$3::date,$3::date::text,$4::timestamptz,$5::smallint,$5::text,'student')`, [id, u, startIso.slice(0, 10), startIso, mins])
const oneOff = (c, u, label, fromIso, toIso, protectedFlag = true, kind = 'work') => c.query(`insert into public.calendar_commitments (user_id, label, kind, starts_at, ends_at, is_protected, recurrence) values ($1,$2,$3,$4,$5,$6,'none') returning id`, [u, label, kind, fromIso, toIso, protectedFlag])
const weekly = (c, u, label, weekdays, st, en, extra = {}) => c.query(`insert into public.calendar_commitments (user_id, label, kind, starts_at, ends_at, is_protected, recurrence, weekdays, start_time, end_time, starts_on, ends_on) values ($1,$2,'class',now(),now(),true,'weekly',$3,$4,$5,$6,$7) returning id`, [u, label, weekdays, st, en, extra.startsOn ?? null, extra.endsOn ?? null])
async function try_(p) { try { await p; return null } catch (e) { return e } }
const count = async (c, q, a) => Number((await c.query(q, a)).rows[0].n)

/** Writer A holds its transaction open after writing; writer B starts in another connection and must wait on the per-student lock, then be refused (or allowed). */
async function race(first, second) {
  const a = await conn(), b = await conn()
  await a.query('begin'); await b.query('begin')
  await first(a)
  let settled = false, err = null
  const pending = second(b).then(() => { settled = true }, e => { settled = true; err = e })
  await sleep(400)
  const waitedForLock = !settled
  await a.query('commit')
  await pending
  await b.query(err ? 'rollback' : 'commit')
  await a.end(); await b.end()
  return { waitedForLock, err }
}

async function main() {
  const dir = pg.tmp()
  try {
    pg.start(dir, PORT)
    pg.run('createdb', ['-h', '127.0.0.1', '-p', String(PORT), '-U', 'postgres', DB])
    const admin = await conn()
    await admin.query(fs.readFileSync(path.join(root, 'supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    await installBaseline(admin)
    const env = { MIGRATION_DATABASE_URL: `postgresql://postgres@127.0.0.1:${PORT}/${DB}`, MIGRATION_EXPECTED_DATABASE: DB }
    const cfg = configuration(['--env=local', '--apply', `--confirm-target=local:${DB}`], env)
    const r = await migrate(new Client(cfg.connection), readMigrations(path.join(root, 'supabase', 'migrations')), cfg)
    console.log(`\nIsolated schema ready (${r.pending.length} migration(s) applied after the baseline)\n`)
    const A = await newUser(admin)

    console.log('1. Interval rules (single connection)')
    await mock(admin, A, D, '18:00', 60, 'First')
    check('overlapping mock refused', refused(await try_(mock(admin, A, D, '18:30', 60))))
    check('adjacent mock accepted (half-open)', !(await try_(mock(admin, A, D, '19:00', 60, 'After'))))
    check('mock ending exactly when another starts accepted', !(await try_(mock(admin, A, D, '17:00', 60, 'Before'))))
    check('date-only mock holds no clock time', !(await try_(admin.query(`insert into public.mock_appointments (user_id, kind, planned_date) values ($1,'other',$2)`, [A, D]))))
    const firstId = (await admin.query(`select id from public.mock_appointments where user_id=$1 and label='First'`, [A])).rows[0].id
    check('editing the label of a booked mock is not re-checked', !(await try_(admin.query(`update public.mock_appointments set label='Renamed' where id=$1`, [firstId]))))
    check('re-saving the same appointment over its own old slot is accepted', !(await try_(admin.query(`update public.mock_appointments set start_time='18:15', duration_minutes=40 where id=$1`, [firstId]))))
    check('moving it onto a neighbour is refused and the row is unchanged', refused(await try_(admin.query(`update public.mock_appointments set start_time='18:45' where id=$1`, [firstId]))) && (await admin.query(`select start_time::text t from public.mock_appointments where id=$1`, [firstId])).rows[0].t === '18:15:00')
    check('cancelled mock stops occupying its time', (await admin.query(`update public.mock_appointments set status='cancelled' where user_id=$1 and label='After'`, [A]), !(await try_(mock(admin, A, D, '19:30', 30)))))

    const B = await newUser(admin)
    await mock(admin, B, D, '18:00', 60)
    check('another student’s mock never conflicts', true)
    check('...and the same time is free for a second student', (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [B])) === 1)

    console.log('\n2. Tasks and mocks')
    const C = await newUser(admin)
    await task(admin, C, 't1', `${D}T18:00:00Z`, 60)
    check('mock over a timed task refused, task unchanged', refused(await try_(mock(admin, C, D, '18:30', 60))) && (await count(admin, `select count(*) n from public.plan_blocks where user_id=$1`, [C])) === 1)
    check('mock starting when the task ends accepted', !(await try_(mock(admin, C, D, '19:00', 60, 'Right after'))))
    check('timed task over the mock refused', refused(await try_(task(admin, C, 't2', `${D}T19:30:00Z`, 30))))
    check('task ending when the mock starts accepted', !(await try_(task(admin, C, 't3', `${D}T18:30:00Z`, 30))))
    check('task-to-task overlap stays permitted', !(await try_(task(admin, C, 't4', `${D}T18:10:00Z`, 30))))
    check('a task resize into the mock is refused', refused(await try_(admin.query(`update public.plan_blocks set duration_minutes=120 where id='t1'`))))
    check('completing a task does not re-check it', !(await try_(admin.query(`update public.plan_blocks set execution='completed' where id='t4'`))))
    check('a cancelled task stops occupying its time', (await admin.query(`update public.plan_blocks set cancelled_at=now(), execution='cancelled' where id in ('t1','t4')`), !(await try_(mock(admin, C, D, '18:00', 30, 'Freed')))))

    console.log('\n3. Protected occurrences')
    const E = await newUser(admin)
    await oneOff(admin, E, 'Work', `${D}T09:00:00Z`, `${D}T17:00:00Z`)
    check('mock over a protected one-off refused', refused(await try_(mock(admin, E, D, '16:30', 60))))
    check('mock starting when it ends accepted', !(await try_(mock(admin, E, D, '17:00', 30))))
    const F = await newUser(admin)
    await oneOff(admin, F, 'Night shift', `${D}T22:00:00Z`, `2030-03-13T01:00:00Z`)
    check('a one-off spanning local midnight also holds the next day', refused(await try_(mock(admin, F, '2030-03-13', '00:30', 30))) && !(await try_(mock(admin, F, '2030-03-13', '01:00', 30))))
    const G = await newUser(admin)   // Tuesday = 2
    const cls = (await weekly(admin, G, 'Class', [2], '18:00', '20:00', { startsOn: '2030-03-05', endsOn: '2030-03-26' })).rows[0].id
    check('mock over a weekly class refused', refused(await try_(mock(admin, G, D, '19:00', 30))))
    check('a different weekday is free', !(await try_(mock(admin, G, '2030-03-13', '19:00', 30))))
    check('before the series starts is free', !(await try_(mock(admin, G, '2030-02-26', '19:00', 30))))
    check('after the series ends is free', !(await try_(mock(admin, G, '2030-04-02', '19:00', 30))))
    await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind) values ($1,$2,$3,'skipped')`, [G, cls, D])
    check('a skipped occurrence stops occupying its time', !(await try_(mock(admin, G, D, '19:00', 30, 'Skipped slot'))))
    await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time) values ($1,$2,'2030-03-19','moved','2030-03-20','10:00','11:00')`, [G, cls])
    check('a moved occurrence occupies its new time, not the old', refused(await try_(mock(admin, G, '2030-03-20', '10:30', 15))) && !(await try_(mock(admin, G, '2030-03-19', '19:00', 30, 'Old slot'))))
    check('a moved occurrence cannot land on a booked mock', refused(await try_(admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time) values ($1,$2,'2030-03-26','moved','2030-03-13','19:00','19:30')`, [G, cls]))))
    check('a class edit onto a booked mock is refused and unchanged', refused(await try_(admin.query(`update public.calendar_commitments set weekdays=array[2,3] where id=$1`, [cls]))) && (await admin.query(`select weekdays from public.calendar_commitments where id=$1`, [cls])).rows[0].weekdays.length === 1)
    check('editing only the label of a class is not re-checked', !(await try_(admin.query(`update public.calendar_commitments set label='Renamed class' where id=$1`, [cls]))))

    console.log('\n4. Races: two connections, controlled barrier, both orders')
    for (const [name, mk] of [
      ['mock vs mock', [u => c => mock(c, u, D, '10:00', 60, 'A'), u => c => mock(c, u, D, '10:30', 60, 'B')]],
      ['mock then task', [u => c => mock(c, u, D, '10:00', 60), u => c => task(c, u, 'rt' + Math.random().toString(36).slice(2), `${D}T10:30:00Z`, 30)]],
      ['task then mock', [u => c => task(c, u, 'rt' + Math.random().toString(36).slice(2), `${D}T10:30:00Z`, 30), u => c => mock(c, u, D, '10:00', 60)]],
      ['mock then protected occurrence', [u => c => mock(c, u, D, '10:00', 60), u => c => oneOff(c, u, 'Appointment', `${D}T10:30:00Z`, `${D}T11:30:00Z`)]],
      ['protected occurrence then mock', [u => c => oneOff(c, u, 'Appointment', `${D}T10:30:00Z`, `${D}T11:30:00Z`), u => c => mock(c, u, D, '10:00', 60)]],
    ]) {
      const u = await newUser(admin)
      const out = await race(mk[0](u), mk[1](u))
      const rows = (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [u])) + (await count(admin, `select count(*) n from public.plan_blocks where user_id=$1`, [u])) + (await count(admin, `select count(*) n from public.calendar_commitments where user_id=$1`, [u]))
      check(`${name}: the second writer waits for the first, then is refused`, out.waitedForLock && refused(out.err), `waited=${out.waitedForLock} err=${out.err?.code}/${out.err?.message}`)
      check(`${name}: exactly one booking exists`, rows === 1, String(rows))
    }
    {
      const u = await newUser(admin)
      const out = await race(c => mock(c, u, D, '10:00', 60), c => mock(c, u, D, '11:00', 60))
      check('adjacent contenders both succeed, in either order', !out.err && (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [u])) === 2)
    }
    {
      const u = await newUser(admin), v = await newUser(admin)
      const out = await race(c => mock(c, u, D, '10:00', 60), c => mock(c, v, D, '10:00', 60))
      check('different students never wait on or refuse each other', !out.waitedForLock && !out.err)
    }
    {   // 12 concurrent contenders for overlapping slots across mixed writers: no deadlock, at most one winner
      const u = await newUser(admin), cs = await Promise.all(Array.from({ length: 12 }, conn))
      const results = await Promise.all(cs.map((c, i) => try_(i % 3 === 0 ? mock(c, u, D, '12:00', 60, 'm' + i) : i % 3 === 1 ? task(c, u, 'cc' + i + Math.random().toString(36).slice(2), `${D}T12:20:00Z`, 30) : oneOff(c, u, 'o' + i, `${D}T12:40:00Z`, `${D}T13:10:00Z`))))
      await Promise.all(cs.map(c => c.end()))
      const deadlocks = results.filter(e => e && e.code === '40P01').length, other = results.filter(e => e && e.code !== 'BK409')
      const mocks = await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [u])
      const tasks = await count(admin, `select count(*) n from public.plan_blocks where user_id=$1`, [u])
      const prot = await count(admin, `select count(*) n from public.calendar_commitments where user_id=$1`, [u])
      check('12 mixed concurrent writers: no deadlock and no unexpected error', deadlocks === 0 && other.length === 0, JSON.stringify(other.map(e => e.code)))
      check('...and mocks never coexist with a conflicting task or protected occurrence', !(mocks > 0 && (tasks > 0 || prot > 0)) && mocks <= 1, `${mocks}/${tasks}/${prot}`)
    }

    console.log('\n5. Through checkpoint_command (receipt, rollback, replay, postponement)')
    const H = await newUser(admin)
    await task(admin, H, 'h1', `${D}T15:00:00Z`, 60)
    const cmd = (key, command, args, hash = 'h-' + key) => admin.query(`select public.checkpoint_command($1,$2,$3,$4,$5::jsonb) r`, [H, key, command, hash, JSON.stringify(args)]).then(x => x.rows[0].r)
    const bad = await try_(cmd('key-conflict-1', 'add', { kind: 'provider_mock', date: D, startTime: '15:30', durationMinutes: 60 }))
    check('a conflicting add is refused with SLOT_TAKEN and writes no receipt', refused(bad) && (await count(admin, `select count(*) n from public.checkpoint_commands where user_id=$1`, [H])) === 0 && (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [H])) === 0)
    const ok = await cmd('key-okay-1', 'add', { kind: 'provider_mock', date: D, startTime: '16:00', durationMinutes: 60 })
    check('an adjacent add succeeds', ok.ok === true)
    const replay = await cmd('key-okay-1', 'add', { kind: 'provider_mock', date: D, startTime: '16:00', durationMinutes: 60 })
    check('exact replay returns the original receipt and adds nothing', replay.replayed === true && (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [H])) === 1)
    await task(admin, H, 'h2', '2030-03-14T16:00:00Z', 60)
    const appt = (await admin.query(`select id, version from public.mock_appointments where user_id=$1`, [H])).rows[0]
    const beforeEvents = await count(admin, `select count(*) n from public.mock_outcomes where user_id=$1`, [H]).catch(() => 0)
    const post = await try_(cmd('key-post-001', 'outcome', { checkpointId: appt.id, expectedVersion: appt.version, outcome: 'postponed', newDate: '2030-03-14' }))
    check('a postponement onto a taken slot (old clock time kept) is refused', refused(post))
    const after = (await admin.query(`select planned_date::text d, status, version from public.mock_appointments where id=$1`, [appt.id])).rows[0]
    check('the refused postponement left the appointment, outcome history and receipts untouched', after.d === D && after.status === 'planned' && after.version === appt.version
      && (await count(admin, `select count(*) n from public.mock_outcomes where user_id=$1`, [H]).catch(() => 0)) === beforeEvents && (await count(admin, `select count(*) n from public.checkpoint_commands where user_id=$1 and key='key-post-001'`, [H])) === 0)
    check('the same command succeeds once the slot is free', (await (admin.query(`update public.plan_blocks set cancelled_at=now(), execution='cancelled' where id='h2'`), cmd('key-post-002', 'outcome', { checkpointId: appt.id, expectedVersion: appt.version, outcome: 'postponed', newDate: '2030-03-14' }))).ok === true)

    console.log('\n6. Restoring an occurrence is a booking too (migration 20261201)')
    const K = await newUser(admin)
    const kc = (await weekly(admin, K, 'Evening class', [2], '18:00', '20:00')).rows[0].id
    const exId = (await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind) values ($1,$2,$3,'skipped') returning id`, [K, kc, D])).rows[0].id
    await mock(admin, K, D, '19:00', 60, 'Freed-slot mock')
    const del = await try_(admin.query(`delete from public.commitment_exceptions where id=$1`, [exId]))
    check('restoring a skipped class over a booked mock is refused, naming the mock and the class', refused(del) && del.detail === 'Freed-slot mock' && del.hint === 'Evening class', `${del?.code} ${del?.detail} ${del?.hint}`)
    check('...and the exception and the mock are intact', (await count(admin, `select count(*) n from public.commitment_exceptions where id=$1`, [exId])) === 1 && (await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [K])) === 1)
    const mvId = (await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind, new_date, new_start_time, new_end_time) values ($1,$2,'2030-03-19','moved','2030-03-20','10:00','11:00') returning id`, [K, kc])).rows[0].id
    await mock(admin, K, '2030-03-19', '19:00', 60, 'Original-slot mock')
    const del2 = await try_(admin.query(`delete from public.commitment_exceptions where id=$1`, [mvId]))
    check('deleting a moved exception over a mock booked in the original slot is refused', refused(del2) && del2.detail === 'Original-slot mock', `${del2?.code} ${del2?.detail}`)
    check('deleting an exception that restores nothing in conflict still works', !(await try_(admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind) values ($1,$2,'2030-03-26','skipped')`, [K, kc]).then(() => admin.query(`delete from public.commitment_exceptions where user_id=$1 and occurrence_date='2030-03-26'`, [K])))))
    check('archiving the series (occurrence removed) still works with exceptions and mocks present', !(await try_(admin.query(`update public.calendar_commitments set status='archived' where id=$1`, [kc]))))
    check('...after which the old exception can be removed', !(await try_(admin.query(`delete from public.commitment_exceptions where id=$1`, [exId]))))
    const L = await newUser(admin)
    const lc = (await weekly(admin, L, 'Class', [2], '18:00', '20:00')).rows[0].id
    await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind) values ($1,$2,$3,'skipped')`, [L, lc, D])
    await mock(admin, L, D, '19:00', 60, 'M')
    check('hard-deleting the whole series (cascade) still works', !(await try_(admin.query(`delete from public.calendar_commitments where id=$1`, [lc]))))
    for (const [name, order] of [['restore then book', 0], ['book then restore', 1]]) {
      const u = await newUser(admin)
      const c = (await weekly(admin, u, 'Class', [2], '18:00', '20:00')).rows[0].id
      const e = (await admin.query(`insert into public.commitment_exceptions (user_id, commitment_id, occurrence_date, kind) values ($1,$2,$3,'skipped') returning id`, [u, c, D])).rows[0].id
      const restore = cc => cc.query(`delete from public.commitment_exceptions where id=$1`, [e])
      const book = cc => mock(cc, u, D, '19:00', 60, 'Contender')
      const out = await race(order === 0 ? restore : book, order === 0 ? book : restore)
      const exceptions = await count(admin, `select count(*) n from public.commitment_exceptions where id=$1`, [e]), mocks = await count(admin, `select count(*) n from public.mock_appointments where user_id=$1`, [u])
      check(`${name}: the second writer waits then is refused, and exactly one outcome stands (class restored XOR mock booked)`, out.waitedForLock && refused(out.err) && (exceptions === 0) !== (mocks === 1) === true, `waited=${out.waitedForLock} err=${out.err?.code} ex=${exceptions} mocks=${mocks}`)
    }
    await admin.end()
  } finally { pg.stop(dir); fs.rmSync(dir, { recursive: true, force: true }) }
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
