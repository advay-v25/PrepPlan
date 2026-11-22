/** Phase 2 proof on the REAL development schema: the content boundary, the atomic reviewer decision, versioning, families/hold-out and
 *  the durable batch commands. Every row is a COMMITTED, owned fixture (concurrency needs that) and is deleted by recorded id.
 *  Nothing from the real bank is promoted. npm run reviewer:db:test -- --confirm-target=<project-ref> */
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
  const a = mk(); await a.connect(); let n = 0
  const ok = (name, v, d = '') => { assert.ok(v, `${name} ${d}`); n++; console.log(`  ✓ ${name}`) }
  const one = async (c, s, p) => Object.values((await c.query(s, p)).rows[0] ?? { v: null })[0]
  const tag = Date.now().toString(36)
  const ids = { items: [], users: [], concepts: [], batches: [], attempts: [], forms: [], bps: [], families: [] }
  const pool = []
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }

  /** Runs one statement as an authenticated user (their own transaction). */
  const as = async (c, uid, sql, p) => {
    await c.query('BEGIN'); await c.query('SET LOCAL ROLE authenticated')
    await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claims',$2,true)", [uid, JSON.stringify({ sub: uid, role: 'authenticated' })])
    try { const r = await c.query(sql, p); await c.query('COMMIT'); return Object.values(r.rows[0] ?? { v: null })[0] } catch (e) { await c.query('ROLLBACK'); throw e }
  }
  // Approvals carry a confirmed level for the exact version (the new review contract); `noConfirm` exercises the refusal.
  const confirm = (c, uid, item, ver, level = 'standard', why = 'A short, direct application of one stated relationship.') => as(c, uid, 'select public.confirm_item_difficulty($1,$2,$3,$4)', [item, ver, level, why])
  const decide = async (c, uid, item, ver, d, note = '', ack = false, noConfirm = false) => {
    if (d === 'approve' && !noConfirm) await confirm(c, uid, item, ver).catch(() => null)
    return as(c, uid, 'select public.decide_item_review($1,$2,$3,$4,$5)', [item, ver, d, note, ack])
  }
  const edit = (c, uid, item, ver, patch) => as(c, uid, 'select public.edit_item($1,$2,$3::jsonb,$4)', [item, ver, JSON.stringify(patch), 'test edit'])
  const decisions = id => one(a, "select count(*) from public.item_review_decisions where item_id=$1", [id]).then(Number)
  const humanRows = id => one(a, "select count(*) from public.item_validations where item_id=$1 and reviewer_role='human_reviewer'", [id]).then(Number)
  const status = id => one(a, 'select review_status from public.assessment_items where id=$1', [id])
  const fails = async (p, re) => { try { await p; return false } catch (e) { return re.test(e.message) } }

  const cleanup = async () => {
    for (const c of pool) await c.end().catch(() => {})
    const run = (sql, p) => a.query(sql, p).catch(e => console.error('cleanup:', e.message))
    await run('delete from public.evidence_events where attempt_id = any($1)', [ids.attempts])
    await run('delete from public.assessment_responses where attempt_id = any($1)', [ids.attempts])
    await run('delete from public.assessment_attempts where id = any($1)', [ids.attempts])
    await run('delete from public.form_items where form_id = any($1)', [ids.forms]); await run('delete from public.assessment_forms where id = any($1)', [ids.forms]); await run('delete from public.assessment_blueprints where id = any($1)', [ids.bps])
    await run('drop trigger if exists fx_fail on public.item_revisions'); await run('drop function if exists public.fx_fail()')
    await run('delete from public.assessment_items where id = any($1) or batch_id = any($2)', [ids.items, ids.batches])
    await run('delete from public.item_families where id = any($1) or family_key = any($2)', [ids.families, ids.batches.flatMap(b => [1, 2, 3, 4].map(o => `fam-bq-${b.replace(/-/g, '').slice(0, 8)}-${o}`))])
    await run('delete from public.item_batches where id = any($1)', [ids.batches])
    await run('delete from public.concept_signoffs where concept_id = any($1)', [ids.concepts]); await run('delete from public.concept_outcome_map where concept_id = any($1)', [ids.concepts]); await run('delete from public.curriculum_concepts where id = any($1)', [ids.concepts])
    await run('delete from public.user_roles where user_id = any($1)', [ids.users]); await run('delete from public.profiles where id = any($1)', [ids.users]); await run('delete from auth.users where id = any($1)', [ids.users])
  }
  const reviewedBefore = Number(await one(a, "select count(*) from public.assessment_items where review_status='reviewed'"))
  const legacyBefore = Number(await one(a, "select count(*) from public.assessment_items i where review_status='reviewed' and not exists (select 1 from public.item_review_decisions d where d.item_id=i.id)"))

  try {
    const man = await one(a, 'select id from public.curriculum_manifests where is_active limit 1')
    const outcome = (await a.query("select l.id, l.reading_id from public.reading_los l order by l.id limit 1")).rows[0]
    const uid = async (kind) => { const id = await one(a, 'select gen_random_uuid()'); await a.query("insert into auth.users (id,email,email_confirmed_at) values ($1,$2,now())", [id, `rv-${kind}-${tag}@example.invalid`]); await a.query("insert into public.profiles (id) values ($1) on conflict do nothing", [id]); ids.users.push(id); return id }
    const rev = await uid('rev'), stu = await uid('stu')
    await a.query("insert into public.user_roles (user_id, role) values ($1,'diagnostic_reviewer')", [rev])
    const concept = async (status) => { const id = await one(a, 'select gen_random_uuid()'); await a.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes) values ($1,$2,'Fixture','Fixture','fx','fx',$3,'core',$4,$5,'fixture scope')", [id, man, `Fixture concept ${status} ${tag}`, outcome.reading_id, status]); await a.query('insert into public.concept_outcome_map (concept_id, outcome_id, approximate) values ($1,$2,false)', [id, outcome.id]); ids.concepts.push(id); return id }
    const cVer = await concept('verified'), cUn = await concept('drafted')
    let seq = 0
    /** A fixture item. `checks`: 'pass' | 'disagree' | 'fail' | 'none' for the current version. */
    const item = async ({ st = 'verified', c = cVer, checks = 'pass', batch = null, ver = 1, fp = null } = {}) => {
      const id = `fxrv-${tag}-${++seq}`
      await a.query(`insert into public.assessment_items (id, lm_id, learning_objective, verification_intent, difficulty, stem, options, per_option_feedback, provenance, review_status, concept_id, outcome_id, key_index, item_card, item_version, batch_id, semantic_fingerprint, cognition, item_form, intended_difficulty)
        values ($1,$2,'fx','fx',1,$3,$4::jsonb,'{"0":"Correct. because","1":"Wrong because","2":"Wrong because"}','fixture',$5,$6,$7,0,$8::jsonb,$9,$10,$11,'apply','direct','standard')`,
        [id, outcome.reading_id, `Fixture question ${id}: what follows when the stated assumption holds in this example?`, JSON.stringify([`A ${id}`, `B ${id}`, `C ${id}`]), st, c, outcome.id, JSON.stringify({ solution: 'Worked solution that is long enough to count as one.', distractorDiagnoses: [] }), ver, batch, fp])
      ids.items.push(id)
      if (checks !== 'none') {
        await a.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier','PASS','{\"gate\":\"editorial\",\"detail\":\"ok\"}',$2)", [id, ver])
        await a.query("insert into public.item_validations (item_id, reviewer_role, status, detail, item_version) values ($1,'editorial_verifier',$2,'{\"gate\":\"verdict\",\"detail\":\"fixture\"}',$3)", [id, checks === 'pass' ? 'PASS' : checks === 'disagree' ? 'HUMAN_REVIEW' : 'REVISE', ver])
      }
      return id
    }

    console.log('\nContent boundary')
    const draftTry = await item({ st: 'draft', checks: 'none' })
    ok('a script cannot insert an item as human reviewed', await fails(a.query("insert into public.assessment_items (id,lm_id,learning_objective,verification_intent,difficulty,stem,options,per_option_feedback,provenance,review_status) values ($1,$2,'x','x',1,'a stem that is long enough to be a stem','[\"a\",\"b\",\"c\"]','{}','x','reviewed')", [`fxrv-${tag}-direct`, outcome.reading_id]), /REVIEW_COMMAND_REQUIRED/))
    ok('a script cannot promote an item to human reviewed', await fails(a.query("update public.assessment_items set review_status='reviewed' where id=$1", [draftTry]), /REVIEW_COMMAND_REQUIRED/))
    const vItem = await item()
    const bp = await one(a, "insert into public.assessment_blueprints (manifest_id,purpose,requested_scope,constraints) values ($1,'weekly_cumulative','{}','{}') returning id", [man]); ids.bps.push(bp)
    const form = await one(a, "insert into public.assessment_forms (blueprint_id,delivery_mode) values ($1,'fixed') returning id", [bp]); ids.forms.push(form)
    ok('an automatically checked item cannot enter a paper', await fails(a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, vItem]), /ITEM_NOT_REVIEWED/))
    ok('an unreviewed item cannot be made a student paper question even as a draft', await fails(a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, draftTry]), /ITEM_NOT_REVIEWED/))

    console.log('\nAtomic decision')
    const cDec = await conn()
    ok('a student cannot decide an item', (await decide(cDec, stu, vItem, 1, 'approve')).code === 'FORBIDDEN')
    ok('a student cannot read the bank directly', await fails(as(cDec, stu, 'select count(*) from public.assessment_items'), /permission denied/))
    ok('a student cannot run a batch command', await fails(as(cDec, stu, 'select public.claim_batch_cell(gen_random_uuid(), 10)'), /permission denied/))
    const bad = await item({ c: cUn }), none = await item({ st: 'draft', checks: 'none' }), dis = await item({ checks: 'disagree' }), failed = await item({ checks: 'fail' })
    let r = await decide(cDec, rev, bad, 1, 'approve'); ok('unsigned curriculum concept blocks publication, with the reason', r.code === 'BLOCKED' && r.blockers.some(b => /signed off/.test(b)), JSON.stringify(r))
    r = await decide(cDec, rev, none, 1, 'approve'); ok('an item without a passing automatic check is blocked', r.code === 'BLOCKED' && r.blockers.some(b => /automatically checked|re-verify/i.test(b)), JSON.stringify(r))
    r = await decide(cDec, rev, failed, 1, 'approve'); ok('a failed automatic check is blocked', r.code === 'BLOCKED' && r.blockers.some(b => /failed/.test(b)))
    r = await decide(cDec, rev, dis, 1, 'approve'); ok('a verifier disagreement is blocked until acknowledged', r.code === 'BLOCKED' && r.blockers.some(b => /disagree/.test(b)))
    ok('nothing changed for any blocked item', (await status(bad)) === 'verified' && (await decisions(bad)) === 0 && (await decisions(dis)) === 0)
    r = await decide(cDec, rev, dis, 1, 'approve', 'judged myself', true); ok('an acknowledged disagreement can be approved', r.ok === true && (await status(dis)) === 'reviewed')
    const A = await item()
    r = await decide(cDec, rev, A, 2, 'approve'); ok('a stale version is refused', r.code === 'STALE_VERSION')
    r = await decide(cDec, rev, A, 1, 'approve', 'checked working'); ok('approve publishes', r.ok === true && r.status === 'reviewed')
    ok('exactly one decision and one named human record', (await decisions(A)) === 1 && (await humanRows(A)) === 1 && (await one(a, 'select reviewed_at is not null from public.assessment_items where id=$1', [A])) === true)
    r = await decide(cDec, rev, A, 1, 'approve', 'again'); ok('a repeated decision is a no-op', r.ok === true && r.repeated === true && (await decisions(A)) === 1 && (await humanRows(A)) === 1)
    r = await decide(cDec, rev, A, 1, 'reject', 'changed my mind'); ok('a conflicting decision on the same version is refused', r.ok === false && ['ALREADY_DECIDED', 'NOT_AWAITING_REVIEW'].includes(r.code) && (await status(A)) === 'reviewed')
    r = await decide(cDec, rev, vItem, 1, 'reject', 'x'); ok('rejecting needs a real reason', r.code === 'NOTE_REQUIRED')

    const E = await item(); const conns = await Promise.all(Array.from({ length: 8 }, conn))
    const res = await Promise.all(conns.map((c, i) => decide(c, rev, E, 1, i % 2 ? 'reject' : 'approve', 'race').catch(e => ({ ok: false, code: 'ERR', msg: e.message }))))
    ok('concurrent opposing decisions leave exactly one decision', (await decisions(E)) === 1 && (await humanRows(E)) === 1, JSON.stringify(res.map(x => x.code ?? (x.repeated ? 'rep' : 'ok'))))
    const winner = await one(a, 'select decision from public.item_review_decisions where item_id=$1', [E])
    ok('and the item state matches the single winning decision', (await status(E)) === (winner === 'approve' ? 'reviewed' : 'deprecated') && res.every(x => x.ok === true ? true : ['ALREADY_DECIDED', 'NOT_AWAITING_REVIEW'].includes(x.code)))

    const F = await item()
    await a.query("create or replace function public.fx_fail() returns trigger language plpgsql as $$ begin if new.item_id = '" + F + "' then raise exception 'FX_FORCED_FAILURE'; end if; return new; end $$")
    await a.query('create trigger fx_fail before insert on public.item_revisions for each row execute function public.fx_fail()')
    ok('a failure between the decision writes rolls back everything', await fails(decide(cDec, rev, F, 1, 'approve', 'will fail'), /FX_FORCED_FAILURE/) && (await status(F)) === 'verified' && (await decisions(F)) === 0 && (await humanRows(F)) === 0)
    await a.query('drop trigger fx_fail on public.item_revisions'); await a.query('drop function public.fx_fail()')
    r = await decide(cDec, rev, F, 1, 'approve', 'now fine'); ok('and the same decision then succeeds once', r.ok === true && (await decisions(F)) === 1)

    console.log('\nVersions')
    const before = (await a.query('select stem, options, key_index, per_option_feedback from public.assessment_items where id=$1', [A])).rows[0]
    r = await edit(cDec, rev, A, 1, { stem: 'A materially different question that changes the meaning entirely here', key_index: 1 })
    ok('a material edit to a published item creates a new candidate version', r.ok && r.mode === 'new_version' && r.itemId === `${A}-v2` && (await status(r.itemId)) === 'draft')
    const after = (await a.query('select stem, options, key_index, per_option_feedback, review_status from public.assessment_items where id=$1', [A])).rows[0]
    ok('the published version is untouched', JSON.stringify([before.stem, before.options, before.key_index, before.per_option_feedback]) === JSON.stringify([after.stem, after.options, after.key_index, after.per_option_feedback]) && after.review_status === 'reviewed')
    ids.items.push(`${A}-v2`)
    r = await edit(cDec, rev, A, 1, { key_index: 2 }); ok('a second edit does not create a duplicate successor', r.code === 'SUCCESSOR_EXISTS' && Number(await one(a, 'select count(*) from public.assessment_items where supersedes_item_id=$1', [A])) === 1)
    ok('a published item cannot be rewritten in place by any other path', await fails(a.query("update public.assessment_items set stem='silently changed to something else entirely' where id=$1", [A]), /ITEM_IMMUTABLE/))
    r = await decide(cDec, rev, `${A}-v2`, 2, 'approve'); ok('a new version cannot be approved before it is checked', r.code === 'BLOCKED')
    const stale = await a.query("select public.store_item_verification($1,1,'[]'::jsonb,'PASS','x','m','{}'::jsonb) r", [`${A}-v2`]); ok('a late check result for an old version is discarded', stale.rows[0].r.code === 'STALE_VERSION')
    const sv = await a.query("select public.store_item_verification($1,2,'[{\"gate\":\"editorial\",\"passed\":true,\"detail\":\"ok\"}]'::jsonb,'PASS','fine','m','{}'::jsonb) r", [`${A}-v2`]); ok('a current check result is stored and makes it awaiting review', sv.rows[0].r.status === 'verified')
    r = await decide(cDec, rev, `${A}-v2`, 2, 'approve', 'v2 checked'); ok('approving the new version retires the old one in the same step', r.ok && (await status(`${A}-v2`)) === 'reviewed' && (await status(A)) === 'deprecated')
    ok('and the retired version still has its original content', (await one(a, 'select stem from public.assessment_items where id=$1', [A])) === before.stem)
    const G = await item(); r = await edit(cDec, rev, G, 1, { stem: 'An unpublished draft being corrected before anyone has used it at all' })
    ok('an unused unpublished item is corrected in place, version bumped, check cleared', r.mode === 'in_place' && r.version === 2 && (await status(G)) === 'draft')
    ok('and its old check no longer counts', (await one(a, "select public.item_publish_blockers($1,false)::text", [G])).includes('no automatic check result'))
    const U = await item(); const att0 = await one(a, "insert into public.assessment_attempts (user_id,status,attempt_kind) values ($1,'in_progress','weekly') returning id", [stu]); ids.attempts.push(att0)
    await a.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,0,true,3)', [att0, U, stu])
    r = await edit(cDec, rev, U, 1, { key_index: 2 }); ok('an item already used in an attempt gets a new version, never an in-place rewrite', r.mode === 'new_version'); ids.items.push(r.itemId)
    ok('the used version keeps its answer', Number(await one(a, 'select key_index from public.assessment_items where id=$1', [U])) === 0)

    console.log('\nEvidence boundary')
    // Historical attempts can still hold automatically checked items; scoring must not turn them into evidence.
    const finalize = async (attId) => as(await conn(), stu, "select public.finalize_assessment_attempt($1,'1.0','1.0')", [attId])
    const attP = await one(a, "insert into public.assessment_attempts (user_id,status,attempt_kind) values ($1,'in_progress','weekly') returning id", [stu]); ids.attempts.push(attP)
    await a.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,1,false,3)', [attP, vItem, stu])
    await finalize(attP)
    ok('an attempt with an automatically checked item is practice and writes no evidence', (await one(a, 'select evidence_mode from public.assessment_attempts where id=$1', [attP])) === 'practice' && Number(await one(a, 'select count(*) from public.evidence_events where attempt_id=$1', [attP])) === 0)
    const attE = await one(a, "insert into public.assessment_attempts (user_id,status,attempt_kind) values ($1,'in_progress','weekly') returning id", [stu]); ids.attempts.push(attE)
    await a.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,0,true,3)', [attE, `${A}-v2`, stu])
    await finalize(attE)
    ok('an attempt of human-reviewed items produces evidence', (await one(a, 'select evidence_mode from public.assessment_attempts where id=$1', [attE])) === 'evidence' && Number(await one(a, 'select count(*) from public.evidence_events where attempt_id=$1', [attE])) === 1)
    const attR = await one(a, "insert into public.assessment_attempts (user_id,status,attempt_kind) values ($1,'in_progress','weekly') returning id", [stu]); ids.attempts.push(attR)
    await a.query('insert into public.assessment_responses (attempt_id,item_id,user_id,selected_option_index,is_correct,self_reported_confidence) values ($1,$2,$3,0,true,3)', [attR, A, stu])
    await finalize(attR)
    ok('an item retired after approval keeps its evidence for an attempt already using it', (await one(a, 'select evidence_mode from public.assessment_attempts where id=$1', [attR])) === 'evidence')

    console.log('\nFamilies and hold-out')
    const f1 = await item({ fp: `same-${tag}` }), f2 = await item({ fp: `same-${tag}` }), f3 = await item(), lonely = await item(), lonely2 = await item()
    ok('the same text hash does not create a family', (await one(a, 'select family_id from public.assessment_items where id=$1', [f1])) === null && (await one(a, 'select family_id from public.assessment_items where id=$1', [f2])) === null)
    r = await as(cDec, rev, 'select public.group_items_in_family($1::text[], null, $2)', [[f1, f2], 'numeric variants']); ids.families.push(r.familyId)
    ok('a reviewer places related items in one family', r.ok && (await one(a, 'select count(distinct family_id) from public.assessment_items where id = any($1)', [[f1, f2]])) === '1')
    ok('items never grouped stay explicitly unknown', (await one(a, 'select family_id from public.assessment_items where id=$1', [f3])) === null)
    r = await as(cDec, rev, 'select public.set_item_holdout($1,null,true,$2)', [(await one(a, 'select family_id from public.assessment_items where id=$1', [f1])), 'reserved for mock form 1'])
    ok('holding out a family holds out all its members', r.ok && (await one(a, 'select count(*) from public.assessment_items where id = any($1) and held_out', [[f1, f2]])) === '2')
    r = await as(cDec, rev, 'select public.set_item_holdout(null,$1,true,$2)', [lonely, 'single held-out item']); ok('an unknown-family item is held out alone', r.ok && (await one(a, 'select held_out from public.assessment_items where id=$1', [lonely])) === true && (await one(a, 'select held_out from public.assessment_items where id=$1', [lonely2])) === false)
    for (const x of [f1, lonely]) { await decide(cDec, rev, x, 1, 'approve', 'fixture publish') }
    ok('a held-out reviewed item cannot enter a routine paper', await fails(a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, f1]), /ITEM_HELD_OUT/) && await fails(a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, lonely]), /ITEM_HELD_OUT/))
    await decide(cDec, rev, f3, 1, 'approve', 'fixture publish'); await a.query('insert into public.form_items (form_id,item_id,sequence_number) values ($1,$2,1)', [form, f3])
    ok('an approved, not held-out item can enter a paper', Number(await one(a, 'select count(*) from public.form_items where form_id=$1', [form])) === 1)
    await a.query('delete from public.form_items where form_id=$1', [form])

    console.log('\nDurable batches')
    const batch = await one(a, "insert into public.item_batches (request_key,label,manifest_id,curriculum_version,source_provenance,prompt_version,requested_count,max_attempts) values ($1,$2,$3,'fixture','{}','p',4,2) returning id", [`fx-${tag}`, `Fixture ${tag}`, man]); ids.batches.push(batch)
    ok('a request key cannot create a second batch', await fails(a.query("insert into public.item_batches (request_key,label,manifest_id,curriculum_version,source_provenance,prompt_version,requested_count) values ($1,'dup',$2,'x','{}','p',1)", [`fx-${tag}`, man]), /duplicate key/))
    for (let i = 1; i <= 4; i++) await a.query("insert into public.item_batch_cells (batch_id, ordinal, cell) values ($1,$2,$3::jsonb)", [batch, i, JSON.stringify({ n: i })])
    const [w1, w2] = await Promise.all([conn(), conn()])
    const [c1, c2] = await Promise.all([w1.query('select public.claim_batch_cell($1,600) c', [batch]), w2.query('select public.claim_batch_cell($1,600) c', [batch])])
    ok('two workers never claim the same cell', c1.rows[0].c && c2.rows[0].c && c1.rows[0].c.ordinal !== c2.rows[0].c.ordinal)
    await a.query("update public.item_batch_cells set lease_until = now() - interval '1 minute' where batch_id=$1 and ordinal=$2", [batch, c1.rows[0].c.ordinal])
    const re = await w1.query('select public.claim_batch_cell($1,600) c', [batch])
    ok('after a worker dies, the unfinished cell is re-claimed (attempt 2), not duplicated', re.rows[0].c.ordinal === c1.rows[0].c.ordinal && re.rows[0].c.attempts === 2)
    const payload = o => JSON.stringify({ lm_id: outcome.reading_id, learning_objective: 'fx', verification_intent: 'fx', difficulty: 1, stem: `Generated fixture stem number ${o} is long enough to count`, options: ['one', 'two', 'three'], per_option_feedback: { '0': 'f', '1': 'f', '2': 'f' }, concept_id: cVer, cognition: 'apply', item_form: 'direct', intended_difficulty: 'standard', key_index: 0, item_card: { solution: 'Worked solution that is long enough to count as one.' }, semantic_fingerprint: `bfp-${tag}-${o}`, generator_model: 'm', outcome_id: outcome.id })
    const gates = JSON.stringify([{ gate: 'editorial', passed: true, detail: 'ok' }])
    const store = (c, o, tok, verdict) => c.query('select public.store_batch_cell($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,1000,$10::jsonb) r', [batch, o, tok, payload(o), gates, verdict, 'reason', 'mdl', '{}', '{"calls":3}'])
    const s1 = await store(w1, re.rows[0].c.ordinal, re.rows[0].c.claimToken, 'PASS'); const iid = s1.rows[0].r.itemId; ids.items.push(iid)
    const s1b = await store(w1, re.rows[0].c.ordinal, re.rows[0].c.claimToken, 'PASS')
    ok('storing the same cell twice leaves one candidate', s1.rows[0].r.ok && s1b.rows[0].r.repeated === true && Number(await one(a, 'select count(*) from public.assessment_items where batch_id=$1', [batch])) === 1)
    ok('a generated candidate is only ever "automatically checked", never human reviewed', (await status(iid)) === 'verified' && (await one(a, 'select family_id is not null from public.assessment_items where id=$1', [iid])) === true)
    const s2 = await store(w2, c2.rows[0].c.ordinal, c2.rows[0].c.claimToken, 'HUMAN_REVIEW'); ids.items.push(s2.rows[0].r.itemId)
    ok('a verifier disagreement stays visible for the reviewer', (await one(a, "select status from public.item_validations where item_id=$1 and detail->>'gate'='verdict'", [s2.rows[0].r.itemId])) === 'HUMAN_REVIEW')
    r = await decide(cDec, rev, iid, 1, 'approve', 'try'); ok('candidates from a batch with unconfirmed source rights cannot be published', r.code === 'BLOCKED' && r.blockers.some(b => /rights/.test(b)))
    r = await decide(cDec, rev, iid, 1, 'approve', 'try'); ok('a provisional family and a rights flag without an authority both block publication', r.code === 'BLOCKED' && r.blockers.some(b => /family is provisional/.test(b)))
    await a.query("update public.item_batches set rights_status='cleared' where id=$1", [batch]); r = await decide(cDec, rev, iid, 1, 'approve', 'cleared but no authority'); ok('"cleared" with no recorded authority is not enough', r.code === 'BLOCKED' && r.blockers.some(b => /authority/.test(b)))
    await a.query("update public.item_batches set rights_ref='fixture authority' where id=$1", [batch])
    r = await as(cDec, rev, 'select public.confirm_item_family($1,$2,$3)', [iid, 1, 'fixture: its own construction']); ok('a reviewer can confirm the family of the version they opened', r.ok === true)
    r = await decide(cDec, rev, iid, 1, 'approve', 'rights cleared in fixture'); ok('once rights are cleared the same candidate can be published', r.ok === true)
    const c3 = (await w1.query('select public.claim_batch_cell($1,600) c', [batch])).rows[0].c
    const f1r = (await w1.query("select public.fail_batch_cell($1,$2,$3,'timeout','{GEN_TIMEOUT}','GEN_TIMEOUT',null,5) r", [batch, c3.ordinal, c3.claimToken])).rows[0].r
    ok('a failed cell goes back for one bounded retry', f1r.ok && (await one(a, 'select status from public.item_batch_cells where batch_id=$1 and ordinal=$2', [batch, c3.ordinal])) === 'pending')
    const c3b = (await w1.query('select public.claim_batch_cell($1,600) c', [batch])).rows[0].c
    await w1.query("select public.fail_batch_cell($1,$2,$3,'timeout again','{GEN_TIMEOUT}','GEN_TIMEOUT',null,5)", [batch, c3b.ordinal, c3b.claimToken])
    ok('after the last allowed attempt the failure is recorded with its reason', (await one(a, 'select failure_reason from public.item_batch_cells where batch_id=$1 and ordinal=$2', [batch, c3.ordinal])) === 'timeout again' && (await one(a, 'select status from public.item_batch_cells where batch_id=$1 and ordinal=$2', [batch, c3.ordinal])) === 'failed')
    const c4 = (await w1.query('select public.claim_batch_cell($1,600) c', [batch])).rows[0].c
    await store(w1, c4.ordinal, c4.claimToken, 'REVISE'); ids.items.push(`bq-${batch.replace(/-/g, '').slice(0, 8)}-${c4.ordinal}`)
    ok('a failed check leaves a draft, never an automatically checked item', (await status(`bq-${batch.replace(/-/g, '').slice(0, 8)}-${c4.ordinal}`)) === 'draft')
    ok('the batch settles as finished with nothing left open', (await one(a, 'select status from public.item_batches where id=$1', [batch])) === 'complete' && (await w1.query('select public.claim_batch_cell($1,600) c', [batch])).rows[0].c === null)

    console.log('\nAttributable concept sign-off')
    const { createHash } = require('node:crypto')
    const hashOf = id => one(a, "select public.concept_scope_hash(name, scope_notes, excluded_or_superseded, manifest_id) from public.curriculum_concepts where id=$1", [id])
    const signoff = (c, who, id, dec, hash, why = 'Read the scope and exclusions; they match the curriculum.', key = null) => as(c, who, 'select public.decide_concept_signoff($1,$2,$3,$4,$5)', [id, dec, hash, why, key])
    const cS = await concept('drafted'), cc = await conn()
    const h0 = await hashOf(cS)
    const tsHash = createHash('sha256').update(`${await one(a, 'select name from public.curriculum_concepts where id=$1', [cS])}\nfixture scope\n\n${man}`, 'utf8').digest('hex')
    ok('the TypeScript scope hash equals the database one', tsHash === h0, { tsHash, h0 })
    ok('a student cannot sign off a concept', (await signoff(cc, stu, cS, 'verify', h0)).code === 'FORBIDDEN' && (await one(a, 'select verification_status from public.curriculum_concepts where id=$1', [cS])) === 'drafted')
    const anon = await conn(); await anon.query('BEGIN'); await anon.query('SET LOCAL ROLE anon')
    ok('an anonymous caller cannot run the command at all', await fails(anon.query("select public.decide_concept_signoff($1,'verify','x','long enough reason')", [cS]), /permission denied/)); await anon.query('ROLLBACK')
    ok('a malformed decision approves nothing', (await signoff(cc, rev, cS, 'maybe', h0)).code === 'BAD_DECISION' && (await signoff(cc, rev, cS, 'verify', '')).code === 'BAD_REQUEST')
    ok('a missing or trivial rationale is refused', (await signoff(cc, rev, cS, 'verify', h0, 'ok')).code === 'RATIONALE_REQUIRED')
    ok('a stale scope hash is refused', (await signoff(cc, rev, cS, 'verify', 'f'.repeat(64))).code === 'STALE_SCOPE')
    ok('a script cannot flip the status directly', await fails(a.query("update public.curriculum_concepts set verification_status='verified' where id=$1", [cS]), /decide_concept_signoff/))
    ok('a real-looking concept cannot be created already signed off', await fails(a.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes) values (gen_random_uuid(),$1,'Financial Statement Analysis','x','x','x','x','core',$2,'verified','scope')", [man, outcome.reading_id]), /decide_concept_signoff/))
    ok('nothing was recorded by any refused attempt', Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS])) === 0)
    const key = `k-${tag}`; const [v1, v2] = await Promise.all([signoff(cc, rev, cS, 'verify', h0, undefined, key), signoff(await conn(), rev, cS, 'verify', h0, undefined, key)])
    ok('two simultaneous identical requests leave ONE audit row and the same result', v1.ok && v2.ok && Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS])) === 1, [v1, v2])
    const row = (await a.query('select * from public.concept_signoffs where concept_id=$1', [cS])).rows[0]
    ok('the audit row names the reviewer, decision, exact scope hash, snapshot and reason', row.reviewer_id === rev && row.decision === 'verify' && row.scope_hash === h0 && row.scope_snapshot.scope === 'fixture scope' && row.rationale.length >= 8)
    ok('the status and the audit row came together', (await one(a, 'select verification_status from public.curriculum_concepts where id=$1', [cS])) === 'verified')
    ok('the same key with a different decision is a conflict, not a second record', (await signoff(cc, rev, cS, 'withdraw', h0, undefined, key)).code === 'KEY_CONFLICT')
    const WHY = 'Read the scope and exclusions; they match the curriculum.'
    const rows0 = Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS]))
    const exact = await signoff(cc, rev, cS, 'verify', h0, WHY, key)
    ok('an exact retry (lost response) replays the ORIGINAL receipt and writes nothing', exact.ok && exact.replay === true && exact.decision === 'verify' && exact.status === 'verified' && exact.signoffId === row.id && Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS])) === rows0, exact)
    ok('whitespace-only differences in the reason are the same request', (await signoff(cc, rev, cS, 'verify', h0, `  ${WHY.replace(/ /g, '   ')}\n`, key)).replay === true)
    const conflicts = [['a different scope hash', [h0.replace(/^./, c => (c === 'a' ? 'b' : 'a')), WHY]], ['a different reason', [h0, 'A completely different reason for the same key.']]]
    for (const [label, [hh, why]] of conflicts) ok(`the same key with ${label} is a conflict and changes nothing`, (await signoff(cc, rev, cS, 'verify', hh, why, key)).code === 'KEY_CONFLICT' && Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS])) === rows0 && (await one(a, 'select verification_status from public.curriculum_concepts where id=$1', [cS])) === 'verified')
    const rev2 = await a.query("select user_id from public.user_roles where role in ('reviewer','admin') and user_id <> $1 limit 1", [rev]).then(r => r.rows[0]?.user_id)
    if (rev2) ok('the same key from another reviewer is a conflict, never their receipt', (await signoff(await conn(), rev2, cS, 'verify', h0, WHY, key)).code === 'KEY_CONFLICT')
    ok('a key that is too short or too long, or a reason over 1000 characters, is refused, not truncated', (await signoff(cc, rev, cS, 'verify', h0, WHY, 'short')).code === 'BAD_KEY' && (await signoff(cc, rev, cS, 'verify', h0, WHY, 'k'.repeat(101))).code === 'BAD_KEY' && (await signoff(cc, rev, cS, 'verify', h0, 'x'.repeat(1001), `long-${tag}`)).code === 'RATIONALE_TOO_LONG' && Number(await one(a, 'select count(*) from public.concept_signoffs where concept_id=$1', [cS])) === rows0)
    const cK = await concept('drafted'), hK = await hashOf(cK), kk = `conc-${tag}`
    const [i1, i2] = await Promise.all([signoff(cc, rev, cK, 'verify', hK, WHY, kk), signoff(await conn(), rev, cK, 'withdraw', hK, WHY, kk)])
    const kRows = (await a.query('select decision from public.concept_signoffs where concept_id=$1', [cK])).rows
    ok('concurrent INCOMPATIBLE requests under one key never produce two records, and the loser is a conflict or a no-op', kRows.length === 1 && kRows[0].decision === 'verify' && [i1, i2].some(x => x.ok && x.decision === 'verify') && (i2.code === 'KEY_CONFLICT' || i2.unchanged === true), [i1, i2, kRows])
    await a.query("update public.curriculum_concepts set scope_notes = 'fixture scope, revised after sign-off' where id=$1", [cS])
    const late = await signoff(cc, rev, cS, 'verify', h0, WHY, key)
    ok('a lost-response retry AFTER the scope was edited still replays the original receipt, labelled with the original decision and the current status', late.replay === true && late.status === 'verified' && late.currentStatus === 'drafted' && late.signoffId === row.id, late)
    ok('revising a signed-off scope revokes the sign-off and records that, without erasing the earlier record', (await one(a, 'select verification_status from public.curriculum_concepts where id=$1', [cS])) === 'drafted' && Number(await one(a, "select count(*) from public.concept_signoffs where concept_id=$1 and decision='revoked_by_edit' and reviewer_id is null", [cS])) === 1 && Number(await one(a, "select count(*) from public.concept_signoffs where concept_id=$1 and decision='verify'", [cS])) === 1)
    ok('the old hash is now stale', (await signoff(cc, rev, cS, 'verify', h0)).code === 'STALE_SCOPE')
    const h1 = await hashOf(cS); const again = await signoff(cc, rev, cS, 'verify', h1, 'Re-read the revised scope; it is correct.')
    ok('the revised scope can be signed off again by a person', again.ok === true && !again.replay)
    const liveItem = await item({ st: 'reviewed', c: cS, checks: 'pass' }).catch(() => null)
    const w = await signoff(cc, rev, cS, 'withdraw', h1, 'Found a scope error on a second reading.')
    ok('withdrawal returns the concept to unsigned and records who and why', w.ok === true && w.status === 'drafted' && (await one(a, "select reviewer_id from public.concept_signoffs where concept_id=$1 and decision='withdraw'", [cS])) === rev)
    const bq = await item({ c: cS }); const blockedNow = await decide(cc, rev, bq, 1, 'approve')
    ok('after withdrawal no new item of that concept can be approved', blockedNow.code === 'BLOCKED' && blockedNow.blockers.some(b => /signed off/.test(b)))
    ok('a withdrawal that finds nothing to withdraw changes nothing', (await signoff(cc, rev, cS, 'withdraw', h1, 'Withdrawing again for no reason')).unchanged === true && Number(await one(a, "select count(*) from public.concept_signoffs where concept_id=$1 and decision='withdraw'", [cS])) === 1)
    ok('the audit table is not readable or writable by students', await fails(as(cc, stu, 'select count(*) from public.concept_signoffs'), /permission denied/))
    void liveItem

    ok('real reviewed items were not relabelled or promoted by this run', Number(await one(a, "select count(*) from public.assessment_items where review_status='reviewed' and id <> all($1)", [ids.items])) === reviewedBefore)
    ok(`legacy items marked reviewed without a recorded decision are unchanged (${legacyBefore})`, Number(await one(a, "select count(*) from public.assessment_items i where review_status='reviewed' and not exists (select 1 from public.item_review_decisions d where d.item_id=i.id) and id <> all($1)", [ids.items])) === legacyBefore)
  } finally { await cleanup(); await a.end().catch(() => {}) }
  console.log(`\n${n} passed, 0 failed\n`)
}
main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
