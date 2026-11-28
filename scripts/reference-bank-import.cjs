/** Quarantined draft intake; no publication, model calls, role grants or changes to existing items. */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { Client } = require('pg')
const { openStage } = require('./lib/stage.cjs')
const sha = x => createHash('sha256').update(x).digest('hex')
const arg = (args, name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const hashItem = i => sha(JSON.stringify({ version: i.itemVersion, draft: i.draft, outcomeId: i.outcomeId, sourcePackId: i.sourcePackId, packFactsHash: i.packFactsHash }))

function validate(bank) {
  assert.equal(bank.schema, 'reference-draft-bank.1')
  assert.equal(bank.status, 'QUARANTINED_DRAFTS_NOT_STUDENT_INVENTORY')
  assert.ok(bank.items.length > 0)
  assert.equal(new Set(bank.items.map(i => i.id)).size, bank.items.length)
  for (const i of bank.items) {
    assert.equal(i.contentHash, hashItem(i), `Content hash changed: ${i.id}`)
    assert.equal(i.reviewStatus, 'draft'); assert.equal(i.published, false); assert.equal(i.heldOut, false)
    assert.equal(i.learnerDistributionAuthorized, false); assert.equal(i.reviewerConfirmedDifficulty, null)
    assert.equal(i.mapping.signOff, 'pending'); assert.equal(i.familyProposal.constructionStatus, 'provisional')
    assert.ok(['unconfirmed', 'cleared'].includes(i.inputRights.state))
    assert.ok(i.id.startsWith('pp-ref2027-') || i.id.startsWith('pp-2027-') || i.id.startsWith('pp-pilot-'))
    assert.equal(i.draft.options.length, 3); assert.equal(new Set(i.draft.options).size, 3)
    assert.ok(Number.isInteger(i.draft.keyIndex) && i.draft.keyIndex >= 0 && i.draft.keyIndex < 3)
    assert.ok(Number.isInteger(i.itemVersion) && i.itemVersion >= 1)
    assert.ok(['foundation', 'standard', 'difficult', 'stretch'].includes(i.intendedDifficulty))
    assert.equal(i.draft.card.distractorDiagnoses.length, 2)
    for (let n = 0; n < 3; n++) assert.ok(i.draft.perOptionFeedback[n]?.trim())
  }
}

async function ingest(c, bank) {
  validate(bank)
  const bankHash = sha(bank.items.map(i => i.contentHash).sort().join('\n'))
  const requestKey = `reference-bank-2027:${bankHash}`
  await c.query('begin')
  try {
    await c.query("select pg_advisory_xact_lock(hashtext('reference-bank-2027-intake'))")
    const existing = (await c.query('select id, item_card, stem, options, key_index, per_option_feedback, item_version, outcome_id from public.assessment_items where id=any($1::text[]) for update', [bank.items.map(i => i.id)])).rows
    // Exact retries are harmless. Any collision requires a separate, explicit reviewer revision.
    for (const row of existing) {
      const i = bank.items.find(i => i.id === row.id)
      assert.equal(row.item_card?.referenceIntakeHash, i.contentHash, `Existing item differs; refusing overwrite: ${row.id}`)
      assert.equal(row.stem, i.draft.stem); assert.deepEqual(row.options, i.draft.options)
      assert.equal(row.key_index, i.draft.keyIndex); assert.equal(row.item_version, i.itemVersion)
      assert.equal(row.outcome_id, i.outcomeId); assert.deepEqual(row.per_option_feedback, i.draft.perOptionFeedback)
      for (const [field, value] of Object.entries(i.draft.card)) assert.deepEqual(row.item_card[field], value, `Existing item card differs: ${row.id}.${field}`)
    }
    const ids = new Set(existing.map(i => i.id)), pending = bank.items.filter(i => !ids.has(i.id))
    if (!pending.length) { await c.query('commit'); return { inserted: 0, preserved: ids.size, bankHash } }
    const batch = (await c.query(`insert into public.item_batches(request_key,label,manifest_id,curriculum_version,source_provenance,rights_status,prompt_version,model_versions,status,requested_count,config_hash,finished_at)
      values($1,'2027 local reference drafts — human review pending',$2,'2027',$3::jsonb,'unconfirmed','reference-draft-bank.1',$4::jsonb,'complete',$5,$6,now())
      on conflict(request_key) do update set request_key=excluded.request_key returning id`,
    [requestKey, bank.manifestId, JSON.stringify({ input: 'User-provided curriculum files', inputUse: 'Internal local drafting only; learner distribution not authorised', sourceFiles: [...new Set(bank.items.flatMap(i => i.sourceReferences.map(r => r.file)))] }), JSON.stringify({ author: 'Local Codex drafting and carried-forward fixtures; no new external model verification' }), bank.items.length, bankHash])).rows[0].id
    let ordinal = 0
    for (const i of bank.items) {
      ordinal++
      if (ids.has(i.id)) continue
      const canonical = (await c.query('select r.topic_id from public.reading_los o join public.curriculum_readings r on r.id=o.reading_id where o.id=$1 and o.reading_id=$2', [i.outcomeId, i.readingId])).rows[0]
      assert.equal(canonical?.topic_id, i.subjectId, `Unknown or wrong outcome mapping: ${i.id}`)
      await c.query(`insert into public.curriculum_concepts(id,manifest_id,topic,reading,module,los,name,importance,lm_id,verification_status,scope_notes)
        values($1,$2,$3,$4,$4,$5,$6,'core',$4,'pending','Automatic reference mapping; exact scope and source support require human sign-off') on conflict(id) do nothing`,
      [i.conceptId, bank.manifestId, i.subjectId, i.readingId, i.outcomeId, i.outcomeTitle])
      const concept = (await c.query('select manifest_id,lm_id,name from public.curriculum_concepts where id=$1', [i.conceptId])).rows[0]
      assert.equal(concept.manifest_id, bank.manifestId); assert.equal(concept.lm_id, i.readingId); assert.equal(concept.name, i.outcomeTitle)
      await c.query('insert into public.concept_outcome_map(concept_id,outcome_id,approximate) values($1,$2,true) on conflict do nothing', [i.conceptId, i.outcomeId])
      await c.query("insert into public.item_families(id,family_key,note,construction_status) values($1,$2,'Candidate only; independence unconfirmed','provisional')", [i.familyProposal.id, `reference-2027:${i.id}`])
      const card = { ...i.draft.card, referenceIntakeHash: i.contentHash, packId: i.sourcePackId, packFactsHash: i.packFactsHash, groundingPacketHash: i.groundingPacketHash, rights: i.inputRights, sourceReferences: i.sourceReferences, authoringValidation: i.validation, modelBlindSolve: i.modelBlindSolve }
      const scale = { foundation: .5, standard: 1, difficult: 1.5, stretch: 2 }
      await c.query(`insert into public.assessment_items(id,lm_id,learning_objective,verification_intent,difficulty,stem,options,key_index,per_option_feedback,provenance,review_status,concept_id,outcome_id,item_card,item_version,family_id,cognition,item_form,intended_difficulty,generator_model,batch_id,semantic_fingerprint)
        values($1,$2,$3,'Original draft; exact-version independent verification and human review pending',$4,$5,$6::jsonb,$7,$8::jsonb,'reference-2027-quarantined-local-draft','draft',$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [i.id, i.readingId, i.outcomeTitle, scale[i.intendedDifficulty], i.draft.stem, JSON.stringify(i.draft.options), i.draft.keyIndex, JSON.stringify(i.draft.perOptionFeedback), i.conceptId, i.outcomeId, JSON.stringify(card), i.itemVersion, i.familyProposal.id, i.draft.card.cognition, i.draft.card.itemForm, i.intendedDifficulty, i.draft.generatorModel, batch, i.semanticFingerprint])
      await c.query("insert into public.item_batch_cells(batch_id,ordinal,cell,status,item_id,verdict) values($1,$2,$3::jsonb,'drafted',$4,'UNVERIFIED_LOCAL_DRAFT')", [batch, ordinal, JSON.stringify({ outcomeId: i.outcomeId, conceptId: i.conceptId, difficulty: i.intendedDifficulty }), i.id])
    }
    await c.query('commit')
    return { inserted: pending.length, preserved: ids.size, bankHash }
  } catch (e) { await c.query('rollback'); throw e }
}

async function main(args) {
  const bank = JSON.parse(fs.readFileSync(arg(args, 'file', 'output/question-bank/2027/draft-bank.json'), 'utf8'))
  validate(bank)
  const local = !args.includes('--staging')
  const stage = await openStage(local ? ['--local'] : args.filter(a => a !== '--local'))
  if (!local) assert.equal(stage.cfg.identity, 'mnlezctdqkdfgvmipmcj', 'Only the authorised disposable project may receive this intake')
  const c = new Client(stage.cfg.connection)
  try {
    await c.connect()
    const first = await ingest(c, bank)
    if (local) {
      const second = await ingest(c, bank)
      assert.equal(first.inserted, bank.items.length); assert.equal(second.inserted, 0)
      const queryCount = async sql => Number((await c.query(sql, [bank.items.map(i => i.id)])).rows[0].n)
      assert.equal(await queryCount("select count(*) n from public.assessment_items where id=any($1) and review_status='draft'"), bank.items.length)
      assert.equal(await queryCount('select count(*) n from public.student_eligible_items where id=any($1)'), 0)
      assert.equal(await queryCount('select count(*) n from public.rehearsal_eligible_items where id=any($1)'), 0)
      assert.equal(await queryCount("select count(*) n from public.item_families f join public.assessment_items i on i.family_id=f.id where i.id=any($1) and construction_status='confirmed'"), 0)
      assert.equal(await queryCount('select count(*) n from public.item_review_decisions where item_id=any($1)'), 0)
      const changed = structuredClone(bank); changed.items[0].draft.stem += ' Changed.'; changed.items[0].contentHash = hashItem(changed.items[0])
      await assert.rejects(() => ingest(c, changed), /Existing item differs/)
      const lateFailure = structuredClone(bank)
      // A failure after an earlier insert must roll that earlier insert back, not leave half a bank.
      const a = structuredClone(bank.items[0]); a.id += '-rollback'; a.familyProposal.id = require('node:crypto').randomUUID(); a.contentHash = hashItem(a)
      const b = structuredClone(bank.items[1]); b.id += '-bad-outcome'; b.outcomeId = 'nonexistent'; b.contentHash = hashItem(b)
      lateFailure.items = [a, b]
      await assert.rejects(() => ingest(c, lateFailure), /Unknown or wrong outcome mapping/)
      assert.equal(Number((await c.query('select count(*) n from public.assessment_items where id=$1', [a.id])).rows[0].n), 0)
      console.log(JSON.stringify({ ...first, localRehearsal: 'PASS', idempotent: true, changedContentRefused: true, atomicRollback: true, learnerEligible: 0, heldOutEligible: 0, humanApprovals: 0 }))
    } else console.log(JSON.stringify({ ...first, target: stage.cfg.identity, published: 0 }))
  } finally { await c.end(); await stage.stop() }
}
module.exports = { validate, ingest, hashItem }
if (require.main === module) main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1 })
