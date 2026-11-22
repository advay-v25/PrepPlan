/** Phase 3 proof on the REAL development schema: the single atomic paper reservation and the eligibility rule it shares with the
 *  pools. Uses a TEST-ONLY approved fixture bank (scripts/fixture-bank.cjs) and throwaway students; every row is removed by recorded id.
 *  npm run paper:db:test -- --confirm-target=<project-ref> */
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
  execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'create', target, `--out=${file}`, '--readings=r028', '--per-outcome=5', '--variants=1'], { stdio: 'inherit' })
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

  // Fixture structure: items grouped by outcome and family.
  const items = (await a.query("select id, outcome_id, family_id from public.assessment_items where id = any($1) order by id", [bank.items])).rows
  const byFam = new Map(); for (const i of items) byFam.set(i.family_id, [...(byFam.get(i.family_id) ?? []), i.id])
  const single = [...byFam.values()].filter(v => v.length === 1).map(v => v[0])        // families with one question
  const variantPair = [...byFam.values()].find(v => v.length === 2)                      // a family with a reworded variant
  const five = single.slice(0, 5), ten = single.slice(0, 10)

  try {
    console.log('\nEligibility rule')
    const legacy = await count("select count(*) from public.assessment_items i where review_status='reviewed' and provenance <> 'fixture-bank' and not exists (select 1 from public.item_review_decisions d where d.item_id=i.id and d.decision='approve')")
    const legacyIds = (await a.query("select id from public.assessment_items i where review_status='reviewed' and provenance <> 'fixture-bank' and not exists (select 1 from public.item_review_decisions d where d.item_id=i.id and d.decision='approve') limit 3")).rows.map(r => r.id)
    const stu = await student()
    ok('the legacy items marked reviewed (no recorded decision) are not eligible for a new paper', legacy === 0 || ((await one(a, 'select paper_item_defects($1,$2)', [stu, legacyIds])).every(d => d.code === 'NO_APPROVAL') && (await count('select count(*) from public.student_eligible_items where id = any($1)', [legacyIds])) === 0), `legacy=${legacy}`)
    ok('they keep their historical status (reviewed) — nothing was relabelled', legacy === 0 || (await count("select count(*) from public.assessment_items where id = any($1) and review_status='reviewed'", [legacyIds])) === legacyIds.length)
    ok('every approved fixture question is in the eligible view', (await count('select count(*) from public.student_eligible_items where id = any($1)', [bank.items])) === bank.items.length)
    ok('five independent approved questions have no defects', (await one(a, 'select paper_item_defects($1,$2)', [stu, five])).length === 0)

    console.log('\nLegacy decision path (a fixture that mimics an item marked reviewed with no recorded decision)')
    const proto = (await a.query("select * from public.assessment_items where id=$1", [single[10]])).rows[0], legacyId = `fxb-${bank.tag}-legacy`
    await a.query('BEGIN'); await a.query("select set_config('app.review_command','on',true)")
    await a.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, concept_id, outcome_id, key_index, item_card, item_version, cognition, item_form, intended_difficulty, reviewed_at)
      values ($1,$2,'fx','fx',1,$3,$4::jsonb,$5::jsonb,'fixture-bank','reviewed',$6,$7,$8,$9::jsonb,1,'apply','direct','standard', now())`,
      [legacyId, proto.lm_id, `Legacy-style fixture ${legacyId}: which statement follows when the stated assumption holds in this worked example?`, JSON.stringify(proto.options.map(o => `${o} (legacy)`)), JSON.stringify(proto.per_option_feedback), proto.concept_id, proto.outcome_id, proto.key_index, JSON.stringify(proto.item_card)])
    await a.query('COMMIT')
    bank.items.push(legacyId); fs.writeFileSync(file, JSON.stringify(bank))
    await a.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"editorial\",\"detail\":\"ok\"}',1), ($1,'editorial_verifier','PASS','{\"gate\":\"verdict\",\"detail\":\"fixture\"}',1)", [legacyId])
    ok('it is marked reviewed but is not eligible for a new paper', (await one(a, "select review_status from public.assessment_items where id=$1", [legacyId])) === 'reviewed' && (await one(a, 'select paper_item_defects($1,$2)', [stu, [legacyId]]))[0]?.code === 'NO_APPROVAL')
    await as(a, reviewer, 'select public.confirm_item_difficulty($1,1,$2,$3) as r', [legacyId, 'standard', 'test-only: a direct application with one stated assumption'])
    const lr = await as(a, reviewer, 'select public.decide_item_review($1,1,$2,$3,false) as r', [legacyId, 'approve', 'documented decision for a legacy item'])
    ok('a reviewer can record the missing decision through the normal command, without changing the item', lr.ok === true && (await one(a, "select review_status from public.assessment_items where id=$1", [legacyId])) === 'reviewed' && (await count("select count(*) from public.item_review_decisions where item_id=$1 and decision='approve'", [legacyId])) === 1)
    ok('and it is then eligible', (await one(a, 'select paper_item_defects($1,$2)', [stu, [legacyId]])).length === 0)

    console.log('\nAtomic reservation')
    const before = { bp: await count("select count(*) from public.assessment_blueprints where constraints->>'tag'=$1", [tag]) }
    const r1 = await reserve(a, stu, 'k1', five)
    ok('a valid reservation succeeds', r1.ok === true && r1.resumed === false && r1.questions === 5, JSON.stringify(r1))
    ok('one attempt, five pinned questions with their approved version, and the policy recorded', (await attemptsFor(stu, 'k1')) === 1 && Number(await itemsOf(r1.attemptId)) === 5
      && (await count('select count(*) from public.form_items fi join public.assessment_attempts t on t.form_id=fi.form_id where t.id=$1 and fi.item_version = 1', [r1.attemptId])) === 5
      && (await one(a, 'select eligibility_policy from public.assessment_attempts where id=$1', [r1.attemptId])) === 'approved-version-v1')
    ok('the scope snapshot is stored with the attempt', (await count('select count(*) from public.paper_scope_snapshots where attempt_id=$1', [r1.attemptId])) === 1)
    const r1b = await reserve(a, stu, 'k1', five)
    ok('a retry resumes the same attempt and creates nothing', r1b.ok && r1b.resumed === true && r1b.attemptId === r1.attemptId && (await attemptsFor(stu, 'k1')) === 1
      && (await count("select count(*) from public.assessment_blueprints where constraints->>'tag'=$1", [tag])) === before.bp + 1)

    const cs = await Promise.all(Array.from({ length: 8 }, async () => { const c = mk(); await c.connect(); pool.push(c); return c }))
    const race = await Promise.all(cs.map(c => reserve(c, stu, 'k2', ten).catch(e => ({ ok: false, err: e.message }))))
    ok('eight concurrent starts resume ONE attempt', race.every(r => r.ok) && new Set(race.map(r => r.attemptId)).size === 1 && race.filter(r => r.resumed === false).length === 1, JSON.stringify(race.map(r => r.resumed)))
    ok('and leave exactly one attempt, one form and no orphan rows for the key', (await attemptsFor(stu, 'k2')) === 1 && (await count("select count(*) from public.assessment_blueprints where constraints->>'tag'=$1", [tag])) === before.bp + 2)

    console.log('\nRefusals write nothing')
    const rows = () => count("select count(*) from public.assessment_blueprints where constraints->>'tag'=$1", [tag])
    const b0 = await rows()
    const thin = await reserve(a, stu, 'k3', five.slice(0, 4))
    ok('insufficient depth is refused with the count', thin.ok === false && thin.code === 'BANK_INSUFFICIENT' && thin.deliverable === 4 && (await attemptsFor(stu, 'k3')) === 0 && (await rows()) === b0)
    ok('more than 90 questions is refused', await fails(reserve(a, stu, 'k90', Array.from({ length: 91 }, (_, i) => `x${i}`)), /cannot exceed 90/) && (await rows()) === b0)
    const fam = await reserve(a, stu, 'k4', [...five.slice(0, 4), ...variantPair])
    ok('two variants of one family cannot share a paper', fam.ok === false && fam.code === 'BANK_CHANGED' && fam.defects.some(d => d.code === 'DUPLICATE_FAMILY') && (await rows()) === b0, JSON.stringify(fam))
    const dupe = await reserve(a, stu, 'k5', [...five.slice(0, 4), five[0]])
    ok('a question listed twice is refused', dupe.ok === false && dupe.defects.some(d => d.code === 'DUPLICATE_ITEM'))
    const gone = await reserve(a, stu, 'k6', [...five.slice(0, 4), 'no-such-item'])
    ok('a missing question is refused', gone.ok === false && gone.defects.some(d => d.code === 'NOT_FOUND'))
    const wrongCycle = await reserve(a, stu, 'k7', five, { cycle: await one(a, 'select gen_random_uuid()') })
    ok('a cycle that is not the student\'s open week is refused', wrongCycle.ok === false && wrongCycle.code === 'CYCLE_CHANGED' && (await rows()) === b0)

    console.log('\nSeen items and families')
    // Answer one fixture question for a second student, then ask for it and for its same-family variant.
    const s2 = await student()
    const g = await reserve(a, s2, 'g1', five); ok('second student: first paper reserved', g.ok === true)
    const answered = variantPair[0]
    const seenAttempt = await one(a, "insert into public.assessment_attempts (user_id, form_id, delivery_mode, status, attempt_kind, open_key) values ($1,(select form_id from public.assessment_attempts where id=$2),'fixed','scored','weekly','seen-1') returning id", [s2, g.attemptId])
    await a.query("insert into public.assessment_responses (attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1,$2,$3,0,true,3)", [seenAttempt, answered, s2])
    const sameQ = await one(a, 'select paper_item_defects($1,$2)', [s2, [answered, ...five.filter(i => i !== answered).slice(0, 4)]])
    ok('a question the student answered is not fresh (SEEN)', sameQ.some(d => d.itemId === answered && d.code === 'SEEN'), JSON.stringify(sameQ))
    const sib = await one(a, 'select paper_item_defects($1,$2)', [s2, [variantPair[1], ...five.filter(i => !variantPair.includes(i)).slice(0, 4)]])
    ok('a reworded variant of an answered question is not independent (SEEN_FAMILY)', sib.some(d => d.itemId === variantPair[1] && d.code === 'SEEN_FAMILY'), JSON.stringify(sib))
    const other = await one(a, 'select paper_item_defects($1,$2)', [stu, [variantPair[1], ...five.filter(i => !variantPair.includes(i)).slice(0, 4)]])
    ok('the same variant is fresh for a student who has not seen the family', other.length === 0, JSON.stringify(other))

    console.log('\nExact approved version, hold-out, retirement')
    const probe = single[6]
    await a.query('update public.assessment_items set item_version = item_version + 1 where id=$1', [probe])
    ok('a new version without its own approval is not eligible', (await one(a, 'select paper_item_defects($1,$2)', [stu, [probe]]))[0]?.code === 'NO_APPROVAL' && (await count('select count(*) from public.student_eligible_items where id=$1', [probe])) === 0)
    await a.query('update public.assessment_items set item_version = item_version - 1 where id=$1', [probe])
    const held = single[7]
    await a.query('update public.assessment_items set held_out = true where id=$1', [held])
    ok('a held-out question is not eligible', (await one(a, 'select paper_item_defects($1,$2)', [stu, [held]]))[0]?.code === 'HELD_OUT' && (await count('select count(*) from public.student_eligible_items where id=$1', [held])) === 0)
    await a.query('update public.assessment_items set held_out = false where id=$1', [held])

    // Retirement after reservation: the reserved paper keeps its pinned questions and still scores as evidence.
    const X = five[0]
    const r1x = await as(a, reviewer, 'select public.decide_item_review($1,1,$2,$3,false) as r', [X, 'retire', 'test retirement after reservation']).catch(e => ({ err: e.message }))
    ok('a reviewer can retire a question that is in a reserved paper', r1x?.ok === true || r1x?.status === 'deprecated', JSON.stringify(r1x))
    ok('the reserved paper still holds its five pinned questions', Number(await itemsOf(r1.attemptId)) === 5)
    const afterRetire = await reserve(a, await student(), 'k8', five)
    ok('a NEW paper cannot include the retired question', afterRetire.ok === false && afterRetire.defects.some(d => d.itemId === X && d.code === 'NOT_REVIEWED'), JSON.stringify(afterRetire))
    for (const [i, id] of five.entries()) await a.query("insert into public.assessment_responses (attempt_id, item_id, user_id, selected_option_index, is_correct, self_reported_confidence) values ($1,$2,$3,$4,true,3)", [r1.attemptId, id, stu, 0])
    await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [r1.attemptId])
    const fin = await as(a, stu, "select public.finalize_assessment_attempt($1,'1.0',$2) as r", [r1.attemptId, 'test']).catch(e => ({ err: e.message }))
    const ev = await count("select count(*) from public.evidence_events where attempt_id=$1 and item_id=$2 and validity='valid'", [r1.attemptId, X])
    ok('the retired question\'s answer in the already-reserved paper still scores and counts (approval was recorded)', fin?.ok === true && ev === 1, JSON.stringify(fin).slice(0, 160))
    ok('the historical paper is unchanged: five responses, five questions', (await count('select count(*) from public.assessment_responses where attempt_id=$1', [r1.attemptId])) === 5)

    console.log('\nScope race and exposure')
    const fresh5 = single.slice(13, 18)
    const s5 = await student(), src0 = await one(a, 'select public.paper_scope_source($1)', [s5])
    const stale = await a.query('select public.start_assessment_paper($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) as r', [s5, 'weekly', 'src1', null, 'diagnostic', 'weekly_cumulative', man, fresh5, 5, '{}', '{}', JSON.stringify({ tag }), '{}', null, 'f', 'r', null, null, false, 'a-version-from-before-the-edit']).then(r => r.rows[0].r)
    ok('a reservation from an old scope version is refused and leaves no attempt or form', stale.ok === false && stale.code === 'SCOPE_CHANGED' && (await attemptsFor(s5, 'src1')) === 0)
    const fresh = await a.query('select public.start_assessment_paper($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) as r', [s5, 'weekly', 'src2', null, 'diagnostic', 'weekly_cumulative', man, fresh5, 5, '{}', '{}', JSON.stringify({ tag }), '{}', null, 'f', 'r', null, null, false, src0]).then(r => r.rows[0].r)
    ok('the current version is accepted', fresh.ok === true)
        // Delivered but unanswered: the paper was opened, so its questions were shown.
    const s6 = await student(), g6 = await reserve(a, s6, 'ex1', fresh5)
    ok('a question in a paper that was only reserved is not yet exposed', (await one(a, 'select paper_item_defects($1,$2)', [s6, fresh5])).length === 0)
    await a.query("update public.assessment_attempts set status='in_progress' where id=$1", [g6.attemptId])
    const exposed = await one(a, 'select paper_item_defects($1,$2)', [s6, fresh5])
    ok('once the paper is opened, its UNANSWERED questions are exposed too', exposed.length === 5 && exposed.every(d => d.code === 'SEEN'), JSON.stringify(exposed))
    const fam0 = single[18]
    await a.query('update public.assessment_items set family_id = null where id=$1', [fam0])
    ok('an unknown family is allowed in a paper but cannot count as independent on a re-check', (await one(a, 'select paper_item_defects($1,$2)', [stu, [fam0]])).length === 0 && (await one(a, 'select paper_item_defects($1,$2,true)', [stu, [fam0]]))[0]?.code === 'UNKNOWN_FAMILY')

    console.log('\nRollback')
    await a.query("create or replace function public.fx_pc_fail() returns trigger language plpgsql as $$ begin raise exception 'forced failure after the attempt row'; end $$")
    await a.query('create trigger fx_pc_fail before insert on public.paper_scope_snapshots for each row execute function public.fx_pc_fail()')
    const stu3 = await student(), b1 = await rows()
    const fi = () => count("select count(*) from public.form_items fi join public.assessment_forms f on f.id=fi.form_id join public.assessment_blueprints b on b.id=f.blueprint_id where b.constraints->>'tag'=$1", [tag])
    const fi1 = await fi()
    const forced = await fails(reserve(a, stu3, 'k9', single.slice(8, 13)), /forced failure/)
    ok('a failure after the attempt row rolls the whole reservation back', forced && (await attemptsFor(stu3, 'k9')) === 0 && (await rows()) === b1 && (await fi()) === fi1)
    await a.query('drop trigger if exists fx_pc_fail on public.paper_scope_snapshots'); await a.query('drop function if exists public.fx_pc_fail()')
    const again = await reserve(a, stu3, 'k9', single.slice(8, 13))
    ok('after the fault is gone the same request succeeds (nothing stuck)', again.ok === true && again.resumed === false)

    console.log(`\n${n} passed, 0 failed\n`)
  } finally {
    await a.query('drop trigger if exists fx_pc_fail on public.paper_scope_snapshots').catch(() => {}); await a.query('drop function if exists public.fx_pc_fail()').catch(() => {})
    for (const c of pool) await c.end().catch(() => {})
    // Fixture rows first (the bank's destroy also removes every attempt that used its questions), then the throwaway students.
    try { execFileSync('node', [path.join(__dirname, 'fixture-bank.cjs'), 'destroy', target, `--file=${file}`], { stdio: 'inherit' }) } catch (e) { console.error('fixture cleanup failed:', e.message) }
    await a.query('delete from public.assessment_attempts where user_id = any($1)', [users]).catch(e => console.error('cleanup attempts:', e.message))
    await a.query('delete from public.profiles where id = any($1)', [users]).catch(() => {}); await a.query('delete from auth.users where id = any($1)', [users]).catch(() => {})
    await a.end()
  }
}
main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
