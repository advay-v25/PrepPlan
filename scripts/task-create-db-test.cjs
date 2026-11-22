/** apply_task_create, on the real schema: task + history in one transaction, replay per key, system types refused, protected time and cycle bounds,
 *  a same-key race, and rollback. Throwaway students removed by recorded id.   node scripts/task-create-db-test.cjs --confirm-target=<project-ref> */
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
  const at = async (offset, hhmm) => (await one(a, `select ((current_date + $1::int)::text || ' ${hhmm}:00+00')::timestamptz`, [offset])).toISOString()
  const dateOf = off => one(a, 'select (current_date + $1::int)::text', [off])
  const uuid = () => one(a, 'select gen_random_uuid()')
  const mkId = async () => `task-${await uuid()}`
  const create = (c, s, id, o = {}) => dateOf(o.off ?? 1).then(d => c.query('select public.apply_task_create($1,$2,$3,$9,$4,$5,$6::date,$7,$8) r', [s.id, id, o.title ?? 'My task', o.type ?? 'study', o.priority ?? 'core', d, o.starts ?? null, o.mins ?? 45, o.detail ?? null]).then(r => r.rows[0].r))
  const count = (id) => one(a, 'select count(*) from public.plan_blocks where id=$1', [id]).then(Number)
  const events = (id) => one(a, "select count(*) from public.task_events where task_id=$1 and event_type='created'", [id]).then(Number)
  try {
    const s = await student(), s2 = await student()
    let id = await mkId(), r = await create(a, s, id)
    ok('creates the task and its history together', r.ok && !r.replayed && await count(id) === 1 && await events(id) === 1 && r.task.origin === 'student' && r.task.execution === 'not_started')
    r = await create(a, s, id)
    ok('the same request replays: still one task, one event', r.ok && r.replayed && await count(id) === 1 && await events(id) === 1)
    ok('a different request under the same key is refused, nothing changed', (await create(a, s, id, { title: 'Other' })).code === 'KEY_REUSED' && await count(id) === 1)
    ok("another student cannot reuse or read this key", (await create(a, s2, id)).code === 'KEY_REUSED' && await count(id) === 1)
    for (const type of ['repair', 'recheck', 'mock', 'diagnostic']) { const i = await mkId(); ok(`system type "${type}" is refused`, (await create(a, s, i, { type })).code === 'BAD_TYPE' && await count(i) === 0) }
    for (const type of ['review', 'admin', 'other']) { const i = await mkId(); ok(`ordinary type "${type}" is allowed`, (await create(a, s, i, { type })).ok) }
    ok('a malformed key is refused', (await create(a, s, 'task-1')).code === 'BAD_KEY')
    ok('a one-letter title is refused', (await create(a, s, await mkId(), { title: 'x' })).code === 'BAD_TITLE')
    ok('an absurd duration is refused', (await create(a, s, await mkId(), { mins: 3 })).code === 'BAD_DURATION' && (await create(a, s, await mkId(), { mins: 400 })).code === 'BAD_DURATION')
    id = await mkId()
    ok('outside the cycle is refused', (await create(a, s, id, { off: 40 })).code === 'OUTSIDE_CYCLE' && await count(id) === 0)
    id = await mkId()
    ok('a slot whose day does not match is refused', (await create(a, s, id, { off: 2, starts: await at(3, '10:00') })).code === 'BAD_SLOT')
    await a.query(`insert into public.calendar_commitments (user_id,label,kind,starts_at,ends_at,is_protected,status) values ($1,'Lecture','class',$2,$3,true,'active')`, [s.id, await at(4, '09:00'), await at(4, '10:00')])
    id = await mkId(); r = await create(a, s, id, { off: 4, starts: await at(4, '09:30') })
    ok('a protected class refuses a timed task and writes nothing', r.code === 'PROTECTED' && r.title === 'Lecture' && await count(id) === 0 && await events(id) === 0)
    ok('adjacent to the class is allowed', (await create(a, s, await mkId(), { off: 4, starts: await at(4, '10:00') })).ok)

    const sx = await student(), rid = await mkId()
    await a.query(`create or replace function public.tc_fail_${tag}() returns trigger language plpgsql as $$ begin if new.task_id = '${rid}' then raise exception 'forced failure'; end if; return new; end $$`)
    await a.query(`create trigger tc_fail_${tag} before insert on public.task_events for each row execute function public.tc_fail_${tag}()`)
    try {
      const failed = await create(a, sx, rid).then(() => false, () => true)
      ok('a history failure rolls the task back too (no task without history)', failed && await count(rid) === 0)
    } finally { await a.query(`drop trigger if exists tc_fail_${tag} on public.task_events`); await a.query(`drop function if exists public.tc_fail_${tag}()`) }
    ok('after the failure the same key then succeeds once', (await create(a, sx, rid)).ok && await count(rid) === 1 && await events(rid) === 1)

    // Receipt contract: the key is bound to the whole original request, and its result outlives later changes to the task.
    const sd = await student(), rk = await mkId(); r = await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })
    ok('the receipt stores the original request', r.ok && Number(await one(a, 'select count(*) from public.task_create_receipts where key=$1 and user_id=$2', [rk, sd.id])) === 1)
    ok('detail-only change under the same key is refused, nothing written', (await create(a, sd, rk, { detail: 'Read ch 4', priority: 'optional', off: 2, starts: await at(2, '14:00') })).code === 'KEY_REUSED' && await count(rk) === 1 && await events(rk) === 1)
    ok('priority-only change under the same key is refused', (await create(a, sd, rk, { detail: 'Read ch 3', priority: 'core', off: 2, starts: await at(2, '14:00') })).code === 'KEY_REUSED')
    ok('a different time under the same key is refused', (await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '15:00') })).code === 'KEY_REUSED')
    await a.query("update public.plan_blocks set title='Edited', local_date=local_date+1, day=(local_date+1)::text, execution='completed' where id=$1", [rk])
    r = await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })
    ok('a replay after the task was edited and completed returns the ORIGINAL result and changes nothing', r.ok && r.replayed && r.task.title === 'My task' && r.current.title === 'Edited' && r.current.execution === 'completed' && await events(rk) === 1)
    await a.query("update public.plan_blocks set cancelled_at=now() where id=$1", [rk])
    ok('a replay after cancellation does not revive or recreate it', (await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })).replayed === true && Number(await one(a, 'select count(*) from public.plan_blocks where id=$1 and cancelled_at is not null', [rk])) === 1)
    await a.query('delete from public.plan_blocks where id=$1', [rk])
    r = await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })
    ok('a replay after the task row is deleted still replays (current is null) and never recreates the work', r.ok && r.replayed && r.current === null && await count(rk) === 0)
    await a.query(`insert into public.calendar_commitments (user_id,label,kind,starts_at,ends_at,is_protected,status) values ($1,'Late booking','class',$2,$3,true,'active')`, [sd.id, await at(2, '14:00'), await at(2, '15:00')])
    ok('a booking added later does not break a replay', (await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })).replayed === true)
    ok('but a NEW key over that booking is refused', (await create(a, sd, await mkId(), { off: 2, starts: await at(2, '14:30') })).code === 'PROTECTED')
    await a.query("update public.planning_cycles set status='closed' where id=$1", [sd.cyc])
    ok('a replay after the cycle closed still replays', (await create(a, sd, rk, { detail: 'Read ch 3', priority: 'optional', off: 2, starts: await at(2, '14:00') })).replayed === true)
    id = await mkId(); r = await create(a, sd, id)
    ok('with no active cycle a new task is refused (NO_CYCLE), no orphan row', r.code === 'NO_CYCLE' && await count(id) === 0 && await events(id) === 0)
    const sp = await student(); id = await mkId(); r = await create(a, sp, id, { off: -1 })
    ok('a past day is refused in the database too (student time zone)', r.code === 'PAST' && await count(id) === 0)
    const sl = await student(), lk = await mkId(); await create(a, sl, lk); await a.query('delete from public.task_create_receipts where key=$1', [lk])
    r = await create(a, sl, lk)
    ok('a task with no stored receipt gets an honest NO_RECEIPT, not a guessed match', r.code === 'NO_RECEIPT' && r.current.id === lk && await count(lk) === 1 && await events(lk) === 1)
    const sf = await student(), fk = await mkId()
    await a.query(`create or replace function public.tc_rfail_${tag}() returns trigger language plpgsql as $$ begin if new.key = '${fk}' then raise exception 'forced receipt failure'; end if; return new; end $$`)
    await a.query(`create trigger tc_rfail_${tag} before insert on public.task_create_receipts for each row execute function public.tc_rfail_${tag}()`)
    try {
      ok('a receipt failure rolls back the task and its history', await create(a, sf, fk).then(() => false, () => true) && await count(fk) === 0 && await events(fk) === 0)
    } finally { await a.query(`drop trigger if exists tc_rfail_${tag} on public.task_create_receipts`); await a.query(`drop function if exists public.tc_rfail_${tag}()`) }
    ok('after that failure the same key then succeeds with one of each', (await create(a, sf, fk)).ok && await count(fk) === 1 && await events(fk) === 1)

    const sr = await student(), race = await mkId(), [c1, c2] = [await conn(), await conn()]
    const both = await Promise.all([create(c1, sr, race).catch(e => ({ err: e.message })), create(c2, sr, race).catch(e => ({ err: e.message }))])
    ok('two simultaneous identical requests make exactly one task and one event', await count(race) === 1 && await events(race) === 1 && both.every(x => x.ok) && both.filter(x => x.replayed).length === 1, JSON.stringify(both.map(x => x.ok ?? x.err)))
    const acl = (await a.query("select has_function_privilege('authenticated','public.apply_task_create(uuid,text,text,text,text,text,date,timestamptz,int)','execute') a, has_function_privilege('anon','public.apply_task_create(uuid,text,text,text,text,text,date,timestamptz,int)','execute') n, has_function_privilege('service_role','public.apply_task_create(uuid,text,text,text,text,text,date,timestamptz,int)','execute') s")).rows[0]
    ok('only the service role may call it (a signed-in student cannot create for someone else)', !acl.a && !acl.n && acl.s)
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    await cleanup(); await a.end()
  }
  console.log(`${n} passed, 0 failed`)
  async function cleanup() {
    await a.query('delete from public.task_events where user_id = any($1)', [users])
    await a.query('delete from public.profiles where id = any($1)', [users]); await a.query('delete from auth.users where id = any($1)', [users])
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
