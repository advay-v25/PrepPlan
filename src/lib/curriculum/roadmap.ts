import { addDays, daysBetween } from '../planning/studyWeek'
import { UNCERTAINTY_WEIGHT, type ModuleUncertainty, type MockKind } from './entryContext'

/**
 * The long-term roadmap.
 *
 * This is the part of the product that decides how and when everything gets
 * studied, where tests fall, and what "behind" means. Four rules govern it:
 *
 *  1. **The final phase is reserved first.** Mocks and final review get their
 *     weeks before anything else is allocated, so a first pass can never eat
 *     them by drifting.
 *  2. **Scope is allocated to weeks, not hours to days.** A nine-month daily
 *     schedule is a fiction; a range of weeks per topic is a commitment that
 *     can survive contact with a real month.
 *  3. **Effort is relative, never prescriptive.** A module's effort band says
 *     FSA is roughly twice Derivatives. It never claims a number of hours.
 *  4. **Milestones are ranges.** An exact completion date nine months out
 *     would be precision the plan does not have.
 */

export type Phase = 'first_pass' | 'consolidation' | 'revision' | 'final'

export const PHASE_LABEL: Record<Phase, string> = {
  first_pass: 'First pass',
  consolidation: 'Consolidation',
  revision: 'Revision and mixed practice',
  final: 'Final preparation',
}

export const PHASE_PURPOSE: Record<Phase, string> = {
  first_pass: 'Learn and verify the whole curriculum once.',
  consolidation: 'Revisit weak links, connections between topics, and evidence that has gone stale.',
  revision: 'Cumulative practice across topics, not one topic at a time.',
  final: 'Mocks under exam conditions, repair, and final checks. Reserved before anything else is planned.',
}

/** §7.1: the last eight weeks belong to final preparation whenever the horizon allows. */
export const FINAL_PHASE_WEEKS = 8
/**
 * §7.1: with nine months the first pass must be done inside seven. That is a
 * ceiling, not a target — a first pass that actually runs seven months leaves
 * one week for consolidation and revision, which is not a plan.
 */
export const FIRST_PASS_MAX_SHARE = 7 / 9
/**
 * The share of the pre-final weeks the first pass aims for. The rest goes to
 * consolidation and revision, which is where a first pass turns into recall.
 */
export const FIRST_PASS_TARGET_SHARE = 0.65

/**
 * A starting estimate of minutes per unit of effort, used only until the
 * student's own pace has been measured.
 *
 * Without this, feasibility could never be answered at the end of onboarding —
 * the real rate needs completed work, and there is none on day one. So a
 * student who has just told us exactly when they can study would still be told
 * "unknown", which makes collecting availability pointless.
 *
 * D13 permits internal effort estimation for sizing; what it forbids is telling
 * the student they must do N hours. The verdict below is therefore always
 * labelled as provisional while this prior is in use.
 */
export const SEEDED_MINUTES_PER_EFFORT_UNIT = 85

export type ModuleInput = {
  id: string
  topic: string
  name: string
  effortBand: number
  difficulty: number
  sequence: number
  /** What the student has already done. Completed work is not re-planned. */
  coverage: 'not_started' | 'taught' | 'studied' | 'verified' | 'decaying'
  /** What the student reported feeling unsure of (planning context, not evidence). Absent when not answered. */
  uncertainty?: ModuleUncertainty | null
}

export type TopicInput = {
  id: string
  name: string
  weightMin: number
  weightMax: number
  sequence: number
}

export type RoadmapInput = {
  /** First day the roadmap can plan into — usually the start of the current study week. */
  startDate: string
  /** The exam date. */
  targetDate: string
  /** Whether targetDate is the student's booked date, or only the start of the sitting they aimed for. Absent on roadmaps saved earlier. */
  targetKind?: 'booked' | 'sitting'
  topics: TopicInput[]
  modules: ModuleInput[]
  prerequisites: { from: string; to: string }[]
  route: 'self_study' | 'coaching' | 'hybrid'
  /**
   * Set once a class-led or hybrid student's classes have finished (auto-detected from a recurring class's
   * `ends_on`, or the student's own confirmation — see profiles.classes_completed_at). Null means classes are
   * still assumed ongoing. Ignored for self_study, which has no class period to finish.
   *
   * This is what moves a class-led student into the same consolidation/revision/final structure a self-study
   * student reaches after their own first pass (§ below). Without it, "first pass" for a class-led student was
   * just a date fraction of the exam countdown — identical maths to self-study, with no actual connection to
   * whether the course had finished teaching the syllabus.
   */
  classesCompletedDate?: string | null
  /**
   * Minutes the student actually has available in a typical week, derived from
   * their availability and commitments — observed, not self-estimated. Used
   * only to judge feasibility, never to invent per-module hours.
   */
  weeklyCapacityMinutes?: number | null
  /**
   * Observed minutes per unit of effort, once there is completion data.
   * Absent on a first roadmap; C4 fits it from actual completions.
   */
  observedMinutesPerEffortUnit?: number | null
  /**
   * The student's reported starting position beyond coverage. Present for every onboarded student; absent in
   * pure-planner fixtures, which then behave exactly as before.
   */
  entry?: { mockDate: string | null; mockKind: MockKind | null; mockLabel?: string | null; mockStartTime?: string | null; appointments?: { id: string; version: number; date: string; kind: MockKind; label: string | null; startTime: string | null }[]; token: string }
}

export type PhaseSpan = {
  phase: Phase
  startWeek: number
  endWeek: number
  startDate: string
  endDate: string
  weeks: number
}

export type Milestone = {
  phase: Phase
  topicId: string
  topicName: string
  moduleIds: string[]
  sequence: number
  startWeek: number
  endWeek: number
  startDate: string
  endDate: string
  effortWeight: number
  /** Modules already done, excluded from the remaining work but still shown. */
  completedModuleIds: string[]
  /** Why this topic is here, when that is not just its weight: the student reported it, or a mock is coming. */
  basis?: 'reported_uncertainty' | 'mock_preparation'
}

export type Feasibility = {
  verdict: 'comfortable' | 'tight' | 'not_enough_time' | 'unknown'
  totalWeeks: number
  usableWeeks: number
  remainingEffort: number
  /**
   * Effort units the plan asks of a typical week. Comparable across roadmaps;
   * meaningless as an absolute.
   */
  effortPerWeek: number
  weeklyCapacityMinutes: number | null
  requiredMinutesPerWeek: number | null
  /** False while the estimate uses the seeded prior rather than measured pace. */
  rateIsObserved: boolean
  message: string
  /** Concrete things that would make the plan fit, when it does not. */
  options: string[]
}

export type Roadmap = {
  startDate: string
  targetDate: string
  targetKind?: 'booked' | 'sitting'
  totalWeeks: number
  phases: PhaseSpan[]
  milestones: Milestone[]
  feasibility: Feasibility
  /** True when the horizon is too short for a real first pass (§7.1). */
  compressed: boolean
  sequencedModuleIds: string[]
  /** Dated checkpoints the plan works around. A mock never replaces the exam date. */
  checkpoints: { kind: 'mock'; id?: string; date: string; week: number; mockKind: MockKind | null; label?: string | null; startTime?: string | null }[]
  /** Things the plan assumed because the student's answer was broad. Shown, never hidden. */
  assumptions: string[]
  /** Calm notes about timing that do not block anything. */
  warnings: string[]
}

const COMPLETED: ModuleInput['coverage'][] = ['verified']
/** Partly-covered work still needs time, but less of it. */
const PARTIAL_DISCOUNT: Record<ModuleInput['coverage'], number> = {
  not_started: 1, taught: 0.6, studied: 0.4, verified: 0, decaying: 0.5,
}

/**
 * Orders modules so no module precedes its prerequisites.
 *
 * Kahn's algorithm, with ties broken by the curriculum's own teaching order.
 * A cycle would mean the graph is wrong; rather than loop forever the remaining
 * modules are appended in sequence order and reported by the caller's tests.
 */
export function sequenceModules(
  modules: ModuleInput[],
  prerequisites: { from: string; to: string }[],
  topics: TopicInput[]
): string[] {
  const byId = new Map(modules.map(m => [m.id, m]))
  const topicOrder = new Map(topics.map(t => [t.id, t.sequence]))

  const indegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const m of modules) { indegree.set(m.id, 0); dependents.set(m.id, []) }

  for (const edge of prerequisites) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
    dependents.get(edge.from)!.push(edge.to)
  }

  const rank = (id: string) => {
    const m = byId.get(id)!
    return (topicOrder.get(m.topic) ?? 99) * 1000 + m.sequence
  }

  const ready = modules.filter(m => (indegree.get(m.id) ?? 0) === 0).map(m => m.id)
  ready.sort((a, b) => rank(a) - rank(b))

  const out: string[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    out.push(id)
    for (const next of dependents.get(id) ?? []) {
      const remaining = (indegree.get(next) ?? 0) - 1
      indegree.set(next, remaining)
      if (remaining === 0) {
        // Insert in rank order rather than re-sorting the whole frontier.
        const at = ready.findIndex(r => rank(r) > rank(next))
        at === -1 ? ready.push(next) : ready.splice(at, 0, next)
      }
    }
  }

  if (out.length < modules.length) {
    const placed = new Set(out)
    const stranded = modules.filter(m => !placed.has(m.id)).sort((a, b) => rank(a.id) - rank(b.id))
    out.push(...stranded.map(m => m.id))
  }
  return out
}

/**
 * Divides the horizon into phases, reserving the final phase first.
 *
 * With a short horizon the plan compresses honestly rather than pretending: a
 * student joining six weeks out gets a final-preparation roadmap, not an
 * impossible first pass.
 *
 * `skipFirstPass` is for a class-led student whose classes have finished: there is no first pass left for the
 * roadmap to run (the class already was it), so every pre-final week goes to consolidation and revision —
 * the same split self-study's own first pass leads into, just starting from week 1 instead of after it.
 */
/** Whole weeks leave 1–6 trailing days; the last phase owns them, so every day up to the target belongs to a phase. */
function stretchToTarget(phases: PhaseSpan[], targetDate: string) {
  const last = phases[phases.length - 1]
  if (last && last.endDate < targetDate) last.endDate = targetDate
}

export function buildPhases(
  startDate: string, targetDate: string, options: { skipFirstPass?: boolean; firstPassShare?: number } = {}
): { phases: PhaseSpan[]; compressed: boolean } {
  const totalDays = daysBetween(startDate, targetDate)
  const totalWeeks = Math.max(1, Math.floor(totalDays / 7))

  const weekSpan = (startWeek: number, weeks: number, phase: Phase): PhaseSpan => ({
    phase,
    startWeek,
    endWeek: startWeek + weeks - 1,
    startDate: addDays(startDate, (startWeek - 1) * 7),
    endDate: addDays(startDate, (startWeek + weeks - 1) * 7 - 1),
    weeks,
  })

  // Too short for a first pass: everything is final preparation, and the plan
  // says so instead of inventing a curriculum sweep that cannot happen.
  if (totalWeeks <= FINAL_PHASE_WEEKS) {
    const only = [weekSpan(1, totalWeeks, 'final')]
    stretchToTarget(only, targetDate)
    return { phases: only, compressed: true }
  }

  const finalWeeks = FINAL_PHASE_WEEKS
  const usable = totalWeeks - finalWeeks

  // Two bounds. The target keeps consolidation and revision real; the cap
  // enforces §7.1 for horizons where the target alone would still run long.
  const firstPassCap = Math.floor(totalWeeks * FIRST_PASS_MAX_SHARE)
  const firstPassTarget = Math.round(usable * FIRST_PASS_TARGET_SHARE)
  const fullFirstPass = Math.max(1, Math.min(usable, firstPassTarget, firstPassCap))
  // A partly finished first pass keeps the pace a fresh one would have: weeks scale with the work still to do.
  const firstPassWeeks = options.skipFirstPass ? 0 : Math.min(fullFirstPass, Math.max(1, Math.ceil(fullFirstPass * (options.firstPassShare ?? 1))))

  const remainder = usable - firstPassWeeks
  // Revision takes the larger share: mixed practice is closer to the exam and
  // is what the final phase builds on. Consolidation still gets a week whenever
  // there are two to divide, because skipping it entirely loses the phase.
  const consolidationWeeks = remainder >= 2 ? Math.max(1, Math.floor(remainder * 0.45)) : 0
  const revisionWeeks = remainder - consolidationWeeks

  const phases: PhaseSpan[] = []
  let cursor = 1
  if (firstPassWeeks > 0) { phases.push(weekSpan(cursor, firstPassWeeks, 'first_pass')); cursor += firstPassWeeks }
  if (consolidationWeeks > 0) { phases.push(weekSpan(cursor, consolidationWeeks, 'consolidation')); cursor += consolidationWeeks }
  if (revisionWeeks > 0) { phases.push(weekSpan(cursor, revisionWeeks, 'revision')); cursor += revisionWeeks }
  phases.push(weekSpan(cursor, finalWeeks, 'final'))
  stretchToTarget(phases, targetDate)
  return { phases, compressed: false }
}

/**
 * What a module still needs as FIRST-PASS work. Distinct from remainingEffort (which also prices revisiting covered
 * material): a module studied once needs no first pass, only revision. "Partly covered" with no exact scope is
 * assumed to leave 60% of the module, and the plan says so.
 */
const FIRST_PASS_REMAINING: Record<ModuleInput['coverage'], number> = { not_started: 1, taught: 0.6, studied: 0, verified: 0, decaying: 0 }
export function firstPassEffort(module: ModuleInput): number {
  return module.effortBand * (1 + (module.difficulty - 3) * 0.08) * (FIRST_PASS_REMAINING[module.coverage] ?? 1)
}
export const isFirstPassPending = (m: ModuleInput) => FIRST_PASS_REMAINING[m.coverage] > 0

/** The work a module still represents, after what the student has already done. */
export function remainingEffort(module: ModuleInput): number {
  const discount = PARTIAL_DISCOUNT[module.coverage] ?? 1
  // Difficulty nudges effort without dominating it: a hard module takes longer
  // than an easy one of the same size, but not twice as long.
  return module.effortBand * (1 + (module.difficulty - 3) * 0.08) * discount
}

export function buildRoadmap(input: RoadmapInput): Roadmap {
  const classLed = input.route === 'coaching' || input.route === 'hybrid'
  const classesDone = classLed && input.classesCompletedDate != null
  // While classes are still running, the roadmap does not self-sequence new content at all — the class sets
  // the order (A3's route decision: only a live class anchors the sequence). It still reserves a first_pass
  // phase span so currentPhase() resolves and the UI has a label, but generates no milestones under it; the
  // actual first pass comes from attending class plus class_consolidation (classlog/consolidation.ts). Once
  // classes are confirmed done, first_pass collapses to zero weeks and the rest of this function treats it
  // exactly like self-study reaching the end of its own first pass: the whole pre-final span goes to
  // consolidation then revision, by the same proportional split.
  const classesStillRunning = classLed && !classesDone

  // First-pass work that is actually left. A student who has already covered a subject keeps the pace a fresh
  // student would have, so the first pass shrinks with the work; if nothing is left it is not scheduled at all.
  // Revising covered material is priced separately (remainingEffort) and happens in the later phases.
  const freshEffort = input.modules.reduce((sum, m) => sum + firstPassEffort({ ...m, coverage: 'not_started' }), 0)
  const remainingFirstPass = input.modules.reduce((sum, m) => sum + firstPassEffort(m), 0)
  const nothingLeft = !classesStillRunning && input.modules.length > 0 && remainingFirstPass === 0
  const { phases, compressed } = buildPhases(input.startDate, input.targetDate, {
    skipFirstPass: classesDone || nothingLeft,
    firstPassShare: !classesStillRunning && freshEffort > 0 ? remainingFirstPass / freshEffort : 1,
  })
  const totalWeeks = Math.max(1, Math.floor(daysBetween(input.startDate, input.targetDate) / 7))

  const sequencedModuleIds = sequenceModules(input.modules, input.prerequisites, input.topics)
  const byId = new Map(input.modules.map(m => [m.id, m]))
  const topicById = new Map(input.topics.map(t => [t.id, t]))

  // A mock is a checkpoint the plan works around, never a second exam date: one outside the horizon is ignored, with a note.
  const checkpoints: Roadmap['checkpoints'] = []
  const warnings: string[] = []
  // Every planned appointment of the canonical schedule is a checkpoint; the profile's single "next mock" is only a projection of the first.
  const mocks = input.entry?.appointments?.length ? input.entry.appointments
    : input.entry?.mockDate ? [{ id: undefined, date: input.entry.mockDate, kind: input.entry.mockKind, label: input.entry.mockLabel ?? null, startTime: input.entry.mockStartTime ?? null }] : []
  for (const m of mocks) {
    if (m.date < input.startDate) warnings.push('A mock date has already passed, so the plan does not use it. Update or clear it in Calendar.')
    else if (m.date >= input.targetDate) warnings.push('A mock is on or after your exam date, so the plan does not use it. Check both dates.')
    else {
      const week = Math.floor(daysBetween(input.startDate, m.date) / 7) + 1
      checkpoints.push({ kind: 'mock', id: m.id, date: m.date, week, mockKind: m.kind ?? null, label: m.label ?? null, startTime: m.startTime ?? null })
      if (checkpoints.length === 1 && week <= 2) warnings.push(`Your mock is about ${week === 1 ? 'a week' : 'two weeks'} away. The plan puts preparing for it first and keeps the rest light. It cannot recover time already gone, and nothing here promises a result.`)
    }
  }
  const mockWeek = checkpoints[0]?.week ?? null

  // How strongly a topic's revision priority is raised by what the student reported.
  const uncertaintyFactor = (topicId: string) =>
    input.modules.reduce((hi, m) => (m.topic === topicId && m.uncertainty ? Math.max(hi, UNCERTAINTY_WEIGHT[m.uncertainty.level]) : hi), 1)
  const basisFor = (topicId: string, week: number): Milestone['basis'] =>
    uncertaintyFactor(topicId) > 1 ? 'reported_uncertainty' : mockWeek !== null && week <= mockWeek ? 'mock_preparation' : undefined
  const weightOf = (topicId: string) => { const t = topicById.get(topicId); return t ? (t.weightMin + t.weightMax) / 2 : 0 }
  const avgDifficulty = (topicId: string) => {
    const mods = input.modules.filter(m => m.topic === topicId)
    return mods.length ? mods.reduce((sum, m) => sum + m.difficulty, 0) / mods.length : 3
  }

  const firstPass = phases.find(p => p.phase === 'first_pass')
  const milestones: Milestone[] = []

  // Group the sequence into runs of the same topic. A topic split across the
  // plan reads as two milestones, which is honest: that is what will happen.
  type Run = { topicId: string; moduleIds: string[] }
  const runs: Run[] = []
  for (const id of sequencedModuleIds) {
    const m = byId.get(id)
    if (!m) continue
    const last = runs[runs.length - 1]
    if (last && last.topicId === m.topic) last.moduleIds.push(id)
    else runs.push({ topicId: m.topic, moduleIds: [id] })
  }

  const runEffort = (run: Run) => run.moduleIds.reduce((sum, id) => sum + firstPassEffort(byId.get(id)!), 0)
  const totalRemaining = runs.reduce((sum, r) => sum + runEffort(r), 0)
  const isCovered = (m: ModuleInput) => m.coverage === 'verified' || m.coverage === 'studied'

  // While a class-led or hybrid route's classes are still running, first_pass content ordering belongs to
  // the class, not the planner (see the comment above classesDone) — so no first_pass milestones are
  // generated here. generateWeek.ts's pendingModules filter already only pulls modules whose milestone
  // belongs to the current phase, so simply not emitting first_pass milestones is enough to suppress
  // self-sequenced new content for that period; class_consolidation covers the actual work done.
  if (firstPass && totalRemaining > 0 && !classesStillRunning) {
    // Allocate the first pass's weeks in proportion to remaining effort. Runs
    // are laid end to end on a continuous scale and then read off as weeks, so
    // rounding cannot accumulate into a drift across sixty modules. A run with nothing left to do (a covered
    // subject) takes no weeks and has no milestone.
    let cursorEffort = 0
    runs.filter(run => runEffort(run) > 0).forEach((run, index) => {
      const effort = runEffort(run)
      const startFraction = cursorEffort / totalRemaining
      cursorEffort += effort
      const endFraction = cursorEffort / totalRemaining

      const startWeek = firstPass.startWeek + Math.floor(startFraction * firstPass.weeks)
      const endWeek = Math.max(startWeek, firstPass.startWeek + Math.ceil(endFraction * firstPass.weeks) - 1)
      const topic = topicById.get(run.topicId)

      milestones.push({
        phase: 'first_pass',
        topicId: run.topicId,
        topicName: topic?.name ?? run.topicId,
        moduleIds: run.moduleIds,
        completedModuleIds: run.moduleIds.filter(id => isCovered(byId.get(id)!)),
        sequence: index + 1,
        startWeek,
        endWeek: Math.min(endWeek, firstPass.endWeek),
        startDate: addDays(input.startDate, (startWeek - 1) * 7),
        endDate: addDays(input.startDate, Math.min(endWeek, firstPass.endWeek) * 7 - 1),
        effortWeight: Number(effort.toFixed(3)),
        })
    })
  }

  // Consolidation and revision get real content, not an empty band on a chart.
  //
  // Consolidation returns to the topics that carry the most exam weight and the
  // most difficulty — where a shaky first pass costs the most marks — raised by anything the student reported
  // as uncertain. Revision is a cumulative sweep of everything, because by then the exam tests recall
  // across topics rather than one at a time; when something is reported or a mock is coming, the sweep
  // starts with the topics that matter most instead of curriculum order.
  const consolidation = phases.find(p => p.phase === 'consolidation')
  if (consolidation) {
    const ranked = [...input.topics]
      .map(t => {
        const mods = input.modules.filter(m => m.topic === t.id)
        return { topic: t, mods, priority: ((t.weightMin + t.weightMax) / 2) * avgDifficulty(t.id) * uncertaintyFactor(t.id) }
      })
      .filter(r => r.mods.length > 0)
      .sort((a, b) => b.priority - a.priority)
      // One topic per week: fewer topics revisited properly beats all ten skimmed.
      .slice(0, consolidation.weeks)

    ranked.forEach((r, i) => {
      const week = consolidation.startWeek + i
      milestones.push({
        phase: 'consolidation',
        topicId: r.topic.id,
        topicName: r.topic.name,
        moduleIds: r.mods.map(m => m.id),
        completedModuleIds: r.mods.filter(isCovered).map(m => m.id),
        sequence: milestones.length + 1,
        startWeek: week,
        endWeek: week,
        startDate: addDays(input.startDate, (week - 1) * 7),
        endDate: addDays(input.startDate, week * 7 - 1),
        effortWeight: 0, // Revisiting is not new scope; it must not inflate the plan.
        basis: basisFor(r.topic.id, week),
      })
    })
  }

  const hasSignal = mockWeek !== null || input.topics.some(t => uncertaintyFactor(t.id) > 1)
  const bySignal = (topics: TopicInput[]) => hasSignal
    ? [...topics].sort((a, b) => weightOf(b.id) * uncertaintyFactor(b.id) - weightOf(a.id) * uncertaintyFactor(a.id) || a.sequence - b.sequence)
    : topics

  const revision = phases.find(p => p.phase === 'revision')
  if (revision && input.topics.length > 0) {
    // A cumulative sweep: every topic, spread across the revision weeks, so no
    // topic goes untouched between the first pass and the mocks.
    const perWeek = Math.ceil(input.topics.length / revision.weeks)
    const ordered = bySignal(input.topics)
    for (let w = 0; w < revision.weeks; w++) {
      const slice = ordered.slice(w * perWeek, (w + 1) * perWeek)
      if (slice.length === 0) continue
      const week = revision.startWeek + w
      const mods = input.modules.filter(m => slice.some(t => t.id === m.topic))
      milestones.push({
        phase: 'revision',
        topicId: slice[0].id,
        topicName: slice.length === 1 ? slice[0].name : `${slice.map(t => t.name).join(' and ')}`,
        moduleIds: mods.map(m => m.id),
        completedModuleIds: mods.filter(isCovered).map(m => m.id),
        sequence: milestones.length + 1,
        startWeek: week,
        endWeek: week,
        startDate: addDays(input.startDate, (week - 1) * 7),
        endDate: addDays(input.startDate, week * 7 - 1),
        effortWeight: 0,
        basis: slice.map(t => basisFor(t.id, week)).find(Boolean),
      })
    }
  }

  // Final preparation: one focus topic a week (the last week stays light), highest-priority first. Without this a
  // student with no open repairs would reach the exam stretch to an empty Calendar. Only for students whose
  // starting position is known, so it never changes a plan built without it.
  const final = phases.find(p => p.phase === 'final')
  if (final && input.entry && input.topics.length > 0) {
    const ordered = bySignal(input.topics).filter(t => input.modules.some(m => m.topic === t.id))
    const focusWeeks = Math.max(1, final.weeks - 1)
    for (let w = 0; w < focusWeeks && ordered.length > 0; w++) {
      const topic = ordered[w % ordered.length]
      const week = final.startWeek + w
      const mods = input.modules.filter(m => m.topic === topic.id)
      milestones.push({
        phase: 'final', topicId: topic.id, topicName: topic.name, moduleIds: mods.map(m => m.id),
        completedModuleIds: mods.filter(isCovered).map(m => m.id), sequence: milestones.length + 1,
        startWeek: week, endWeek: week, startDate: addDays(input.startDate, (week - 1) * 7), endDate: addDays(input.startDate, week * 7 - 1),
        effortWeight: 0, basis: basisFor(topic.id, week),
      })
    }
  }

  // What the plan assumed because an answer was broad. Shown to the student, never silently absorbed.
  const assumptions: string[] = []
  for (const t of input.topics) {
    const mods = input.modules.filter(m => m.topic === t.id)
    if (mods.some(m => m.coverage === 'taught')) assumptions.push(`${t.name}: marked partly covered. Without the exact readings, the plan assumes about 60% of it still needs a first pass.`)
    if (mods.some(m => m.uncertainty?.assumed)) assumptions.push(`${t.name}: you said some of it feels uncertain but not which readings, so revision starts with its first readings in order. Pick the readings in Settings to change that.`)
  }

  return {
    startDate: input.startDate,
    targetDate: input.targetDate,
    targetKind: input.targetKind,
    totalWeeks,
    phases,
    milestones,
    compressed,
    sequencedModuleIds,
    checkpoints, assumptions, warnings,
    feasibility: assessFeasibility(input, phases, totalRemaining, totalWeeks, compressed),
  }
}

/**
 * Whether the plan actually fits the time available.
 *
 * This is the part a student needs and most planners skip: not "here is a
 * schedule" but "here is whether this schedule is possible, and what has to
 * give if it is not."
 */
export function assessFeasibility(
  input: RoadmapInput,
  phases: PhaseSpan[],
  remainingEffortTotal: number,
  totalWeeks: number,
  compressed: boolean
): Feasibility {
  const firstPass = phases.find(p => p.phase === 'first_pass')
  // A class-led student whose classes are done has no first_pass phase at all (buildPhases skips it) — the
  // whole pre-final span plays the role first_pass would have, same as self-study treats it. Falling back to
  // 0 here would read every module as still unstarted work due in zero weeks and misreport the verdict as
  // impossible, the opposite of what finishing classes should do to feasibility.
  const usableWeeks = firstPass?.weeks
    ?? phases.filter(p => p.phase === 'consolidation' || p.phase === 'revision').reduce((sum, p) => sum + p.weeks, 0)
  const effortPerWeek = usableWeeks > 0 ? remainingEffortTotal / usableWeeks : 0

  const capacity = input.weeklyCapacityMinutes ?? null
  const rateIsObserved = input.observedMinutesPerEffortUnit != null
  const rate = input.observedMinutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  const requiredMinutes = capacity !== null ? effortPerWeek * rate : null

  // How the estimate is described depends entirely on whether it is measured.
  // Presenting a prior as if it were the student's own pace would be a lie they
  // would plan nine months around.
  const basis = rateIsObserved
    ? 'At the pace you have been working'
    : 'Using a planning assumption (a typical pace for this syllabus)'
  const caveat = rateIsObserved
    ? ''
    : ' This is a planning assumption, not your own pace. It becomes yours once enough finished modules have reported time.'

  // Nothing left to learn for the first time: pressure is about revision and the checkpoint, not about finishing a
  // syllabus. A short horizon alone is not a verdict on someone who has already covered the material.
  if (remainingEffortTotal === 0 && input.modules.length > 0) {
    return {
      verdict: compressed ? 'tight' : 'comfortable',
      totalWeeks, usableWeeks, remainingEffort: 0, effortPerWeek: 0,
      weeklyCapacityMinutes: capacity, requiredMinutesPerWeek: null, rateIsObserved,
      message: compressed
        ? `Plan pressure is moderate: ${totalWeeks} week${totalWeeks === 1 ? '' : 's'} to the exam. You told us the first pass is done, so this plan is revision, practice and mock preparation. It is built from your own estimate, so tests matter: they show how secure the material is. Nothing here guarantees readiness.`
        : 'No first-pass work is left, so this plan is revision, application and mock preparation. Your coverage is your own estimate, not a measurement: tests will show how secure it is.',
      options: compressed ? [
        'Start with the areas you flagged as uncertain',
        'Keep the highest-weighted topics in regular rotation',
        'Protect your study windows until the exam',
      ] : [],
    }
  }

  if (compressed) {
    return {
      verdict: 'not_enough_time',
      totalWeeks, usableWeeks, remainingEffort: Number(remainingEffortTotal.toFixed(1)),
      effortPerWeek: Number(effortPerWeek.toFixed(2)),
      weeklyCapacityMinutes: capacity, requiredMinutesPerWeek: requiredMinutes, rateIsObserved,
      message: `Plan pressure is high: with ${totalWeeks} weeks to the exam, a full first pass is not realistic. This roadmap is final preparation — mocks, targeted repair, and review of what you already know.`,
      options: [
        'Move the target to the following exam window, and keep this one as a practice run',
        'Narrow the near-term scope to the highest-weighted topics and accept gaps elsewhere',
        'Treat this window as diagnostic and plan properly for the next',
      ],
    }
  }

  // Only genuinely unknown when there is no availability to compare against.
  // A missing *rate* is filled by the seeded prior and labelled as provisional,
  // because refusing to answer a student who has just given us their week is
  // worse than answering with a stated assumption.
  if (capacity === null) {
    return {
      verdict: 'unknown',
      totalWeeks, usableWeeks, remainingEffort: Number(remainingEffortTotal.toFixed(1)),
      effortPerWeek: Number(effortPerWeek.toFixed(2)),
      weeklyCapacityMinutes: null, requiredMinutesPerWeek: null, rateIsObserved,
      message: `The shape of this plan is set, but how much pressure it puts on your week is not yet known — Roadmap needs your real study windows before it can say.`,
      options: ['Confirm the times you can actually study, in Settings'],
    }
  }

  const ratio = requiredMinutes! / capacity
  if (ratio <= 0.75) {
    return {
      verdict: 'comfortable',
      totalWeeks, usableWeeks, remainingEffort: Number(remainingEffortTotal.toFixed(1)),
      effortPerWeek: Number(effortPerWeek.toFixed(2)),
      weeklyCapacityMinutes: capacity, requiredMinutesPerWeek: Math.round(requiredMinutes!), rateIsObserved,
      message: `Plan pressure is low. ${basis}, your confirmed study windows comfortably cover the first pass, with room for the plan to slip without the exam date moving.${caveat}`,
      options: [],
    }
  }
  if (ratio <= 1.05) {
    return {
      verdict: 'tight',
      totalWeeks, usableWeeks, remainingEffort: Number(remainingEffortTotal.toFixed(1)),
      effortPerWeek: Number(effortPerWeek.toFixed(2)),
      weeklyCapacityMinutes: capacity, requiredMinutesPerWeek: Math.round(requiredMinutes!), rateIsObserved,
      message: `Plan pressure is moderate. ${basis}, the first pass fits your study windows with very little spare — a bad fortnight would put it behind.${caveat}`,
      options: [
        'Add a study window somewhere in the week to build slack',
        'Start with the heaviest topics while motivation is highest',
      ],
    }
  }
  return {
    verdict: 'not_enough_time',
    totalWeeks, usableWeeks, remainingEffort: Number(remainingEffortTotal.toFixed(1)),
    effortPerWeek: Number(effortPerWeek.toFixed(2)),
    weeklyCapacityMinutes: capacity, requiredMinutesPerWeek: Math.round(requiredMinutes!), rateIsObserved,
    message: `Plan pressure is high. ${basis}, the first pass would run past your confirmed study windows before the exam. Better to choose a direction now than to discover it in month four.${caveat}`,
    options: [
      'Protect or reclaim study time in your week',
      'Narrow the near-term scope to the highest-weighted topics',
      'Move the target to the next exam window',
      'Accept a compressed strategy with thinner coverage on the lowest-weighted topics',
    ],
  }
}

/** Which milestone the current week falls in — the only part the weekly planner reads. */
export function currentMilestone(roadmap: Roadmap, today: string): Milestone | null {
  const weeksIn = Math.floor(daysBetween(roadmap.startDate, today) / 7) + 1
  return roadmap.milestones.find(m => weeksIn >= m.startWeek && weeksIn <= m.endWeek)
    ?? roadmap.milestones.find(m => m.startWeek > weeksIn)
    ?? null
}

export function currentPhase(roadmap: Roadmap, today: string): PhaseSpan | null {
  const weeksIn = Math.floor(daysBetween(roadmap.startDate, today) / 7) + 1
  const found = roadmap.phases.find(p => weeksIn >= p.startWeek && weeksIn <= p.endWeek)
  if (found) return found
  // The trailing days after the last whole week still belong to the last phase, up to the target date.
  const last = roadmap.phases[roadmap.phases.length - 1]
  return last && today >= last.startDate && today <= last.endDate ? last : null
}
