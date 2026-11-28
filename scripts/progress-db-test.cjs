/** record_item_progress on the REAL development schema: monotonic under overlap, refused after close, serialised against a submit that holds the attempt.
 *  Fixture rows are inserted with triggers relaxed (they test timing, not publication) and deleted by recorded id.
 *  npm run progress:db:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { Client } = require('pg')
const { openStage } = require('./lib/stage.cjs')
async function main(args = process.argv.slice(2)) {
  const stage = await openStage(args), cfg = stage.cfg; global.__stage = stage
  setTimeout(() => { console.error('Stopped: deadline reached.'); process.exit(2) }, 120000).unref()
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const a = mk(); await a.connect(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36); const ids = { users: [], attempts: [], forms: [], bps: [], items: [] }; const pool = []
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const hb = (c, att, user, item, act, int = 0, visit = false, flag = null) => c.query('select public.record_item_progress($1,$2,$3,$4,$5,$6,$7) r', [att, user, item, act, int, visit, flag]).then(r => r.rows[0].r)
  const cleanup = async () => {
    for (const c of pool) await c.end().catch(() => {})
    const run = (s, p) => a.query(s, p).catch(e => console.error('cleanup:', e.message))
    await run('delete from public.attempt_item_progress where attempt_id = any($1)', [ids.attempts]); await run('delete from public.assessment_responses where attempt_id = any($1)', [ids.attempts])
    await run('delete from public.assessment_attempts where id = any($1)', [ids.attempts])
    await run('set session_replication_role = replica'); await run('delete from public.form_items where form_id = any($1)', [ids.forms]); await run('set session_replication_role = origin')
    await run('delete from public.assessment_forms where id = any($1)', [ids.forms]); await run('delete from public.assessment_blueprints where id = any($1)', [ids.bps]); await run('delete from public.assessment_items where id = any($1)', [ids.items])
    await run('delete from public.profiles where id = any($1)', [ids.users]); await run('delete from auth.users where id = any($1)', [ids.users])
  }
  try {
    const man = await one(a, 'select id from public.curriculum_manifests where is_active limit 1')
    const outcome = (await a.query('select id, reading_id from public.reading_los order by id limit 1')).rows[0]
    const uid = async () => { const id = await one(a, 'select gen_random_uuid()'); await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `pg-${ids.users.length}-${tag}@example.invalid`]); await a.query('insert into public.profiles (id) values ($1) on conflict do nothing', [id]); ids.users.push(id); return id }
    const u1 = await uid(), u2 = await uid()
    const item = `fxp-${tag}`; ids.items.push(item)
    await a.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, outcome_id, key_index, item_card) values ($1,$2,'fx','fx',1,'Fixture progress question stem long enough',$3,'{}','fixture','draft',$4,0,'{}')`, [item, outcome.reading_id, JSON.stringify(['a', 'b', 'c']), outcome.id])
    const bp = await one(a, "insert into public.assessment_blueprints (manifest_id,purpose,requested_scope,constraints) values ($1,'weekly_cumulative','{}','{}') returning id", [man]); ids.bps.push(bp)
    const form = await one(a, "insert into public.assessment_forms (blueprint_id,delivery_mode) values ($1,'fixed') returning id", [bp]); ids.forms.push(form)
    await a.query('set session_replication_role = replica'); await a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, item]); await a.query('set session_replication_role = origin')
    const attempt = async () => { const id = await one(a, "insert into public.assessment_attempts (user_id,status,attempt_kind,form_id,started_at) values ($1,'in_progress','weekly',$2, now() - interval '1 hour') returning id", [u1, form]); ids.attempts.push(id); return id }
    const att = await attempt()
    const [w1, w2] = await Promise.all([conn(), conn()])

    let r = await hb(w1, att, u1, item, 4000, 0, true)
    ok('a first report is capped by the time that could have passed (not trusted at 4,000 s)', r.ok && r.activeSeconds <= 3603 && r.activeSeconds > 0, JSON.stringify(r))
    const base = r.activeSeconds
    r = await hb(w1, att, u1, item, 5)
    ok('an OLDER, smaller heartbeat can never reduce saved time', r.ok && r.activeSeconds === base, JSON.stringify(r))
    ok('an invalid (negative) report is clamped, never lowers the saved value', (await hb(w1, att, u1, item, -50, -5)).activeSeconds === base)
    ok('visits count only when the report says so', Number(await one(a, 'select visits from public.attempt_item_progress where attempt_id=$1', [att])) === 1 && (await hb(w1, att, u1, item, base, 0, true)) && Number(await one(a, 'select visits from public.attempt_item_progress where attempt_id=$1', [att])) === 2)
    const att2 = await attempt()
    await a.query("insert into public.attempt_item_progress (attempt_id,item_id,user_id,active_seconds,interrupted_seconds,last_seen_at) values ($1,$2,$3,0,0,now())", [att2, item, u1])
    const res = await Promise.all(Array.from({ length: 12 }, (_, i) => hb(i % 2 ? w1 : w2, att2, u1, item, 1 + i * 2)))
    const final = Number(await one(a, 'select active_seconds from public.attempt_item_progress where attempt_id=$1', [att2]))
    ok('twelve overlapping heartbeats leave the saved value equal to the largest accepted one', res.every(x => x.ok) && final === Math.max(...res.map(x => x.activeSeconds)), JSON.stringify({ final, res: res.map(x => x.activeSeconds) }))
    ok('progress for a question outside the form is refused', (await hb(w1, att, u1, 'not-in-form', 5)).code === 'bad_item')
    ok('another student\'s attempt is not found', (await hb(w1, att, u2, item, 5)).code === 'not_found')
    await a.query("insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,flagged) values ($1,$2,$3,0,true,false)", [att, item, u1]).catch(() => {})
    r = await hb(w1, att, u1, item, base, 0, false, true)
    ok('a flag on a question is recorded with its progress', r.ok && (await one(a, 'select flagged from public.attempt_item_progress where attempt_id=$1', [att])) === true)

    console.log('\nAfter close')
    const att3 = await attempt(); await hb(w1, att3, u1, item, 10); const before = Number(await one(a, 'select active_seconds from public.attempt_item_progress where attempt_id=$1', [att3]))
    // a submit holds the attempt row; a heartbeat arriving meanwhile must wait, then be refused
    await a.query('begin'); await a.query('select id from public.assessment_attempts where id=$1 for update', [att3])
    const late = hb(w2, att3, u1, item, before + 30)
    await new Promise(r => setTimeout(r, 400))
    await a.query("update public.assessment_attempts set status='scored' where id=$1", [att3]); await a.query('commit')
    r = await late
    ok('a heartbeat that raced a submit waits for it and is refused as closed', r.ok === false && r.code === 'closed')
    ok('closed attempt progress is untouched', Number(await one(a, 'select active_seconds from public.attempt_item_progress where attempt_id=$1', [att3])) === before)

    console.log('\nAnswer commands')
    const grants = (await a.query(`select
      has_function_privilege('authenticated', 'public.save_attempt_answer(uuid,text,integer,integer,integer,integer,boolean,bigint)', 'EXECUTE') as canonical,
      has_function_privilege('authenticated', 'public.save_attempt_response(uuid,text,integer,integer,integer,integer,boolean,bigint)', 'EXECUTE') as internal,
      has_function_privilege('anon', 'public.record_assessment_response(uuid,text,integer,integer,integer)', 'EXECUTE') as anonymous`)).rows[0]
    ok('student access goes through the canonical or compatibility command, and anonymous access is refused', grants.canonical && !grants.internal && !grants.anonymous)
    const legacyAttempt = await attempt()
    await w1.query(`select set_config('request.jwt.claim.sub',$1,false)`, [u1])
    await w1.query('set role authenticated')
    const legacySave = () => one(w1, 'select public.record_assessment_response($1,$2,0,3,15)', [legacyAttempt, item])
    const receipt = await legacySave()
    ok('compatibility answer saves timing and returns the same receipt on retry', receipt && receipt === await legacySave()
      && await one(a, 'select active_seconds from public.attempt_item_progress where attempt_id=$1', [legacyAttempt]) === 15)
  } finally { await cleanup(); await a.end().catch(() => {}) }
  console.log(`\n${n} passed, 0 failed\n`)
}
main().then(() => global.__stage?.stop()).catch(async e => { console.error('\nFAILED:', e.message); await global.__stage?.stop(); process.exit(1) })
