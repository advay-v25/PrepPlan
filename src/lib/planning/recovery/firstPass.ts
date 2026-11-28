/**
 * The first-pass study the Roadmap will still schedule and the student has not accepted yet (pure). It names readings; it creates nothing.
 * Applicable means what the weekly planner itself would pick up: a pending reading in a milestone of a first-pass, consolidation or revision phase
 * that is open during the forecast window (final preparation adds no new study). Each reading's minutes are counted once: whatever a task already
 * holds (accepted, owed or carried), has delivered, or the student skipped is taken off.
 */
import { isFirstPassPending, remainingEffort, type ModuleInput, type Roadmap } from '../../curriculum/roadmap'
import { addDays } from '../studyWeek'

export type NewStudy = { title: string; readingId: string; minutes: number; notBefore?: string }
export type ReadingTask = { id: string; readingId: string | null; taskType: string | null; execution: string; minutes: number; continuedFromId: string | null }
const STUDY = ['study', 'class_consolidation']

/** Minutes of each reading already spoken for: the newest link of a chain holds its planned minutes; earlier links only what was logged on them. */
export function spokenFor(tasks: ReadingTask[], logged: Map<string, number>, carried: { readingId: string; minutes: number }[] = []): Map<string, number> {
  const out = new Map<string, number>()
  const add = (id: string, m: number) => out.set(id, (out.get(id) ?? 0) + m)
  const continued = new Set(tasks.map(t => t.continuedFromId).filter(Boolean))
  for (const t of tasks) {
    if (!t.readingId || !t.taskType || !STUDY.includes(t.taskType)) continue
    const done = logged.get(t.id) ?? 0
    add(t.readingId, continued.has(t.id) ? done : t.execution === 'completed' ? Math.max(t.minutes, done) : t.minutes)
  }
  for (const c of carried) add(c.readingId, c.minutes)
  return out
}

export function firstPassDemand(o: { roadmap: Pick<Roadmap, 'phases' | 'milestones' | 'sequencedModuleIds'>; modules: ModuleInput[]; from: string; end: string; minutesPerEffortUnit: number; spoken: Map<string, number> }): NewStudy[] {
  const open = new Map(o.roadmap.phases.filter(p => p.phase !== 'final' && p.endDate >= o.from && p.startDate <= o.end).map(p => [p.phase, p.startDate]))
  /** The first day each reading may be studied: the earliest open phase that holds it. */
  const starts = new Map<string, string>()
  for (const m of o.roadmap.milestones) {
    const start = open.get(m.phase)
    if (start === undefined) continue
    for (const id of m.moduleIds) if (!starts.has(id) || start < starts.get(id)!) starts.set(id, start)
  }
  const order = new Map(o.roadmap.sequencedModuleIds.map((id, i) => [id, i]))
  return o.modules.filter(m => starts.has(m.id) && isFirstPassPending(m))
    .sort((a, b) => starts.get(a.id)!.localeCompare(starts.get(b.id)!) || (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9))
    .map(m => ({ title: m.name, readingId: m.id, minutes: Math.max(0, Math.round(remainingEffort(m) * o.minutesPerEffortUnit) - (o.spoken.get(m.id) ?? 0)), notBefore: starts.get(m.id)! > o.from ? starts.get(m.id) : undefined }))
    .filter(m => m.minutes >= 5)
}

export type StudyForecast = { items: NewStudy[]; /** The first day broad study resumes after an accepted mock-led week. */ studyFrom: string | null; notCounted: { minutes: number; reason: string } | null }

/**
 * What the forecast counts, and what it says when something is left out. An accepted mock-led week holds broad study until it ends; what the Roadmap
 * schedules after that stays in as provisional. A window with nothing to count says which of its reasons applies.
 */
export function forecastStudy(o: Parameters<typeof firstPassDemand>[0] & { mockLedUntil: string | null; classesRunning: boolean }): StudyForecast {
  const resume = o.mockLedUntil && o.mockLedUntil >= o.from ? addDays(o.mockLedUntil, 1) : null
  const items = resume && resume > o.end ? [] : firstPassDemand({ ...o, from: resume ?? o.from })
    .map(i => resume && (!i.notBefore || i.notBefore < resume) ? { ...i, notBefore: resume } : i)
  if (items.length) return { items, studyFrom: resume, notCounted: null }
  const displaced = resume ? firstPassDemand(o) : []
  if (displaced.length) return { items, studyFrom: null, notCounted: { minutes: displaced.reduce((n, d) => n + d.minutes, 0), reason: 'It waits behind the mock-led week you accepted, and no study week is left in this forecast after it.' } }
  // Nothing to count. Whatever is still unfinished and unspoken for is named as left out, with the reason that applies.
  const minutes = o.modules.filter(isFirstPassPending).reduce((n, m) => n + Math.max(0, Math.round(remainingEffort(m) * o.minutesPerEffortUnit) - (o.spoken.get(m.id) ?? 0)), 0)
  if (!minutes) return { items, studyFrom: null, notCounted: null }
  const reason = !o.roadmap.phases.some(p => p.phase !== 'final' && p.endDate >= o.from) ? 'Your Roadmap is in final preparation, which adds no new study.'
    : o.classesRunning ? 'Your classes set the order of new material, and your Roadmap schedules none of its own in this period.'
    : 'Your Roadmap has no unfinished reading scheduled for first study in this period.'
  return { items, studyFrom: null, notCounted: { minutes, reason } }
}
