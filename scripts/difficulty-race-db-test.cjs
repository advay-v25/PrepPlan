/** T3 closeout, Pass B: forced interleavings against the REAL schema (two connections, uncommitted transactions held open) proving what
 *  start_paper_checked / practice_run_reserve do when scoring, a challenge-style evidence write or a reviewer reclassification lands between the
 *  accepted-decision comparison and the reservation commit. TEST-ONLY fixture bank + throwaway students, removed by recorded id.
 *  npm run difficulty:race:db:test -- --confirm-target=<project-ref> [--bank=<fixture-bank record>] */
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { Client } = require('pg')
const { openStage } = require('./lib/stage.cjs')

async function main(args = process.argv.slice(2)) {
  const stage = await openStage(args), cfg = stage.cfg; global.__stage = stage
  const given = (args.find(a => a.startsWith('--bank=')) ?? '').slice(7)
  const file = given || path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'race-fixture-')), 'bank.json')
  if (!given) await stage.create(file, ['--readings=r028', '--per-outcome=9', '--variants=1'])
  const bank = JSON.parse(fs.readFileSync(file, 'utf8')), tag = Date.now().toString(36)
  const mk = () => new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 90000 })
  const setup = mk(), A = mk(), B = mk(); await Promise.all([setup.connect(), A.connect(), B.connect()])
  let n = 0; const users = [], evidenceIds = []
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const student = async () => { const id = await one(setup, 'select gen_random_uuid()'); await setup.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `race-${tag}-${users.length}@example.invalid`]); await setup.query('insert into public.profiles (id) values ($1) on conflict do nothing', [id]); users.push(id); return id }
  const reviewer = bank.users[0], man = await one(setup, 'select id from public.curriculum_manifests where is_active limit 1')
  const concept = await one(setup, 'select id from public.curriculum_concepts limit 1')
  const items = (await setup.query('select id, family_id, item_version from public.assessment_items where id = any($1) order by id', [bank.items])).rows
  const singles = []; const seenFam = new Set(); for (const i of items) if (!seenFam.has(i.family_id)) { seenFam.add(i.family_id); singles.push(i) }
  let cursor = 0; const take = () => singles.slice(cursor, (cursor += 5))
  const levelsOf = async ids => (await setup.query(`select i.id, coalesce(c.level,'') level from public.assessment_items i left join public.item_confirmed_difficulty c on c.item_id=i.id and c.item_version=i.item_version where i.id = any($1)`, [ids])).rows.reduce((m, r) => ({ ...m, [r.id]: r.level }), {})
  const paper = (ids, key) => ({ kind: 'weekly', openKey: key, cycle: null, paperKind: 'diagnostic', purpose: 'weekly_cumulative', manifest: man, itemIds: ids, min: 5, requestedScope: { tag }, constraints: { tag }, requested: { tag }, coverage: { delivered: ids.length }, scope: { targets: [], tag }, scopeLabel: 'fixture', scopeRevision: 'rev-1' })
  const reservation = (c, u, evidence, levels, p) => c.query('select public.start_paper_checked($1,$2,$3,$4) r', [u, evidence, JSON.stringify(levels), JSON.stringify(p)]).then(r => r.rows[0].r)
  const asReviewer = async c => { await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [reviewer, JSON.stringify({ sub: reviewer, role: 'authenticated' })]) }
  const reclass = (c, it, level) => c.query('select public.confirm_item_difficulty($1,$2,$3,$4) r', [it.id, it.item_version, level, `race test reclassification ${tag}`]).then(r => r.rows[0].r)
  const pending = async (p, ms = 900) => { let done = false; p.then(() => (done = true), () => (done = true)); await new Promise(r => setTimeout(r, ms)); return !done }
  const attempts = (u, key) => one(setup, 'select count(*) from public.assessment_attempts where user_id=$1 and open_key=$2', [u, key]).then(Number)
  const frozen = attemptId => setup.query('select fi.item_id, fi.difficulty_level, fi.difficulty_basis from public.form_items fi join public.assessment_attempts t on t.form_id=fi.form_id where t.id=$1', [attemptId]).then(r => r.rows)
  const other = l => (l === 'standard' ? 'difficult' : 'standard')

  try {
    console.log('\nProtocol: which writers serialise on the student lock')
    const trg = (await setup.query(`select tgrelid::regclass::text t from pg_trigger where tgname='scope_write_lock' and not tgisinternal`)).rows.map(r => r.t)
    for (const t of ['evidence_events', 'assessment_attempts', 'plan_blocks', 'user_module_state', 'planning_cycles', 'calendar_commitments', 'repair_threads'])
      ok(`${t} writers take scope_lock(user) through scope_write_lock`, trg.includes(t), trg.join())
    ok('the reclassification command locks the question row (FOR UPDATE) that reservations now share-lock', /for update/.test(await one(setup, "select pg_get_functiondef('public.confirm_item_difficulty(text,integer,text,text)'::regprocedure)")))

    console.log('\nControl: the PREVIOUS protocol (compare, no row lock) really had a window')
    {
      const u = await student(), its = take(), ids = its.map(i => i.id), lv = await levelsOf(ids), key = `race-ctl-${tag}`
      await A.query('BEGIN'); await A.query('select public.scope_lock($1)', [u])
      const snap = await levelsOf(ids)                                     // the old compare read these, with no item lock held
      await asReviewer(B); await reclass(B, its[0], other(lv[ids[0]])); await B.query('COMMIT')   // a reviewer commits INSIDE the window — nothing blocks it
      const r = await A.query('select public._reserve_paper_json($1,$2) r', [u, JSON.stringify(paper(ids, key))]); await A.query('COMMIT')
      const fz = await frozen(r.rows[0].r.attemptId), got = fz.find(f => f.item_id === ids[0])
      ok('without the row lock the form froze a level different from the one that was compared', got.difficulty_level !== snap[ids[0]], JSON.stringify({ snap: snap[ids[0]], frozen: got.difficulty_level }))
    }

    console.log('\nPass B-1: a reclassification between the level comparison and the freeze')
    {
      const u = await student(), its = take(), ids = its.map(i => i.id), lv = await levelsOf(ids), key = `race-1a-${tag}`
      await A.query('BEGIN')
      const first = await A.query('select public.start_paper_checked($1,null,$2,$3) r', [u, JSON.stringify(lv), JSON.stringify(paper(ids, key))])
      ok('reservation A (uncommitted) accepted the previewed levels', first.rows[0].r.ok === true)
      await asReviewer(B); const slow = reclass(B, its[0], other(lv[ids[0]]))
      ok('the reviewer\'s reclassification BLOCKS behind the open reservation (it cannot slip between compare and freeze)', await pending(slow))
      await A.query('COMMIT'); const res = await slow; await B.query('COMMIT')
      ok('after A commits the reclassification proceeds', res.ok === true)
      const fz = await frozen(first.rows[0].r.attemptId)
      ok('the committed form pinned EXACTLY the accepted levels, with confirmed basis', fz.every(f => f.difficulty_level === lv[f.item_id] && f.difficulty_basis === 'confirmed'), JSON.stringify(fz))
      ok('and the item is now reclassified for FUTURE forms only', (await levelsOf([ids[0]]))[ids[0]] === other(lv[ids[0]]))
    }
    {
      const u = await student(), its = take(), ids = its.map(i => i.id), lv = await levelsOf(ids), key = `race-1b-${tag}`
      await asReviewer(B); await reclass(B, its[0], other(lv[ids[0]]))      // reviewer holds the row, uncommitted
      const stale = reservation(A, u, null, lv, paper(ids, key))             // the student reserves with the OLD accepted levels
      ok('the reservation waits for the reviewer (no unchecked read of a level that is about to change)', await pending(stale))
      await B.query('COMMIT'); const r = await stale
      ok('then refuses with DECISION_CHANGED', r.ok === false && r.code === 'DECISION_CHANGED', JSON.stringify(r))
      ok('and no attempt, form or exposure exists (no partial reservation)', (await attempts(u, key)) === 0)
      const fresh = await levelsOf(ids), again = await reservation(A, u, null, fresh, paper(ids, key))
      ok('retrying with the refreshed levels succeeds and pins the new level', again.ok === true && (await frozen(again.attemptId)).find(f => f.item_id === ids[0]).difficulty_level === fresh[ids[0]])
    }

    console.log('\nPass B-2/3: scoring or an evidence write (challenge adjustment) between the evidence comparison and the commit')
    const writeEvidence = (c, u) => c.query("insert into public.evidence_events (user_id, concept_id, evidence_state, evidence_mode, validity, scoring_policy_version) values ($1,$2,'supported','evidence','valid',$3) returning id", [u, concept, `race-${tag}-${evidenceIds.length}-${Math.random()}`]).then(r => { evidenceIds.push(r.rows[0].id); return r.rows[0].id })
    {
      const u = await student(), ids = take().map(i => i.id), lv = await levelsOf(ids), v0 = await one(setup, 'select public.difficulty_evidence_version($1)', [u]), key = `race-2a-${tag}`
      await B.query('BEGIN'); await writeEvidence(B, u)                        // another paper finishing scoring: holds the student lock until it commits
      const stale = reservation(A, u, v0, lv, paper(ids, key))
      ok('the reservation waits for the in-flight scoring write', await pending(stale))
      await B.query('COMMIT'); const r = await stale
      ok('then refuses: the evidence it was previewed on has changed', r.ok === false && r.code === 'DECISION_CHANGED' && (await attempts(u, key)) === 0, JSON.stringify(r))
    }
    {
      const u = await student(), ids = take().map(i => i.id), lv = await levelsOf(ids), v0 = await one(setup, 'select public.difficulty_evidence_version($1)', [u]), key = `race-2b-${tag}`
      await A.query('BEGIN')
      const first = await A.query('select public.start_paper_checked($1,$2,$3,$4) r', [u, v0, JSON.stringify(lv), JSON.stringify(paper(ids, key))])
      ok('reservation A accepted the evidence revision it was previewed on', first.rows[0].r.ok === true)
      await B.query('BEGIN'); const w = writeEvidence(B, u)
      ok('a scoring/challenge write arriving mid-reservation WAITS (the form pins the revision it used)', await pending(w))
      await A.query('COMMIT'); await w; await B.query('COMMIT')
      ok('after both commit the form exists and the evidence revision has moved on, so the NEXT preview is honestly stale', (await attempts(u, key)) === 1 && (await one(setup, 'select public.difficulty_evidence_version($1)', [u])) !== v0)
    }
    {
      const u = await student(), ids = take().map(i => i.id), lv = await levelsOf(ids), key = `race-3-${tag}`
      const a0 = await reservation(A, u, null, lv, paper(ids, key + 'x')); ok('probe attempt reserved', a0.ok === true, JSON.stringify(a0))
      const v0 = await one(setup, 'select public.difficulty_evidence_version($1)', [u]), ids2 = take().map(i => i.id), lv2 = await levelsOf(ids2)
      await B.query('BEGIN'); await B.query('update public.assessment_attempts set status = status where id = $1', [a0.attemptId])   // any planning-scope writer fires the same trigger
      const waiting = reservation(A, u, v0, lv2, paper(ids2, key))
      ok('a scope/planning-table writer holding the student lock makes a reservation wait', await pending(waiting))
      await B.query('COMMIT'); const r = await waiting
      ok('and once released the reservation completes against committed state', r.ok === true)
    }

    console.log('\nPractice reservation uses the same level lock')
    {
      const u = await student(), its = take(), ids = its.map(i => i.id), lv = await levelsOf(ids)
      await asReviewer(B); await reclass(B, its[0], other(lv[ids[0]]))
      const p = { ...paper(ids, null), kind: 'practice', openKey: null, levels: lv }
      const stale = A.query('select public.practice_run_reserve($1,null,$2,null,$3,$4,$5) r', [u, `race-pr-${tag}-1`, JSON.stringify({ readingId: 'r028', outcomeIds: [], cap: 10, policy: 'difficulty-policy.1/practice' }), JSON.stringify({}), JSON.stringify(p)]).then(r => r.rows[0].r)
      ok('a practice set reserved on levels the reviewer is changing waits', await pending(stale))
      await B.query('COMMIT'); const r = await stale
      ok('and refuses with DECISION_CHANGED, creating no run', r.ok === false && r.code === 'DECISION_CHANGED' && Number(await one(setup, 'select count(*) from public.practice_runs where user_id=$1', [u])) === 0, JSON.stringify(r))
    }
    console.log(`\n${n} passed, 0 failed`)
  } finally {
    for (const c of [A, B]) await c.query('ROLLBACK').catch(() => {})
    try {
      if (evidenceIds.length) await setup.query('delete from public.evidence_events where id = any($1)', [evidenceIds])
      for (const u of users) {
        const att = (await setup.query('select id, form_id from public.assessment_attempts where user_id=$1', [u])).rows
        await setup.query('delete from public.practice_runs where user_id=$1', [u])
        if (att.length) { await setup.query('delete from public.assessment_attempts where id = any($1)', [att.map(a => a.id)]); await setup.query('delete from public.form_items where form_id = any($1)', [att.map(a => a.form_id)]); await setup.query('delete from public.assessment_forms where id = any($1)', [att.map(a => a.form_id)]) }
        await setup.query('delete from public.profiles where id=$1', [u]); await setup.query('delete from auth.users where id=$1', [u])
      }
    } catch (e) { console.error('cleanup:', e.message) }
    await Promise.all([setup.end(), A.end(), B.end()]).catch(() => {})
    if (!given) await stage.destroy(file)
  }
}
main().then(() => global.__stage?.stop()).catch(async e => { console.error(e); await global.__stage?.stop(); process.exit(1) })
