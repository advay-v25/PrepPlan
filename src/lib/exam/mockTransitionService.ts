import { getActiveRoadmap, observedMinutesPerEffortUnit, weeklyCapacityMinutes } from '../curriculum/roadmapService'
import { getLosTracker } from '../curriculum/losTrackerService'
import { isFirstPassPending, remainingEffort, SEEDED_MINUTES_PER_EFFORT_UNIT } from '../curriculum/roadmap'
import { lastStudyDate, loadOpenFlexible, loadPlacementContext, loadTimedBusy, NEW_CONTENT_DAILY_CAP_EFFORT_UNITS } from '../planning/pulse/generateWeek'
import { OBSERVATION_RULES } from '../planning/cycleObservation'
import { terminalIds } from '../planning/taskLineage'
import { ownedBlocks } from '../ops/sharedReads'
import { TRANSITION } from './mockTransition'
import type { Reserved } from './runwayForecast'
import { bookedMockDemands, savedEstimates, usableDays } from '../planning/usableTime'
import { gapsAfterAccepted } from '../planning/pulse/gaps'
import { addDays, daysBetween, weekdayOf, type StudyWeek } from '../planning/studyWeek'
import { weekForDate } from '../planning/schedule'
import { activeCycleRow } from '../ops/sharedReads'
import { perRequest, minuteOf } from '../ops/perRequest'
import { loadExamStatus } from './status'
import { decideRehearsal } from '../rehearsal/service'
import { acceptedRecoveryPath, loadRecoveryStatus } from '../planning/recovery/service'
import { createAdminClient } from '../supabase/admin'
import { mockTransition, type MockEstimates, type MockTransition, type TransitionInput } from './mockTransition'

const MAX_NAMED = 5

/** The study days between the proposed week and the mock runway (shared capacity rules), and the other work that claims that room first. */
async function runwayInputs(userId: string, o: { week: StudyWeek; daysToExam: number; today: string; now: Date; route: string; horizon: string; maxSitting: number; rate: number; estimates: MockEstimates }) {
  const end = addDays(o.today, o.daysToExam - TRANSITION.runwayWeeks * 7)
  const rules = { maxSitting: o.maxSitting, minSitting: 15, dailyNewMinutes: Math.round(NEW_CONTENT_DAILY_CAP_EFFORT_UNITS * o.rate) }
  const [usable, blocks, repairs] = await Promise.all([
    usableDays(userId, { from: o.week.days[0], end, today: o.today, now: o.now, timezone: o.week.timezone, route: o.route, horizon: o.horizon }),
    ownedBlocks(userId),
    createAdminClient().from('repair_threads').select('id').eq('user_id', userId).in('status', ['open', 'proposed']).throwOnError(),
  ])
  if (!usable.days.length) return { days: usable.days, reserved: [] as Reserved[], rules }
  const workload = OBSERVATION_RULES.workload as readonly string[]
  const live = blocks.filter(b => !b.cancelled_at && b.task_type && workload.includes(b.task_type) && b.priority !== 'optional')
  const terminal = terminalIds(live.map(b => ({ id: b.id, continuedFromId: b.continued_from_task_id })))
  // Owed work with no future day of its own: it will be carried into these weeks, so it needs room before anything new.
  const owed = live.filter(b => terminal.has(b.id) && ['not_started', 'in_progress', 'partial', 'deferred'].includes(b.execution) && (b.local_date === null || b.local_date < o.today || b.execution === 'deferred'))
  const planned = new Set(live.map(b => b.repair_thread_id).filter(Boolean))
  const unplanned = (repairs.data ?? []).filter(r => !planned.has(r.id as string)).length
  // Work tied to a date is reserved before undated work can fill the days it needs.
  const reserved: Reserved[] = [...bookedMockDemands(usable.mocks, usable.accepted, o.estimates), ...owed.map(b => ({ title: b.title, minutes: Number(b.duration_minutes ?? 0) })),
    ...(unplanned ? [{ title: 'Open repairs', minutes: unplanned * 30 }] : [])]
  return { days: usable.days, reserved, rules }
}

/**
 * The server-owned "ready for mocks" recommendation. Home, the Roadmap, Weekly Review and Coach read this one function; nothing here writes.
 * Coverage comes from the active roadmap, evidence from the LOS tracker, time from the same gap functions the planner and the SQL packer use.
 */
async function loadMockTransitionUncached(userId: string, now = new Date(), edited?: MockEstimates | null): Promise<MockTransition> {
  const status = await loadExamStatus(userId, now)
  // A student who has not booked a date still has the sitting the Roadmap plans toward; only a passed, sat or awaiting-status exam has no horizon.
  if (!['no_date', 'long_horizon', 'final_preparation', 'final_week'].includes(status.phase)) return { available: false, reason: 'Mock timing applies before the exam.' }

  const [active, tracker, weekly, cycle, perUnit, bankCanServe, recovery] = await Promise.all([getActiveRoadmap(userId), getLosTracker(userId, now), weeklyCapacityMinutes(userId).catch(() => null), activeCycleRow(userId), observedMinutesPerEffortUnit(userId).catch(() => null),
    // Can PrepPlan's own bank serve a linked mock at all? When not, the external route is offered instead.
    Promise.resolve(null),
    // The full status is computed only when the protect-core path was accepted and could still hold the mock.
    acceptedRecoveryPath(userId).then(p => p === 'protect_core' ? loadRecoveryStatus(userId, now) : null).catch(() => null)])
  if (!active) return { available: false, reason: 'Build your Roadmap first.' }
  const daysToExam = status.daysToExam ?? daysBetween(status.today, active.roadmap.targetDate)

  // The week a mock would be proposed in: the week after the open one, or this week when none is open.
  const today = status.today
  const from = cycle?.ends_at_local ? addDays(String(cycle.ends_at_local), 1) : today
  const week = await weekForDate(userId, from > today ? from : today)
  const [context, timedBusy, openFlexible] = await Promise.all([loadPlacementContext(userId, week, now), loadTimedBusy(userId, week), loadOpenFlexible(userId, week)])
  const gaps = week.days.flatMap(d => gapsAfterAccepted(context.gapsByDate[d] ?? [], timedBusy[d] ?? [], openFlexible[d] ?? []))
  const largest = gaps.reduce((m, g) => Math.max(m, g.end - g.start), 0)

  const modules = tracker.topics.flatMap(t => t.modules.map(m => ({ ...m, topic: t.id })))
  const tracked = modules.filter(m => m.tracked)
  const total = tracked.reduce((n, m) => n + m.counts.total, 0)
  const isCovered = (m: (typeof modules)[number]) => m.coverage !== 'not_started'
  const uncovered = tracked.filter(m => !isCovered(m)).reduce((n, m) => n + m.counts.total, 0)
  const untestedCovered = tracked.filter(isCovered).reduce((n, m) => n + m.counts.untested, 0)
  const repair = tracked.reduce((n, m) => n + m.counts.repair, 0)
  const evidenced = tracker.depth.withEvidence

  const href = (m: (typeof modules)[number]) => `/app/curriculum/${m.topic}/${m.id}`
  const named: TransitionInput['gaps'] = [
    ...tracked.filter(m => m.counts.repair > 0).sort((a, b) => b.counts.repair - a.counts.repair).map(m => ({ kind: 'repair' as const, name: m.name, href: href(m), count: m.counts.repair })),
    ...tracked.filter(m => isCovered(m) && m.counts.untested > 0).sort((a, b) => b.counts.untested - a.counts.untested).map(m => ({ kind: 'untested' as const, name: m.name, href: href(m), count: m.counts.untested })),
    ...tracked.filter(m => !isCovered(m)).map(m => ({ kind: 'uncovered' as const, name: m.name, href: href(m), count: m.counts.total })),
  ]
  // Findings first, then areas not yet covered, then evidence gaps; each kind keeps a place so none crowds out the others.
  const pick = (kind: string, n: number) => named.filter(g => g.kind === kind).slice(0, n)
  const shown = [...pick('repair', 2), ...pick('uncovered', 3), ...pick('untested', 2)].slice(0, MAX_NAMED + 2)

  // The remaining first-pass work, named, in the order the Roadmap schedules it.
  const order = new Map(active.roadmap.milestones.filter(m => m.phase === 'first_pass').map((m, i) => [m.topicId, i] as const))
  const rate = perUnit ?? SEEDED_MINUTES_PER_EFFORT_UNIT
  const work = active.input.modules.filter(isFirstPassPending)
    .sort((a, b) => (order.get(a.topic) ?? 99) - (order.get(b.topic) ?? 99) || a.sequence - b.sequence)
    .map(m => ({ name: m.name, href: `/app/curriculum/${m.topic}/${m.id}`, minutes: Math.round(remainingEffort(m) * rate) }))
  const estimates = edited ?? await savedEstimates(userId)
  const input: TransitionInput = {
    daysToExam, total, uncovered, untestedCovered, evidenced, repair, gaps: shown, bankCanServe, recoveryHold: recovery?.chosen === 'protect_core',
    work, weeklyMinutes: weekly, estimates,
    runway: await runwayInputs(userId, { week, daysToExam, today, now, route: active.input.route, horizon: lastStudyDate(active.roadmap), maxSitting: context.maxSittingMinutes ?? 180, rate, estimates }),
    largestGapMinutes: largest, freeMinutes: gaps.reduce((n, g) => n + (g.end - g.start), 0), maxSittingMinutes: context.maxSittingMinutes,
  }
  // The bank check loads the question pool, so it only runs when a mock is actually being recommended (not while broad revision comes first).
  const first = mockTransition(input)
  if (!first.available || first.verdict === 'more_revision') return first
  return mockTransition({ ...input, bankCanServe: await decideRehearsal(userId, null).then(r => r.decision.state === 'start').catch(() => null) })
}

export const loadMockTransition = perRequest(loadMockTransitionUncached, (u: string, n?: Date, e?: MockEstimates | null) => `${u}|${minuteOf(n)}|${e ? `${e.debrief}:${e.followUp}` : ''}`)
