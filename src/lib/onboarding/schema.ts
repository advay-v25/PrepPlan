import { z } from 'zod'

// ---------------------------------------------------------------------------
// Shared time rules. Pure, so they are testable without a database, and used by
// both the schemas below and the tests.
// ---------------------------------------------------------------------------
const TIME = /^\d{2}:\d{2}$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export type TimedRow = { weekday: number; start: string; end: string }

/**
 * The first problem in a set of weekly time ranges, or null. A range must end after it starts, and two
 * ranges on the same weekday must not overlap. Identical rows are reported as duplicates, since they are
 * the most common way overlap happens.
 */
export function findTimeProblem(rows: TimedRow[], noun: string): string | null {
  for (const r of rows) {
    if (minutes(r.end) <= minutes(r.start)) return `${noun} must end after it starts (${r.start}–${r.end}).`
  }
  const byDay = new Map<number, TimedRow[]>()
  for (const r of rows) byDay.set(r.weekday, [...(byDay.get(r.weekday) ?? []), r])
  for (const list of byDay.values()) {
    const sorted = [...list].sort((x, y) => minutes(x.start) - minutes(y.start) || minutes(x.end) - minutes(y.end))
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], cur = sorted[i]
      if (prev.start === cur.start && prev.end === cur.end) return `The same ${noun} is listed twice.`
      if (minutes(cur.start) < minutes(prev.end)) return `Two ${noun}s overlap (${prev.start}–${prev.end} and ${cur.start}–${cur.end}).`
    }
  }
  return null
}

function validTimezone(tz: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

// 1. Exam Setup
//
// An unregistered candidate plans against the sitting they picked; an exact date exists only for a booked
// exam. Whatever date arrives with `registered: false` is dropped here so a stale one can never survive a
// change of mind. Whether the window is supported and the date sits inside it is checked against the
// database in service.ts.
export const ExamSetupSchema = z.object({
  examWindowId: z.string().uuid(),
  registered: z.boolean(),
  examDate: z.string().regex(DATE, 'Must be YYYY-MM-DD').nullable().optional(),
  timezone: z.string().min(1, 'Timezone is required').refine(validTimezone, 'Unknown timezone'),
}).transform(d => ({ ...d, examDate: d.registered ? (d.examDate ?? null) : null }))
  .refine(d => !d.registered || !!d.examDate, {
    message: 'A registered candidate needs the exact booked date.',
    path: ['examDate'],
  })

export type ExamSetup = z.infer<typeof ExamSetupSchema>

// 2. Preparation Setup
export const ClassPatternSchema = z.enum(['none', 'fixed', 'variable', 'mixed'])
export type ClassPattern = z.infer<typeof ClassPatternSchema>

export const PrepRouteSchema = z.enum(['self_study', 'self_paced_course', 'instructor_led', 'hybrid'])
export type PrepRoute = z.infer<typeof PrepRouteSchema>

export const RecurringClassSchema = z.object({
  label: z.string().max(80).optional().default(''),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME),
  endsOn: z.string().regex(DATE).nullable().optional().default(null),
})

/** One actual upcoming class, for a student whose classes change week to week. */
export const NextClassSchema = z.object({
  label: z.string().max(80).optional().default(''),
  date: z.string().regex(DATE),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME),
})

export const PreparationSetupSchema = z.object({
  prepMode: PrepRouteSchema,
  classPattern: ClassPatternSchema,
  recurringClasses: z.array(RecurringClassSchema).default([]),
  nextClass: NextClassSchema.nullable().optional().default(null),
}).superRefine((d, ctx) => {
  const add = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path })
  const ownOrder = d.prepMode === 'self_study' || d.prepMode === 'self_paced_course'

  if (ownOrder) {
    if (d.classPattern !== 'none') add('This route has no live classes.', ['classPattern'])
    if (d.recurringClasses.length || d.nextClass) add('Live classes only apply to a class-led route.', ['recurringClasses'])
    return
  }
  if (d.classPattern === 'none') add('Choose how your classes are scheduled.', ['classPattern'])
  if ((d.classPattern === 'fixed' || d.classPattern === 'mixed') && d.recurringClasses.length === 0) {
    add('Add at least one weekly class.', ['recurringClasses'])
  }
  if (d.classPattern === 'variable' && d.recurringClasses.length > 0) {
    add('Classes that change week to week have no fixed weekly schedule.', ['recurringClasses'])
  }
  if (d.classPattern === 'fixed' && d.nextClass) add('A fixed schedule needs no separate next class.', ['nextClass'])

  const rows: TimedRow[] = d.recurringClasses.flatMap(c => c.weekdays.map(weekday => ({ weekday, start: c.startTime, end: c.endTime })))
  const problem = findTimeProblem(rows, 'class')
  if (problem) add(problem, ['recurringClasses'])
  if (d.nextClass && minutes(d.nextClass.endTime) <= minutes(d.nextClass.startTime)) {
    add('The next class must end after it starts.', ['nextClass'])
  }
})

export type PreparationSetup = z.infer<typeof PreparationSetupSchema>

// 3. Position Setup — the candidate's own estimate. It orders the roadmap and sets first-cycle scope; it
// never becomes evidence of understanding. Unselected topics mean "not reported".
export const STAGE_VALUES = ['starting_fresh', 'first_pass_underway', 'most_of_first_pass', 'revising_or_mocks', 'retaking'] as const
export const StageSchema = z.enum(STAGE_VALUES)
export type Stage = z.infer<typeof StageSchema>

export const TopicStatusSchema = z.enum(['current', 'recent'])   // working on now / covered before
export const TopicExposureSchema = z.record(z.string().min(1), TopicStatusSchema)

export const PositionSetupSchema = z.object({
  stage: StageSchema,
  topicExposure: TopicExposureSchema.default({}),
}).superRefine((d, ctx) => {
  const needsTopics = d.stage === 'revising_or_mocks' || d.stage === 'retaking'
  if (needsTopics && Object.keys(d.topicExposure).length === 0) {
    ctx.addIssue({ code: 'custom', path: ['topicExposure'], message: 'Mark at least one topic you have covered, so the first plan has a credible starting point.' })
  }
})

export type PositionSetup = z.infer<typeof PositionSetupSchema>

// 4. Week Setup — when Roadmap may schedule study. Time outside these windows is treated as unavailable,
// so fixed commitments are optional context, not something the candidate must describe.
export const CommitmentKindSchema = z.enum(['class', 'work', 'college', 'personal', 'commute', 'exercise', 'family', 'appointment', 'travel', 'other'])

export const RecurringCommitmentSchema = z.object({
  label: z.string().max(80).optional().default(''),
  kind: CommitmentKindSchema.optional().default('other'),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME),
})

export const AvailabilityWindowSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  startTime: z.string().regex(TIME),
  endTime: z.string().regex(TIME),
})

/** `windows`: study windows were given. The other two record that the student cannot give them yet. */
export const AvailabilityModeSchema = z.enum(['windows', 'varies', 'none_this_week'])
export type AvailabilityMode = z.infer<typeof AvailabilityModeSchema>

export const WeekSetupSchema = z.preprocess(raw => {
  // The previous screen sent a boolean instead of a mode. Accept it during the changeover.
  const r = (raw ?? {}) as Record<string, unknown>
  if (r.availabilityMode === undefined) {
    const hasWindows = Array.isArray(r.windows) && r.windows.length > 0
    return { ...r, availabilityMode: hasWindows ? 'windows' : r.noWindowsAcknowledge ? 'none_this_week' : 'windows' }
  }
  return r
}, z.object({
  availabilityMode: AvailabilityModeSchema,
  windows: z.array(AvailabilityWindowSchema).default([]),
  commitments: z.array(RecurringCommitmentSchema).default([]),
  maxSessionMinutes: z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]),
}).superRefine((d, ctx) => {
  const add = (message: string, path: (string | number)[]) => ctx.addIssue({ code: 'custom', message, path })
  if (d.availabilityMode === 'windows' && d.windows.length === 0) add('Choose at least one time when Roadmap may schedule study.', ['windows'])
  if (d.availabilityMode !== 'windows' && d.windows.length > 0) add('Study windows conflict with saying your schedule cannot be set.', ['windows'])

  const windowProblem = findTimeProblem(d.windows.map(w => ({ weekday: w.weekday, start: w.startTime, end: w.endTime })), 'study window')
  if (windowProblem) add(windowProblem, ['windows'])
  const commitmentProblem = findTimeProblem(
    d.commitments.flatMap(c => c.weekdays.map(weekday => ({ weekday, start: c.startTime, end: c.endTime }))), 'commitment')
  if (commitmentProblem) add(commitmentProblem, ['commitments'])
}))

export type WeekSetup = z.infer<typeof WeekSetupSchema>

// 6. Preview Adjustments
export const PreviewAdjustmentSchema = z.object({
  action: z.enum(['lighter', 'more_space', 'move', 'floating']),
  taskId: z.string().uuid().optional(),
  targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// 7. Confirmation Request
export const ConfirmationRequestSchema = z.object({
  draftId: z.string().uuid(),
  expectedRevision: z.number().int().nonnegative(),
})

export type ConfirmationRequest = z.infer<typeof ConfirmationRequestSchema>
