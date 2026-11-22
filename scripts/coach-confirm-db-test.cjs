/** Phase 4 proof on the REAL development schema: a confirmed Coach proposal is ONE transaction. Throwaway students; every row removed by recorded id.
 *  npm run coach:db:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: deadline reached (fixtures may remain; re-run to clean).'); process.exit(2) }, 150000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const a = mk(); await a.connect(); const pool = []; let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36), users = [], proposals = [], blocks = [], cycles = []
  const today = new Date().toISOString().slice(0, 10)
  const as = async (c, uid, sql, p) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return Object.values(r.rows[0] ?? { v: null })[0] } catch (e) { await c.query('ROLLBACK'); throw e }
  }
  const confirm = (c, uid, id) => as(c, uid, 'select public.confirm_coach_proposal($1) as r', [id])
  const student = async () => {
    const id = await one(a, 'select gen_random_uuid()'); users.push(id)
    await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `cc-${tag}-${users.length}@example.invalid`])
    await a.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [id]); await a.query("update public.profiles set onboarding_status='complete' where id=$1", [id])
    const cyc = await one(a, 'select gen_random_uuid()'); cycles.push(cyc)
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, id])
    return { id, cyc }
  }
  const task = async (s, name, o = {}) => {
    const id = `cc-${tag}-${name}`; blocks.push(id)
    await a.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment)
      values ($1,$2,$3,$4,'d','study','planner','core','day_preferred',$5,$6::date,$6::text,30,'30','algorithm',$7)`, [id, s.id, s.cyc, `Task ${name}`, o.execution ?? 'not_started', o.date ?? today, o.protected ?? false])
    return id
  }
  const state = async ids => (await a.query('select id, execution, revision from public.plan_blocks where id = any($1) order by id', [ids])).rows
  const events = ids => one(a, "select count(*) from public.task_events where task_id = any($1) and event_type = 'deferred'", [ids]).then(Number)
  const propose = async (s, moves, extra = {}) => {
    const id = await one(a, `insert into public.coach_proposals (user_id, intent, kind, title, reasoning, proposed_changes, origin, status, target_cycle_id)
      values ($1,'defer_today','defer_today','Move tasks','test',$2::jsonb,'coach','pending',$3) returning id`, [s.id, JSON.stringify(extra.changes ?? { version: 2, moves, staysDue: [], waiting: 0 }), s.cyc]); proposals.push(id); return id
  }
  const mv = async ids => Promise.all(ids.map(async id => { const r = (await state([id]))[0]; return { id, title: id, revision: r.revision, date: today, minutes: 30 } }))
  const status = id => one(a, 'select status from public.coach_proposals where id=$1', [id])

  try {
    console.log('\nConfirmed Coach changes are atomic')
    const s = await student(), other = await student()
    const t = [await task(s, 'a'), await task(s, 'b'), await task(s, 'c')], bystander = await task(s, 'z')
    const p1 = await propose(s, await mv(t))
    const before = await state([bystander])
    const r1 = await confirm(a, s.id, p1)
    ok('a reviewed multi-task proposal applies exactly its three tasks', r1.ok === true && r1.applied === 3 && (await state(t)).every(x => x.execution === 'deferred' && x.revision === 2), JSON.stringify(r1))
    ok('with one history event per task and a receipt on the proposal', (await events(t)) === 3 && (await status(p1)) === 'executed' && (await one(a, "select jsonb_array_length(proposed_changes->'receipt'->'events') from public.coach_proposals where id=$1", [p1])) === 3)
    ok('an unrelated task is untouched', JSON.stringify(await state([bystander])) === JSON.stringify(before))
    const r1b = await confirm(a, s.id, p1)
    ok('a repeat returns the same outcome and writes nothing', r1b.ok && r1b.replayed === true && r1b.applied === 3 && (await events(t)) === 3)

    const t2 = [await task(s, 'd'), await task(s, 'e'), await task(s, 'f')], p2 = await propose(s, await mv(t2))
    const cs = await Promise.all(Array.from({ length: 8 }, async () => { const c = mk(); await c.connect(); pool.push(c); return c }))
    const race = await Promise.all(cs.map(c => confirm(c, s.id, p2).catch(e => ({ ok: false, err: e.message }))))
    ok('eight concurrent confirmations produce one set of changes and one receipt', race.every(r => r.ok) && race.filter(r => !r.replayed).length === 1 && (await events(t2)) === 3 && (await state(t2)).every(x => x.revision === 2), JSON.stringify(race.map(r => r.replayed)))

    console.log('\nStale, protected and started work leaves the week untouched')
    const t3 = [await task(s, 'g'), await task(s, 'h')], reviewed = await mv(t3), p3 = await propose(s, reviewed)
    await a.query("update public.plan_blocks set title = 'edited elsewhere', duration_minutes = 45 where id = $1", [t3[1]])   // another device edits the second task after the preview
    const r3 = await confirm(a, s.id, p3)
    ok('a task edited after the preview makes the whole proposal stale', r3.ok === false && r3.code === 'STALE' && (await state(t3)).every(x => x.execution === 'not_started') && (await events(t3)) === 0 && (await status(p3)) === 'stale', JSON.stringify(r3))
    const t4 = [await task(s, 'i'), await task(s, 'j', { execution: 'in_progress' })], p4 = await propose(s, await mv(t4))
    ok('started work cannot be moved by a proposal; nothing else moves either', (await confirm(a, s.id, p4)).code === 'STALE' && (await state(t4))[0].execution === 'not_started' && (await events(t4)) === 0)
    const t5 = [await task(s, 'k'), await task(s, 'l', { protected: true })], p5 = await propose(s, await mv(t5))
    ok('a protected commitment cannot be moved', (await confirm(a, s.id, p5)).code === 'STALE' && (await events(t5)) === 0)
    const t6 = [await task(s, 'm')], mvs = await mv(t6); mvs[0].date = '2001-01-01'
    ok('a task on a different day than reviewed is refused', (await confirm(a, s.id, await propose(s, mvs))).code === 'STALE' && (await events(t6)) === 0)
    const p7 = await propose(s, [], { changes: { moves: [{ id: t6[0], revision: 1 }] } })
    ok('an older proposal that never carried reviewed dates is refused, not guessed', (await confirm(a, s.id, p7)).code === 'STALE' && (await events(t6)) === 0)

    console.log('\nA forced failure midway rolls back the whole proposal')
    const t8 = [await task(s, 'n'), await task(s, 'o'), await task(s, 'p')], p8 = await propose(s, await mv(t8))
    await a.query(`create or replace function public.fx_cc_fail() returns trigger language plpgsql as $$ begin if new.task_id = '${t8[2]}' and new.event_type = 'deferred' then raise exception 'forced failure on the third task'; end if; return new; end $$`)
    await a.query('create trigger fx_cc_fail before insert on public.task_events for each row execute function public.fx_cc_fail()')
    let failed = false; try { await confirm(a, s.id, p8) } catch (e) { failed = /forced failure/.test(e.message) }
    await a.query('drop trigger if exists fx_cc_fail on public.task_events'); await a.query('drop function if exists public.fx_cc_fail()')
    ok('the failure surfaces, and no task, event or receipt remains', failed && (await state(t8)).every(x => x.execution === 'not_started' && x.revision === 1) && (await events(t8)) === 0 && (await status(p8)) === 'pending')
    ok('after the fault is gone the same proposal confirms', (await confirm(a, s.id, p8)).ok === true && (await events(t8)) === 3)

    console.log('\nOwnership')
    const t9 = [await task(s, 'q')], p9 = await propose(s, await mv(t9))
    ok('another student cannot confirm it', (await confirm(a, other.id, p9)).code === 'NOT_FOUND' && (await events(t9)) === 0 && (await status(p9)) === 'pending')
    ok('and cannot see or change its tasks through it', (await state(t9))[0].execution === 'not_started')
    console.log(`\n${n} passed, 0 failed\n`)
  } finally {
    await a.query('drop trigger if exists fx_cc_fail on public.task_events').catch(() => {}); await a.query('drop function if exists public.fx_cc_fail()').catch(() => {})
    for (const c of pool) await c.end().catch(() => {})
    const run = (sql, p) => a.query(sql, p).catch(e => console.error('cleanup:', e.message))
    await run('delete from public.task_execution_commands where task_id = any($1)', [blocks]); await run('delete from public.task_events where task_id = any($1)', [blocks])
    await run('delete from public.coach_proposals where id = any($1)', [proposals]); await run('delete from public.plan_blocks where id = any($1)', [blocks])
    await run('delete from public.planning_cycles where id = any($1)', [cycles]); await run('delete from public.profiles where id = any($1)', [users]); await run('delete from auth.users where id = any($1)', [users])
    await a.end()
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
