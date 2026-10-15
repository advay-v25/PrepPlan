/**
 * Assessment limits, in one place. Planner, API, blueprint and form assembly all
 * read these, so the ceiling cannot drift between them again.
 */
/** No assessment of any kind exceeds this many questions. */
export const MAX_ASSESSMENT_QUESTIONS = 90
/** Exam-like reference pace: 90 seconds per question (an average, not a per-item pass mark). */
export const REFERENCE_SECONDS_PER_QUESTION = 90
export const REFERENCE_MINUTES_PER_QUESTION = REFERENCE_SECONDS_PER_QUESTION / 60
/** A timed mock: 90 questions in 135 minutes. */
export const MOCK_QUESTIONS = 90
export const MOCK_MINUTES = 135
/** A routine weekly paper aims to fit a morning, well under the ceiling. */
export const WEEKLY_PAPER_SOFT_MAX_QUESTIONS = 60

export const clampQuestions = (n: number) => Math.max(0, Math.min(MAX_ASSESSMENT_QUESTIONS, Math.floor(n)))
export const estimatedMinutes = (questions: number) => Math.round(clampQuestions(questions) * REFERENCE_MINUTES_PER_QUESTION)
