/**
 * Subject-agnostic question-bank loader: lint, load, verify. Ethics and FSA (and each later subject) supply a
 * BankConfig; the rules below are identical for all of them.
 *
 *   --lint [--source file.txt]   offline checks + overlap scan against a local text extraction of the volume
 *   --write                      upsert one concept per outcome + DRAFT items
 *   --verify                     run verifyItem (independent cold solve, structure, and for numeric items the
 *                                arithmetic gate); passes become `verified`, never `reviewed`
 *
 * Rules enforced rather than trusted:
 *  - Items are ORIGINAL. The source text stays OUTSIDE the repo (candidate-use-only); any item sharing a run of
 *    OVERLAP_WORDS+ consecutive words with it fails lint.
 *  - The correct answer is authored/computed first and PLACED here in a seeded, exactly-balanced order.
 *  - Numeric keys and distractors are computed from formulas (see bankNumeric.ts).
 *  - Nothing is ever marked `reviewed`. Items already past `draft` are never overwritten by --write.
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { ERROR_TAXONOMY, DIFFICULTY_SCALE, type Difficulty, type BlueprintCell, type GeneratedItemDraft, type Cognition, type ErrorCode, type ItemForm } from '../../src/lib/diagnostic/types'
import { semanticFingerprint } from '../../src/lib/diagnostic/generator'
import { renderNumeric, type NumericSpec } from './bankNumeric'

export const OVERLAP_WORDS = 8
const MANIFEST_ID = '11111111-1111-1111-1111-111111111111'
const TIER: Record<'E' | 'M' | 'H', Difficulty> = { E: 'foundation', M: 'standard', H: 'difficult' }
const TIER_NAME = { E: 'easy', M: 'medium', H: 'hard' } as const

export type BankItem = {
  o: string; t: 'E' | 'M' | 'H'; c: Cognition; f: ItemForm
  q: string
  /** Correct option text (text items). Ignored for numeric items, where `num.key` computes it. */
  ok?: string
  /** Wrong options: [text | formula, error code, why a student lands here]. */
  w: [string, ErrorCode, string][]
  sol: string
  num?: NumericSpec
}
export type Outcome = { id: string; readingId: string; readingTitle: string; readingNo: number; code: string; title: string; note?: string }
export type BankConfig = {
  prefix: string
  seed: number
  topic: string            // concept.topic, e.g. 'Ethics'
  cellTopic: string        // verifier-facing subject name
  outcomes: () => Promise<Map<string, Outcome>>
  items: BankItem[]
  reportPath: string
  provenance: (o: Outcome) => string
  /** Seed for deterministic concept ids. Defaults to `${prefix}-concept`; set only to preserve ids already in the DB. */
  conceptSeed?: string
}

const uuid = (seed: string) => { const h = createHash('md5').update(seed).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()

function keyPlan(n: number, seed: number): number[] {
  let s = seed
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
  const out: number[] = []
  while (out.length < n) { const b = [0, 1, 2]; for (let i = 2; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } out.push(...b) }
  return out.slice(0, n)
}

export async function build(cfg: BankConfig) {
  const outs = await cfg.outcomes()
  const sorted = [...cfg.items].sort((a, b) => (a.o + a.t).localeCompare(b.o + b.t))
  const keys = keyPlan(sorted.length, cfg.seed)
  return sorted.map((raw, idx) => {
    const los = outs.get(raw.o); if (!los) throw new Error(`${raw.o}: unknown outcome`)
    const id = `${cfg.prefix}-${raw.o}-${TIER_NAME[raw.t]}`
    const key = keys[idx]
    let q = raw.q, sol = raw.sol, okText = raw.ok ?? '', wrongTexts = raw.w.map(w => w[0]); let numericValues: Record<string, number> = {}
    if (raw.num) {
      const r = renderNumeric(raw.num, raw.w.map(w => w[0]), [raw.q, raw.sol])
      okText = r.keyText; wrongTexts = r.wrongTexts; q = r.texts[0]; sol = r.texts[1]; numericValues = raw.num.vars
    }
    const options: string[] = []; const diag: { optionIndex: number; errorCode: ErrorCode; description: string }[] = []
    let wi = 0
    for (let p = 0; p < 3; p++) {
      if (p === key) { options.push(okText); continue }
      options.push(wrongTexts[wi]); diag.push({ optionIndex: p, errorCode: raw.w[wi][1], description: raw.w[wi][2] }); wi++
    }
    const feedback: Record<string, string> = {}
    options.forEach((_, p) => { feedback[String(p)] = p === key ? `Correct. ${sol}` : `Incorrect. ${diag.find(d => d.optionIndex === p)!.description}` })
    const conceptId = uuid(`${cfg.conceptSeed ?? `${cfg.prefix}-concept`}:${raw.o}`)
    const difficulty = TIER[raw.t]
    const draft: GeneratedItemDraft = {
      stem: q, options, keyIndex: key, perOptionFeedback: feedback,
      card: { conceptId, conceptName: los.title, cognition: raw.c, itemForm: raw.f, difficulty, solution: sol, distractorDiagnoses: diag, exactNumericValues: numericValues, isNumeric: !!raw.num },
      generatorModel: 'claude-sonnet-5 (authored; human review pending)',
    }
    const cell: BlueprintCell = { conceptId, conceptName: los.title, topic: cfg.cellTopic, module: los.readingTitle, conceptScope: `${los.title}. Tests the requirement, its application to a short situation${raw.num ? ', and the calculation' : ''}, and the typical wrong reasoning.`, cognition: raw.c, itemForm: raw.f, difficulty }
    return { raw, id, key, options, stem: q, sol, draft, cell, fingerprint: semanticFingerprint(q, options), conceptId, los, difficulty }
  })
}

export async function lint(cfg: BankConfig, sourcePath?: string) {
  const built = await build(cfg); const outs = await cfg.outcomes(); const problems: string[] = []; const notes: string[] = []
  const add = (id: string, m: string) => problems.push(`${id}: ${m}`)
  const per = new Map<string, Set<string>>()
  for (const b of built) {
    const { raw } = b
    if (raw.w.length !== 2) add(b.id, `needs exactly 2 wrong options, has ${raw.w.length}`)
    if (new Set(b.options.map(norm)).size !== 3) add(b.id, 'duplicate option text')
    if (b.options.some(o => /\b(all|none) of the above\b/i.test(o))) add(b.id, '“of the above” option')
    if (b.sol.length < 40) add(b.id, 'solution too short')
    for (const [, code] of raw.w) if (!(code in ERROR_TAXONOMY)) add(b.id, `bad error code ${code}`)
    if (b.stem.length < 30 || b.stem.length > 700) add(b.id, `stem length ${b.stem.length}`)
    if (raw.num && !raw.num.key) add(b.id, 'numeric item without key formula')
    if (!per.has(raw.o)) per.set(raw.o, new Set()); per.get(raw.o)!.add(raw.t)
  }
  for (const id of outs.keys()) { const t = per.get(id); for (const tier of ['E', 'M', 'H'] as const) if (!t?.has(tier)) add(id, `missing ${TIER_NAME[tier]} item`) }
  const fps = new Map<string, string>(); for (const b of built) { if (fps.has(b.fingerprint)) add(b.id, `fingerprint collides with ${fps.get(b.fingerprint)}`); fps.set(b.fingerprint, b.id) }

  const keyCounts = [0, 0, 0]; built.forEach(b => keyCounts[b.key]++)
  const longest = built.filter(b => { const L = b.options.map(o => o.length); return L[b.key] === Math.max(...L) && L.filter(x => x === L[b.key]).length === 1 }).length
  const numeric = built.filter(b => b.raw.num).length
  notes.push(`items ${built.length} (${numeric} numeric); outcomes ${outs.size}; key positions A/B/C ${keyCounts.join('/')}`)
  notes.push(`key is the strictly LONGEST option in ${longest}/${built.length} items (${((longest / built.length) * 100).toFixed(0)}%; chance ≈ 33%)`)
  const byCode: Record<string, number> = {}; built.forEach(b => b.raw.w.forEach(([, c]) => { byCode[c] = (byCode[c] ?? 0) + 1 })); notes.push(`distractor error codes: ${JSON.stringify(byCode)}`)

  if (sourcePath) {
    const words = norm(readFileSync(sourcePath, 'utf8')).split(' ')
    const grams = new Set<string>(); for (let i = 0; i + OVERLAP_WORDS <= words.length; i++) grams.add(words.slice(i, i + OVERLAP_WORDS).join(' '))
    let hits = 0
    for (const b of built) {
      const fields: [string, string][] = [['stem', b.stem], ...b.options.map((o, i) => [`option ${i}`, o] as [string, string]), ['solution', b.sol]]
      for (const [name, text] of fields) { const w = norm(text).split(' '); for (let i = 0; i + OVERLAP_WORDS <= w.length; i++) { const g = w.slice(i, i + OVERLAP_WORDS).join(' '); if (grams.has(g)) { add(b.id, `${name} shares ${OVERLAP_WORDS}+ words with the source: “${g}”`); hits++; break } } }
    }
    notes.push(`source overlap scan (${OVERLAP_WORDS}-word runs against ${words.length} source words): ${hits} hit(s)`)
  } else notes.push('source overlap scan SKIPPED (pass --source)')
  notes.forEach(n => console.log(n))
  if (problems.length) { console.log(`\n${problems.length} problem(s):`); problems.forEach(p => console.log('  ✗ ' + p)); return false }
  console.log('\nLINT OK'); return true
}

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

export async function write(cfg: BankConfig) {
  const db = admin(); const built = await build(cfg); const outs = await cfg.outcomes()
  const concepts = [...outs.values()].map(l => ({
    id: uuid(`${cfg.conceptSeed ?? `${cfg.prefix}-concept`}:${l.id}`), manifest_id: MANIFEST_ID, topic: cfg.topic, reading: `Reading ${l.readingNo}`, module: `${cfg.prefix.replace('q-', '')}-${l.readingId}`,
    los: `LOS ${l.code}`, name: l.title, importance: 'core', lm_id: l.readingId, verification_status: 'pending', scope_notes: l.note ?? l.title,
  }))
  let r: any = await db.from('curriculum_concepts').upsert(concepts, { onConflict: 'id' }); if (r.error) throw new Error('concepts: ' + r.error.message)
  const oid = new Map(concepts.map((c, i) => [c.id, [...outs.values()][i].id]))
  r = await db.from('concept_outcome_map').upsert(concepts.map(c => ({ concept_id: c.id, outcome_id: oid.get(c.id)!, approximate: false })), { onConflict: 'concept_id' }); if (r.error) throw new Error('map: ' + r.error.message)
  const existing = await db.from('assessment_items').select('id, review_status').like('id', `${cfg.prefix}-%`); if (existing.error) throw new Error(existing.error.message)
  const locked = new Set((existing.data ?? []).filter(x => x.review_status !== 'draft').map(x => x.id))
  const rows = built.filter(b => !locked.has(b.id)).map(b => ({
    id: b.id, lm_id: b.los.readingId, outcome_id: b.raw.o, concept_id: b.conceptId,
    learning_objective: b.los.title, verification_intent: `${b.raw.c}: ${b.los.title}`,
    difficulty: DIFFICULTY_SCALE[b.difficulty], intended_difficulty: b.difficulty, cognition: b.raw.c, item_form: b.raw.f,
    stem: b.stem, options: b.options, key_index: b.key, per_option_feedback: b.draft.perOptionFeedback,
    provenance: cfg.provenance(b.los), review_status: 'draft', item_card: b.draft.card, semantic_fingerprint: b.fingerprint, generator_model: b.draft.generatorModel,
  }))
  const ins = await db.from('assessment_items').upsert(rows, { onConflict: 'id' }); if (ins.error) throw new Error('items: ' + ins.error.message)
  console.log(`concepts ${concepts.length}, items written as draft ${rows.length}, left untouched (already past draft) ${locked.size}`)
}

export async function verify(cfg: BankConfig, only?: Set<string>) {
  const { verifyItem } = await import('../../src/lib/diagnostic/verifier')
  const db = admin(); const built = await build(cfg)
  const cur = await db.from('assessment_items').select('id, review_status, semantic_fingerprint'); if (cur.error) throw new Error(cur.error.message)
  const status = new Map((cur.data ?? []).map(x => [x.id, x.review_status as string]))
  const vrows = await db.from('item_validations').select('item_id').in('reviewer_role', ['editorial_verifier', 'numerical_verifier']); if (vrows.error) throw new Error(vrows.error.message)
  const hasGates = new Set((vrows.data ?? []).map(r => r.item_id as string))
  const todo = built.filter(b => (!only || only.has(b.id)) && (status.get(b.id) === 'draft' || (status.get(b.id) === 'verified' && !hasGates.has(b.id))))
  console.log(`verifying ${todo.length} items`)
  const report: any[] = []; let pass = 0
  const worker = async (b: (typeof built)[number]) => {
    const others = new Set((cur.data ?? []).filter(x => x.id !== b.id && x.semantic_fingerprint).map(x => x.semantic_fingerprint as string))
    let res
    try { res = await verifyItem(b.draft, b.cell, { existingFingerprints: others, fingerprint: b.fingerprint }) }
    catch (e: any) { report.push({ id: b.id, status: 'ERROR', reason: e.message }); return }
    report.push({ id: b.id, numeric: !!b.raw.num, status: res.status, defects: res.defectCodes, reason: res.reason, model: res.verifierModel, independentAnswerIndex: res.independentAnswerIndex, declaredKey: b.key })
    await db.from('item_validations').delete().eq('item_id', b.id).in('reviewer_role', ['editorial_verifier', 'numerical_verifier'])
    await db.from('item_validations').insert(res.gates.map(g => ({
      item_id: b.id, reviewer_role: g.gate === 'numerical' || g.gate === 'distractors' ? 'numerical_verifier' : 'editorial_verifier',
      status: g.passed ? 'PASS' : 'REVISE', defect_codes: g.passed ? [] : res.defectCodes, detail: { gate: g.gate, detail: g.detail, derivation: res.derivation ?? null },
    })))
    if (res.status === 'PASS') { pass++; await db.from('assessment_items').update({ review_status: 'verified', verifier_model: res.verifierModel, verified_at: new Date().toISOString() }).eq('id', b.id).in('review_status', ['draft', 'verified']) }
    else if (status.get(b.id) === 'verified') await db.from('assessment_items').update({ review_status: 'draft', verified_at: null }).eq('id', b.id).eq('review_status', 'verified')
  }
  const queue = [...todo]; await Promise.all(Array.from({ length: 4 }, async () => { for (let b = queue.shift(); b; b = queue.shift()) await worker(b) }))
  report.sort((a, b) => a.id.localeCompare(b.id))
  writeFileSync(cfg.reportPath, JSON.stringify(report, null, 1) + '\n')
  const tally: Record<string, number> = {}; report.forEach(r => { tally[r.status] = (tally[r.status] ?? 0) + 1 })
  const num = report.filter(r => r.numeric); const numPass = num.filter(r => r.status === 'PASS').length
  console.log('verifier outcomes:', JSON.stringify(tally), `→ ${pass} verified; numeric items ${numPass}/${num.length} passed`)
  report.filter(r => r.status !== 'PASS').forEach(r => console.log(`  ${r.status.padEnd(12)} ${r.id}  ${String(r.reason).slice(0, 260)}`))
}

export async function cli(cfg: BankConfig, args = process.argv.slice(2)) {
  const src = args.includes('--source') ? args[args.indexOf('--source') + 1] : undefined
  if (args.includes('--lint')) process.exit((await lint(cfg, src)) ? 0 : 1)
  if (args.includes('--write')) return write(cfg)
  if (args.includes('--verify')) {
    // --only id,id: re-verify just those items (e.g. ones an author has since edited). Unedited failures stay draft for a human.
    const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : undefined
    return verify(cfg, only)
  }
  console.log('usage: --lint [--source file] | --write | --verify [--only id,id]')
}
