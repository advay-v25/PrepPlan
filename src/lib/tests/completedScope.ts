import { createHash } from 'crypto'

/**
 * The one canonical "what was actually completed" contract.
 *
 * Calendar DEFINES the candidate scope; the student's recorded completion
 * DETERMINES test eligibility. Used by Tests, Curriculum, Home, Coach and weekly
 * closure — nothing keeps its own idea of what was studied.
 *
 * This file is pure (no I/O): `buildCompletedScope` turns already-loaded rows into
 * the scope. `completedScopeService.ts` loads them.
 *
 * Rules:
 *  - only COMPLETED blocks and ATTENDED class coverage enter the scope;
 *  - a block that names a reading but no outcome is UNRESOLVED until the student
 *    confirms which outcomes were covered — outcomes are never guessed;
 *  - partial blocks are unresolved until a portion is confirmed;
 *  - postponed / missed / not-done blocks are excluded and stay Calendar's job;
 *  - each outcome appears once, however many logs mention it (sources are merged);
 *  - new vs revision comes from history, not from a coverage label.
 */

export type ScopeKind = 'new' | 'revision'

export type OutcomeRef = { id: string; readingId: string; subjectId: string; code: string; title: string }
export type ReadingRef = { id: string; subjectId: string; readingNo: number; title: string; pageCount: number; structurePending: boolean }

export type BlockRow = {
  id: string; title: string; taskType: string; execution: string; localDate: string | null
  outcomeId: string | null; readingId: string | null; origin: string | null
}
export type ClassItemRow = { sessionId: string; classDate: string; kind: 'covered' | 'revision'; outcomeId: string; extent: 'part' | 'full' | 'continued'; studiedInClass: boolean }

export type ScopeSource = { type: 'block' | 'class' | 'quick'; id: string; at: string | null }

export type ScopeTarget = {
  outcomeId: string; readingId: string; subjectId: string; kind: ScopeKind
  /** 1 = covered in full; 0.5 = only part of it was covered. */
  weight: number
  sources: ScopeSource[]
}

export type ExclusionReason = 'postponed' | 'missed' | 'not_completed' | 'structure_pending'
export type ExcludedBlock = { blockId: string; title: string; reason: ExclusionReason; readingId: string | null; outcomeId: string | null }
export type UnresolvedBlock = { blockId: string; title: string; readingId: string; reason: 'reading_level' | 'partial' }

export type CompletedCycleScope = {
  cycle: { id: string; startsAt: string; endsAt: string } | null
  targets: ScopeTarget[]
  excluded: ExcludedBlock[]
  unresolved: UnresolvedBlock[]
  readings: { readingId: string; subjectId: string; pageCount: number; outcomeIds: string[]; newCount: number; revisionCount: number }[]
  totals: { outcomes: number; readings: number; subjects: number; newOutcomes: number; revisionOutcomes: number; pages: number }
  /** Hash of everything above that matters to a paper; changes when the scope changes. */
  revision: string
}

export type ScopeInput = {
  cycle: { id: string; startsAt: string; endsAt: string } | null
  today: string
  blocks: BlockRow[]
  /** block id -> outcome ids the student confirmed. */
  confirmations: Map<string, string[]>
  classItems: ClassItemRow[]
  outcomes: Map<string, OutcomeRef>
  readings: Map<string, ReadingRef>
  /** Outcomes / readings the student already worked BEFORE this cycle (earlier cycles, earlier classes, evidence, self-reported coverage). */
  priorOutcomes: Set<string>
  priorReadings: Set<string>
}

const SCOPE_TASK_TYPES = new Set(['study', 'review', 'class_consolidation', 'verification'])

export function buildCompletedScope(input: ScopeInput): CompletedCycleScope {
  const targets = new Map<string, ScopeTarget>()
  const excluded: ExcludedBlock[] = []
  const unresolved: UnresolvedBlock[] = []

  const add = (outcomeId: string, source: ScopeSource, opts: { revisionPurpose: boolean; weight: number }) => {
    const o = input.outcomes.get(outcomeId)
    if (!o) return
    const reading = input.readings.get(o.readingId)
    if (!reading || reading.structurePending) return
    const history = input.priorOutcomes.has(outcomeId) || input.priorReadings.has(o.readingId)
    const kind: ScopeKind = opts.revisionPurpose || history ? 'revision' : 'new'
    const existing = targets.get(outcomeId)
    if (!existing) {
      targets.set(outcomeId, { outcomeId, readingId: o.readingId, subjectId: o.subjectId, kind, weight: opts.weight, sources: [source] })
      return
    }
    // The same outcome from several logs is ONE target: strongest weight, and a
    // revision purpose or history keeps it a revision. Sources merge; questions never multiply.
    existing.weight = Math.max(existing.weight, opts.weight)
    if (kind === 'revision') existing.kind = 'revision'
    if (!existing.sources.some(s => s.type === source.type && s.id === source.id)) existing.sources.push(source)
  }

  for (const b of input.blocks) {
    if (!SCOPE_TASK_TYPES.has(b.taskType)) continue // paper, repair, admin etc. are not learning scope
    const readingId = b.readingId ?? (b.outcomeId ? input.outcomes.get(b.outcomeId)?.readingId ?? null : null)
    if (!readingId && !b.outcomeId) continue // not mapped to the curriculum at all
    const reading = readingId ? input.readings.get(readingId) : undefined
    const at = b.localDate
    const revisionPurpose = b.taskType === 'review' || b.taskType === 'verification'
    const confirmed = input.confirmations.get(b.id) ?? []
    const fromQuick = b.id.startsWith('qs-')

    if (reading?.structurePending) { excluded.push({ blockId: b.id, title: b.title, reason: 'structure_pending', readingId, outcomeId: b.outcomeId }); continue }

    if (b.execution === 'deferred') { excluded.push({ blockId: b.id, title: b.title, reason: 'postponed', readingId, outcomeId: b.outcomeId }); continue }
    if (b.execution === 'skipped') { excluded.push({ blockId: b.id, title: b.title, reason: 'missed', readingId, outcomeId: b.outcomeId }); continue }

    if (b.execution === 'completed' || b.execution === 'partial') {
      const partial = b.execution === 'partial'
      const source: ScopeSource = { type: fromQuick ? 'quick' : 'block', id: b.id, at }
      if (b.outcomeId && !partial) { add(b.outcomeId, source, { revisionPurpose, weight: 1 }); continue }
      if (confirmed.length > 0) { for (const oid of confirmed) add(oid, source, { revisionPurpose, weight: partial ? 0.5 : 1 }); continue }
      if (b.outcomeId && partial) { add(b.outcomeId, source, { revisionPurpose, weight: 0.5 }); continue }
      if (readingId) unresolved.push({ blockId: b.id, title: b.title, readingId, reason: partial ? 'partial' : 'reading_level' })
      continue
    }
    // not_started / in_progress: only "not completed" once its day has passed.
    if (at && at < input.today) excluded.push({ blockId: b.id, title: b.title, reason: 'not_completed', readingId, outcomeId: b.outcomeId })
  }

  // Actual attended class coverage (a class that was scheduled but not logged adds nothing).
  for (const c of input.classItems) {
    add(c.outcomeId, { type: 'class', id: c.sessionId, at: c.classDate }, { revisionPurpose: c.kind === 'revision', weight: c.extent === 'full' ? 1 : 0.5 })
  }

  const list = [...targets.values()].sort((a, b) => a.outcomeId.localeCompare(b.outcomeId))
  const byReading = new Map<string, CompletedCycleScope['readings'][number]>()
  for (const t of list) {
    const r = byReading.get(t.readingId) ?? { readingId: t.readingId, subjectId: t.subjectId, pageCount: input.readings.get(t.readingId)?.pageCount ?? 0, outcomeIds: [], newCount: 0, revisionCount: 0 }
    r.outcomeIds.push(t.outcomeId); if (t.kind === 'new') r.newCount++; else r.revisionCount++
    byReading.set(t.readingId, r)
  }
  const readings = [...byReading.values()].sort((a, b) => a.readingId.localeCompare(b.readingId))
  const totals = {
    outcomes: list.length, readings: readings.length, subjects: new Set(list.map(t => t.subjectId)).size,
    newOutcomes: list.filter(t => t.kind === 'new').length, revisionOutcomes: list.filter(t => t.kind === 'revision').length,
    pages: readings.reduce((s, r) => s + r.pageCount, 0),
  }
  excluded.sort((a, b) => a.blockId.localeCompare(b.blockId)); unresolved.sort((a, b) => a.blockId.localeCompare(b.blockId))
  const revision = createHash('sha1').update(JSON.stringify({
    c: input.cycle?.id ?? null,
    t: list.map(t => [t.outcomeId, t.kind, t.weight, t.sources.map(s => `${s.type}:${s.id}`).sort()]),
    u: unresolved.map(u => u.blockId),
  })).digest('hex').slice(0, 16)

  return { cycle: input.cycle, targets: list, excluded, unresolved, readings, totals, revision }
}
