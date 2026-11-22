/** Coach slice 2 on the REAL schema: payload-bound turn keys, lease fencing, the model-call budget, atomic Clear, and the atomic single-task move.
 *  Throwaway students removed by recorded id.   npm run coach:integrity:db:test -- --confirm-target=<project-ref> */
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
  const tag = Date.now().toString(36), users = [], blocks = [], cycles = []
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const as = async (c, uid, sql, p) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return Object.values(r.rows[0] ?? { v: null })[0] } catch (e) { await c.query('ROLLBACK'); throw e }
  }
  const student = async () => {
    const id = await one(a, 'select gen_random_uuid()'); users.push(id)
    await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `ci-${tag}-${users.length}@example.invalid`])
    await a.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [id]); await a.query("update public.profiles set onboarding_status='complete' where id=$1", [id])
    const cyc = await one(a, 'select gen_random_uuid()'); cycles.push(cyc)
    await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days',current_date,current_date+8,'UTC','active')", [cyc, id])
    return { id, cyc }
  }
  const day = async k => (await one(a, `select (current_date + $1::int)::text`, [k]))
  const task = async (s, name, o = {}) => {
    const id = `ci-${tag}-${name}`; blocks.push(id)
    await a.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment,starts_at)
      values ($1,$2,$3,$4,'d','study','planner','core',$5,$6,current_date + $7::int,(current_date + $7::int)::text,30,'30','algorithm',false,$8)`, [id, s.id, s.cyc, `Task ${name}`, o.starts ? 'timed' : 'day_preferred', o.execution ?? 'not_started', o.offset ?? 0, o.starts ?? null])
    return id
  }
  const row = async id => (await a.query('select id, execution, revision, local_date::text d, starts_at, placement from public.plan_blocks where id=$1', [id])).rows[0]
  const moved = id => one(a, "select count(*) from public.task_events where task_id=$1 and event_type='moved'", [id]).then(Number)
  const at = async (offset, hhmm) => (await one(a, `select ((current_date + $1::int)::text || ' ${hhmm}:00+00')::timestamptz`, [offset])).toISOString()
  const propose = async (s, t, to, startsAt, over = {}) => {
    const r = await row(t), id = await one(a, `insert into public.coach_proposals (user_id, intent, kind, title, reasoning, proposed_changes, origin, status, target_cycle_id)
      values ($1,'move_task','move_task','Move','t',$2::jsonb,'coach','pending',$3) returning id`, [s.id, JSON.stringify({ version: 3, move: { id: t, title: t, revision: r.revision, fromDate: r.d, toDate: to, startsAt, startMinutes: null, minutes: 30, ...over } }), s.cyc])
    return id
  }
  const confirm = (c, uid, id) => as(c, uid, 'select public.confirm_coach_move($1) as r', [id])
  const status = id => one(a, 'select status from public.coach_proposals where id=$1', [id])

  // Fixtures of an earlier interrupted run (throwaway domain, this script's prefix only).
  try {
    console.log('\nTurn keys are bound to their payload')
    const u = (await student()).id
    const begin = (c, k, body, hash, lease = 45) => c.query('select public.coach_turn_begin($1,$2,$3,$4,$5,$6,$7) r', [u, k, body, 'free', 40, hash, lease]).then(r => r.rows[0].r)
    const finish = (c, k, tok) => c.query('select public.coach_turn_finish($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [u, k, tok, 'ans', 'free', '[]', null, '[]', '{}']).then(r => r.rows[0].r)
    const key = `c1-${tag}-aaaa`
    const first = await begin(a, key, 'original question', 'hash-original-1')
    const clash = await begin(a, key, 'a different question', 'hash-different-2')
    ok('reusing a key with another payload is a conflict', clash.state === 'conflict')
    ok('the original message is untouched and nothing else was written', (await one(a, "select body from public.coach_messages where user_id=$1 and turn_key=$2 and role='student'", [u, key])) === 'original question' && Number(await one(a, 'select count(*) from public.coach_messages where user_id=$1', [u])) === 1)
    ok('a conflicting key does not disturb the owner', (await finish(a, key, first.token)).replayed === false)
    ok('after the answer the same payload replays', (await begin(a, key, 'original question', 'hash-original-1')).state === 'replay')
    ok('and the other payload still conflicts after the answer', (await begin(a, key, 'x', 'hash-different-2')).state === 'conflict')

    console.log('\nLease, fencing and the model-call budget')
    const k2 = `c2-${tag}-bbbb`, w1 = await begin(a, k2, 'slow question', 'hash-slow-question', 1)
    const res = c => c.query('select public.coach_model_reserve($1,$2,$3,$4) r', [u, k2, w1.token, 3]).then(r => r.rows[0].r)
    const call1 = await res(a)
    ok('the owner can reserve a model request', call1.ok === true)
    await new Promise(r => setTimeout(r, 1300))
    const w2 = await begin(a, k2, 'slow question', 'hash-slow-question', 1)
    ok('after the lease runs out another worker takes over with a new token', w2.state === 'resume' && w2.token && w2.token !== w1.token)
    ok('the in-flight request of the lost worker is recorded as indeterminate', (await one(a, 'select state from public.coach_model_calls where id=$1', [call1.callId])) === 'indeterminate')
    ok('the old worker can no longer reserve', (await res(a)).reason === 'fenced')
    ok('the old worker is fenced at finish: no answer is written', (await finish(a, k2, w1.token)).error === 'FENCED' && Number(await one(a, "select count(*) from public.coach_messages where user_id=$1 and turn_key=$2 and role='coach'", [u, k2])) === 0)
    ok('the new owner finishes once', (await finish(a, k2, w2.token)).replayed === false)

    const u3 = (await student()).id, k3 = `c3-${tag}-cccc`
    const b3 = await a.query('select public.coach_turn_begin($1,$2,$3,$4,$5,$6,$7) r', [u3, k3, 'q', 'free', 40, 'hash-budget-1', 45]).then(r => r.rows[0].r)
    const r3 = () => a.query('select public.coach_model_reserve($1,$2,$3,$4) r', [u3, k3, b3.token, 2]).then(r => r.rows[0].r)
    ok('two reservations fit a budget of two', (await r3()).ok && (await r3()).ok)
    ok('the third is refused: retries and fallbacks count', (await r3()).reason === 'budget')
    await a.query('select public.coach_clear_history($1)', [u3])
    ok('Clear removes the conversation', Number(await one(a, 'select count(*) from public.coach_messages where user_id=$1', [u3])) === 0)
    const b3b = await a.query('select public.coach_turn_begin($1,$2,$3,$4,$5,$6,$7) r', [u3, `c3b-${tag}-dddd`, 'q2', 'free', 40, 'hash-budget-2', 45]).then(r => r.rows[0].r)
    ok('but Clear does not reset the model budget', (await a.query('select public.coach_model_reserve($1,$2,$3,$4) r', [u3, `c3b-${tag}-dddd`, b3b.token, 2]).then(r => r.rows[0].r)).reason === 'budget')
    ok('a turn cleared mid-flight can no longer reserve or finish', (await r3()).reason === 'fenced' && (await a.query('select public.coach_turn_finish($1,$2,$3,$4,$5,$6,$7,$8,$9) r', [u3, k3, b3.token, 'late', 'free', '[]', null, '[]', '{}']).then(r => r.rows[0].r)).error === 'NO_TURN')

    console.log('\nThe single-task move is atomic and uses Calendar rules')
    const s = await student(), t1 = await task(s, 'a'), to = await day(2), slot = await at(2, '18:00')
    const p1 = await propose(s, t1, to, slot)
    const r1 = await confirm(a, s.id, p1), after = await row(t1)
    ok('a reviewed timed placement moves exactly that task, once', r1.ok === true && after.d === to && new Date(after.starts_at).toISOString() === slot && after.placement === 'timed' && after.revision === 2 && (await moved(t1)) === 1, JSON.stringify(r1))
    ok('the receipt says placement, with the real day', r1.receipt.kind === 'placement' && r1.receipt.toDate === to && (await status(p1)) === 'executed')
    const r1b = await confirm(a, s.id, p1)
    ok('a repeat is the same outcome and writes nothing', r1b.ok && r1b.replayed && (await moved(t1)) === 1)

    const t2 = await task(s, 'b'), p2 = await propose(s, t2, to, null)
    ok('a day-only placement keeps no clock time and says so', (await confirm(a, s.id, p2)).ok && (await row(t2)).placement === 'day_preferred' && (await row(t2)).starts_at === null)

    const stale = async (name, id, mutate, reason) => { const before = await row(id), pid = await propose(s, id, to, null); if (mutate) await mutate(); const r = await confirm(a, s.id, pid)
      ok(name, r.ok === false && r.code === 'STALE' && r.reason === reason && (await status(pid)) === 'stale' && (await moved(id)) === 0 && JSON.stringify((await row(id)).d) === JSON.stringify(before.d), JSON.stringify(r)) }
    const t3 = await task(s, 'c'); await stale('a task edited after the preview makes it stale', t3, () => a.query("update public.plan_blocks set title='edited elsewhere' where id=$1", [t3]), 'task_changed')
    const t4 = await task(s, 'd', { execution: 'in_progress' }); await stale('started work is not moved', t4, null, 'task_not_movable')
    const t5 = await task(s, 'e'); await stale('recorded or continued work is not moved', t5, async () => { try { const c2 = await one(a, 'select gen_random_uuid()'); await a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now()+interval '9 days',now()+interval '17 days',current_date+9,current_date+16,'UTC','closed')", [c2, s.id]).catch(() => a.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now()+interval '9 days',now()+interval '17 days',current_date+9,current_date+16,'UTC','closed')", [c2, s.id])); await a.query('BEGIN'); await a.query("select set_config('roadmap.continuation_command','on',true)"); await a.query("insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,continued_from_task_id) values ($1,$2,$3,'next','d','study','planner','core','day_preferred','not_started',current_date+10,(current_date+10)::text,30,'30','algorithm',$4)", [`ci-${tag}-e2`, s.id, c2, t5]); await a.query('COMMIT'); blocks.push(`ci-${tag}-e2`) } catch (e) { await a.query('ROLLBACK'); throw e } }, 'continued')
    const t6 = await task(s, 'f'), pastP = await propose(s, t6, await day(-1), null)
    ok('a past day is refused', (await confirm(a, s.id, pastP)).reason === 'past_day' && (await moved(t6)) === 0)
    const t7 = await task(s, 'g'), farP = await propose(s, t7, await day(30), null)
    ok('a day outside the cycle is refused (the weekly review carries work across)', (await confirm(a, s.id, farP)).reason === 'outside_cycle' && (await moved(t7)) === 0)
    const t8 = await task(s, 'h'), t9 = await task(s, 'i', { offset: 2, starts: await at(2, '18:30') }), clashP = await propose(s, t8, to, slot)
    ok('a slot taken by another timed task since the preview is refused', (await confirm(a, s.id, clashP)).reason === 'slot_taken' && (await moved(t8)) === 0 && t9)
    const t10 = await task(s, 'j'), wrongDay = await propose(s, t10, to, await at(3, '18:00'))
    ok('a start that is not on the previewed day is refused', (await confirm(a, s.id, wrongDay)).reason === 'bad_slot')
    const other = await student(), t11 = await task(s, 'k'), foreign = await propose(s, t11, to, null)
    ok('another student cannot confirm it', (await confirm(a, other.id, foreign)).code === 'NOT_FOUND' && (await moved(t11)) === 0)

    console.log('\nForced failure and races')
    const t12 = await task(s, 'l'), p12 = await propose(s, t12, to, null)
    await a.query(`create or replace function public.ci_fail_${tag}() returns trigger language plpgsql as $$ begin if new.task_id = '${t12}' then raise exception 'forced failure'; end if; return new; end $$`)
    await a.query(`create trigger ci_fail_${tag} before insert on public.task_events for each row execute function public.ci_fail_${tag}()`)
    try {
      const failed = await confirm(a, s.id, p12).then(() => false, () => true), x = await row(t12)
      ok('a failure after the update rolls the whole move back', failed && x.revision === 1 && x.d === (await day(0)) && (await status(p12)) === 'pending' && (await moved(t12)) === 0)
    } finally { await a.query(`drop trigger if exists ci_fail_${tag} on public.task_events`); await a.query(`drop function if exists public.ci_fail_${tag}()`) }

    const t13 = await task(s, 'm'), p13 = await propose(s, t13, to, null), cs = await Promise.all([...Array(6)].map(conn))
    const race = await Promise.all(cs.map(c => confirm(c, s.id, p13).catch(e => ({ ok: false, err: e.message }))))
    ok('six concurrent confirmations produce one move and one event', race.every(r => r.ok) && race.filter(r => !r.replayed).length === 1 && (await moved(t13)) === 1)

    // Confirm vs a concurrent edit of the same task: either the edit lands first (stale, no move) or the move lands first; never a move of an edited task.
    for (let i = 0; i < 4; i++) {
      const t = await task(s, `n${i}`), p = await propose(s, t, to, null), [c1, c2] = [await conn(), await conn()]
      const wait = ms => new Promise(r => setTimeout(r, ms)), lag = [0, 10, 120, 300][i], edit = () => c2.query("update public.plan_blocks set title='edited' where id=$1", [t]), conf = () => confirm(c1, s.id, p).catch(() => null)
      await Promise.all(i < 2 ? [conf(), wait(lag).then(edit)] : [edit(), wait(lag).then(conf)])
      const st = await status(p), x = await row(t)
      ok(`edit/confirm race ${i + 1}: ${st}, consistent`, (st === 'executed' && x.d === to && (await moved(t)) === 1) || (st === 'stale' && x.d !== to && (await moved(t)) === 0), `${st} ${x.d}`)
    }

    // Confirm vs Clear, both orders in parallel: an executed proposal is retained; a cleared one never moved anything.
    for (let i = 0; i < 6; i++) {
      const sx = await student(), t = await task(sx, `r${i}`), p = await propose(sx, t, to, null), [c1, c2] = [await conn(), await conn()]
      const wait = ms => new Promise(r => setTimeout(r, ms)), lag = [0, 10, 25, 60, 120, 250][i]
      const conf = () => confirm(c1, sx.id, p).catch(() => null), clr = () => c2.query('select public.coach_clear_history($1)', [sx.id])
      await Promise.all(i % 2 ? [conf(), wait(lag).then(clr)] : [clr(), wait(lag).then(conf)])
      const st = await status(p), x = await row(t)
      ok(`confirm/clear race ${i + 1}: ${st}, consistent`, (st === 'executed' && x.d === to && (await moved(t)) === 1) || (st === 'rejected' && x.d !== to && (await moved(t)) === 0), `${st} ${x.d}`)
    }
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    await cleanup(); await a.end()
  }
  console.log(`${n} passed, 0 failed`)
  async function cleanup() {
    await a.query('delete from public.coach_model_calls where user_id = any($1)', [users]); await a.query('delete from public.coach_proposals where user_id = any($1)', [users]); await a.query('delete from public.coach_messages where user_id = any($1)', [users])
    await a.query('delete from public.task_events where user_id = any($1)', [users])   // plan blocks and cycles go with the profile (a nested cascade is the one deletion the continuation guard allows)
    await a.query('delete from public.profiles where id = any($1)', [users]); await a.query('delete from auth.users where id = any($1)', [users])
  }
}
main().catch(e => { console.error(e.message ?? e); process.exit(1) })
