import { createHash } from 'node:crypto'
import { createAdminClient } from '../supabase/admin'
import { getPaperManifestId } from '../planning/pulse/paper'
import { seededRandom } from './difficultyPolicy'
import { loadEligibleItemPool, type PoolItem } from './itemPool'

/**
 * Phase 3 item-by-item adaptive practice (`adaptive-item.1`).
 * Practice only: never writes `evidence_events`, never closes `repair_threads`, and never earns weekly paper credit.
 * Leaves 5-question-set `adaptivePractice.ts`, timed practice, formal papers, re-checks, and mocks untouched.
 */
export const ADAPTIVE_ITEM_POLICY = 'adaptive-item.1' as const

export type AdaptiveTier = 'foundation' | 'standard' | 'difficult'
export type AdaptiveOutcome = 'correct' | 'incorrect' | 'omitted' | 'disputed' | 'void'

export const TIER_LABEL: Record<AdaptiveTier, 'Easy' | 'Medium' | 'Hard'> = {
  foundation: 'Easy',
  standard: 'Medium',
  difficult: 'Hard',
}

const TIERS: AdaptiveTier[] = ['foundation', 'standard', 'difficult']

export function stepAdaptiveTier(current: AdaptiveTier, outcome: AdaptiveOutcome): AdaptiveTier {
  if (outcome === 'correct') return TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(current) + 1)]
  if (outcome === 'incorrect') return TIERS[Math.max(0, TIERS.indexOf(current) - 1)]
  return current
}

export function recomputeTierFromSteps(
  steps: { committed_outcome: AdaptiveOutcome | null; invalidated: boolean }[]
): AdaptiveTier {
  let tier: AdaptiveTier = 'foundation'
  for (const s of steps) {
    if (!s.invalidated && s.committed_outcome) tier = stepAdaptiveTier(tier, s.committed_outcome)
  }
  return tier
}

/**
 * Pure deterministic selector: computes from pre-filtered eligible routine pool (`student_eligible_items` + `item_confirmed_difficulty`).
 * Excludes unconfirmed tiers (`level === null`), `stretch`, foreign outcomes, and families already used in the run.
 */
export function selectAdaptiveItem(
  pool: PoolItem[],
  opts: { readingId: string; outcomeIds?: string[]; targetTier: AdaptiveTier; usedFamilyIds: Set<string>; usedItemIds: Set<string>; seed: string }
): PoolItem | null {
  const allowedOutcomes = opts.outcomeIds?.length ? new Set(opts.outcomeIds) : null
  const eligible = pool.filter(
    i =>
      i.lm_id === opts.readingId &&
      i.level === opts.targetTier &&
      i.family_id != null &&
      !opts.usedFamilyIds.has(i.family_id) &&
      !opts.usedItemIds.has(i.id) &&
      (!allowedOutcomes || (i.outcome_id !== null && allowedOutcomes.has(i.outcome_id)))
  )
  if (!eligible.length) return null
  const sorted = [...eligible].sort((a, b) => a.id.localeCompare(b.id))
  const rnd = seededRandom(opts.seed)
  return sorted[Math.floor(rnd() * sorted.length)] ?? sorted[0]
}

export type AdaptiveItemInput = { readingId: string; outcomeIds?: string[] }

export type AdaptiveItemPreview = {
  state: 'start' | 'shortage' | 'no_bank' | 'no_scope' | 'unavailable'
  message: string | null
  readingName: string
  startingTier: AdaptiveTier
  startingLabel: 'Easy' | 'Medium' | 'Hard'
  deliverableEasy: number
  policyVersion: typeof ADAPTIVE_ITEM_POLICY
  statement: string
}

const STATEMENT =
  'Item-by-item adaptive practice starts at Easy, adjusts one tier after each committed answer, and never counts toward formal evidence or repair closure.'

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** Read-only preview: checks manifest, reading scope, and Easy routine availability. */
export async function previewAdaptiveItem(userId: string, input: AdaptiveItemInput): Promise<AdaptiveItemPreview> {
  const base: AdaptiveItemPreview = {
    state: 'unavailable',
    message: null,
    readingName: '',
    startingTier: 'foundation',
    startingLabel: 'Easy',
    deliverableEasy: 0,
    policyVersion: ADAPTIVE_ITEM_POLICY,
    statement: STATEMENT,
  }
  try {
    const manifestId = await getPaperManifestId()
    if (!manifestId) return { ...base, state: 'no_bank', message: 'No question bank is active yet.' }
    const admin = createAdminClient()
    const { data: reading } = await admin.from('curriculum_readings').select('id, title').eq('id', input.readingId).eq('is_active', true).maybeSingle().throwOnError()
    if (!reading) return { ...base, state: 'no_scope', message: 'Reading not found.' }
    const pool = await loadEligibleItemPool(userId, [input.readingId])
    const outs = [...new Set(input.outcomeIds ?? [])].sort()
    const easyCount = new Set(pool.filter(
      i => i.level === 'foundation' && i.family_id != null && (!outs.length || (i.outcome_id !== null && outs.includes(i.outcome_id)))
    ).map(i => i.family_id)).size
    if (easyCount === 0) {
      return {
        ...base,
        state: 'shortage',
        readingName: reading.title as string,
        deliverableEasy: 0,
        message: 'No fresh Easy human-reviewed questions with confirmed difficulty are available for this scope.',
      }
    }
    return {
      ...base,
      state: 'start',
      readingName: reading.title as string,
      deliverableEasy: easyCount,
    }
  } catch (e) {
    console.error('[adaptive-item preflight]', (e as Error).message)
    return { ...base, state: 'unavailable', message: 'Could not check question availability right now. Try again.' }
  }
}

export async function startAdaptiveItem(userId: string, input: AdaptiveItemInput, requestKey: string) {
  const outs = [...new Set(input.outcomeIds ?? [])].sort()
  const payloadHash = sha({ readingId: input.readingId, outcomeIds: outs, policy: ADAPTIVE_ITEM_POLICY })
  const admin = createAdminClient()
  const { data: receipt, error: receiptError } = await admin.from('adaptive_item_receipts').select('payload_hash, result')
    .eq('user_id', userId).eq('request_key', requestKey).maybeSingle()
  if (receiptError) return { ok: false as const, code: 'failed', message: 'Could not confirm the start request. Try the same request again.' }
  if (receipt) {
    if (receipt.payload_hash !== payloadHash) return { ok: false as const, code: 'key_conflict', message: 'Request key conflict. Reload and try again.' }
    return { ...(receipt.result as any), replay: true }
  }
  const manifestId = await getPaperManifestId()
  if (!manifestId) return { ok: false as const, code: 'no_bank', message: 'No question bank is active yet.' }

  let pool: PoolItem[]
  try {
    pool = await loadEligibleItemPool(userId, [input.readingId])
  } catch (e) {
    console.error('[adaptive-item start pool]', (e as Error).message)
    return { ok: false as const, code: 'failed', message: 'Could not read available questions. Nothing was started; try again.' }
  }

  const first = selectAdaptiveItem(pool, {
    readingId: input.readingId,
    outcomeIds: outs,
    targetTier: 'foundation',
    usedFamilyIds: new Set(),
    usedItemIds: new Set(),
    seed: `${userId}:adaptive-item:${input.readingId}:${outs.join(',')}:1`,
  })

  const { data, error } = await admin.rpc('adaptive_item_start', {
    p_user: userId,
    p_request_key: requestKey,
    p_payload_hash: payloadHash,
    p_manifest_id: manifestId,
    p_reading_id: input.readingId,
    p_outcome_ids: outs,
    p_item_id: first?.id ?? null,
    p_item_version: first?.item_version ?? null,
    p_family_id: first?.family_id ?? null,
    p_shortage_reason: first ? null : 'No eligible Easy routine item available for this scope.',
  })
  if (error) {
    console.error('[adaptive_item_start]', error.message)
    return { ok: false as const, code: 'failed', message: 'Could not start adaptive practice.' }
  }
  const r = data as any
  if (!r?.ok) return { ok: false as const, code: String(r?.code ?? 'failed').toLowerCase(), message: r?.code === 'KEY_CONFLICT' ? 'Request key conflict. Reload and try again.' : 'Could not start adaptive practice.' }
  return { ok: true as const, ...r }
}

export type AdaptiveStepView = {
  seq: number
  itemId: string
  itemVersion: number
  tier: AdaptiveTier
  tierLabel: 'Easy' | 'Medium' | 'Hard'
  stem: string
  options: string[]
  committedOutcome: AdaptiveOutcome | null
  selectedOptionIndex: number | null
  invalidated: boolean
  /** Revealed ONLY after `committedOutcome` is non-null. */
  keyIndex?: number
  perOptionFeedback?: Record<string, string>
  solution?: string
}

export async function loadAdaptiveItemRun(userId: string, runId: string) {
  const admin = createAdminClient()
  const { data: run, error: e1 } = await admin
    .from('adaptive_item_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId)
    .maybeSingle()
  if (e1) throw new Error(e1.message)
  if (!run) return null

  const { data: steps, error: e2 } = await admin
    .from('adaptive_item_steps')
    .select('*')
    .eq('run_id', runId)
    .order('seq', { ascending: true })
  if (e2) throw new Error(e2.message)

  const itemIds = (steps ?? []).filter(s => s.stem === null).map(s => s.item_id as string)
  const { data: items } = itemIds.length
    ? await admin.from('assessment_items').select('id, item_version, stem, options, key_index, per_option_feedback, item_card').in('id', itemIds).throwOnError()
    : { data: [] as any[] }
  const byId = new Map((items ?? []).map(i => [i.id as string, i] as const))

  const { data: reading } = await admin.from('curriculum_readings').select('title').eq('id', run.reading_id).maybeSingle()

  const stepViews: AdaptiveStepView[] = (steps ?? []).map((s: any) => {
    const legacy = s.stem === null ? byId.get(s.item_id) : undefined
    const it = legacy?.item_version === s.item_version ? legacy : undefined
    const committed = s.committed_outcome as AdaptiveOutcome | null
    const base: AdaptiveStepView = {
      seq: s.seq as number,
      itemId: s.item_id as string,
      itemVersion: s.item_version as number,
      tier: s.tier as AdaptiveTier,
      tierLabel: TIER_LABEL[s.tier as AdaptiveTier],
      stem: (s.stem as string | null) ?? it?.stem ?? '',
      options: Array.isArray(s.options) ? s.options : Array.isArray(it?.options) ? it.options : [],
      committedOutcome: committed,
      selectedOptionIndex: s.selected_option_index ?? null,
      invalidated: Boolean(s.invalidated),
    }
    if (committed !== null) {
      base.keyIndex = (s.key_index as number | null) ?? (it?.key_index as number | undefined)
      base.perOptionFeedback = ((s.per_option_feedback as Record<string, string> | null) ?? it?.per_option_feedback ?? {}) as Record<string, string>
      base.solution = (s.solution as string | null) ?? (it?.item_card as any)?.solution ?? undefined
    }
    return base
  })

  const activeStep = stepViews.find(s => s.committedOutcome === null) ?? null
  return {
    id: run.id as string,
    readingId: run.reading_id as string,
    readingName: (reading?.title as string) ?? run.reading_id,
    outcomeIds: (run.outcome_ids ?? []) as string[],
    policyVersion: run.policy_version as string,
    status: run.status as 'active' | 'finished_shortage' | 'completed' | 'stopped',
    targetTier: run.target_tier as AdaptiveTier,
    targetLabel: TIER_LABEL[run.target_tier as AdaptiveTier],
    shortageTier: (run.shortage_tier as AdaptiveTier | null) ?? null,
    shortageReason: (run.shortage_reason as string | null) ?? null,
    revision: run.revision as number,
    steps: stepViews,
    activeStep,
  }
}

export async function commitAdaptiveItemAnswer(
  userId: string,
  runId: string,
  input: { seq: number; selectedOptionIndex: number | null; omitted?: boolean; requestKey: string }
) {
  const admin = createAdminClient()
  const { data: run, error: runError } = await admin.from('adaptive_item_runs').select('*').eq('id', runId).eq('user_id', userId).maybeSingle()
  if (runError) return { ok: false as const, code: 'failed', message: 'Could not load this practice run. Try again.' }
  if (!run) return { ok: false as const, code: 'not_found', message: 'Practice run not found.' }

  const { data: steps, error: stepsError } = await admin.from('adaptive_item_steps').select('*').eq('run_id', runId).order('seq', { ascending: true })
  if (stepsError) return { ok: false as const, code: 'failed', message: 'Could not load the practice questions. Try again.' }
  const targetStep = (steps ?? []).find((s: any) => s.seq === input.seq)
  if (!targetStep) return { ok: false as const, code: 'not_found', message: 'Question step not found.' }

  const payloadHash = sha({ runId, seq: input.seq, selectedOptionIndex: input.selectedOptionIndex, omitted: Boolean(input.omitted) })

  // Check replay before any pool read or state transition
  const { data: existingReceipt, error: receiptError } = await admin
    .from('adaptive_item_receipts')
    .select('payload_hash, result')
    .eq('user_id', userId)
    .eq('request_key', input.requestKey)
    .maybeSingle()
  if (receiptError) return { ok: false as const, code: 'failed', message: 'Could not confirm the submission status. Retry the same answer.' }
  if (existingReceipt) {
    if (existingReceipt.payload_hash !== payloadHash) {
      return { ok: false as const, code: 'key_conflict', message: 'This request key was already used with a different answer.' }
    }
    return { ...(existingReceipt.result as any), replay: true }
  }

  if (run.status !== 'active') return { ok: false as const, code: 'run_closed', message: 'This practice run has ended.' }
  if (targetStep.committed_outcome !== null) return { ok: false as const, code: 'already_scored', message: 'This question has already been committed.' }

  const pinnedKey = targetStep.key_index as number | null
  let keyIndex = pinnedKey
  if (keyIndex === null) {
    const { data: item } = await admin.from('assessment_items').select('key_index').eq('id', targetStep.item_id).eq('item_version', targetStep.item_version).single()
    if (!item) return { ok: false as const, code: 'failed', message: 'Question record missing.' }
    keyIndex = item.key_index as number
  }

  const outcome: AdaptiveOutcome =
    input.omitted || input.selectedOptionIndex === null
      ? 'omitted'
      : input.selectedOptionIndex === keyIndex
        ? 'correct'
        : 'incorrect'

  // Deterministic tier transition BEFORE looking at inventory
  const nextTier = stepAdaptiveTier(run.target_tier as AdaptiveTier, outcome)

  let pool: PoolItem[]
  try {
    pool = await loadEligibleItemPool(userId, [run.reading_id as string])
  } catch (e) {
    console.error('[adaptive-item commit pool]', (e as Error).message)
    return { ok: false as const, code: 'inventory_unavailable', message: 'Could not read remaining questions. Retry your submission.' }
  }

  const usedFamilyIds = new Set((steps ?? []).map((s: any) => s.family_id as string).filter(Boolean))
  const usedItemIds = new Set((steps ?? []).map((s: any) => s.item_id as string))
  const nextItem = selectAdaptiveItem(pool, {
    readingId: run.reading_id as string,
    outcomeIds: (run.outcome_ids ?? []) as string[],
    targetTier: nextTier,
    usedFamilyIds,
    usedItemIds,
    seed: `${userId}:adaptive-item:${runId}:${input.seq + 1}:${nextTier}`,
  })

  const { data: res, error } = await admin.rpc('adaptive_item_commit', {
    p_user: userId,
    p_run_id: runId,
    p_seq: input.seq,
    p_request_key: input.requestKey,
    p_payload_hash: payloadHash,
    p_selected_option_index: outcome === 'omitted' ? null : input.selectedOptionIndex,
    p_outcome: outcome,
    p_next_tier: nextTier,
    p_next_item_id: nextItem?.id ?? null,
    p_next_item_version: nextItem?.item_version ?? null,
    p_next_family_id: nextItem?.family_id ?? null,
    p_shortage_reason: nextItem ? null : `No eligible ${TIER_LABEL[nextTier]} routine item remains for this scope.`,
  })
  if (error) {
    console.error('[adaptive_item_commit]', error.message)
    return { ok: false as const, code: 'failed', message: 'Could not commit answer.' }
  }
  return res as any
}

export async function invalidateAdaptiveItemStep(userId: string, runId: string, seq: number, outcome: 'disputed' | 'void' = 'void') {
  const { data, error } = await createAdminClient().rpc('adaptive_item_invalidate', {
    p_user: userId,
    p_run_id: runId,
    p_seq: seq,
    p_outcome: outcome,
  })
  if (error) return { ok: false as const, code: 'failed', message: 'Could not invalidate step.' }
  return data as any
}

export async function stopAdaptiveItemRun(userId: string, runId: string, expectedRevision: number | null) {
  const { data, error } = await createAdminClient().rpc('adaptive_item_stop', {
    p_user: userId,
    p_run_id: runId,
    p_expected_revision: expectedRevision,
  })
  if (error) return { ok: false as const, code: 'failed', message: 'Could not stop run.' }
  return data as any
}
