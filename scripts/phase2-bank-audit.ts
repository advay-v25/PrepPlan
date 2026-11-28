import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
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
import { createAdminClient } from '../src/lib/supabase/admin'
import { getCapacityReport } from '../src/lib/tests/capacityReport'
import { PHASE1_PILOT_ITEMS, PILOT_MANIFEST_ID, type PilotItemRecord } from './fixtures/phase1-pilot-items'
import { PHASE2_SLICE_ITEMS } from './fixtures/phase2-slice-items'
import { FSA_ITEMS } from './lib/fsaBank/all'
import ETHICS_ITEMS from './lib/ethicsBank/items.json'
import { ETHICS } from './lib/ethicsBank/structure'
import FSA_CATALOGUE from '../data/curriculum-2027/fsa-eq.json'
import { renderNumeric } from './lib/bankNumeric'
import type { BankItem } from './lib/bankLoader'

const PACK_DIR = 'content/source-packs/private'

function loadAllScopedPacks(): Map<string, SourcePack[]> {
  const byOutcome = new Map<string, SourcePack[]>()
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.json')) {
        const p = JSON.parse(readFileSync(full, 'utf8')) as SourcePack
        if (p?.packId && p?.outcomeId) {
          byOutcome.set(p.outcomeId, [...(byOutcome.get(p.outcomeId) ?? []), p])
        }
      }
    }
  }
  walk(PACK_DIR)
  return byOutcome
}

function loadClearedPrepPlanPacks(): Map<string, SourcePack> {
  const map = new Map<string, SourcePack>()
  const dir = join(PACK_DIR, 'prepplan')
  for (const f of readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
    const p = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SourcePack
    map.set(p.packId, p)
  }
  return map
}

function uuidFrom(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

type CatalogueOutcome = { subject: 'fsa' | 'eth'; readingId: string; outcomeId: string; title: string }

function pinnedCatalogueOutcomes(): CatalogueOutcome[] {
  return [
    ...FSA_CATALOGUE.subjects.filter(s => s.id === 'fsa').flatMap(s => s.readings.flatMap(r => {
      const readingId = `r${String(r.n).padStart(3, '0')}`
      return r.los.map(([code, title]) => ({ subject: 'fsa' as const, readingId, outcomeId: `${readingId}-${code}`, title: String(title) }))
    })),
    ...ETHICS.flatMap(r => r.los.map(([code, title]) => ({ subject: 'eth' as const, readingId: r.id, outcomeId: `${r.id}-${code}`, title }))),
  ]
}

async function loadCatalogueOutcomes(): Promise<{ source: 'live_manifest_db' | 'unavailable'; outcomes: CatalogueOutcome[] }> {
  try {
    const db = createAdminClient()
    const { data: readings, error: e1 } = await db
      .from('curriculum_readings')
      .select('id, topic_id, reading_no')
      .in('topic_id', ['fsa', 'eth'])
      .eq('is_active', true)
      .order('reading_no')
    if (e1 || !readings?.length) throw new Error(e1?.message ?? 'no readings')
    const { data: los, error: e2 } = await db
      .from('reading_los')
      .select('id, reading_id, title, sequence')
      .in('reading_id', readings.map(r => r.id))
      .order('reading_id')
      .order('sequence')
    if (e2 || !los?.length) throw new Error(e2?.message ?? 'no los')
    const topicByReading = new Map(readings.map(r => [r.id as string, r.topic_id as 'fsa' | 'eth']))
    return {
      source: 'live_manifest_db',
      outcomes: los.map(l => ({
        subject: topicByReading.get(l.reading_id as string)!,
        readingId: l.reading_id as string,
        outcomeId: l.id as string,
        title: l.title as string,
      })),
    }
  } catch {
    return { source: 'unavailable', outcomes: [] }
  }
}

/** Regression: catalogue outcome absent from loader data must be detected as missing from loader. */
function assertLoaderDetectsMissingOutcome() {
  const syntheticCatalogue = ['r027-a', 'r999-synthetic-omitted']
  const loaderOutcomes = new Set(FSA_ITEMS.map(x => x.o))
  const missing = syntheticCatalogue.filter(id => !loaderOutcomes.has(id))
  assert.deepEqual(missing, ['r999-synthetic-omitted'])
}

function verifySliceItems(items: PilotItemRecord<string>[], packs: Map<string, SourcePack>, allPeers: PilotItemRecord<string>[]) {
  const keyCounts = [0, 0, 0]
  const rows: any[] = []
  for (const item of items) {
    assert.equal(item.published, false)
    assert.notEqual(item.reviewStatus as string, 'reviewed')
    assert.equal(item.reviewerConfirmedDifficulty, null)
    assert.ok(item.estimatedSeconds > 0 && item.estimatedSeconds <= 90)

    const pack = packs.get(item.packId)
    assert.ok(pack, `${item.id}: missing pack ${item.packId}`)
    assert.equal(pack.rights.state, 'cleared')
    assert.equal(pack.contentHash, factsHash(pack.facts))

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
    assert.ok(packet, `${item.id}: packet blocked ${JSON.stringify(blockers)}`)
    assert.equal(blockers.filter(b => b.blocking).length, 0)

    const fmt = checkItemFormat(item.draft.stem, item.draft.options)
    assert.equal(fmt.length, 0, `${item.id}: format defects ${JSON.stringify(fmt)}`)
    const inp = stemInputDefects(item.draft)
    assert.equal(inp.length, 0, `${item.id}: stemInputDefects ${JSON.stringify(inp)}`)

    // Key-length cue audit for qualitative items
    if (!item.draft.card.isNumeric) {
      const keyLen = item.draft.options[item.draft.keyIndex].length
      const avgDistLen =
        item.draft.options.filter((_, i) => i !== item.draft.keyIndex).reduce((s, o) => s + o.length, 0) / 2
      assert.ok(keyLen <= avgDistLen * 1.45, `${item.id}: key conspicuously longer (${keyLen} vs avg distractor ${avgDistLen.toFixed(1)})`)
    }

    const wrongIndices = [0, 1, 2].filter(i => i !== item.draft.keyIndex)
    for (const wi of wrongIndices) {
      const diag = item.draft.card.distractorDiagnoses.find(d => d.optionIndex === wi)
      assert.ok(diag && diag.errorCode in ERROR_TAXONOMY)
    }
    keyCounts[item.draft.keyIndex]++

    const fp = semanticFingerprint(item.draft.stem, item.draft.options)
    const peerHits = nearMatches(
      { id: item.id, stem: item.draft.stem, options: item.draft.options },
      allPeers.map(x => ({ id: x.id, stem: x.draft.stem, options: x.draft.options })),
      0.55
    )
    assert.equal(peerHits.length, 0, `${item.id}: near-match >=0.55 with peer: ${JSON.stringify(peerHits)}`)

    let keyEval: number | null = null
    const distractorEvals: Record<string, number> = {}
    if (item.draft.card.isNumeric) {
      assert.ok(item.keyFormula)
      keyEval = safeEvaluate(item.keyFormula, item.draft.card.exactNumericValues)
      const match = matchComputedToOption(
        keyEval,
        item.draft.options.map(parseOptionNumber),
        allowedScales(item.draft.options),
        item.draft.options.map(optionDecimals)
      )
      assert.equal(match.tie, false)
      assert.equal(match.multiple, false)
      assert.equal(match.index, item.draft.keyIndex, `${item.id}: keyEval=${keyEval} matched ${match.index}`)
      for (const wi of wrongIndices) {
        const df = item.distractorFormulas?.[String(wi)]
        assert.ok(df)
        const dv = safeEvaluate(df, item.draft.card.exactNumericValues)
        distractorEvals[String(wi)] = dv
        assert.ok(matchesAtPrecision(dv, parseOptionNumber(item.draft.options[wi]), optionDecimals(item.draft.options[wi])).match)
      }
    }

    rows.push({
      id: item.id,
      itemVersion: item.itemVersion,
      revisionHistory: item.revisionHistory ?? [],
      codexBlindSolve: item.codexBlindSolve,
      familyId: item.familyId,
      readingId: item.readingId,
      outcomeId: item.outcomeId,
      conceptId,
      syntheticFixtureGrounding: true,
      packId: item.packId,
      packFactsHash: pack.contentHash,
      groundingPacketHash: packet.hash,
      intendedDifficulty: item.intendedDifficulty,
      legacyTierLabel: item.legacyTierLabel,
      reviewerConfirmedDifficulty: null,
      reviewStatus: item.reviewStatus,
      published: false,
      learnerDistributionAuthorized: false,
      semanticFingerprint: fp,
      keyIndex: item.draft.keyIndex,
      keyEvaluated: keyEval,
      distractorEvals,
      automatedVerdict: 'OFFLINE_DETERMINISTIC_PASS',
    })
    console.log(`  ✓ ${item.id} v${item.itemVersion} [${item.legacyTierLabel}/${item.intendedDifficulty}] key=${['A', 'B', 'C'][item.draft.keyIndex]} fp=${fp}`)
  }
  assert.ok(keyCounts.every(c => c >= 5 && c <= 9), `answer balance out of bounds: ${JSON.stringify(keyCounts)}`)
  console.log(`Phase 2 slice answer balance: A=${keyCounts[0]}, B=${keyCounts[1]}, C=${keyCounts[2]}`)
  return rows
}

function auditLegacyBank(subject: 'fsa' | 'eth', prefix: string, items: BankItem[], replacedOutcomes: Set<string>) {
  const tierName = { E: 'easy', M: 'medium', H: 'hard' } as const
  const sorted = [...items].sort((a, b) => (a.o + a.t).localeCompare(b.o + b.t))
  return sorted.map(raw => {
    const id = `${prefix}-${raw.o}-${tierName[raw.t]}`
    let stem = raw.q
    let options: string[] = [raw.ok ?? '', ...raw.w.map(w => w[0])]
    let numericError: string | null = null
    if (raw.num) {
      try {
        const r = renderNumeric(raw.num, raw.w.map(w => w[0]), [raw.q, raw.sol])
        stem = r.texts[0]
        options = [r.keyText, ...r.wrongTexts]
      } catch (e: any) {
        numericError = String(e?.message ?? e)
      }
    }
    const fmtDefects = checkItemFormat(stem, options)
    let disposition: 'replace' | 'revise' | 'keep for review' | 'blocked'
    let reason: string
    if (replacedOutcomes.has(raw.o)) {
      disposition = 'replace'
      reason = 'Replaced by independent-family candidates grounded in cleared first-party PrepPlan pack.'
    } else if (numericError || fmtDefects.length > 0) {
      disposition = 'revise'
      reason = numericError ? `Numeric render error: ${numericError}` : `Format defect(s): ${fmtDefects.map(d => d.code).join(', ')}`
    } else {
      disposition = 'keep for review'
      reason = 'Passes offline format/numeric check; quarantined pending cleared first-party source pack, concept sign-off, and human review.'
    }
    return {
      id,
      itemVersion: 1,
      subject,
      outcomeId: raw.o,
      tier: raw.t,
      isNumeric: Boolean(raw.num),
      formatDefectCodes: fmtDefects.map(d => d.code),
      numericError,
      disposition,
      reason,
    }
  })
}

async function main() {
  assertLoaderDetectsMissingOutcome()
  const packs = loadClearedPrepPlanPacks()
  const scopedPacks = loadAllScopedPacks()
  const allNew = [...PHASE1_PILOT_ITEMS, ...PHASE2_SLICE_ITEMS]
  const familySet = new Set(allNew.map(x => x.familyId))
  assert.equal(familySet.size, allNew.length, 'duplicate familyId across Phase 1 + Phase 2')

  console.log('Verifying 21 Phase 2 slice candidates (15 r095 + 3 r032-a + 3 r095-a):')
  const sliceRows = verifySliceItems(PHASE2_SLICE_ITEMS, packs, allNew)

  const fsaLegacy = auditLegacyBank('fsa', 'q-fsa', FSA_ITEMS, new Set(['r032-a', 'r032-b', 'r032-c']))
  const ethLegacy = auditLegacyBank('eth', 'q-eth', ETHICS_ITEMS as unknown as BankItem[], new Set(['r095-a', 'r095-b', 'r095-c', 'r095-d', 'r095-e']))

  const fsaCounts = {
    total: fsaLegacy.length,
    replace: fsaLegacy.filter(x => x.disposition === 'replace').length,
    revise: fsaLegacy.filter(x => x.disposition === 'revise').length,
    keepForReview: fsaLegacy.filter(x => x.disposition === 'keep for review').length,
  }
  const ethCounts = {
    total: ethLegacy.length,
    replace: ethLegacy.filter(x => x.disposition === 'replace').length,
    revise: ethLegacy.filter(x => x.disposition === 'revise').length,
    keepForReview: ethLegacy.filter(x => x.disposition === 'keep for review').length,
  }
  console.log('Legacy FSA audit:', fsaCounts)
  console.log('Legacy Ethics audit:', ethCounts)

  // Canonical live inventory + active manifest outcomes (never derived from FSA_ITEMS)
  const offline = process.argv.includes('--offline')
  const liveCatalogue = offline ? null : await loadCatalogueOutcomes()
  const cat = liveCatalogue?.source === 'live_manifest_db'
    ? liveCatalogue
    : { source: 'pinned_2027_seed', outcomes: pinnedCatalogueOutcomes() }
  let liveStatus: 'AVAILABLE' | 'UNAVAILABLE' = 'UNAVAILABLE'
  let liveError: string | null = null
  let liveReport: Awaited<ReturnType<typeof getCapacityReport>> | null = null
  if (offline) {
    liveError = 'Live inventory was skipped in offline mode.'
  } else {
    try {
      const report = await getCapacityReport()
      assert.equal(report.manifest.id, PILOT_MANIFEST_ID, 'inventory manifest does not match the 2027 audit')
      liveReport = report
      liveStatus = 'AVAILABLE'
    } catch (e) {
      liveError = e instanceof Error ? e.message : String(e)
    }
  }

  const fsaOutcomes = cat.outcomes.filter(o => o.subject === 'fsa').length
  const ethOutcomes = cat.outcomes.filter(o => o.subject === 'eth').length
  assert.equal(fsaOutcomes, 53, 'expected 53 FSA outcomes from the 2027 catalogue')
  assert.equal(ethOutcomes, 36, 'expected 36 Ethics outcomes from the 2027 catalogue')

  const liveOutcomeMap = new Map((liveReport?.outcomes ?? []).map(o => [o.id, o]))
  const outcomeMatrix = cat.outcomes.map(({ subject, readingId, outcomeId, title }) => {
    const legacy = (subject === 'fsa' ? fsaLegacy : ethLegacy).filter(x => x.outcomeId === outcomeId)
    const phase12 = allNew.filter(x => x.outcomeId === outcomeId)
    const mechanicallyDistinctFamilyIds = new Set(phase12.map(x => x.familyId)).size
    const independentlySolvedVersions = phase12.filter(x =>
      x.codexBlindSolve.status === 'matched_key' && x.codexBlindSolve.versionSolved === x.itemVersion
    ).length
    const liveOut = liveOutcomeMap.get(outcomeId)
    const approvedItemVersions = liveOut?.approvedRoutine ?? null
    const outcomePacks = scopedPacks.get(outcomeId) ?? []
    const clearedPack = outcomePacks.find(p => p.rights.state === 'cleared')
    const restrictedPack = outcomePacks.find(p => p.rights.state !== 'cleared')

    const packStatus = clearedPack
      ? phase12.length > 0
        ? 'cleared_pack_with_candidates'
        : 'pack_present_no_candidates'
      : restrictedPack
        ? 'restricted_use'
        : 'absent_pack'

    const tiers = {
      Easy: phase12.filter(x => x.legacyTierLabel === 'Easy').length,
      Medium: phase12.filter(x => x.legacyTierLabel === 'Medium').length,
      Hard: phase12.filter(x => x.legacyTierLabel === 'Hard').length,
    }

    // Re-check capacity math assuming candidate families become eligible & independent:
    // 0 prior exposures -> 1 initial + 5 recheck requires >= 6; 2 prior exposures -> 2 + 5 requires >= 7
    const hypotheticalCandidateDepth = {
      at0PriorExposures: {
        candidateFamilyIds: mechanicallyDistinctFamilyIds,
        enoughIdsForFiveQuestions: mechanicallyDistinctFamilyIds >= 5,
        singleConceptRepairAfter1Initial: Math.max(0, mechanicallyDistinctFamilyIds - 1) >= 5,
      },
      at2PriorExposures: {
        remainingAfter2Exposures: Math.max(0, mechanicallyDistinctFamilyIds - 2),
        singleConceptRepairReady: Math.max(0, mechanicallyDistinctFamilyIds - 2) >= 5,
      },
    }

    const blockers = [
      ...(packStatus === 'absent_pack' ? ['ABSENT_PACK'] : packStatus === 'restricted_use' ? ['RESTRICTED_USE_UNCONFIRMED_PACK'] : []),
      ...(phase12.length === 0 ? ['NO_CANDIDATES'] : []),
      'UNSIGNED_MAPPING',
      'UNCONFIRMED_TIER',
      'PENDING_APPROVAL',
      'COMMERCIAL_DISTRIBUTION_SIGNOFF_PENDING',
      ...(mechanicallyDistinctFamilyIds < 6 ? [`CANDIDATE_DEPTH_BELOW_ONE_PLUS_FIVE(${mechanicallyDistinctFamilyIds}/6_family_ids)`] : []),
    ]

    return {
      subject,
      readingId,
      outcomeId,
      title,
      packStatus,
      legacyItems: legacy.length,
      legacyDispositions: {
        replace: legacy.filter(x => x.disposition === 'replace').length,
        revise: legacy.filter(x => x.disposition === 'revise').length,
        keepForReview: legacy.filter(x => x.disposition === 'keep for review').length,
      },
      rawCandidates: phase12.length,
      offlineChecksPassed: phase12.length,
      mechanicallyDistinctFamilyIds,
      independentlySolvedVersions,
      approvedItemVersions,
      approvedRoutineFamilies: liveOut?.familiesRoutine ?? null,
      perStudentFreshCapacity: null,
      tiers,
      hypotheticalCandidateDepth,
      blockers,
    }
  })

  const quantCarryover = PHASE1_PILOT_ITEMS.filter(x => x.readingId === 'r004').map(x => ({
    id: x.id,
    itemVersion: x.itemVersion,
    outcomeId: x.outcomeId,
    familyId: x.familyId,
    intendedDifficulty: x.intendedDifficulty,
    published: x.published,
  }))

  const fsaWithNew = outcomeMatrix.filter(o => o.subject === 'fsa' && o.rawCandidates > 0).length
  const ethWithNew = outcomeMatrix.filter(o => o.subject === 'eth' && o.rawCandidates > 0).length
  console.log(`Phase 2 denominator (${cat.source}): FSA ${fsaWithNew}/${fsaOutcomes} (${fsaOutcomes - fsaWithNew} uncovered) + Ethics ${ethWithNew}/${ethOutcomes} (${ethOutcomes - ethWithNew} uncovered) = ${fsaWithNew + ethWithNew}/${fsaOutcomes + ethOutcomes}`)
  console.log(`Live inventory: ${liveStatus}${liveError ? ` (${liveError})` : ''}`)

  if (process.argv.includes('--write-artifacts')) {
    mkdirSync('docs/evidence', { recursive: true })
    writeFileSync(
      'docs/evidence/phase2-coverage-matrix.json',
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        edition: '2027',
        manifestId: PILOT_MANIFEST_ID,
        catalogueSource: cat.source,
        liveInventoryStatus: liveStatus,
        liveInventoryError: liveError,
        liveSummary: liveReport
          ? {
            raw: liveReport.total.raw,
            autoPass: liveReport.total.autoPass,
            quarantined: liveReport.total.quarantined,
            approvedRoutine: liveReport.total.approvedRoutine,
            approvedHeldOut: liveReport.total.approvedHeldOut,
          }
          : null,
        phase2Denominator: {
          fsaOutcomes,
          fsaWithNewCandidates: fsaWithNew,
          fsaUncovered: fsaOutcomes - fsaWithNew,
          ethOutcomes,
          ethWithNewCandidates: ethWithNew,
          ethUncovered: ethOutcomes - ethWithNew,
          totalPhase2Outcomes: fsaOutcomes + ethOutcomes,
          totalWithNewCandidates: fsaWithNew + ethWithNew,
          totalUncovered: fsaOutcomes + ethOutcomes - (fsaWithNew + ethWithNew),
        },
        quantR004Phase1Carryover: { outcomes: 3, candidates: quantCarryover.length, items: quantCarryover },
        legacySummary: { fsa: fsaCounts, eth: ethCounts },
        phase2SliceCandidates: sliceRows,
        outcomes: outcomeMatrix,
        legacyDispositions: [...fsaLegacy, ...ethLegacy],
      }, null, 2) + '\n'
    )

    const blind = [
      '# Question-Bank Phase 2 Slice — Blind Review View (Stem & Options Only)',
      '',
      '21 unpublished candidates: 15 Ethics `r095` (Standard I: Professionalism) + 3 extra `r032-a` families + 3 extra `r095-a` families.',
      '',
    ]
    for (const item of PHASE2_SLICE_ITEMS) {
      blind.push(`## ${item.id} v${item.itemVersion} (${item.readingId} · ${item.outcomeId} · ${item.legacyTierLabel})`)
      blind.push('')
      blind.push(item.draft.stem)
      blind.push('')
      item.draft.options.forEach((o, i) => blind.push(`- **${['A', 'B', 'C'][i]}.** ${o}`))
      blind.push('')
    }
    writeFileSync('docs/evidence/phase2-slice-blind-review.md', blind.join('\n'))

    const prov = [
      '# Question-Bank Phase 2 Slice — Answer & Provenance View',
      '',
      'All 21 candidates remain **unpublished** (`published: false`, `reviewerConfirmedDifficulty: null`).',
      '',
    ]
    for (const item of PHASE2_SLICE_ITEMS) {
      const r = sliceRows.find(x => x.id === item.id)!
      prov.push(`## ${item.id} (v${item.itemVersion})`)
      if (item.revisionHistory?.length) {
        prov.push(`- **Revisions:** ${item.revisionHistory.map(h => `v${h.fromVersion}→v${h.toVersion}: ${h.reason}`).join(' | ')}`)
      }
      prov.push(`- **Scope:** Edition 2027 · Reading \`${item.readingId}\` · Outcome \`${item.outcomeId}\` · Family \`${item.familyId}\` · Fingerprint \`${r.semanticFingerprint}\``)
      prov.push(`- **Pack:** \`${item.packId}@${item.packVersion}\` · factsHash \`${r.packFactsHash.slice(0, 16)}...\` · packetHash \`${r.groundingPacketHash.slice(0, 16)}...\``)
      prov.push(`- **Difficulty:** intended \`${item.intendedDifficulty}\` (${item.legacyTierLabel}) · reviewerConfirmedDifficulty \`null\` · est. ${item.estimatedSeconds}s`)
      prov.push(`- **Key:** **${['A', 'B', 'C'][item.draft.keyIndex]}** (${item.draft.options[item.draft.keyIndex]})`)
      prov.push(`- **Worked Rationale:** ${item.draft.card.solution}`)
      for (const d of item.draft.card.distractorDiagnoses) {
        prov.push(`- **Distractor ${['A', 'B', 'C'][d.optionIndex]} [${d.errorCode}]:** ${d.description}`)
      }
      prov.push(`- **Automated Verdict:** ${r.automatedVerdict}`)
      prov.push(`- **Recorded model blind solve:** ${r.codexBlindSolve.status} · solved version ${r.codexBlindSolve.versionSolved ?? 'none'} · current version ${r.itemVersion}. This is not human review, mapping/difficulty approval, or distribution permission.`)
      prov.push('')
    }
    writeFileSync('docs/evidence/phase2-slice-provenance-review.md', prov.join('\n'))
    console.log('Wrote Phase 2 artifacts to docs/evidence/phase2-{coverage-matrix.json,slice-blind-review.md,slice-provenance-review.md}')
  }
}

main()
