import { createAdminClient } from '../../supabase/admin'
import { minuteOf, perRequest } from '../../ops/perRequest'
import { StudyWeek, Weekday, addDays, weekdayOf, zonedTimeToUtc, todayInZone } from '../studyWeek'
import { splitIntoSittings } from './sittings'
import { dailyFreeRanges, freeRangesForDates, minutesBetween } from './capacity'
import { fitTimedStart, gapsFromRanges, busyFromTimed, subtractBusy, gapsAfterAccepted, packSittings, packWhole, reserveFlexible, totalMinutes as gapTotal, type Gap } from './gaps'
import { ADAPTATION, adaptEnvelope, computeWeeklyEnvelope, type Adaptation } from './envelope'
import { loadClosedCycleObservations, type ClosingAnswers } from '../cycleObservationService'
import { reconcileProgress, type PlannedStretch, type Reconciliation } from '../../curriculum/aheadBehind'
import { getActiveRoadmap, observedPace } from '../../curriculum/roadmapService'
import { buildRoadmap, currentPhase, isFirstPassPending, remainingEffort, SEEDED_MINUTES_PER_EFFORT_UNIT, type ModuleInput, type Phase, type RoadmapInput } from '../../curriculum/roadmap'
import { MIN_PACE_MODULES } from '../../curriculum/observedPace'
import { MAX_REVISION_TASKS, type QueueEntry } from '../../curriculum/revisionQueue'
import { selectRevisionForWeek } from '../../curriculum/revisionQueueService'
import { permitsStudyPortions } from './weekBoundary'
import { placeMockWithWindows, type MockWeekPlacement } from '../../exam/mockWeekPlacement'
import { MOCK_MINUTES } from '../../tests/limits'
import type { ExtraWindow } from '../extraWindows'
import type { MockTransition } from '../../exam/mockTransition'
import { PAPER_START_TIME, paperTitle, planWeeklyPaper, toPersistedScope, type PaperPlan, type PersistedPaperScope } from './paper'

export const NEW_CONTENT_DAILY_CAP_EFFORT_UNITS = 6

export type GeneratedPortion = {
  title: string
  detail: string
  taskType: string
  effortUnits: number
  durationMinutes: number
  lmId: string | null
  repairThreadId: string | null
  priorityLane: 'repair' | 'unstable' | 'consolidation' | 'content'
  /** Set on the weekly paper: its purpose and the scope the bank was checked against. */
  assessmentScope?: PersistedPaperScope | null
  rationale?: string
  /** What the task is for, how to go about it, and what "done" means. Guidance, never a lesson. */
  conceptId?: string | null
  learningObjective?: string
  suggestedApproach?: string
  completionMeaning?: string
  /** A same-day paper whose original clock time has passed stays untimed. */
  dayPreferred?: boolean
  paperStart?: string
  /** A timed sitting that is not a paper (a mock): saved timed at `paperStart`. */
  timedSitting?: boolean
  /** Placed in a one-off window the student added: the accept command checks that exact time. */
  extraWindow?: boolean
  /** New study or revision offered for leftover time in an added window. */
  addedTimeNew?: boolean
  /** Work beyond the accepted load, offered because recent weeks were delivered. Saved as optional: skipping it is not a miss. */
  optional?: boolean
  /** Sibling identity of a portion split into sittings: one key per portion, 1-based position and the number of sittings. */
  split?: { key: string; index: number; count: number }
}

const GUIDANCE = {
  study: {
    approach: 'Work through this portion in your own course material. Close it and note what you could explain without looking.',
    done: 'Done when you have covered this portion in your material. If you could not finish it, record it as partly done.',
  },
  repair: {
    approach: 'Revisit the specific point you missed in your own material, then try a few questions on it from memory.',
    done: 'Done when you have reworked the missed point. A separate re-check shows whether it held.',
  },
  recheck: {
    approach: 'Answer from memory first, then check your answers.',
    done: 'Done when you have attempted the re-check. The result comes from the check, not from marking this done.',
  },
  // Revising material the student already covered. Guidance about how to go about it, never a lesson.
  reviseFlagged: {
    approach: 'Read your own notes on this reading first. Then try practice questions on it from your own question source, without notes, and mark what is still unclear.',
    done: 'Done when you have reviewed it and tried some practice. Log which parts you revisited and how it went. This records activity, not demonstrated understanding.',
  },
  reviseMaintain: {
    approach: 'Close your material and recall the main ideas, formulas and common traps from memory. Then check against your notes and mark any gaps.',
    done: 'Done when you have recalled and checked it. Log what you revisited. This records activity, not demonstrated understanding.',
  },
} as const

/** Revision of covered material is short and focused; a reading is not re-studied from scratch. */
const REVISION_MAX_MINUTES = 60
const REVISION_MIN_MINUTES = 15
/** Targeted revision of reported uncertainty may take at most this share of a day, so first-pass work still fits. */
const TARGETED_REVISION_DAILY_SHARE = 0.5
/** The most revision readings one week proposes, per phase. A week of "revise everything" is not a plan. */
export { MAX_REVISION_TASKS }

const isRevisionModule = (m: ModuleInput) => m.coverage === 'studied' || m.coverage === 'decaying'

/** Minutes for one revision sitting: a share of the reading's effort, whatever its coverage state (verified readings are revised too). */
export function revisionMinutes(mod: ModuleInput, minutesPerEffortUnit: number): number {
  return Math.round(remainingEffort({ ...mod, coverage: 'studied' }) * minutesPerEffortUnit)
}

export function revisionPortion(mod: ModuleInput, minutes: number, mockDate: string | null, minutesPerEffortUnit: number, entry?: QueueEntry): GeneratedPortion {
  const flagged = mod.uncertainty
  const why = entry ? entry.reasons.join(' ')
    : flagged
      ? (flagged.assumed ? 'You said part of this topic feels uncertain, and this reading comes first in its order.' : 'You marked this reading as one to revisit.')
      : mockDate ? `Part of your preparation for the mock on ${mockDate}.` : 'Keeps material you have covered fresh.'
  return {
    title: `Revise: ${mod.name}`, detail: '', taskType: 'review', effortUnits: minutes / minutesPerEffortUnit,
    durationMinutes: minutes, lmId: mod.id, repairThreadId: null, priorityLane: 'consolidation',
    learningObjective: flagged ? `Revisit ${mod.name} where you feel unsure.` : `Keep ${mod.name} fresh.`,
    suggestedApproach: flagged ? GUIDANCE.reviseFlagged.approach : GUIDANCE.reviseMaintain.approach,
    completionMeaning: flagged ? GUIDANCE.reviseFlagged.done : GUIDANCE.reviseMaintain.done,
    // Provenance stays visible: this came from the student's own answer or recorded activity, not from a test.
    rationale: entry ? why : `${why} ${flagged ? 'Self-reported, not test evidence.' : ''}`.trim(),
  }
}

export type DayPlan = { date: string; weekday: Weekday; portions: GeneratedPortion[] }

type RepairInput = { id: string; title: string; durationMinutes: number }
type UnstableInput = { conceptId: string; name: string }
/** Newest valid event per concept decides (a later supported answer retires an older unstable one); concepts already owned by a repair thread are left to that workflow. Max 10. */
export function selectUnstableConcepts(eventsNewestFirst: { conceptId: string; state: string; name: string }[], ownedByRepair: Set<string>): UnstableInput[] {
  const seen = new Set<string>(), out: UnstableInput[] = []
  for (const e of eventsNewestFirst) {
    if (!e.conceptId || seen.has(e.conceptId)) continue
    seen.add(e.conceptId)
    if (e.state === 'unstable' && !ownedByRepair.has(e.conceptId)) out.push({ conceptId: e.conceptId, name: e.name })
    if (out.length >= 10) break
  }
  return out
}

/**
 * One day's portions, from a capacity budget and the priority queue (spec
 * §3.1). Pure — no DB access, so it's directly testable. Repair and
 * unstable-concept work compete for the day's capacity but never for the
 * 6-effort-unit new-content cap; new content is what gets capped, because
 * review/repair work is fine denser (it isn't first exposure).
 */
export function allocateDay(input: {
  capacityMinutes: number
  minutesPerEffortUnit: number
  repairs: RepairInput[]
  unstableConcepts: UnstableInput[]
  pendingModules: ModuleInput[]
  phase: Phase
  maxSittingMinutes?: number
  /** Covered readings the student asked to revisit, offered in addition to the phase's own work (first pass only). */
  revisionTargets?: ModuleInput[]
  /** How many more revision readings this week may take. */
  maxRevisionTasks?: number
  /** The share of the day's remaining time revision may take before new content. Half during the first pass; revision is the main work after it. */
  revisionShare?: number
  /** Routine recall fills spare room after new study in a regular first-pass proposal. */
  revisionAfterNewStudy?: boolean
  /** Why each revision reading was chosen, by reading id, carried into the task's rationale. */
  revisionEntries?: Map<string, QueueEntry>
  /** Set when a mock is coming and this week leads up to it. */
  mockDate?: string | null
  /** What is left of the week's new-learning envelope, in effort units. The envelope is a real cap, not only a gate on whether a day starts new work. */
  newContentCapUnits?: number
  /** The day's real free intervals. When given, every sitting is packed inside ONE of them and `capacityMinutes` is only the fallback total. */
  gaps?: Gap[]
}): DayPlan {
  const portions: GeneratedPortion[] = []
  let remainingMinutes = input.capacityMinutes
  let gaps = input.gaps
  const limit = input.maxSittingMinutes ?? 180
  const packed = new Map<GeneratedPortion, number[]>()
  /**
   * Minutes of `m` that can be placed now. Study content may split across gaps; a repair, re-check or revision reading within the sitting limit
   * is one sitting and needs ONE gap that holds all of it.
   */
  const fitOf = (m: number, splittable = true) => !gaps ? Math.min(m, remainingMinutes)
    : splittable || m > limit ? packSittings(gaps, m, limit).sittings.reduce((a, b) => a + b, 0) : packWhole(gaps, m) ? m : 0
  const room = () => gaps ? gapTotal(gaps) : remainingMinutes
  /** Takes `m` minutes for `p`; with gaps the sittings are recorded so the split follows the real intervals. */
  const take = (p: GeneratedPortion, m: number, splittable = true) => {
    if (!gaps) { remainingMinutes -= m; return }
    if (!splittable && m <= limit) { gaps = packWhole(gaps, m)!; return }
    const r = packSittings(gaps, m, limit); gaps = r.gaps; packed.set(p, r.sittings)
  }
  let revisionLeft = input.maxRevisionTasks ?? Number.POSITIVE_INFINITY
  /** Places one revision reading if it fits; returns the minutes used (0 when it did not). */
  const addRevision = (mod: ModuleInput, cap: number): number => {
    if (revisionLeft <= 0) return 0
    const minutes = Math.min(revisionMinutes(mod, input.minutesPerEffortUnit), REVISION_MAX_MINUTES, cap)
    if (minutes < REVISION_MIN_MINUTES || fitOf(minutes, false) < minutes) return 0
    const rp = revisionPortion(mod, minutes, input.mockDate ?? null, input.minutesPerEffortUnit, input.revisionEntries?.get(mod.id))
    portions.push(rp)
    take(rp, minutes, false)
    revisionLeft--
    return minutes
  }

  for (const r of input.repairs) {
    if (fitOf(r.durationMinutes, false) < r.durationMinutes) continue
    const rp: GeneratedPortion = {
      title: r.title, detail: '', taskType: 'repair', effortUnits: 0,
      durationMinutes: r.durationMinutes, lmId: null, repairThreadId: r.id, priorityLane: 'repair',
      learningObjective: `${r.title.replace(/^Repair:\s*/, '')}: close the gap that the check found.`,
      suggestedApproach: GUIDANCE.repair.approach, completionMeaning: GUIDANCE.repair.done,
    }
    portions.push(rp); take(rp, r.durationMinutes, false)
  }

  const unstableMinutes = 15
  for (const c of input.unstableConcepts) {
    if (fitOf(unstableMinutes, false) < unstableMinutes) continue
    const up: GeneratedPortion = {
      title: `Recall: ${c.name}`, detail: 'The tracker recorded an unstable observation. Recall it using your own material.',
      taskType: 'review', effortUnits: 0, durationMinutes: unstableMinutes,
      lmId: null, repairThreadId: null, priorityLane: 'unstable', conceptId: c.conceptId,
      learningObjective: `${c.name}: recall what you can explain from memory.`,
      suggestedApproach: GUIDANCE.reviseMaintain.approach, completionMeaning: GUIDANCE.reviseMaintain.done,
    }
    portions.push(up); take(up, unstableMinutes, false)
  }

  const finish = (): DayPlan => ({ date: '', weekday: 0, portions: portions.flatMap(p => splitIntoSittings(p, input.maxSittingMinutes, packed.get(p))) })

  // Reported uncertainty about covered material: ordinary targeted revision, after repairs and re-checks and before
  // new content, within a share of the day. It is not a repair thread: nothing was tested.
  const placeRevision = (share: number) => {
    let budget = Math.floor(room() * share)
    for (const mod of input.revisionTargets ?? []) budget -= addRevision(mod, budget)
  }
  if (!input.revisionAfterNewStudy) placeRevision(input.revisionShare ?? TARGETED_REVISION_DAILY_SHARE)

  if (input.phase === 'final') {
    // No new content in final (spec §4), but covered material can still be revised.
    for (const mod of input.pendingModules) if (isRevisionModule(mod)) addRevision(mod, room())
    return finish()
  }

  // plan_blocks.duration_minutes is DB-constrained to [5, 180]. A module can
  // easily need more than 180 minutes at this rate (effort_band values run
  // 2-4, i.e. 170-340 minutes at the default 85 min/unit), so a module's
  // portion is clamped to that range rather than sized to its full remaining
  // effort — a module needing more than one day's worth is picked up again
  // in a later week, since buildWeekPlan re-derives pendingModules from live
  // coverage state on every call rather than from calendar history.
  const MAX_PORTION_MINUTES = 180
  const MIN_PORTION_MINUTES = 5

  let newContentUnits = 0
  const dayCap = Math.min(NEW_CONTENT_DAILY_CAP_EFFORT_UNITS, input.newContentCapUnits ?? Number.POSITIVE_INFINITY)
  for (const mod of input.pendingModules) {
    if (isRevisionModule(mod)) { addRevision(mod, room()); continue }
    if (newContentUnits >= dayCap) continue
    const totalMinutes = Math.round(remainingEffort(mod) * input.minutesPerEffortUnit)
    const capMinutesLeft = Math.round((dayCap - newContentUnits) * input.minutesPerEffortUnit)
    let minutes = Math.min(totalMinutes, MAX_PORTION_MINUTES, capMinutesLeft)
    // Only what fits real gaps is promised; the rest stays unplaced and is shown as waiting.
    if (gaps) minutes = Math.min(minutes, fitOf(minutes))
    // A sitting squeezed by the envelope to a sliver is not a plan: leave it for next week instead.
    if (minutes < MIN_PORTION_MINUTES || (minutes < totalMinutes && minutes < REVISION_MIN_MINUTES)) continue
    if (minutes > remainingMinutes && !gaps) continue
    const cp: GeneratedPortion = {
      title: `Study: ${mod.name}`, detail: '', taskType: 'study', effortUnits: minutes / input.minutesPerEffortUnit,
      durationMinutes: minutes, lmId: mod.id, repairThreadId: null, priorityLane: 'content',
      learningObjective: `Cover ${mod.name} (this portion).`,
      suggestedApproach: GUIDANCE.study.approach, completionMeaning: GUIDANCE.study.done,
    }
    portions.push(cp); take(cp, minutes)
    newContentUnits += minutes / input.minutesPerEffortUnit
  }

  if (input.revisionAfterNewStudy) placeRevision(1)
  return finish()
}

/** What the revision queue chose for a week and why the rest is waiting. Shown in the review preview; nothing here is a verdict about memory. */
export type RevisionOutcome = {
  phase: Phase
  limit: number
  placed: QueueEntry[]
  /** Eligible readings left for later: over the limit, over a subject's share, or no room in the week. */
  waiting: QueueEntry[]
  /** Readings not scheduled again because a task, a continuation or an open repair already covers them. */
  elsewhere: QueueEntry[]
  eligible: number
  /** Set while the weakness-only bridge applies: what justified work exists and how much is held for broader revision. */
  bridge?: { justified: number; held: number; tested: number; selfReported: number }
}

/** Why the week is the size it is, what the pace figure rests on, and what is waiting. Shared by every page that explains the proposal. */
export type WeekAdaptation = Adaptation & {
  pace: { source: 'observed' | 'assumption'; minutesPerEffortUnit: number; observedModules: number; needed: number }
  /** First-pass estimates left outside this draft, including readings with a sitting already placed. */
  waiting: { id: string; name: string; minutes: number }[]
  /** Minutes of optional extra work in this proposal. */
  optionalMinutes: number
  reconciliation: Reconciliation | null
}

export function waitingFirstPassWork(modules: ModuleInput[], days: DayPlan[], minutesPerEffortUnit: number): WeekAdaptation['waiting'] {
  const placedMinutes = new Map<string, number>()
  for (const day of days) {
    for (const portion of day.portions) {
      if (portion.taskType !== 'study' || !portion.lmId) continue
      placedMinutes.set(portion.lmId, (placedMinutes.get(portion.lmId) ?? 0) + portion.durationMinutes)
    }
  }
  return modules.map(m => ({
    id: m.id, name: m.name, minutes: Math.round(remainingEffort(m) * minutesPerEffortUnit) - (placedMinutes.get(m.id) ?? 0),
  })).filter(m => m.minutes > 0)
}

/** The last day new study work may be placed: the day before a booked exam, the target itself for an indicative sitting. */
export const lastStudyDate = (r: { targetDate: string; targetKind?: 'booked' | 'sitting' }) => r.targetKind === 'booked' ? addDays(r.targetDate, -1) : r.targetDate

export const insidePlanningHorizon = (date: string, today: string, lastDay?: string) => date >= today && (lastDay === undefined || date <= lastDay)

export type WeekPlanResult = { days: DayPlan[]; paper: PaperPlan; revision: RevisionOutcome | null; adaptation: WeekAdaptation | null; /** What a recommended mock placed (and what waits) in this week, when one was asked for. */ mock?: MockWeekPlacement | null }

export { permitsStudyPortions }

/**
 * The first-pass stretches the student accepted, by topic: rebuilt from the inputs saved with the roadmap when it was made
 * (same function, same inputs, so it is the original schedule), else its stored milestones. With neither, nothing is claimed.
 */
async function originalFirstPass(active: NonNullable<Awaited<ReturnType<typeof getActiveRoadmap>>>): Promise<PlannedStretch[]> {
  const admin = createAdminClient()
  const names = new Map(active.input.topics.map(t => [t.id, t.name]))
  const { data: row } = await admin.from('study_roadmaps').select('inputs').eq('id', active.id).maybeSingle()
  const saved = row?.inputs as RoadmapInput | null
  if (saved && Array.isArray(saved.modules) && Array.isArray(saved.topics)) {
    return buildRoadmap(saved).milestones.filter(m => m.phase === 'first_pass').map(m => ({ topicId: m.topicId, topicName: m.topicName, startWeek: m.startWeek, endWeek: m.endWeek }))
  }
  const { data } = await admin.from('roadmap_milestones').select('topic_ref, planned_start_week, planned_end_week').eq('roadmap_id', active.id).eq('phase', 'first_pass')
  return (data ?? []).map(m => ({ topicId: m.topic_ref as string, topicName: names.get(m.topic_ref as string) ?? 'this topic', startWeek: Number(m.planned_start_week), endWeek: Number(m.planned_end_week) }))
}

/** Computes the whole week's plan. Read-only — no writes happen here. */
export async function buildWeekPlan(userId: string, week: StudyWeek): Promise<DayPlan[]> {
  return (await buildWeekPlanWithPaper(userId, week)).days
}

/**
 * Same as buildWeekPlan, but also returns the weekly paper decision — including
 * the reason when no paper is scheduled — so callers can explain an honest
 * "no paper this week" instead of implying one exists.
 */
/**
 * Time already spoken for by continuing work, taken off before new work is generated so that new work
 * shrinks to make room rather than the week growing. `studyMinutes` also comes off the weekly new-learning
 * budget; `repairThreadIds` are repairs that are already continuing and must not be generated again.
 */
export type Reservation = { byDate: Record<string, number>; gapsAfterContinuations?: Record<string, Gap[]>; studyMinutes: number; repairThreadIds: string[]; /** Readings whose revision is continuing into this week. */ revisionReadingIds?: string[] }

export async function buildWeekPlanWithPaper(
  userId: string, week: StudyWeek, opts: { closingCycleId?: string; closingAnswers?: ClosingAnswers; reserved?: Reservation; now?: Date; /** Study time starts no earlier than this (the first week's review buffer). `now` still decides the date. */ notBefore?: Date; lighter?: boolean; /** A recovery path that protects core coverage: revision waits while carried work clears. */ deferRevision?: boolean; /** The Roadmap's mock recommendation; when it adds a mock the week is assessment-led. */ mock?: MockTransition | null; /** What is left of the student's added windows after carried work. */ mockWindows?: ExtraWindow[]; /** Every added window: reserved for what was put in it, so nothing else is generated into that time. */ blockedWindows?: ExtraWindow[]; /** Offer leftover window time to eligible new work. */ fillLeftover?: boolean; roadmap?: NonNullable<Awaited<ReturnType<typeof getActiveRoadmap>>> } = {}
): Promise<WeekPlanResult> {
  const admin = createAdminClient()
  const now = opts.now ?? new Date()
  const today = todayInZone(week.timezone, now)
  const [active, { data: profile }] = await Promise.all([
    opts.roadmap ?? getActiveRoadmap(userId),
    admin.from('profiles').select('max_session_minutes').eq('id', userId).maybeSingle().throwOnError(),
  ])
  if (!active) {
    return {
      days: week.days.map(date => ({ date, weekday: weekdayOf(date), portions: [] })),
      paper: { kind: 'none', reason: 'no_scope', skipped: [] }, revision: null, adaptation: null,
    }
  }

  // Nothing is generated beyond the exam horizon: a week that starts after it is empty, and a partial final week stops at its last usable day.
  const horizon = lastStudyDate(active.roadmap)
  if (week.startDate > horizon) {
    return { days: week.days.map(date => ({ date, weekday: weekdayOf(date), portions: [] })), paper: { kind: 'none', reason: 'no_scope', skipped: [] }, revision: null, adaptation: null }
  }

  const phaseSpan = currentPhase(active.roadmap, week.startDate)
  const phase: Phase = phaseSpan?.phase ?? 'first_pass'

  const currentWeekNumber = Math.floor(
    (new Date(week.startDate).getTime() - new Date(active.roadmap.startDate).getTime()) / (7 * 86_400_000)
  ) + 1
  const usableWeeksRemaining = phaseSpan ? Math.max(1, phaseSpan.endWeek - currentWeekNumber + 1) : 1

  const phaseModuleIds = new Set(
    active.roadmap.milestones.filter(m => m.phase === phase).flatMap(m => m.moduleIds)
  )
  // Work the phase owns. First-pass work (not started, or partly covered) is studied as before. Covered material is NOT
  // taken from the phase's module list in rank order (that always started from the same readings): it comes from the
  // shared revision queue below, which rotates with recorded activity, reported uncertainty and what was already planned.
  const phaseModules = active.input.modules.filter(m => phaseModuleIds.has(m.id) && m.coverage !== 'verified')
  const pendingModules = phaseModules.filter(isFirstPassPending)
  const mockAdds = opts.mock?.available ? opts.mock.proposal.adds : []
  // A week turns mock-led only when a mock can actually go into it, in regular time or an added window; otherwise it stays a normal week and says what waits.
  const mockCanBePlaced = Boolean(mockAdds.length && opts.mock?.available && (opts.mock.feasibility.mockOpening || opts.mockWindows?.some(w => w.end - w.start >= MOCK_MINUTES)))
  // When no first-pass work is left anywhere, "first pass" is only a label: the week plans as consolidation, so a finished
  // first pass leads into real revision rather than a thin or empty week.
  const [{ selection: queue, revisionPhase, cap: revisionCap, firstPassLeft }, observations,
    { data: closingRow }, { data: repairRows }, { data: activeCycle }, { data: evRows }, { data: ownedRows }, paceNow] = await Promise.all([
    selectRevisionForWeek(userId, active, week, {
      phase: mockCanBePlaced ? 'final' : phase, weekNumber: currentWeekNumber, today, now, continuingReadingIds: opts.reserved?.revisionReadingIds, closingAnswers: opts.closingAnswers,
    }),
    loadClosedCycleObservations(userId, 4, opts.closingAnswers),
    opts.closingCycleId ? admin.from('planning_cycles').select('ends_at_local').eq('id', opts.closingCycleId).maybeSingle() : { data: null },
    admin.from('repair_threads').select('id, concept:curriculum_concepts(name)')
      .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled']),
    admin.from('planning_cycles').select('id').eq('user_id', userId).eq('status', 'active').maybeSingle(),
    admin.from('evidence_events').select('concept_id, evidence_state, concept:curriculum_concepts(name)')
      .eq('user_id', userId).eq('validity', 'valid').not('concept_id', 'is', null)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(400),
    admin.from('repair_threads').select('concept_id')
      .eq('user_id', userId).in('status', ['open', 'proposed', 'scheduled', 'in_progress', 'awaiting_recheck']),
    observedPace(userId),
  ])
  const moduleById = new Map(active.input.modules.map(m => [m.id, m]))
  const revisionPool = queue.selected.map(e => moduleById.get(e.readingId)!).filter(Boolean)
  const revisionEntries = new Map(queue.selected.map(e => [e.readingId, e]))
  const phaseRemainingEffort = pendingModules.reduce((s, m) => s + remainingEffort(m), 0)

  // Real closed-cycle history: what happened to accepted work, never planned time and never a guessed ratio.
  // The last study period is the cycle being closed, when there is one: a break is a gap after IT, not after an older closed week.
  const lastEnd = (closingRow?.ends_at_local ?? observations[0]?.endsAt ?? null) as string | null
  const gapDays = lastEnd ? Math.round((new Date(`${week.startDate}T00:00:00Z`).getTime() - new Date(`${lastEnd}T00:00:00Z`).getTime()) / 86_400_000) - 1 : 0
  // Only a cycle whose answers are known can be called empty; before the student answers, the older closed weeks speak.
  const latestEmpty = Boolean(opts.closingAnswers) && observations[0]?.quality === 'empty'
  const base = adaptEnvelope({ observations, afterBreak: lastEnd ? latestEmpty || gapDays >= ADAPTATION.breakDays : false, lighter: opts.lighter })
  const weeklyEnvelope = computeWeeklyEnvelope({ phaseRemainingEffort, usableWeeksRemainingInPhase: usableWeeksRemaining, adaptation: base })

  // A 'scheduled' thread is only truly covered while an unfinished task in an
  // active cycle carries it. Orphan tasks (cycle_id null, from before cycles)
  // stay in the database for audit but do not count, otherwise the weakness is
  // stranded: hidden from Calendar and never re-planned.
  const covered = new Set<string>()
  // A cycle that is being closed no longer covers anything: its unfinished
  // repair work carries into the next week instead of hiding behind it.
  if (activeCycle && activeCycle.id !== opts.closingCycleId) {
    const { data: live } = await admin.from('plan_blocks').select('repair_thread_id, execution')
      .eq('user_id', userId).eq('cycle_id', activeCycle.id as string).not('repair_thread_id', 'is', null)
    for (const b of live ?? []) {
      if (b.execution !== 'completed' && b.execution !== 'skipped') covered.add(b.repair_thread_id as string)
    }
  }
  const continuingRepairs = new Set(opts.reserved?.repairThreadIds ?? [])
  const repairs: RepairInput[] = (repairRows ?? []).filter(r => !covered.has(r.id as string) && !continuingRepairs.has(r.id as string)).map(r => ({
    id: r.id as string, title: `Repair: ${(r.concept as any)?.name ?? 'concept'}`, durationMinutes: 30,
  }))

  // Generic "re-verify" work is for a concept whose CURRENT valid state is unstable AND that no repair thread already owns. A thread (open through awaiting re-check)
  // owns verification through the repair/re-check workflow; planning a second independent obligation would be a duplicate or an unstartable unlinked task.
  const unstableConcepts = selectUnstableConcepts((evRows ?? []).map(r => ({ conceptId: r.concept_id as string, state: r.evidence_state as string, name: (r.concept as any)?.name ?? 'this concept' })), new Set((ownedRows ?? []).map(r => r.concept_id as string)))

  const minutesPerEffortUnit = paceNow.minutesPerEffortUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT   // a planning assumption when not observed
  const remainingPool = [...pendingModules]
  const targetPool = [...revisionPool]
  let revisionTasksLeft = opts.deferRevision ? 0 : revisionCap
  const mock = active.roadmap.checkpoints[0]
  const mockDate = mock && week.startDate <= mock.date ? mock.date : null
  const days: DayPlan[] = []
  const reservedEffort = (opts.reserved?.studyMinutes ?? 0) / minutesPerEffortUnit
  let weekEffortBudget = Math.max(0, weeklyEnvelope.total - reservedEffort)
  let committedLeft = Math.max(0, weeklyEnvelope.committed - reservedEffort)
  const placedRepairs = new Set<string>()
  const placedUnstable = new Set<string>()

  // Accepted timed work (a booked paper, a timed review) holds its exact interval: it is real time, not a flexible day claim.
  const fixedGaps = opts.reserved?.gapsAfterContinuations
  const timedBusy = fixedGaps ? {} : await loadTimedBusy(userId, week)
  // Open untimed work already dated inside this week (any cycle) holds its room too: the database packer counts it, so the preview must as well.
  const openFlexible = fixedGaps ? {} : await loadOpenFlexible(userId, week)

  // A recommended mock is placed FIRST so the rest of the week plans around it (its time, then the debrief and follow-up, are held).
  const insideToday = (d: string) => insidePlanningHorizon(d, today, horizon) && permitsStudyPortions(active.input.route, weekdayOf(d))
  const openGapsFor = async (date: string) => subtractBusy(await regularGapsFor(date), (opts.blockedWindows ?? []).filter(w => w.date === date))
  const regularGapsFor = async (date: string) => fixedGaps?.[date] ?? reserveFlexible(gapsAfterAccepted(gapsFromRanges(await dailyFreeRanges(userId, weekdayOf(date), date, week.timezone, opts.notBefore ?? now)), timedBusy[date] ?? [], openFlexible[date] ?? []), opts.reserved?.byDate[date] ?? 0)
  const mockPlan: MockWeekPlacement | null = mockAdds.length
    ? placeMockWithWindows(await Promise.all(week.days.map(async date => ({ date, usable: insideToday(date) && date >= today, gaps: await openGapsFor(date) }))), mockAdds, profile?.max_session_minutes ?? null, minutesBetween('00:00', PAPER_START_TIME), opts.mockWindows ?? [])
    : null
  const heldFor = (date: string, gaps: Gap[]): Gap[] => {
    if (!mockPlan) return gaps
    let g = gaps
    if (mockPlan.mock?.date === date && !mockPlan.mock.window) g = subtractBusy(g, [{ start: mockPlan.mock.start, end: mockPlan.mock.start + mockPlan.mock.minutes }])
    for (const x of [...mockPlan.debrief, ...mockPlan.followUp]) if (x.date === date && x.start === undefined) g = packWhole(g, x.minutes) ?? g
    return g
  }

  for (const date of week.days) {
    const weekday = weekdayOf(date)
    // Self-study is Monday–Saturday. Sunday is reserved for the weekly paper
    // (or an honest no-paper checkpoint when the item bank is insufficient).
    // Class-led weeks use their own class-defined boundary instead.
    if (!insidePlanningHorizon(date, today, horizon) || !permitsStudyPortions(active.input.route, weekday)) {
      days.push({ date, weekday, portions: [] })
      continue
    }
    // Real free intervals, with continuing work taken off first, so a sitting is only promised where one gap holds it.
    const gaps = heldFor(date, await openGapsFor(date))
    const capacity = gapTotal(gaps)
    const budgetedPool = weekEffortBudget > 0 ? remainingPool : []
    const day = allocateDay({
      capacityMinutes: capacity, minutesPerEffortUnit,
      // Keep offering repair/unstable work until it's actually placed — not
      // just on the literal first day of the week, which may have zero
      // capacity (a rest day) and would otherwise drop this priority-1 work
      // for the whole week.
      repairs: repairs.filter(r => !placedRepairs.has(r.id)),
      unstableConcepts: unstableConcepts.filter(c => !placedUnstable.has(c.conceptId)),
      pendingModules: budgetedPool, phase, maxSittingMinutes: profile?.max_session_minutes ?? undefined,
      revisionTargets: targetPool, maxRevisionTasks: revisionTasksLeft, mockDate,
      revisionShare: phase === 'first_pass' && firstPassLeft ? undefined : 1, revisionEntries,
      revisionAfterNewStudy: phase === 'first_pass' && firstPassLeft && !opts.lighter,
      newContentCapUnits: weekEffortBudget, gaps,
    })
    day.date = date
    day.weekday = weekday

    for (const portion of day.portions) {
      if (portion.priorityLane === 'repair' && portion.repairThreadId) placedRepairs.add(portion.repairThreadId)
      if (portion.priorityLane === 'unstable' && portion.conceptId) placedUnstable.add(portion.conceptId)
    }

    const revisedToday = new Set<string>()
    for (const p of day.portions) {
      if (p.priorityLane === 'content' || p.priorityLane === 'consolidation') {
        if (p.priorityLane === 'content' || remainingPool.some(m => m.id === p.lmId)) {
          // Past the accepted load, first-pass work is optional extra: the student reviews it and may skip it without a miss.
          if (p.priorityLane === 'content' && committedLeft <= 0 && base.factor > 1) {
            p.optional = true
            p.rationale = 'Optional extra: recent weeks were delivered, so there is room for more. Skipping it is not a miss.'
          }
          committedLeft -= p.effortUnits
          weekEffortBudget -= p.effortUnits
        }
        for (const pool of [remainingPool, targetPool]) {
          const idx = pool.findIndex(m => m.id === p.lmId)
          if (idx >= 0) pool.splice(idx, 1)
        }
        if (p.priorityLane === 'consolidation' && p.lmId) revisedToday.add(p.lmId)
      }
    }
    revisionTasksLeft -= revisedToday.size
    days.push(day)
  }

  // The weekly paper (Decisions §3). Scope is what this week actually places:
  // material not yet started is new (diagnostic); material the student has
  // already been exposed to is revisited (revisionary). Nothing is scheduled
  // unless the bank holds enough unseen, eligible items for that scope.
  const coverageById = new Map(active.input.modules.map(m => [m.id, m.coverage]))
  const placed = [...new Set(days.flatMap(d => d.portions).filter(p => (p.priorityLane === 'content' || p.priorityLane === 'consolidation') && p.lmId).map(p => p.lmId as string))]
  const newModuleIds = placed.filter(id => coverageById.get(id) === 'not_started')
  const revisitedModuleIds = placed.filter(id => coverageById.get(id) !== 'not_started')
  // The student chose the mock as this week's assessment: no weekly paper is planned for it. Any other state of the choice
  // (keep the paper, undecided) leaves the paper as it was. A paper already started or accepted is never touched here.
  const { data: choiceRow } = await admin.from('cycle_assessment_choices').select('choice').eq('user_id', userId).eq('week_start', week.startDate).maybeSingle()
  if (mockPlan) {
    const mins = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const portion = (title: string, detail: string, taskType: string, minutes: number, rationale: string, extra: Partial<GeneratedPortion> = {}): GeneratedPortion =>
      ({ title, detail, taskType, effortUnits: 0, durationMinutes: minutes, lmId: null, repairThreadId: null, priorityLane: 'content', rationale, ...extra })
    const at = (date: string) => days.find(d => d.date === date)!
    const g = opts.mock?.available ? opts.mock.gaps.slice(0, 3).map(x => x.name).join(', ') : ''
    if (mockPlan.mock) at(mockPlan.mock.date).portions.push(portion('Mock sitting', 'A full timed mock with its own clock. Record what happened afterwards: it stays your own report, not question evidence.', 'other', mockPlan.mock.minutes,
      'Your Roadmap recommends starting mocks. This holds the time; book or start the mock from Calendar.', { timedSitting: true, paperStart: mins(mockPlan.mock.start), extraWindow: mockPlan.mock.window }))
    const parts = (list: MockWeekPlacement['debrief'], title: string, detail: string, rationale: string) => list.forEach((x, n) => at(x.date).portions.push(
      portion(list.length > 1 ? `${title} · part ${n + 1} of ${list.length}` : title, detail, 'review', x.minutes, rationale,
        x.start === undefined ? {} : { timedSitting: true, paperStart: mins(x.start), extraWindow: true })))
    parts(mockPlan.debrief, 'Debrief the mock', 'Go through what the mock showed. A short, manageable list of what to fix is the useful output.', 'Follows the mock so what it showed is fresh.')
    parts(mockPlan.followUp, 'Follow up on what the mock found', g ? `Start with: ${g}.` : 'Work on the findings from the debrief.', 'Time for the first fixes after the debrief, before the next review.')
  }
  // Time the student added goes to the carried work first (already filled), then the mock; what is left may take eligible new study or revision that
  // serves the current Roadmap, under the planner's own rules (sitting limit, daily cap, priority order). It is optional work and saved timed.
  if (opts.fillLeftover && opts.mockWindows?.length) {
    const used = mockPlan ? [...(mockPlan.mock?.window ? [{ date: mockPlan.mock.date, start: mockPlan.mock.start, minutes: mockPlan.mock.minutes }] : []),
      ...[...mockPlan.debrief, ...mockPlan.followUp].filter(x => x.start !== undefined).map(x => ({ date: x.date, start: x.start!, minutes: x.minutes }))] : []
    for (const w of opts.mockWindows) {
      const day = days.find(d => d.date === w.date)
      if (!day || w.date < today || !insidePlanningHorizon(w.date, today, horizon)) continue
      for (const gap of subtractBusy([{ start: w.start, end: w.end }], used.filter(u => u.date === w.date).map(u => ({ start: u.start, end: u.start + u.minutes })))) {
        const already = day.portions.filter(p => p.priorityLane === 'content' && p.lmId).reduce((n, p) => n + p.effortUnits, 0)
        const added = allocateDay({
          capacityMinutes: gap.end - gap.start, gaps: [gap], minutesPerEffortUnit, phase, maxSittingMinutes: profile?.max_session_minutes ?? undefined,
          repairs: repairs.filter(r => !placedRepairs.has(r.id)), unstableConcepts: unstableConcepts.filter(c => !placedUnstable.has(c.conceptId)),
          pendingModules: remainingPool, revisionTargets: targetPool, maxRevisionTasks: revisionTasksLeft, mockDate, revisionEntries,
          revisionAfterNewStudy: phase === 'first_pass' && firstPassLeft, revisionShare: 1, newContentCapUnits: Math.max(0, NEW_CONTENT_DAILY_CAP_EFFORT_UNITS - already),
        }).portions
        let cursor = gap.start
        for (const p of added) {
          day.portions.push({ ...p, optional: true, timedSitting: true, extraWindow: true, addedTimeNew: true, paperStart: `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`,
            rationale: 'Proposed for time you added. It is optional: skipping it is not a miss.' })
          cursor += p.durationMinutes
          if (p.repairThreadId) placedRepairs.add(p.repairThreadId)
          if (p.conceptId) placedUnstable.add(p.conceptId)
          if (p.lmId) for (const pool of [remainingPool, targetPool]) { const idx = pool.findIndex(m => m.id === p.lmId); if (idx >= 0) { pool.splice(idx, 1); if (pool === targetPool) revisionTasksLeft-- } }
        }
      }
    }
  }
  const mockIsAssessment = Boolean(mockPlan?.mock) || (choiceRow?.choice === 'use_mock' && active.roadmap.checkpoints.some(c => week.days.includes(c.date)))
  const lastDay = days[days.length - 1]
  const paperDayAvailable = lastDay && insidePlanningHorizon(lastDay.date, today, horizon)
  const { plan, manifestId } = !paperDayAvailable
    ? { plan: { kind: 'none', reason: 'no_scope', skipped: [] } as PaperPlan, manifestId: null }
    : mockIsAssessment
    ? { plan: { kind: 'none', reason: 'mock_chosen', skipped: [] } as PaperPlan, manifestId: null }
    : await planWeeklyPaper(userId, { newModuleIds, revisitedModuleIds })

  let paper = plan
  if (lastDay && paperDayAvailable && plan.kind === 'paper' && manifestId) {
    const date = lastDay.date
    const free = subtractBusy(fixedGaps?.[date] ?? reserveFlexible(gapsAfterAccepted(
      gapsFromRanges(await dailyFreeRanges(userId, lastDay.weekday, date, week.timezone, opts.notBefore ?? now)), timedBusy[date] ?? [], openFlexible[date] ?? [],
    ), opts.reserved?.byDate[date] ?? 0), (opts.blockedWindows ?? []).filter(w => w.date === date))
    const start = fitTimedStart(free, plan.estimatedMinutes, minutesBetween('00:00', PAPER_START_TIME), lastDay.portions.filter(p => !p.extraWindow).map(p => p.durationMinutes))
    if (start === null) paper = { kind: 'none', reason: 'no_slot', skipped: plan.skipped }
    else {
      const paper = plan
      const scope = toPersistedScope(paper, manifestId)
      const names = new Map(active.input.modules.map(m => [m.id, m.name]))
      const scopeNames = paper.sections.flatMap(sec => sec.moduleIds).map(id => names.get(id) ?? id)
      lastDay.portions.push({
        title: paperTitle(paper.purpose),
        detail: `Covers: ${scopeNames.join(', ')}. What it finds shapes next week's repair priorities.`,
        taskType: 'diagnostic',
        effortUnits: 0,
        durationMinutes: paper.estimatedMinutes,
        lmId: null,
        repairThreadId: null,
        priorityLane: 'content',
        assessmentScope: scope,
        paperStart: `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`,
        rationale: paper.purpose === 'diagnostic'
          ? 'Closes the week: checks material you met for the first time this week.'
          : paper.purpose === 'revisionary'
            ? 'Closes the week: checks material you revisited this week.'
            : 'Closes the week: separate sections for new and revisited material.',
      })
    }
  }

  const placedIds = new Set(days.flatMap(d => d.portions).filter(p => p.priorityLane === 'consolidation' && p.lmId).map(p => p.lmId as string))
  const revision: RevisionOutcome = {
    phase: revisionPhase, limit: revisionCap,
    placed: queue.selected.filter(e => placedIds.has(e.readingId)),
    waiting: [
      ...queue.selected.filter(e => !placedIds.has(e.readingId)).map(e => ({ ...e, state: 'waiting' as const,
        waitingReason: opts.deferRevision ? 'Waits while your carried work clears, as you chose in recovery.' : 'Due for recall. No usable sitting fitted after protected commitments and higher-priority work in this proposal.' })),
      ...queue.waiting,
    ],
    elsewhere: queue.elsewhere, eligible: queue.eligible, bridge: queue.bridge,
  }
  const optionalMinutes = days.flatMap(d => d.portions).filter(p => p.optional).reduce((n, p) => n + p.durationMinutes, 0)
  const waiting = waitingFirstPassWork(pendingModules, days, minutesPerEffortUnit)
  const adaptation: WeekAdaptation = {
    ...base,
    pace: { source: paceNow.minutesPerEffortUnit == null ? 'assumption' : 'observed', minutesPerEffortUnit,
      observedModules: paceNow.modules, needed: MIN_PACE_MODULES },
    waiting, optionalMinutes,
    reconciliation: reconcileProgress({ plan: await originalFirstPass(active), modules: active.input.modules, weekNumber: currentWeekNumber, minutesPerEffortUnit }),
  }
  return { days, paper, revision, adaptation, mock: mockPlan }
}

/** The plan_blocks rows a generated week commits as (shared by every atomic writer). */
export async function buildCommitRows(_userId: string, week: StudyWeek, days: DayPlan[]) {
  const reviewTime = PAPER_START_TIME
  return days.flatMap(day => {
    const rows = day.portions.map(p => commitRowFor(day.date, p, reviewTime, week.timezone))
    return rows.map((row, i) => withSiblings(row, day.portions[i], day.portions.map((p, j) => ({ p, id: rows[j].id }))))
  })
}

/** Carries a split's sibling identity into a saved task: the shared group key and the sitting that must come first (a declared order). */
export function siblingLink(p: GeneratedPortion, all: { p: GeneratedPortion; id: string }[]) {
  if (!p.split || p.split.count < 2) return { group_key: '', after: [] as string[] }
  const before = all.find(x => x.p.split?.key === p.split!.key && x.p.split!.index === p.split!.index - 1)
  return { group_key: p.split.key, after: before ? [before.id] : [] }
}
function withSiblings<R extends object>(row: R, p: GeneratedPortion, all: { p: GeneratedPortion; id: string }[]) {
  const l = siblingLink(p, all)
  return { ...row, group_key: l.group_key, dependencies: l.after }
}

function commitRowFor(date: string, p: GeneratedPortion, reviewTime: string, timezone: string) {
  const day = { date }
  const week = { timezone }
  const isReview = p.taskType === 'diagnostic'
  const timedReview = (isReview && !p.dayPreferred) || Boolean(p.timedSitting)
  return {
    id: `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: p.title,
    detail: p.detail,
    task_type: p.taskType,
    origin: isReview ? 'diagnostic' : 'planner',
    priority: p.optional ? 'optional' : 'core',
    placement: timedReview ? 'timed' : 'day_preferred',
    execution: 'not_started',
    local_date: day.date,
    day: day.date,
    starts_at: timedReview ? zonedTimeToUtc(day.date, p.paperStart ?? reviewTime, week.timezone).toISOString() : '',
    duration_minutes: p.durationMinutes,
    duration: String(p.durationMinutes),
    lm_id: p.lmId ?? '',
    repair_thread_id: p.repairThreadId ?? '',
    rationale: p.rationale
      ?? (p.priorityLane === 'repair' ? 'Open repair work, prioritised ahead of new content.'
      : p.priorityLane === 'unstable' ? 'Answered correctly last time but not confidently — worth re-verifying.'
      : `Part of this week's ${p.taskType} scope.`),
    assessment_scope: p.assessmentScope ?? null,
    created_by: 'algorithm',
    ...(p.extraWindow ? { extra_window: true } : {}),
    // Meaning travels with the task, so Calendar shows the same guidance that was previewed.
    concept_id: p.conceptId ?? '',
    learning_objective: p.learningObjective ?? '',
    suggested_approach: p.suggestedApproach ?? '',
    completion_meaning: p.completionMeaning ?? '',
  }
}

const weekKey = (userId: string, week: StudyWeek) => `${userId}|${week.timezone}|${week.days.join()}`
export const loadTimedBusy = perRequest((userId: string, week: StudyWeek) => readTimedBusy(userId, week), weekKey)
async function readTimedBusy(userId: string, week: StudyWeek) {
  const { data } = await createAdminClient().from('plan_blocks').select('local_date, starts_at, duration_minutes')
    .eq('user_id', userId).eq('placement', 'timed').is('cancelled_at', null).neq('execution', 'cancelled').in('local_date', week.days).not('starts_at', 'is', null).throwOnError()
  return busyFromTimed((data ?? []) as { local_date: string; starts_at: string; duration_minutes: number | null }[], week.timezone)
}

/** Minutes of open untimed work already on each date of the week, any cycle. Mirrors what class_day_packs counts (completed, skipped, deferred and cancelled work is not a claim). */
export const loadOpenFlexible = perRequest((userId: string, week: StudyWeek) => readOpenFlexible(userId, week), weekKey)
async function readOpenFlexible(userId: string, week: StudyWeek): Promise<Record<string, number[]>> {
  const { data } = await createAdminClient().from('plan_blocks').select('local_date, duration_minutes, placement, starts_at, execution')
    .eq('user_id', userId).is('cancelled_at', null).in('local_date', week.days).throwOnError()
  const out: Record<string, number[]> = {}
  for (const b of data ?? []) {
    if (['completed', 'skipped', 'deferred', 'cancelled'].includes(b.execution as string) || (b.placement === 'timed' && b.starts_at)) continue
    ;(out[b.local_date as string] ??= []).push(Number(b.duration_minutes ?? 30))
  }
  return out
}

/** Availability net of commitments; callers also account for the tasks they keep. */
export const loadPlacementContext = perRequest((userId: string, week: StudyWeek, now?: Date) => readPlacementContext(userId, week, now), (userId: string, week: StudyWeek, now?: Date) => `${weekKey(userId, week)}|${minuteOf(now)}`)
async function readPlacementContext(userId: string, week: StudyWeek, now = new Date()) {
  const admin = createAdminClient()
  const active = await getActiveRoadmap(userId)
  const route = (active?.input.route ?? 'self_study') as 'self_study' | 'coaching' | 'hybrid'
  const today = todayInZone(week.timezone, now)
  const horizon = active ? lastStudyDate(active.roadmap) : undefined
  const [{ data: profile }, { ranges }] = await Promise.all([
    admin.from('profiles').select('max_session_minutes').eq('id', userId).maybeSingle().throwOnError(),
    freeRangesForDates(userId, week.days, week.timezone, now),
  ])
  const gaps = week.days.map(date => [date, gapsFromRanges(ranges[date] ?? [])] as const)
  return {
    capacity: Object.fromEntries(gaps.map(([date, ranges]) => [date, gapTotal(ranges)])),
    gapsByDate: Object.fromEntries(gaps),
    studyDates: week.days.filter(d => insidePlanningHorizon(d, today, horizon) && permitsStudyPortions(route, weekdayOf(d))),
    notBeforeDate: today,
    maxSittingMinutes: (profile?.max_session_minutes ?? null) as number | null,
  }
}

/** Writes a generated week as real plan_blocks rows in one pass (spec §3.1). */
export async function commitWeekPlan(
  userId: string, week: StudyWeek, days: DayPlan[]
): Promise<{ cycleId: string; taskIds: string[] }> {
  if (!days.some(d => d.portions.length > 0)) return { cycleId: '', taskIds: [] }
  const admin = createAdminClient()
  const rows = await buildCommitRows(userId, week, days)

  // Cycle creation and task insertion happen in one transaction (see the
  // migration's comment) so a rejected row — e.g. a duration_minutes check
  // constraint violation — can never leave an orphaned, empty "active" cycle
  // that permanently blocks this user's future generation via
  // planning_cycles_active_user_idx.
  const { data, error } = await admin.rpc('commit_pulse_week', {
    p_user_id: userId,
    p_starts_at_local: week.startDate,
    p_ends_at_local: week.endDate,
    p_timezone: week.timezone,
    p_rows: rows,
  })
  if (error || !data) throw new Error(`Could not commit the week: ${error?.message}`)

  return { cycleId: (data as { cycle_id: string }).cycle_id, taskIds: rows.map(r => r.id) }
}
