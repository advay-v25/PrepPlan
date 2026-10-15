import { createAdminClient } from '../supabase/admin'
import { reduceConceptEvidence } from '../diagnostic/conceptSummary'
import { checkMark, outcomeVerdict, toLevel, type MarkCheck, type ObsVerdict, type SelfMark } from './confidence'
import {
  BAND_METHOD, classifyLos, countBands, deriveProgress, sortForStudy,
  type BandCounts, type ClassCoverage, type LosBand, type LosEvidenceInput, type TrackerRow,
} from './losTracker'

/** One reading (a card on the Curriculum page), with its outcomes as rows. */
export type TrackerModule = {
  selfMark: SelfMark | null
  markCheck: MarkCheck
  verdict: ObsVerdict | 'none'
  needsRevision: boolean
  id: string
  readingNo: number
  name: string
  coverage: 'not_started' | 'taught' | 'studied' | 'verified' | 'decaying'
  /** Outcome rows exist (false for readings whose structure is still pending). */
  tracked: boolean
  counts: BandCounts
  rows: TrackerRow[]
}

export type TrackerTopic = { id: string; name: string; counts: BandCounts; modules: TrackerModule[] }

export type LosTracker = {
  generatedAt: string
  totals: BandCounts
  topics: TrackerTopic[]
  /** Repair rows first, then verify — the order to work in. */
  studyOrder: TrackerRow[]
  depth: { outcomes: number; withEvidence: number; readings: number; trackedReadings: number }
}

const COVERAGE_RANK = { not_started: 0, decaying: 1, taught: 2, studied: 3, verified: 4 } as const

/**
 * The student's readiness per 2027 learning outcome, computed live from what
 * they have demonstrated. Read-only; every query is scoped to the user.
 *
 * Evidence is recorded against test concepts and reaches an outcome through
 * concept_outcome_map. Class coverage and scheduled work are shown beside a
 * row but never move its band: activity is not understanding.
 */
export async function getLosTracker(userId: string, now = new Date()): Promise<LosTracker> {
  const admin = createAdminClient()

  const [topicsRes, readingsRes, losRes, mapRes, conceptsRes, eventsRes, threadsRes, blocksRes, stateRes, itemsRes, marksRes, overridesRes] = await Promise.all([
    admin.from('topics').select('id, name, default_sequence').order('default_sequence'),
    admin.from('curriculum_readings').select('id, reading_no, topic_id, title, sequence, structure_pending, legacy_module_ids').eq('is_active', true).order('sequence'),
    admin.from('reading_los').select('id, reading_id, code, title, sequence').order('sequence'),
    admin.from('concept_outcome_map').select('concept_id, outcome_id'),
    admin.from('curriculum_concepts').select('id, name, manifest:curriculum_manifests!inner(is_active)'),
    admin.from('evidence_events').select('*').eq('user_id', userId).eq('evidence_mode', 'evidence')
      .order('created_at', { ascending: true }).order('id', { ascending: true }),
    admin.from('repair_threads').select('id, concept_id, status, occurrence_count, next_recheck_due_at')
      .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled']),
    admin.from('plan_blocks').select('repair_thread_id, concept_id, outcome_id, execution, updated_at').eq('user_id', userId)
      .or('repair_thread_id.not.is.null,concept_id.not.is.null,outcome_id.not.is.null'),
    admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', userId),
    admin.from('class_session_items').select('outcome_id, extent, class_sessions!inner(user_id, kind)').eq('class_sessions.user_id', userId),
    admin.from('confidence_marks').select('scope_type, scope_id, level').eq('user_id', userId),
    admin.from('evidence_overrides').select('outcome_id, overridden_band, reason, created_at').eq('user_id', userId).is('revoked_at', null),
  ])
  for (const [what, r] of [['topics', topicsRes], ['readings', readingsRes], ['outcomes', losRes], ['mapping', mapRes], ['concepts', conceptsRes],
    ['evidence', eventsRes], ['repairs', threadsRes], ['tasks', blocksRes], ['coverage', stateRes], ['class log', itemsRes], ['marks', marksRes], ['overrides', overridesRes]] as const) {
    if (r.error) throw new Error(`Could not read ${what}: ${r.error.message}`)
  }

  const conceptName = new Map((conceptsRes.data ?? []).filter((c: any) => c.manifest?.is_active).map((c: any) => [c.id as string, c.name as string]))
  const conceptsByOutcome = new Map<string, string[]>()
  for (const m of mapRes.data ?? []) {
    if (!conceptName.has(m.concept_id as string)) continue
    conceptsByOutcome.set(m.outcome_id as string, [...(conceptsByOutcome.get(m.outcome_id as string) ?? []), m.concept_id as string])
  }

  const eventsByConcept = new Map<string, any[]>()
  for (const e of eventsRes.data ?? []) {
    if (!e.concept_id) continue
    eventsByConcept.set(e.concept_id, [...(eventsByConcept.get(e.concept_id) ?? []), e])
  }
  const threadByConcept = new Map((threadsRes.data ?? []).map(t => [t.concept_id as string, t]))
  type Blk = { execution: string; at: string | null }
  const blocksByThread = new Map<string, Blk[]>(), blocksByConcept = new Map<string, Blk[]>(), blocksByOutcome = new Map<string, Blk[]>()
  for (const b of blocksRes.data ?? []) {
    const blk: Blk = { execution: b.execution as string, at: (b.updated_at ?? null) as string | null }
    if (b.repair_thread_id) blocksByThread.set(b.repair_thread_id, [...(blocksByThread.get(b.repair_thread_id) ?? []), blk])
    if (b.concept_id) blocksByConcept.set(b.concept_id, [...(blocksByConcept.get(b.concept_id) ?? []), blk])
    if (b.outcome_id) blocksByOutcome.set(b.outcome_id, [...(blocksByOutcome.get(b.outcome_id) ?? []), blk])
  }

  // What the student logged from class (exposure only).
  const classByOutcome = new Map<string, ClassCoverage>()
  for (const i of (itemsRes.data ?? []) as any[]) {
    if (!['covered', 'revision'].includes(i.class_sessions?.kind)) continue
    const prev = classByOutcome.get(i.outcome_id) ?? 'none'
    classByOutcome.set(i.outcome_id, i.extent === 'full' || prev === 'full' ? 'full' : 'part')
  }
  const markOf = new Map((marksRes.data ?? []).map(m => [`${m.scope_type}:${m.scope_id}`, m.level as SelfMark]))
  const overrideOf = new Map((overridesRes.data ?? []).map(o => [o.outcome_id as string, { band: o.overridden_band as LosBand, reason: o.reason as string, at: o.created_at as string }]))
  const legacyState = new Map((stateRes.data ?? []).map(r => [r.lm_id as string, r.coverage_state as keyof typeof COVERAGE_RANK]))

  const rowFor = (o: any, readingId: string): TrackerRow => {
    const cids = conceptsByOutcome.get(o.id) ?? []
    const events = cids.flatMap(c => eventsByConcept.get(c) ?? [])
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)))
    const threads = cids.map(c => threadByConcept.get(c)).filter(Boolean) as any[]
    const thread = threads[0]
    const summary = events.length ? reduceConceptEvidence(events, o.title, thread?.id) : null
    const occurrences = Math.max(0, ...threads.map(t => Number(t.occurrence_count ?? 1)))
    const evidence: LosEvidenceInput | null = summary ? {
      state: summary.current_state as LosEvidenceInput['state'],
      validSampleSize: summary.valid_sample_size,
      confidenceMismatch: summary.confidence_mismatch,
      latestAt: summary.latest_eligible_evidence_at,
      hasOpenRepair: threads.length > 0,
      repairOccurrences: occurrences,
    } : (thread ? {
      state: 'needs_repair', validSampleSize: 1, confidenceMismatch: false, latestAt: null,
      hasOpenRepair: true, repairOccurrences: occurrences || 1,
    } : null)

    const classified = classifyLos(evidence, now)
    const { band } = classified
    const observations = events.filter(e => e.validity === 'valid')
      .map(e => ({ correct: Boolean(e.is_correct), level: toLevel(e.self_reported_confidence as number | null), at: String(e.created_at) }))
    const ov = outcomeVerdict(observations, now)
    // The verdict explains a Repair/Verify band more precisely (misconception vs known gap vs guess).
    const rationale = (band === 'repair' || band === 'verify') && ov.verdict !== 'none' && ov.verdict !== 'unsettled' && ov.verdict !== 'secure'
      ? ov.reason : classified.rationale
    const selfMark = markOf.get(`outcome:${o.id}`) ?? null
    const mc = checkMark(selfMark, ov.verdict)
    const linked = [
      ...threads.flatMap(t => blocksByThread.get(t.id as string) ?? []),
      ...cids.flatMap(c => blocksByConcept.get(c) ?? []),
      ...(blocksByOutcome.get(o.id) ?? []),
    ]
    const progress = deriveProgress({
      band, hasOpenRepair: threads.length > 0,
      hasScheduledWork: linked.some(x => x.execution !== 'completed' && x.execution !== 'cancelled' && x.execution !== 'skipped'),
      // Work counts as "done since the last evidence" only if it was completed AFTER that evidence:
      // study done before a test that then missed is not repair work.
      workCompleted: linked.some(x => x.execution === 'completed' && (!evidence?.latestAt || (x.at !== null && x.at > evidence.latestAt))),
      nextRecheckDueAt: (thread?.next_recheck_due_at as string | null | undefined) ?? null,
    }, now)

    const method = band === 'untested' ? null : BAND_METHOD[band]
    return {
      outcomeId: o.id as string, readingId, classCoverage: classByOutcome.get(o.id) ?? 'none',
      verdict: ov.verdict, selfMark, markCheck: mc.check, needsRevision: mc.needsRevision, override: overrideOf.get(o.id as string) ?? null,
      los: o.code as string, name: o.title as string, importance: 'core', scopeNote: null,
      band, rationale, progress,
      sample: evidence?.validSampleSize ?? 0, lastCheckedAt: evidence?.latestAt ?? null,
      confidenceMismatch: evidence?.confidenceMismatch ?? false,
      howToImprove: method ? method.howToImprove(o.title as string) : null,
      proof: method?.proof ?? null, questionRange: method?.questionRange ?? null,
    }
  }

  const losByReading = new Map<string, any[]>()
  for (const o of losRes.data ?? []) losByReading.set(o.reading_id as string, [...(losByReading.get(o.reading_id as string) ?? []), o])

  const modulesByTopic = new Map<string, TrackerModule[]>()
  for (const r of readingsRes.data ?? []) {
    const rows = sortForStudy((losByReading.get(r.id as string) ?? []).map(o => rowFor(o, r.id as string)))
    // Reading coverage: the strongest of a legacy self-report and what was logged from class.
    let coverage: TrackerModule['coverage'] = legacyState.get(r.id as string) ?? 'not_started'
    for (const lm of (r.legacy_module_ids ?? []) as string[]) {
      const st = legacyState.get(lm)
      if (st && COVERAGE_RANK[st] > COVERAGE_RANK[coverage]) coverage = st
    }
    if (rows.some(x => x.classCoverage !== 'none') && COVERAGE_RANK.taught > COVERAGE_RANK[coverage]) coverage = 'taught'
    const PRIORITY = ['concept_miss', 'known_gap', 'guess', 'unsettled', 'secure'] as const
    const readingVerdict = PRIORITY.find(v => rows.some(x => x.verdict === v)) ?? 'none'
    const readingMark = markOf.get(`reading:${r.id}`) ?? null
    const readingCheck = checkMark(readingMark, readingVerdict)
    const mod: TrackerModule = {
      selfMark: readingMark, markCheck: readingCheck.check, verdict: readingVerdict, needsRevision: readingCheck.needsRevision,
      id: r.id as string, readingNo: r.reading_no as number, name: r.title as string,
      coverage, tracked: rows.length > 0 && !r.structure_pending, counts: countBands(rows), rows,
    }
    modulesByTopic.set(r.topic_id as string, [...(modulesByTopic.get(r.topic_id as string) ?? []), mod])
  }

  const topics: TrackerTopic[] = (topicsRes.data ?? [])
    .map(t => ({ id: t.id as string, name: t.name as string, modules: modulesByTopic.get(t.id as string) ?? [] }))
    .filter(t => t.modules.length > 0)
    .map(t => ({ ...t, counts: countBands(t.modules.flatMap(m => m.rows)) }))

  const allRows = topics.flatMap(t => t.modules.flatMap(m => m.rows))
  return {
    generatedAt: now.toISOString(),
    totals: countBands(allRows),
    topics,
    studyOrder: sortForStudy(allRows).filter(r => r.band === 'repair' || r.band === 'verify'),
    depth: {
      outcomes: allRows.length,
      withEvidence: allRows.filter(r => r.band !== 'untested').length,
      readings: topics.reduce((s, t) => s + t.modules.length, 0),
      trackedReadings: topics.reduce((s, t) => s + t.modules.filter(m => m.tracked).length, 0),
    },
  }
}
