/**
 * The four things a week's assessment can honestly be, in one vocabulary for Review, Calendar and Home.
 * Each surface maps its own facts to a stage; none invents wording of its own.
 */
export type AssessmentStage = 'scheduled_paper' | 'weekly_checkpoint' | 'awaiting_confirmed_work' | 'unavailable_coverage'

export const ASSESSMENT_STAGE_LABEL: Record<AssessmentStage, string> = {
  scheduled_paper: 'Scheduled paper',
  weekly_checkpoint: 'Weekly checkpoint',
  awaiting_confirmed_work: 'Awaiting confirmed work',
  unavailable_coverage: 'Coverage unavailable',
}

export const ASSESSMENT_AVAILABILITY_HREF = '/app/tests'

/** Onboarding Review: the planner's paper decision for the first cycle (nothing has been done yet, so a paper is always awaiting work). */
export function stageFromPlannedPaper(paper: { kind: 'paper' | 'none'; reason: string | null } | undefined): AssessmentStage {
  if (!paper) return 'weekly_checkpoint'
  if (paper.kind === 'paper') return 'scheduled_paper'
  return paper.reason === 'insufficient_bank' || paper.reason === 'below_minimum_paper' ? 'unavailable_coverage' : 'weekly_checkpoint'
}

/** Calendar and Tests: the weekly-paper state's primary kind. */
export function stageFromWeeklyPrimary(p: { kind: string; blocked?: string | null }): AssessmentStage {
  if (p.kind === 'start') return p.blocked ? 'unavailable_coverage' : 'scheduled_paper'
  if (p.kind === 'resume' || p.kind === 'result') return 'scheduled_paper'
  return 'awaiting_confirmed_work'
}

/** The actual reason, in one sentence, when a weekly paper cannot be built for a scope. Detail (which readings, how many questions) follows it. */
export const PAPER_UNAVAILABLE_BANK = 'A weekly paper is unavailable for this scope because checked questions are missing.'
export const PAPER_UNAVAILABLE_THIN = 'A weekly paper is unavailable for this scope because the work is too small to make a worthwhile paper on its own.'
export const PLAN_AVAILABILITY_HREF = '/app/calendar'
