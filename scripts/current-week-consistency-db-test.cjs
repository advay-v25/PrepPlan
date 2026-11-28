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
    const c = new Client({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', statement_timeout: 10000, options: '-c timezone=UTC' })
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
    await check('fit is judged against contiguous gaps, not the day total: 45 minutes does not fit two 30-minute gaps, two 30s do', async () => {
      const f = await fixture()
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const draft = async tasks => { await db.query("update public.plan_drafts set draft_json=jsonb_set(draft_json,'{tasks}',$2::jsonb) where id=$1", [f.draft, JSON.stringify(tasks.map(m => ({ id: randomUUID(), title: 'Fit', duration_minutes: m, scheduled_date: tomorrow, metadata: { task_type: 'study' } })))]); await stamp(f) }
      const problem = () => scalar("select public.current_week_proposal_problem($1,$2,(current_date::timestamp at time zone 'UTC'))", [f.uid, f.draft])
      assert.equal(await scalar("select public.current_week_available_minutes($1,$2,'UTC',(current_date::timestamp at time zone 'UTC'))", [f.uid, tomorrow]), 60)
      await draft([45]); assert.equal(await problem(), 'STALE_PROPOSAL')
      await assert.rejects(command(f), /STALE_PROPOSAL/)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where cycle_id=$1', [f.uid === f.uid ? f.cycle : f.cycle]), 0)
      await draft([30, 30]); assert.equal(await problem(), null)
      assert.equal((await command(f)).tasks_added, 2)
    })
    await check('accepted timed work and accepted flexible work reduce the room exactly once', async () => {
      const f = await fixture()
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,'09:00','11:00'", [f.uid, tomorrow])
      await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,starts_at,duration_minutes,duration,created_by)
        values($1,$2,$3,'Timed paper','','diagnostic','diagnostic','core','timed','not_started',$4::date,$4::text,($4::date+time '10:00') at time zone 'UTC',60,'60','algorithm')`, [`t-${randomUUID()}`, f.uid, f.cycle, tomorrow])
      const draft = async tasks => { await db.query("update public.plan_drafts set draft_json=jsonb_set(draft_json,'{tasks}',$2::jsonb) where id=$1", [f.draft, JSON.stringify(tasks.map(m => ({ id: randomUUID(), title: 'Fit', duration_minutes: m, scheduled_date: tomorrow, metadata: { task_type: 'study' } })))]); await stamp(f) }
      const problem = () => scalar("select public.current_week_proposal_problem($1,$2,(current_date::timestamp at time zone 'UTC'))", [f.uid, f.draft])
      await draft([60]); assert.equal(await problem(), null)           // 09:00-10:00 stays free beside the 10:00 paper
      await draft([90]); assert.equal(await problem(), 'STALE_PROPOSAL')   // the paper hour is not counted twice or ignored
      await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by)
        values($1,$2,$3,'Accepted flexible','','study','planner','core','day_preferred','not_started',$4::date,$4::text,45,'45','algorithm')`, [`t-${randomUUID()}`, f.uid, f.cycle, tomorrow])
      await draft([30]); assert.equal(await problem(), 'STALE_PROPOSAL')   // 60 free - 45 accepted flexible leaves 15
      await draft([15]); assert.equal(await problem(), null)
    })
    await check('weekly review acceptance validates reviewed rows with the same packer', async () => {
      assert.match(await scalar("select pg_get_functiondef('public.accept_weekly_transition(uuid)'::regprocedure)"), /first_unfit_day/)
      const f = await fixture(); await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const rows = ms => JSON.stringify(ms.map(m => ({ local_date: tomorrow, duration_minutes: m, task_type: 'study', placement: 'day_preferred' })))
      assert.equal(await scalar("select public.first_unfit_day($1,'UTC',(current_date::timestamp at time zone 'UTC'),$2::jsonb,'local_date','duration_minutes','task_type','placement')::text", [f.uid, rows([45])]), tomorrow)
      assert.equal(await scalar("select public.first_unfit_day($1,'UTC',(current_date::timestamp at time zone 'UTC'),$2::jsonb,'local_date','duration_minutes','task_type','placement')::text", [f.uid, rows([30, 30])]), null)
      assert.equal(await scalar("select has_function_privilege('authenticated','public.first_unfit_day(uuid,text,timestamptz,jsonb,text,text,text,text)','execute')"), false)
    })
    await check('weekly acceptance counts a placed continuation against the next week\'s gaps, together with the generated rows', async () => {
      const f = await fixture(); const nd = await scalar("select (current_date+7)::text"), end = await scalar("select (current_date+13)::text")
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, nd])
      const pred = `w-${randomUUID()}`
      await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by)
        values($1,$2,$3,'Unfinished','','study','planner','core','day_preferred','not_started',current_date,current_date::text,45,'45','algorithm')`, [pred, f.uid, f.cycle])
      const accept = async (minutes, rows = []) => {
        const version = await scalar('select public.weekly_source_version($1,$2)', [f.uid, f.cycle])
        const proposal = { next: { starts_at_local: nd, ends_at_local: end, timezone: 'UTC', anchor_day: 1, rows },
          actions: [{ taskId: pred, setExecution: null, cancel: false, unknown: false, continuation: { minutes, intent: 'continue', provisional: false, placement: { date: nd, reason: null, note: null } } }], recap: { planned: 1 } }
        await db.query("update public.weekly_transition_drafts set status='superseded' where cycle_id=$1 and status='ready'", [f.cycle])
        const id = await scalar(`insert into public.weekly_transition_drafts(user_id,cycle_id,closure_kind,no_paper_reason,choices,proposal,source_version)
          values ($1,$2,'no_paper','The bank cannot support a paper this week.','{}',$3,$4) returning id`, [f.uid, f.cycle, proposal, version])
        await db.query('begin')
        try {
          await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: f.uid, role: 'authenticated' })]); await db.query('set local role authenticated')
          const r = (await db.query('select public.accept_weekly_transition($1) as r', [id])).rows[0].r; await db.query('commit'); return r
        } catch (e) { await db.query('rollback'); throw e }
      }
      assert.equal((await accept(45)).code, 'STALE_PROPOSAL')                                 // 45 whole fits neither 30-minute gap
      assert.equal(await scalar("select count(*)::int from public.plan_blocks where continued_from_task_id=$1", [pred]), 0)   // nothing written
      const row = (m, t) => ({ id: `g-${randomUUID()}`, title: 'New', detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: nd, day: nd, starts_at: '', duration_minutes: m, duration: String(m), created_by: 'algorithm' })
      assert.equal((await accept(30, [row(30), row(30)])).code, 'STALE_PROPOSAL')            // two rows already fill both gaps; the continuation is a third
      assert.equal((await accept(30)).ok, true)                                              // alone, 30 fits one gap
    })
    await check('a confirmed (strict) day-only move needs one contiguous gap on the target day; a deliberate Calendar move keeps its own flow', async () => {
      const f = await fixture(); const dayAfter = await scalar("select (current_date+2)::text")
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const block = async (id, date, mins) => db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by)
        values($1,$2,$3,$1,'','study','planner','core','day_preferred','not_started',$4::date,$4::text,$5,$5::text,'algorithm')`.replace('$5,$5::text', '$5::int,($5::int)::text'), [id, f.uid, f.cycle, date, mins])
      const move = (id, strict, mins = 30) => scalar("select public.apply_task_move($1,$2,1,$3::date,null,$4,$5,'coach')", [f.uid, id, tomorrow, mins, strict])
      const [a, b, c] = [`m-${randomUUID()}`, `m-${randomUUID()}`, `m-${randomUUID()}`]
      await block(a, tomorrow, 30); await block(b, tomorrow, 30); await block(c, dayAfter, 30)
      assert.equal((await move(c, true)).code, 'NO_ROOM')                       // both 30-minute gaps are held by accepted sittings
      assert.equal(await scalar('select local_date::text from public.plan_blocks where id=$1', [c]), dayAfter)   // nothing moved
      assert.equal((await move(c, false)).ok, true)                              // the student's deliberate Calendar override is not this check's business
      await db.query('delete from public.plan_blocks where id=any($1)', [[a, c]])   // the deliberate move put c on that day too
      const d = `m-${randomUUID()}`; await block(d, dayAfter, 30)
      assert.equal((await move(d, true)).ok, true)                              // one gap is free again
      const e = `m-${randomUUID()}`; await block(e, dayAfter, 45)
      assert.equal((await move(e, true, 45)).code, 'NO_ROOM')                   // 45 never fits a 30-minute gap
      assert.match(await scalar("select pg_get_functiondef('public.confirm_coach_move(uuid)'::regprocedure)"), /no_room/)
    })
    await check('redistribution refuses a longer sitting that fits no gap and rolls back every change', async () => {
      const f = await fixture()
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const source = `src-${randomUUID()}`, target = `dst-${randomUUID()}`
      await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,lm_id,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by)
        values($1,$3,$4,'Missed','','study','r032','planner','core','day_preferred','deferred',$5::date,$5::text,30,'30','algorithm'),
              ($2,$3,$4,'Later','','study','r032','planner','core','day_preferred','not_started',$5::date,$5::text,30,'30','algorithm')`, [source, target, f.uid, f.cycle, tomorrow])
      const resize = async minutes => {
        const revision = await scalar('select revision from public.plan_blocks where id=$1', [target])
        const hash = await scalar('select public.current_week_source_hash($1,$2)', [f.uid, f.cycle])
        return scalar('select public.apply_redistribution($1,$2,$3::jsonb,$4)', [f.uid, source, JSON.stringify([{ task_id: target, expected_revision: revision, add_minutes: minutes }]), hash])
      }
      await assert.rejects(resize(30), /REDISTRIBUTION_NO_ROOM/)
      assert.equal(await scalar('select duration_minutes from public.plan_blocks where id=$1', [target]), 30)
      assert.equal(await scalar('select count(*)::int from public.redistribution_receipts where source_task_id=$1', [source]), 0)
      await db.query("update public.plan_blocks set duration_minutes=15,duration='15' where id=$1", [target])
      const saved = await resize(15)
      assert.equal(saved.ok, true)
      assert.equal(saved.placed, 15)
      assert.equal(await scalar('select duration_minutes from public.plan_blocks where id=$1', [target]), 30)
      assert.equal((await resize(15)).replayed, true)
    })
    await check('initial onboarding acceptance refuses fragmented room before writing tasks, then accepts whole sittings', async () => {
      const f = await fixture()
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const draft = async ms => db.query("update public.plan_drafts set purpose='onboarding_initial_week', draft_json=jsonb_set(draft_json,'{tasks}',$2::jsonb) where id=$1", [f.draft, JSON.stringify(ms.map(m => ({ id: randomUUID(), title: 'Initial study', duration_minutes: m, scheduled_date: tomorrow, metadata: { task_type: 'study', lm_id: 'r032' } })))])
      await draft([45])
      await assert.rejects(command(f, 'accept_onboarding_preview'), /STALE_PREVIEW/)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where user_id=$1', [f.uid]), 0)
      assert.equal(await scalar('select status from public.plan_drafts where id=$1', [f.draft]), 'ready')
      await draft([30, 30])
      const saved = await command(f, 'accept_onboarding_preview')
      assert.ok(saved.cycle_id)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where user_id=$1', [f.uid]), 2)
      assert.equal((await command(f, 'accept_onboarding_preview')).cycle_id, saved.cycle_id)
      assert.equal(await scalar('select count(*)::int from public.plan_blocks where user_id=$1', [f.uid]), 2)
    })
    await check('class recovery refuses a same-day flexible move that no longer fits and leaves no task event', async () => {
      const f = await fixture(), id = `recovery-${randomUUID()}`
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','09:30'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      await db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,lm_id,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by)
        values($1,$2,$3,'Recovery','','study','r032','planner','core','day_preferred','not_started',$4::date,$4::text,45,'45','algorithm')`, [id, f.uid, f.cycle, tomorrow])
      const revision = await scalar('select revision from public.plan_blocks where id=$1', [id])
      const hash = await scalar('select public.current_week_source_hash($1,$2)', [f.uid, f.cycle])
      await db.query("update public.plan_drafts set purpose='class_change_recovery',context_fingerprint=$2,draft_json=$3::jsonb where id=$1", [f.draft, hash, JSON.stringify({ planning_date: today, change_key: 'fixture-change', moves: [{ task_id: id, title: 'Recovery', expected_revision: revision, minutes: 45, to_date: tomorrow, to_starts: null }], unplaced: [] })])
      await assert.rejects(command(f, 'accept_class_recovery'), /STALE_PROPOSAL/)
      assert.equal(await scalar('select revision from public.plan_blocks where id=$1', [id]), revision)
      assert.equal(await scalar('select count(*)::int from public.task_events where task_id=$1', [id]), 0)
      assert.equal(await scalar('select status from public.plan_drafts where id=$1', [f.draft]), 'ready')
    })
    await check('class recovery accepts a TIMED move when unrelated flexible work already overflowed the day, and still refuses a flexible move that fits no gap', async () => {
      const f = await fixture(), timed = `rec-t-${randomUUID()}`, flex = `rec-f-${randomUUID()}`
      await db.query('delete from public.availability_windows where user_id=$1', [f.uid])
      await db.query("insert into public.availability_windows(user_id,weekday,start_time,end_time) select $1,extract(dow from $2::date)::int,s::time,e::time from (values('09:00','10:00'),('11:00','11:30')) v(s,e)", [f.uid, tomorrow])
      const block = (id, placement, start, mins) => db.query(`insert into public.plan_blocks(id,user_id,cycle_id,title,detail,task_type,lm_id,origin,priority,placement,execution,local_date,day,starts_at,duration_minutes,duration,created_by)
        values($1,$2,$3,$1,'','study','r032','planner','core',$4,'not_started',$5::date,$5::text,$6::timestamptz,$7::int,($7::int)::text,'algorithm')`, [id, f.uid, f.cycle, placement, tomorrow, start, mins])
      await block(flex, 'day_preferred', null, 100)                       // already cannot fit the 60 + 30 minutes of windows: an overflow the move does not cause
      await block(timed, 'timed', `${tomorrow}T09:00:00Z`, 30)
      const revision = await scalar('select revision from public.plan_blocks where id=$1', [timed])
      const hash = await scalar('select public.current_week_source_hash($1,$2)', [f.uid, f.cycle])
      await db.query("update public.plan_drafts set purpose='class_change_recovery',context_fingerprint=$2,draft_json=$3::jsonb where id=$1", [f.draft, hash, JSON.stringify({ planning_date: today, change_key: 'fixture-change-2', moves: [{ task_id: timed, title: timed, expected_revision: revision, minutes: 30, to_date: tomorrow, to_starts: `${tomorrow}T09:30:00Z` }], unplaced: [] })])
      const r = await command(f, 'accept_class_recovery')
      assert.equal(r.moved, 1)                                            // the timed move is accepted
      assert.equal(await scalar('select starts_at is not null and to_char(starts_at at time zone \'UTC\',\'HH24:MI\')=\'09:30\' from public.plan_blocks where id=$1', [timed]), true)
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
