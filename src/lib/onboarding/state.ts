import type { Step } from './steps'

export type OnboardingProfile = {
  id?: string
  timezone?: string | null
  registered?: boolean | null
  exam_window_id?: string | null
  exam_date?: string | null
  class_pattern?: string | null
  prep_mode?: string | null
  stage?: string | null
  max_session_minutes?: number | null
  onboarding_status?: 'not_started' | 'in_progress' | 'review_ready' | 'complete' | null
  week_availability_mode?: 'windows' | 'varies' | 'none_this_week' | null
  [key: string]: unknown
}

export type OnboardingCommitment = {
  id?: string
  kind?: string
  label?: string
  weekdays?: number[]
  start_time?: string
  end_time?: string
  ends_on?: string | null
  status?: string
  source?: string
  [key: string]: unknown
}

export type OnboardingAvailability = {
  id?: string
  weekday?: number
  start_time?: string
  end_time?: string
  status?: string
  [key: string]: unknown
}

export type OnboardingExposure = {
  id?: string
  topic_id?: string
  recency?: string
  [key: string]: unknown
}

/**
 * The single read contract for onboarding. Produced by readCanonicalState()
 * and consumed, unchanged, by the page, the shell and all six steps.
 */
export type OnboardingState = {
  profile: OnboardingProfile | null
  /** Active calendar_commitments rows (classes and other fixed commitments). */
  commitments: OnboardingCommitment[]
  /** Active availability_windows rows: concrete weekday + start/end windows. */
  availability: OnboardingAvailability[]
  /** user_topic_exposure rows: self-reported topic recency. */
  coverage: OnboardingExposure[]
  /** Which steps have persisted, validated state behind them. */
  completed: Record<Exclude<Step, 'plan'>, boolean>
  firstIncompleteStep: Step
  /** True when at least one weekly class is saved. */
  hasClasses: boolean
}
