/**
 * Pass C: Reconciles C2 curriculum/concept specifications (eliminating bare-verb stubs
 * while preserving lineage) and expands C3 support matrix to all 1,230 items.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const REF = 'content/source-packs/private/reference-2027'
const OUT = 'output/question-bank/2027'
const MANIFEST_ID = '11111111-1111-1111-1111-111111111111'

const sha = (x: string) => createHash('sha256').update(x).digest('hex')
const uuid = (x: string) => {
  const h = sha(x)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const STOP = new Set(
  'a an the to of in for and or with by on is are as that this which describe explain calculate interpret compare using most least from return returns company firm following statement statements asset assets'.split(' ')
)
const tokens = (s: string) => new Set(norm(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)))

const BARE_VERB_RE = /^(describe|compare|explain|calculate|interpret|evaluate|contrast|identify|determine|analyze|distinguish|demonstrate|recommend|forecast|define|apply|assess|discuss)(?:[,\s]+(?:and|or)?\s*(describe|compare|explain|calculate|interpret|evaluate|contrast|identify|determine|analyze|distinguish|demonstrate|recommend|forecast|define|apply|assess|discuss))*$/i

function decomposeSubstantiveConcepts(outcome: { id: string; title: string; reading_id: string }, topicId: string) {
  // Only split on semicolon when every resulting part is a full substantive clause (not a bare verb)
  const semiParts = outcome.title.split(/;\s*/).map(s => s.trim()).filter(Boolean)
  const validMulti = semiParts.length > 1 && semiParts.every(p => p.length >= 22 && !BARE_VERB_RE.test(p))
  const parts = validMulti ? semiParts : [outcome.title.trim()]

  return parts.map((part, idx) => {
    const localKey = `${outcome.id}:c${idx + 1}`
    const frameworkRelevant = topicId === 'fsa' || /\b(ifrs|gaap|accounting|inventory|lease|tax|depreciation|revenue|intangible)\b/i.test(part)
    const numericLikely = /\b(calculate|compute|determine|estimate|value|measure|duration|convexity|yield|return|variance|probability|ratio|rate|price|margin)\b/i.test(part)
    return {
      conceptId: uuid(`reference-2027-concept:${localKey}`),
      localKey,
      outcomeId: outcome.id,
      readingId: outcome.reading_id,
      subjectId: topicId,
      title: part.charAt(0).toUpperCase() + part.slice(1),
      coreOrSupporting: idx === 0 ? 'core' : 'supporting',
      frameworkDistinctions: frameworkRelevant ? ['Check IFRS vs. US GAAP treatment where applicable'] : [],
      numericLikely,
      scopeCertainty: 'reconciled_offline_pending_human_signoff',
    }
  })
}

function main() {
  const prevManifest = JSON.parse(fs.readFileSync(`${OUT}/c2-curriculum-manifest.json`, 'utf8'))
  const catalogue = JSON.parse(fs.readFileSync(`${REF}/catalogue.reference`, 'utf8'))
  const prereqMap = JSON.parse(fs.readFileSync(`${OUT}/c2-prerequisite-map.json`, 'utf8'))
  const bank = JSON.parse(fs.readFileSync(`${OUT}/draft-bank.json`, 'utf8'))

  const readingBy = new Map<string, any>(catalogue.readings.map((r: any) => [r.id, r]))
  const prereqByOutcome = new Map<string, any>(prereqMap.links.map((l: any) => [l.outcomeId, l.backgroundAnchors]))
  const prevConceptsByOutcome = new Map<string, any[]>()
  for (const c of prevManifest.concepts) {
    const arr = prevConceptsByOutcome.get(c.outcomeId) ?? []
    arr.push(c)
    prevConceptsByOutcome.set(c.outcomeId, arr)
  }

  const concepts: any[] = []
  const outcomes: any[] = []
  const replacedStubLineage: any[] = []
  const packsById = new Map<string, any>()

  for (const o of catalogue.outcomes) {
    const r = readingBy.get(o.reading_id)
    const packPath = `${REF}/packs/${o.id}.json`
    const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'))
    packsById.set(pack.packId, pack)

    const newConcepts = decomposeSubstantiveConcepts(o, r.topic_id)
    const oldConcepts = prevConceptsByOutcome.get(o.id) ?? []
    if (oldConcepts.length !== newConcepts.length || oldConcepts.some((oc, idx) => oc.title !== newConcepts[idx]?.title)) {
      replacedStubLineage.push({
        outcomeId: o.id,
        previousTitles: oldConcepts.map(x => x.title),
        reconciledTitles: newConcepts.map(x => x.title),
      })
    }

    for (const c of newConcepts) {
      concepts.push({
        ...c,
        sourceAnchors: pack.facts.map((f: any) => ({ id: f.id, location: f.location })),
        prerequisiteAnchors: prereqByOutcome.get(o.id) ?? [],
      })
    }

    outcomes.push({
      outcomeId: o.id,
      readingId: r.id,
      subjectId: r.topic_id,
      title: o.title,
      conceptCount: newConcepts.length,
      conceptIds: newConcepts.map(c => c.conceptId),
      packId: pack.packId,
      packVersion: pack.version,
      packFactsHash: pack.contentHash,
      factCount: pack.facts.length,
    })
  }

  // Verify zero bare-verb stubs remain
  const bareStubs = concepts.filter(c => c.title.length < 18 || BARE_VERB_RE.test(c.title.trim()))
  if (bareStubs.length) {
    throw new Error(`Remaining bare-verb stubs: ${JSON.stringify(bareStubs.map(b => b.localKey + ':' + b.title))}`)
  }

  fs.writeFileSync(
    `${OUT}/c2-curriculum-manifest.json`,
    JSON.stringify(
      {
        schema: 'c2-curriculum-manifest.2',
        edition: '2027',
        manifestId: MANIFEST_ID,
        errataVerificationStatus: 'september_2026_notice_reconciled_offline',
        readingsCount: prevManifest.readingsCount,
        outcomesCount: outcomes.length,
        decomposedConceptsCount: concepts.length,
        replacedStubCount: replacedStubLineage.length,
        replacedStubLineage,
        readings: prevManifest.readings,
        outcomes,
        concepts,
      },
      null,
      2
    ) + '\n'
  )

  // C3: Audit ALL 1,230 items in draft-bank.json
  const supportItems: any[] = []
  const stdRe = /\bStandard\s+[IVX]+\([A-Z]\)|\bGIPS\b/g

  for (const it of bank.items) {
    const pack = packsById.get(it.sourcePackId) ?? JSON.parse(fs.readFileSync(path.join(REF, 'packs', `${it.outcomeId}.json`), 'utf8'))
    const packTokens = tokens(pack.facts.map((f: any) => f.text).join(' '))
    const itTokens = tokens(`${it.draft.stem} ${it.draft.options[it.draft.keyIndex]} ${it.draft.card.solution}`)
    const hits = [...itTokens].filter(t => packTokens.has(t)).length
    const ratio = itTokens.size ? Number((hits / itTokens.size).toFixed(2)) : 0
    const stdMatches = it.subjectId === 'eth' ? [...new Set(`${it.draft.stem} ${it.draft.card.solution}`.match(stdRe) ?? [])] : []

    supportItems.push({
      itemId: it.id,
      itemVersion: it.itemVersion,
      poolIntent: it.poolIntent,
      outcomeId: it.outcomeId,
      subjectId: it.subjectId,
      packId: pack.packId,
      packVersion: pack.version,
      tokenHits: hits,
      itemTokenCount: itTokens.size,
      overlapRatio: ratio,
      ethicsStandardsCited: stdMatches,
      supportTier: ratio >= 0.35 && hits >= 4 ? 'strong_machine_anchor' : ratio >= 0.25 && hits >= 3 ? 'moderate_machine_anchor' : 'weak_needs_human_anchor',
      semanticSupportStatus: 'pending_qualified_human_verification',
    })
  }

  const strong = supportItems.filter(s => s.supportTier === 'strong_machine_anchor').length
  const moderate = supportItems.filter(s => s.supportTier === 'moderate_machine_anchor').length
  const weak = supportItems.filter(s => s.supportTier === 'weak_needs_human_anchor').length

  fs.writeFileSync(
    `${OUT}/c3-support-matrix.json`,
    JSON.stringify(
      {
        schema: 'c3-support-matrix.2',
        totalItemsAudited: supportItems.length,
        strongMachineAnchor: strong,
        moderateMachineAnchor: moderate,
        weakNeedsHumanAnchor: weak,
        note: 'Audits all 1,230 items in draft-bank.json. Lexical anchor overlap is a retrieval signal only, not semantic proof; qualified human verification remains pending.',
        items: supportItems,
      },
      null,
      2
    ) + '\n'
  )

  console.log(JSON.stringify({
    conceptsCount: concepts.length,
    replacedStubs: replacedStubLineage.length,
    bareStubsRemaining: bareStubs.length,
    c3Audited: supportItems.length,
    strong,
    moderate,
    weak,
  }, null, 2))
}

main()
