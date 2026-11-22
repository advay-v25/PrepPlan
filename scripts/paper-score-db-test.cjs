/** paper-score.1 proof on the REAL development schema: the reserved form owns its scoring policy; omissions are delivered, unmarked items. Uses a TEST-ONLY approved fixture bank (scripts/fixture-bank.cjs) and throwaway students; every row is removed by recorded id.
 *  npm run paper:score:db:test -- --confirm-target=<project-ref> */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

async function main(args = process.argv.slice(2)) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'paper-fixture-')), 'bank.json')
  const target = `--confirm-target=${cfg.identity}`
  execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'create', target, `--out=${file}`, '--readings=r028', '--per-outcome=12', '--variants=1'], { stdio: 'inherit' })
  const bank = JSON.parse(fs.readFileSync(file, 'utf8'))
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 60000 })
  const a = mk(); await a.connect(); const pool = []; let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36), users = []
  const reviewer = bank.users[0]

  const student = async () => { const id = await one(a, 'select gen_random_uuid()'); await a.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `pc-${tag}-${users.length}@example.invalid`]); await a.query('insert into public.profiles (id) values ($1) on conflict do nothing', [id]); users.push(id); return id }
  const as = async (c, uid, sql, p) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return Object.values(r.rows[0] ?? { v: null })[0] } catch (e) { await c.query('ROLLBACK'); throw e }
  }
  const fails = async (p, re) => { try { await p; return false } catch (e) { return re.test(e.message) } }
  const man = await one(a, "select id from public.curriculum_manifests where is_active limit 1")
  const reserve = async (c, u, key, ids, o = {}) => (await c.query('select public.start_assessment_paper($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) as r', [
    u, 'weekly', key, o.cycle ?? null, 'diagnostic', 'weekly_cumulative', man, ids, o.min ?? 5, JSON.stringify({ tag }), JSON.stringify({ tag }), JSON.stringify({ tag }), JSON.stringify({ delivered: ids.length }),
    o.scope === undefined ? JSON.stringify({ targets: [], tag }) : o.scope, 'fixture', 'rev-1', null, null, false])).rows[0].r
  const count = async (sql, p) => Number(await one(a, sql, p))
  const attemptsFor = (u, key) => count("select count(*) from public.assessment_attempts where user_id=$1 and open_key=$2", [u, key])
  const itemsOf = id => one(a, 'select count(*) from public.form_items fi join public.assessment_attempts t on t.form_id=fi.form_id where t.id=$1', [id])

  const items = (await a.query("select id, family_id from public.assessment_items where id = any($1) order by id", [bank.items])).rows
  const byFam = new Map(); for (const i of items) byFam.set(i.family_id, [...(byFam.get(i.family_id) ?? []), i.id])
  const single = [...byFam.values()].filter(v => v.length === 1).map(v => v[0])
  const grp = k => single.slice(k * 8, k * 8 + 8)
  const answer = (att, stu, ids, correct) => Promise.all(ids.map(id => a.query("insert into public.assessment_responses (attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1,$2,$3,0,$4,3)", [att, id, stu, correct])))
  const fin = (stu, att, policy = '1.0') => as(a, stu, 'select public.finalize_assessment_attempt($1,$2,$3) as r', [att, policy, 'x']).catch(e => ({ err: e.message }))
  const attempt = id => a.query('select score, scoring_policy_version, delivered_count, omitted_count, valid_response_count from public.assessment_attempts where id=$1', [id]).then(r => r.rows[0])
  try {
    if (single.length < 32) throw Error(`fixture bank too small: ${single.length} single-family items`)
    console.log('\nThe form owns the policy')
    const s1 = await student(), r1 = await reserve(a, s1, 'ps1', grp(0))
    ok('a newly reserved form carries paper-score.1', (await one(a, 'select scoring_policy from public.assessment_forms f join public.assessment_attempts t on t.form_id=f.id where t.id=$1', [r1.attemptId])) === 'paper-score.1')
    await answer(r1.attemptId, s1, grp(0).slice(0, 1), true); await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [r1.attemptId])
    const f1 = await fin(s1, r1.attemptId, '1.0')
    const at1 = await attempt(r1.attemptId)
    ok('1 correct + 7 omitted scores the PAPER (13 = 12.5% rounded), even though the caller asked for policy 1.0', f1.ok === true && at1.score === 13 && at1.scoring_policy_version === 'paper-score.1', JSON.stringify([f1, at1]))
    ok('delivered 8, answered 1, omitted 7 are stored', at1.delivered_count === 8 && at1.valid_response_count === 1 && at1.omitted_count === 7, JSON.stringify(at1))
    ok('only the answered question produced evidence; the seven omissions produced none', (await count('select count(*) from public.evidence_events where attempt_id=$1', [r1.attemptId])) <= 1)

    console.log('\nA paper with no answers')
    const s2 = await student(), r2 = await reserve(a, s2, 'ps2', grp(1))
    await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [r2.attemptId])
    const f2 = await fin(s2, r2.attemptId), at2 = await attempt(r2.attemptId)
    ok('submits as a completed paper: 0% paper score, 8 omitted, no error and no evidence', f2.ok === true && at2.score === 0 && at2.omitted_count === 8 && (await count('select count(*) from public.evidence_events where attempt_id=$1', [r2.attemptId])) === 0, JSON.stringify([f2, at2]))
    const f2b = await fin(s2, r2.attemptId)
    ok('a repeat submit is the same receipt (no second write)', f2b.ok === true && f2b.alreadyScored === true)

    console.log('\nHistorical forms keep their policy')
    const s3 = await student(), r3 = await reserve(a, s3, 'ps3', grp(2))
    await a.query("update public.assessment_forms set scoring_policy='1.0' where id=(select form_id from public.assessment_attempts where id=$1)", [r3.attemptId])
    await answer(r3.attemptId, s3, grp(2).slice(0, 1), true); await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [r3.attemptId])
    const f3 = await fin(s3, r3.attemptId, 'paper-score.1'), at3 = await attempt(r3.attemptId)
    ok('a legacy form stays answered-only (100%) and is labelled 1.0 whatever the caller passes', f3.ok === true && at3.score === 100 && at3.scoring_policy_version === '1.0', JSON.stringify([f3, at3]))
    const s4 = await student(), r4 = await reserve(a, s4, 'ps4', grp(3))
    await a.query("update public.assessment_forms set scoring_policy='1.0' where id=(select form_id from public.assessment_attempts where id=$1)", [r4.attemptId]); await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [r4.attemptId])
    const f4 = await fin(s4, r4.attemptId)
    ok('a legacy form with no answers still refuses (its original contract)', /No responses found/.test(f4.err ?? ''), JSON.stringify(f4))

    console.log(`\n${n} passed, 0 failed\n`)
  } finally {
    for (const c of pool) await c.end().catch(() => {})
    try { execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'destroy', target, `--file=${file}`], { stdio: 'inherit' }) } catch (e) { console.error('fixture cleanup failed:', e.message) }
    await a.query('delete from public.assessment_attempts where user_id = any($1)', [users]).catch(e => console.error('cleanup attempts:', e.message))
    await a.query('delete from public.profiles where id = any($1)', [users]).catch(() => {}); await a.query('delete from auth.users where id = any($1)', [users]).catch(() => {})
    await a.end()
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
