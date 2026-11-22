/** Test-only question bank for the development project. Creates human-APPROVED fixture questions (through the real
 *  `decide_item_review` command, by a throwaway reviewer) so papers, results and re-checks can be exercised end to end, and removes
 *  them by recorded id. Fixture items are never real inventory: provenance 'fixture-bank', ids 'fxb-<tag>-…', concepts 'Fixture …'.
 *
 *    node scripts/fixture-bank.cjs create  --confirm-target=<ref> --out=<file> [--readings=r028,r029] [--per-outcome=8] [--variants=1]
 *    node scripts/fixture-bank.cjs destroy --confirm-target=<ref> --file=<file>
 *  Rehearsal mode (adds HELD-OUT approved fixture families across every topic, for the linked-mock journey):
 *    create … --rehearsal=<families-per-topic | auto> [--topic-families=fi:15,eq:30]   (auto = the official 2027 maximum for the topic + 2)
 */
const fs = require('node:fs'), path = require('node:path')
const { Client } = require('pg'); const { parse } = require('dotenv')
const { configuration } = require('./lib/migrations.cjs')

const arg = (args, k, d) => (args.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=') || d
const DIAG = [{ errorCode: 'C', description: 'treats the stated assumption as if it never applied' }, { errorCode: 'S', description: 'reverses the direction of the adjustment' }]

async function connect(args) {
  const root = path.resolve(__dirname, '..'), env = parse(fs.readFileSync(path.join(root, '.env.staging.local')))
  const cfg = configuration(['--env=staging', '--dry-run'], env)
  if (!env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF || env.E2E_CONFIRMED_DISPOSABLE_PROJECT_REF !== cfg.identity) throw Error('Not the user-confirmed disposable project; refusing.')
  if (!args.includes(`--confirm-target=${cfg.identity}`)) throw Error(`Pass --confirm-target=${cfg.identity}.`)
  const c = new Client({ ...cfg.connection, connectionTimeoutMillis: 45000, keepAlive: true, query_timeout: 120000 }); await c.connect(); return c
}
const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]

async function create(args) {
  const out = arg(args, 'out'); if (!out) throw Error('--out=<file> is required')
  const readings = arg(args, 'readings', 'r028,r029').split(','), per = Number(arg(args, 'per-outcome', 8)), variants = Number(arg(args, 'variants', 1))
  const c = await connect(args), tag = Date.now().toString(36), rec = { tag, items: [], concepts: [], families: [], users: [], approvals: 0 }
  const save = () => fs.writeFileSync(out, JSON.stringify(rec, null, 1))
  try {
    const man = await one(c, 'select id from public.curriculum_manifests where is_active and (capabilities->>\'blueprint_available\')::boolean limit 1')
    const uid = async kind => { const id = await one(c, 'select gen_random_uuid()'); await c.query('insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())', [id, `fxb-${kind}-${tag}@example.invalid`]); await c.query('insert into public.profiles (id) values ($1) on conflict do nothing', [id]); rec.users.push(id); save(); return id }
    const rev = await uid('rev'); await c.query("insert into public.user_roles (user_id, role) values ($1,'diagnostic_reviewer')", [rev])
    const LEVELS = ['foundation', 'standard', 'difficult', 'stretch']
    const decide = async (item, ver) => {
      // The real reviewer commands: a level and rationale are confirmed for the exact version, then the item is approved. Synthetic labels exercise software branching; they are not CFA calibration.
      const prop = await one(c, 'select intended_difficulty from public.assessment_items where id=$1', [item])
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
      await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [rev, JSON.stringify({ sub: rev, role: 'authenticated' })])
      try {
        const cf = (await c.query('select public.confirm_item_difficulty($1,$2,$3,$4) as r', [item, ver, LEVELS.includes(prop) ? prop : 'standard', 'test-only fixture: synthetic label to exercise branching, not a CFA calibration'])).rows[0].r
        if (!cf.ok) throw Error(`difficulty confirmation failed for ${item}: ${JSON.stringify(cf)}`)
        const r = (await c.query('select public.decide_item_review($1,$2,$3,$4,$5) as r', [item, ver, 'approve', 'test-only fixture bank', false])).rows[0].r; await c.query('COMMIT'); return r }
      catch (e) { await c.query('ROLLBACK'); throw e }
    }
    const holdout = async family => {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
      await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [rev, JSON.stringify({ sub: rev, role: 'authenticated' })])
      try { const r = (await c.query('select public.set_item_holdout($1,null,true,$2) as r', [family, 'test-only fixture hold-out'])).rows[0].r; await c.query('COMMIT'); if (!r.ok) throw Error(JSON.stringify(r)) }
      catch (e) { await c.query('ROLLBACK'); throw e }
    }
    let seq = 0
    const rehearsal = arg(args, 'rehearsal', ''), override = Object.fromEntries(arg(args, 'topic-families', '').split(',').filter(Boolean).map(x => x.split(':')).map(([k, v]) => [k, Number(v)]))
    const diffs = ['foundation', 'standard', 'difficult'], cogs = ['recall', 'apply', 'calculate', 'interpret'], forms = ['direct', 'scenario', 'calculation']
    if (rehearsal) {
      const topics = (await c.query('select id, exam_weight_min::float lo, exam_weight_max::float hi from public.topics order by id')).rows
      for (const t of topics) {
        // 2027 grouping: a topic feeds ONE session, never more than its official maximum of the 180 questions, so max + 2 families is always enough.
        const alloc = Math.floor(t.hi * 1.8 + 1e-9)
        const want = override[t.id] ?? (rehearsal === 'auto' ? alloc + 2 : Number(rehearsal))
        const outs = (await c.query(`select l.id, l.reading_id from public.reading_los l join public.curriculum_readings r on r.id = l.reading_id where r.topic_id=$1 and r.is_active order by l.reading_id, l.id`, [t.id])).rows
        if (!outs.length) continue
        const conceptOf = new Map()
        for (let k = 0; k < want; k++) {
          const o = outs[k % outs.length], reading = o.reading_id
          if (!conceptOf.has(o.id)) {
            const concept = await one(c, 'select gen_random_uuid()')
            await c.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes) values ($1,$2,'Fixture','Fixture','fx','fx',$3,'core',$4,'verified','fixture scope')", [concept, man, `Fixture ${tag} ${o.id}`, reading])
            await c.query('insert into public.concept_outcome_map (concept_id, outcome_id, approximate) values ($1,$2,false)', [concept, o.id]); rec.concepts.push(concept); conceptOf.set(o.id, concept); save()
          }
          const concept = conceptOf.get(o.id)
          const fam = await one(c, "insert into public.item_families (family_key, note) values ($1,$2) returning id", [`fxb-${tag}-${t.id}-${k}`, 'test-only fixture family (held out)']); rec.families.push(fam)
          const id = `fxb-${tag}-${++seq}`, key = seq % 3
          await c.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, concept_id, outcome_id, key_index, item_card, item_version, family_id, cognition, item_form, intended_difficulty, generator_model)
            values ($1,$2,'fx','fx',1,$3,$4::jsonb,$5::jsonb,'fixture-bank','verified',$6,$7,$8,$9::jsonb,1,$10,$11,$12,$13,'fixture')`,
            [id, reading, `Fixture question ${id} on ${o.id} (${t.id}): which statement follows when the stated assumption holds in this worked example?`,
              JSON.stringify([`Option A of ${id}`, `Option B of ${id}`, `Option C of ${id}`]), JSON.stringify({ 0: 'Because the working holds.', 1: 'Wrong because the assumption is ignored.', 2: 'Wrong because the direction is reversed.' }),
              concept, o.id, key, JSON.stringify({ solution: 'Worked solution long enough to count as a real explanation of the answer.', distractorDiagnoses: [0, 1, 2].filter(i => i !== key).map((optionIndex, j) => ({ optionIndex, ...DIAG[j % 2] })) }),
              fam, cogs[seq % cogs.length], forms[seq % forms.length], diffs[seq % diffs.length]])
          rec.items.push(id); save()
          await c.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"editorial\",\"detail\":\"ok\"}',1), ($1,'editorial_verifier','PASS','{\"gate\":\"verdict\",\"detail\":\"fixture\"}',1)", [id])
          const r = await decide(id, 1); if (!r.ok) throw Error(`approval failed for ${id}: ${JSON.stringify(r)}`); rec.approvals++
          await holdout(fam)
        }
      }
    }
    for (const reading of rehearsal ? [] : readings) {
      const outs = (await c.query('select id from public.reading_los where reading_id=$1 order by id', [reading])).rows
      for (const o of outs) {
        const concept = await one(c, 'select gen_random_uuid()')
        await c.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes) values ($1,$2,'Fixture','Fixture','fx','fx',$3,'core',$4,'verified','fixture scope')", [concept, man, `Fixture ${tag} ${o.id}`, reading])
        await c.query('insert into public.concept_outcome_map (concept_id, outcome_id, approximate) values ($1,$2,false)', [concept, o.id]); rec.concepts.push(concept); save()
        const fam = []
        for (let k = 0; k < per; k++) { const f = await one(c, "insert into public.item_families (family_key, note) values ($1,$2) returning id", [`fxb-${tag}-${o.id}-${k}`, 'test-only fixture family']); fam.push(f); rec.families.push(f) }
        const mk = async (family, n, variantOf = null) => {
          const id = `fxb-${tag}-${++seq}`, key = seq % 3
          await c.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, concept_id, outcome_id, key_index, item_card, item_version, family_id, cognition, item_form, intended_difficulty, generator_model)
            values ($1,$2,'fx','fx',1,$3,$4::jsonb,$5::jsonb,'fixture-bank','verified',$6,$7,$8,$9::jsonb,1,$10,$11,$12,$13,'fixture')`,
            [id, reading, `Fixture question ${id} on ${o.id}${variantOf ? ` (a reworded variant of ${variantOf})` : ''}: which statement follows when the stated assumption holds in this worked example?`,
              JSON.stringify([`Option A of ${id}`, `Option B of ${id}`, `Option C of ${id}`]), JSON.stringify({ 0: 'Because the working holds.', 1: 'Wrong because the assumption is ignored.', 2: 'Wrong because the direction is reversed.' }),
              concept, o.id, key, JSON.stringify({ solution: 'Worked solution long enough to count as a real explanation of the answer.', distractorDiagnoses: [0, 1, 2].filter(i => i !== key).map((optionIndex, j) => ({ optionIndex, ...DIAG[j % 2] })) }),
              family, cogs[n % cogs.length], forms[n % forms.length], diffs[n % diffs.length]])
          rec.items.push(id); save()
          await c.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"editorial\",\"detail\":\"ok\"}',1)", [id])
          await c.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"verdict\",\"detail\":\"fixture\"}',1)", [id])
          const r = await decide(id, 1); if (!r.ok) throw Error(`approval failed for ${id}: ${JSON.stringify(r)}`); rec.approvals++
          return id
        }
        for (let k = 0; k < per; k++) {
          const first = await mk(fam[k], k)
          if (k < variants) await mk(fam[k], k + 1, first)   // a reworded variant inside the same family: not independent evidence
        }
      }
    }
    // Test-only reviewer candidates (for the browser reviewer journey): automatically checked, in a batch whose rights are cleared by a FIXTURE authority,
    // with a provisional family and a concept that still needs a person to sign it off. Nothing is approved here; the reviewer does that in the UI.
    const nCand = Number(arg(args, 'candidates', 0))
    if (nCand > 0 && !rehearsal) {
      const reading = readings[0], o = (await c.query('select id from public.reading_los where reading_id=$1 order by id limit 1', [reading])).rows[0]
      const concept = await one(c, 'select gen_random_uuid()')
      await c.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes, excluded_or_superseded) values ($1,$2,'Fixture','Fixture','fx','fx',$3,'core',$4,'drafted','Fixture scope: how a stated assumption changes a worked example.','Fixture exclusion: anything outside the worked example.')", [concept, man, `Fixture ${tag} candidate concept`, reading])
      await c.query('insert into public.concept_outcome_map (concept_id, outcome_id, approximate) values ($1,$2,false)', [concept, o.id]); rec.concepts.push(concept); rec.candidateConcept = concept; save()
      const batch = await one(c, "insert into public.item_batches (request_key, label, manifest_id, curriculum_version, source_provenance, rights_status, rights_ref, prompt_version, requested_count, status) values ($1,$2,$3,'fixture','{\"packs\":[\"fixture-pack@1\"]}'::jsonb,'cleared','FIXTURE authority (test-only, not a real rights decision)','fixture',$4,'complete') returning id", [`fxb-${tag}-cand`, `Fixture candidates ${tag}`, man, nCand])
      rec.batches = [batch]; rec.candidates = []; save()
      for (let k = 0; k < nCand; k++) {
        const fam = await one(c, "insert into public.item_families (family_key, note, construction_status) values ($1,$2,'provisional') returning id", [`fxb-${tag}-cand-${k}`, 'test-only fixture family (provisional)']); rec.families.push(fam)
        const id = `fxb-${tag}-cand-${k}`, key = k % 3
        await c.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, concept_id, outcome_id, key_index, item_card, item_version, family_id, cognition, item_form, intended_difficulty, generator_model, verifier_model, batch_id)
          values ($1,$2,'fx','fx',1,$3,$4::jsonb,$5::jsonb,'fixture-bank','verified',$6,$7,$8,$9::jsonb,1,$10,'apply','scenario','standard','fixture-generator','fixture-verifier',$11)`,
          [id, reading, `Fixture candidate ${id}: which statement follows when the stated assumption holds in this worked example?`,
            JSON.stringify([`Candidate option A of ${id}`, `Candidate option B of ${id}`, `Candidate option C of ${id}`]), JSON.stringify({ 0: 'Because the working holds.', 1: 'Wrong because the assumption is ignored.', 2: 'Wrong because the direction is reversed.' }),
            concept, o.id, key, JSON.stringify({ solution: 'Worked solution long enough to count as a real explanation of the answer.', isNumeric: false, packId: 'fixture-pack', packVersion: '1', packEdition: '2027', packetHash: 'fixturehash000000', packSource: { name: 'Synthetic fixture source (not a real publication)', location: 'fixture p. 1', hash: 'fixturefile000000' }, package: { writer: 'writer.fixture', solver: 'solver.fixture' }, distractorDiagnoses: [0, 1, 2].filter(i => i !== key).map((optionIndex, j) => ({ optionIndex, ...DIAG[j % 2] })) }),
            fam, batch])
        rec.items.push(id); rec.candidates.push(id); save()
        await c.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"editorial\",\"detail\":\"solved cold to the declared key (fixture)\"}',1), ($1,'editorial_verifier','PASS','{\"gate\":\"verdict\",\"detail\":\"all gates passed (fixture)\"}',1)", [id])
      }
    }
    save(); console.log(JSON.stringify({ tag, items: rec.items.length, families: rec.families.length, concepts: rec.concepts.length, approvals: rec.approvals, file: out }))
  } catch (e) { save(); console.error('create failed:', e.message, '- recorded rows remain in', out, '; run destroy'); process.exitCode = 1 } finally { await c.end() }
}

async function destroy(args) {
  const file = arg(args, 'file'); if (!file) throw Error('--file=<file> is required')
  const rec = JSON.parse(fs.readFileSync(file, 'utf8')), c = await connect(args)
  // A reviewer edit of a fixture item creates a successor version that the record does not list; it is the fixture's own row, so it goes too.
  for (let more = [1]; more.length;) { more = (await c.query('select id from public.assessment_items where supersedes_item_id = any($1) and id <> all($1)', [rec.items])).rows.map(r => r.id); rec.items.push(...more) }
  const run = async (label, sql, p) => { try { return (await c.query(sql, p)).rowCount } catch (e) { console.error(`cleanup ${label}:`, e.message); return 0 } }
  try {
    const attempts = (await c.query('select distinct a.id, a.form_id from public.assessment_attempts a where a.form_id in (select form_id from public.form_items where item_id = any($1)) or a.id in (select attempt_id from public.assessment_responses where item_id = any($1))', [rec.items])).rows
    const aIds = attempts.map(a => a.id), forms = attempts.map(a => a.form_id).filter(Boolean)
    const bps = forms.length ? (await c.query('select blueprint_id from public.assessment_forms where id = any($1)', [forms])).rows.map(r => r.blueprint_id) : []
    const threads = (await c.query('select id from public.repair_threads where concept_id = any($1) or opened_from_attempt_id = any($2)', [rec.concepts, aIds])).rows.map(r => r.id)
    if (threads.length) {
      await run('check links', 'delete from public.repair_check_threads where thread_id = any($1)', [threads])
      await run('thread events', 'delete from public.repair_thread_events where thread_id = any($1)', [threads])
      await run('thread tasks', 'update public.plan_blocks set repair_thread_id = null where repair_thread_id = any($1)', [threads])
      await run('threads', 'delete from public.repair_threads where id = any($1)', [threads])
    }
    await run('evidence', 'delete from public.evidence_events where item_id = any($1) or attempt_id = any($2)', [rec.items, aIds])
    await run('challenges', 'delete from public.item_challenges where item_id = any($1) or attempt_id = any($2)', [rec.items, aIds])
    await run('responses', 'delete from public.assessment_responses where item_id = any($1) or attempt_id = any($2)', [rec.items, aIds])
    await run('plan_blocks', 'update public.plan_blocks set attempt_id = null where attempt_id = any($1)', [aIds])
    await run('snapshots', 'delete from public.paper_scope_snapshots where attempt_id = any($1)', [aIds])
    await run('attempts', 'delete from public.assessment_attempts where id = any($1)', [aIds])
    await run('form_items', 'delete from public.form_items where item_id = any($1) or form_id = any($2)', [rec.items, forms])
    await run('forms', 'delete from public.assessment_forms where id = any($1)', [forms])
    await run('blueprints', 'delete from public.assessment_blueprints where id = any($1)', [bps])
    await run('decisions', 'delete from public.item_review_decisions where item_id = any($1)', [rec.items])
    await run('validations', 'delete from public.item_validations where item_id = any($1)', [rec.items])
    await run('revisions', 'delete from public.item_revisions where item_id = any($1)', [rec.items])
    const n = await run('items', 'delete from public.assessment_items where id = any($1)', [rec.items])
    await run('families', 'delete from public.item_families where id = any($1)', [rec.families])
    if (rec.batches?.length) await run('batches', 'delete from public.item_batches where id = any($1)', [rec.batches])
    await run('signoffs', 'delete from public.concept_signoffs where concept_id = any($1)', [rec.concepts])
    await run('map', 'delete from public.concept_outcome_map where concept_id = any($1)', [rec.concepts])
    await run('concepts', 'delete from public.curriculum_concepts where id = any($1)', [rec.concepts])
    await run('roles', 'delete from public.user_roles where user_id = any($1)', [rec.users]); await run('profiles', 'delete from public.profiles where id = any($1)', [rec.users]); await run('users', 'delete from auth.users where id = any($1)', [rec.users])
    const left = Number(await one(c, "select count(*) from public.assessment_items where id = any($1)", [rec.items]))
    const conceptsLeft = Number(await one(c, 'select count(*) from public.curriculum_concepts where id = any($1)', [rec.concepts]))
    const usersLeft = Number(await one(c, 'select count(*) from auth.users where id = any($1)', [rec.users]))
    console.log(JSON.stringify({ removedItems: n, attemptsRemoved: aIds.length, itemsLeft: left, conceptsLeft, usersLeft }))
    // The record is kept until EVERYTHING it names is gone, so a partial cleanup can be re-run by recorded id.
    if (left + conceptsLeft + usersLeft === 0) fs.rmSync(file); else process.exitCode = 1
  } finally { await c.end() }
}

const [cmd, ...rest] = process.argv.slice(2)
;(cmd === 'create' ? create(rest) : cmd === 'destroy' ? destroy(rest) : Promise.reject(Error('usage: fixture-bank.cjs create|destroy …'))).catch(e => { console.error(e.message); process.exit(1) })
