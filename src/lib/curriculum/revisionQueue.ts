import { UNCERTAINTY_WEIGHT, type ModuleUncertainty } from './entryContext'
import type { Phase } from './roadmap'

/**
 * Maintenance and targeted revision as ONE derived queue. Pure: no database, no clock beyond the `now` it is given.
 *
 * Nothing here is stored. Every fact is read from records the product already keeps: confirmed study/revision activity
 * (per outcome), reported uncertainty, current concept evidence, repair threads and the plan itself. The queue is
 * rebuilt whenever a week is proposed, so completing, missing or removing revision changes the next selection
 * without a second progress model.
 *
 * What the numbers mean (and do not):
 *  - Coverage is not understanding; a completed revision task is ACTIVITY, not proof of retention.
 *  - Old evidence means the evidence is old. Nothing here says a reading is forgotten, and nothing predicts memory or passing.
 *  - A missing activity date is UNKNOWN. It is treated as "due for a look", never as zero days and never as "forgotten".
 *  - Not having reviewed questions never removes a reading from the queue; only the diagnostic check is unavailable.
 */

/**
 * PLANNING ASSUMPTIONS. Starting points for how often to look at covered material again, not validated predictions of
 * retention. Central so they can be revised in one place; deliberately not a student-facing setting.
 */
export const REVISION_ASSUMPTIONS = {
  /** Days after which covered material is "due for a look" again, by phase. Shorter as the exam approaches. */
  maintenanceIntervalDays: { first_pass: 28, consolidation: 21, revision: 14, final: 10 } as Record<Phase, number>,
  /** Days after which a reading the student flagged as uncertain is due again. Until then it yields to other readings. */
  targetedIntervalDays: 7,
  /** A mock or checkpoint within this many days shortens every interval. */
  checkpointWindowDays: 21,
  checkpointIntervalFactor: 0.75,
  /** Readings whose tested outcomes are all secure and were checked within this many days rest for now; they stay eligible. */
  strongEvidenceRestDays: 21,
  strongEvidenceRestFactor: 0.5,
  /** A single outcome counts at most this many intervals overdue, so one very old reading cannot dominate every week. */
  overdueCap: 2.5,
  /** An outcome with no recorded or reported activity date counts as exactly due (1 interval), not as zero and not as "forgotten". */
  unknownDueness: 1,
  /** A reading declined (skipped or removed) this recently is not offered again straight away. */
  declinedCooldownDays: 7,
  declinedPenalty: 0.5,
  /** No more than this share of a week's revision places may come from one subject while other subjects have candidates. */
  maxSubjectShare: 0.5,
} as const

/** The most revision readings one week proposes, per phase. A week of "revise everything" is not a plan. */
export const MAX_REVISION_TASKS: Record<Phase, number> = { first_pass: 3, consolidation: 8, revision: 8, final: 4 }

export type OutcomeEvidence = { band: 'repair' | 'verify' | 'maintain' | 'untested'; checkedAt: string | null } | null

export type RecencySource = 'recorded' | 'reported' | 'unknown'

export type RevisionReading = {
  id: string
  name: string
  topic: string
  topicName: string
  coverage: 'not_started' | 'taught' | 'studied' | 'verified' | 'decaying'
  uncertainty: ModuleUncertainty | null
  /** Last confirmed learning/revision activity per outcome (ISO). null = none recorded. One entry per outcome. */
  outcomeActivity: (string | null)[]
  /** The student said they were working on this subject when they set up Roadmap. That carries no study date and never refreshes recency. */
  reportedCurrent: boolean
  /** Where the newest activity date comes from: a study date the student logged, or when completion was recorded. */
  newestActivityKind?: 'study_date' | 'recorded' | null
  /** Current evidence over this reading's outcomes (validity and sufficiency rules already applied by the tracker). */
  evidence: { repair: number; verify: number; maintain: number; untested: number; latestAt: string | null }
  /**
   * The same evidence PER OUTCOME, aligned with outcomeActivity (null or missing = untested). Rest applies only to the outcome whose
   * own evidence supports it; a fresh result on one outcome never speaks for the others, and each keeps its own check date.
   */
  outcomeEvidence?: OutcomeEvidence[]
  /** A live (not done, not cancelled) revision task already sits in the week being proposed. */
  scheduled: boolean
  /** Work for this reading is continuing into the week from the closing one. */
  continuing: boolean
  /** An open repair thread owns this reading's weakness. */
  repairOverlap: boolean
  history: { lastPlannedAt: string | null; lastDeclinedAt: string | null }
}

export type Candidate = {
  readingId: string
  name: string
  topic: string
  topicName: string
  kind: 'targeted' | 'maintenance'
  score: number
  /** The score's parts, so the ranking can be shown and tested. */
  parts: { dueness: number; reported: number; evidence: number; relevance: number; attention: number; focus: number; checkpoint: number; cooldown: number }
  recency: { source: RecencySource; at: string | null; days: number | null; provenance: 'study_date' | 'recorded' | null; refreshedOutcomes: number; totalOutcomes: number }
  /** Why it is eligible and why it ranks where it does, in plain terms. */
  reasons: string[]
  evidenceNote: string | null
}

export type QueueState = 'selected' | 'waiting' | 'in_plan' | 'repair' | 'continuing'
export type QueueEntry = Candidate & { state: QueueState; waitingReason: string | null }

export type SelectInput = {
  readings: RevisionReading[]
  phase: Phase
  now: Date
  /** First day of the week being proposed; the stable tie-break rotates with it. */
  weekStart: string
  /** The most revision places this week may take. */
  limit: number
  /** Subject → relative exam importance (any positive scale). Missing = neutral. */
  topicWeight?: Record<string, number>
  /** Subjects the roadmap focuses on in this week's phase milestone. */
  focusTopics?: string[]
  /** Days until the one upcoming mock/checkpoint, if any. */
  daysToCheckpoint?: number | null
}

const DAY = 86_400_000
const daysSinceIso = (iso: string, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / DAY))
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const r2 = (n: number) => Math.round(n * 100) / 100

/** Material that has been covered and can be revisited. Partly covered readings are still first-pass work. */
export const isRevisable = (r: Pick<RevisionReading, 'coverage'>) => r.coverage === 'studied' || r.coverage === 'decaying' || r.coverage === 'verified'

/** Deterministic, well-mixed ordering that changes each week, so equal candidates take turns instead of the lowest id always winning. */
export function rotationKey(readingId: string, weekStart: string): number {
  let h = 0x811c9dc5
  const text = `${weekStart}:${readingId}`
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

export function intervalDays(phase: Phase, daysToCheckpoint: number | null | undefined): number {
  const base = REVISION_ASSUMPTIONS.maintenanceIntervalDays[phase]
  const near = daysToCheckpoint != null && daysToCheckpoint >= 0 && daysToCheckpoint <= REVISION_ASSUMPTIONS.checkpointWindowDays
  return near ? Math.max(3, Math.round(base * REVISION_ASSUMPTIONS.checkpointIntervalFactor)) : base
}

/** True only for an outcome whose OWN evidence is secure (tracker band 'maintain') and was checked recently. Untested, unsteady and repair scope never rests. */
export function outcomeResting(e: OutcomeEvidence | undefined, now: Date): boolean {
  return !!e && e.band === 'maintain' && !!e.checkedAt && daysSinceIso(e.checkedAt, now) <= REVISION_ASSUMPTIONS.strongEvidenceRestDays
}

/** How recent the last activity is, per outcome, and where that date came from. */
export function recencyOf(r: RevisionReading, now: Date, interval: number) {
  const total = r.outcomeActivity.length
  const dated = r.outcomeActivity.filter((a): a is string => Boolean(a))
  const newest = dated.length ? dated.reduce((a, b) => (a > b ? a : b)) : null
  if (newest) {
    const recent = dated.filter(a => daysSinceIso(a, now) < interval).length
    return { source: 'recorded' as const, at: newest, days: daysSinceIso(newest, now), provenance: r.newestActivityKind ?? 'recorded', refreshedOutcomes: recent, totalOutcomes: total }
  }
  // A report of working on it now has no date, so it is not recency: no days, no refresh.
  if (r.reportedCurrent) return { source: 'reported' as const, at: null, days: null, provenance: null, refreshedOutcomes: 0, totalOutcomes: total }
  return { source: 'unknown' as const, at: null, days: null, provenance: null, refreshedOutcomes: 0, totalOutcomes: total }
}

/**
 * Mean overdueness of the reading's outcomes against `interval` (1 = exactly due). Per outcome, so work that confirmed
 * only some outcomes refreshes only those, and the reading stays partly due. An outcome with no activity date is unknown, whatever the student reported.
 */
function dueness(r: RevisionReading, now: Date, interval: number, withEvidence = false): number {
  const cap = REVISION_ASSUMPTIONS.overdueCap
  const outcomes = r.outcomeActivity.length ? r.outcomeActivity : [null]
  const per = outcomes.map((at, i) => {
    const base = at ? clamp(daysSinceIso(at, now) / interval, 0, cap) : REVISION_ASSUMPTIONS.unknownDueness
    return withEvidence && outcomeResting(r.outcomeEvidence?.[i], now) ? base * REVISION_ASSUMPTIONS.strongEvidenceRestFactor : base
  })
  return per.reduce((a, b) => a + b, 0) / per.length
}

/** Everything about one reading's rank. Pure; also used to explain a reading that was not selected. */
export function candidateFor(r: RevisionReading, input: Pick<SelectInput, 'phase' | 'now' | 'weekStart' | 'topicWeight' | 'focusTopics' | 'daysToCheckpoint'>, topicLastActivityDays: number | null): Candidate {
  const A = REVISION_ASSUMPTIONS
  const interval = intervalDays(input.phase, input.daysToCheckpoint)
  const recency = recencyOf(r, input.now, interval)
  const targeted = Boolean(r.uncertainty)

  // Reported uncertainty raises priority only while the reading is due against the shorter targeted interval, so a flagged
  // reading is revisited about weekly and then yields; it never holds the queue permanently.
  const targetedDue = targeted ? dueness(r, input.now, A.targetedIntervalDays) : 0
  const reported = targeted ? (UNCERTAINTY_WEIGHT[r.uncertainty!.level] - 1) * Math.min(1, targetedDue) + (r.uncertainty!.assumed ? 0 : 0.25) * Math.min(1, targetedDue) : 0

  const due = dueness(r, input.now, interval, true)
  let evidence = 0
  let evidenceNote: string | null = null
  const ev = r.evidence
  const total = ev.repair + ev.verify + ev.maintain + ev.untested
  const resting = (r.outcomeEvidence ?? []).filter(e => outcomeResting(e, input.now)).length
  // Unsteady, old or thin evidence raises priority in proportion to the outcomes it covers, not as if the whole reading were affected.
  if (ev.verify > 0 && total > 0) evidence = 0.75 * (ev.verify / total)
  const tested = ev.repair + ev.verify + ev.maintain
  if (tested === 0 && ev.untested > 0) evidenceNote = 'No reviewed-question evidence yet, so revision is guided by activity only'
  else if (tested > 0) {
    const bits = [
      resting > 0 ? `${resting} secure and recent (those rest for now)` : null,
      ev.maintain > resting ? `${ev.maintain - resting} secure but older (no longer resting)` : null,
      ev.verify > 0 ? `${ev.verify} need a fresh look (unsteady, old or thin evidence)` : null,
      ev.repair > 0 ? `${ev.repair} in repair` : null,
      ev.untested > 0 ? `${ev.untested} untested` : null,
    ].filter(Boolean)
    evidenceNote = `Of ${total} outcome${total === 1 ? '' : 's'} here, ${bits.join(', ')}. Only outcomes with their own supporting evidence rest; the rest keep their urgency`
  }

  const weights = input.topicWeight ?? {}
  const mean = Object.values(weights).length ? Object.values(weights).reduce((a, b) => a + b, 0) / Object.values(weights).length : 1
  const relevance = 0.5 * clamp(((weights[r.topic] ?? mean) / mean) - 1, -0.5, 0.5)
  const attention = topicLastActivityDays == null ? 0.5 : 0.5 * clamp(topicLastActivityDays / (2 * interval), 0, 1)
  const focus = input.focusTopics?.includes(r.topic) ? 0.75 : 0
  const checkpoint = input.daysToCheckpoint != null && input.daysToCheckpoint >= 0 && input.daysToCheckpoint <= A.checkpointWindowDays ? 0.25 : 0
  const declined = r.history.lastDeclinedAt && daysSinceIso(r.history.lastDeclinedAt, input.now) < A.declinedCooldownDays ? -A.declinedPenalty : 0

  const parts = { dueness: r2(due), reported: r2(reported), evidence: r2(evidence), relevance: r2(relevance), attention: r2(attention), focus, checkpoint, cooldown: declined }
  const score = r2(Object.values(parts).reduce((a, b) => a + b, 0))

  const reasons: string[] = []
  if (targeted) reasons.push(r.uncertainty!.assumed
    ? 'You said part of this subject feels uncertain, and this reading comes first in its order (self-reported, not test evidence).'
    : 'You marked this reading as one to revisit (self-reported, not test evidence).')
  if (recency.source === 'recorded') {
    const part = recency.totalOutcomes > 0 && recency.refreshedOutcomes < recency.totalOutcomes
      ? ` Recent confirmed activity covers ${recency.refreshedOutcomes} of ${recency.totalOutcomes} outcomes; the rest are untouched.` : ''
    const when = recency.days === 0 ? 'today' : `${recency.days} day${recency.days === 1 ? '' : 's'} ago`
    const how = recency.provenance === 'study_date' ? 'the study date you logged' : 'when you marked it done'
    reasons.push(`Last confirmed activity ${when} (${how}).${part}`)
  } else if (recency.source === 'reported') reasons.push('You said you were working on this subject when you set up PrepPlan. That gives no study date, so this reading’s last activity is unknown, not recent.')
  else reasons.push('No revision date is recorded, so this reading is due for a look. That is unknown, not forgotten.')
  if (input.daysToCheckpoint != null && checkpoint) reasons.push(`Your mock or checkpoint is ${input.daysToCheckpoint} day${input.daysToCheckpoint === 1 ? '' : 's'} away.`)
  if (focus) reasons.push('This subject is the roadmap’s focus for this stretch.')
  if (evidenceNote) reasons.push(evidenceNote.replace(/\.$/, '') + '.')
  if (declined) reasons.push('You skipped or removed this recently, so it is offered a little later.')

  return {
    readingId: r.id, name: r.name, topic: r.topic, topicName: r.topicName, kind: targeted ? 'targeted' : 'maintenance', score, parts, recency, reasons, evidenceNote,
  }
}

/** The mean-activity age of a subject's readings, null when nothing in it has any recorded activity. */
function topicActivityDays(readings: RevisionReading[], now: Date): Map<string, number | null> {
  const newest = new Map<string, string | null>()
  for (const r of readings) {
    const at = r.outcomeActivity.filter((a): a is string => Boolean(a)).sort().pop() ?? null
    const prev = newest.get(r.topic) ?? null
    newest.set(r.topic, at && (!prev || at > prev) ? at : prev)
  }
  return new Map([...newest].map(([t, at]) => [t, at ? daysSinceIso(at, now) : null]))
}

export type Selection = {
  selected: QueueEntry[]
  /** Eligible, ranked, but not chosen: over this week's limit or its subject's share. */
  waiting: QueueEntry[]
  /** Eligible but already handled elsewhere: a live task this week, work continuing into it, or an open repair. */
  elsewhere: QueueEntry[]
  eligible: number
}

/**
 * Chooses this week's readings. Deterministic: score, then the reading planned least recently (never-planned first), then a
 * per-week rotation key. A subject may take at most `maxSubjectShare` of the places while others have candidates, and the
 * remaining places are filled afterwards rather than left empty.
 */
export function selectRevision(input: SelectInput): Selection {
  const topicDays = topicActivityDays(input.readings.filter(isRevisable), input.now)
  const eligible = input.readings.filter(isRevisable)
  const ranked: QueueEntry[] = []
  const elsewhere: QueueEntry[] = []
  for (const r of eligible) {
    const c = candidateFor(r, input, topicDays.get(r.topic) ?? null)
    if (r.repairOverlap) elsewhere.push({ ...c, state: 'repair', waitingReason: 'An open repair already covers a weak point here. It keeps its own priority, so revision does not add a second block.' })
    else if (r.continuing) elsewhere.push({ ...c, state: 'continuing', waitingReason: 'This is already continuing from last week, so it is not scheduled twice.' })
    else if (r.scheduled) elsewhere.push({ ...c, state: 'in_plan', waitingReason: 'A revision task for this reading is already in the week.' })
    else ranked.push({ ...c, state: 'waiting', waitingReason: null })
  }
  const plannedAt = new Map(eligible.map(r => [r.id, r.history.lastPlannedAt ?? '']))
  const byRank = (a: QueueEntry, b: QueueEntry) =>
    b.score - a.score
    || (plannedAt.get(a.readingId)! < plannedAt.get(b.readingId)! ? -1 : plannedAt.get(a.readingId)! > plannedAt.get(b.readingId)! ? 1 : 0)
    || rotationKey(a.readingId, input.weekStart) - rotationKey(b.readingId, input.weekStart)
    || a.readingId.localeCompare(b.readingId)
  ranked.sort(byRank)

  const limit = Math.max(0, input.limit)
  const topicCap = Math.max(1, Math.ceil(limit * REVISION_ASSUMPTIONS.maxSubjectShare))
  const taken = new Map<string, number>()
  const selected: QueueEntry[] = []
  const rest: QueueEntry[] = []
  for (const e of ranked) {
    if (selected.length < limit && (taken.get(e.topic) ?? 0) < topicCap) { selected.push({ ...e, state: 'selected' }); taken.set(e.topic, (taken.get(e.topic) ?? 0) + 1) }
    else rest.push(e)
  }
  // Places a subject's share left empty are filled in rank order.
  const waiting: QueueEntry[] = []
  for (const e of rest) {
    if (selected.length < limit) selected.push({ ...e, state: 'selected' })
    else waiting.push({ ...e, waitingReason: e.parts.dueness < 0.5
      ? 'Revised recently, so it is not due yet. It returns to the queue when it is.'
      : (taken.get(e.topic) ?? 0) >= topicCap && limit > 0
        ? `This week’s revision is spread across subjects, and ${e.topicName} already has ${taken.get(e.topic)}. It is next in line.`
        : `This week’s revision limit (${limit}) is reached. It is next in line.` })
  }
  // The planner may fit only a prefix of this queue into the actual week. Apply the same subject share to that prefix.
  selected.sort(byRank)
  const ordered: QueueEntry[] = []
  const placedBySubject = new Map<string, number>()
  while (selected.length > 0) {
    const prefixCap = Math.max(1, Math.ceil((ordered.length + 1) * REVISION_ASSUMPTIONS.maxSubjectShare))
    const first = selected[0]
    // A recently revised or declined reading cannot jump ahead just to fill a subject slot.
    const next = selected.findIndex(entry => (placedBySubject.get(entry.topic) ?? 0) < prefixCap
      && entry.parts.dueness >= Math.min(1, first.parts.dueness) && entry.parts.cooldown >= first.parts.cooldown)
    const [entry] = selected.splice(next < 0 ? 0 : next, 1)
    ordered.push(entry)
    placedBySubject.set(entry.topic, (placedBySubject.get(entry.topic) ?? 0) + 1)
  }
  return { selected: ordered, waiting, elsewhere, eligible: eligible.length }
}

/** The compact, student-facing shape of a queue entry. */
export type RevisionLine = {
  readingId: string; name: string; topic: string; topicName: string; kind: 'targeted' | 'maintenance'
  why: string[]; recency: { source: RecencySource; days: number | null; provenance: 'study_date' | 'recorded' | null }; note: string | null
}
export const toLine = (e: QueueEntry): RevisionLine => ({
  readingId: e.readingId, name: e.name, topic: e.topic, topicName: e.topicName, kind: e.kind, why: e.reasons,
  recency: { source: e.recency.source, days: e.recency.days, provenance: e.recency.provenance }, note: e.waitingReason,
})

/**
 * Whether a paper or check can actually be assembled for ONE reading, stated as narrowly as the facts allow. Pure.
 * `eligibleUnseen` must come from the assessment service's own candidate rule (active manifest, concept-outcome binding,
 * review tier, items the student has not seen); `minimum` is the service's own smallest check. Revision planning never depends on it.
 */
export type CheckCapability = { state: 'none' | 'not_eligible' | 'insufficient' | 'supported'; eligibleUnseen: number; minimum: number; message: string }
export function checkCapability(totalItems: number, eligibleUnseen: number, minimum: number): CheckCapability {
  const base = { eligibleUnseen, minimum }
  if (totalItems === 0) return { ...base, state: 'none', message: 'No questions exist for this reading yet, so a paper cannot check it. Revision is still planned from your activity.' }
  if (eligibleUnseen === 0) return { ...base, state: 'not_eligible', message: 'Questions exist for this reading, but none is currently eligible for a check (not yet reviewed and mapped, or you have already seen them). Revision is still planned from your activity.' }
  if (eligibleUnseen < minimum) return { ...base, state: 'insufficient', message: `Only ${eligibleUnseen} eligible unseen question${eligibleUnseen === 1 ? ' is' : 's are'} available and a check needs at least ${minimum}, so a check cannot be started from this reading yet. Revision is still planned from your activity.` }
  return { ...base, state: 'supported', message: `${eligibleUnseen} eligible unseen questions are available, enough to start a reading check (minimum ${minimum}). That describes question depth only: it does not mean every outcome in the reading can be tested.` }
}
