import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { rehearsalAllocations } from '../rehearsal/blueprint'
import { MIN_PAPER_QUESTIONS } from './limits'
import { FIXTURE_PROVENANCE } from '../diagnostic/itemState'
import { MIN_VIABLE_PER_OUTCOME, shallowOutcomes } from './bankCoverage'

/**
 * Content capacity: what exists, at which stage, and what can ACTUALLY be served. Everything is paged beyond 1,000 rows, and a failed read
 * throws (the caller reports "unavailable"); it is never presented as zero. Counts of different kinds are never added together:
 * raw candidates, automatic passes, quarantined (rights not cleared), exact-version approvals, and independent families are separate columns.
 */
export const DIAGNOSTIC_FAMILIES = 1          // one independent construction to ask a concept once
export const RECHECK_FAMILIES = 3             // a re-check asks three further independent constructions
export const MIN_FAMILIES_PER_OUTCOME = MIN_VIABLE_PER_OUTCOME

export type Cell = {
  raw: number; autoPass: number; quarantined: number; rejectedOrRetired: number
  approvedRoutine: number; approvedHeldOut: number
  familiesRoutine: number; familiesHeldOut: number; provisionalFamilies: number
}
export type ConceptRow = Cell & { conceptId: string; name: string; outcomeId: string | null; readingId: string | null; verified: boolean; exactMapping: boolean; diagnosticReady: boolean; recheckReady: boolean; missingCells: string[] }
export type CapacityReport = {
  manifest: { id: string; year: number; version: string }
  total: Cell
  topics: (Cell & { id: string; name: string; readings: number; outcomes: number; outcomesBelowDepth: number; concepts: number; conceptsRecheckReady: number })[]
  outcomesBelowDepth: { outcomeId: string; readingId: string; families: number }[]
  concepts: ConceptRow[]
  /** The matrix: topic → reading → outcome → concepts. Every cell is a separate count; none is a sum of another kind. */
  readings: (Cell & { id: string; topicId: string; outcomes: number; outcomesBelowDepth: number; servable: boolean })[]
  outcomes: (Cell & { id: string; readingId: string; topicId: string; conceptIds: string[] })[]
  serving: { weeklyPaper: { readings: number; servable: number }; recheck: { concepts: number; servable: number }; mock: { fullMocksServable: number; limitingTopics: { topic: string; wanted: number; families: number }[]; perTopicFamilies: Record<string, number> } }
  unattributed: number
}

const blank = (): Cell => ({ raw: 0, autoPass: 0, quarantined: 0, rejectedOrRetired: 0, approvedRoutine: 0, approvedHeldOut: 0, familiesRoutine: 0, familiesHeldOut: 0, provisionalFamilies: 0 })

export async function getCapacityReport({ includeFixtures = false } = {}): Promise<CapacityReport> {
  const admin = createAdminClient()
  const { data: manifest } = await admin.from('curriculum_manifests').select('id, year, version').eq('is_active', true).single()
  if (!manifest) throw new Error('No active curriculum manifest')
  const [topics, readings, los, concepts, maps, items, families, batches, routine, heldOut] = await Promise.all([
    readAll<{ id: string; name: string; exam_weight_min: number; exam_weight_max: number }>((a, z) => admin.from('topics').select('id, name, exam_weight_min, exam_weight_max').order('id').range(a, z)),
    readAll<{ id: string; topic_id: string }>((a, z) => admin.from('curriculum_readings').select('id, topic_id').eq('is_active', true).order('id').range(a, z)),
    readAll<{ id: string; reading_id: string }>((a, z) => admin.from('reading_los').select('id, reading_id').order('id').range(a, z)),
    readAll<{ id: string; name: string; verification_status: string }>((a, z) => {
      const query = admin.from('curriculum_concepts').select('id, name, verification_status').eq('manifest_id', manifest.id)
      if (!includeFixtures) query.neq('topic', 'Fixture')
      return query.order('id').range(a, z)
    }),
    readAll<{ concept_id: string; outcome_id: string; approximate: boolean }>((a, z) => admin.from('concept_outcome_map').select('concept_id, outcome_id, approximate').order('concept_id').range(a, z)),
    readAll<{ id: string; lm_id: string; concept_id: string | null; outcome_id: string | null; review_status: string; held_out: boolean; family_id: string | null; batch_id: string | null; intended_difficulty: string | null; cognition: string | null; item_form: string | null }>((a, z) => {
      const query = admin.from('assessment_items').select('id, lm_id, concept_id, outcome_id, review_status, held_out, family_id, batch_id, intended_difficulty, cognition, item_form')
      if (!includeFixtures) query.neq('provenance', FIXTURE_PROVENANCE)
      return query.order('id').range(a, z)
    }),
    readAll<{ id: string; construction_status: string }>((a, z) => admin.from('item_families').select('id, construction_status').order('id').range(a, z)),
    readAll<{ id: string; rights_status: string }>((a, z) => admin.from('item_batches').select('id, rights_status').order('id').range(a, z)),
    readAll<{ id: string }>((a, z) => admin.from('student_eligible_items').select('id').order('id').range(a, z)),
    readAll<{ id: string }>((a, z) => admin.from('rehearsal_eligible_items').select('id').order('id').range(a, z)),
  ])
  const eligibleRoutine = new Set(routine.map(r => r.id)), eligibleHeld = new Set(heldOut.map(r => r.id))
  const famStatus = new Map(families.map(f => [f.id, f.construction_status])), rights = new Map(batches.map(b => [b.id, b.rights_status]))
  const topicOfReading = new Map(readings.map(r => [r.id, r.topic_id])), readingOfOutcome = new Map(los.map(l => [l.id, l.reading_id]))
  const mapOf = new Map(maps.map(m => [m.concept_id, m]))

  const cellOf = new Map<string, Cell & { fr: Set<string>; fh: Set<string>; fp: Set<string>; dims: Set<string> }>()
  const bucket = (k: string) => { let c = cellOf.get(k); if (!c) { c = { ...blank(), fr: new Set(), fh: new Set(), fp: new Set(), dims: new Set() }; cellOf.set(k, c) } return c }
  let unattributed = 0
  const apply = (c: ReturnType<typeof bucket>, i: (typeof items)[number]) => {
    if (i.review_status === 'deprecated') { c.rejectedOrRetired++; return }
    if (eligibleRoutine.has(i.id)) { c.approvedRoutine++; if (i.family_id && famStatus.get(i.family_id) === 'confirmed') c.fr.add(i.family_id); c.dims.add(`${i.intended_difficulty}|${i.cognition}|${i.item_form}`); return }
    if (eligibleHeld.has(i.id)) { c.approvedHeldOut++; if (i.family_id && famStatus.get(i.family_id) === 'confirmed') c.fh.add(i.family_id); return }
    // Not published: a candidate. Anything without a CLEARED batch (including older loads with no recorded rights) is quarantined whatever its automatic result.
    if (!(i.batch_id && rights.get(i.batch_id) === 'cleared')) c.quarantined++
    c.raw++
    if (i.review_status === 'verified') c.autoPass++
    if (i.family_id && famStatus.get(i.family_id) === 'provisional') c.fp.add(i.family_id)
  }
  const total = bucket('*total'), byTopic = new Map<string, ReturnType<typeof bucket>>(), byOutcome = new Map<string, ReturnType<typeof bucket>>()
  for (const i of items) {
    const outcome = i.outcome_id ?? (i.concept_id ? mapOf.get(i.concept_id)?.outcome_id ?? null : null)
    const reading = i.lm_id ?? (outcome ? readingOfOutcome.get(outcome) : undefined)
    const topic = reading ? topicOfReading.get(reading) : undefined
    apply(total, i)
    if (!topic) { unattributed++; continue }
    apply(bucket(`t:${topic}`), i); byTopic.set(topic, bucket(`t:${topic}`))
    if (outcome) { apply(bucket(`o:${outcome}`), i); byOutcome.set(outcome, bucket(`o:${outcome}`)) }
    if (i.concept_id) apply(bucket(`c:${i.concept_id}`), i)
  }
  const fin = (c: ReturnType<typeof bucket>): Cell => ({ raw: c.raw, autoPass: c.autoPass, quarantined: c.quarantined, rejectedOrRetired: c.rejectedOrRetired, approvedRoutine: c.approvedRoutine, approvedHeldOut: c.approvedHeldOut, familiesRoutine: c.fr.size, familiesHeldOut: c.fh.size, provisionalFamilies: c.fp.size })

  const conceptRows: ConceptRow[] = concepts.map(c => {
    const b = bucket(`c:${c.id}`), m = mapOf.get(c.id), cell = fin(b)
    const missing: string[] = []
    if (cell.familiesRoutine < DIAGNOSTIC_FAMILIES) missing.push('no independent family')
    else if (cell.familiesRoutine < DIAGNOSTIC_FAMILIES + RECHECK_FAMILIES) missing.push(`re-check needs ${DIAGNOSTIC_FAMILIES + RECHECK_FAMILIES} families, has ${cell.familiesRoutine}`)
    if (c.verification_status !== 'verified') missing.push('concept not signed off')
    if (m?.approximate) missing.push('mapping is approximate')
    const dims = [...b.dims]
    if (cell.approvedRoutine > 0 && !dims.some(d => d.startsWith('foundation|'))) missing.push('no foundation-difficulty item')
    if (cell.approvedRoutine > 0 && !dims.some(d => d.startsWith('difficult|') || d.startsWith('stretch|'))) missing.push('no difficult item')
    return { conceptId: c.id, name: c.name, outcomeId: m?.outcome_id ?? null, readingId: m ? readingOfOutcome.get(m.outcome_id) ?? null : null, verified: c.verification_status === 'verified', exactMapping: Boolean(m && !m.approximate),
      ...cell, diagnosticReady: cell.familiesRoutine >= DIAGNOSTIC_FAMILIES, recheckReady: cell.familiesRoutine >= DIAGNOSTIC_FAMILIES + RECHECK_FAMILIES, missingCells: missing }
  })

  const familiesByOutcome = new Map([...byOutcome].map(([id, counts]) => [id, counts.fr] as const))
  const shallow = new Set(shallowOutcomes(los.map(l => l.id), familiesByOutcome))
  const below = los.filter(l => shallow.has(l.id)).map(l => ({ outcomeId: l.id, readingId: l.reading_id, families: familiesByOutcome.get(l.id)?.size ?? 0 }))

  const topicRows = topics.map(t => {
    const rs = readings.filter(r => r.topic_id === t.id).map(r => r.id)
    const outs = los.filter(l => rs.includes(l.reading_id)).map(l => l.id)
    const cs = conceptRows.filter(c => c.readingId && rs.includes(c.readingId))
    return { id: t.id, name: t.name, ...fin(bucket(`t:${t.id}`)), readings: rs.length, outcomes: outs.length, outcomesBelowDepth: below.filter(b => outs.includes(b.outcomeId)).length, concepts: cs.length, conceptsRecheckReady: cs.filter(c => c.recheckReady).length }
  })

  const perReading = new Map<string, number>()
  for (const i of items) if (eligibleRoutine.has(i.id)) perReading.set(i.lm_id, (perReading.get(i.lm_id) ?? 0) + 1)
  const readingCell = (rid: string) => { const c = blank(); const outs = los.filter(l => l.reading_id === rid); for (const l of outs) { const o = fin(bucket(`o:${l.id}`)); for (const k of Object.keys(c) as (keyof Cell)[]) c[k] += o[k] } return c }
  const readingRows: CapacityReport['readings'] = readings.map(r => { const outs = los.filter(l => l.reading_id === r.id); return { id: r.id, topicId: r.topic_id, ...readingCell(r.id), outcomes: outs.length, outcomesBelowDepth: below.filter(b => b.readingId === r.id).length, servable: (perReading.get(r.id) ?? 0) >= MIN_PAPER_QUESTIONS } })
  const outcomeRows: CapacityReport['outcomes'] = los.map(l => ({ id: l.id, readingId: l.reading_id, topicId: topicOfReading.get(l.reading_id) ?? '', ...fin(bucket(`o:${l.id}`)), conceptIds: conceptRows.filter(c => c.outcomeId === l.id).map(c => c.conceptId) }))

  // Servability, with the same admission as serving: a reading is paper-ready when enough eligible routine items exist (MIN_PAPER_QUESTIONS lives in limits).
  const alloc = rehearsalAllocations(topics.map(t => ({ id: t.id, min: Number(t.exam_weight_min), max: Number(t.exam_weight_max) })))
  const wanted: Record<string, number> = { ...alloc[0], ...alloc[1] }
  const perTopicFamilies: Record<string, number> = Object.fromEntries(topics.map(t => [t.id, byTopic.get(t.id)?.fh.size ?? 0]))
  const limiting = topics.filter(t => (wanted[t.id] ?? 0) > 0).map(t => ({ topic: t.id, wanted: wanted[t.id], families: perTopicFamilies[t.id] }))
  const fullMocks = limiting.length ? Math.min(...limiting.map(l => Math.floor(l.families / l.wanted))) : 0

  return {
    manifest: { id: manifest.id as string, year: manifest.year as number, version: manifest.version as string },
    total: fin(total), topics: topicRows, outcomesBelowDepth: below, concepts: conceptRows, readings: readingRows, outcomes: outcomeRows,
    serving: {
      weeklyPaper: { readings: readings.length, servable: readings.filter(r => (perReading.get(r.id) ?? 0) >= MIN_PAPER_QUESTIONS).length },
      recheck: { concepts: conceptRows.length, servable: conceptRows.filter(c => c.recheckReady).length },
      mock: { fullMocksServable: fullMocks, limitingTopics: limiting.filter(l => Math.floor(l.families / l.wanted) <= fullMocks), perTopicFamilies },
    },
    unattributed,
  }
}

/** Plain-language lines for the operator; "unavailable" is returned by the caller when getCapacityReport throws. */
export function capacitySummary(r: CapacityReport): string[] {
  const t = r.total
  return [
    `Edition ${r.manifest.year} ${r.manifest.version}`,
    `Candidates (not published): ${t.raw} raw · ${t.autoPass} automatically checked · ${t.quarantined} of the ${t.raw} quarantined (rights not cleared or not recorded) · ${t.provisionalFamilies} provisional families`,
    `Published by exact-version approval: ${t.approvedRoutine} routine (${t.familiesRoutine} confirmed independent families) · ${t.approvedHeldOut} held-out (${t.familiesHeldOut} families) · ${t.rejectedOrRetired} rejected or retired`,
    `Servable now: ${r.serving.weeklyPaper.servable} of ${r.serving.weeklyPaper.readings} readings can supply a paper · ${r.serving.recheck.servable} of ${r.serving.recheck.concepts} concepts can supply a re-check · ${r.serving.mock.fullMocksServable} full mock(s)`,
    `Outcomes below the ${MIN_FAMILIES_PER_OUTCOME}-family minimum: ${r.outcomesBelowDepth.length}`,
    ...(r.unattributed ? [`${r.unattributed} item(s) could not be attributed to a reading and are not counted per topic`] : []),
  ]
}
