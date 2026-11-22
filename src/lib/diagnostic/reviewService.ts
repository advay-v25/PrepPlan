import { nearMatches } from './nearMatch'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { ITEM_STATES, type ItemState } from './itemState'
import { verifyItem } from './verifier'
import { semanticFingerprint } from './generator'
import type { BlueprintCell, GeneratedItemDraft, ItemCard } from './types'

export const PAGE_SIZE = 25

export type QueueFilters = { topic?: string; reading?: string; outcome?: string; state?: string; batch?: string; difficulty?: string; family?: string; page?: number }
export type QueueRow = {
  id: string; version: number; state: ItemState; stem: string; readingId: string; readingLabel: string; topicName: string
  outcomeId: string | null; outcomeTitle: string | null; heldOut: boolean; familyKnown: boolean; familyStatus: 'confirmed' | 'provisional' | 'unknown'; difficulty: string | null; batchLabel: string | null
  legacyReview: boolean; disagreement: boolean; blockers: string[]; supersedes: string | null
}
export type Queue = {
  rows: QueueRow[]; page: number; pageCount: number; total: number
  stateTotals: Record<ItemState, number>; allTotal: number; legacyUnrecorded: number; agreement: { approved: number; decided: number }
  topics: { id: string; name: string }[]; readings: { id: string; label: string; topicId: string }[]; batches: { id: string; label: string }[]
  outcomes: { id: string; label: string }[]
}

async function catalog() {
  const admin = createAdminClient()
  const [topics, readings] = await Promise.all([
    admin.from('topics').select('id, name').order('id').then(r => r.data ?? []),
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title').eq('is_active', true).order('reading_no').then(r => r.data ?? []),
  ])
  return { topics: topics as { id: string; name: string }[], readings: readings as { id: string; topic_id: string; reading_no: number; title: string }[] }
}

/** Queue of items by topic / reading / outcome / state / batch. Totals count the whole filtered set, not the visible page. */
export async function loadQueue(f: QueueFilters): Promise<Queue> {
  const admin = createAdminClient()
  const { topics, readings } = await catalog()
  const topicOf = new Map(topics.map(t => [t.id, t.name]))
  const readingOf = new Map(readings.map(r => [r.id, r]))
  const page = Math.max(1, Math.floor(f.page ?? 1))

  const readingScope = f.reading ? [f.reading] : f.topic ? readings.filter(r => r.topic_id === f.topic).map(r => r.id) : null
  const build = (withState: string | null, head: boolean) => {
    const famJoin = f.family === 'provisional' || f.family === 'confirmed' ? ', fam:item_families!inner(construction_status)' : ''
    let q: any = admin.from('assessment_items').select((head ? 'id' : 'id, item_version, review_status, stem, lm_id, outcome_id, held_out, family_id, batch_id, supersedes_item_id, created_at, intended_difficulty, fam:item_families(construction_status)') + famJoin, head ? { count: 'exact', head: true } : { count: 'exact' })
    if (famJoin) q = q.eq('fam.construction_status', f.family)
    if (f.family === 'unknown') q = q.is('family_id', null)
    if (f.difficulty) q = q.eq('intended_difficulty', f.difficulty)
    if (readingScope) q = q.in('lm_id', readingScope.length ? readingScope : ['__none__'])
    if (f.outcome) q = q.eq('outcome_id', f.outcome)
    if (f.batch === 'none') q = q.is('batch_id', null); else if (f.batch) q = q.eq('batch_id', f.batch)
    if (withState) q = q.eq('review_status', withState)
    return q
  }

  const stateTotals = {} as Record<ItemState, number>
  await Promise.all(ITEM_STATES.map(async s => { stateTotals[s] = (await build(s, true)).count ?? 0 }))
  const allTotal = ITEM_STATES.reduce((n, s) => n + stateTotals[s], 0)

  const state = (ITEM_STATES as readonly string[]).includes(f.state ?? '') ? f.state! : null
  const from = (page - 1) * PAGE_SIZE
  const { data, count } = await build(state, false).order('review_status', { ascending: true }).order('created_at', { ascending: true }).order('id').range(from, from + PAGE_SIZE - 1)
  const total = count ?? 0
  const items = (data ?? []) as any[]

  const ids = items.map(i => i.id as string)
  const outcomeIds = [...new Set(items.map(i => i.outcome_id).filter(Boolean))] as string[]
  const batchIds = [...new Set(items.map(i => i.batch_id).filter(Boolean))] as string[]
  const [outcomeRows, batchRows, validations, approvals, allBatches, allApprovals, reviewedAll, outcomeOptions] = await Promise.all([
    outcomeIds.length ? admin.from('reading_los').select('id, code, title').in('id', outcomeIds).then(r => r.data ?? []) : Promise.resolve([] as any[]),
    batchIds.length ? admin.from('item_batches').select('id, label').in('id', batchIds).then(r => r.data ?? []) : Promise.resolve([] as any[]),
    ids.length ? admin.from('item_validations').select('item_id, status, item_version, reviewer_role').in('item_id', ids).in('reviewer_role', ['editorial_verifier', 'numerical_verifier']).then(r => r.data ?? []) : Promise.resolve([] as any[]),
    ids.length ? admin.from('item_review_decisions').select('item_id').in('item_id', ids).eq('decision', 'approve').then(r => r.data ?? []) : Promise.resolve([] as any[]),
    admin.from('item_batches').select('id, label').order('created_at', { ascending: false }).limit(50).then(r => r.data ?? []),
    readAll<{ item_id: string }>((a, z) => admin.from('item_review_decisions').select('id, item_id').eq('decision', 'approve').order('id').range(a, z)),
    readAll<{ id: string }>((a, z) => admin.from('assessment_items').select('id').eq('review_status', 'reviewed').order('id').range(a, z)),
    readingScope && readingScope.length === 1 ? admin.from('reading_los').select('id, code, title').eq('reading_id', readingScope[0]).order('sequence').then(r => r.data ?? []) : Promise.resolve([] as any[]),
  ])
  const approved = new Set(allApprovals.map(a => a.item_id))
  const decisionRows = await readAll<{ decision: string }>((a, z) => admin.from('item_review_decisions').select('id, decision').in('decision', ['approve', 'reject', 'return']).order('id').range(a, z))
  const agreement = { approved: decisionRows.filter(d => d.decision === 'approve').length, decided: decisionRows.length }
  const legacyUnrecorded = reviewedAll.filter(i => !approved.has(i.id)).length
  const outcomeById = new Map<string, any>(outcomeRows.map((o: any): [string, any] => [o.id, o]))
  const batchById = new Map<string, string>(batchRows.map((b: any): [string, string] => [b.id, b.label as string]))
  const approvedHere = new Set(approvals.map((a: any) => a.item_id))
  const blockerEntries: [string, string[]][] = await Promise.all(items.filter(i => i.review_status === 'verified' || i.review_status === 'draft').map(async (i): Promise<[string, string[]]> => {
    const r = await admin.rpc('item_publish_blockers', { p_item_id: i.id, p_ack: false })
    return [i.id as string, (r.data ?? []) as string[]]
  }))
  const blockers = new Map<string, string[]>(blockerEntries)

  const rows: QueueRow[] = items.map(i => {
    const rd = readingOf.get(i.lm_id)
    const o: any = i.outcome_id ? outcomeById.get(i.outcome_id) : null
    return {
      id: i.id, version: i.item_version, state: i.review_status, stem: i.stem, readingId: i.lm_id,
      readingLabel: rd ? `Reading ${rd.reading_no}: ${rd.title}` : i.lm_id, topicName: rd ? (topicOf.get(rd.topic_id) ?? rd.topic_id) : '—',
      outcomeId: i.outcome_id, outcomeTitle: o ? `${o.code}. ${o.title}` : null, heldOut: i.held_out, familyKnown: Boolean(i.family_id), familyStatus: !i.family_id ? 'unknown' : (i.fam?.construction_status ?? 'confirmed'), difficulty: i.intended_difficulty ?? null,
      batchLabel: i.batch_id ? (batchById.get(i.batch_id) ?? 'batch') : null,
      legacyReview: i.review_status === 'reviewed' && !approvedHere.has(i.id),
      disagreement: validations.some((v: any) => v.item_id === i.id && v.status === 'HUMAN_REVIEW' && (v.item_version ?? 1) === i.item_version),
      blockers: blockers.get(i.id) ?? [], supersedes: i.supersedes_item_id,
    }
  })

  return {
    rows, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), total, stateTotals, allTotal, legacyUnrecorded, agreement,
    topics, readings: readings.map(r => ({ id: r.id, label: `Reading ${r.reading_no}: ${r.title}`, topicId: r.topic_id })),
    batches: allBatches as { id: string; label: string }[],
    outcomes: outcomeOptions.map((o: any) => ({ id: o.id, label: `${o.code}. ${o.title}` })),
  }
}

export type ItemWorkspace = NonNullable<Awaited<ReturnType<typeof loadItemWorkspace>>>

/** Everything a reviewer needs for one item, together: content, key, proof, mapping, checks, history, family. */
export async function loadItemWorkspace(itemId: string) {
  const admin = createAdminClient()
  const { data: item } = await admin.from('assessment_items').select('*').eq('id', itemId).maybeSingle()
  if (!item) return null
  const difficultyHistory = ((await admin.from('item_difficulty_reviews').select('id, item_version, level, rationale, reviewer_id, created_at').eq('item_id', itemId).order('created_at', { ascending: false })).data ?? []) as { id: string; item_version: number; level: string; rationale: string; reviewer_id: string; created_at: string }[]
  const [concept, reading, outcome, validations, decisions, revisions, family, batch, blockers, challenges] = await Promise.all([
    item.concept_id ? admin.from('curriculum_concepts').select('id, name, topic, scope_notes, excluded_or_superseded, verification_status, manifest_id').eq('id', item.concept_id).maybeSingle().then(r => r.data) : null,
    admin.from('curriculum_readings').select('id, reading_no, title, topic_id').eq('id', item.lm_id).maybeSingle().then(r => r.data),
    item.outcome_id ? admin.from('reading_los').select('id, code, title, reading_id').eq('id', item.outcome_id).maybeSingle().then(r => r.data) : null,
    admin.from('item_validations').select('id, reviewer_role, status, defect_codes, detail, item_version, created_at').eq('item_id', itemId).order('created_at').then(r => r.data ?? []),
    admin.from('item_review_decisions').select('id, item_version, decision, note, reviewer_id, acknowledged_disagreement, created_at').eq('item_id', itemId).order('created_at').then(r => r.data ?? []),
    admin.from('item_revisions').select('id, item_version, kind, summary, actor_id, created_at').eq('item_id', itemId).order('created_at').then(r => r.data ?? []),
    item.family_id ? loadFamily(item.family_id as string, itemId) : null,
    item.batch_id ? admin.from('item_batches').select('id, label, rights_status, rights_ref, curriculum_version, prompt_version, source_provenance, model_versions, config_hash, config').eq('id', item.batch_id).maybeSingle().then(r => r.data) : null,
    admin.rpc('item_publish_blockers', { p_item_id: itemId, p_ack: false }).then(r => (r.data ?? []) as string[]),
    admin.from('item_challenges').select('id, status, reason_code, comment, created_at').eq('item_id', itemId).order('created_at', { ascending: false }).then(r => r.data ?? []),
  ])
  // Versions: walk the supersedes chain both ways.
  const chain: { id: string; version: number; state: string }[] = []
  let cur: any = item
  while (cur?.supersedes_item_id) { const { data } = await admin.from('assessment_items').select('id, item_version, review_status, supersedes_item_id').eq('id', cur.supersedes_item_id).maybeSingle(); if (!data) break; chain.unshift({ id: data.id, version: data.item_version, state: data.review_status }); cur = data }
  chain.push({ id: item.id, version: item.item_version, state: item.review_status })
  let next: any = item
  for (let i = 0; i < 20; i++) { const { data } = await admin.from('assessment_items').select('id, item_version, review_status').eq('supersedes_item_id', next.id).maybeSingle(); if (!data) break; chain.push({ id: data.id, version: data.item_version, state: data.review_status }); next = data }
  const duplicates = item.semantic_fingerprint
    ? (await admin.from('assessment_items').select('id, review_status, stem').eq('semantic_fingerprint', item.semantic_fingerprint).neq('id', itemId).limit(10)).data ?? [] : []
  const sameConcept = item.concept_id ? ((await admin.from('assessment_items').select('id, review_status, stem, options, family_id').eq('concept_id', item.concept_id).neq('id', itemId).limit(200)).data ?? []) as { id: string; review_status: string; stem: string; options: string[]; family_id: string | null }[] : []
  const near = nearMatches({ id: itemId, stem: item.stem as string, options: item.options as string[] }, sameConcept).map(m => ({ id: m.id, review_status: m.review_status, stem: m.stem, similarity: Math.round(m.similarity * 100), sameFamily: Boolean(m.family_id) && m.family_id === item.family_id }))
  const used = (await admin.from('assessment_responses').select('id', { count: 'exact', head: true }).eq('item_id', itemId)).count ?? 0
  // Proposed = what the generator or an editor recorded; confirmed = a reviewer's decision for THIS version (the latest one wins). Empirical statistics: not available.
  const difficulty = { proposed: item.intended_difficulty ?? null, confirmed: difficultyHistory.find(h => h.item_version === item.item_version) ?? null, history: difficultyHistory, empirical: null }
  return { item, concept, reading, outcome, validations, decisions, revisions, family, batch, blockers, challenges, chain, duplicates, near, difficulty, answeredCount: used }
}

async function loadFamily(familyId: string, selfId: string) {
  const admin = createAdminClient()
  const [fam, members] = await Promise.all([
    admin.from('item_families').select('id, family_key, held_out, held_out_reason, note, construction_status, confirmed_at').eq('id', familyId).maybeSingle().then(r => r.data),
    admin.from('assessment_items').select('id, review_status, stem, options, key_index, item_version').eq('family_id', familyId).order('id').limit(40).then(r => r.data ?? []),
  ])
  return { family: fam, members: members.filter(m => m.id !== selfId) as { id: string; review_status: string; stem: string; options: string[]; key_index: number | null; item_version: number }[] }
}

/** Re-runs the automatic checks on the item's CURRENT version and stores the result only if the item was not edited meanwhile. */
export async function reverifyItem(itemId: string, deadlineMs = 240_000): Promise<{ ok: boolean; verdict?: string; reason?: string; code?: string; message?: string }> {
  const admin = createAdminClient()
  const { data: item } = await admin.from('assessment_items').select('*').eq('id', itemId).maybeSingle()
  if (!item) return { ok: false, code: 'NOT_FOUND', message: 'Unknown item.' }
  if (item.review_status === 'reviewed' || item.review_status === 'deprecated') return { ok: false, code: 'IMMUTABLE', message: 'A published or retired item is not re-checked in place; edit it to create a new version.' }
  const { data: concept } = await admin.from('curriculum_concepts').select('id, name, topic, module, scope_notes, excluded_or_superseded').eq('id', item.concept_id).maybeSingle()
  if (!concept) return { ok: false, code: 'NO_CONCEPT', message: 'The item has no curriculum concept to check against.' }
  const card = (item.item_card ?? {}) as ItemCard
  const cell: BlueprintCell = {
    conceptId: concept.id, conceptName: concept.name, topic: concept.topic, module: concept.module,
    conceptScope: [concept.scope_notes, concept.excluded_or_superseded ? `EXCLUDED FROM SCOPE: ${concept.excluded_or_superseded}` : ''].filter(Boolean).join(' '),
    cognition: item.cognition ?? card.cognition, itemForm: item.item_form ?? card.itemForm, difficulty: item.intended_difficulty ?? card.difficulty,
  }
  const draft: GeneratedItemDraft = { stem: item.stem, options: item.options, keyIndex: item.key_index, perOptionFeedback: item.per_option_feedback, card: { ...card, conceptId: concept.id, conceptName: concept.name, cognition: cell.cognition, itemForm: cell.itemForm, difficulty: cell.difficulty }, generatorModel: item.generator_model ?? undefined }
  const others = new Set((await readAll<{ semantic_fingerprint: string | null }>((a, z) => admin.from('assessment_items').select('id, semantic_fingerprint').neq('id', itemId).not('semantic_fingerprint', 'is', null).order('id').range(a, z))).map(r => r.semantic_fingerprint as string))
  const fp = semanticFingerprint(item.stem, item.options)
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    verifyItem(draft, cell, { existingFingerprints: others, fingerprint: fp }),
    new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error(`The check took longer than ${Math.round(deadlineMs / 1000)}s and was abandoned. Nothing was changed.`)), deadlineMs) }),
  ]).finally(() => clearTimeout(timer)).catch((e: Error) => e)
  if (result instanceof Error) return { ok: false, code: 'CHECK_FAILED', message: result.message }
  const { data, error } = await admin.rpc('store_item_verification', {
    p_item_id: itemId, p_expected_version: item.item_version, p_gates: result.gates, p_verdict: result.status, p_reason: result.reason, p_model: result.verifierModel,
    p_extra: { defectCodes: result.defectCodes, independentAnswerIndex: result.independentAnswerIndex ?? null, derivation: result.derivation ?? null },
  })
  if (error) return { ok: false, code: 'STORE_FAILED', message: error.message }
  return { ...(data as any), verdict: result.status, reason: result.reason }
}

export { semanticFingerprint }

export type BatchReport = Awaited<ReturnType<typeof loadBatchReport>>

/** One batch measured: what was drafted, checked, failed and is waiting, with runtime, tokens and coverage. */
export async function loadBatchReport(batchId: string) {
  const admin = createAdminClient()
  const { data: batch } = await admin.from('item_batches').select('*').eq('id', batchId).maybeSingle()
  if (!batch) return null
  const [cells, items, topics, readings, los] = await Promise.all([
    readAll<any>((a, z) => admin.from('item_batch_cells').select('*').eq('batch_id', batchId).order('ordinal').range(a, z)),
    readAll<any>((a, z) => admin.from('assessment_items').select('id, review_status, outcome_id, lm_id, family_id').eq('batch_id', batchId).order('id').range(a, z)),
    admin.from('topics').select('id, name').then(r => r.data ?? []),
    admin.from('curriculum_readings').select('id, topic_id').eq('is_active', true).then(r => r.data ?? []),
    readAll<{ id: string; reading_id: string }>((a, z) => admin.from('reading_los').select('id, reading_id').order('id').range(a, z)),
  ])
  const topicOfReading = new Map(readings.map(r => [r.id as string, r.topic_id as string]))
  const topicName = new Map(topics.map(t => [t.id as string, t.name as string]))
  const byStatus: Record<string, number> = {}
  for (const c of cells) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1
  const state: Record<string, number> = {}
  for (const i of items) state[i.review_status] = (state[i.review_status] ?? 0) + 1

  const perTopic = new Map<string, { topic: string; planned: number; drafted: number; failed: number; open: number; outcomesPlanned: Set<string>; outcomesCovered: Set<string> }>()
  const failuresByCode: Record<string, number> = {}, failuresByForm: Record<string, number> = {}
  let ms = 0, msN = 0, calls = 0, prompt = 0, completion = 0, retried = 0
  for (const c of cells) {
    const topicId = topicOfReading.get(c.cell.readingId) ?? 'unknown'
    const t = perTopic.get(topicId) ?? { topic: topicName.get(topicId) ?? topicId, planned: 0, drafted: 0, failed: 0, open: 0, outcomesPlanned: new Set<string>(), outcomesCovered: new Set<string>() }
    t.planned++; t.outcomesPlanned.add(c.cell.outcomeId)
    if (c.status === 'drafted') { t.drafted++; t.outcomesCovered.add(c.cell.outcomeId) } else if (c.status === 'failed') t.failed++; else t.open++
    perTopic.set(topicId, t)
    if (c.status === 'failed') {
      for (const code of (c.defect_codes?.length ? c.defect_codes : [c.verdict ?? 'UNKNOWN'])) failuresByCode[code] = (failuresByCode[code] ?? 0) + 1
      const form = `${c.cell.cognition}/${c.cell.itemForm}`; failuresByForm[form] = (failuresByForm[form] ?? 0) + 1
    }
    if (c.attempts > 1) retried++
    if (c.generate_ms) { ms += c.generate_ms; msN++ }
    if (c.provider_usage) { calls += c.provider_usage.calls ?? 0; prompt += c.provider_usage.promptTokens ?? 0; completion += c.provider_usage.completionTokens ?? 0 }
  }
  const outcomesInTopic = new Map<string, number>()
  for (const l of los) { const tp = topicOfReading.get(l.reading_id); if (tp) outcomesInTopic.set(tp, (outcomesInTopic.get(tp) ?? 0) + 1) }
  const outcomesWithItems = new Set(items.map(i => i.outcome_id).filter(Boolean))
  const families = new Set(items.map(i => i.family_id).filter(Boolean))
  const wallSeconds = batch.started_at ? Math.round(((batch.finished_at ? new Date(batch.finished_at).getTime() : Date.now()) - new Date(batch.started_at).getTime()) / 1000) : 0
  const drafted = byStatus.drafted ?? 0
  return {
    batch, cellsTotal: cells.length, byStatus, drafted, failed: byStatus.failed ?? 0, open: (byStatus.pending ?? 0) + (byStatus.running ?? 0),
    itemsByState: state, awaitingReview: state.verified ?? 0, failuresByCode, failuresByForm, retried,
    perTopic: [...perTopic.entries()].map(([id, t]) => ({ id, topic: t.topic, planned: t.planned, drafted: t.drafted, failed: t.failed, open: t.open,
      outcomesInTopic: outcomesInTopic.get(id) ?? 0, outcomesCovered: t.outcomesCovered.size })).sort((a, b) => a.id.localeCompare(b.id)),
    runtime: { wallSeconds, avgGenerateSeconds: msN ? Math.round(ms / msN / 1000) : null, calls, promptTokens: prompt, completionTokens: completion },
    coverage: { outcomesWithCandidates: outcomesWithItems.size, familiesCreated: families.size, yieldPerCell: cells.length ? Math.round((drafted / cells.length) * 100) : 0 },
  }
}
