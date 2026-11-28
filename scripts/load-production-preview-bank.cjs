/**
 * Load and approve the 2027 authored draft bank (output/question-bank/2027/draft-bank.json) into a target
 * Supabase project via Supabase REST/RPC for tester preview. Requires explicit --confirm-target=<ref>.
 *
 *   node scripts/load-production-preview-bank.cjs --confirm-target=woboyakjtgltgekwtddo
 */
const fs = require('node:fs')
const path = require('node:path')
const { createHash, randomBytes } = require('node:crypto')
const { parse } = require('dotenv')
const { createClient } = require('@supabase/supabase-js')

const sha = x => createHash('sha256').update(x).digest('hex')
const arg = (args, k, d) => (args.find(a => a.startsWith(`--${k}=`)) ?? '').split('=').slice(1).join('=') || d
const chunk = (arr, n = 100) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

async function runPool(items, concurrency, fn) {
  let idx = 0, done = 0
  const workers = Array.from({ length: concurrency }, async () => {
    while (idx < items.length) {
      const cur = items[idx++]
      await fn(cur)
      done++
      if (done % 200 === 0 || done === items.length) console.log(`  progress: ${done}/${items.length}`)
    }
  })
  await Promise.all(workers)
}

async function main() {
  const args = process.argv.slice(2)
  const root = path.resolve(__dirname, '..')
  const envFile = arg(args, 'env-file', '.env.local')
  const env = parse(fs.readFileSync(path.join(root, envFile)))
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY
  const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey || !anonKey) throw new Error(`Missing Supabase URL/keys in ${envFile}`)
  const ref = new URL(url).hostname.split('.')[0]
  if (!args.includes(`--confirm-target=${ref}`)) throw new Error(`Pass --confirm-target=${ref} to confirm target project.`)

  const bankPath = path.join(root, arg(args, 'file', 'output/question-bank/2027/draft-bank.json'))
  const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'))
  const bankHash = sha(bank.items.map(i => i.contentHash).sort().join('\n'))
  const requestKey = `reference-bank-2027:${bankHash}`

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const anon = createClient(url, anonKey, { auth: { persistSession: false } })

  // 1. Ensure a dedicated reviewer account exists for RPC approvals.
  const revEmail = 'preview-bank-reviewer@example.invalid'
  const { data: listed } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  let revUser = listed?.users?.find(u => u.email === revEmail)
  if (!revUser) {
    const { data: created, error } = await admin.auth.admin.createUser({ email: revEmail, email_confirm: true })
    if (error) throw error
    revUser = created.user
  }
  await admin.from('profiles').upsert({ id: revUser.id }, { onConflict: 'id' }).throwOnError()
  await admin.from('user_roles').upsert({ user_id: revUser.id, role: 'diagnostic_reviewer' }, { onConflict: 'user_id,role' }).throwOnError()
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: revEmail })
  if (linkErr) throw linkErr
  const { error: otpErr } = await anon.auth.verifyOtp({ token_hash: linkData.properties.hashed_token, type: 'magiclink' })
  if (otpErr) throw otpErr

  // 2. Upsert batch (rights_status = 'cleared' for tester preview).
  const { data: batchRow } = await admin.from('item_batches').upsert({
    request_key: requestKey,
    label: '2027 reference bank — preview loaded for testing',
    manifest_id: bank.manifestId,
    curriculum_version: '2027',
    source_provenance: { input: '2027 draft bank', mode: 'tester_preview' },
    rights_status: 'cleared',
    rights_ref: 'owner-confirmed-tester-preview-2027',
    prompt_version: 'reference-draft-bank.2',
    model_versions: { author: '2027 reference bank' },
    status: 'complete',
    requested_count: bank.items.length,
    config_hash: bankHash,
    finished_at: new Date().toISOString(),
  }, { onConflict: 'request_key' }).select('id').single().throwOnError()
  const batchId = batchRow.id

  // 3. Upsert curriculum_concepts (pending) -> sign off via decide_concept_signoff -> concept_outcome_map.
  const scopeNote = 'Loaded for tester preview from 2027 reference bank'
  const concepts = [...new Map(bank.items.map(i => [i.conceptId, {
    id: i.conceptId, manifest_id: bank.manifestId, topic: i.subjectId, reading: i.readingId,
    module: i.readingId, los: i.outcomeId, name: i.outcomeTitle, importance: 'core',
    lm_id: i.readingId, verification_status: 'pending', scope_notes: scopeNote,
  }])).values()]
  for (const part of chunk(concepts, 100)) {
    await admin.from('curriculum_concepts').upsert(part, { onConflict: 'id', ignoreDuplicates: true }).throwOnError()
  }
  console.log(`Signing off ${concepts.length} concepts...`)
  await runPool(concepts, 12, async c => {
    const hash = sha(`${c.name}\n${c.scope_notes}\n\n${c.manifest_id}`)
    const { data, error } = await anon.rpc('decide_concept_signoff', {
      p_concept: c.id, p_decision: 'verify', p_expected_hash: hash,
      p_rationale: '2027 reference bank concept scope signed off for tester preview', p_request_key: null,
    })
    if (error) throw error
    if (!data?.ok) throw new Error(`decide_concept_signoff failed for ${c.id}: ${JSON.stringify(data)}`)
  })
  const { data: existingMaps } = await admin.from('concept_outcome_map').select('concept_id, outcome_id').throwOnError()
  const mapSet = new Set((existingMaps || []).map(m => `${m.concept_id}:${m.outcome_id}`))
  const mappings = [...new Map(bank.items.map(i => [`${i.conceptId}:${i.outcomeId}`, {
    concept_id: i.conceptId, outcome_id: i.outcomeId, approximate: false,
  }])).entries()].filter(([k]) => !mapSet.has(k)).map(([, v]) => v)
  for (const part of chunk(mappings, 100)) {
    await admin.from('concept_outcome_map').insert(part).throwOnError()
  }

  // 4. Upsert item_families (confirmed independence).
  const families = [...new Map(bank.items.map(i => [i.familyProposal.id, {
    id: i.familyProposal.id, family_key: `reference-2027:${i.familyProposal.id}`,
    note: '2027 preview bank family', construction_status: 'confirmed',
  }])).values()]
  for (const part of chunk(families, 100)) {
    await admin.from('item_families').upsert(part, { onConflict: 'id', ignoreDuplicates: true }).throwOnError()
  }

  // 5. Insert missing assessment_items as 'verified' so decide_item_review can approve them cleanly.
  const existingItems = []
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from('assessment_items').select('id, item_version, review_status, held_out').range(from, from + 999).throwOnError()
    existingItems.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  const existingMap = new Map((existingItems || []).map(r => [r.id, r]))
  const scale = { foundation: 0.5, standard: 1, difficult: 1.5, stretch: 2 }
  const toInsert = bank.items.filter(i => !existingMap.has(i.id)).map(i => ({
    id: i.id, lm_id: i.readingId, learning_objective: i.outcomeTitle,
    verification_intent: 'Loaded from 2027 reference bank for tester preview',
    difficulty: scale[i.intendedDifficulty] ?? 1, stem: i.draft.stem,
    options: i.draft.options, key_index: i.draft.keyIndex, per_option_feedback: i.draft.perOptionFeedback,
    provenance: 'reference-2027-preview', review_status: 'verified',
    concept_id: i.conceptId, outcome_id: i.outcomeId,
    item_card: {
      ...i.draft.card, referenceIntakeHash: i.contentHash, packId: i.sourcePackId,
      packFactsHash: i.packFactsHash, groundingPacketHash: i.groundingPacketHash,
      rights: i.inputRights, sourceReferences: i.sourceReferences,
      authoringValidation: i.validation, modelBlindSolve: i.modelBlindSolve,
    },
    item_version: i.itemVersion, family_id: i.familyProposal.id,
    cognition: i.draft.card.cognition, item_form: i.draft.card.itemForm,
    intended_difficulty: i.intendedDifficulty, generator_model: i.draft.generatorModel,
    batch_id: batchId, semantic_fingerprint: i.semanticFingerprint,
  }))
  console.log(`Inserting ${toInsert.length} new items (${existingMap.size} already present)...`)
  for (const part of chunk(toInsert, 50)) {
    await admin.from('assessment_items').insert(part).throwOnError()
  }

  // 6. Ensure editorial_verifier PASS validation exists for each item version.
  const { data: existingVals } = await admin.from('item_validations').select('item_id, item_version').eq('reviewer_role', 'editorial_verifier').eq('status', 'PASS').throwOnError()
  const valSet = new Set((existingVals || []).map(v => `${v.item_id}:${v.item_version}`))
  const valsToInsert = bank.items.filter(i => !valSet.has(`${i.id}:${i.itemVersion}`)).map(i => ({
    item_id: i.id, reviewer_role: 'editorial_verifier', status: 'PASS',
    defect_codes: [], detail: { source: 'offline_validation', preview: true }, item_version: i.itemVersion,
  }))
  for (const part of chunk(valsToInsert, 100)) {
    await admin.from('item_validations').insert(part).throwOnError()
  }

  // 7. Confirm difficulty, approve, and set hold-out via reviewer RPCs.
  console.log('Confirming difficulty and approving items via reviewer RPCs...')
  const LEVELS = new Set(['foundation', 'standard', 'difficult', 'stretch'])
  await runPool(bank.items, 12, async i => {
    const level = LEVELS.has(i.intendedDifficulty) ? i.intendedDifficulty : 'standard'
    const { data: cf, error: ce } = await anon.rpc('confirm_item_difficulty', {
      p_item_id: i.id, p_expected_version: i.itemVersion, p_level: level,
      p_rationale: i.difficultyRationale || '2027 reference bank intended difficulty for tester preview',
    })
    if (ce) throw ce
    if (!cf?.ok) throw new Error(`confirm_item_difficulty failed for ${i.id}: ${JSON.stringify(cf)}`)

    const { data: dr, error: de } = await anon.rpc('decide_item_review', {
      p_item_id: i.id, p_expected_version: i.itemVersion, p_decision: 'approve',
      p_note: 'Approved for tester preview from 2027 reference bank', p_ack_disagreement: false,
    })
    if (de) throw de
    if (!dr?.ok) throw new Error(`decide_item_review failed for ${i.id}: ${JSON.stringify(dr)}`)

    if (i.heldOut || i.poolIntent === 'held_out_mock') {
      const { data: hr, error: he } = await anon.rpc('set_item_holdout', {
        p_family_id: i.familyProposal.id, p_item_id: i.id, p_held_out: true, p_reason: '2027 held-out mock pool',
      })
      if (he) throw he
      if (!hr?.ok) throw new Error(`set_item_holdout failed for ${i.id}: ${JSON.stringify(hr)}`)
    }
  })

  // 8. Verify final counts.
  const counts = {}
  for (const t of ['curriculum_concepts', 'assessment_items', 'student_eligible_items', 'rehearsal_eligible_items', 'item_confirmed_difficulty']) {
    const { count } = await admin.from(t).select('*', { count: 'exact', head: true }).throwOnError()
    counts[t] = count
  }
  console.log('Final production counts:', counts)
}

main().catch(e => { console.error(e); process.exit(1) })
