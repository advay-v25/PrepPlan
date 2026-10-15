import { createAdminClient } from '../supabase/admin'
import { apportion } from './weightedBlueprint'

/**
 * 2027 bank coverage audit. Measures the bank per subject, reading and outcome against a
 * 20,000-item target — the target is a planning aim, never a claim that the bank is ready.
 * Approved, verifier-passed, rejected and missing cells are reported separately.
 */
export const BANK_TARGET_TOTAL = 20_000
/** Minimum viable coverage before raw volume matters: approved items per examinable outcome. */
export const MIN_VIABLE_PER_OUTCOME = 3

export type CoverageRow = { id: string; name: string; target: number; approved: number; other: Record<string, number>; missingOutcomes: number }
export type BankCoverage = {
  total: { target: number; approved: number; byStatus: Record<string, number> }
  subjects: CoverageRow[]
  readings: (CoverageRow & { subjectId: string; pages: number; outcomes: number; structurePending: boolean; minViable: number; meetsMinViable: boolean })[]
  readingsWithNoItems: string[]
  outcomesWithNoItems: number
  outcomesTotal: number
  minViableTotal: number
  minViableMetReadings: number
}

const APPROVED = new Set(['reviewed', 'verified', 'approved'])

export async function getBankCoverage(): Promise<BankCoverage> {
  const admin = createAdminClient()
  const [{ data: topics }, { data: readings }, { data: los }, { data: items }] = await Promise.all([
    admin.from('topics').select('id, name, exam_weight_min, exam_weight_max'),
    admin.from('curriculum_readings').select('id, topic_id, reading_no, title, page_count, structure_pending').eq('is_active', true),
    admin.from('reading_los').select('id, reading_id'),
    admin.from('assessment_items').select('id, lm_id, outcome_id, review_status'),
  ])

  const subjectTargets = apportion(BANK_TARGET_TOTAL, (topics ?? []).map(t => ({ key: t.id as string, weight: (Number(t.exam_weight_min) + Number(t.exam_weight_max)) / 2 })))
  const readingTargets = new Map<string, number>()
  for (const t of topics ?? []) {
    const rs = (readings ?? []).filter(r => r.topic_id === t.id)
    for (const [k, v] of apportion(subjectTargets.get(t.id as string) ?? 0, rs.map(r => ({ key: r.id as string, weight: Number(r.page_count) }))) ) readingTargets.set(k, v)
  }

  const outcomesByReading = new Map<string, string[]>()
  for (const l of los ?? []) outcomesByReading.set(l.reading_id as string, [...(outcomesByReading.get(l.reading_id as string) ?? []), l.id as string])

  const byStatus: Record<string, number> = {}
  const itemsByReading = new Map<string, { approved: number; other: Record<string, number> }>()
  const approvedByOutcome = new Map<string, number>()
  for (const i of items ?? []) {
    const st = (i.review_status ?? 'unknown') as string
    byStatus[st] = (byStatus[st] ?? 0) + 1
    const r = itemsByReading.get(i.lm_id as string) ?? { approved: 0, other: {} }
    if (APPROVED.has(st)) { r.approved++; if (i.outcome_id) approvedByOutcome.set(i.outcome_id as string, (approvedByOutcome.get(i.outcome_id as string) ?? 0) + 1) }
    else r.other[st] = (r.other[st] ?? 0) + 1
    itemsByReading.set(i.lm_id as string, r)
  }

  const readingRows = (readings ?? []).map(r => {
    const outs = outcomesByReading.get(r.id as string) ?? []
    const it = itemsByReading.get(r.id as string) ?? { approved: 0, other: {} }
    const pending = Boolean(r.structure_pending)
    const minViable = pending ? 0 : outs.length * MIN_VIABLE_PER_OUTCOME
    return {
      id: r.id as string, name: `Reading ${r.reading_no}: ${r.title}`, subjectId: r.topic_id as string, pages: Number(r.page_count), outcomes: outs.length,
      structurePending: pending, target: readingTargets.get(r.id as string) ?? 0, approved: it.approved, other: it.other,
      missingOutcomes: outs.filter(o => (approvedByOutcome.get(o) ?? 0) === 0).length, minViable, meetsMinViable: !pending && it.approved >= minViable && outs.every(o => (approvedByOutcome.get(o) ?? 0) >= 1),
    }
  }).sort((a, b) => a.id.localeCompare(b.id))

  const subjectRows: CoverageRow[] = (topics ?? []).map(t => {
    const rs = readingRows.filter(r => r.subjectId === t.id)
    const other: Record<string, number> = {}
    for (const r of rs) for (const [k, v] of Object.entries(r.other)) other[k] = (other[k] ?? 0) + v
    return { id: t.id as string, name: t.name as string, target: subjectTargets.get(t.id as string) ?? 0, approved: rs.reduce((s, r) => s + r.approved, 0), other, missingOutcomes: rs.reduce((s, r) => s + r.missingOutcomes, 0) }
  })

  const allOutcomes = (los ?? []).map(l => l.id as string)
  return {
    total: { target: BANK_TARGET_TOTAL, approved: readingRows.reduce((s, r) => s + r.approved, 0), byStatus },
    subjects: subjectRows, readings: readingRows,
    readingsWithNoItems: readingRows.filter(r => r.approved === 0).map(r => r.id),
    outcomesWithNoItems: allOutcomes.filter(o => (approvedByOutcome.get(o) ?? 0) === 0).length,
    outcomesTotal: allOutcomes.length,
    minViableTotal: readingRows.reduce((s, r) => s + r.minViable, 0),
    minViableMetReadings: readingRows.filter(r => r.meetsMinViable).length,
  }
}
