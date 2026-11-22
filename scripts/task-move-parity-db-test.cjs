/** The ONE scheduling mutation boundary (apply_task_move), on the real schema: the Calendar path and the Coach confirmation share it.
 *  Parity matrix + both race orders for a protected class added after preview + two simultaneous moves into one slot + rollback.
 *  Throwaway students removed by recorded id.   npm run task:move:db:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: deadline reached (fixtures may remain; re-run to clean).'); process.exit(2) }, 170000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const a = mk(); await a.connect(); const pool = []; let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36), users = [], wait = ms => new Promise(r => setTimeout(r, ms))
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const as = async (c, uid, sql, p) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return Object.values(r.rows[0] ?? { v: null })[0] } catch (e) { await c.query('ROLLBACK'); throw e }
  }
  const student = async () => {
    const id = await one(a, 'select gen_random_uuid()'); users.push(id)
    await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `tm-${tag}-${users.length}@example.invalid`])
    await a.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [id]); await a.query("update public.profiles set onboarding_status='complete', timezone='UTC' where id=$1", [id])
    const cyc = await one(a, 'select gen_random_uuid()')
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, id])
    return { id, cyc }
  }
  let k = 0
  const task = async (s, o = {}) => {
    const id = `tm-${tag}-${++k}`
    await a.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment,starts_at,learning_activity_id)
      values ($1,$2,$3,$4,'d','study','planner','core',$5,$6,current_date + $7::int,(current_date + $7::int)::text,30,'30','algorithm',false,$8,null)`,
      [id, s.id, o.cycle === undefined ? s.cyc : o.cycle, `Task ${k}`, o.starts ? 'timed' : 'day_preferred', o.execution ?? 'not_started', o.offset ?? 0, o.starts ?? null])
    return id
  }
  const at = async (offset, hhmm) => (await one(a, `select ((current_date + $1::int)::text || ' ${hhmm}:00+00')::timestamptz`, [offset])).toISOString()
  const dateOf = async off => await one(a, 'select (current_date + $1::int)::text', [off])
  const row = async id => (await a.query('select id, execution, revision, local_date::text d, starts_at, placement, duration_minutes m from public.plan_blocks where id=$1', [id])).rows[0]
  const events = id => one(a, "select count(*) from public.task_events where task_id=$1 and event_type in ('moved','duration_changed')", [id]).then(Number)
  const apply = (c, s, t, rev, off, starts, strict = false, mins = 30) => dateOf(off).then(d => c.query('select public.apply_task_move($1,$2,$3,$4::date,$5,$6,$7,$8) r', [s.id, t, rev, d, starts, mins, strict, strict ? 'coach' : 'calendar']).then(r => r.rows[0].r))
  const commit = async (s, label, startsAt, endsAt, over = {}) => one(a, `insert into public.calendar_commitments (user_id,label,kind,starts_at,ends_at,is_protected,status) values ($1,$2,$3,$4,$5,$6,'active') returning id`, [s.id, label, over.kind ?? 'work', startsAt, endsAt, over.protected ?? true])
  const propose = async (s, t, off, startsAt, extra = {}) => {
    const r = await row(t), to = await dateOf(off)
    return one(a, `insert into public.coach_proposals (user_id, intent, kind, title, reasoning, proposed_changes, origin, status, target_cycle_id)
      values ($1,'move_task','move_task','Move','t',$2::jsonb,'coach','pending',$3) returning id`, [s.id, JSON.stringify({ version: 3, move: { id: t, title: t, revision: r.revision, fromDate: r.d, toDate: to, startsAt, startMinutes: null, minutes: 30, ...extra } }), s.cyc])
  }
  const confirm = (c, uid, id) => as(c, uid, 'select public.confirm_coach_move($1) as r', [id])

  try {
    const s = await student(), s2 = await student()
    console.log('\nParity matrix: one boundary, same answers')
    let t = await task(s), r0 = await row(t)
    let r = await apply(a, s, t, r0.revision, 3, await at(3, '10:00'))
    ok('ordinary move applies and writes one event', r.ok && (await row(t)).d === await dateOf(3) && (await events(t)) === 1)
    r = await apply(a, s, t, r0.revision, 4, await at(4, '10:00'))
    ok('stale revision refused, nothing written', r.code === 'REVISION' && (await row(t)).d === await dateOf(3) && (await events(t)) === 1)
    r = await apply(a, s2, t, (await row(t)).revision, 4, await at(4, '10:00'))
    ok('wrong owner cannot see the task', r.code === 'NOT_FOUND')
    t = await task(s, { execution: 'deferred', offset: 1 }); r0 = await row(t)
    r = await apply(a, s, t, r0.revision, 5, null)
    ok('deferred task is reopened by a Calendar-style move (a "moved" event carrying reopened=true)', r.ok && r.reopened && (await row(t)).execution === 'not_started' && Number(await one(a, "select count(*) from public.task_events where task_id=$1 and event_type='moved' and (payload->>'reopened')::boolean", [t])) === 1)
    t = await task(s, { offset: 1 }); r0 = await row(t)
    await a.query("update public.plan_blocks set cancelled_at = now() where id=$1", [t]); r0 = await row(t)
    ok('cancelled task refused', (await apply(a, s, t, r0.revision, 5, null)).code === 'CANCELLED')
    t = await task(s, { offset: 1 }); r0 = await row(t)
    ok('outside the cycle refused', (await apply(a, s, t, r0.revision, 20, null)).code === 'OUTSIDE_CYCLE')
    ok('a past day refused for unfinished work', (await apply(a, s, t, r0.revision, -2, null)).code === 'PAST' || (await apply(a, s, t, r0.revision, -2, null)).code === 'OUTSIDE_CYCLE')
    ok('a slot whose day does not match is refused', (await apply(a, s, t, r0.revision, 3, await at(4, '10:00'))).code === 'BAD_SLOT')
    ok('an absurd duration is refused', (await apply(a, s, t, r0.revision, 3, null, false, 3)).code === 'BAD_DURATION')
    // same-day time edit and overnight boundary
    t = await task(s, { offset: 2, starts: await at(2, '09:00') }); r0 = await row(t)
    r = await apply(a, s, t, r0.revision, 2, await at(2, '15:30'))
    ok('same-day time edit moves the time, not the day', r.ok && (await row(t)).d === await dateOf(2) && new Date((await row(t)).starts_at).toISOString() === await at(2, '15:30'))
    await commit(s, 'Night shift', await at(3, '22:00'), await at(4, '06:00'))
    t = await task(s, { offset: 1 }); r0 = await row(t)
    r = await apply(a, s, t, r0.revision, 4, await at(4, '05:00'))
    ok('overnight commitment blocks the next morning too', r.code === 'PROTECTED' && r.title === 'Night shift')
    r = await apply(a, s, t, r0.revision, 4, await at(4, '06:00'))
    ok('adjacent to the end of that commitment is allowed (half-open)', r.ok)
    // protected conflict and soft overlap
    await commit(s, 'Lecture', await at(5, '09:00'), await at(5, '10:00'), { kind: 'class' })
    t = await task(s, { offset: 1 }); r0 = await row(t)
    ok('a protected class refuses the move', (await apply(a, s, t, r0.revision, 5, await at(5, '09:30'))).code === 'PROTECTED' && (await row(t)).d === await dateOf(1))
    const other = await task(s, { offset: 5, starts: await at(5, '14:00') })
    r = await apply(a, s, t, r0.revision, 5, await at(5, '14:00'))
    ok('Calendar keeps a task-to-task overlap as a soft overlap (applies; the app warns before)', r.ok)
    t = await task(s, { offset: 1 }); r0 = await row(t)
    ok('the Coach path (strict) refuses that same overlap', (await apply(a, s, t, r0.revision, 5, await at(5, '14:00'), true)).code === 'SLOT_TAKEN')
    // continuation
    t = await task(s, { offset: 1 }); r0 = await row(t)
    await a.query("select set_config('roadmap.continuation_command','on',false)")
    const later = await one(a, 'select gen_random_uuid()')
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now()+interval '10 days',now()+interval '17 days',current_date+10,current_date+17,'UTC','closed')", [later, s.id])
    await a.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment,continued_from_task_id)
      values ($1,$2,$3,'cont','d','study','planner','core','day_preferred','not_started',current_date+11,(current_date+11)::text,30,'30','algorithm',false,$4)`, [`tm-${tag}-cont`, s.id, later, t])
    ok('a continued task is history and cannot be moved', (await apply(a, s, t, r0.revision, 3, null)).code === 'CONTINUED')

    console.log('\nCoach confirmation uses the same boundary')
    t = await task(s, { offset: 1 })
    await commit(s, 'Appointment', await at(6, '09:00'), await at(6, '10:00'))
    let p = await propose(s, t, 6, await at(6, '09:00'))
    r = await confirm(a, s.id, p)
    ok('a protected commitment present at confirmation makes the preview stale', r.code === 'STALE' && r.reason === 'protected_booking' && (await row(t)).d === await dateOf(1))
    await a.query("insert into public.availability_windows (user_id,weekday,start_time,end_time) values ($1, extract(dow from current_date+7)::int, '06:00','07:00')", [s.id])
    t = await task(s, { offset: 1 })
    p = await propose(s, t, 7, await at(7, '06:15'), { windowed: true })
    ok('a preview inside the saved window confirms', (await confirm(a, s.id, p)).ok === true)
    t = await task(s, { offset: 1 }); p = await propose(s, t, 7, await at(7, '06:15'), { windowed: true })
    await a.query("update public.availability_windows set start_time='09:00', end_time='11:00' where user_id=$1", [s.id])
    r = await confirm(a, s.id, p)
    ok('availability changed after preview: stale, nothing written', r.code === 'STALE' && r.reason === 'outside_availability' && (await row(t)).d === await dateOf(1) && (await events(t)) === 0)

    console.log('\nRaces on the scope lock')
    for (let i = 0; i < 6; i++) {
      const sx = await student(), tx = await task(sx, { offset: 1 }), to = 3
      const px = await propose(sx, tx, to, await at(to, '11:00')), [c1, c2] = [await conn(), await conn()]
      const lag = [0, 15, 60, 150, 300, 500][i]
      const addClass = async () => c2.query(`insert into public.calendar_commitments (user_id,label,kind,starts_at,ends_at,is_protected,status) values ($1,'Added class','class',$2,$3,true,'active')`, [sx.id, await at(to, '10:30'), await at(to, '12:00')])
      const conf = () => confirm(c1, sx.id, px).catch(e => ({ err: e.message }))
      await Promise.all(i % 2 ? [conf(), wait(lag).then(addClass)] : [addClass(), wait(lag).then(conf)])
      const x = await row(tx), moved = x.d === await dateOf(to)
      // Either the class landed first (the move is stale, nothing moved) or the move landed first (the class was added over a task, which is the
      // existing policy for a commitment that is created later). What can never happen: a move that overlapped an EXISTING class.
      const stat = await one(a, 'select status from public.coach_proposals where id=$1', [px])
      ok(`class/confirm race ${i + 1}: ${stat}, ${moved ? 'moved before the class' : 'refused'}`, (stat === 'executed' && moved) || (stat === 'stale' && !moved), `${stat} ${x.d}`)
    }
    {
      const sx = await student(), t1 = await task(sx, { offset: 1 }), t2 = await task(sx, { offset: 1 }), [c1, c2] = [await conn(), await conn()]
      const p1 = await propose(sx, t1, 4, await at(4, '12:00')), p2 = await propose(sx, t2, 4, await at(4, '12:00'))
      const res = await Promise.all([confirm(c1, sx.id, p1).catch(e => ({ err: e.message })), confirm(c2, sx.id, p2).catch(e => ({ err: e.message }))])
      const placed = (await a.query("select count(*) from public.plan_blocks where user_id=$1 and starts_at = $2", [sx.id, await at(4, '12:00')])).rows[0].count
      ok('two simultaneous moves into one free slot: exactly one lands, the other is stale', Number(placed) === 1 && res.filter(x => x.ok).length === 1 && res.filter(x => x.code === 'STALE' && x.reason === 'slot_taken').length === 1, JSON.stringify(res))
    }

    console.log('\nRollback')
    {
      const sx = await student(), tx = await task(sx, { offset: 1 }), px = await propose(sx, tx, 5, await at(5, '13:00'))
      await a.query(`create or replace function public.tm_fail_${tag}() returns trigger language plpgsql as $$ begin if new.task_id = '${tx}' then raise exception 'forced failure'; end if; return new; end $$`)
      await a.query(`create trigger tm_fail_${tag} before insert on public.task_events for each row execute function public.tm_fail_${tag}()`)
      try {
        const failed = await confirm(a, sx.id, px).then(() => false, () => true), x = await row(tx)
        ok('an event failure rolls back the task update and the proposal outcome together', failed && x.revision === 1 && x.d === await dateOf(1) && (await one(a, 'select status from public.coach_proposals where id=$1', [px])) === 'pending')
        const rc = await a.query('select public.apply_task_move($1,$2,1,$3::date,null,30,false,$4) r', [sx.id, tx, await dateOf(5), 'calendar']).then(() => false, () => true)
        ok('the Calendar path rolls back the same way', rc && (await row(tx)).d === await dateOf(1))
      } finally { await a.query(`drop trigger if exists tm_fail_${tag} on public.task_events`); await a.query(`drop function if exists public.tm_fail_${tag}()`) }
      const foreign = await task(s, { offset: 1 }), pf = await propose(sx, foreign, 5, await at(5, '13:00'))
      const rf = await confirm(a, sx.id, pf)
      ok("a proposal naming another student's task is stale and writes nothing", rf.code === 'STALE' && (await row(foreign)).d === await dateOf(1) && (await events(foreign)) === 0)
    }
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    await cleanup(); await a.end()
  }
  console.log(`${n} passed, 0 failed`)
  async function cleanup() {
    await a.query('delete from public.coach_proposals where user_id = any($1)', [users]); await a.query('delete from public.task_events where user_id = any($1)', [users])
    await a.query('delete from public.profiles where id = any($1)', [users]); await a.query('delete from auth.users where id = any($1)', [users])
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
