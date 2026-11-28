# Question-bank owner: please review and apply the format `.2` importer patch

**Not applied.** `scripts/reference-bank-import.cjs` is unchanged (SHA-256 `4211c5f0e7435ac9`) and today still rejects the current bank file `output/question-bank/2027/draft-bank.json` (`reference-draft-bank.2`, SHA-256 `2cdd82805ddae7c3`).
This is importer compatibility only. It publishes and approves nothing, and says nothing about whether the live bank has approved questions (it has none).

## Two decisions needed from you
1. **Shared families.** Three pairs of easy and medium variants share one family ID (`r029-d`, `r033-c`, `r035-c`; same `familyHint` and outcome). The patch creates one family per pair and refuses any other sharing. Are these meant to be one family each?
2. **Provenance in `.2`.** `.2` items carry `sourcePackId` and `packFactsHash` but no per-item `sourceReferences` (file and page). The patch accepts the pack hashes as provenance for `.2` and still requires page references for `.1`. Is that enough, or should `.2` carry page references?

## Apply
```
git apply docs/patches/reference-bank-import-format-2.patch
```
(checked to apply cleanly to the current file)

## What changes
- Accepts `.1` and `.2`; names any other format as unsupported.
- `.2`: the held-out flag must match `poolIntent`; `pp-mock1-` ids only for held-out drafts; source pack required.
- Held-out drafts: the family is created held out, because items inherit the flag from their family (without this the database stores them as routine).
- A retry also compares pool and family. Still drafts only, provisional families, no approvals, no eligibility, one transaction.

## Proof on disposable local databases (current migrations, 26 Nov 2026)
Script: `docs/patches/reference-bank-import-format-2.verify.cjs` (run beside a patched copy at `./b/scripts/`).
```
  ✓ format .2 (current file): refused, nothing written · unknown format
  ✓ format .2 (current file): refused, nothing written · not quarantined
  ✓ format .2 (current file): refused, nothing written · empty items
  ✓ format .2 (current file): refused, nothing written · content edited after hashing (last item)
  ✓ format .2 (current file): refused, nothing written · published flag (last item)
  ✓ format .2 (current file): refused, nothing written · human sign-off claimed (last item)
  ✓ format .2 (current file): refused, nothing written · duplicate id
  ✓ format .2 (current file): refused, nothing written · wrong outcome mapping on the LAST item, after earlier inserts
  ✓ format .2 (current file): refused, nothing written · database constraint failure on the LAST item
  ✓ format .2 (current file): refused, nothing written · family shared by unrelated items
  ✓ format .2 (current file): refused, nothing written · held-out flag disagrees with pool intent
  ✓ format .2 (current file): refused, nothing written · missing source pack
  ✓ format .2 (current file): imports 1230 drafts
  ✓ format .2 (current file): a retry inserts nothing
  ✓ format .2 (current file): every row is a draft, none eligible
  ✓ format .2 (current file): 190 held-out drafts kept apart; 1227 provisional families, none confirmed; 0 review decisions
  ✓ format .2 (current file): changed content never overwrites
  ✓ format .1 (25 Nov baseline): refused, nothing written · unknown format
  ✓ format .1 (25 Nov baseline): refused, nothing written · not quarantined
  ✓ format .1 (25 Nov baseline): refused, nothing written · empty items
  ✓ format .1 (25 Nov baseline): refused, nothing written · content edited after hashing (last item)
  ✓ format .1 (25 Nov baseline): refused, nothing written · published flag (last item)
  ✓ format .1 (25 Nov baseline): refused, nothing written · human sign-off claimed (last item)
  ✓ format .1 (25 Nov baseline): refused, nothing written · duplicate id
  ✓ format .1 (25 Nov baseline): refused, nothing written · wrong outcome mapping on the LAST item, after earlier inserts
  ✓ format .1 (25 Nov baseline): refused, nothing written · database constraint failure on the LAST item
  ✓ format .1 (25 Nov baseline): refused, nothing written · family shared by unrelated items
  ✓ format .1 (25 Nov baseline): refused, nothing written · held-out item in format .1
  ✓ format .1 (25 Nov baseline): imports 536 drafts
  ✓ format .1 (25 Nov baseline): a retry inserts nothing
  ✓ format .1 (25 Nov baseline): every row is a draft, none eligible
  ✓ format .1 (25 Nov baseline): 0 held-out drafts kept apart; 536 provisional families, none confirmed; 0 review decisions
  ✓ format .1 (25 Nov baseline): changed content never overwrites

33 checks passed
```

## The patch
```diff
--- a/scripts/reference-bank-import.cjs	2026-11-26 16:40:35
+++ b/scripts/reference-bank-import.cjs	2026-11-26 16:41:18
@@ -8,18 +8,31 @@
 const arg = (args, name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
 const hashItem = i => sha(JSON.stringify({ version: i.itemVersion, draft: i.draft, outcomeId: i.outcomeId, sourcePackId: i.sourcePackId, packFactsHash: i.packFactsHash }))
 
+/** `.1`: routine drafts with per-item source references. `.2`: adds held-out mock drafts, source-pack provenance and intentionally shared families. */
+const FORMATS = ['reference-draft-bank.1', 'reference-draft-bank.2']
 function validate(bank) {
-  assert.equal(bank.schema, 'reference-draft-bank.1')
+  assert.ok(FORMATS.includes(bank.schema), `Unsupported bank format: ${bank.schema}`)
+  const v2 = bank.schema === 'reference-draft-bank.2'
   assert.equal(bank.status, 'QUARANTINED_DRAFTS_NOT_STUDENT_INVENTORY')
-  assert.ok(bank.items.length > 0)
+  assert.ok(Array.isArray(bank.items) && bank.items.length > 0)
+  const families = new Map()
   assert.equal(new Set(bank.items.map(i => i.id)).size, bank.items.length)
   for (const i of bank.items) {
     assert.equal(i.contentHash, hashItem(i), `Content hash changed: ${i.id}`)
-    assert.equal(i.reviewStatus, 'draft'); assert.equal(i.published, false); assert.equal(i.heldOut, false)
+    assert.equal(i.reviewStatus, 'draft'); assert.equal(i.published, false)
+    if (v2) {
+      assert.equal(typeof i.heldOut, 'boolean', `Held-out flag missing: ${i.id}`)
+      assert.equal(i.heldOut, i.poolIntent === 'held_out_mock', `Held-out flag disagrees with pool intent: ${i.id}`)
+      assert.ok(i.sourcePackId && i.packFactsHash, `Source pack missing: ${i.id}`)
+    } else { assert.equal(i.heldOut, false); assert.ok(Array.isArray(i.sourceReferences) && i.sourceReferences.length, `Source references missing: ${i.id}`) }
     assert.equal(i.learnerDistributionAuthorized, false); assert.equal(i.reviewerConfirmedDifficulty, null)
     assert.equal(i.mapping.signOff, 'pending'); assert.equal(i.familyProposal.constructionStatus, 'provisional')
     assert.ok(['unconfirmed', 'cleared'].includes(i.inputRights.state))
-    assert.ok(i.id.startsWith('pp-ref2027-') || i.id.startsWith('pp-2027-') || i.id.startsWith('pp-pilot-'))
+    assert.ok(i.id.startsWith('pp-ref2027-') || i.id.startsWith('pp-2027-') || i.id.startsWith('pp-pilot-') || (v2 && i.heldOut && i.id.startsWith('pp-mock1-')), `Unexpected item id: ${i.id}`)
+    // A shared family is allowed only for declared variants of one construction: same hint, outcome and pool.
+    const shape = JSON.stringify([i.familyHint ?? null, i.outcomeId, i.heldOut])
+    if (families.has(i.familyProposal.id)) assert.ok(v2 && i.familyHint && families.get(i.familyProposal.id) === shape, `Family shared by unrelated items: ${i.id}`)
+    else families.set(i.familyProposal.id, shape)
     assert.equal(i.draft.options.length, 3); assert.equal(new Set(i.draft.options).size, 3)
     assert.ok(Number.isInteger(i.draft.keyIndex) && i.draft.keyIndex >= 0 && i.draft.keyIndex < 3)
     assert.ok(Number.isInteger(i.itemVersion) && i.itemVersion >= 1)
@@ -36,7 +49,7 @@
   await c.query('begin')
   try {
     await c.query("select pg_advisory_xact_lock(hashtext('reference-bank-2027-intake'))")
-    const existing = (await c.query('select id, item_card, stem, options, key_index, per_option_feedback, item_version, outcome_id from public.assessment_items where id=any($1::text[]) for update', [bank.items.map(i => i.id)])).rows
+    const existing = (await c.query('select id, item_card, stem, options, key_index, per_option_feedback, item_version, outcome_id, held_out, family_id from public.assessment_items where id=any($1::text[]) for update', [bank.items.map(i => i.id)])).rows
     // Exact retries are harmless. Any collision requires a separate, explicit reviewer revision.
     for (const row of existing) {
       const i = bank.items.find(i => i.id === row.id)
@@ -44,14 +57,15 @@
       assert.equal(row.stem, i.draft.stem); assert.deepEqual(row.options, i.draft.options)
       assert.equal(row.key_index, i.draft.keyIndex); assert.equal(row.item_version, i.itemVersion)
       assert.equal(row.outcome_id, i.outcomeId); assert.deepEqual(row.per_option_feedback, i.draft.perOptionFeedback)
+      assert.equal(row.held_out, i.heldOut === true, `Existing item pool differs: ${row.id}`); assert.equal(row.family_id, i.familyProposal.id, `Existing item family differs: ${row.id}`)
       for (const [field, value] of Object.entries(i.draft.card)) assert.deepEqual(row.item_card[field], value, `Existing item card differs: ${row.id}.${field}`)
     }
     const ids = new Set(existing.map(i => i.id)), pending = bank.items.filter(i => !ids.has(i.id))
     if (!pending.length) { await c.query('commit'); return { inserted: 0, preserved: ids.size, bankHash } }
     const batch = (await c.query(`insert into public.item_batches(request_key,label,manifest_id,curriculum_version,source_provenance,rights_status,prompt_version,model_versions,status,requested_count,config_hash,finished_at)
-      values($1,'2027 local reference drafts — human review pending',$2,'2027',$3::jsonb,'unconfirmed','reference-draft-bank.1',$4::jsonb,'complete',$5,$6,now())
+      values($1,'2027 local reference drafts — human review pending',$2,'2027',$3::jsonb,'unconfirmed',$7,$4::jsonb,'complete',$5,$6,now())
       on conflict(request_key) do update set request_key=excluded.request_key returning id`,
-    [requestKey, bank.manifestId, JSON.stringify({ input: 'User-provided curriculum files', inputUse: 'Internal local drafting only; learner distribution not authorised', sourceFiles: [...new Set(bank.items.flatMap(i => i.sourceReferences.map(r => r.file)))] }), JSON.stringify({ author: 'Local Codex drafting and carried-forward fixtures; no new external model verification' }), bank.items.length, bankHash])).rows[0].id
+    [requestKey, bank.manifestId, JSON.stringify({ input: 'User-provided curriculum files', inputUse: 'Internal local drafting only; learner distribution not authorised', sourceFiles: [...new Set(bank.items.flatMap(i => (i.sourceReferences ?? []).map(r => r.file)))], sourcePacks: [...new Set(bank.items.map(i => i.sourcePackId))] }), JSON.stringify({ author: 'Local Codex drafting and carried-forward fixtures; no new external model verification' }), bank.items.length, bankHash, bank.schema])).rows[0].id
     let ordinal = 0
     for (const i of bank.items) {
       ordinal++
@@ -64,12 +78,17 @@
       const concept = (await c.query('select manifest_id,lm_id,name from public.curriculum_concepts where id=$1', [i.conceptId])).rows[0]
       assert.equal(concept.manifest_id, bank.manifestId); assert.equal(concept.lm_id, i.readingId); assert.equal(concept.name, i.outcomeTitle)
       await c.query('insert into public.concept_outcome_map(concept_id,outcome_id,approximate) values($1,$2,true) on conflict do nothing', [i.conceptId, i.outcomeId])
-      await c.query("insert into public.item_families(id,family_key,note,construction_status) values($1,$2,'Candidate only; independence unconfirmed','provisional')", [i.familyProposal.id, `reference-2027:${i.id}`])
+      // The family owns the held-out flag (items inherit it), so a held-out draft's family is created held out.
+      await c.query("insert into public.item_families(id,family_key,note,construction_status,held_out,held_out_reason) values($1,$2,'Candidate only; independence unconfirmed','provisional',$3,$4) on conflict(id) do nothing", [i.familyProposal.id, `reference-2027:${i.id}`, i.heldOut === true, i.heldOut ? 'Quarantined held-out mock candidate from reference intake' : null])
+      // A family that already exists must be a provisional one from this intake; it is never borrowed from reviewed inventory.
+      const family = (await c.query('select family_key,construction_status,held_out from public.item_families where id=$1', [i.familyProposal.id])).rows[0]
+      assert.ok(family.family_key.startsWith('reference-2027:') && family.construction_status === 'provisional', `Family already used by other inventory: ${i.id}`)
+      assert.equal(family.held_out, i.heldOut === true, `Family pool differs: ${i.id}`)
       const card = { ...i.draft.card, referenceIntakeHash: i.contentHash, packId: i.sourcePackId, packFactsHash: i.packFactsHash, groundingPacketHash: i.groundingPacketHash, rights: i.inputRights, sourceReferences: i.sourceReferences, authoringValidation: i.validation, modelBlindSolve: i.modelBlindSolve }
       const scale = { foundation: .5, standard: 1, difficult: 1.5, stretch: 2 }
-      await c.query(`insert into public.assessment_items(id,lm_id,learning_objective,verification_intent,difficulty,stem,options,key_index,per_option_feedback,provenance,review_status,concept_id,outcome_id,item_card,item_version,family_id,cognition,item_form,intended_difficulty,generator_model,batch_id,semantic_fingerprint)
-        values($1,$2,$3,'Original draft; exact-version independent verification and human review pending',$4,$5,$6::jsonb,$7,$8::jsonb,'reference-2027-quarantined-local-draft','draft',$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19)`,
-      [i.id, i.readingId, i.outcomeTitle, scale[i.intendedDifficulty], i.draft.stem, JSON.stringify(i.draft.options), i.draft.keyIndex, JSON.stringify(i.draft.perOptionFeedback), i.conceptId, i.outcomeId, JSON.stringify(card), i.itemVersion, i.familyProposal.id, i.draft.card.cognition, i.draft.card.itemForm, i.intendedDifficulty, i.draft.generatorModel, batch, i.semanticFingerprint])
+      await c.query(`insert into public.assessment_items(id,lm_id,learning_objective,verification_intent,difficulty,stem,options,key_index,per_option_feedback,provenance,review_status,concept_id,outcome_id,item_card,item_version,family_id,cognition,item_form,intended_difficulty,generator_model,batch_id,semantic_fingerprint,held_out)
+        values($1,$2,$3,'Original draft; exact-version independent verification and human review pending',$4,$5,$6::jsonb,$7,$8::jsonb,'reference-2027-quarantined-local-draft','draft',$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
+      [i.id, i.readingId, i.outcomeTitle, scale[i.intendedDifficulty], i.draft.stem, JSON.stringify(i.draft.options), i.draft.keyIndex, JSON.stringify(i.draft.perOptionFeedback), i.conceptId, i.outcomeId, JSON.stringify(card), i.itemVersion, i.familyProposal.id, i.draft.card.cognition, i.draft.card.itemForm, i.intendedDifficulty, i.draft.generatorModel, batch, i.semanticFingerprint, i.heldOut === true])
       await c.query("insert into public.item_batch_cells(batch_id,ordinal,cell,status,item_id,verdict) values($1,$2,$3::jsonb,'drafted',$4,'UNVERIFIED_LOCAL_DRAFT')", [batch, ordinal, JSON.stringify({ outcomeId: i.outcomeId, conceptId: i.conceptId, difficulty: i.intendedDifficulty }), i.id])
     }
     await c.query('commit')
@@ -93,6 +112,7 @@
       const queryCount = async sql => Number((await c.query(sql, [bank.items.map(i => i.id)])).rows[0].n)
       assert.equal(await queryCount("select count(*) n from public.assessment_items where id=any($1) and review_status='draft'"), bank.items.length)
       assert.equal(await queryCount('select count(*) n from public.student_eligible_items where id=any($1)'), 0)
+      assert.equal(await queryCount('select count(*) n from public.assessment_items where id=any($1) and held_out'), bank.items.filter(i => i.heldOut).length)
       assert.equal(await queryCount('select count(*) n from public.rehearsal_eligible_items where id=any($1)'), 0)
       assert.equal(await queryCount("select count(*) n from public.item_families f join public.assessment_items i on i.family_id=f.id where i.id=any($1) and construction_status='confirmed'"), 0)
       assert.equal(await queryCount('select count(*) n from public.item_review_decisions where item_id=any($1)'), 0)
```
