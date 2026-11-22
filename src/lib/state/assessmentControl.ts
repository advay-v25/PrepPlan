import type { AssessmentControl, AssessmentSummary } from './types'
import { PAPER_UNAVAILABLE_BANK } from '../tests/assessmentStage'

/**
 * The action a system assessment task (a weekly paper or a repair re-check) offers. These are never "marked done" by the student: they are
 * started, resumed, read as a result, waited for, or explained as unavailable. Wording and destinations come from the assessment decision
 * and the repair-check plan, the same sources Tests uses, so a button here cannot promise what Tests would refuse.
 */
export function controlForPaperTask(a: AssessmentSummary | undefined): AssessmentControl {
  const tests = '/app/tests'
  if (!a) return { kind: 'waiting', label: 'Open in Tests', href: tests, note: null }
  switch (a.state) {
    case 'running': return { kind: 'resume', label: 'Resume paper', href: a.destination, note: a.clock ?? null }
    case 'scored': return { kind: 'result', label: 'See result', href: a.destination, note: null }
    case 'ready': return { kind: 'start', label: 'Start paper', href: a.destination, note: null }
    case 'upcoming': return { kind: 'start', label: 'Start paper early', href: a.destination, note: a.dueDate ? `It is due ${a.dueDate}; you can take it earlier.` : null }
    case 'confirm_scope': return { kind: 'waiting', label: 'Confirm coverage', href: a.destination, note: a.message }
    case 'unavailable': return { kind: 'unavailable', label: 'View assessment availability', href: tests, note: PAPER_UNAVAILABLE_BANK }
    default: return { kind: 'waiting', label: 'Open in Tests', href: tests, note: a.message ?? 'It is set from the work you complete this week.' }
  }
}

type Plan = { state: string; attemptId?: string; message?: string }

export function controlForRecheck(plan: Plan | null, taskHref: string): AssessmentControl {
  if (!plan) return { kind: 'waiting', label: 'Open the check', href: taskHref, note: null }
  switch (plan.state) {
    case 'resume': return { kind: 'resume', label: 'Resume check', href: `/app/tests/${plan.attemptId}`, note: null }
    case 'startable': return { kind: 'start', label: 'Start check', href: taskHref, note: null }
    case 'waiting': return { kind: 'waiting', label: 'Waiting', href: taskHref, note: plan.message ?? 'Finish the repair work first.' }
    case 'bank_insufficient': return { kind: 'unavailable', label: 'View assessment availability', href: '/app/tests', note: plan.message ?? null }
    default: return { kind: 'unavailable', label: 'Open the check', href: taskHref, note: plan.message ?? 'This check is no longer available.' }
  }
}
