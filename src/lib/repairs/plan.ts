import { placeContinuing, type ContinuingItem } from '../planning/weeklyReview/composer'
import { determineRepairDuration } from '../planning/repairPolicy'
import { addDays } from '../planning/studyWeek'
import { packWhole, type Gap } from '../planning/pulse/gaps'
import { RECHECK_GAP_DAYS } from './recheckDate'
import { studyGuidance, guidanceText } from '../study/guidance'

export const REPAIR_POLICY_VERSION = 'repair-loop-1'
export { RECHECK_GAP_DAYS }

export type PlanThread = { id: string; conceptId: string; conceptName: string; severity: string | null; occurrence: number; scopeNotes: string | null; takenOn: string }
export type PlanInput = {
  attemptId: string; today: string
  cycle: { start: string; end: string }
  weekDates: string[]; studyDates: string[]
  /** Free minutes per date, net of commitments AND work already planned. */
  capacity: Record<string, number>
  /** Contiguous free gaps per date, net of timed and accepted flexible work. When present, fit is decided against these, never the day total above. */
  gapsByDate?: Record<string, Gap[]>
  maxSittingMinutes: number | null
  threads: PlanThread[]
  /** portion key (`${threadId}:${n}`) or 'check' -> a date in the cycle, or 'none' */
  overrides?: Record<string, string>
  keepForLater?: string[]
  newId: () => string
}
export type PlannedTask = { id: string; key: string; title: string; detail: string; local_date: string; duration_minutes: number; repair_thread_id: string; rationale: string; suggested_approach: string | null; completion_meaning: string; learning_objective: string }
export type PlanResult = {
  tasks: PlannedTask[]
  check: { id: string; title: string; detail: string; local_date: string; duration_minutes: number; rationale: string; completion_meaning: string; learning_objective: string; threadIds: string[] } | null
  waitingChecks: { threadIds: string[]; earliestDate: string; reason: string }[]
  unplaced: { threadId: string; conceptName: string; reason: string }[]
  threadIds: string[]
}

/** Equal 5-minute sittings no longer than the student's limit (15 minutes minimum). */
export function splitIntoSittings(total: number, max: number | null): number[] {
  if (!max || total <= max) return [total]
  let n = Math.ceil(total / max)
  while (n > 1 && Math.floor(total / n / 5) * 5 < 15) n--
  const base = Math.floor(total / n / 5) * 5
  const out = Array<number>(n).fill(base)
  for (let left = total - base * n, i = 0; left > 0; left -= 5, i = (i + 1) % n) out[i] += Math.min(5, left)
  return out
}

export function planRepairFollowUp(i: PlanInput): PlanResult {
  const kept = new Set(i.keepForLater ?? [])
  const threads = i.threads.filter(t => !kept.has(t.id))
    .sort((a, b) => Number(b.severity === 'needs_repair') - Number(a.severity === 'needs_repair') || b.occurrence - a.occurrence)
  const studyDates = i.studyDates.filter(d => d >= i.today && d >= i.cycle.start && d <= i.cycle.end)
  const place = (items: ContinuingItem[]) => placeContinuing({ items, weekDates: i.weekDates, studyDates, capacity: i.capacity, gapsByDate: i.gapsByDate, overrideDates: i.weekDates, maxSittingMinutes: i.maxSittingMinutes, overrides: i.overrides })

  // A repair is placed whole or not at all: its check cannot become ready after only some of its portions.
  let accepted: ContinuingItem[] = [], placed = place([])
  const unplaced: PlanResult['unplaced'] = []
  const portionsOf = new Map<string, { key: string; minutes: number }[]>()
  for (const t of threads) {
    const parts = splitIntoSittings(determineRepairDuration(t.occurrence), i.maxSittingMinutes).map((minutes, n) => ({ key: `${t.id}:${n}`, minutes }))
    const items: ContinuingItem[] = parts.map(p => ({ taskId: p.key, title: t.conceptName, taskType: 'repair', minutes: p.minutes, intent: 'continue', lmId: null, outcomeId: null, repairThreadId: t.id, originalDate: null }))
    const trial = place([...accepted, ...items])
    const failed = trial.placements.filter(p => items.some(x => x.taskId === p.taskId) && !p.date)[0]
    if (failed) { unplaced.push({ threadId: t.id, conceptName: t.conceptName, reason: failed.reason ?? 'It does not fit this week.' }); continue }
    accepted = [...accepted, ...items]; placed = trial; portionsOf.set(t.id, parts)
  }

  const dateOf = new Map(placed.placements.map(p => [p.taskId, p.date!]))
  const tasks: PlannedTask[] = accepted.map(a => {
    const t = threads.find(x => x.id === a.repairThreadId)!
    const n = portionsOf.get(t.id)!.length
    const part = Number(a.taskId.split(':')[1]) + 1
    // Fragile (correct but unsure) and wrong-while-sure repairs call for different work; the observed signal is kept apart from any explanation.
    const g = studyGuidance({ signal: t.severity === 'unstable' ? 'fragile_correct' : 'misconception', scope: t.conceptName, observed: t.severity === 'unstable' ? null : 'missed on the diagnostic' })
    return {
      id: i.newId(), key: a.taskId, title: `Repair: ${t.conceptName}${n > 1 ? ` (${part} of ${n})` : ''}`,
      detail: t.severity === 'unstable' ? 'You answered this correctly but were not sure. Close the gap between knowing and being certain.' : 'This came back wrong on your diagnostic. Work on it in your own course material.',
      local_date: dateOf.get(a.taskId)!, duration_minutes: a.minutes, repair_thread_id: t.id,
      rationale: `${t.severity === 'unstable' ? 'Correct but unsure' : 'Missed'} on the diagnostic of ${t.takenOn}.`,
      suggested_approach: `${g.activity}${t.scopeNotes ? ` Focus on: ${t.scopeNotes.slice(0, 160)}` : ''}`,
      completion_meaning: `${g.completion} Whether the gap is closed is decided by the re-check, not by marking this done. Afterwards: ${g.verify}`,
      learning_objective: `${t.conceptName}: close the gap the diagnostic found.`,
    }
  })

  const threadIds = threads.map(t => t.id)
  const covered = [...portionsOf.keys()]
  let check: PlanResult['check'] = null
  const waitingChecks: PlanResult['waitingChecks'] = []
  if (covered.length) {
    const last = tasks.map(t => t.local_date).sort().at(-1)!
    const earliest = addDays(last, RECHECK_GAP_DAYS)
    const minutes = covered.length <= 2 ? 15 : 30
    const choice = i.overrides?.check
    const fits = (d: string) => placed.gapsAfterContinuations ? packWhole(placed.gapsAfterContinuations[d] ?? [], minutes) !== null : (i.capacity[d] ?? 0) - (placed.reservedByDate[d] ?? 0) >= minutes
    const date = choice && choice !== 'none' && choice >= earliest && i.weekDates.includes(choice) ? choice
      : choice === 'none' ? undefined : studyDates.find(d => d >= earliest && fits(d))
    if (date) {
      check = { id: i.newId(), title: `Re-check: ${covered.length} repaired concept${covered.length === 1 ? '' : 's'}`, detail: 'A short check on exactly what you repaired, using questions you have not seen.',
        local_date: date, duration_minutes: minutes, rationale: `Placed ${RECHECK_GAP_DAYS}+ days after your last repair so it tests retention, not the session you just finished.`,
        completion_meaning: 'You took the check. What it shows comes from the scored result.', learning_objective: 'Show whether the repaired concepts hold.', threadIds: covered }
    } else {
      waitingChecks.push({ threadIds: covered, earliestDate: earliest, reason: earliest > i.cycle.end
        ? `The check comes ${RECHECK_GAP_DAYS} days after your last repair, which is after this week. It stays waiting; open this follow-up in the new week to add it.`
        : 'No day in this week has room for the check after your commitments and planned work.' })
    }
  }
  return { tasks, check, waitingChecks, unplaced, threadIds }
}
