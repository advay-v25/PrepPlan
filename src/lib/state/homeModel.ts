import type { PlanBlock, WorkModel, WorkStatus } from './types'
import { reportedOnDay, taskTimes, type TimeEvent } from './reportedTime'
import { todayInZone } from '../planning/studyWeek'
import { inDeclaredOrder } from '../planning/declaredOrder'

const CLOSED = ['completed', 'skipped', 'deferred']
const RANK: Record<WorkStatus, number> = { in_progress: 0, current: 1, overdue: 2, upcoming: 3, today: 4, unplaced: 5 }

export function remainingPlanTime(tasks: Pick<PlanBlock, 'durationMinutes' | 'execution' | 'reportedMinutes'>[]) {
  let remainingPlannedMinutes = 0, plannedUsedButOpen = 0
  for (const task of tasks) {
    const planned = task.durationMinutes || 0
    const reported = task.execution === 'partial' ? task.reportedMinutes ?? 0 : 0
    remainingPlannedMinutes += Math.max(0, planned - reported)
    if (planned > 0 && reported >= planned) plannedUsedButOpen++
  }
  return { remainingPlannedMinutes, plannedUsedButOpen }
}

/**
 * Home's one view of the current cycle's work. Pure: the same blocks, events, local date and clock always give the same order.
 *
 * Order, with explicit tie-breakers: started work first; a timed session that is under way; overdue work (oldest day, then earliest
 * start); upcoming timed sessions (soonest); flexible work for today (partly done before untouched); work with no day yet. Ties fall
 * to the day, then the start, then the id, so two sessions on the same day can never swap places between reads.
 */
export function buildWork(
  blocks: PlanBlock[], events: TimeEvent[], today: string, nowMs: number, timezone = 'UTC',
): WorkModel {
  const times = taskTimes(events)
  const withReported = blocks.map(b => {
    const t = times.get(b.id)
    // Unknown stays unknown (null), never 0: "partly done, no time given" is a different statement from "0 minutes reported".
    return { ...b, reportedMinutes: t ? t.minutes : (b.reportedMinutes ?? null), timeUnknown: t?.unknown ?? false }
  })

  const statusOf = (b: PlanBlock): WorkStatus | null => {
    if (b.execution === 'in_progress') return 'in_progress'
    const date = b.localDate ?? null
    if (!date || b.placement === 'floating') return 'unplaced'
    if (date < today) return 'overdue'
    if (date > today) return null // later in the cycle: not Home's business today
    if (b.placement === 'timed' && b.startsAt) {
      const start = Date.parse(b.startsAt), end = start + (b.durationMinutes || 0) * 60_000
      return nowMs >= end ? 'overdue' : nowMs >= start ? 'current' : 'upcoming'
    }
    return 'today'
  }

  const sorted = withReported
    .filter(b => !CLOSED.includes(b.execution))
    .map(b => ({ ...b, workStatus: statusOf(b) }))
    .filter((b): b is typeof b & { workStatus: WorkStatus } => b.workStatus !== null)
    .sort((a, b) =>
      RANK[a.workStatus] - RANK[b.workStatus]
      // Date and time first, so the oldest unfinished work leads; partly done only breaks a tie between equals.
      || (a.localDate ?? '9999').localeCompare(b.localDate ?? '9999')
      || (a.startsAt ? Date.parse(a.startsAt) : Infinity) - (b.startsAt ? Date.parse(b.startsAt) : Infinity)
      || (a.execution === 'partial' ? 0 : 1) - (b.execution === 'partial' ? 0 : 1)
      || (a.sittingOrdinal ?? Infinity) - (b.sittingOrdinal ?? Infinity) || 0
      || a.id.localeCompare(b.id))
  const open = inDeclaredOrder(sorted, t => t.id, t => t.follows ?? [])

  const dated = open.filter(b => b.workStatus !== 'unplaced')
  const todays = withReported.filter(b => b.localDate === today)
  const day = reportedOnDay(times, today, iso => todayInZone(timezone, new Date(iso)))
  return {
    open,
    overdue: open.filter(b => b.workStatus === 'overdue').length,
    unplaced: open.filter(b => b.workStatus === 'unplaced').length,
    completedToday: todays.filter(b => b.execution === 'completed'),
    deferredToday: todays.filter(b => b.execution === 'deferred'),
    deferred: withReported.filter(b => b.execution === 'deferred').sort((a, b) => (a.localDate ?? '').localeCompare(b.localDate ?? '') || a.id.localeCompare(b.id)),
    ...remainingPlanTime(dated),
    reportedMinutesToday: day.minutes,
    reportedTodayUnknown: day.unknownReports,
  }
}

