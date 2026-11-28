/**
 * C4-C9 Master Content Pipeline:
 * - Preserves baseline-2026-11-25/ untouched
 * - Applies C4.1/C4.2/C4.3 versioned repairs
 * - Integrates C5 (504 routine breadth items) & C7 (180 held-out mock items)
 * - Runs C8 deterministic, arithmetic, overlap, giveaway, and leakage checks
 * - Exports C6 demand model, C7 rehearsal verification, C8 eval pack, C9 exports, C10 human queues
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build, type BankItem, type Outcome } from '../bankLoader'
import { FSA_ITEMS } from '../fsaBank/all'
import ETHICS from '../ethicsBank/items.json'
import { PHASE1_PILOT_ITEMS } from '../../fixtures/phase1-pilot-items'
import { PHASE2_SLICE_ITEMS } from '../../fixtures/phase2-slice-items'
import { QUANT_ECON_CI } from './quant-econ-ci'
import { EQUITY_FIXED_INCOME } from './equity-fixed-income'
import { DERIVATIVES_ALTERNATIVES_PORTFOLIO } from './derivatives-alternatives-portfolio'
import { reviseLegacy } from './legacyRevisions'
import { applyPassDERevisions } from './pass-d-e-revisions'
import { C4_ITEM_PATCHES, GIVEAWAY_OPTION_REWRITES } from './c4-repairs'
import { type AuthoredItemV2 } from './authorV2'
import { C5_FSA_ETH_CI } from './expansion/c5-fsa-eth-ci'
import { C5_DERIV } from './expansion/c5-deriv'
import { C5_ALT } from './expansion/c5-alt'
import { C5_QUANT } from './expansion/c5-quant'
import { C5_ECON } from './expansion/c5-econ'
import { C5_EQ } from './expansion/c5-eq'
import { C5_PM } from './expansion/c5-pm'
import { C5_FI_1 } from './expansion/c5-fi-1'
import { C5_FI_2 } from './expansion/c5-fi-2'
import { C7_HELDOUT_MOCK1_S1 } from './expansion/c7-heldout-mock-1-s1'
import { C7_HELDOUT_MOCK1_S2 } from './expansion/c7-heldout-mock-1-s2'
import { C8_EVALUATION_GOLD_CANDIDATES, C8_EVALUATION_NEGATIVE_EXAMPLES } from './expansion/c8-evaluation-pack'
import { CLOSEOUT_MOCK_SUPPLEMENT } from './expansion/closeout-mock-supplement'
import { applyCloseoutRevisions, OFFICIAL_2027_WEIGHTS } from './closeout-revisions'
import { checkItemFormat } from '../../../src/lib/diagnostic/formatRules'
import { buildGroundingPacket, factsHash, type SourcePack } from '../../../src/lib/diagnostic/groundingPacket'
import { loadSourcePacks } from '../../../src/lib/diagnostic/sourcePacks'
import { nearMatches } from '../../../src/lib/diagnostic/nearMatch'
import { parseOptionNumber, stemInputDefects } from '../../../src/lib/diagnostic/verifier'
import { renderNumeric } from '../bankNumeric'
import { semanticFingerprint } from '../../../src/lib/diagnostic/generator'
import { planRehearsal, REHEARSAL_BLUEPRINT_VERSION } from '../../../src/lib/rehearsal/blueprint'

const REF = 'content/source-packs/private/reference-2027'
const OUT = 'output/question-bank/2027'
const MANIFEST = '11111111-1111-1111-1111-111111111111'

const sha = (x: string) => createHash('sha256').update(x).digest('hex')
const uuid = (x: string) => {
  const h = sha(x)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const csv = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
const writeJson = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

const GIVEAWAY_ABS_RE = /\b(always|never|all|none|solely|exclusively|guaranteed)\b/i
const LEGIT_ABS_RE = /\b(all[- ]equity|all[- ]else|all[- ]in|at all|all[- ]or[- ]none|all[- ]share)\b/i

function verifyCarriedForwardNumeric(item: any): { executed: boolean; result: string } {
  const v = item.draft.card.exactNumericValues ?? {}
  let computed: number | null = null
  switch (item.id) {
    case 'pp-2027-r032-a-medium': computed = v.units * Math.max(0, v.cost - (v.sp - v.comp - v.sell)); break
    case 'pp-2027-r032-a-hard': computed = Math.min(v.cost, Math.min(v.sp - v.sell, Math.max(v.sp - v.sell - v.normalProfit, v.replacement))); break
    case 'pp-2027-r032-b-medium': computed = v.lifoCogs - (v.endRes - v.begRes); break
    case 'pp-2027-r032-b-hard': computed = (v.lifoCogs - (v.endRes - v.begRes)) / (((v.begInv + v.begRes) + (v.endInv + v.endRes)) / 2); break
    case 'pp-2027-r032-c-hard': computed = (v.sold - v.purchased) * (v.currCost - v.newCost); break
    case 'pp-2027-r004-a-easy': computed = v.div / v.r; break
    case 'pp-2027-r004-a-medium': {
      const r = v.ytm / v.freq, n = v.years * v.freq, c = (v.par * v.couponRate) / v.freq
      computed = c * (1 - (1 + r) ** -n) / r + v.par * (1 + r) ** -n
      break
    }
    case 'pp-2027-r004-a-hard': computed = (v.cf4 / (v.r - v.g)) / ((1 + v.r) ** (v.startYear - 1)); break
    case 'pp-2027-r004-b-easy': computed = ((v.fv / v.pv) ** (1 / v.t) - 1) * 100; break
    case 'pp-2027-r004-b-hard': computed = v.roe * 100; break
    case 'pp-2027-r004-c-medium': computed = (((1 + v.z2) ** 2) / (1 + v.z1) - 1) * 100; break
    case 'pp-2027-r004-c-hard': {
      const u = v.su / v.s0, d = v.sd / v.s0, pi = (1 + v.rf - d) / (u - d)
      computed = (pi * Math.max(0, v.su - v.k) + (1 - pi) * Math.max(0, v.sd - v.k)) / (1 + v.rf)
      break
    }
    case 'pp-2027-r032-a-fam3-medium': computed = Math.min(v.origCost, v.newNrv); break
    case 'pp-2027-r032-a-fam4-hard': computed = v.costA + Math.min(v.costB, v.nrvB); break
  }
  if (computed === null || !Number.isFinite(computed)) return { executed: false, result: 'no independent formula matched' }
  const keyVal = parseOptionNumber(item.draft.options[item.draft.keyIndex])
  const relDiff = Math.abs(computed - keyVal) / Math.max(1, Math.abs(keyVal))
  assert.ok(relDiff < 0.01, `${item.id}: carried numeric mismatch computed=${computed} vs key=${keyVal}`)
  return { executed: true, result: `independent derivation verified (${computed.toFixed(4)} ≈ ${item.draft.options[item.draft.keyIndex]})` }
}

function verifyUntaggedProseNumeric(item: any): { executed: boolean; result: string } {
  let computed: number | null = null
  switch (item.id) {
    case 'pp-mock1-r012-e-medium-1': computed = 35 + 25 + 20; break
    case 'pp-2027-c5-r019-a-hard': computed = 1.0900 * 0.8800; break
    case 'pp-mock1-r019-b-hard-1': computed = 0.8000 * (1.05 / 1.03) - 0.8000; break
    case 'pp-2027-c5-r019-b-medium': computed = 1.1000 * (1.05 / 1.03); break
    case 'pp-mock1-r087-e-medium-1': computed = (0.113137 ** 2 - 0.25 * 0.16 ** 2 - 0.25 * 0.16 ** 2) / (2 * 0.5 * 0.5 * 0.16 * 0.16); break
    case 'pp-mock1-r088-b-medium-1': computed = 3.0 + ((9.0 - 3.0) / 15.0) * 10.0; break
    case 'pp-mock1-r090-c-medium-1': computed = 5.0 + 2.5 + 0.5; break
  }
  if (computed === null || !Number.isFinite(computed)) return { executed: false, result: 'not numeric' }
  const keyVal = parseOptionNumber(item.draft.options[item.draft.keyIndex])
  const diff = Math.abs(computed - keyVal)
  assert.ok(diff <= 0.005 * Math.max(1, Math.abs(keyVal)), `${item.id}: prose numeric mismatch computed=${computed} vs key=${keyVal}`)
  return { executed: true, result: `independent derivation verified (${computed.toFixed(4)} ≈ ${item.draft.options[item.draft.keyIndex]})` }
}

async function main() {
  const catalogue = JSON.parse(fs.readFileSync(`${REF}/catalogue.reference`, 'utf8'))
  const outcomes = new Map<string, Outcome>(
    catalogue.outcomes.map((o: any) => {
      const r = catalogue.readings.find((r: any) => r.id === o.reading_id)
      assert.ok(r)
      return [o.id, { id: o.id, readingId: r.id, readingTitle: r.title, readingNo: r.reading_no, code: o.code, title: o.title }]
    })
  )
  assert.equal(outcomes.size, 343)
  const readingBy = new Map<string, any>(catalogue.readings.map((r: any) => [r.id, r]))
  const topics: string[] = [...new Set(catalogue.readings.map((r: any) => r.topic_id))] as string[]
  const packs = loadSourcePacks()
  assert.ok(!packs.some(p => p.packId.startsWith('reference-2027-') && p.rights.state === 'cleared'), 'Refusing to overwrite cleared packs.')

  const carry = [...PHASE1_PILOT_ITEMS, ...PHASE2_SLICE_ITEMS]
  const replaced = new Set(carry.filter(x => ['r032', 'r095'].includes(x.readingId)).map(x => `${x.outcomeId}:${x.intendedDifficulty}`))
  const tier = { E: 'foundation', M: 'standard', H: 'difficult' }
  const legacy = [...FSA_ITEMS, ...(ETHICS as unknown as BankItem[])].filter(x => !replaced.has(`${x.o}:${tier[x.t]}`)).map(reviseLegacy)
  const originals = [...QUANT_ECON_CI, ...EQUITY_FIXED_INCOME, ...DERIVATIVES_ALTERNATIVES_PORTFOLIO]

  const c5Items: AuthoredItemV2[] = [
    ...C5_FSA_ETH_CI, ...C5_DERIV, ...C5_ALT, ...C5_QUANT, ...C5_ECON, ...C5_EQ, ...C5_PM, ...C5_FI_1, ...C5_FI_2,
  ]
  const c7Items: AuthoredItemV2[] = [...C7_HELDOUT_MOCK1_S1, ...C7_HELDOUT_MOCK1_S2, ...CLOSEOUT_MOCK_SUPPLEMENT]
  assert.equal(c5Items.length, 504, `Expected 504 C5 items, got ${c5Items.length}`)
  assert.equal(c7Items.length, 190, `Expected 190 held-out candidates, got ${c7Items.length}`)
  const priorBank = JSON.parse(fs.readFileSync(`${OUT}/closeout-baseline-1220/draft-bank.json`, 'utf8'))
  const priorById = new Map<string, any>(priorBank.items.map((i: any) => [i.id, i]))
  const initialBank = JSON.parse(fs.readFileSync(`${OUT}/baseline-2026-11-25/draft-bank.json`, 'utf8'))
  const initialById = new Map<string, any>(initialBank.items.map((i: any) => [i.id, i]))

  const allAuthored = [...originals, ...legacy, ...c5Items, ...c7Items]
  const built = await build({
    prefix: 'pp-ref2027',
    seed: 20271125,
    topic: 'mixed',
    cellTopic: '2027 curriculum',
    items: allAuthored,
    outcomes: async () => outcomes,
    reportPath: '',
    provenance: () => 'User-provided references; draft only',
  })

  const c4DefectLog: any[] = []
  const items: any[] = []
  const c5AndC7Counters = new Map<string, number>()

  const origSet = new Set<any>(originals)
  const legacySet = new Set<any>(legacy)
  const c5Set = new Set<any>(c5Items)
  const c7S1Set = new Set<any>([...C7_HELDOUT_MOCK1_S1, ...CLOSEOUT_MOCK_SUPPLEMENT.filter(i => !['r045-a','r079-a'].includes(i.o))])
  const c7Set = new Set<any>(c7Items)

  for (let idx = 0; idx < built.length; idx++) {
    const b = built[idx]
    const raw = b.raw as BankItem & Partial<AuthoredItemV2>
    const isBaselineOrig = origSet.has(raw)
    const isBaselineLegacy = legacySet.has(raw)
    const isC5 = c5Set.has(raw)
    const isC7 = c7Set.has(raw)

    let itemId = b.id
    if (isC5 || isC7) {
      const tag = isC7 ? 'mock1' : 'c5'
      const key = `${raw.o}:${raw.t}:${tag}`
      const n = (c5AndC7Counters.get(key) ?? 0) + 1
      c5AndC7Counters.set(key, n)
      const tierTag = { E: 'easy', M: 'medium', H: 'hard' }[raw.t]
      itemId = isC7
        ? `pp-mock1-${raw.o}-${tierTag}-${n}`
        : `pp-2027-c5-${raw.o}-${tierTag}${n > 1 ? `-${n}` : ''}`
    }

    if (!raw.num && priorById.has(itemId) && b.draft.keyIndex !== priorById.get(itemId).draft.keyIndex) {
      const target = priorById.get(itemId).draft.keyIndex
      const entries = b.draft.options.map((text, old) => ({ text, old }))
      const correct = entries.splice(b.draft.keyIndex, 1)[0]
      entries.splice(target, 0, correct)
      const oldFeedback = b.draft.perOptionFeedback, oldDiagnosis = b.draft.card.distractorDiagnoses
      b.draft.options = entries.map(e => e.text); b.draft.keyIndex = target
      b.draft.perOptionFeedback = Object.fromEntries(entries.map((e, n) => [n, oldFeedback[e.old]]))
      b.draft.card.distractorDiagnoses = entries.flatMap((e, n) => { const d = oldDiagnosis.find(d => d.optionIndex === e.old); return d ? [{ ...d, optionIndex: n }] : [] })
    }
    if (raw.num) {
      if (b.draft.options.some(t => typeof t !== 'string')) throw new Error(`Undefined option on ${itemId}: ${JSON.stringify(b.draft.options)}`)
      b.draft.options = b.draft.options.map(text => text.replace(/^\$-/, '-$'))
      const order = b.draft.options.map((text, old) => ({ text, old })).sort((a, z) => parseOptionNumber(a.text) - parseOptionNumber(z.text))
      const oldFeedback = b.draft.perOptionFeedback
      const oldDiagnosis = b.draft.card.distractorDiagnoses
      b.draft.options = order.map(x => x.text)
      b.draft.keyIndex = order.findIndex(x => x.old === b.key)
      b.draft.perOptionFeedback = Object.fromEntries(order.map((x, index) => [String(index), oldFeedback[String(x.old)]]))
      b.draft.card.distractorDiagnoses = order.flatMap((x, index) => {
        const d = oldDiagnosis.find(d => d.optionIndex === x.old)
        return d ? [{ ...d, optionIndex: index }] : []
      })
      if (isBaselineOrig || isC5 || isC7) {
        const substituted = raw.num.key
          .replace(/\b[A-Za-z_]\w*\b/g, name => (name in raw.num!.vars ? `(${raw.num!.vars[name]})` : name))
          .replaceAll('*', ' × ')
          .replaceAll('/', ' ÷ ')
        b.draft.card.solution += ` Calculation: ${substituted} = ${b.draft.options[b.draft.keyIndex]}.`
        b.draft.perOptionFeedback[String(b.draft.keyIndex)] = `Correct. ${b.draft.card.solution}`
      }
    }

    const proposed = isBaselineOrig || isBaselineLegacy ? (raw.t === 'H' && ['recall', 'interpret'].includes(raw.c) ? 'standard' : b.difficulty) : b.difficulty
    b.draft.card.difficulty = proposed

    const origin = isBaselineOrig
      ? 'new_reference_draft'
      : isBaselineLegacy
      ? 'legacy_revised_draft'
      : isC5
      ? 'c5_breadth_draft'
      : 'c7_held_out_mock_draft'

    const poolIntent = isC7 ? 'held_out_mock' : 'routine'
    const heldOut = isC7

    const obj: any = {
      id: itemId,
      itemVersion: 1,
      priorVersion: null,
      outcomeId: raw.o,
      readingId: b.los.readingId,
      draft: b.draft,
      intendedDifficulty: proposed,
      difficultyRationale: raw.difficultyRationale ?? `Proposed ${proposed} based on ${b.draft.card.cognition} cognitive demand within Level I scope.`,
      origin,
      poolIntent,
      heldOut,
      mockFormId: isC7 ? 'mock-2027-candidate-1' : null,
      mockSession: isC7 ? (c7S1Set.has(raw) ? 1 : 2) : null,
      familyHint: raw.familyHint ?? null,
      numericSpec: raw.num ?? null,
      numericDistractors: raw.num ? raw.w.map(w => ({ expression: w[0], reason: w[2] })) : null,
      changes: [],
      modelBlindSolve: { status: 'not_run', note: 'No independent model or human solve is claimed.' },
    }
    items.push(obj)
  }

  for (const p of carry) {
    items.push({
      id: p.id,
      itemVersion: p.itemVersion,
      priorVersion: null,
      outcomeId: p.outcomeId,
      readingId: p.readingId,
      draft: JSON.parse(JSON.stringify(p.draft)),
      intendedDifficulty: p.intendedDifficulty,
      difficultyRationale: `Carried-forward pilot/slice rationale (${p.intendedDifficulty}).`,
      origin: 'carried_forward_pilot_or_slice',
      poolIntent: 'routine',
      heldOut: false,
      mockFormId: null,
      mockSession: null,
      familyHint: null,
      numericSpec: null,
      numericDistractors: null,
      changes: [],
      priorPackId: p.packId,
      modelBlindSolve: { ...p.codexBlindSolve, note: 'Carried-forward record; invalidate if edited.' },
    })
  }

  // Apply C4 repairs (with explicit version bump, text-anchored option matching & lineage)
  const applyWrongOptionRewrites = (it: any, rewrites: { match: string; replace: string }[]) => {
    for (const r of rewrites) {
      const target = it.draft.options.findIndex((o: string) => o === r.match)
      assert.ok(target >= 0, `${it.id}: repair match not found: ${JSON.stringify(r.match)}`)
      assert.notEqual(target, it.draft.keyIndex, `${it.id}: a distractor rewrite must never replace the key`)
      it.draft.options[target] = r.replace
    }
  }

  for (const it of items) {
    const originalKey = initialById.get(it.id)?.draft.keyIndex ?? it.draft.keyIndex
    const initialWrong = [0,1,2].filter(n => n !== originalKey)
    const currentWrong = [0,1,2].filter(n => n !== it.draft.keyIndex)
    const optionIndex = (old: number) => old === originalKey ? it.draft.keyIndex : currentWrong[initialWrong.indexOf(old)]
    const patch = C4_ITEM_PATCHES[it.id]
    const giveawayRewrite = GIVEAWAY_OPTION_REWRITES[it.id]
    if (patch) {
      if (patch.newVersion > it.itemVersion) {
        it.priorVersion = it.itemVersion
        it.itemVersion = patch.newVersion
        it.modelBlindSolve = { status: 'invalidated_by_v2_edit', note: 'Prior v1 solve invalidated by C4 material revision.' }
      }
      if (patch.stem) it.draft.stem = patch.stem
      if (patch.optionRewrites) applyWrongOptionRewrites(it, patch.optionRewrites)
      if (patch.solution) {
        it.draft.card.solution = patch.solution
        it.draft.perOptionFeedback[String(it.draft.keyIndex)] = `Correct. ${patch.solution}`
      }
      if (patch.distractorDiagnoses) {
        it.draft.card.distractorDiagnoses = patch.distractorDiagnoses.map(d => ({ ...d, optionIndex: optionIndex(d.optionIndex) }))
        for (const d of it.draft.card.distractorDiagnoses) {
          it.draft.perOptionFeedback[String(d.optionIndex)] = `Incorrect. ${d.description}`
        }
      }
      if (patch.familyId) it.familyHint = patch.familyId
      it.changes.push(patch.reason)
      c4DefectLog.push({ id: it.id, version: it.itemVersion, disposition: patch.reason })
    }
    if (giveawayRewrite) {
      if (it.priorVersion === null) {
        it.priorVersion = it.itemVersion
        it.itemVersion += 1
        it.modelBlindSolve = { status: 'invalidated_by_v2_edit', note: 'Prior solve invalidated by C4.3 distractor revision.' }
      }
      applyWrongOptionRewrites(it, giveawayRewrite)
      it.changes.push('C4.3: Replaced giveaway absolute word in distractor with nuanced misconception.')
      c4DefectLog.push({ id: it.id, version: it.itemVersion, disposition: 'C4.3 giveaway-absolute distractor rewritten' })
    }
  }

  assert.equal(items.length, 536 + c5Items.length + c7Items.length, `Unexpected total item count: ${items.length}`)
  assert.equal(new Set(items.map(i => i.id)).size, items.length, 'Duplicate item IDs detected!')

  // C8 Validation pass across all 1220 items
  const closeoutChanges = applyCloseoutRevisions(items, priorById)
  const passDEChanges = applyPassDERevisions(items)
  const grams = new Map(topics.map(t => [t, new Set(fs.readFileSync(`${REF}/${t}.grams`, 'utf8').split('\n'))]))
  const coverage: any[] = []
  const defects: any[] = []
  let giveawayCount = 0
  let sameDescCount = 0

  for (const item of items) {
    const reading = readingBy.get(item.readingId)
    const outcome = outcomes.get(item.outcomeId)!
    const pack = packs.find(p => p.packId === (item.priorPackId ?? `reference-2027-${item.outcomeId}`))!
    assert.ok(pack, `Missing pack for ${item.id}`)

    item.subjectId = reading.topic_id
    item.readingTitle = reading.title
    item.outcomeTitle = outcome.title
    item.manifestId = MANIFEST
    item.edition = '2027'
    item.reviewStatus = 'draft'
    item.published = false
    item.reviewerConfirmedDifficulty = null
    item.learnerDistributionAuthorized = false
    item.conceptId = uuid(`reference-2027-concept:${item.outcomeId}`)
    item.draft.card.conceptId = item.conceptId
    item.draft.card.conceptName = outcome.title
    item.mapping = { certainty: 'approximate', signOff: 'pending', note: 'Canonical outcome selected; human concept/source sign-off pending.' }
    item.sourcePackId = pack.packId
    item.packFactsHash = factsHash(pack.facts)
    item.inputRights = pack.rights

    const ground = buildGroundingPacket({
      manifest: { id: MANIFEST, year: 2027, version: '1.0' },
      cell: { outcomeId: item.outcomeId, readingId: item.readingId, conceptId: item.conceptId, conceptName: outcome.title, cognition: item.draft.card.cognition, itemForm: item.draft.card.itemForm, difficulty: item.intendedDifficulty },
      concept: { manifest_id: MANIFEST, verification_status: 'pending' },
      mapping: { outcome_id: item.outcomeId, approximate: true },
      pack,
    })
    assert.ok(ground.packet, `${item.id}: invalid grounding packet ${JSON.stringify(ground.blockers)}`)
    item.groundingPacketHash = ground.packet.hash
    item.semanticFingerprint = semanticFingerprint(item.draft.stem, item.draft.options)

    const format = checkItemFormat(item.draft.stem, item.draft.options)
    const inputs = stemInputDefects(item.draft)
    assert.equal(item.draft.options.length, 3, `${item.id}: must have 3 options`)
    assert.equal(new Set(item.draft.options).size, 3, `${item.id}: duplicate options: ${JSON.stringify(item.draft.options)}`)
    assert.ok(item.draft.keyIndex >= 0 && item.draft.keyIndex <= 2, `${item.id}: invalid keyIndex`)
    assert.equal(item.draft.card.distractorDiagnoses.length, 2, `${item.id}: must have 2 distractor diagnoses`)
    assert.deepEqual(item.draft.card.distractorDiagnoses.map((d: any) => d.optionIndex).sort(), [0,1,2].filter(n => n !== item.draft.keyIndex), `${item.id}: diagnosis indices must identify exactly the wrong choices`)
    assert.ok(item.draft.perOptionFeedback[item.draft.keyIndex].startsWith('Correct.'), `${item.id}: key feedback must be correct`)
    if (item.draft.card.distractorDiagnoses[0].description === item.draft.card.distractorDiagnoses[1].description) sameDescCount++

    const keyAbs = GIVEAWAY_ABS_RE.test(item.draft.options[item.draft.keyIndex])
    const distAbs = item.draft.options.filter((_: string, i: number) => i !== item.draft.keyIndex).some((o: string) => GIVEAWAY_ABS_RE.test(o) && !LEGIT_ABS_RE.test(o))
    if (distAbs && !keyAbs) giveawayCount++

    const overlap: { field: string; hash: string }[] = []
    for (const [field, text] of [['stem', item.draft.stem], ...item.draft.options.map((x: string, n: number) => [`option-${n}`, x]), ['solution', item.draft.card.solution]]) {
      const words = normalize(text).split(' ')
      for (let n = 0; n + 8 <= words.length; n++) {
        const h = sha(words.slice(n, n + 8).join(' ')).slice(0, 16)
        if (grams.get(reading.topic_id)!.has(h)) {
          overlap.push({ field, hash: h })
          break
        }
      }
    }

    let arithmetic: any = { executed: false }
    if (item.numericSpec) {
      const evaluated = renderNumeric(item.numericSpec, item.numericDistractors.map((d: any) => d.expression), [])
      assert.equal(item.draft.options[item.draft.keyIndex], evaluated.keyText.replace(/^\$-/, '-$'), `${item.id}: numeric mismatch`)
      arithmetic = { executed: true, result: 'formula and displayed key/distractor values match' }
    } else if (item.draft.card.isNumeric) {
      arithmetic = verifyCarriedForwardNumeric(item)
    } else {
      arithmetic = verifyUntaggedProseNumeric(item)
    }

    item.validation = { format, inputDefects: inputs, arithmetic, originalityOverlap: overlap, groundingSupport: 'machine_anchored_human_review_pending', semanticCorrectness: 'human_review_pending' }
    if (format.length || inputs.length || overlap.length) defects.push({ id: item.id, format, inputDefects: inputs, overlap })

    const famSeed = item.familyHint ? `reference-2027-family:${item.familyHint}` : `reference-2027-family:${item.id}`
    item.familyProposal = {
      id: uuid(famSeed),
      label: item.familyHint ?? item.id,
      constructionStatus: 'provisional',
      independence: 'unconfirmed',
      note: 'Provisional construction family pending qualified human confirmation.',
    }
  }

  // Check zero family overlap between routine and held-out mock pools
  const routineFams = new Set(items.filter(i => !i.heldOut).map(i => i.familyProposal.id))
  const heldOutFams = new Set(items.filter(i => i.heldOut).map(i => i.familyProposal.id))
  const crossPoolLeakage = [...heldOutFams].filter(f => routineFams.has(f))
  assert.equal(crossPoolLeakage.length, 0, `Cross-pool family leakage detected: ${crossPoolLeakage.join(', ')}`)

  // Verify C7 2x90 rehearsal blueprint assembly
  const heldOutPool = items
    .filter(i => i.heldOut)
    .map(i => ({
      id: i.id,
      lm_id: i.readingId,
      topic_id: i.subjectId,
      family_id: i.familyProposal.id,
      concept_id: i.conceptId,
      intended_difficulty: i.intendedDifficulty,
      cognition: i.draft.card.cognition,
      key_index: i.draft.keyIndex,
    }))
  const weights = OFFICIAL_2027_WEIGHTS
  const rehearsalCheck = planRehearsal(heldOutPool as any, weights, () => 0.42)
  assert.equal(rehearsalCheck.shortfalls[0].length, 0, `Session 1 shortfall: ${JSON.stringify(rehearsalCheck.shortfalls[0])}`)
  assert.equal(rehearsalCheck.shortfalls[1].length, 0, `Session 2 shortfall: ${JSON.stringify(rehearsalCheck.shortfalls[1])}`)
  assert.equal(rehearsalCheck.sessions[0].length, 90)
  assert.equal(rehearsalCheck.sessions[1].length, 90)

  // Near-match & content hashes
  for (const item of items) {
    item.nearMatchHints = nearMatches(
      { id: item.id, stem: item.draft.stem, options: item.draft.options },
      items.filter(i => i.outcomeId === item.outcomeId).map(i => ({ id: i.id, stem: item.draft.stem, options: item.draft.options })),
      0.55
    ).map(x => ({ id: x.id, similarity: x.similarity }))
    item.contentHash = sha(JSON.stringify({ version: item.itemVersion, draft: item.draft, outcomeId: item.outcomeId, sourcePackId: item.sourcePackId, packFactsHash: item.packFactsHash }))
  }

  for (const [id, outcome] of outcomes) {
    const routineCands = items.filter(i => i.outcomeId === id && !i.heldOut)
    const heldCands = items.filter(i => i.outcomeId === id && i.heldOut)
    const byTier = Object.fromEntries(['foundation', 'standard', 'difficult'].map(t => [t, routineCands.filter(i => i.intendedDifficulty === t).length]))
    coverage.push({
      outcomeId: id,
      readingId: outcome.readingId,
      subjectId: readingBy.get(outcome.readingId).topic_id,
      routineCandidates: routineCands.length,
      heldOutMockCandidates: heldCands.length,
      byTier,
      missingCandidateTiers: Object.keys(byTier).filter(t => !byTier[t]),
      provisionalRoutineFamilies: new Set(routineCands.map(i => i.familyProposal.id)).size,
      confirmedIndependentFamilies: 0,
      approvedRoutine: 0,
      approvedHeldOut: 0,
      firstPublicationBlocker: 'RIGHTS_UNCONFIRMED',
    })
  }

  const counts = Object.fromEntries(
    topics.map(t => [
      t,
      {
        outcomes: coverage.filter(c => c.subjectId === t).length,
        routineDrafts: items.filter(i => i.subjectId === t && !i.heldOut).length,
        heldOutMockDrafts: items.filter(i => i.subjectId === t && i.heldOut).length,
        totalDrafts: items.filter(i => i.subjectId === t).length,
      },
    ])
  )

  const bank = {
    schema: 'reference-draft-bank.2',
    edition: '2027',
    manifestId: MANIFEST,
    generatedAt: new Date().toISOString(),
    status: 'QUARANTINED_DRAFTS_NOT_STUDENT_INVENTORY',
    items,
    limits: [
      'No human approvals, confirmed tiers, family independence, distribution permission or student eligibility inferred.',
      'Held-out candidate pool has 190 drafts: one 180-item allocation plus ten reserves. Distinct candidate IDs do not prove independent constructions.',
      'Evaluation pack (c8-evaluation-pack.json) is strictly excluded from serving.',
    ],
  }
  writeJson(`${OUT}/draft-bank.json`, bank)
  fs.writeFileSync(`${OUT}/draft-bank.jsonl`, items.map(i => JSON.stringify(i)).join('\n') + '\n')

  const bankContentHash = sha(items.map(i => `${i.id}:${i.itemVersion}:${i.contentHash}`).sort().join('\n'))
  const summary = {
    generatedAt: bank.generatedAt,
    drafts: items.length,
    routineDrafts: items.filter(i => !i.heldOut).length,
    heldOutMockDrafts: items.filter(i => i.heldOut).length,
    readingCoverage: catalogue.readings.length,
    outcomeCoverage: coverage.length,
    counts,
    arithmeticExecuted: items.filter(i => i.validation.arithmetic.executed).length,
    formatOrInputReview: items.filter(i => i.validation.format.length || i.validation.inputDefects.length).length,
    overlapReview: items.filter(i => i.validation.originalityOverlap.length).length,
    giveawayAbsolutesRemaining: giveawayCount,
    identicalDistractorDiagnosesRemaining: sameDescCount,
    missingTierOutcomes: coverage.filter(c => c.missingCandidateTiers.length).length,
    provisionalRoutineFamilies: routineFams.size,
    provisionalHeldOutFamilies: heldOutFams.size,
    confirmedIndependentFamilies: 0,
    approvedRoutine: 0,
    approvedHeldOut: 0,
    learnerReleaseEligible: false,
    coverage,
    defects,
    bankContentHash,
  }
  writeJson(`${OUT}/coverage-and-review.json`, summary)
  fs.writeFileSync(
    `${OUT}/coverage.csv`,
    [
      'outcome,subject,routine_candidates,held_out_candidates,foundation,standard,difficult,missing_tiers,publication_blocker',
      ...coverage.map(c => [c.outcomeId, c.subjectId, c.routineCandidates, c.heldOutMockCandidates, c.byTier.foundation, c.byTier.standard, c.byTier.difficult, c.missingCandidateTiers.join(';'), c.firstPublicationBlocker].map(csv).join(',')),
    ].join('\n') + '\n'
  )
  fs.writeFileSync(
    `${OUT}/answer-key.csv`,
    ['id,version,pool,subject,outcome,key,solution', ...items.map(i => [i.id, i.itemVersion, i.poolIntent, i.subjectId, i.outcomeId, 'ABC'[i.draft.keyIndex], i.draft.card.solution].map(csv).join(','))].join('\n') + '\n'
  )

  for (const topic of topics) {
    const selected = items.filter(i => i.subjectId === topic)
    writeJson(`${OUT}/${topic}.json`, selected)
    const blind = [`# ${topic}: quarantined 2027 drafts`, '', 'Human review required. Proposed difficulty is not confirmed. Keys omitted.', '']
    const answers = [`# ${topic}: answer and review companion`, '', 'Draft keys require human verification; not publication approval.', '']
    for (const i of selected) {
      blind.push(`## ${i.id} v${i.itemVersion} · ${i.outcomeId} · ${i.poolIntent} · proposed ${i.intendedDifficulty}`, '', i.draft.stem, '', ...i.draft.options.map((o: string, n: number) => `${'ABC'[n]}. ${o}`), '')
      answers.push(`## ${i.id} v${i.itemVersion} (${i.poolIntent})`, '', `Key: ${'ABC'[i.draft.keyIndex]}`, '', i.draft.card.solution, '', ...i.draft.card.distractorDiagnoses.map((d: any) => `- ${'ABC'[d.optionIndex]} [${d.errorCode}]: ${d.description}`), '', `Difficulty rationale: ${i.difficultyRationale}`, `Family proposal: ${i.familyProposal.label} (${i.familyProposal.constructionStatus})`, '')
    }
    fs.writeFileSync(`${OUT}/${topic}-blind.md`, blind.join('\n'))
    fs.writeFileSync(`${OUT}/${topic}-answers.md`, answers.join('\n'))
  }

  // Export C4, C6, C7, C8, D1, E1 artifacts
  writeJson(`${OUT}/c4-defect-register.json`, { phase: 'C4', totalRepairsRecorded: c4DefectLog.length, repairs: c4DefectLog })
  writeJson(`${OUT}/closeout-revision-ledger.json`, { changes: closeoutChanges, passDEChanges, allHumanApprovals: 0, priorSnapshot: 'closeout-baseline-1220/draft-bank.json' })

  const plainOption = (s: string) => /^[+−-]?[$£€]?\d[\d,.]*(?:%|x)?$/i.test(s.trim())
  const formatAdjudications = defects
    .filter(d => d.format.length)
    .map(d => {
      const it = items.find(x => x.id === d.id)!
      const isProse = !it.draft.options.every(plainOption)
      return {
        id: d.id,
        rawCodes: d.format.map((f: any) => f.code),
        adjudication: isProse ? 'false_positive_digits_in_prose' : 'genuine_format_defect',
        detail: isProse
          ? 'Shared formatRules.ts orderingValue strips non-digits from prose options mentioning numbers, years, or standards.'
          : 'Genuine numeric-option format issue.',
      }
    })
  const genuineFormatDefects = formatAdjudications.filter(a => a.adjudication === 'genuine_format_defect').length
  const answerLengthOutliers = items
    .filter(it => !it.draft.options.every(plainOption))
    .map(it => {
      const kLen = it.draft.options[it.draft.keyIndex].trim().length
      const dLens = it.draft.options.filter((_: string, idx: number) => idx !== it.draft.keyIndex).map((o: string) => o.trim().length)
      const meanDist = (dLens[0] + dLens[1]) / 2
      return { id: it.id, keyLen: kLen, meanDistractorLen: meanDist, ratio: Number((kLen / Math.max(1, meanDist)).toFixed(2)) }
    })
    .filter(x => x.ratio >= 2.0)

  writeJson(`${OUT}/d1-format-adjudication.json`, {
    phase: 'D1',
    rawFormatFlaggedItems: formatAdjudications.length,
    falsePositiveDigitsInProse: formatAdjudications.filter(a => a.adjudication === 'false_positive_digits_in_prose').length,
    genuineFormatDefects,
    answerLengthOutliersGe2x: answerLengthOutliers.length,
    answerLengthOutliersSample: answerLengthOutliers.slice(0, 20),
    adjudications: formatAdjudications,
  })

  // Pass E: Cross-pool semantic similarity check (routine vs held-out mock within same outcome)
  const simWords = (s: string, opts: string[]) =>
    new Set([s, ...opts].join(' ').toLowerCase().replace(/[\d.,$%()]+/g, '#').replace(/[^a-z#\s]/g, ' ').split(/\s+/).filter(w => w.length > 3))
  const rVecs = items.filter(i => !i.heldOut).map(i => ({ id: i.id, out: i.outcomeId, w: simWords(i.draft.stem, i.draft.options) }))
  const hVecs = items.filter(i => i.heldOut).map(i => ({ id: i.id, out: i.outcomeId, w: simWords(i.draft.stem, i.draft.options) }))
  const crossSimHits: any[] = []
  for (const h of hVecs) {
    for (const r of rVecs) {
      if (r.out !== h.out) continue
      let hit = 0
      for (const w of h.w) if (r.w.has(w)) hit++
      const sim = hit / Math.max(1, h.w.size + r.w.size - hit)
      if (sim >= 0.45) crossSimHits.push({ heldOutId: h.id, routineId: r.id, outcomeId: h.out, similarity: Number(sim.toFixed(2)) })
    }
  }
  crossSimHits.sort((a, b) => b.similarity - a.similarity)
  writeJson(`${OUT}/e1-cross-pool-similarity.json`, {
    phase: 'E',
    threshold: 0.45,
    crossPoolHighSimilarityPairs: crossSimHits.length,
    maxSimilarity: crossSimHits[0]?.similarity ?? 0,
    pairs: crossSimHits,
    note: 'Pairs >= 0.45 share outcome vocabulary/scenario framing and are flagged for human construction-independence verification.',
  })

  const outcomesWithLt6Routine = coverage.filter(c => c.routineCandidates < 6).length
  writeJson(`${OUT}/c6-demand-and-capacity.json`, {
    phase: 'C6',
    routinePoolCandidates: items.filter(i => !i.heldOut).length,
    provisionalRoutineFamilies: routineFams.size,
    confirmedIndependentFamilies: 0,
    policyDerivedDemand: {
      conceptCheck: '5 items (blueprint.ts PURPOSE_LENGTHS)',
      repairRecheck: '8 items independent of initial diagnostic',
      moduleDiagnostic: '20 items across reading concepts',
      adaptivePracticeSet: '5 items per set (10 or 20 total cap per run)',
      sustainablePerOutcomeTarget: '6+ independent families per outcome (2+ per tier) for repeated diagnostic + repair + adaptive practice without sibling reuse',
    },
    capacityStatus: {
      outcomesWithAll3Tiers: coverage.filter(c => !c.missingCandidateTiers.length).length,
      outcomesWithGe6RoutineFamilies: coverage.filter(c => c.provisionalRoutineFamilies >= 6).length,
      outcomesBelow6RoutineFamilies: outcomesWithLt6Routine,
      honestShortageSummary: `${outcomesWithLt6Routine} of 343 outcomes currently have <6 provisional routine families (typically 3: 1 per tier). Those outcomes sustain 1 initial diagnostic + cross-tier repair re-check, but cannot sustain 2+ independent same-tier adaptive sets + spaced rechecks without additional family authoring.`,
    },
  })
  writeJson(`${OUT}/c7-heldout-mock-blueprint.json`, {
    phase: 'C7',
    blueprintVersion: REHEARSAL_BLUEPRINT_VERSION,
    completeFormsSupportedOnProvisionalFamilies: 1,
    session1Count: rehearsalCheck.sessions[0].length,
    session2Count: rehearsalCheck.sessions[1].length,
    perSessionAllocation: rehearsalCheck.perSessionAllocation,
    weightSource: 'https://www.cfainstitute.org/programs/cfa-program/candidate-resources/level-i-exam',
    official2027Weights: weights,
    selectedItemIds: rehearsalCheck.sessions,
    reservedCandidateIds: heldOutPool.filter(i => !rehearsalCheck.sessions.flat().includes(i.id)).map(i => i.id),
    shortfalls: rehearsalCheck.shortfalls,
    crossPoolFamilyLeakageCount: crossPoolLeakage.length,
    readyOnProvisionalAssumptions: rehearsalCheck.shortfalls[0].length === 0 && rehearsalCheck.shortfalls[1].length === 0,
  })
  writeJson(`${OUT}/c8-evaluation-pack.json`, {
    phase: 'C8.4',
    status: 'LOCKED_EVALUATION_ONLY_INELIGIBLE_FOR_STUDENT_SERVING',
    goldCandidates: C8_EVALUATION_GOLD_CANDIDATES,
    defectNegativeExamples: C8_EVALUATION_NEGATIVE_EXAMPLES,
  })
  writeJson(`${OUT}/c8-validation-ledger.json`, {
    phase: 'C8',
    totalItemsValidated: items.length,
    formatOrInputDefects: summary.formatOrInputReview,
    overlapHintsRemaining: summary.overlapReview,
    giveawayAbsolutesRemaining: giveawayCount,
    identicalDistractorDiagnosesRemaining: sameDescCount,
    numericFormulasExecuted: summary.arithmeticExecuted,
    crossPoolFamilyLeakage: crossPoolLeakage.length,
    rehearsalBlueprintVerified: true,
    blindModelSolveStatus: 'self-authoring deterministic pass only; independent external model & human expert blind solves pending',
    bankContentHash,
  })

  console.log(JSON.stringify({
    drafts: summary.drafts,
    routine: summary.routineDrafts,
    heldOutMock: summary.heldOutMockDrafts,
    missingTierOutcomes: summary.missingTierOutcomes,
    arithmeticExecuted: summary.arithmeticExecuted,
    formatOrInputReview: summary.formatOrInputReview,
    overlapReview: summary.overlapReview,
    giveawayAbsolutesRemaining: giveawayCount,
    identicalDistractorDiagnosesRemaining: sameDescCount,
    crossPoolLeakage: crossPoolLeakage.length,
    rehearsalS1: rehearsalCheck.sessions[0].length,
    rehearsalS2: rehearsalCheck.sessions[1].length,
    bankContentHash,
  }, null, 2))
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
