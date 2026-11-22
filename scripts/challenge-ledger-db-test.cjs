/** Challenge ledger proof on the REAL development schema: a resolved challenge changes the STORED score under the form's own policy, with an adjustment record. Uses a TEST-ONLY approved fixture bank (scripts/fixture-bank.cjs) and throwaway students; every row is removed by recorded id.
 *  npm run challenge:ledger:db:test -- --confirm-target=<project-ref> */
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
  execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'create', target, `--out=${file}`, '--readings=r028,r029', '--per-outcome=12', '--variants=1'], { stdio: 'inherit' })
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
  const inProgress = att => a.query("update public.assessment_attempts set status='in_progress' where id=$1", [att])
  const fin = (stu, att) => as(a, stu, 'select public.finalize_assessment_attempt($1,$2,$3) as r', [att, '1.0', 'x']).catch(e => ({ err: e.message }))
  const raise = (stu, att, item) => as(a, stu, "select public.raise_item_challenge($1,$2,'the wording is unclear','unclear_wording')", [att, item]).catch(e => ({ err: e.message }))
  const resolve = (att, ch, how, client = a) => as(client, reviewer, 'select public.resolve_item_challenge($1,$2) as r', [ch, how]).catch(e => ({ err: e.message }))
  const at = id => a.query('select score, scoring_policy_version p, delivered_count d, valid_response_count ans, correct_response_count c, omitted_count o, scoreable_count s, result_revision rev from public.assessment_attempts where id=$1', [id]).then(r => r.rows[0])
  const adjustments = id => count('select count(*) from public.attempt_score_adjustments where attempt_id=$1', [id])
  const events = (att, ids) => count('select count(*) from public.evidence_events where attempt_id=$1 and item_id = any($2)', [att, ids])
  const paper = async (k, key, { correct = [], wrong = [], practice = false, legacy = false } = {}) => {
    const stu = await student(), g = grp(k), r = await reserve(a, stu, key, g)
    if (legacy) await a.query("update public.assessment_forms set scoring_policy='1.0' where id=(select form_id from public.assessment_attempts where id=$1)", [r.attemptId])
    await answer(r.attemptId, stu, correct.map(i => g[i]), true); await answer(r.attemptId, stu, wrong.map(i => g[i]), false)
    await inProgress(r.attemptId); if (practice) await a.query("update public.assessment_attempts set attempt_kind='practice' where id=$1", [r.attemptId])
    return { stu, att: r.attemptId, g }
  }
  try {
    if (single.length < 96) throw Error(`fixture bank too small: ${single.length}`)
    console.log('\nThe required example: 1 correct, 1 wrong, 6 omitted, then the wrong item is upheld')
    const A = await paper(0, 'cl1', { correct: [0], wrong: [1] })
    await fin(A.stu, A.att)
    let x = await at(A.att)
    ok('before: 2 answered, 1 correct, 6 omitted, delivered 8, 13% (12.5% rounded)', x.score === 13 && x.ans === 2 && x.c === 1 && x.o === 6 && x.d === 8 && x.s === 8 && x.p === 'paper-score.1', JSON.stringify(x))
    ok('exact evidence: one observation for each of the two answered approved items, none for the six omitted', (await events(A.att, A.g.slice(0, 2))) === 2 && (await events(A.att, A.g.slice(2))) === 0)
    const ch = await raise(A.stu, A.att, A.g[1])
    ok('reporting a delivered item works', typeof ch === 'string', JSON.stringify(ch))
    ok('a pending report keeps the item scoreable, marked provisional', (await at(A.att)).score === 13 && (await count("select count(*) from public.evidence_events where attempt_id=$1 and item_id=$2 and validity='disputed'", [A.att, A.g[1]])) === 1)
    ok('a repeated report returns the same challenge, not a second one', (await raise(A.stu, A.att, A.g[1])) === ch && (await count('select count(*) from public.item_challenges where attempt_id=$1', [A.att])) === 1)
    const rs = await resolve(A.att, ch, 'resolved_voided')
    x = await at(A.att)
    ok('after upholding: 7 scoreable, 1 correct, 1 answered, 6 omitted, 1 voided; delivered stays 8; 14% (1/7)', rs?.ok === true && x.score === 14 && x.s === 7 && x.c === 1 && x.ans === 1 && x.o === 6 && x.d === 8 && x.p === 'paper-score.1', JSON.stringify([rs, x]))
    ok('the revision moved once and the adjustment records old and new values', x.rev === 2 && (await adjustments(A.att)) === 1 && (await one(a, "select (previous->>'score')||'>'||(after->>'score') from public.attempt_score_adjustments where attempt_id=$1", [A.att])) === '13>14')
    ok('the voided answer left the evidence ledger once; the correct one stays valid', (await count("select count(*) from public.evidence_events where attempt_id=$1 and validity='voided'", [A.att])) === 1 && (await count("select count(*) from public.evidence_events where attempt_id=$1 and validity='valid'", [A.att])) === 1)
    const again = await resolve(A.att, ch, 'resolved_voided')
    ok('resolving again is refused and changes nothing', /already resolved/.test(again.err ?? '') && (await adjustments(A.att)) === 1 && (await at(A.att)).rev === 2)

    console.log('\nVoiding a correct answer; an omitted item; all items')
    const B = await paper(1, 'cl2', { correct: [0] }); await fin(B.stu, B.att)
    const chB = await raise(B.stu, B.att, B.g[0]); await resolve(B.att, chB, 'resolved_voided')
    x = await at(B.att)
    ok('voiding the only correct answer: 0 correct of 7 scoreable, 0%, no answered accuracy', x.score === 0 && x.c === 0 && x.ans === 0 && x.s === 7 && x.o === 7, JSON.stringify(x))
    const C = await paper(2, 'cl3', { correct: [0, 1] }); await fin(C.stu, C.att)
    const chC = await raise(C.stu, C.att, C.g[5]); await resolve(C.att, chC, 'resolved_voided')
    x = await at(C.att)
    ok('reporting then voiding an OMITTED item (never answered) removes it from the denominator: 2 of 7, 6 became 5 omitted', x.s === 7 && x.c === 2 && x.o === 5 && x.score === 29 && x.d === 8, JSON.stringify(x))
    const D = await paper(3, 'cl4', { correct: [0] }); await fin(D.stu, D.att)
    for (const g of D.g) { const c = await raise(D.stu, D.att, g); await resolve(D.att, c, 'resolved_voided') }
    x = await at(D.att)
    ok('every item voided: no scoreable items, score unavailable (null), delivered still 8', x.s === 0 && x.score === null && x.d === 8 && x.c === 0, JSON.stringify(x))

    console.log('\nDismissal and policy')
    const E = await paper(4, 'cl5', { correct: [0], wrong: [1] }); await fin(E.stu, E.att)
    const chE = await raise(E.stu, E.att, E.g[1]); const before = await at(E.att); await resolve(E.att, chE, 'resolved_kept')
    x = await at(E.att)
    ok('a dismissed report restores validity and leaves the score, counts and revision unchanged', x.score === before.score && x.s === 8 && x.rev === before.rev && (await count("select count(*) from public.evidence_events where attempt_id=$1 and item_id=$2 and validity='valid'", [E.att, E.g[1]])) === 1 && (await adjustments(E.att)) === 0, JSON.stringify([before, x]))
    const L = await paper(5, 'cl6', { correct: [0, 1], wrong: [2], legacy: true }); await fin(L.stu, L.att)
    const L0 = await at(L.att)
    ok('legacy form: answered-only, 2 of 3 = 67%, policy 1.0; stored counts are answered-based (delivered 3, omitted 0) as they always were', L0.score === 67 && L0.p === '1.0' && L0.d === 3 && L0.o === 0 && L0.s === 3, JSON.stringify(L0))
    const factual = id => a.query(`select (select count(*) from public.form_items fi where fi.form_id=a.form_id)::int delivered, (select count(distinct c.item_id) from public.item_challenges c where c.attempt_id=a.id and c.status='resolved_voided')::int voided, valid_response_count::int answered from public.assessment_attempts a where id=$1`, [id]).then(r => r.rows[0])
    const F0 = await factual(L.att)
    ok('the FACTUAL delivered count (8 on the reserved form) is derivable from the form, not from the legacy stored count', F0.delivered === 8 && F0.answered === 3 && F0.voided === 0, JSON.stringify(F0))
    const chL = await raise(L.stu, L.att, L.g[2]); await resolve(L.att, chL, 'resolved_voided')
    x = await at(L.att)
    ok('legacy rescoring stays answered-only: 2 of 2 = 100%, still policy 1.0 (not converted)', x.score === 100 && x.p === '1.0' && x.c === 2 && x.ans === 2, JSON.stringify(x))
    const F1 = await factual(L.att)
    ok('…the stored legacy meaning is unchanged by the rescore (delivered 3, omitted 0, denominator 2) and the factual counts stay derivable: 8 delivered, 1 voided, 2 answered → 5 not answered', x.d === 3 && x.o === 0 && x.s === 2 && F1.delivered === 8 && F1.voided === 1 && F1.answered === 2 && F1.delivered - F1.voided - F1.answered === 5, JSON.stringify([x, F1]))
    const P = await paper(6, 'cl7', { correct: [0], wrong: [1], practice: true }); await fin(P.stu, P.att)
    ok('a practice paper still scores but writes no evidence', (await at(P.att)).ans === 2 && (await events(P.att, P.g)) === 0)
    const chP = await raise(P.stu, P.att, P.g[1]); await resolve(P.att, chP, 'resolved_voided')
    ok('voiding in practice changes the score with no evidence row to lean on', (await at(P.att)).c === 1 && (await at(P.att)).ans === 1 && (await at(P.att)).s === 7 && (await events(P.att, P.g)) === 0)

    console.log('\nAccess')
    const G = await paper(7, 'cl8', { correct: [0] })
    const other = await student()
    ok('another student cannot report on this attempt', /Response not found/.test((await raise(other, G.att, G.g[0])).err ?? ''))
    ok('an item that is not on the form cannot be reported', /Response not found/.test((await raise(G.stu, G.att, grp(9)[0])).err ?? ''))
    const R = await student(), rr = await reserve(a, R, 'cl9', grp(8))
    ok('a reserved-but-unstarted paper\'s questions cannot be reported (not yet seen)', /Response not found/.test((await raise(R, rr.attemptId, grp(8)[0])).err ?? ''))
    await a.query("insert into public.attempt_item_progress (attempt_id, item_id, user_id, active_seconds, interrupted_seconds, visits) values ($1,$2,$3,0,0,1)", [rr.attemptId, grp(8)[1], R])
    ok('a question the student has OPENED can be reported before anything is answered (paper still ready)', typeof (await raise(R, rr.attemptId, grp(8)[1])) === 'string')
    ok('…while a reserved question they never opened is still refused', /Response not found/.test((await raise(R, rr.attemptId, grp(8)[2])).err ?? ''))
    ok('students cannot resolve challenges or call the internal ledger', /Unauthorized/.test((await as(a, G.stu, "select public.resolve_item_challenge($1,'resolved_voided')", [ch]).catch(e => ({ err: e.message }))).err ?? '') && await fails(as(a, G.stu, "select public._rescore_attempt($1,$2,'x')", [G.att, ch]), /permission denied/))

    console.log('\nSubmit versus resolution on the same attempt (3 rounds)')
    const outcomes = []
    for (let k = 0; k < 3; k++) {
      const S = await paper(9 + k, 'race' + k, { correct: [0], wrong: [1] })
      const c = await raise(S.stu, S.att, S.g[1])
      const c1 = new Client(a.connectionParameters), c2 = new Client(a.connectionParameters); await c1.connect(); await c2.connect(); pool.push(c1, c2)
      const order = k % 2 ? [fin(S.stu, S.att), resolve(S.att, c, 'resolved_voided', c2)] : [resolve(S.att, c, 'resolved_voided', c2), fin(S.stu, S.att)]
      await Promise.all(order)
      let final = await at(S.att)
      // If the resolution won while the paper was still open, it is applied at submission; if submission won, the adjustment follows. Either way the same facts.
      outcomes.push(JSON.stringify([final.score, final.s, final.c, final.ans, final.o, final.d, await count("select count(*) from public.evidence_events where attempt_id=$1 and item_id=$2 and validity='valid'", [S.att, S.g[1]]), (await count('select status from public.assessment_attempts where id=$1 and status=\'scored\'', []).catch(() => 1))]))
      ok(`round ${k + 1}: final facts are 1 correct of 7 scoreable, 6 omitted, no valid evidence for the voided item`, final.score === 14 && final.s === 7 && final.c === 1 && final.ans === 1 && final.o === 6 && final.d === 8 && (await count("select count(*) from public.evidence_events where attempt_id=$1 and item_id=$2 and validity='valid'", [S.att, S.g[1]])) === 0, JSON.stringify(final))
    }

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
