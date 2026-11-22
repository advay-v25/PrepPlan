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
  revision?: number
  loggedLearning?: boolean
  /** True until every sitting of a split has completed, including other cycles. */
  scopePending?: boolean
}
/** `inCycle: false` = a session from an earlier week: it can only keep a portion pending, never add scope. */
export type ClassItemRow = { sessionId: string; classDate: string; classLabel?: string | null; kind: 'covered' | 'revision'; outcomeId: string; extent: 'part' | 'full' | 'continued'; studiedInClass: boolean; inCycle?: boolean }

export type ScopeSource = { type: 'block' | 'class' | 'quick'; id: string; at: string | null; label?: string | null }

export type ScopeTarget = {
  outcomeId: string; readingId: string; subjectId: string; kind: ScopeKind
  /** 1 = covered in full; 0.5 = only part of it was covered. */
  weight: number
  sources: ScopeSource[]
}

export type ExclusionReason = 'postponed' | 'missed' | 'not_completed' | 'structure_pending'
export type ExcludedBlock = { blockId: string; title: string; reason: ExclusionReason; readingId: string | null; outcomeId: string | null }
export type UnresolvedBlock = { blockId: string; title: string; readingId: string; reason: 'reading_level' | 'partial' | 'split' | 'class_part'; revision?: number; outcomeId?: string | null }

/**
 * Only a class item logged "All of it" (`full`) says the whole outcome was covered. "Part of it" and "Continued from before" are PROGRESS: continuing study
 * never establishes the whole. Historical `continued` rows are read this way too (conservative; papers already reserved keep their frozen scope).
 * A class item logged as "part of it" (a bounded portion). Which questions test only that portion is not represented (no verified concept-level
 * confirmation exists), so the outcome is NOT testable from this log: it stays here, visibly pending, until the whole outcome is confirmed
 * (a later class logged as all of it or continued, or a study task for the outcome that is not the class's partial consolidation).
 * A free-text note is never evidence of which questions are in scope.
 */
export type PendingPortion = { outcomeId: string; readingId: string; sessionId: string; classDate: string; classLabel?: string | null; extent: 'part' | 'continued' }

export type CompletedCycleScope = {
  cycle: { id: string; startsAt: string; endsAt: string } | null
  targets: ScopeTarget[]
  pendingPortions: PendingPortion[]
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
  /** block id -> the class session its lineage started from (the task, its split sittings and its weekly continuations; any week). */
  classBlockSessions?: Map<string, string>
  /** Outcomes whose WHOLE coverage was explicitly established in an earlier week (an "All of it" class, a confirmation, a separate whole-outcome task). */
  priorWhole?: Set<string>
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
  const pendingPortions: PendingPortion[] = []
  const partKey = (sessionId: string, outcomeId: string) => `${sessionId}|${outcomeId}`
  const partItems = new Set(input.classItems.filter(c => c.extent !== 'full').map(c => partKey(c.sessionId, c.outcomeId)))

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
    const readingId = (b.outcomeId ? input.outcomes.get(b.outcomeId)?.readingId : null) ?? b.readingId
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
      const partial = b.execution === 'partial' || Boolean(b.scopePending)
      const source: ScopeSource = { type: fromQuick || b.loggedLearning ? 'quick' : 'block', id: b.id, at }
      // Consolidating "the part covered in class" is not the whole outcome, however fully that task was done.
      // Only an explicit confirmation of the outcome (the student's own answer) makes it whole.
      const sid = input.classBlockSessions?.get(b.id)
      if (b.outcomeId && sid && partItems.has(partKey(sid, b.outcomeId))) {
        if (confirmed.includes(b.outcomeId)) add(b.outcomeId, source, { revisionPurpose, weight: partial ? 0.5 : 1 })
        else if (reading) unresolved.push({ blockId: b.id, title: b.title, readingId: reading.id, reason: b.scopePending ? 'split' : 'class_part', revision: b.revision, outcomeId: b.outcomeId })
        continue
      }
      if (b.outcomeId && !partial) { add(b.outcomeId, source, { revisionPurpose, weight: 1 }); continue }
      if (confirmed.length > 0) { for (const oid of confirmed) add(oid, source, { revisionPurpose, weight: partial ? 0.5 : 1 }); continue }
      if (readingId) unresolved.push({ blockId: b.id, title: b.title, readingId, reason: b.scopePending ? 'split' : partial ? 'partial' : 'reading_level', revision: b.revision, outcomeId: b.outcomeId })
      continue
    }
    // not_started / in_progress: only "not completed" once its day has passed.
    if (at && at < input.today) excluded.push({ blockId: b.id, title: b.title, reason: 'not_completed', readingId, outcomeId: b.outcomeId })
  }

  // Actual attended class coverage (a class that was scheduled but not logged adds nothing).
  for (const c of input.classItems) {
    if (c.extent !== 'full') {
      const o = input.outcomes.get(c.outcomeId)
      if (o) pendingPortions.push({ outcomeId: c.outcomeId, readingId: o.readingId, sessionId: c.sessionId, classDate: c.classDate, classLabel: c.classLabel, extent: c.extent })
      continue
    }
    if (c.inCycle === false) continue
    add(c.outcomeId, { type: 'class', id: c.sessionId, at: c.classDate, label: c.classLabel }, { revisionPurpose: c.kind === 'revision', weight: 1 })
  }

  // A portion is pending only while nothing confirms the whole outcome.
  const pending = pendingPortions.filter(p => !targets.has(p.outcomeId) && !input.priorWhole?.has(p.outcomeId)).sort((a, b) => a.outcomeId.localeCompare(b.outcomeId) || a.sessionId.localeCompare(b.sessionId))
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
    u: unresolved.map(u => u.blockId), p: pending.map(x => `${x.outcomeId}:${x.sessionId}`),
  })).digest('hex').slice(0, 16)

  return { cycle: input.cycle, targets: list, pendingPortions: pending, excluded, unresolved, readings, totals, revision }
}
