import { z } from 'zod'

const text = z.string().trim().max(1500)
const choice = z.string().max(100)

// Detailed time windows for scheduling (e.g., { day: 1, start: '18:00', end: '20:00' })
export const timeWindowSchema = z.object({
  day: z.number().int().min(1).max(7),
  start: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  end: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
})

export const studyContextSchema = z.object({
  name: z.string().trim().max(100).default(''),
  // Removed explicit timezone question (derived from device settings locally)
  
  // 1. Starting Point
  examMonth: z.string().refine(v => !v || /^(20[2-9][0-9])-(0[1-9]|1[0-2])$/.test(v) && Number(v.slice(0, 4)) >= 2027 || v === 'undecided', 'Use a valid month or undecided.').default(''),
  learningMode: choice.default(''), // e.g. coaching, self-study, both
  stage: choice.default(''), // e.g. not-started, in-progress, revision

  // 2. Learning Anchor
  priorityTopic: text.default(''),
  weeklyGoal: choice.default(''), // consolidate, advance, restart, revise

  // 3. Sources
  sources: z.array(choice).max(12).default(['Schweser 2027']),
  imports: z.array(z.object({ name: z.string().max(255), summary: z.string().max(1000), relevant: z.boolean(), topics: z.array(choice).max(10) })).max(5).default([]),

  // 4. Fit the week
  schedulingMode: z.enum(['Suggest times', 'Choose days only', 'Keep tasks flexible', '']).default(''),
  preferredDayParts: z.array(z.string().regex(/^[1-7]-(Morning|Afternoon|Evening)$/)).max(21).default([]),
  exactWindows: z.array(timeWindowSchema).max(21).default([]),
  sessionMinutes: z.union([z.literal(0), z.literal(20), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(0),
  commitments: text.default(''),
  exceptions: text.default(''),

  // 5. Practice & Checkpoint
  testComfort: choice.default(''),
  checkInDay: choice.default(''),
  
  notes: text.default(''),
})
export type StudyContext = z.infer<typeof studyContextSchema>

// The envelope now uses step 1 to 5
export const contextEnvelopeSchema = z.object({ version: z.literal(5), step: z.number().int().min(0).max(6), context: studyContextSchema })
export const emptyStudyContext = (): StudyContext => studyContextSchema.parse({})

// V4 compatibility adapter
export function readStudyContext(answers: unknown): { context: StudyContext; step: number } {
  const parsed = contextEnvelopeSchema.safeParse(answers)
  if (parsed.success) return parsed.data
  
  // Legacy parsing from V4
  const payload = (answers && typeof answers === 'object' ? answers : {}) as Record<string, unknown>
  const old = (payload.context && typeof payload.context === 'object' ? payload.context : payload) as Record<string, unknown>
  
  const context = emptyStudyContext()
  if (typeof old.name === 'string') context.name = old.name.slice(0, 100)
  if (typeof old.examMonth === 'string' && (/^202[7-9]-\d{2}/.test(old.examMonth) || old.examMonth === 'undecided')) context.examMonth = old.examMonth
  if (Array.isArray(old.sources)) context.sources = old.sources.filter((v): v is string => typeof v === 'string').slice(0, 12)
  if (typeof old.learningMode === 'string') context.learningMode = old.learningMode
  if (typeof old.stage === 'string') context.stage = old.stage
  
  return { context, step: 1 }
}
