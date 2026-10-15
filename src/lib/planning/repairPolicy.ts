/**
 * Pure repair lifecycle and placement logic.
 */

import { StudyWeek } from './studyWeek'

export interface RepairThreadContext {
  id: string
  concept_id: string
  status: 'open' | 'proposed' | 'scheduled' | 'in_progress' | 'awaiting_recheck' | 'closed'
  severity: string | null
  occurrence_count: number
  latest_evidence_at: string
}

export interface TaskProposal {
  id: string
  title: string
  detail: string
  task_type: string
  priority: string
  placement: string
  duration_minutes: number
  duration: string
  rationale: string
  suggested_approach: string
  completion_meaning: string
  repair_thread_id?: string
  local_date?: string
  day?: string
  starts_at?: string
}

/**
 * Determines repair task duration based on occurrence count.
 */
export function determineRepairDuration(occurrenceCount: number): number {
  if (occurrenceCount === 1) return 30 // Quick focused repair
  if (occurrenceCount === 2) return 45 // Deep dive
  return 60 // Extended intervention
}

/**
 * Determines task type based on occurrence count (escalation).
 */
export function determineRepairType(occurrenceCount: number): string {
  if (occurrenceCount === 1) return 'focus' // Review
  return 'workshop' // Escalated active engagement
}

/**
 * Validates that all proposed tasks fall inside the stated target week.
 */
export function validateProposalPlacement(tasks: TaskProposal[], targetWeek: StudyWeek): boolean {
  for (const t of tasks) {
    if (t.local_date) {
      if (t.local_date < targetWeek.startDate || t.local_date > targetWeek.endDate) {
        return false
      }
    }
  }
  return true
}

/**
 * Determines if the proposed tasks can fit in the current cycle, or if they should
 * roll over to the next week's draft.
 * MVP simplified: if we are proposing on the final day, it goes to next week.
 */
export function determineProposalWeek(currentWeek: StudyWeek, todayIso: string): 'current' | 'next' {
  if (todayIso >= currentWeek.endDate) {
    return 'next'
  }
  return 'current'
}

/**
 * Generates a stable proposal identity hash based on the thread IDs it addresses.
 */
export function generateProposalIdentity(threadIds: string[], targetWeekStart: string): string {
  return Array.from(threadIds).sort().join(',') + '|' + targetWeekStart
}
