/**
 * Candidate production batches.
 *   npm run items:batch -- prepare --key k --per-topic 1 [--topics fsa,eth]       explicit, atomic: unsigned approximate concept stubs for unmapped outcomes
 *   npm run items:batch -- create --label "Probe" --key probe-1 --per-topic 1 [--seed 7] [--topics fsa,eth] [--readings r032] [--packs content/source-packs]
 *        [--rights-ref "who/what authorised the input use"]  (cleared rights need an authority; a flag alone is refused)
 *        [--max-requests 40 --max-tokens 100000 --wall-minutes 20]  (max-tokens bounds COMPLETION tokens only; prompt tokens and cost are not capped) [--max-attempts 2] [--parent <batchId>]
 *   npm run items:batch -- run <batchId> [--workers 2] [--deadline 240]
 *   npm run items:batch -- packs [--packs content/source-packs]       authoring checklist: every pack against the active edition, its outcome, concept sign-off and rights (no provider call, nothing written)
 *   npm run items:batch -- provider-check [--model id]   exactly ONE tiny request per distinct configured model, each aborted at 30 s (honours NVIDIA_BASE_URL): reachability + JSON shape only, NOT generation speed
 *   npm run items:batch -- status <batchId> | report <batchId> | cancel <batchId>
 * Everything generated stays "draft" or "automatically checked" with a PROVISIONAL family; a person confirms and approves it in the reviewer workspace.
 * A cell with no adequate grounding packet is recorded as a precise BLOCKED cell: no provider call, nothing written from model memory.
 */
import * as dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createBatch, prepareMappings, promptVersion, runBatch, type CreateBatchInput } from '../src/lib/diagnostic/batch'
import { loadSourcePacks, SOURCE_PACK_DIR } from '../src/lib/diagnostic/sourcePacks'
import { createAdminClient } from '../src/lib/supabase/admin'
import { buildGroundingPacket } from '../src/lib/diagnostic/groundingPacket'
import { loadBatchReport } from '../src/lib/diagnostic/reviewService'

const [cmd, ...rest] = process.argv.slice(2)
const arg = (n: string, d?: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 && rest[i + 1] ? rest[i + 1] : d }
const num = (n: string) => { const v = arg(n); return v === undefined ? undefined : Number(v) }

/** Reservations are what was ALLOWED to be spent (requests, and completion-token allowance); usage is only what the provider REPORTED. Unknown is not zero. */
async function status(id: string) {
  const admin = createAdminClient()
  const { data: b } = await admin.from('item_batches').select('*').eq('id', id).single()
  const { data: cells } = await admin.from('item_batch_cells').select('status, verdict, attempts, failure_reason, defect_codes, generate_ms, provider_usage').eq('batch_id', id)
  const by: Record<string, number> = {}; (cells ?? []).forEach(c => { const k = c.status === 'failed' && c.verdict ? `failed:${c.verdict}` : (c.status as string); by[k] = (by[k] ?? 0) + 1 })
  const u = { requestsSent: 0, knownCalls: 0, unknownCalls: 0, promptTokensKnown: 0, completionTokensKnown: 0, cellsWithNoUsageRecord: 0 }
  const stageMs: Record<string, number> = {}
  for (const c of cells ?? []) {
    const p = c.provider_usage as any
    if (!p) { u.cellsWithNoUsageRecord++; continue }
    u.requestsSent += p.calls ?? 0; u.knownCalls += p.knownCalls ?? 0; u.unknownCalls += p.unknownCalls ?? 0; u.promptTokensKnown += p.promptTokens ?? 0; u.completionTokensKnown += p.completionTokens ?? 0
    for (const a of p.attempts ?? []) stageMs[a.stage] = (stageMs[a.stage] ?? 0) + (a.ms ?? 0)
  }
  console.log(JSON.stringify({ id, label: b?.label, status: b?.status, rights: b?.rights_status, requested: b?.requested_count, cells: by,
    reserved: { requests: b?.requests_reserved, completionTokenAllowance: b?.tokens_reserved, note: 'an allowance set aside before each request; NOT measured consumption and NOT a cap on prompt tokens or cost' },
    budget: b?.budget, providerReported: u, millisecondsByStage: stageMs }, null, 1))
}

function input(): CreateBatchInput {
  const budget = arg('max-requests') || arg('max-tokens') || arg('wall-minutes') ? { maxRequests: num('max-requests') ?? 40, maxTokens: num('max-tokens') ?? 100000, wallSeconds: Math.round((num('wall-minutes') ?? 20) * 60) } : undefined
  const gen = readFileSync('src/lib/diagnostic/generator.ts', 'utf8'), ver = readFileSync('src/lib/diagnostic/verifier.ts', 'utf8')
  return {
    label: arg('label', 'Candidate batch')!, requestKey: arg('key')!, perTopic: Number(arg('per-topic', '1')), seed: Number(arg('seed', '7')), promptVersion: promptVersion(gen, ver),
    rights: { status: arg('rights-ref') ? 'cleared' : 'unconfirmed', ref: arg('rights-ref') },
    inputsNote: 'Grounding packets from source packs selected by canonical outcome/concept id; no provider question or past paper is supplied.',
    topics: arg('topics')?.split(','), readings: arg('readings')?.split(','), packs: loadSourcePacks(arg('packs', SOURCE_PACK_DIR)), budget, maxAttempts: num('max-attempts'), parentBatchId: arg('parent'),
  }
}

/** Read-only checklist: what a reviewer or author must resolve before a pack can ground a batch, and what still blocks publication. */
async function packsChecklist() {
  const admin = createAdminClient(), packs = loadSourcePacks(arg('packs', SOURCE_PACK_DIR))
  const { data: manifest } = await admin.from('curriculum_manifests').select('id, year, version').eq('is_active', true).single()
  if (!manifest) throw new Error('No active curriculum manifest')
  let draftable = 0
  for (const p of packs) {
    const { data: maps } = await admin.from('concept_outcome_map').select('concept_id, approximate').eq('outcome_id', p.outcomeId)
    const { data: concepts } = await admin.from('curriculum_concepts').select('id, name, verification_status, manifest_id').in('id', (maps ?? []).map(m => m.concept_id)).eq('manifest_id', manifest.id)
    const { data: lo } = await admin.from('reading_los').select('id, reading_id, title').eq('id', p.outcomeId).maybeSingle()
    const rows = (concepts ?? []).filter(c => !p.conceptId || p.conceptId === c.id).map(c => {
      const m = maps!.find(x => x.concept_id === c.id)!
      const r = buildGroundingPacket({ manifest: manifest as any, concept: c as any, mapping: { outcome_id: p.outcomeId, approximate: m.approximate }, pack: p,
        cell: { outcomeId: p.outcomeId, readingId: lo?.reading_id ?? '', conceptId: c.id, conceptName: c.name, cognition: 'apply', itemForm: 'scenario', difficulty: 'standard' } })
      return { concept: c.name, drafting: r.packet ? 'allowed (quarantined candidates)' : 'BLOCKED', blockers: r.blockers.map(b => `${b.blocking ? 'BLOCKS' : 'note'} ${b.code}`), publication: ['rights not cleared', 'concept not signed off', 'human review of the exact version'].filter((_, i) => i === 0 ? p.rights.state !== 'cleared' : i === 1 ? c.verification_status !== 'verified' : true) }
    })
    if (!lo) rows.push({ concept: '(none)', drafting: 'BLOCKED', blockers: ['BLOCKS NO_OUTCOME: this outcome is not in the curriculum'], publication: [] })
    if (!rows.length) rows.push({ concept: '(none)', drafting: 'BLOCKED', blockers: ['BLOCKS NO_CONCEPT: no concept for this outcome in the active edition'], publication: [] })
    draftable += rows.filter(r => r.drafting !== 'BLOCKED').length
    console.log(JSON.stringify({ pack: `${p.packId}@${p.version}`, outcome: p.outcomeId, edition: p.edition, facts: p.facts.length, source: p.source.name.slice(0, 70), sourceHash: p.source.hash ?? 'MISSING', rights: p.rights.state, cells: rows }, null, 1))
  }
  console.log(`${packs.length} pack(s) · ${draftable} concept cell(s) can draft quarantined candidates · none can publish until rights are cleared by a recorded authority, the concept is signed off by a person, and a reviewer approves the exact version.`)
}

/**
 * Reachability + shape probe. EXACT ceiling: one HTTP request per DISTINCT configured model (never a hidden fallback), each with its own 30 s
 * deadline that aborts the request. `--model <id>` probes just one. An empty or unparseable answer is a failure. It proves the endpoint answers
 * and returns JSON; it says NOTHING about how long a full question takes to generate.
 */
async function providerCheck() {
  const { generateStructuredOutput, MODEL_TIERS, newUsage, withUsage } = await import('../src/lib/llm')
  const models = [...new Set([...MODEL_TIERS.reasoning, ...MODEL_TIERS.verifier])].filter(m => !arg('model') || m === arg('model'))
  console.log(JSON.stringify({ baseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1', keyPresent: Boolean(process.env.NVIDIA_API_KEY), tiers: MODEL_TIERS, requestCeiling: models.length, perRequestDeadlineSeconds: 30 }))
  if (!models.length) { console.error('No configured model matches --model.'); process.exit(1) }
  let bad = 0
  for (const model of models) {
    const t0 = Date.now(), usage = newUsage()
    try {
      const result = await withUsage(usage, () => generateStructuredOutput<{ ok: boolean }>('Reply with JSON only.', 'Return exactly {"ok": true}.', { models: [model], temperature: 0, maxTokens: 512, attemptsPerModel: 1, maxRequests: 1, stage: 'provider-check', stageMs: 30_000 }))
      const good = result?.ok === true; if (!good) bad++
      console.log(JSON.stringify({ model, ok: good, ms: Date.now() - t0, requestsSent: usage.calls, usage: { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens, knownCalls: usage.knownCalls, unknownCalls: usage.unknownCalls } }))
    } catch (e: any) { bad++; console.log(JSON.stringify({ model, ok: false, ms: Date.now() - t0, requestsSent: usage.calls, outcome: usage.attempts.at(-1)?.outcome, error: String(e.message).slice(0, 300) })) }
  }
  process.exit(bad ? 1 : 0)
}

async function main() {
  if (cmd === 'provider-check') await providerCheck()
  else if (cmd === 'packs') await packsChecklist()
  else if (cmd === 'prepare') console.log(JSON.stringify(await prepareMappings(input())))
  else if (cmd === 'create') { const r = await createBatch(input()); console.log(JSON.stringify(r)); if (!r.ok) process.exit(1) }
  else if (cmd === 'run') {
    const id = rest[0]
    await runBatch(id, { workers: Number(arg('workers', '2')), deadlineMs: Number(arg('deadline', '240')) * 1000, log: m => console.log(new Date().toISOString().slice(11, 19), m) })
    await status(id)
  } else if (cmd === 'status') await status(rest[0])
  else if (cmd === 'report') { const r = await loadBatchReport(rest[0]); const { batch, ...m } = r ?? ({} as any); console.log(JSON.stringify({ label: batch?.label, status: batch?.status, ...m }, null, 1)) }
  else if (cmd === 'cancel') { console.log(JSON.stringify((await createAdminClient().rpc('cancel_item_batch', { p_batch: rest[0], p_reason: 'cancelled by operator' })).data)); await status(rest[0]) }
  else console.log('usage: provider-check | packs | prepare | create | run <id> | status <id> | report <id> | cancel <id>')
}
main().catch(e => { console.error(e.message); process.exit(1) })
