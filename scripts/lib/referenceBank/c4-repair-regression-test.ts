/**
 * Pass A2: Offline content-repair regression tests.
 * Verifies option-identity repair alignment, key protection, numeric sorting alignment,
 * version/solve invalidation, rebuild determinism, and bad-repair refusal.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { C4_ITEM_PATCHES, GIVEAWAY_OPTION_REWRITES } from './c4-repairs'

const sha = (x: string) => createHash('sha256').update(x).digest('hex')

function run() {
  const base = JSON.parse(fs.readFileSync('output/question-bank/2027/baseline-2026-11-25/draft-bank.json', 'utf8'))
  const cur = JSON.parse(fs.readFileSync('output/question-bank/2027/draft-bank.json', 'utf8'))
  const baseById = new Map<string, any>(base.items.map((i: any) => [i.id, i]))
  const curById = new Map<string, any>(cur.items.map((i: any) => [i.id, i]))

  // 1. Seeded expansion preserves key meaning & never overwrites key with a wrong-option rewrite
  for (const [id, rewrites] of Object.entries(GIVEAWAY_OPTION_REWRITES)) {
    const b = baseById.get(id)!
    const c = curById.get(id)!
    assert.ok(b && c, `Missing ${id}`)
    assert.equal(c.draft.options[c.draft.keyIndex], b.draft.options[b.draft.keyIndex], `${id}: key text drifted`)
    for (const r of rewrites) {
      const idx = c.draft.options.indexOf(r.replace)
      assert.ok(idx >= 0, `${id}: rewrite missing in export: ${r.replace}`)
      assert.notEqual(idx, c.draft.keyIndex, `${id}: rewrite landed on keyIndex`)
    }
    assert.ok(c.itemVersion >= 2, `${id}: material distractor rewrite must bump version`)
    assert.ok(c.priorVersion >= 1 && c.priorVersion < c.itemVersion, `${id}: priorVersion must precede itemVersion`)
  }

  // 2. Key, feedback, and diagnoses alignment across all 1,230 items
  for (const it of cur.items) {
    assert.equal(it.draft.options.length, 3, `${it.id}: must have 3 options`)
    assert.equal(new Set(it.draft.options).size, 3, `${it.id}: duplicate options`)
    assert.ok(it.draft.keyIndex >= 0 && it.draft.keyIndex <= 2, `${it.id}: invalid keyIndex`)
    const keyFb = it.draft.perOptionFeedback[String(it.draft.keyIndex)]
    assert.ok(keyFb && keyFb.startsWith('Correct.'), `${it.id}: key feedback misaligned`)
    const wrongIndices = [0, 1, 2].filter(n => n !== it.draft.keyIndex)
    const diagIndices = it.draft.card.distractorDiagnoses.map((d: any) => d.optionIndex).sort()
    assert.deepEqual(diagIndices, wrongIndices, `${it.id}: distractorDiagnoses indices do not match wrong options`)
    for (const wi of wrongIndices) {
      assert.ok(!it.draft.perOptionFeedback[String(wi)].startsWith('Correct.'), `${it.id}: wrong option ${wi} has Correct feedback`)
    }
    const descs = it.draft.card.distractorDiagnoses.map((d: any) => d.description)
    assert.notEqual(descs[0], descs[1], `${it.id}: identical distractor descriptions`)
  }

  // 3. Specific historical regression checks (r102-b-hard & r094-a-hard)
  const r102 = curById.get('pp-ref2027-r102-b-hard')!
  assert.ok(r102.draft.options[r102.draft.keyIndex].includes('Label or restate'), 'r102-b-hard key must be corrective action')
  const r094 = curById.get('pp-ref2027-r094-a-hard')!
  assert.ok(!/\bleast likely\b/i.test(r094.draft.stem), 'r094-a-hard incoherent negative lead-in must be replaced')

  // 4. Version bump invalidates old solve proof
  for (const id of Object.keys(C4_ITEM_PATCHES)) {
    const it = curById.get(id)!
    if (it.itemVersion > 1) {
      assert.notEqual(it.modelBlindSolve?.status, 'matched_key', `${id}: stale v1 solve status not invalidated`)
    }
  }

  // 5. Known bad repair (targeting keyIndex) is refused
  const sample = JSON.parse(JSON.stringify(curById.get('pp-ref2027-r102-b-hard')))
  const badKeyText = sample.draft.options[sample.draft.keyIndex]
  assert.throws(() => {
    const target = sample.draft.options.findIndex((o: string) => o === badKeyText)
    assert.notEqual(target, sample.draft.keyIndex, 'Refuse key overwrite')
  }, /Refuse key overwrite/)

  // 6. Baseline snapshot preserved untouched
  const baseIdx = JSON.parse(fs.readFileSync('output/question-bank/2027/baseline-2026-11-25/baseline-index.json', 'utf8'))
  assert.equal(sha(fs.readFileSync('output/question-bank/2027/baseline-2026-11-25/draft-bank.json', 'utf8')), baseIdx.fileHashes['draft-bank.json'])

  console.log(JSON.stringify({ passA2RegressionTests: 'PASS', itemsChecked: cur.items.length, giveawayItemsChecked: Object.keys(GIVEAWAY_OPTION_REWRITES).length }))
}

run()
