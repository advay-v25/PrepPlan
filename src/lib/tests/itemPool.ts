import { createAdminClient } from '../supabase/admin'
import type { allowedTiers } from '../diagnostic/blueprint'
import { eligibleItems, FIXTURE_PROVENANCE } from '../diagnostic/itemState'
import { getPaperManifestId } from '../planning/pulse/paper'
import { readAll } from '../supabase/readAll'
import { perRequest } from '../ops/perRequest'

export type PoolItem = {
  id: string; lm_id: string; outcome_id: string | null; concept_id: string | null
  intended_difficulty: string | null; cognition: string | null; item_form: string | null; key_index: number | null
  /** null = family unknown. Such an item may still be served under the existing non-adaptive policy (never grouped by wording), but it is NOT independent evidence: difficulty adaptation ignores its results (see difficultyEvidence.ts). */
  family_id?: string | null; item_version?: number
  /** Reviewer-confirmed level for this exact version. null = not confirmed (proposed or unknown): never treated as Standard. */
  level?: 'foundation' | 'standard' | 'difficult' | 'stretch' | null
}

/** `seenFamilies`: a new wording or number inside a family the student has answered is not independent evidence. */
export function filterEligiblePool(items: PoolItem[], seen: Set<string>, activeConcepts: Set<string>, readingOf: Map<string, string>, bindings: Set<string>, seenFamilies: Set<string> = new Set()) {
  return items.filter(i => !seen.has(i.id) && !(i.family_id && seenFamilies.has(i.family_id)) && i.concept_id !== null && activeConcepts.has(i.concept_id)
    && i.outcome_id !== null && readingOf.get(i.outcome_id) === i.lm_id && bindings.has(`${i.concept_id}:${i.outcome_id}`))
}

/**
 * 'routine' = the student_eligible_items view (never held out). 'heldout' = the rehearsal view (ONLY held-out). It is chosen by server code
 * (the rehearsal service); no route reads it from a request, so a browser cannot ask for held-out content.
 */
export type PoolSource = 'routine' | 'heldout'

/** Shared candidate policy for the preview, the counts and the reservation. Failures are not an empty bank. */
async function loadEligibleItemPoolUncached(userId: string, readingIds: string[], _purpose?: Parameters<typeof allowedTiers>[0], source: PoolSource = 'routine'): Promise<PoolItem[]> {
  if (!readingIds.length) return []
  const manifestId = await getPaperManifestId()
  if (!manifestId) return []
  const admin = createAdminClient()
  const allowFixtures = process.env.NODE_ENV !== 'production' && process.env.ROADMAP_FIXTURE_BANK === '1'
  const [responses, delivered, concepts, items, outcomes, mappings] = await Promise.all([
    readAll<{ item_id: string; item: any }>((a, z) => admin.from('assessment_responses').select('item_id, id, item:assessment_items(family_id)').eq('user_id', userId).order('id').range(a, z)),
    deliveredItems(userId),
    readAll<{ id: string }>((a, z) => admin.from('curriculum_concepts').select('id').eq('manifest_id', manifestId).order('id').range(a, z)),
    readAll<PoolItem>((a, z) => {
      const items = (source === 'heldout' ? admin.from('rehearsal_eligible_items') : eligibleItems(admin))
        .select('id, lm_id, outcome_id, concept_id, intended_difficulty, cognition, item_form, key_index, family_id, item_version')
        .in('lm_id', [...new Set(readingIds)])
      if (!allowFixtures) items.neq('provenance', FIXTURE_PROVENANCE)
      return items.order('id').range(a, z)
    }),
    readAll<{ id: string; reading_id: string }>((a, z) => admin.from('reading_los').select('id,reading_id').in('reading_id', [...new Set(readingIds)]).order('id').range(a, z)),
    readAll<{ concept_id: string; outcome_id: string }>((a, z) => admin.from('concept_outcome_map').select('concept_id,outcome_id').order('concept_id').order('outcome_id').range(a, z)),
  ])
  // A held-out question already pinned to another open rehearsal of this student is not available to a new one.
  const pinned = source === 'heldout' ? await pinnedRehearsalItems(userId) : []
  const exposure = [...responses, ...delivered, ...pinned]
  const seen = new Set(exposure.map(r => r.item_id)), active = new Set(concepts.map(c => c.id))
  const seenFamilies = new Set(exposure.flatMap(r => (r.item as any)?.family_id ? [(r.item as any).family_id as string] : []))
  const eligible = filterEligiblePool(items, seen, active, new Map(outcomes.map(o => [o.id, o.reading_id])),
    new Set(mappings.map(m => `${m.concept_id}:${m.outcome_id}`)), seenFamilies)
  // Reviewer-confirmed level for the EXACT current version; everything else stays unclassified (never treated as Standard).
  const confirmed = new Map((await readAll<{ item_id: string; item_version: number; level: PoolItem['level'] }>((a, z) => admin.from('item_confirmed_difficulty').select('item_id, item_version, level').order('item_id').order('item_version').range(a, z)))
    .map(c => [`${c.item_id}:${c.item_version}`, c.level]))
  return eligible.map(i => ({ ...i, level: confirmed.get(`${i.id}:${i.item_version}`) ?? null }))
}

/** Fresh eligible questions per reading — the one count every surface shows (Tests, Calendar planning, Curriculum, mock). */
export async function countFreshByReading(userId: string, readingIds?: string[]): Promise<Map<string, number>> {
  let ids = readingIds
  if (!ids) ids = ((await createAdminClient().from('curriculum_readings').select('id').eq('is_active', true).throwOnError()).data ?? []).map(r => r.id as string)
  const counts = new Map<string, number>(ids.map(id => [id, 0]))
  for (const i of await loadEligibleItemPool(userId, ids)) counts.set(i.lm_id, (counts.get(i.lm_id) ?? 0) + 1)
  return counts
}

/** Questions already shown to the student: in a paper that was opened (not merely reserved) or in item-by-item adaptive practice. */
async function deliveredItems(userId: string): Promise<{ item_id: string; item: any }[]> {
  const admin = createAdminClient()
  const [{ data: attempts }, adaptiveRuns] = await Promise.all([
    admin.from('assessment_attempts').select('form_id').eq('user_id', userId).not('status', 'in', '(ready,assembling)').throwOnError(),
    readAll<{ id: string }>((a, z) => admin.from('adaptive_item_runs').select('id').eq('user_id', userId).order('id').range(a, z)),
  ])
  const forms = (attempts ?? []).map(a => a.form_id as string).filter(Boolean)
  const runIds = adaptiveRuns.map(r => r.id)
  const [formRows, adaptiveRows] = await Promise.all([
    forms.length
      ? readAll<{ item_id: string; item: any }>((a, z) => admin.from('form_items').select('item_id, form_id, item:assessment_items(family_id)').in('form_id', forms).order('form_id').order('item_id').range(a, z))
      : Promise.resolve([]),
    runIds.length
      ? readAll<{ item_id: string; family_id: string | null }>((a, z) => admin.from('adaptive_item_steps').select('item_id, family_id, seq').in('run_id', runIds).order('run_id').order('seq').range(a, z))
      : Promise.resolve([]),
  ])
  return [
    ...formRows,
    ...adaptiveRows.map(r => ({ item_id: r.item_id, item: { family_id: r.family_id } })),
  ]
}

async function pinnedRehearsalItems(userId: string): Promise<{ item_id: string; item: any }[]> {
  const admin = createAdminClient()
  const { data: open } = await admin.from('mock_rehearsals').select('id').eq('user_id', userId).in('status', ['ready', 'in_progress']).throwOnError()
  if (!open?.length) return []
  const { data: attempts } = await admin.from('assessment_attempts').select('form_id').eq('user_id', userId).in('rehearsal_id', open.map(o => o.id as string)).throwOnError()
  const forms = (attempts ?? []).map(a => a.form_id as string).filter(Boolean)
  if (!forms.length) return []
  return readAll<{ item_id: string; item: any }>((a, z) => admin.from('form_items').select('item_id, form_id, item:assessment_items(family_id)').in('form_id', forms).order('form_id').order('item_id').range(a, z))
}

/**
 * Within ONE server render (Calendar asks twice: the paper preview and the weekly paper state, with the same readings) the pool is read once. A route handler,
 * including starting a paper, is not inside a render, so it always reads fresh. The purpose argument does not change the result, so it is not part of the key.
 * Each caller gets its own array.
 */
const pooledOnce = perRequest(loadEligibleItemPoolUncached, (userId: string, readingIds: string[], _purpose?: Parameters<typeof allowedTiers>[0], source: PoolSource = 'routine') =>
  `${userId}|${source}|${[...new Set(readingIds)].sort().join(',')}`)
export const loadEligibleItemPool = (userId: string, readingIds: string[], purpose?: Parameters<typeof allowedTiers>[0], source: PoolSource = 'routine'): Promise<PoolItem[]> =>
  pooledOnce(userId, readingIds, purpose, source).then(pool => pool.slice())
