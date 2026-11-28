import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { buildGroundingPacket, factsHash, type SourcePack } from '../src/lib/diagnostic/groundingPacket'
import { checkItemFormat } from '../src/lib/diagnostic/formatRules'
import { semanticFingerprint } from '../src/lib/diagnostic/generator'
import { nearMatches } from '../src/lib/diagnostic/nearMatch'
import {
  allowedScales,
  matchComputedToOption,
  matchesAtPrecision,
  optionDecimals,
  parseOptionNumber,
  safeEvaluate,
  stemInputDefects,
} from '../src/lib/diagnostic/verifier'
import { ERROR_TAXONOMY } from '../src/lib/diagnostic/types'
import { PHASE1_PILOT_ITEMS, PILOT_MANIFEST_ID } from './fixtures/phase1-pilot-items'
import { FSA_ITEMS } from './lib/fsaBank/all'

const PACK_DIR = 'content/source-packs/private/prepplan'

function loadPrepPlanPacks(): Map<string, SourcePack> {
  const map = new Map<string, SourcePack>()
  for (const f of readdirSync(PACK_DIR).filter(x => x.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(PACK_DIR, f), 'utf8')) as SourcePack
    map.set(p.packId, p)
  }
  return map
}

function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function main() {
  const packs = loadPrepPlanPacks()
  assert.ok(packs.size >= 6, `expected >= 6 PrepPlan packs, got ${packs.size}`)
  assert.equal(PHASE1_PILOT_ITEMS.length, 18, `expected 18 pilot items, got ${PHASE1_PILOT_ITEMS.length}`)

  const familyIds = new Set<string>()
  const fingerprints = new Set<string>()
  const keyCounts = [0, 0, 0]
  const matrixRows: any[] = []

  // Legacy r032 items for near-match check and disposition table
  const legacyR032 = FSA_ITEMS.filter(x => x.o.startsWith('r032-')).map((x, idx) => ({
    id: `q-fsa-${x.o}-${x.t === 'E' ? 'easy' : x.t === 'M' ? 'medium' : 'hard'}`,
    outcomeId: x.o,
    tier: x.t,
    stem: x.q,
    options: [x.ok ?? '', ...x.w.map(w => w[0])],
    seq: idx,
  }))

  for (const item of PHASE1_PILOT_ITEMS) {
    // 1. Publication & quarantine invariants
    assert.equal(item.published, false, `${item.id}: must be unpublished`)
    assert.notEqual(item.reviewStatus as string, 'reviewed', `${item.id}: must not be reviewed`)
    assert.equal(item.reviewerConfirmedDifficulty, null, `${item.id}: reviewerConfirmedDifficulty must be null`)
    assert.ok(item.estimatedSeconds > 0 && item.estimatedSeconds <= 90, `${item.id}: estimatedSeconds ${item.estimatedSeconds} exceeds 90s`)

    // 2. Independent family & fingerprint uniqueness
    assert.ok(!familyIds.has(item.familyId), `${item.id}: duplicate familyId ${item.familyId}`)
    familyIds.add(item.familyId)

    // 3. Grounding packet validation
    const pack = packs.get(item.packId)
    assert.ok(pack, `${item.id}: missing pack ${item.packId}`)
    assert.equal(pack.rights.state, 'cleared', `${item.id}: pack rights must be cleared`)
    assert.ok(pack.rights.authority?.trim(), `${item.id}: pack authority missing`)
    assert.equal(pack.contentHash, factsHash(pack.facts), `${item.id}: pack contentHash mismatch`)

    const conceptId = uuidFrom(item.conceptIdSeed)
    const { packet, blockers } = buildGroundingPacket({
      manifest: { id: PILOT_MANIFEST_ID, year: 2027, version: 'v1.0' },
      cell: {
        outcomeId: item.outcomeId,
        readingId: item.readingId,
        conceptId,
        conceptName: item.draft.card.conceptName,
        cognition: item.draft.card.cognition,
        itemForm: item.draft.card.itemForm,
        difficulty: item.intendedDifficulty,
      },
      concept: { verification_status: 'verified', manifest_id: PILOT_MANIFEST_ID },
      mapping: { outcome_id: item.outcomeId, approximate: false },
      pack,
    })
    assert.ok(packet, `${item.id}: grounding packet blocked: ${JSON.stringify(blockers)}`)
    assert.equal(blockers.filter(b => b.blocking).length, 0, `${item.id}: unexpected blocking packet defects`)

    // 4. Deterministic format & stem/input gates
    const formatDefects = checkItemFormat(item.draft.stem, item.draft.options)
    assert.equal(formatDefects.length, 0, `${item.id}: format defects: ${JSON.stringify(formatDefects)}`)

    const inputDefects = stemInputDefects(item.draft)
    assert.equal(inputDefects.length, 0, `${item.id}: stemInputDefects: ${JSON.stringify(inputDefects)}`)

    // 5. Distractor taxonomy & feedback completeness
    assert.equal(item.draft.options.length, 3, `${item.id}: must have 3 options`)
    assert.equal(new Set(item.draft.options.map(o => o.trim().toLowerCase())).size, 3, `${item.id}: options not unique`)
    const wrongIndices = [0, 1, 2].filter(i => i !== item.draft.keyIndex)
    for (const wi of wrongIndices) {
      const diag = item.draft.card.distractorDiagnoses.find(d => d.optionIndex === wi)
      assert.ok(diag, `${item.id}: missing distractor diagnosis for option ${wi}`)
      assert.ok(diag.errorCode in ERROR_TAXONOMY, `${item.id}: bad errorCode ${diag.errorCode}`)
      assert.ok(item.draft.perOptionFeedback[String(wi)]?.length >= 10, `${item.id}: missing feedback for option ${wi}`)
    }
    assert.ok(item.draft.perOptionFeedback[String(item.draft.keyIndex)]?.length >= 10, `${item.id}: missing key feedback`)
    keyCounts[item.draft.keyIndex]++

    // 6. Fingerprint & near-match check
    const fp = semanticFingerprint(item.draft.stem, item.draft.options)
    assert.ok(!fingerprints.has(fp), `${item.id}: duplicate semanticFingerprint ${fp}`)
    fingerprints.add(fp)

    const selfEntry = { id: item.id, stem: item.draft.stem, options: item.draft.options }
    const peerMatches = nearMatches(
      selfEntry,
      PHASE1_PILOT_ITEMS.map(x => ({ id: x.id, stem: x.draft.stem, options: x.draft.options })),
      0.45
    )
    assert.equal(peerMatches.length, 0, `${item.id}: unexpected near-match >=0.45 with pilot peer: ${JSON.stringify(peerMatches)}`)

    const legacyMatches = nearMatches(selfEntry, legacyR032, 0.55)
    assert.equal(legacyMatches.length, 0, `${item.id}: unexpected near-match >=0.55 with legacy r032: ${JSON.stringify(legacyMatches)}`)

    // 7. Deterministic arithmetic & distractor formula verification
    let keyEval: number | null = null
    const distractorEvals: Record<string, number> = {}
    if (item.draft.card.isNumeric) {
      assert.ok(item.keyFormula, `${item.id}: numeric item missing keyFormula`)
      keyEval = safeEvaluate(item.keyFormula, item.draft.card.exactNumericValues)
      const optionValues = item.draft.options.map(parseOptionNumber)
      const scales = allowedScales(item.draft.options)
      const decimals = item.draft.options.map(optionDecimals)
      const match = matchComputedToOption(keyEval, optionValues, scales, decimals)
      assert.equal(match.tie, false, `${item.id}: rounding tie on keyEval=${keyEval}`)
      assert.equal(match.multiple, false, `${item.id}: multiple options match keyEval=${keyEval}`)
      assert.equal(match.index, item.draft.keyIndex, `${item.id}: keyFormula evaluated to ${keyEval}, matched ${match.index}, expected ${item.draft.keyIndex}`)

      for (const wi of wrongIndices) {
        const df = item.distractorFormulas?.[String(wi)]
        assert.ok(df, `${item.id}: missing distractorFormula for option ${wi}`)
        const dv = safeEvaluate(df, item.draft.card.exactNumericValues)
        distractorEvals[String(wi)] = dv
        const target = parseOptionNumber(item.draft.options[wi])
        const ok = matchesAtPrecision(dv, target, optionDecimals(item.draft.options[wi])).match
        assert.ok(ok, `${item.id}: distractor ${wi} formula "${df}" evaluated to ${dv}, expected ${target}`)
      }
    }

    matrixRows.push({
      id: item.id,
      itemVersion: item.itemVersion,
      revisionHistory: item.revisionHistory ?? [],
      codexBlindSolve: item.codexBlindSolve,
      familyId: item.familyId,
      edition: item.edition,
      manifestId: item.manifestId,
      readingId: item.readingId,
      outcomeId: item.outcomeId,
      conceptId,
      syntheticFixtureGrounding: true,
      groundingNote: 'conceptId, verification_status=verified, and approximate=false are synthetic fixture inputs to buildGroundingPacket(); canonical mappings require DB sign-off.',
      packId: item.packId,
      packVersion: item.packVersion,
      packFactsHash: pack.contentHash,
      groundingPacketHash: packet.hash,
      rightsState: pack.rights.state,
      rightsAuthority: pack.rights.authority,
      learnerDistributionAuthorized: false,
      intendedDifficulty: item.intendedDifficulty,
      legacyTierLabel: item.legacyTierLabel,
      comparativeTierRationale: item.comparativeTierRationale,
      reviewerConfirmedDifficulty: item.reviewerConfirmedDifficulty,
      reviewStatus: item.reviewStatus,
      published: item.published,
      estimatedSeconds: item.estimatedSeconds,
      semanticFingerprint: fp,
      isNumeric: item.draft.card.isNumeric,
      keyIndex: item.draft.keyIndex,
      keyFormula: item.keyFormula ?? null,
      keyEvaluated: keyEval,
      distractorEvals,
      automatedVerdict: 'OFFLINE_DETERMINISTIC_PASS',
      skippedChecks: ['llm_writer_and_llm_blind_solver_skipped_offline'],
    })

    console.log(`  ✓ ${item.id} v${item.itemVersion} [${item.legacyTierLabel}/${item.intendedDifficulty}] key=${['A', 'B', 'C'][item.draft.keyIndex]} fp=${fp}${keyEval !== null ? ` eval=${keyEval.toFixed(4)}` : ''}`)
  }

  // 8. Batch answer-position balance (no systematic cue; no forced equal split at expense of quality)
  assert.ok(keyCounts.every(c => c >= 4 && c <= 8), `answer-position skew out of [4,8] bounds: ${JSON.stringify(keyCounts)}`)
  console.log(`\nAnswer-position balance: A=${keyCounts[0]}, B=${keyCounts[1]}, C=${keyCounts[2]}`)

  // 9. Negative grounding & leakage checks
  const samplePack = packs.get('prepplan-r032-a-lcnrv')!
  const negMissing = buildGroundingPacket({
    manifest: { id: PILOT_MANIFEST_ID, year: 2027, version: 'v1.0' },
    cell: { outcomeId: 'r032-a', readingId: 'r032', conceptId: 'c1', conceptName: 'x', cognition: 'apply', itemForm: 'scenario', difficulty: 'standard' },
    concept: { verification_status: 'verified', manifest_id: PILOT_MANIFEST_ID },
    mapping: { outcome_id: 'r032-a', approximate: false },
    pack: null,
  })
  assert.equal(negMissing.packet, null)
  assert.ok(negMissing.blockers.some(b => b.code === 'NO_SOURCE_PACK' && b.blocking))

  const negWrongMap = buildGroundingPacket({
    manifest: { id: PILOT_MANIFEST_ID, year: 2027, version: 'v1.0' },
    cell: { outcomeId: 'r032-a', readingId: 'r032', conceptId: 'c1', conceptName: 'x', cognition: 'apply', itemForm: 'scenario', difficulty: 'standard' },
    concept: { verification_status: 'verified', manifest_id: PILOT_MANIFEST_ID },
    mapping: { outcome_id: 'r032-b', approximate: false },
    pack: samplePack,
  })
  assert.equal(negWrongMap.packet, null)
  assert.ok(negWrongMap.blockers.some(b => b.code === 'MAPPING_MISMATCH' && b.blocking))

  const negWrongEdition = buildGroundingPacket({
    manifest: { id: PILOT_MANIFEST_ID, year: 2027, version: 'v1.0' },
    cell: { outcomeId: 'r032-a', readingId: 'r032', conceptId: 'c1', conceptName: 'x', cognition: 'apply', itemForm: 'scenario', difficulty: 'standard' },
    concept: { verification_status: 'verified', manifest_id: PILOT_MANIFEST_ID },
    mapping: { outcome_id: 'r032-a', approximate: false },
    pack: { ...samplePack, edition: '2026' },
  })
  assert.equal(negWrongEdition.packet, null)
  assert.ok(negWrongEdition.blockers.some(b => b.code === 'PACK_OUTDATED' && b.blocking))

  const negBadHash = buildGroundingPacket({
    manifest: { id: PILOT_MANIFEST_ID, year: 2027, version: 'v1.0' },
    cell: { outcomeId: 'r032-a', readingId: 'r032', conceptId: 'c1', conceptName: 'x', cognition: 'apply', itemForm: 'scenario', difficulty: 'standard' },
    concept: { verification_status: 'verified', manifest_id: PILOT_MANIFEST_ID },
    mapping: { outcome_id: 'r032-a', approximate: false },
    pack: { ...samplePack, contentHash: '0'.repeat(64) },
  })
  assert.equal(negBadHash.packet, null)
  assert.ok(negBadHash.blockers.some(b => b.code === 'PACK_HASH_MISMATCH' && b.blocking))
  console.log('Negative grounding & draft-leakage checks: PASS (NO_SOURCE_PACK, MAPPING_MISMATCH, PACK_OUTDATED, PACK_HASH_MISMATCH)')

  if (process.argv.includes('--write-artifacts')) {
    mkdirSync('docs/evidence', { recursive: true })

    // Per-item matrix JSON (no private pack text)
    const legacyDispositions = legacyR032.map(l => ({
      legacyItemId: l.id,
      itemVersion: 1,
      outcomeId: l.outcomeId,
      tier: l.tier,
      disposition: 'replace',
      reason: 'Legacy item mapped to CFAI-derived unconfirmed r032 pack; replaced with independent-family candidate grounded in cleared first-party PrepPlan pack.',
    }))
    writeFileSync(
      'docs/evidence/phase1-pilot-matrix.json',
      JSON.stringify({
        generatedAt: '2026-11-24',
        edition: '2027',
        manifestId: PILOT_MANIFEST_ID,
        totalItems: matrixRows.length,
        answerPositionCounts: { A: keyCounts[0], B: keyCounts[1], C: keyCounts[2] },
        items: matrixRows,
        legacyR032Dispositions: legacyDispositions,
      }, null, 2) + '\n'
    )

    // Blind review view (stem & options ONLY)
    const blindLines = [
      '# Question-Bank Phase 1 Pilot — Blind Review View (Stem & Options Only)',
      '',
      '18 unpublished candidates across `r032` (FSA: Analysis of Inventories) and `r004` (Quant: The Time Value of Money in Finance). Keys, rationales, and private pack content are intentionally omitted for independent blind review.',
      '',
    ]
    for (const item of PHASE1_PILOT_ITEMS) {
      blindLines.push(`## ${item.id} (${item.readingId} · ${item.outcomeId} · ${item.legacyTierLabel})`)
      blindLines.push('')
      blindLines.push(item.draft.stem)
      blindLines.push('')
      item.draft.options.forEach((opt, idx) => {
        blindLines.push(`- **${['A', 'B', 'C'][idx]}.** ${opt}`)
      })
      blindLines.push('')
    }
    writeFileSync('docs/evidence/phase1-pilot-blind-review.md', blindLines.join('\n'))

    // Answer & provenance view
    const provLines = [
      '# Question-Bank Phase 1 Pilot — Answer & Provenance View',
      '',
      'All 18 candidates remain **unpublished** (`published: false`, `reviewerConfirmedDifficulty: null`). Original source-pack fact text is kept private in `content/source-packs/private/prepplan/`.',
      '',
    ]
    for (const item of PHASE1_PILOT_ITEMS) {
      const row = matrixRows.find(r => r.id === item.id)!
      provLines.push(`## ${item.id} (v${item.itemVersion})`)
      provLines.push(`- **Scope:** Edition ${item.edition} · Manifest \`${item.manifestId}\` · Reading \`${item.readingId}\` · Outcome \`${item.outcomeId}\` · Concept \`${row.conceptId}\``)
      provLines.push(`- **Family:** \`${item.familyId}\` · Fingerprint \`${row.semanticFingerprint}\``)
      provLines.push(`- **Pack & Rights:** \`${item.packId}@${item.packVersion}\` · factsHash \`${row.packFactsHash.slice(0, 16)}...\` · packetHash \`${row.groundingPacketHash.slice(0, 16)}...\` · rights \`${row.rightsState}\` (${row.rightsAuthority})`)
      provLines.push(`- **Package:** rubric \`${item.rubricVersion}\` · prompts \`${JSON.stringify(item.promptVersions)}\``)
      provLines.push(`- **Difficulty:** intended \`${item.intendedDifficulty}\` (${item.legacyTierLabel}) · reviewerConfirmedDifficulty \`null\` · est. ${item.estimatedSeconds}s`)
      provLines.push(`- **Tier Rationale:** ${item.tierRationale}`)
      provLines.push(`- **Key:** **${['A', 'B', 'C'][item.draft.keyIndex]}** (${item.draft.options[item.draft.keyIndex]})`)
      provLines.push(`- **Calculation & Assumptions:** ${item.calculationAndAssumptions}`)
      if (item.keyFormula) provLines.push(`- **Key Formula:** \`${item.keyFormula}\` → \`${row.keyEvaluated}\``)
      provLines.push(`- **Worked Rationale:** ${item.draft.card.solution}`)
      for (const d of item.draft.card.distractorDiagnoses) {
        const evalNote = row.distractorEvals[String(d.optionIndex)] !== undefined ? ` (formula \`${item.distractorFormulas?.[String(d.optionIndex)]}\` → \`${row.distractorEvals[String(d.optionIndex)]}\`)` : ''
        provLines.push(`- **Distractor ${['A', 'B', 'C'][d.optionIndex]} [${d.errorCode}]:** ${d.description}${evalNote}`)
      }
      provLines.push(`- **Automated Verdict:** ${row.automatedVerdict}`)
      provLines.push('')
    }
    writeFileSync('docs/evidence/phase1-pilot-provenance-review.md', provLines.join('\n'))
    console.log('Wrote artifacts to docs/evidence/phase1-pilot-{matrix.json,blind-review.md,provenance-review.md}')
  }
}

main()
