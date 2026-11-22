/** Isolated full-schema rehearsal. Uses its own loopback Postgres and never reads app credentials. */
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { Client } = require('pg')
const pg = require('./beta/local-pg.cjs')
const { installBaseline } = require('./beta/install.cjs')
const { readMigrations, transactionalSql } = require('./lib/migrations.cjs')

async function main() {
  const dir = pg.tmp()
  const port = await new Promise(resolve => {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
  })
  const clients = []
  let passed = 0
  const connect = async () => {
    const c = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', statement_timeout: 10000 })
    await c.connect(); clients.push(c); return c
  }
  const check = async (name, fn) => { await fn(); passed++; console.log(`  ✓ ${name}`) }
  pg.start(dir, port)
  try {
    const db = await connect()
    await db.query(fs.readFileSync(path.join(__dirname, '../supabase/baseline/local-supabase-stub.sql'), 'utf8'))
    const manifest = await installBaseline(db)
    for (const f of readMigrations(path.join(__dirname, '../supabase/migrations')).filter(f => !manifest.covers.some(c => c.version === f.version))) {
      await db.query('begin')
      try { await db.query(transactionalSql(f.sql)); await db.query('commit') } catch (e) { await db.query('rollback'); throw e }
    }
    const scalar = async (sql, args) => Object.values((await db.query(sql, args)).rows[0])[0]
    const today = await scalar('select current_date::text')
    const tomorrow = await scalar("select (current_date+1)::text")
    const user = async (verified = true, complete = true) => {
      const uid = randomUUID()
      await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)', [uid, `${uid}@example.com`, verified ? new Date() : null])
      if (complete) await db.query("update public.profiles set onboarding_status='complete',timezone='UTC',max_session_minutes=60,week_availability_mode='windows' where id=$1", [uid])
      return uid
    }
    const fixture = async (uid = null, date = tomorrow) => {
      uid ??= await user()
      const cycle = await scalar("insert into public.planning_cycles(user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone) values($1,now(),now()+interval '7 days',current_date,current_date+6,'UTC') returning id", [uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,d,'09:00','23:59' from generate_series(0,6) d", [uid])
      const hash = await scalar('select public.current_week_source_hash($1,$2)', [uid, cycle])
      const draft = await scalar(`insert into public.plan_drafts(user_id,cycle_id,purpose,status,revision,context_fingerprint,onboarding_context_version,cycle_start_date,cycle_end_date,timezone,draft_json)
        select $1,$2,'current_week_plan','ready',1,$3,onboarding_context_version,current_date,current_date+6,'UTC',$4::jsonb from public.profiles where id=$1 returning id`,
      [uid, cycle, hash, JSON.stringify({ planning_date: today, tasks: [{ id: randomUUID(), title: 'Study fixture', duration_minutes: 30, scheduled_date: date, metadata: { task_type: 'study' } }] })])
      return { uid, cycle, draft }
    }
    const command = async (f, name = 'accept_current_week_plan', c = db) => {
      await c.query('begin')
      try {
        await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: f.uid, role: 'authenticated' })])
        await c.query('set local role authenticated')
        const r = await c.query(`select public.${name}($1,1) as r`, [f.draft])
        await c.query('commit'); return r.rows[0].r
      } catch (e) { await c.query('rollback'); throw e }
    }
    await check('fresh signup succeeds with no application projection setting', async () => assert.ok(await user()))
    await check('closing snapshot uses class boundary and preserves an accepted cycle', async () => {
      const uid = await user()
      assert.equal(await scalar('select public.derived_week_closing_day($1)', [uid]), 0)
      await db.query(`insert into public.calendar_commitments(user_id,label,kind,recurrence,weekdays,start_time,end_time,starts_at,ends_at)
        values($1,'Classes','class','weekly',array[2,4],'18:00','20:00',now(),now()+interval '2 hours')`, [uid])
      assert.equal(await scalar('select public.derived_week_closing_day($1)', [uid]), 1)
      await db.query(`insert into public.planning_cycles(user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone)
        values($1,now(),now()+interval '7 days',current_date,current_date+6,'UTC')`, [uid])
      assert.equal(await scalar('select public.derived_week_closing_day($1)', [uid]), await scalar('select extract(dow from current_date+6)::int'))
      assert.match(await scalar("select pg_get_functiondef('public.onboarding_commit_step(uuid,text,jsonb)'::regprocedure)"), /diagnostic_day=public.derived_week_closing_day/)
    })
    await check('unknown and unverified users cannot invoke acceptance directly', async () => {
      for (const [verified, complete] of [[false, true], [true, false]]) {
        const f = await fixture(await user(verified, complete))
        await assert.rejects(command(f), /Application access required/)
      }
    })
    await check('another student cannot accept or dismiss the owner’s proposal', async () => {
      const f = await fixture(); const other = { ...f, uid: await user() }
      await assert.rejects(command(other), /Unauthorized/)
      assert.equal((await command(other, 'dismiss_current_week_plan')).code, 'NOT_FOUND')
    })
    await check('repeated acceptance returns the saved receipt and adds one task', async () => {
      const f = await fixture(); const a = await command(f); const b = await command(f)
      assert.equal(a.tasks_added, 1); assert.equal(b.tasks_added, 1)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where cycle_id=$1', [f.cycle]), 1)
    })
    await check('dismissal retries distinguish an already dismissed proposal', async () => {
      const f = await fixture()
      assert.equal((await command(f, 'dismiss_current_week_plan')).outcome, 'dismissed')
      assert.equal((await command(f, 'dismiss_current_week_plan')).outcome, 'already_dismissed')
      await assert.rejects(command(f), /STALE_PROPOSAL/)
    })
    await check('dismiss after acceptance returns the acceptance receipt', async () => {
      const f = await fixture(); await command(f)
      const r = await command(f, 'dismiss_current_week_plan')
      assert.equal(r.outcome, 'accepted'); assert.equal(r.receipt.tasks_added, 1)
    })
    const commitment = async f => scalar(`insert into public.calendar_commitments(user_id,label,kind,recurrence,weekdays,start_time,end_time,starts_at,ends_at)
      values($1,'Class','class','weekly',array[extract(dow from $2::date)::smallint],'09:00','10:00',$2::date::timestamp,($2::date::timestamp+interval '1 hour')) returning id`, [f.uid, tomorrow])
    const stamp = async f => db.query('update public.plan_drafts set context_fingerprint=public.current_week_source_hash($1,$2) where id=$3', [f.uid, f.cycle, f.draft])
    await check('commitment exceptions and recurrence-end changes invalidate a preview', async () => {
      const f = await fixture(); const id = await commitment(f); await stamp(f)
      await db.query("insert into public.commitment_exceptions(user_id,commitment_id,occurrence_date,kind) values($1,$2,$3,'skipped')", [f.uid, id, tomorrow])
      await assert.rejects(command(f), /STALE_PROPOSAL/)
      await stamp(f); await db.query('update public.calendar_commitments set ends_on=current_date where id=$1', [id])
      await assert.rejects(command(f), /STALE_PROPOSAL/)
    })
    await check('capacity counts overlapping windows once and respects skips and recurrence bounds', async () => {
      const f = await fixture(); const id = await commitment(f)
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','11:00'),('10:00','12:00')) v(s,e)", [f.uid, tomorrow])
      const capacity = () => scalar("select public.current_week_available_minutes($1,$2,'UTC',current_date::timestamptz)", [f.uid, tomorrow])
      assert.equal(await capacity(), 120)
      await db.query("insert into public.commitment_exceptions(user_id,commitment_id,occurrence_date,kind) values($1,$2,$3,'skipped')", [f.uid, id, tomorrow])
      assert.equal(await capacity(), 180)
      await db.query('delete from public.commitment_exceptions where commitment_id=$1', [id])
      await db.query('update public.calendar_commitments set ends_on=current_date where id=$1', [id])
      assert.equal(await capacity(), 180)
    })
    await check('a proposal becomes invalid when its study windows pass within the same day', async () => {
      const f = await fixture(null, today)
      await db.query("update public.availability_windows set start_time='09:00',end_time='10:00' where user_id=$1", [f.uid]); await stamp(f)
      assert.equal(await scalar("select public.current_week_proposal_problem($1,$2,($3::date+time '08:00') at time zone 'UTC')", [f.uid, f.draft, today]), null)
      assert.equal(await scalar("select public.current_week_proposal_problem($1,$2,($3::date+time '11:00') at time zone 'UTC')", [f.uid, f.draft, today]), 'STALE_PROPOSAL')
    })
    await check('out-of-cycle tasks refuse the whole plan', async () => {
      const f = await fixture()
      await db.query("update public.plan_drafts set draft_json=jsonb_set(draft_json,'{tasks,0,scheduled_date}',to_jsonb((current_date+10)::text)) where id=$1", [f.draft])
      await assert.rejects(command(f), /INVALID_PROPOSAL/)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where cycle_id=$1', [f.cycle]), 0)
    })
    await check('a writer holding the input lock makes acceptance wait and then refuse stale work', async () => {
      const f = await fixture(); const id = await commitment(f); await stamp(f)
      const writer = await connect(); const reader = await connect()
      await writer.query('begin'); await writer.query("update public.calendar_commitments set ends_on=current_date where id=$1", [id])
      const pending = command(f, 'accept_current_week_plan', reader).then(r => ({ r }), e => ({ error: e.message }))
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.ok((await db.query('select wait_event_type from pg_stat_activity where pid=$1', [reader.processID])).rows.some(r => r.wait_event_type === 'Lock'))
      await writer.query('commit')
      assert.match((await pending).error, /STALE_PROPOSAL/)
    })
    await check('acceptance holding the input lock queues later edits until the plan commits', async () => {
      const f = await fixture(); const id = await commitment(f); await stamp(f)
      const a = await connect(); const writer = await connect()
      await a.query('begin'); await a.query('select public.scope_lock($1)', [f.uid])
      const pending = writer.query('update public.calendar_commitments set ends_on=current_date where id=$1', [id])
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal((await db.query('select wait_event_type from pg_stat_activity where pid=$1', [writer.processID])).rows[0].wait_event_type, 'Lock')
      await a.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: f.uid, role: 'authenticated' })]); await a.query('set local role authenticated')
      assert.equal((await a.query('select public.accept_current_week_plan($1,1) r', [f.draft])).rows[0].r.tasks_added, 1)
      await a.query('commit'); await pending
    })
    await check('profile patches are restricted and preserve omitted settings', async () => {
      const uid = await user()
      await db.query("update public.profiles set prep_mode='self_study' where id=$1", [uid])
      await db.query('select public.update_planning_profile($1,$2)', [uid, JSON.stringify({ display_name: 'Fixture', max_session_minutes: 45 })])
      assert.equal(await scalar('select max_session_minutes from public.profiles where id=$1', [uid]), 45)
      assert.equal(await scalar('select prep_mode from public.profiles where id=$1', [uid]), 'self_study')
      await assert.rejects(db.query('select public.update_planning_profile($1,$2)', [uid, JSON.stringify({ onboarding_status: 'complete' })]), /Invalid profile patch/)
      assert.equal(await scalar("select has_function_privilege('authenticated','public.update_planning_profile(uuid,jsonb)','execute')"), false)
    })
    await check('a profile edit makes acceptance wait, then refuse its stale preview', async () => {
      const f = await fixture(); const writer = await connect(); const reader = await connect()
      await writer.query('begin'); await writer.query('select public.update_planning_profile($1,$2)', [f.uid, JSON.stringify({ max_session_minutes: 45 })])
      const pending = command(f, 'accept_current_week_plan', reader).then(r => ({ r }), e => ({ error: e.message }))
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal((await db.query('select wait_event_type from pg_stat_activity where pid=$1', [reader.processID])).rows[0].wait_event_type, 'Lock')
      await writer.query('commit'); assert.match((await pending).error, /STALE_PROPOSAL/)
    })
    await check('a later profile edit queues before taking its row lock, without deadlocking acceptance', async () => {
      const f = await fixture(); const a = await connect(); const writer = await connect()
      await a.query('begin'); await a.query('select public.scope_lock($1)', [f.uid])
      const pending = writer.query('select public.update_planning_profile($1,$2)', [f.uid, JSON.stringify({ max_session_minutes: 45 })])
      await new Promise(resolve => setTimeout(resolve, 100))
      assert.equal((await db.query('select wait_event_type from pg_stat_activity where pid=$1', [writer.processID])).rows[0].wait_event_type, 'Lock')
      await a.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: f.uid, role: 'authenticated' })]); await a.query('set local role authenticated')
      assert.equal((await a.query('select public.accept_current_week_plan($1,1) r', [f.draft])).rows[0].r.tasks_added, 1)
      await a.query('commit'); await pending
    })
    await check('repair, Coach and redistribution commands acquire the planning lock before row locks', async () => {
      const rows = (await db.query("select proname,pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('confirm_coach_proposal','accept_repair_proposal','place_repair_check','start_repair_check','apply_redistribution','reverse_redistribution')")).rows
      assert.equal(rows.length,6)
      for (const row of rows) assert.ok(row.def.indexOf('perform public.scope_lock') < row.def.toLowerCase().indexOf('for update'), row.proname)
      assert.equal(await scalar("select count(*)::int from pg_trigger where tgname='scope_write_lock' and tgrelid='public.repair_threads'::regclass"),1)
    })
    await check('accept and dismiss racing produce one consistent terminal result', async () => {
      const f = await fixture(); const a = await connect(); const b = await connect()
      const r = await Promise.allSettled([command(f, 'accept_current_week_plan', a), command(f, 'dismiss_current_week_plan', b)])
      const status = await scalar('select status from public.plan_drafts where id=$1', [f.draft])
      assert.ok(['accepted', 'discarded'].includes(status))
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where cycle_id=$1', [f.cycle]), status === 'accepted' ? 1 : 0)
      assert.ok(r.some(x => x.status === 'fulfilled'))
    })
    console.log(`\n${passed} passed, 0 failed`)
  } finally {
    for (const c of clients) { await c.query('rollback').catch(() => {}); await c.end().catch(() => {}) }
    pg.stop(dir); fs.rmSync(dir, { recursive: true, force: true })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
