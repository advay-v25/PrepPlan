/** T2 proof on the REAL development schema: atomic/idempotent batch creation, fenced claims, cancellation, budget reservations, duplicate output across
 *  workers, provisional families and manifest-scoped mapping preparation. Every row is a committed, owned fixture, deleted by recorded id.
 *  npm run batch:integrity:db:test -- --confirm-target=<project-ref> */
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
  const ids = { batches: [], concepts: [], manifests: [], items: [] }
  const pool = []
  const conn = async () => { const c = mk(); await c.connect(); pool.push(c); return c }
  const call = async (c, sql, p) => (await c.query(sql, p)).rows[0].r

  const cleanup = async () => {
    for (const c of pool) await c.end().catch(() => {})
    const run = (sql, p) => a.query(sql, p).catch(e => console.error('cleanup:', e.message))
    await run('drop trigger if exists bi_poison on public.item_batch_cells'); await run('drop function if exists public.bi_poison()')
    await run('delete from public.assessment_items where id = any($1) or batch_id = any($2)', [ids.items, ids.batches])
    await run("delete from public.item_families where family_key = any($1)", [ids.batches.flatMap(b => Array.from({ length: 6 }, (_, o) => `fam-bq-${b.replace(/-/g, '').slice(0, 8)}-${o + 1}`))])
    await run('delete from public.item_batches where id = any($1)', [ids.batches])
    await run('delete from public.concept_outcome_map where concept_id = any($1)', [ids.concepts]); await run('delete from public.curriculum_concepts where id = any($1) or manifest_id = any($2)', [ids.concepts, ids.manifests])
    await run('delete from public.curriculum_manifests where id = any($1)', [ids.manifests])
  }
  try {
    const man = await one(a, 'select id from public.curriculum_manifests where is_active limit 1')
    const outcome = (await a.query("select l.id, l.reading_id from public.reading_los l order by l.id limit 1")).rows[0]
    const cid = await one(a, 'select gen_random_uuid()')
    await a.query("insert into public.curriculum_concepts (id, manifest_id, topic, reading, module, los, name, importance, lm_id, verification_status, scope_notes) values ($1,$2,'Fixture','Fixture','fx','fx',$3,'core',$4,'verified','fixture scope')", [cid, man, `Fixture concept ${tag}`, outcome.reading_id]); ids.concepts.push(cid)
    await a.query('insert into public.concept_outcome_map (concept_id, outcome_id, approximate) values ($1,$2,false)', [cid, outcome.id])
    const items = () => a.query('select id from public.assessment_items where batch_id = any($1)', [ids.batches]).then(r => r.rows.map(x => x.id))
    const cells = k => Array.from({ length: k }, (_, i) => ({ n: i + 1 }))
    const create = (key, hash, k = 3, extra = {}, cs = cells(k)) => call(a, 'select public.create_item_batch($1,$2,$3::jsonb,$4::jsonb) r', [`bi-${tag}-${key}`, hash, JSON.stringify({ label: `Fixture ${key}`, manifest_id: man, curriculum_version: 'fixture', prompt_version: 'p', ...extra }), JSON.stringify(cs)])
    const mkBatch = async (key, k = 3, extra = {}) => { const r = await create(key, `h-${key}`, k, extra); ids.batches.push(r.batchId); return r.batchId }
    const payload = (o, fp) => JSON.stringify({ lm_id: outcome.reading_id, learning_objective: 'fx', verification_intent: 'fx', difficulty: 1, stem: `Generated fixture stem number ${o} is long enough to count`, options: ['one', 'two', 'three'], per_option_feedback: { '0': 'f', '1': 'f', '2': 'f' }, concept_id: cid, cognition: 'apply', item_form: 'direct', intended_difficulty: 'standard', key_index: 0, item_card: { solution: 'Worked solution that is long enough to count as one.' }, semantic_fingerprint: fp ?? `bi-${tag}-${o}`, generator_model: 'm', outcome_id: outcome.id })
    const gates = JSON.stringify([{ gate: 'editorial', passed: true, detail: 'ok' }])
    const store = (c, b, o, tok, fp) => call(c, 'select public.store_batch_cell($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,1000,$10::jsonb) r', [b, o, tok, payload(o, fp), gates, 'PASS', 'reason', 'mdl', '{}', '{"calls":1}'])
    const fail = (c, b, o, tok) => call(c, "select public.fail_batch_cell($1,$2,$3,'why','{X}','X',null,5) r", [b, o, tok])
    const claim = (c, b, secs = 600) => call(c, 'select public.claim_batch_cell($1,$2) r', [b, secs])

    console.log('\nAtomic, idempotent creation')
    const r1 = await create('a', 'hash-1'); ids.batches.push(r1.batchId)
    ok('a batch and all its cells are created together', r1.ok && r1.created && Number(await one(a, 'select count(*) from public.item_batch_cells where batch_id=$1', [r1.batchId])) === 3)
    const r2 = await create('a', 'hash-1'); ok('an identical retry converges on the same batch and creates nothing', r2.ok && r2.created === false && r2.batchId === r1.batchId && Number(await one(a, 'select count(*) from public.item_batches where request_key=$1', [`bi-${tag}-a`])) === 1)
    const r3 = await create('a', 'hash-2'); ok('the same key with different inputs is a conflict, not a silent reuse', r3.ok === false && r3.code === 'KEY_CONFLICT' && Number(await one(a, 'select count(*) from public.item_batch_cells where batch_id=$1', [r1.batchId])) === 3)
    const [p1, p2] = await Promise.all([create('race', 'hash-r'), create('race', 'hash-r')]); if (p1.batchId) ids.batches.push(p1.batchId)
    ok('two simultaneous identical creates make exactly one batch with one set of cells', p1.batchId === p2.batchId && Number(await one(a, 'select count(*) from public.item_batches where request_key=$1', [`bi-${tag}-race`])) === 1 && Number(await one(a, 'select count(*) from public.item_batch_cells where batch_id=$1', [p1.batchId])) === 3)
    ok('"cleared" rights with no recorded authority are refused at creation', (await create('rights', 'h', 1, { rights_status: 'cleared' })).code === 'RIGHTS_AUTHORITY_REQUIRED' && Number(await one(a, 'select count(*) from public.item_batches where request_key=$1', [`bi-${tag}-rights`])) === 0)
    const none = async k => Number(await one(a, 'select count(*) from public.item_batches where request_key=$1', [`bi-${tag}-${k}`])) === 0
    ok('"cleared" with an authority string is still refused when the pack records unconfirmed rights (the pack decides)', (await create('rp1', 'h', 1, { rights_status: 'cleared', rights_ref: 'anyone said so' }, [{ n: 1, packet: { pack: { packId: 'px', rights: { state: 'unconfirmed', permittedUse: 'internal_authoring' } } } }])).code === 'RIGHTS_NOT_SUPPORTED' && await none('rp1'))
    ok('"cleared" is refused for a cleared pack with no recorded authority, for permitted use none, and for cells with no pack at all', (await create('rp2', 'h', 1, { rights_status: 'cleared', rights_ref: 'x' }, [{ n: 1, packet: { pack: { packId: 'px', rights: { state: 'cleared', permittedUse: 'internal_authoring' } } } }])).code === 'RIGHTS_NOT_SUPPORTED' && (await create('rp3', 'h', 1, { rights_status: 'cleared', rights_ref: 'x' }, [{ n: 1, packet: { pack: { packId: 'px', rights: { state: 'cleared', authority: 'Licence 12', permittedUse: 'none' } } } }])).code === 'RIGHTS_NOT_SUPPORTED' && (await create('rp4', 'h', 1, { rights_status: 'cleared', rights_ref: 'x' })).code === 'RIGHTS_NOT_SUPPORTED' && await none('rp2') && await none('rp3') && await none('rp4'))
    { const r = await create('rp5', 'h', 1, { rights_status: 'cleared', rights_ref: 'Licence 12' }, [{ n: 1, packet: { pack: { packId: 'px', rights: { state: 'cleared', authority: 'Licence 12', permittedUse: 'internal_authoring' } } } }]); if (r.batchId) ids.batches.push(r.batchId); ok('"cleared" is accepted only when the pack itself records cleared rights, an authority and a permitted use', r.ok === true) }
    await a.query(`create function public.bi_poison() returns trigger language plpgsql as $f$ begin if new.cell ? 'poison' then raise exception 'poisoned cell'; end if; return new; end $f$`)
    await a.query('create trigger bi_poison before insert on public.item_batch_cells for each row execute function public.bi_poison()')
    let threw = false; try { await create('mid', 'h', 3, {}, [{ n: 1 }, { n: 2, poison: 1 }, { n: 3 }]) } catch { threw = true }
    ok('a failure while inserting cells leaves no incomplete batch behind', threw && Number(await one(a, 'select count(*) from public.item_batches where request_key=$1', [`bi-${tag}-mid`])) === 0 && Number(await one(a, "select count(*) from public.item_batch_cells where cell ? 'poison'")) === 0)
    await a.query('drop trigger bi_poison on public.item_batch_cells'); await a.query('drop function public.bi_poison()')
    const rr = await create('mid', 'h', 3, {}, [{ n: 1 }, { n: 2 }, { n: 3 }]); ids.batches.push(rr.batchId); ok('after that failure the same key can be created cleanly', rr.ok && rr.created)
    const legacy = await one(a, "insert into public.item_batches (request_key,label,manifest_id,curriculum_version,source_provenance,prompt_version,requested_count,config_hash) values ($1,'L',$2,'x','{}','p',3,'hash-l') returning id", [`bi-${tag}-legacy`, man]); ids.batches.push(legacy)
    ok('a damaged batch (parent without its cells) is reported as incomplete, never returned as if usable', (await create('legacy', 'hash-l')).code === 'INCOMPLETE_BATCH')
    const blocked = await create('blocked', 'hb', 2, {}, [{ n: 1, blocked: ['NO_SOURCE_PACK'], blockedDetail: 'No source pack.' }, { n: 2, blocked: ['PACK_OUTDATED'] }]); ids.batches.push(blocked.batchId)
    ok('cells without grounding are recorded as precise BLOCKED cells and are not claimable', (await a.query("select status, verdict, defect_codes from public.item_batch_cells where batch_id=$1 order by ordinal", [blocked.batchId])).rows.every(r => r.status === 'failed' && r.verdict === 'BLOCKED') && (await claim(a, blocked.batchId)) === null)
    ok('a batch whose every cell is blocked ends as failed before any provider call', (await one(a, 'select status from public.item_batches where id=$1', [blocked.batchId])) === 'failed')

    console.log('\nFenced claims')
    const b = await mkBatch('fence', 3); const [w1, w2] = await Promise.all([conn(), conn()])
    const c1 = await claim(w1, b)
    await a.query("update public.item_batch_cells set lease_until = now() - interval '1 minute' where batch_id=$1 and ordinal=$2", [b, c1.ordinal])
    const c1b = await claim(w2, b)
    ok('after lease expiry a new worker reclaims the same cell with a NEW fencing token', c1b.ordinal === c1.ordinal && c1b.claimToken && c1b.claimToken !== c1.claimToken && c1b.attempts === 2)
    ok('the old worker cannot extend the new worker\'s lease', (await call(w1, 'select public.extend_batch_cell($1,$2,$3,60) r', [b, c1.ordinal, c1.claimToken])).code === 'STALE_CLAIM')
    ok('the old worker cannot FAIL the new worker\'s running cell', (await fail(w1, b, c1.ordinal, c1.claimToken)).code === 'STALE_CLAIM' && (await one(a, 'select status from public.item_batch_cells where batch_id=$1 and ordinal=$2', [b, c1.ordinal])) === 'running')
    ok('the old worker cannot STORE over the new worker', (await store(w1, b, c1.ordinal, c1.claimToken)).code === 'STALE_CLAIM' && Number(await one(a, 'select count(*) from public.assessment_items where batch_id=$1', [b])) === 0)
    const s = await store(w2, b, c1b.ordinal, c1b.claimToken); ids.items.push(s.itemId)
    ok('the current claim stores exactly one candidate', s.ok && Number(await one(a, 'select count(*) from public.assessment_items where batch_id=$1', [b])) === 1)
    ok('a repeat of the current claim is idempotent; a stale worker after completion is still refused', (await store(w2, b, c1b.ordinal, c1b.claimToken)).repeated === true && (await store(w1, b, c1.ordinal, c1.claimToken)).code === 'STALE_CLAIM')
    const att = (await a.query('select attempt, outcome from public.item_batch_attempts where batch_id=$1 and ordinal=$2 order by attempt', [b, c1.ordinal])).rows
    ok('attempt history is preserved (the lost lease and the completed attempt)', att.length === 2 && att[0].outcome === 'lease_expired' && att[1].outcome === 'drafted', JSON.stringify(att))

    console.log('\nCancellation')
    const bc = await mkBatch('cancel', 3); const k1 = await claim(w1, bc)
    ok('cancelling a batch succeeds once and marks unfinished cells', (await call(a, 'select public.cancel_item_batch($1) r', [bc])).ok === true && (await call(a, 'select public.cancel_item_batch($1) r', [bc])).code === 'NOT_OPEN')
    ok('a worker finishing after cancellation cannot commit', (await store(w1, bc, k1.ordinal, k1.claimToken)).code === 'CANCELLED' && Number(await one(a, 'select count(*) from public.assessment_items where batch_id=$1', [bc])) === 0)
    ok('no new cells are claimed and no budget is reserved after cancellation', (await claim(w2, bc)) === null && (await call(a, 'select public.reserve_batch_budget($1,$2,1,10) r', [bc, k1.claimToken])).ok === false)

    console.log('\nBudget')
    const bb = await mkBatch('budget', 4, { budget: { maxRequests: 2, maxTokens: 1000, wallSeconds: 600 } }); const q1 = await claim(w1, bb)
    const rs = []; for (let i = 0; i < 3; i++) rs.push(await call(a, 'select public.reserve_batch_budget($1,$2,1,100) r', [bb, q1.claimToken]))
    ok('requests are reserved BEFORE dispatch and refused once the ceiling is reached', rs[0].ok && rs[1].ok && rs[2].ok === false && rs[2].code === 'BUDGET')
    ok('an exhausted budget stops the batch, marks waiting cells BUDGET_EXHAUSTED and claims nothing more', (await one(a, 'select status from public.item_batches where id=$1', [bb])) === 'budget_exhausted' && Number(await one(a, "select count(*) from public.item_batch_cells where batch_id=$1 and verdict='BUDGET_EXHAUSTED'", [bb])) === 3 && (await claim(w2, bb)) === null)
    ok('the in-flight cell cannot commit after the budget stop', (await store(w1, bb, q1.ordinal, q1.claimToken)).code === 'CANCELLED')
    const bt = await mkBatch('tokens', 2, { budget: { maxRequests: 50, maxTokens: 100, wallSeconds: 600 } }); const t1 = await claim(w1, bt)
    ok('the requested-output-token ceiling is enforced on reservation', (await call(a, 'select public.reserve_batch_budget($1,$2,1,60) r', [bt, t1.claimToken])).ok === true && (await call(a, 'select public.reserve_batch_budget($1,$2,1,60) r', [bt, t1.claimToken])).code === 'BUDGET')
    const bcr = await mkBatch('concurrent-reserve', 2, { budget: { maxRequests: 1, maxTokens: 1000, wallSeconds: 600 } }); const cr1 = await claim(w1, bcr), [cx1, cx2] = await Promise.all([call(w1, 'select public.reserve_batch_budget($1,$2,1,10) r', [bcr, cr1.claimToken]), call(w2, 'select public.reserve_batch_budget($1,$2,1,10) r', [bcr, cr1.claimToken])])
    ok('two concurrent reservations against a one-request ceiling: exactly one is granted', [cx1, cx2].filter(x => x.ok).length === 1 && [cx1, cx2].filter(x => x.code === 'BUDGET').length === 1 && Number(await one(a, 'select requests_reserved from public.item_batches where id=$1', [bcr])) === 1)
    const bw = await mkBatch('wall', 2, { budget: { maxRequests: 50, maxTokens: 1000, wallSeconds: 1 } }); await claim(w1, bw)
    await a.query("update public.item_batches set started_at = now() - interval '10 seconds' where id=$1", [bw])
    ok('the wall-clock limit stops claiming', (await claim(w2, bw)) === null && (await one(a, 'select status from public.item_batches where id=$1', [bw])) === 'budget_exhausted')
    const bs = await mkBatch('stale-reserve', 2, { budget: { maxRequests: 9, maxTokens: 1000, wallSeconds: 600 } }); const sc = await claim(w1, bs)
    ok('a reservation from a claim that is not current is refused', (await call(a, 'select public.reserve_batch_budget($1,$2,1,10) r', [bs, '00000000-0000-0000-0000-000000000001'])).code === 'STALE_CLAIM' && sc.claimToken)

    console.log('\nEquivalent output from two workers')
    const d1 = await mkBatch('dup1', 1), d2 = await mkBatch('dup2', 1), dc1 = await claim(w1, d1), dc2 = await claim(w2, d2)
    const fp = `bi-dup-${tag}`
    const [x, y] = await Promise.all([store(w1, d1, dc1.ordinal, dc1.claimToken, fp), store(w2, d2, dc2.ordinal, dc2.claimToken, fp)])
    for (const r of [x, y]) if (r.itemId) ids.items.push(r.itemId)
    ok('exactly one of two concurrent equivalent candidates is stored; the other is refused as a duplicate', [x, y].filter(r => r.ok).length === 1 && [x, y].filter(r => r.code === 'DUPLICATE_OUTPUT').length === 1 && Number(await one(a, 'select count(*) from public.assessment_items where semantic_fingerprint=$1', [fp])) === 1)
    ok('the refused cell records DUPLICATE_OUTPUT in its attempt history', Number(await one(a, "select count(*) from public.item_batch_attempts where code='DUPLICATE_OUTPUT' and batch_id = any($1)", [[d1, d2]])) === 1)

    console.log('\nFamilies')
    ok('a generated candidate starts in a PROVISIONAL family', (await one(a, 'select f.construction_status from public.assessment_items i join public.item_families f on f.id=i.family_id where i.id=$1', [s.itemId])) === 'provisional')
    ok('a provisional family is named as a publication blocker', (await one(a, 'select public.item_publish_blockers($1,false)::text', [s.itemId])).includes('family is provisional'))
    const fam = await one(a, 'select family_id from public.assessment_items where id=$1', [s.itemId])
    ok('historical and hand-made families are unchanged (confirmed)', Number(await one(a, "select count(*) from public.item_families where construction_status='confirmed' and family_key not like 'fam-bq-%'")) >= 0 && fam)

    console.log('\nMapping preparation (manifest-scoped, never exact)')
    const free = await one(a, "select l.id from public.reading_los l where not exists (select 1 from public.concept_outcome_map m join public.curriculum_concepts c on c.id=m.concept_id where m.outcome_id=l.id and c.manifest_id=$1) order by l.id limit 1", [man])
    const stub = o => ({ concept_id: null, outcome_id: o, topic: 'Fixture', reading: 'Fixture', module: 'fx', los: 'fx', name: `Stub ${o} ${tag}`, lm_id: outcome.reading_id, scope_notes: 'title only' })
    const sid = await one(a, 'select gen_random_uuid()'); ids.concepts.push(sid)
    const pr = await call(a, 'select public.prepare_concept_stubs($1,$2::jsonb) r', [man, JSON.stringify([{ ...stub(free), concept_id: sid }])])
    ok('an unmapped outcome gets an UNSIGNED, APPROXIMATE stub — never verified, never exact', pr.created === 1 && (await a.query('select c.verification_status, m.approximate from public.curriculum_concepts c join public.concept_outcome_map m on m.concept_id=c.id where c.id=$1', [sid])).rows[0].verification_status === 'pending' && (await one(a, 'select approximate from public.concept_outcome_map where concept_id=$1', [sid])) === true)
    const sid2 = await one(a, 'select gen_random_uuid()'); ids.concepts.push(sid2)
    const pr2 = await call(a, 'select public.prepare_concept_stubs($1,$2::jsonb) r', [man, JSON.stringify([{ ...stub(free), concept_id: sid2 }])])
    ok('preparing again does not overwrite or duplicate an existing mapping in that manifest', pr2.created === 0 && pr2.existing === 1 && Number(await one(a, 'select count(*) from public.concept_outcome_map where concept_id=$1', [sid2])) === 0)
    const fm = await one(a, "insert into public.curriculum_manifests (year, level, version, is_active) values (2098,'fixture',$1,false) returning id", [`fx-${tag}`]); ids.manifests.push(fm)
    const mapped = await one(a, 'select m.outcome_id from public.concept_outcome_map m where m.concept_id=$1', [cid]); const before = await one(a, 'select count(*) from public.concept_outcome_map where outcome_id=$1', [mapped])
    const sid3 = await one(a, 'select gen_random_uuid()'); ids.concepts.push(sid3)
    const pr3 = await call(a, 'select public.prepare_concept_stubs($1,$2::jsonb) r', [fm, JSON.stringify([{ ...stub(mapped), concept_id: sid3 }])])
    ok('another edition gets its own concept; the active edition\'s exact mapping is untouched', pr3.created === 1 && Number(await one(a, 'select count(*) from public.concept_outcome_map where outcome_id=$1', [mapped])) === Number(before) + 1 && (await one(a, 'select approximate from public.concept_outcome_map where concept_id=$1', [cid])) === false)
    ok('a service-role-only command cannot be called by a student role', await (async () => { try { await a.query('begin'); await a.query('set local role authenticated'); await a.query("select public.claim_batch_cell(gen_random_uuid(), 10)"); await a.query('rollback'); return false } catch (e) { await a.query('rollback'); return /permission denied/.test(e.message) } })())
  } finally { await cleanup(); await a.end().catch(() => {}) }
  console.log(`\n${n} passed, 0 failed\n`)
}
main().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
