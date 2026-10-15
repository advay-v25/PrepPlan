import type { Weekday } from '../planning/studyWeek'
import type { DayPart } from '../planning/weekday'

/**
 * The five onboarding screens, as data.
 *
 * Named steps rather than indices, so the URL is `/onboarding/week` and the back button works.
 * There is no checkpoint screen: it asked nothing. The week-closing day is derived from the class
 * schedule and shown on the final review, and `/onboarding/checkpoint` redirects to `plan`.
 */
export const STEPS = ['exam', 'route', 'position', 'week', 'plan'] as const
export type Step = (typeof STEPS)[number]

export const STEP_META: Record<Step, { index: number; nav: string; title: string; blurb: string }> = {
  exam: {
    index: 1, nav: 'Your exam',
    title: 'Which 2027 exam are you sitting?',
    blurb: 'This sets how long the first pass gets, when revision starts, and which weeks are kept for mocks.',
  },
  route: {
    index: 2, nav: 'How you study',
    title: 'How are you preparing?',
    blurb: 'This decides one thing: whether your classes set the order of topics, or Roadmap does.',
  },
  position: {
    index: 3, nav: 'Where you are',
    title: 'Where are you starting from?',
    blurb: 'Your estimate is enough. Tests will correct it.',
  },
  week: {
    index: 4, nav: 'Your week',
    title: 'When may Roadmap schedule study?',
    blurb: 'Only inside the times you choose. Everything else is treated as unavailable.',
  },
  plan: {
    index: 5, nav: 'Review',
    title: 'Review and start.',
    blurb: 'Check what Roadmap assumed. Every answer stays editable in Settings.',
  },
}

export function nextStep(step: Step): Step | null {
  const i = STEPS.indexOf(step)
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null
}

export function previousStep(step: Step): Step | null {
  const i = STEPS.indexOf(step)
  return i > 0 ? STEPS[i - 1] : null
}

export function isStep(value: string): value is Step {
  return (STEPS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Payload shapes — what each screen sends (now from schema.ts)
// ---------------------------------------------------------------------------
import type { 
  ExamSetup, 
  PreparationSetup, 
  PositionSetup, 
  WeekSetup, 
  PrepRoute,
  ClassPattern,
  Stage
} from './schema'

export type { ExamSetup, PreparationSetup, PositionSetup, WeekSetup, PrepRoute, ClassPattern }

export const ROUTE_OPTIONS: { value: PrepRoute; label: string; detail: string; anchors: boolean }[] = [
  { value: 'self_study', label: 'On my own', detail: 'Your materials, Roadmap sets the order.', anchors: false },
  { value: 'self_paced_course', label: 'Self-paced course', detail: 'Recorded or online; Roadmap sets the order.', anchors: false },
  { value: 'instructor_led', label: 'Live classes', detail: 'Your teacher sets the order; Roadmap follows.', anchors: true },
  { value: 'hybrid', label: 'Classes plus my own study', detail: 'Classes lead; Roadmap fills the gaps.', anchors: true },
]

export const CLASS_PATTERN_OPTIONS: { value: ClassPattern; label: string }[] = [
  { value: 'fixed', label: 'Same times every week' },
  { value: 'variable', label: 'Changes week to week' },
  { value: 'mixed', label: 'Some fixed, some one-off' },
]

/** Working on now / covered before. Leaving a topic unselected means "not reported". */
export const TOPIC_STATUS_OPTIONS: { value: 'current' | 'recent'; label: string }[] = [
  { value: 'current', label: 'Working on now' },
  { value: 'recent', label: 'Covered before' },
]

export const STARTING_STAGES: { value: Stage; label: string; needsTopics: boolean }[] = [
  { value: 'starting_fresh', label: 'Starting fresh', needsTopics: false },
  { value: 'first_pass_underway', label: 'First pass underway', needsTopics: false },
  { value: 'most_of_first_pass', label: 'Most of first pass complete', needsTopics: false },
  { value: 'revising_or_mocks', label: 'Revising or taking mocks', needsTopics: true },
  { value: 'retaking', label: 'Retaking', needsTopics: true },
]

/** Where a saved link to a retired step should land. */
export const RETIRED_STEPS: Record<string, Step> = { checkpoint: 'plan' }
