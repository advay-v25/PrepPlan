import { createHash } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { buildBlueprint, type ConceptSlice } from './blueprintPlan'
import { generateItemDraft, semanticFingerprint, DraftShapeError } from './generator'
import { verifyItem } from './verifier'
import { DIFFICULTY_SCALE, type BlueprintCell } from './types'
import { newUsage, closeUsage, withUsage, withCallContext, LlmError, LlmStopped, MODEL_TIERS } from '../llm'
import { buildGroundingPacket, type GroundingPacket, type SourcePack } from './groundingPacket'
import { selectPack } from './sourcePacks'
import { PROMPT_VERSIONS } from './promptVersions'

/**
 * Candidate production. A batch is a durable request created in ONE database command (batch + every cell, or nothing). Its cells are
 * claimed one at a time under a lease AND a fencing token: only the current claim may extend, store or fail a cell, so a worker that
 * lost its lease can no longer write. Deadlines and cancellation reach the provider request itself; every request is reserved against
 * the batch budget before it is sent. Nothing here can set an item beyond "automatically checked"; human review is a separate command.
 */
export type BatchCell = BlueprintCell & { outcomeId: string; readingId: string; packet?: GroundingPacket; blocked?: string[]; blockedDetail?: string }
export type BatchBudget = { maxRequests: number; maxTokens: number; wallSeconds: number }

const uuidFrom = (seed: string) => {
  const h = createHash('sha256').update(seed).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}
const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

export const promptVersion = (generatorSource: string, verifierSource: string) =>
  `gen-${createHash('sha256').update(generatorSource).digest('hex').slice(0, 8)}/ver-${createHash('sha256').update(verifierSource).digest('hex').slice(0, 8)}`

export type CreateBatchInput = {
  label: string
  requestKey: string
  perTopic: number
  seed: number
  promptVersion: string
  rights: { status: 'unconfirmed' | 'cleared'; ref?: string }
  inputsNote: string
  topics?: string[]
  /** Restrict to these canonical reading ids (a targeted pilot); omitted = every reading of the chosen topics. */
  readings?: string[]
  packs: SourcePack[]
  budget?: BatchBudget
  maxAttempts?: number
  parentBatchId?: string
}
export type CreateBatchResult =
  | { ok: true; batchId: string; created: boolean; cells: number; blocked: number }
  | { ok: false; code: 'KEY_CONFLICT' | 'INCOMPLETE_BATCH' | 'RIGHTS_AUTHORITY_REQUIRED' | 'RIGHTS_NOT_SUPPORTED' | 'NEEDS_PREPARATION' | 'BAD_INPUT' | 'NO_CELLS'; message: string; batchId?: string; unprepared?: string[] }

/** Spread `n` outcomes of a topic across its readings, round-robin, so one long reading does not take the batch. */
export function sampleOutcomes<T extends { readingId: string; id: string }>(outcomes: T[], n: number): T[] {
  const by = new Map<string, T[]>()
  for (const o of outcomes) by.set(o.readingId, [...(by.get(o.readingId) ?? []), o])
  const queues = [...by.values()]
  const picked: T[] = []
  for (let round = 0; picked.length < n && queues.some(q => q.length > round); round++) {
    for (const q of queues) if (q[round] && picked.length < n) picked.push(q[round])
  }
  return picked
}

/** CLI-level validation, before any write. */
export function validateCreateInput(i: CreateBatchInput): string | null {
  if (!i.requestKey?.trim()) return 'A request key is required.'
  if (!Number.isInteger(i.perTopic) || i.perTopic < 1 || i.perTopic > 50) return 'per-topic must be a whole number from 1 to 50.'
  if (!Number.isInteger(i.seed)) return 'seed must be a whole number.'
  if (i.rights.status === 'cleared' && !i.rights.ref?.trim()) return 'Rights "cleared" needs a recorded authority (who or what authorised the input use). A flag alone is not provenance.'
  if (i.budget && (![i.budget.maxRequests, i.budget.maxTokens, i.budget.wallSeconds].every(n => Number.isInteger(n) && n > 0))) return 'budget values must be positive whole numbers.'
  if (i.maxAttempts !== undefined && !(Number.isInteger(i.maxAttempts) && i.maxAttempts >= 1 && i.maxAttempts <= 5)) return 'max attempts must be 1 to 5.'
  return null
}

/** A batch may claim "cleared" only if EVERY pack it actually uses records cleared rights, an authority and a permitted use. A command-line string never overrides a pack. */
export function rightsClaimProblem(rights: CreateBatchInput['rights'], cells: BatchCell[]): string | null {
  if (rights.status !== 'cleared') return null
  const used = cells.flatMap(c => (c.packet ? [c.packet.pack] : []))
  if (!used.length) return 'Rights cannot be "cleared": no cell has a source pack.'
  const bad = [...new Set(used.filter(p => p.rights.state !== 'cleared' || !p.rights.authority?.trim() || p.rights.permittedUse === 'none').map(p => p.packId))]
  return bad.length ? `Rights cannot be "cleared": pack(s) ${bad.join(', ')} do not record cleared rights with an authority and a permitted use. The pack decides, not a command-line value.` : null
}

type Planned = { cells: BatchCell[]; unprepared: string[]; manifest: { id: string; year: number; version: string } }

/** Reads the active edition and plans cells WITHOUT writing anything. Concepts are read per manifest, never globally. */
export async function planBatch(input: CreateBatchInput): Promise<Planned> {
  const admin = createAdminClient()
  const { data: manifest } = await admin.from('curriculum_manifests').select('id, year, version').eq('is_active', true).single()
  if (!manifest) throw new Error('No active curriculum manifest')
  const [topics, readings, los, concepts] = await Promise.all([
    admin.from('topics').select('id, name').order('id').then(r => { if (r.error) throw new Error(r.error.message); return r.data ?? [] }),
    admin.from('curriculum_readings').select('id, topic_id, reading_no').eq('is_active', true).then(r => { if (r.error) throw new Error(r.error.message); return r.data ?? [] }),
    readAll<{ id: string; reading_id: string; code: string; title: string; sequence: number }>((a, z) => admin.from('reading_los').select('id, reading_id, code, title, sequence').order('id').range(a, z)),
    readAll<{ id: string; verification_status: string; manifest_id: string; scope_notes: string | null; excluded_or_superseded: string | null }>((a, z) => admin.from('curriculum_concepts').select('id, verification_status, manifest_id, scope_notes, excluded_or_superseded').eq('manifest_id', manifest.id).order('id').range(a, z)),
  ])
  const inManifest = new Set(concepts.map(c => c.id))
  const maps = (await readAll<{ concept_id: string; outcome_id: string; approximate: boolean }>((a, z) => admin.from('concept_outcome_map').select('concept_id, outcome_id, approximate').order('concept_id').range(a, z))).filter(m => inManifest.has(m.concept_id))
  const conceptOf = new Map(maps.map(m => [m.outcome_id, m]))
  const conceptRow = new Map(concepts.map(c => [c.id, c]))
  const readingOf = new Map(readings.map(r => [r.id as string, r]))
  const unprepared: string[] = []
  const cells: BatchCell[] = []
  for (const [ti, t] of topics.entries()) {
    if (input.topics && !input.topics.includes(t.id as string)) continue
    const topicOutcomes = los.filter(l => readingOf.get(l.reading_id)?.topic_id === t.id && (!input.readings || input.readings.includes(l.reading_id)))
      .sort((a, b) => a.reading_id.localeCompare(b.reading_id) || a.sequence - b.sequence)
      .map(l => ({ ...l, readingId: l.reading_id }))
    const chosen = sampleOutcomes(topicOutcomes, input.perTopic)
    const slices: ConceptSlice[] = [], byConcept = new Map<string, (typeof chosen)[number]>()
    for (const o of chosen) {
      const m = conceptOf.get(o.id)
      if (!m) { unprepared.push(o.id); continue }
      const c = conceptRow.get(m.concept_id)!
      byConcept.set(m.concept_id, o)
      slices.push({ id: m.concept_id, name: o.title, topic: t.name as string, module: `${t.id}-${o.readingId}`,
        scopeNotes: [c.scope_notes ?? o.title, c.excluded_or_superseded ? `EXCLUDED FROM SCOPE: ${c.excluded_or_superseded}` : ''].filter(Boolean).join(' '), importance: 'core' })
    }
    if (!slices.length) continue
    const plan = buildBlueprint(slices, Math.min(input.perTopic, slices.length), input.seed + ti)
    for (const cell of plan.cells) {
      const o = byConcept.get(cell.conceptId)!, m = conceptOf.get(o.id)!, c = conceptRow.get(cell.conceptId)!
      const { packet, blockers } = buildGroundingPacket({ manifest: manifest as Planned['manifest'], concept: c, mapping: m,
        pack: selectPack(input.packs, o.id, cell.conceptId),
        cell: { outcomeId: o.id, readingId: o.readingId, conceptId: cell.conceptId, conceptName: cell.conceptName, cognition: cell.cognition, itemForm: cell.itemForm, difficulty: cell.difficulty } })
      const hard = blockers.filter(b => b.blocking)
      cells.push({ ...cell, outcomeId: o.id, readingId: o.readingId, ...(packet ? { packet } : {}), ...(hard.length ? { blocked: hard.map(b => b.code), blockedDetail: hard.map(b => b.detail).join(' ') } : {}) })
    }
  }
  // Interleave topics so a batch stopped early still has breadth, instead of finishing one topic before starting the next.
  const byTopic = new Map<string, BatchCell[]>()
  for (const c of cells) byTopic.set(c.topic, [...(byTopic.get(c.topic) ?? []), c])
  const queues = [...byTopic.values()]
  const ordered: BatchCell[] = []
  for (let round = 0; queues.some(q => q.length > round); round++) for (const q of queues) if (q[round]) ordered.push(q[round])
  return { cells: ordered, unprepared, manifest: manifest as Planned['manifest'] }
}

/** Everything that defines the request. Same key + same hash = the same batch; same key + different hash is a conflict. */
export const configHash = (input: CreateBatchInput, p: Planned) => sha({
  manifest: p.manifest.id, topics: input.topics ?? null, readings: input.readings ?? null, perTopic: input.perTopic, seed: input.seed, promptVersion: input.promptVersion, prompts: PROMPT_VERSIONS,
  rights: input.rights, budget: input.budget ?? null, maxAttempts: input.maxAttempts ?? 2,
  cells: p.cells.map(c => [c.conceptId, c.outcomeId, c.cognition, c.itemForm, c.difficulty, c.packet?.hash ?? `blocked:${(c.blocked ?? []).join(',')}`]),
})

/** One atomic command. A failure leaves no batch, no cells and no concept changes (mapping preparation is a separate, explicit operation). */
export async function createBatch(input: CreateBatchInput): Promise<CreateBatchResult> {
  const bad = validateCreateInput(input)
  if (bad) return { ok: false, code: bad.startsWith('Rights') ? 'RIGHTS_AUTHORITY_REQUIRED' : 'BAD_INPUT', message: bad }
  const planned = await planBatch(input)
  const unsupported = rightsClaimProblem(input.rights, planned.cells)
  if (unsupported) return { ok: false, code: 'RIGHTS_NOT_SUPPORTED', message: unsupported }
  if (planned.unprepared.length) return { ok: false, code: 'NEEDS_PREPARATION', unprepared: planned.unprepared, message: `${planned.unprepared.length} chosen outcome(s) have no concept in this edition. Run "prepare" first (it creates unsigned, approximate stubs).` }
  if (!planned.cells.length) return { ok: false, code: 'NO_CELLS', message: 'No cells could be planned.' }
  const hash = configHash(input, planned)
  const r = await createAdminClient().rpc('create_item_batch', {
    p_request_key: input.requestKey, p_config_hash: hash, p_cells: planned.cells,
    p_batch: { label: input.label, manifest_id: planned.manifest.id, curriculum_version: `${planned.manifest.year} ${planned.manifest.version}`,
      source_provenance: { inputs: input.inputsNote, packs: [...new Set(planned.cells.flatMap(c => c.packet ? [c.packet.pack.packId + '@' + c.packet.pack.version] : []))], topics: input.topics ?? 'all', perTopic: input.perTopic, seed: input.seed },
      rights_status: input.rights.status, rights_ref: input.rights.ref ?? null, prompt_version: input.promptVersion, model_versions: MODEL_TIERS, max_attempts: input.maxAttempts ?? 2,
      budget: input.budget ?? null, parent_batch_id: input.parentBatchId ?? null,
      config: { perTopic: input.perTopic, seed: input.seed, topics: input.topics ?? null, prompts: PROMPT_VERSIONS, models: MODEL_TIERS, budget: input.budget ?? null, maxAttempts: input.maxAttempts ?? 2, configHash: hash } },
  })
  if (r.error) throw new Error(`batch: ${r.error.message}`)
  const d = r.data as { ok: boolean; code?: string; batchId?: string; created?: boolean; cells?: number }
  if (!d.ok) return { ok: false, code: d.code as any, batchId: d.batchId, message: d.code === 'KEY_CONFLICT' ? 'This request key already names a batch with different scope, sources or configuration. Use a new key (and --parent to link a deliberate regeneration).' : `The batch could not be created (${d.code}).` }
  return { ok: true, batchId: d.batchId!, created: Boolean(d.created), cells: d.cells ?? planned.cells.length, blocked: planned.cells.filter(c => c.blocked?.length).length }
}

/** Explicit, atomic mapping preparation for the outcomes a plan could not map. Stubs are unsigned and approximate; never exact, never verified. */
export async function prepareMappings(input: Pick<CreateBatchInput, 'topics' | 'perTopic' | 'seed' | 'packs' | 'requestKey' | 'label' | 'promptVersion' | 'rights' | 'inputsNote'>): Promise<{ created: number; existing: number }> {
  const planned = await planBatch(input as CreateBatchInput)
  if (!planned.unprepared.length) return { created: 0, existing: 0 }
  const admin = createAdminClient()
  const los = await readAll<{ id: string; reading_id: string; code: string; title: string }>((a, z) => admin.from('reading_los').select('id, reading_id, code, title').in('id', planned.unprepared).order('id').range(a, z))
  const readings = await readAll<{ id: string; topic_id: string; reading_no: number }>((a, z) => admin.from('curriculum_readings').select('id, topic_id, reading_no').order('id').range(a, z))
  const topics = await readAll<{ id: string; name: string }>((a, z) => admin.from('topics').select('id, name').order('id').range(a, z))
  const rd = new Map(readings.map(r => [r.id, r])), tn = new Map(topics.map(t => [t.id, t.name]))
  const stubs = los.map(o => { const r = rd.get(o.reading_id)!; return { concept_id: uuidFrom(`concept:${planned.manifest.id}:${o.id}`), outcome_id: o.id, topic: tn.get(r.topic_id), reading: `Reading ${r.reading_no}`,
    module: `${r.topic_id}-${o.reading_id}`, los: `LOS ${o.code}`, name: o.title, lm_id: o.reading_id, scope_notes: o.title } })
  const res = await admin.rpc('prepare_concept_stubs', { p_manifest: planned.manifest.id, p_stubs: stubs })
  if (res.error || !(res.data as any)?.ok) throw new Error(`prepare: ${res.error?.message ?? JSON.stringify(res.data)}`)
  return { created: (res.data as any).created, existing: (res.data as any).existing }
}

export const failureCode = (e: unknown, deadlineFired: boolean): string => {
  if (e instanceof LlmStopped) return e.reason === 'budget' ? 'BUDGET_EXHAUSTED' : e.reason === 'stage' ? 'STAGE_TIMEOUT' : deadlineFired ? 'GEN_TIMEOUT' : 'CANCELLED'
  if (e instanceof DraftShapeError) return /declined/.test(e.message) ? 'GEN_DECLINED' : 'MALFORMED_OUTPUT'
  if (e instanceof LlmError) return /timed out|timeout/i.test(e.message) ? 'TRANSPORT_TIMEOUT' : /no parseable JSON|empty response|ran out of tokens/i.test(e.message) ? 'EMPTY_OR_MALFORMED_RESPONSE' : 'PROVIDER_ERROR'
  return 'INTERNAL_ERROR'
}

const GRACE_MS = 5_000
/** Waits for the work, but never longer than the abort plus a short grace: a stage that ignores cancellation cannot hold a worker. */
function settleOrGiveUp<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => {})
  return new Promise<T>((resolve, reject) => {
    work.then(resolve, reject)
    const giveUp = () => setTimeout(() => reject(new LlmStopped('aborted', 'the stage did not stop after cancellation; its late output is ignored')), GRACE_MS).unref?.()
    if (signal.aborted) giveUp(); else signal.addEventListener('abort', giveUp, { once: true })
  })
}

export type RunOptions = { workers?: number; deadlineMs?: number; log?: (m: string) => void; stopAfterConfigFailures?: number }

/** A batch runs only the prompt package and model policy it was created under; otherwise nothing is spent and a new linked batch is the answer. */
/** jsonb does not keep key order, so equality is compared on sorted keys. */
const canon = (v: unknown): string => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
export function packageMismatch(recorded: { prompts?: unknown; models?: unknown } | null | undefined): string | null {
  if (!recorded?.prompts || !recorded?.models) return 'This batch did not record its prompt package and model policy, so it cannot be resumed safely. Create a new batch (with --parent to link it).'
  if (canon(recorded.prompts) !== canon(PROMPT_VERSIONS)) return 'This batch was created under a different prompt package than the one now installed. Nothing was spent. Create a new batch with --parent to link a deliberate regeneration.'
  if (canon(recorded.models) !== canon(MODEL_TIERS)) return 'This batch was created under a different model policy than the one now configured. Nothing was spent. Create a new batch with --parent to link a deliberate regeneration.'
  return null
}

/** Processes cells until none can be claimed. Safe to run twice at once and safe to stop at any point. */
export async function runBatch(batchId: string, opts: RunOptions = {}): Promise<void> {
  const admin = createAdminClient()
  const log = opts.log ?? (() => {})
  const { data: rec } = await admin.from('item_batches').select('config').eq('id', batchId).single()
  const mismatch = packageMismatch(rec?.config as any)
  if (mismatch) throw new Error(mismatch)
  const fingerprints = new Set<string>(((await readAll<{ id: string; semantic_fingerprint: string | null }>((a, z) => admin.from('assessment_items').select('id, semantic_fingerprint').not('semantic_fingerprint', 'is', null).order('id').range(a, z))).map(r => r.semantic_fingerprint as string)))
  const deadline = opts.deadlineMs ?? 240_000
  const stopAfter = opts.stopAfterConfigFailures ?? 3
  let configFailures = 0

  const worker = async () => {
    for (;;) {
      const { data: claimed, error } = await admin.rpc('claim_batch_cell', { p_batch: batchId, p_lease_seconds: Math.ceil(deadline / 1000) + 60 })
      if (error) throw new Error(`claim: ${error.message}`)
      if (!claimed) return
      const c = claimed as { ordinal: number; cell: BatchCell; attempts: number; claimToken: string }
      const claim = c.claimToken
      const ac = new AbortController(); let deadlineFired = false
      const timer = setTimeout(() => { deadlineFired = true; ac.abort() }, deadline)
      const beat = setInterval(async () => {
        const r = await admin.rpc('extend_batch_cell', { p_batch: batchId, p_ordinal: c.ordinal, p_claim: claim, p_seconds: Math.ceil(deadline / 1000) + 60 })
        if (!r.error && (r.data as any)?.ok === false) ac.abort()   // the claim is no longer ours (cancelled or reclaimed): stop at once
      }, Math.max(5_000, Math.floor(deadline / 3)))
      const t0 = Date.now()
      const usage = newUsage()   // owned here, so what the provider already reported survives a later failure
      const reserve = async (requests: number, maxTokens: number) => {
        const r = await admin.rpc('reserve_batch_budget', { p_batch: batchId, p_claim: claim, p_requests: requests, p_tokens: maxTokens })
        const d = r.data as { ok: boolean; code?: string } | null
        if (r.error || !d?.ok) { ac.abort(); throw new LlmStopped(d?.code === 'BUDGET' ? 'budget' : 'aborted', d?.code ?? r.error?.message ?? 'reservation failed') }
      }
      try {
        if (c.cell.blocked?.length) throw new DraftShapeError(`blocked: ${c.cell.blocked.join(',')}`)   // defensive: blocked cells are never claimable
        const result = await withUsage(usage, () => settleOrGiveUp(withCallContext({ signal: ac.signal, reserve }, async () => {
          const draft = await generateItemDraft(c.cell, c.cell.packet)
          const fingerprint = semanticFingerprint(draft.stem, draft.options)
          const verdict = await verifyItem(draft, c.cell, { existingFingerprints: fingerprints, fingerprint })
          return { draft, fingerprint, verdict }
        }), ac.signal))
        if (ac.signal.aborted) throw new LlmStopped('aborted', 'finished after cancellation or its deadline; the output is ignored')
        const { draft, fingerprint, verdict } = result
        const ms = Date.now() - t0
        if (verdict.status === 'PASS' || verdict.status === 'HUMAN_REVIEW') {
          const r = await admin.rpc('store_batch_cell', {
            p_batch: batchId, p_ordinal: c.ordinal, p_claim: claim,
            p_item: { lm_id: c.cell.readingId, learning_objective: c.cell.conceptName, verification_intent: `${c.cell.cognition} · ${c.cell.itemForm} · ${c.cell.difficulty}`,
              difficulty: DIFFICULTY_SCALE[c.cell.difficulty], stem: draft.stem, options: draft.options, per_option_feedback: draft.perOptionFeedback, concept_id: c.cell.conceptId,
              cognition: c.cell.cognition, item_form: c.cell.itemForm, intended_difficulty: c.cell.difficulty, key_index: draft.keyIndex,
              item_card: { ...draft.card, packetHash: c.cell.packet?.hash ?? null, packId: c.cell.packet?.pack.packId ?? null, packVersion: c.cell.packet?.pack.version ?? null, packEdition: c.cell.packet?.pack.edition ?? null,
                packSource: c.cell.packet ? { name: c.cell.packet.pack.source.name, location: c.cell.packet.pack.source.location, hash: c.cell.packet.pack.source.hash ?? null } : null, package: PROMPT_VERSIONS },
              semantic_fingerprint: fingerprint, generator_model: draft.generatorModel, outcome_id: c.cell.outcomeId },
            p_gates: verdict.gates, p_verdict: verdict.status, p_reason: verdict.reason, p_model: verdict.verifierModel,
            p_extra: { defectCodes: verdict.defectCodes, independentAnswerIndex: verdict.independentAnswerIndex ?? null, derivation: verdict.derivation ?? null },
            p_generate_ms: ms, p_usage: usage,
          })
          const d = r.data as { ok: boolean; code?: string; itemId?: string } | null
          if (r.error) throw new Error(`store: ${r.error.message}`)
          if (!d?.ok) log(`cell ${c.ordinal} not stored: ${d?.code}`)   // STALE_CLAIM / CANCELLED / DUPLICATE_OUTPUT are decided in the database and recorded there
          else { fingerprints.add(fingerprint); log(`cell ${c.ordinal} ${verdict.status} ${d.itemId} (${Math.round(ms / 1000)}s)`) }
        } else {
          await admin.rpc('fail_batch_cell', { p_batch: batchId, p_ordinal: c.ordinal, p_claim: claim, p_reason: verdict.reason, p_codes: verdict.defectCodes, p_verdict: verdict.status, p_usage: usage, p_ms: ms,
            p_reject: { concept_id: c.cell.conceptId, blueprint_cell: c.cell, draft, verifier_status: verdict.status, generator_model: draft.generatorModel, verifier_model: verdict.verifierModel, stage: 'verification' } })
          log(`cell ${c.ordinal} ${verdict.status}: ${verdict.reason.slice(0, 120)}`)
        }
        configFailures = 0
      } catch (e: any) {
        const code = failureCode(e, deadlineFired)
        const last = usage.attempts[usage.attempts.length - 1]
        // A whole-cell deadline names the stage that was running, so it is not read as proof about the authoring model alone.
        const where = code === 'GEN_TIMEOUT' && last ? ` (cell deadline reached during stage "${last.stage}" with model ${last.model}; ${usage.attempts.length} attempt(s) recorded)` : ''
        const note = e instanceof LlmStopped && code !== 'BUDGET_EXHAUSTED' ? ' A provider call may still have been billed; any late output was discarded.' : ''
        await admin.rpc('fail_batch_cell', { p_batch: batchId, p_ordinal: c.ordinal, p_claim: claim, p_reason: `${String(e?.message ?? e)}${where}${note}`, p_codes: [code], p_verdict: code, p_usage: closeUsage(usage), p_ms: Date.now() - t0 })
        log(`cell ${c.ordinal} ${code}: ${String(e?.message ?? e).slice(0, 120)}`)
        if (code === 'EMPTY_OR_MALFORMED_RESPONSE' || code === 'PROVIDER_ERROR') {
          if (++configFailures >= stopAfter) { await admin.rpc('cancel_item_batch', { p_batch: batchId, p_reason: `Stopped early: ${configFailures} consecutive ${code} failures (likely configuration, not content).` }); log('batch stopped early'); return }
        } else configFailures = 0
      } finally { clearTimeout(timer); clearInterval(beat) }
    }
  }
  await Promise.all(Array.from({ length: opts.workers ?? 2 }, worker))
}
