/** Rehearses 20261112_linked_mocks.sql on the REAL development schema inside a transaction that is ALWAYS rolled back.
 *  Legacy checkpoint data is seeded BEFORE the migration so the backfill is proven to keep identity, version, outcome history,
 *  assessment choices and related tasks.
 *  npm run linked:rehearse -- --confirm-target=<project-ref> [--already-applied]   (prints facts only) */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration, transactionalSql } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..')
  const env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  setTimeout(() => { console.error('Stopped: the database stopped responding. Nothing persists.'); process.exit(2) }, 180000).unref()
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 70000 })
  await c.connect(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (s, a) => Object.values((await c.query(s, a)).rows[0] ?? { v: null })[0]
  const cmd = async (u, key, command, a) => (await c.query('select public.checkpoint_command($1,$2,$3,$4,$5::jsonb) as r', [u, key, command, `h-${key}`, JSON.stringify(a)])).rows[0].r
  const prof = async u => (await c.query('select mock_id, mock_version, mock_date::text d, mock_kind k, mock_label l from public.profiles where id=$1', [u])).rows[0]
  const appts = async u => (await c.query('select id, status, version, planned_date::text d, kind from public.mock_appointments where user_id=$1 order by planned_date, created_at', [u])).rows
  try {
    await c.query('BEGIN'); await c.query("SET LOCAL statement_timeout='60s'")
    const already = args.includes('--already-applied')
    // A plain profile INSERT must work before any session setting exists (regression: unset-setting read).
    const u = await one('select gen_random_uuid()'), v = await one('select gen_random_uuid()')
    for (const x of [u, v]) { await c.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [x, `lm+${String(x).slice(0, 8)}@example.invalid`]); await c.query('insert into public.profiles (id) values ($1) on conflict (id) do nothing', [x]) }
    let legacy = null
    if (!already) {
      console.log('Legacy data before the migration')
      await c.query("update public.profiles set mock_date='2030-06-10', mock_kind='provider_mock', mock_label='Coaching mock', mock_start_time='10:00', mock_duration_minutes=180 where id=$1", [u])
      legacy = await prof(u)
      const cyc = await one('select gen_random_uuid()')
      await c.query("insert into public.planning_cycles (id,user_id,starts_at,ends_at,starts_at_local,ends_at_local,timezone,status) values ($1,$2,now(),now()+interval '9 days','2030-06-03','2030-06-12','UTC','active')", [cyc, u])
      await c.query(`insert into public.plan_blocks (id,user_id,cycle_id,title,detail,task_type,origin,priority,placement,execution,local_date,day,duration_minutes,duration,created_by,is_protected_commitment)
        values ($1,$2,$3,'Prep','d','review','student','optional','day_preferred','not_started','2030-06-08','2030-06-08',45,'45','student',false)`, [`lm-${legacy.mock_id}`, u, cyc])
      await c.query("insert into public.checkpoint_suggestion_tasks (user_id, checkpoint_id, suggestion_id, task_id, version_added) values ($1,$2,'prepare-1',$3,$4)", [u, legacy.mock_id, `lm-${legacy.mock_id}`, legacy.mock_version])
      const old = await one('select gen_random_uuid()')
      await c.query("insert into public.mock_outcomes (user_id, checkpoint_id, planned_date, kind, label, outcome, reported_result, actual_date, choice_at_record) values ($1,$2,'2030-05-01','school_checkpoint','Old','taken','58%','2030-05-02','use_mock')", [u, old])
      await c.query("insert into public.cycle_assessment_choices (user_id, week_start, choice) values ($1,'2030-06-03','use_mock')", [u])
      ok('seeded: a current checkpoint with identity, a related task, a historical outcome and a week choice', legacy.mock_id && legacy.mock_version >= 1)
      await c.query(transactionalSql(fs.readFileSync(path.join(root, 'supabase/migrations/20261112_linked_mocks.sql'), 'utf8')))
      console.log('Backfill keeps identity and history')
      const a = await appts(u)
      ok('the current checkpoint became an appointment with the SAME id and version', a.some(x => x.id === legacy.mock_id && x.status === 'planned' && x.version === legacy.mock_version), JSON.stringify(a))
      ok('an earlier checkpoint that outcome history points at kept its id as a completed appointment', a.some(x => x.id === old && x.status === 'completed'))
      ok('related task and outcome history still point at those ids', Number(await one('select count(*) from public.checkpoint_suggestion_tasks where user_id=$1 and checkpoint_id=$2', [u, legacy.mock_id])) === 1
        && (await one('select reported_result from public.mock_outcomes where user_id=$1 and checkpoint_id=$2', [u, old])) === '58%')
      ok('the legacy week choice is preserved (no appointment recorded = applies to that week)', (await one("select choice from public.cycle_assessment_choices where user_id=$1 and week_start='2030-06-03'", [u])) === 'use_mock')
      const p = await prof(u)
      ok('the profile still shows that checkpoint (a projection of the appointment)', p.mock_id === legacy.mock_id && p.d === '2030-06-10' && p.l === 'Coaching mock')
    }

    console.log('Projection and compatibility')
    const r2 = await cmd(u, 'lm-add-0001', 'add', { kind: 'internal_rehearsal', date: '2030-06-05', label: 'Rehearsal 1' })
    ok('a second appointment can be added', r2.ok === true && !!r2.checkpointId, JSON.stringify(r2))
    let p = await prof(u)
    ok('the profile now shows the EARLIEST planned appointment', p.mock_id === r2.checkpointId && p.d === '2030-06-05' && p.k === 'internal_rehearsal')
    ok('the later appointment is untouched', (await appts(u)).filter(x => x.status === 'planned').length === 2)
    await c.query("update public.profiles set mock_date='2030-06-04', mock_label='Edited via Settings' where id=$1", [u])
    const edited = (await appts(u)).find(x => x.id === r2.checkpointId)
    p = await prof(u)
    ok('a legacy write of profiles.mock_* edits the NEXT appointment and keeps its kind', edited.d === '2030-06-04' && edited.kind === 'internal_rehearsal' && edited.version === 2 && p.mock_id === r2.checkpointId)
    const stale = await cmd(u, 'lm-save-stale', 'save', { checkpointId: r2.checkpointId, expectedVersion: 1, date: '2030-06-20', kind: 'internal_rehearsal' })
    ok('a stale edit is refused and names the current one', stale.code === 'CHECKPOINT_CHANGED' && stale.currentId === r2.checkpointId)
    const noId = await cmd(u, 'lm-save-noid', 'save', { checkpointId: null, expectedVersion: null, date: '2030-07-01', kind: 'other' })
    ok('a stale create (no id while appointments exist) is refused, not duplicated', noId.code === 'CHECKPOINT_CHANGED' && (await appts(u)).filter(x => x.status === 'planned').length === 2)
    const cancelled = await cmd(u, 'lm-cancel-0001', 'cancel', { checkpointId: r2.checkpointId, expectedVersion: 2, weekStart: '2030-06-03' })
    p = await prof(u)
    ok('cancelling one appointment leaves the other as the projection', cancelled.ok && !!p.mock_id && p.d === '2030-06-10')
    const rep = await cmd(u, 'lm-cancel-0001', 'cancel', { checkpointId: r2.checkpointId, expectedVersion: 2, weekStart: '2030-06-03' })
    ok('a retry returns the original receipt', rep.replayed === true)
    const out = await cmd(u, 'lm-out-0001', 'outcome', { checkpointId: p.mock_id, expectedVersion: p.mock_version, outcome: 'taken', actualDate: '2030-06-10', today: '2030-06-11', result: '61%', weekStart: '2030-06-03' })
    ok('recording an external outcome completes it and writes history', out.ok && (await appts(u)).find(x => x.id === p.mock_id).status === 'completed' && (await prof(u)).mock_id === null)
    ok('no evidence, attempts or repairs were written by any of it', Number(await one('select (select count(*) from public.evidence_events where user_id=$1)+(select count(*) from public.assessment_attempts where user_id=$1)+(select count(*) from public.repair_threads where user_id=$1)', [u])) === 0)
    const internal = await cmd(u, 'lm-add-0002', 'add', { kind: 'internal_rehearsal', date: '2030-06-15' })
    const iOut = await cmd(u, 'lm-out-0002', 'outcome', { checkpointId: internal.checkpointId, expectedVersion: 1, outcome: 'taken', actualDate: '2030-06-15', today: '2030-06-15', weekStart: '2030-06-10' })
    ok('an internal rehearsal cannot be marked "taken" by typing (it completes by finishing its sessions)', iOut.code === 'INTERNAL_RESULT')

    console.log('Scope lock protocol and rehearsal guards')
    ok('scope-lock triggers exist on every table paper_scope_source reads', Number(await one("select count(*) from pg_trigger where tgname='scope_write_lock' and not tgisinternal")) === 6)
    ok('the held-out exception is not a table or request flag (transaction-local setting only)', (await one("select coalesce(current_setting('app.holdout_form', true), 'off')")) !== 'on')
    ok('start_rehearsal is executable by the service role only', (await one("select has_function_privilege('authenticated','public.start_rehearsal(uuid,uuid,uuid,text[],text[],jsonb,text,jsonb)','execute')")) === false)
    n++; console.log(`\n${n} checks passed (nothing persisted)`)
  } finally { await c.query('ROLLBACK').catch(() => {}); await c.end().catch(() => {}) }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
