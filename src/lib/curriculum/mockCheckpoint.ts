import { MOCK_KIND_LABEL, type MockKind } from './entryContext'
import { addDays, daysBetween, weekdayOf } from '../planning/studyWeek'
import { permitsStudyPortions } from '../planning/pulse/weekBoundary'
import { end, overlaps, type Interval, type Occupant } from '../planning/mutations'

/**
 * The mock or checkpoint a student told us about. One canonical record (profiles.mock_*); Calendar, Home, the roadmap,
 * Coach and Settings all read it through this shape. Pure.
 *
 * Everything optional stays optional. A date alone is a complete checkpoint: no time is invented, no day is reserved
 * for it, and the card says what scheduling detail is still missing. Whatever result a student reports later is
 * self-reported; none of it is question evidence.
 */
export type Checkpoint = {
  date: string
  kind: MockKind
  /** The student's own words ("Coaching mock"); the kind's plain label is used when empty. */
  label: string | null
  /** Local HH:MM. Null = the student has not given a time. */
  startTime: string | null
  durationMinutes: number | null
}

export type AssessmentChoice = 'use_mock' | 'keep_paper' | 'later'
export const ASSESSMENT_CHOICES: AssessmentChoice[] = ['use_mock', 'keep_paper', 'later']
export type MockOutcome = 'taken' | 'postponed' | 'not_taken'
export const MOCK_OUTCOMES: MockOutcome[] = ['taken', 'postponed', 'not_taken']

export const checkpointTitle = (c: Pick<Checkpoint, 'kind' | 'label'>) => c.label?.trim() || MOCK_KIND_LABEL[c.kind]

export const toMinutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m }
export const toHHMM = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** What the student has not told us yet, in their terms. Empty = nothing missing. */
export function missingDetails(c: Checkpoint): string[] {
  const out: string[] = []
  if (!c.startTime) out.push('start time')
  if (!c.durationMinutes) out.push('expected length')
  return out
}

/** The interval a timed checkpoint with a known length actually occupies; null when either is unknown (nothing is reserved). */
export function reservedInterval(c: Checkpoint): Interval | null {
  if (!c.startTime || !c.durationMinutes) return null
  return { date: c.date, start: toMinutes(c.startTime), durationMinutes: c.durationMinutes }
}

export function describeTiming(c: Checkpoint): string {
  if (!c.startTime) return 'Date only — no time set'
  const start = toMinutes(c.startTime)
  return c.durationMinutes ? `${toHHMM(start)}–${toHHMM(Math.min(start + c.durationMinutes, 24 * 60 - 1))}` : `From ${toHHMM(start)} · length not set`
}

export type Range = { start: number; end: number }
/** `windows` minus every occupant that overlaps them, in clock order. */
export function freeRanges(windows: Range[], occupants: Interval[]): Range[] {
  let pieces = [...windows].sort((a, b) => a.start - b.start)
  for (const o of occupants) {
    const next: Range[] = []
    for (const p of pieces) {
      if (end(o) <= p.start || o.start >= p.end) { next.push(p); continue }
      if (o.start > p.start) next.push({ start: p.start, end: o.start })
      if (end(o) < p.end) next.push({ start: end(o), end: p.end })
    }
    pieces = next
  }
  return pieces
}

export type Suggestion = {
  id: 'prepare-1' | 'prepare-2' | 'analyse'
  kind: 'prepare' | 'analyse'
  title: string
  minutes: number
  /** Where it would go. Null when nothing fits: it is then listed as unplaced, with the reason. */
  date: string | null
  startMinutes: number | null
  reason: string
  unplacedReason: string | null
  /** True only when it can be added now: placed, inside the OPEN cycle and not in the past. Later cycles stay proposals. */
  addable: boolean
  /** Why a placed suggestion cannot be added yet (it falls in a cycle that is not open). */
  laterReason: string | null
}

export const PREP_MINUTES = 45
export const ANALYSIS_MINUTES = 45
/** Order in which days before the mock are tried: close enough to matter, not the day before only. */
const PREP_OFFSETS = [-2, -4, -1, -3, -5]

export type ProjectionInput = {
  checkpoint: Checkpoint
  today: string
  /** The student's preparation route. Self-study never plans study on Sunday (its paper/closure day); the mock itself may fall on one. */
  route?: 'self_study' | 'coaching' | 'hybrid'
  /** The student's own limit for one sitting. 45 minutes is a proposal and is shortened to fit. */
  maxSittingMinutes?: number | null
  /** The current local clock, so nothing is proposed for a time that has already passed today. */
  now?: { date: string; minutes: number }
  /** Minutes of accepted work already sitting on each date (timed or not): a clock gap is not free time if the day is already full. */
  plannedMinutesByDate?: Record<string, number>
  /** The open cycle. Suggestions are only addable inside it. */
  openCycle?: { start: string; end: string } | null
  /** The student's own study windows per local date (minutes). A date with no windows holds nothing. */
  windowsByDate: Record<string, Range[]>
  /** Timed tasks and commitments, from the same loader the Calendar uses. */
  occupants: Occupant[]
}

/**
 * Preparation and post-mock analysis as proposals. Nothing here is written: a student adds each one (or none), and a
 * proposal that does not fit is listed as unplaced with the reason instead of being squeezed in or dropped.
 * Placement honours the student's windows, protected and timed commitments, and the mock itself when its time and length are known.
 */
export function projectCheckpoint(input: ProjectionInput): { suggestions: Suggestion[]; conflicts: { title: string; overlapMinutes: number }[] } {
  const { checkpoint: c, today, windowsByDate, occupants } = input
  const route = input.route ?? 'coaching'
  const mockBlock = reservedInterval(c)
  const blockers: Interval[] = [...occupants, ...(mockBlock ? [mockBlock] : [])]
  const subject = checkpointTitle(c)
  const sitting = Math.max(15, Math.floor(Math.min(PREP_MINUTES, input.maxSittingMinutes ?? PREP_MINUTES) / 5) * 5)
  const analysisMinutes = Math.max(15, Math.floor(Math.min(ANALYSIS_MINUTES, input.maxSittingMinutes ?? ANALYSIS_MINUTES) / 5) * 5)

  const conflicts = mockBlock
    ? occupants.filter(o => overlaps(mockBlock, o)).map(o => ({ title: o.title, overlapMinutes: Math.min(end(mockBlock), end(o)) - Math.max(mockBlock.start, o.start) }))
    : []

  const taken: Interval[] = []
  const windowTotal = (date: string) => (windowsByDate[date] ?? []).reduce((n, w) => n + (w.end - w.start), 0)
  /** Why no time on `date`, or the earliest start that fits. A day already full of accepted work is not offered even if a clock gap exists. */
  const place = (date: string, minutes: number, notBefore = 0): { start: number } | { why: string } => {
    if (date < today) return { why: 'in the past' }
    if (!permitsStudyPortions(route, weekdayOf(date))) return { why: 'Sunday' }
    const floor = date === input.now?.date ? Math.max(notBefore, Math.ceil(input.now.minutes / 5) * 5) : notBefore
    const free = freeRanges(windowsByDate[date] ?? [], [...blockers, ...taken].filter(i => i.date === date))
    const slot = free.find(r => r.end - Math.max(r.start, floor) >= minutes)
    if (!slot) return { why: 'no free window' }
    const planned = (input.plannedMinutesByDate?.[date] ?? 0) + taken.filter(t => t.date === date).reduce((n, t) => n + t.durationMinutes, 0)
    if (input.plannedMinutesByDate && planned + minutes > windowTotal(date)) return { why: 'already full' }
    return { start: Math.max(slot.start, floor) }
  }
  const inOpenCycle = (date: string) => !!input.openCycle && date >= input.openCycle.start && date <= input.openCycle.end && date >= today

  const finish = (s: Omit<Suggestion, 'addable' | 'laterReason'>): Suggestion => {
    const addable = s.date !== null && inOpenCycle(s.date)
    return { ...s, addable, laterReason: s.date !== null && !addable ? 'It falls in a week that is not open yet; it can be added once that week is.' : null }
  }

  const suggestions: Suggestion[] = []
  const used = new Set<string>()
  const whys = new Set<string>()
  for (const id of ['prepare-1', 'prepare-2'] as const) {
    let hit: { date: string; start: number } | null = null
    for (const off of PREP_OFFSETS) {
      const date = addDays(c.date, off)
      if (used.has(date)) continue
      const r = place(date, sitting)
      if ('start' in r) { hit = { date, start: r.start }; break }
      whys.add(r.why)
    }
    const title = `Prepare for ${subject}`
    const reason = `Revise what the mock is likely to cover, from your own notes and questions. Suggested, not required${sitting < PREP_MINUTES ? `; shortened to your ${input.maxSittingMinutes}-minute sitting limit` : ''}.`
    if (hit) {
      used.add(hit.date); taken.push({ date: hit.date, start: hit.start, durationMinutes: sitting })
      suggestions.push(finish({ id, kind: 'prepare', title, minutes: sitting, date: hit.date, startMinutes: hit.start, unplacedReason: null, reason }))
    } else {
      const unplacedReason = daysBetween(today, c.date) <= 1 ? 'The mock is too close to fit preparation.'
        : whys.has('already full') && !whys.has('no free window') ? 'The days before it are already full of planned work. Move something, or skip this.'
        : `None of the days before it has a free ${sitting}-minute study window${route === 'self_study' ? ' (self-study keeps Sunday for your paper)' : ''}. Add availability in Calendar, or skip this.`
      suggestions.push(finish({ id, kind: 'prepare', title, minutes: sitting, date: null, startMinutes: null, reason, unplacedReason }))
    }
  }

  // After the mock: the same day when its end is known and a window follows, otherwise the days after it.
  let analysis: { date: string; start: number } | null = null
  const mockEnd = mockBlock ? end(mockBlock) : null
  for (const off of [0, 1, 2, 3]) {
    const date = addDays(c.date, off)
    const r = place(date, analysisMinutes, off === 0 ? (mockEnd ?? 24 * 60) : 0)
    if ('start' in r) { analysis = { date, start: r.start }; break }
  }
  suggestions.push(finish({
    id: 'analyse', kind: 'analyse', title: `Go over ${subject}`, minutes: analysisMinutes,
    date: analysis?.date ?? null, startMinutes: analysis?.start ?? null,
    reason: 'A short check-in after the mock: what went well, what to revisit. You can note a result you were given; it stays your own report.',
    unplacedReason: analysis ? null : `No free ${analysisMinutes}-minute study window in the three days after it${route === 'self_study' ? ' (self-study keeps Sunday for your paper)' : ''}. Add availability in Calendar, or skip this.`,
  }))
  return { suggestions, conflicts }
}

/** Which week (by its first day) a date belongs to, given any week's first day. */
export function weekStartContaining(date: string, someWeekStart: string): string {
  const offset = Math.floor(daysBetween(someWeekStart, date) / 7)
  return addDays(someWeekStart, offset * 7)
}
