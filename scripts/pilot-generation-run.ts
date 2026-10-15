/**
 * Pilot generation run — spec §2 goal 4, §6.
 *
 * Builds a blueprint, generates against every cell, verifies each draft, and
 * writes the survivors to assessment_items at trust tier "verified" (§5.5).
 * Rejected drafts are kept, with their defect codes, as the §11.2 corpus.
 *
 *   npx tsx scripts/pilot-generation-run.ts               # 20 items, fsa-income
 *   npx tsx scripts/pilot-generation-run.ts --target 5    # smaller run
 *   npx tsx scripts/pilot-generation-run.ts --dry-run     # generate, verify, write nothing
 *   npx tsx scripts/pilot-generation-run.ts --seed 42     # reproducible blueprint
 *
 * The number that matters is not "20 items exist". It is the measured yield and
 * the record of what the verifier rejected and why, which is what tells us
 * whether the verifier's judgement can be trusted to gate delivery.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateItemDraft, semanticFingerprint, DraftShapeError } from '../src/lib/diagnostic/generator'
import { verifyItem } from '../src/lib/diagnostic/verifier'
import { buildBlueprint, checkCoverage, type ConceptSlice } from '../src/lib/diagnostic/blueprintPlan'
import { DIFFICULTY_SCALE } from '../src/lib/diagnostic/types'

dotenv.config({ path: '.env.local', quiet: true } as any)

const HERE = dirname(fileURLToPath(import.meta.url))
const MODULE_ID = 'fsa-income'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const flag = (name: string) => process.argv.includes(`--${name}`)

const TARGET = Number(arg('target', '20'))
const SEED = Number(arg('seed', String(Date.now())))
const DRY_RUN = flag('dry-run')
/** Cap on drafts per blueprint cell before the cell is abandoned. */
const MAX_ATTEMPTS_PER_CELL = 3
/**
 * Wall-clock ceiling on one draft-and-verify attempt.
 *
 * Some NVIDIA endpoints accept a request and never answer. Per-request timeouts
 * bound each call, but a single attempt makes up to four of them across two
 * models, so without an overall deadline one bad cell can stall a run for half
 * an hour. Observed in practice: a run sat on cell 7 for 25 minutes.
 */
const ATTEMPT_DEADLINE_MS = Number(arg('deadline', '240000'))

class AttemptTimeout extends Error {
  constructor(ms: number) {
    super(`attempt exceeded ${Math.round(ms / 1000)}s and was abandoned`)
    this.name = 'AttemptTimeout'
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const ceiling = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AttemptTimeout(ms)), ms)
  })
  return Promise.race([work, ceiling]).finally(() => clearTimeout(timer)) as Promise<T>
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

type RunRecord = {
  cellIndex: number
  conceptId: string
  conceptName: string
  cognition: string
  itemForm: string
  difficulty: string
  attempts: number
  outcome: 'released' | 'abandoned'
  itemId?: string
  keyIndex?: number
  rejections: { status: string; defectCodes: string[]; reason: string }[]
}

async function main() {
  console.log(`Pilot generation run — module ${MODULE_ID}, target ${TARGET} verified items, seed ${SEED}${DRY_RUN ? ' (DRY RUN)' : ''}\n`)

  // 1. Load the manifest slice ------------------------------------------------
  const { data: conceptRows, error: conceptErr } = await supabase
    .from('curriculum_concepts')
    .select('id, name, topic, module, scope_notes, excluded_or_superseded, importance, verification_status')
    .eq('lm_id', MODULE_ID)
    .in('verification_status', ['drafted', 'verified'])
    .order('los')

  if (conceptErr) throw new Error(`Failed to load concepts: ${conceptErr.message}`)
  if (!conceptRows || conceptRows.length === 0) {
    throw new Error(`No drafted or verified concepts for module ${MODULE_ID}. Run the manifest slice migration first.`)
  }

  const unverified = conceptRows.filter(c => c.verification_status !== 'verified')
  if (unverified.length > 0) {
    console.log(
      `Note: ${unverified.length}/${conceptRows.length} concepts are drafted but not human-verified.\n` +
      `      Items generated against them can reach trust tier "verified" (routine testing) but\n` +
      `      cannot be promoted to "reviewed" until the concept is signed off (§5.1).\n`
    )
  }

  const concepts: ConceptSlice[] = conceptRows.map(c => ({
    id: c.id,
    name: c.name,
    topic: c.topic,
    module: c.module,
    scopeNotes: [c.scope_notes, c.excluded_or_superseded ? `EXCLUDED FROM SCOPE: ${c.excluded_or_superseded}` : '']
      .filter(Boolean)
      .join(' '),
    importance: c.importance as ConceptSlice['importance'],
  }))

  // 2. Build the blueprint before drafting anything ---------------------------
  const { cells, quota } = buildBlueprint(concepts, TARGET, SEED)
  console.log(`Blueprint: ${cells.length} cells across ${concepts.length} concepts`)
  console.log(`  difficulty  ${quota.difficulties.filter(d => d.count).map(d => `${d.difficulty}×${d.count}`).join(', ')}`)
  console.log(`  cognition   ${quota.pairs.filter(p => p.count).map(p => `${p.cognition}/${p.itemForm}×${p.count}`).join(', ')}\n`)

  // 3. Existing fingerprints, for duplicate screening -------------------------
  const { data: existing } = await supabase
    .from('assessment_items')
    .select('semantic_fingerprint')
    .not('semantic_fingerprint', 'is', null)
  const fingerprints = new Set((existing ?? []).map(r => r.semantic_fingerprint as string))

  // 4. Generate and verify ----------------------------------------------------
  const records: RunRecord[] = []
  let totalDrafted = 0
  const released: { cognition: any; itemForm: any; difficulty: any; conceptId: string; keyIndex: number }[] = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]
    const record: RunRecord = {
      cellIndex: i,
      conceptId: cell.conceptId,
      conceptName: cell.conceptName,
      cognition: cell.cognition,
      itemForm: cell.itemForm,
      difficulty: cell.difficulty,
      attempts: 0,
      outcome: 'abandoned',
      rejections: [],
    }

    process.stdout.write(`[${String(i + 1).padStart(2)}/${cells.length}] ${cell.conceptName} · ${cell.cognition}/${cell.itemForm}/${cell.difficulty} `)

    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CELL; attempt++) {
      record.attempts = attempt
      totalDrafted++
      try {
        const { draft, fingerprint, verdict } = await withDeadline(
          (async () => {
            const draft = await generateItemDraft(cell)
            const fingerprint = semanticFingerprint(draft.stem, draft.options)
            const verdict = await verifyItem(draft, cell, { existingFingerprints: fingerprints, fingerprint })
            return { draft, fingerprint, verdict }
          })(),
          ATTEMPT_DEADLINE_MS
        )

        if (verdict.status !== 'PASS') {
          record.rejections.push({ status: verdict.status, defectCodes: verdict.defectCodes, reason: verdict.reason })
          if (!DRY_RUN) {
            await supabase.from('rejected_item_drafts').insert({
              concept_id: cell.conceptId,
              blueprint_cell: cell,
              draft: draft as any,
              verifier_status: verdict.status,
              stage: 'verification',
              defect_codes: verdict.defectCodes,
              reason: verdict.reason,
              generator_model: draft.generatorModel,
              verifier_model: verdict.verifierModel,
            })
          }
          console.log(`\n      ✗ ${verdict.status}: ${verdict.reason}`)
          continue
        }

        // PASS — write the item at trust tier "verified".
        const itemId = `q-${MODULE_ID}-${stamp}-${i}`
        fingerprints.add(fingerprint)

        if (!DRY_RUN) {
          const { error: insertErr } = await supabase.from('assessment_items').insert({
            id: itemId,
            lm_id: MODULE_ID,
            concept_id: cell.conceptId,
            learning_objective: cell.conceptName,
            verification_intent: `${cell.cognition} · ${cell.itemForm} · ${cell.difficulty}`,
            difficulty: DIFFICULTY_SCALE[cell.difficulty],
            intended_difficulty: cell.difficulty,
            cognition: cell.cognition,
            item_form: cell.itemForm,
            stem: draft.stem,
            options: draft.options,
            key_index: draft.keyIndex,
            per_option_feedback: draft.perOptionFeedback,
            item_card: draft.card,
            semantic_fingerprint: fingerprint,
            provenance: 'pipeline_v1',
            generator_model: draft.generatorModel,
            verifier_model: verdict.verifierModel,
            review_status: 'verified',
            verified_at: new Date().toISOString(),
          })
          if (insertErr) throw new Error(`DB insert failed: ${insertErr.message}`)

          await supabase.from('item_validations').insert(
            verdict.gates.map(g => ({
              item_id: itemId,
              reviewer_role: g.gate === 'numerical' || g.gate === 'distractors' ? 'numerical_verifier' : 'editorial_verifier',
              status: g.passed ? 'PASS' : 'REVISE',
              defect_codes: g.passed ? [] : verdict.defectCodes,
              detail: { gate: g.gate, detail: g.detail, derivation: verdict.derivation ?? null },
            }))
          )
        }

        record.outcome = 'released'
        record.itemId = itemId
        record.keyIndex = draft.keyIndex
        released.push({ ...cell, keyIndex: draft.keyIndex })
        process.stdout.write(' ✓')
        break
      } catch (error: any) {
        // A generation failure is a defect too, and the one most worth reading:
        // it says the generator could not produce a well-formed item at all.
        const label = error instanceof DraftShapeError ? 'SHAPE'
          : error instanceof AttemptTimeout ? 'TIMEOUT'
          : 'ERROR'
        record.rejections.push({ status: label, defectCodes: [`GEN_${label}`], reason: error.message })
        if (!DRY_RUN) {
          await supabase.from('rejected_item_drafts').insert({
            concept_id: cell.conceptId,
            blueprint_cell: cell,
            draft: null,
            verifier_status: label,
            stage: 'generation',
            defect_codes: [`GEN_${label}`],
            reason: error.message,
          })
        }
        console.log(`\n      ✗ ${label}: ${error.message}`)
      }
    }

    records.push(record)
    console.log(record.outcome === 'released' ? '' : '      (abandoned after 3 drafts)')
  }

  // 5. Report -----------------------------------------------------------------
  const releasedCount = records.filter(r => r.outcome === 'released').length
  const yieldRate = totalDrafted === 0 ? 0 : (releasedCount / totalDrafted) * 100
  const coverage = checkCoverage(quota, released)

  const keyPositions = [0, 1, 2].map(k => released.filter(r => r.keyIndex === k).length)
  const expected = releasedCount / 3
  const positionBalanced = releasedCount === 0 || keyPositions.every(n => Math.abs(n - expected) <= Math.max(2, expected * 0.5))

  const defectTally: Record<string, number> = {}
  for (const r of records) {
    for (const rej of r.rejections) {
      for (const code of rej.defectCodes) defectTally[code] = (defectTally[code] ?? 0) + 1
    }
  }

  console.log('\n=== Pilot run complete ===')
  console.log(`Blueprint cells      ${cells.length}`)
  console.log(`Drafts generated     ${totalDrafted}`)
  console.log(`Items released       ${releasedCount}`)
  console.log(`Generator yield      ${yieldRate.toFixed(1)}%  (released ÷ drafted)`)
  console.log(`Blueprint coverage   ${coverage.satisfied ? '100% — all declared quotas satisfied' : `INCOMPLETE`}`)
  for (const s of coverage.shortfalls) console.log(`  shortfall: ${s}`)
  console.log(`Answer positions     A=${keyPositions[0]} B=${keyPositions[1]} C=${keyPositions[2]}  ${positionBalanced ? 'balanced' : 'IMBALANCED'}`)
  if (Object.keys(defectTally).length > 0) {
    console.log('Rejection reasons:')
    for (const [code, n] of Object.entries(defectTally).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(3)} × ${code}`)
    }
  }

  const reportDir = join(HERE, '..', 'artifacts', 'pilot-runs')
  mkdirSync(reportDir, { recursive: true })
  const reportPath = join(reportDir, `${stamp}.json`)
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        module: MODULE_ID, target: TARGET, seed: SEED, dryRun: DRY_RUN,
        quota, totalDrafted, releasedCount, yieldRate, coverage,
        keyPositions, positionBalanced, defectTally, records,
      },
      null,
      2
    )
  )
  console.log(`\nRun report: ${reportPath}`)

  if (releasedCount < TARGET) {
    console.log(`\nReleased ${releasedCount} of ${TARGET}. Re-run with a different --seed to fill the abandoned cells.`)
  }
  console.log(`\nNext: review the released items at /app/tests/review and promote the good ones to "reviewed".`)
  console.log(`The pilot's real output is verifier–human agreement — how many of these you also accept.`)
}

main().catch(error => {
  console.error('\nPilot run failed:', error.message)
  process.exit(1)
})
