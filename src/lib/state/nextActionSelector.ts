import { OperatingState, ActionableDecision, PlanBlock, PaperForm, CoachProposal } from './types'
import { calendarTaskHref } from '../routing/calendar'

export function selectNextAction(state: OperatingState): ActionableDecision {
  const { integrity, cycle, today, execution, papers, repairs, attention } = state

  // 1. Recover failed baseline/current-week activation
  if (integrity.activationFailed || state.activation === 'activation_failed') {
    return {
      id: 'recover-activation',
      revision: 0,
      availability: 'available',
      destination: '/app/calendar',
      permittedCommands: ['retry_activation'],
      code: 'recover_activation',
      title: 'Roadmap activation failed',
      rationale: 'There was a problem starting your study week. We need to try again.',
      scope: 'Activation',
      timing: 'Immediate',
      expectedDurationMinutes: null
    }
  }

  // 2. Resolve a blocking stale/conflict state
  if (integrity.isStale || integrity.crossPageInvariantFailed) {
    return {
      id: 'resolve-conflict',
      revision: 0,
      availability: 'available',
      destination: '/app/settings',
      permittedCommands: ['refresh_state'],
      code: 'resolve_conflict',
      title: 'State conflict detected',
      rationale: 'Your data might be out of sync across devices. Please refresh.',
      scope: 'System',
      timing: 'Immediate',
      expectedDurationMinutes: null
    }
  }

  // 2.5 Setup required
  if (state.activation === 'preview_required' || state.activation === 'acceptance_required') {
    return {
      id: 'recover-activation',
      revision: 0,
      availability: 'available',
      destination: '/app/calendar',
      permittedCommands: ['start_activation'],
      code: 'recover_activation',
      title: 'Your first week is ready to review',
      rationale: 'Review a proposed week, then adjust it to what fits.',
      scope: 'Activation',
      timing: 'Immediate',
      expectedDurationMinutes: null
    }
  }

  // Eligible today-work: anything not already finished, and not skipped or
  // deferred — a skipped task was explicitly declined and a deferred one was
  // explicitly set aside, so neither is "what's next" until it is re-placed
  // (which gives it a fresh plan_block, not this same still-deferred one).
  // class_consolidation was previously excluded outright, which meant a
  // class-led student's actual next task (the consolidation work from their
  // last class) could never be selected — there is no reason that task type
  // is less eligible than any other.
  const INELIGIBLE_EXECUTION = ['completed', 'skipped', 'deferred']
  const tasks = today.blocks.filter(b => !INELIGIBLE_EXECUTION.includes(b.execution))

  // 3. Resume an in-progress executable task
  const inProgressTask = tasks.find(t => t.execution === 'in_progress')
  if (inProgressTask) {
    return {
      id: inProgressTask.id,
      revision: inProgressTask.revision,
      availability: 'available',
      destination: calendarTaskHref(inProgressTask.id, today.dateLocal),
      permittedCommands: ['complete_task', 'defer_task'],
      code: 'resume_task',
      title: inProgressTask.title,
      rationale: 'You already started this task.',
      scope: inProgressTask.taskType,
      timing: 'Now',
      expectedDurationMinutes: inProgressTask.durationMinutes
    }
  }

  // 4. Complete missing logs required to unlock weekly closure
  // (Assuming we can detect this if cycle.closureState === 'closure_ready' but there are unreported minutes)
  if (cycle?.closureState === 'closure_ready' && execution.unreportedMinutes > 0) {
    return {
      id: 'complete-logs',
      revision: cycle.revision,
      availability: 'available',
      destination: '/app/review-week',
      permittedCommands: ['submit_logs'],
      code: 'complete_logs',
      title: 'Complete missing logs',
      rationale: 'You need to log your remaining activities to close the week.',
      scope: 'Weekly Closure',
      timing: 'Now',
      expectedDurationMinutes: 5
    }
  }

  // 4b. A paper already in progress comes before starting anything new.
  if (papers.activeReservation) {
    const r = papers.activeReservation
    return {
      id: r.id,
      revision: r.revision,
      availability: 'available',
      destination: r.destination,
      permittedCommands: ['resume_paper'],
      code: 'take_paper',
      title: `Resume your ${r.purpose} paper`,
      rationale: 'Your paper is open and the clock only counts active time.',
      scope: r.purpose,
      timing: 'Now',
      expectedDurationMinutes: 0
    }
  }

  // 5. Take/resume a due and reservable diagnostic, revisionary, or mixed paper.
  const duePaper = papers.availablePapers.find(p => p.sufficientBank)
  if (duePaper) {
    return {
      id: duePaper.id,
      revision: duePaper.revision,
      availability: 'available',
      destination: '/app/tests',
      permittedCommands: ['start_paper'],
      code: 'take_paper',
      title: `Your ${duePaper.purpose} paper is ready`,
      rationale: (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && state.identity.classPattern && state.identity.classPattern !== 'none'
        ? 'Take your scheduled paper to close the cycle and unlock next week.' 
        : 'Take your weekly Sunday paper to close the seven-day cycle and unlock next week.',
      scope: duePaper.purpose,
      timing: 'Now',
      expectedDurationMinutes: duePaper.estimatedDurationMinutes
    }
  }

  // 6. Review a scored paper and its plan consequences
  // (Mocking this: if there's an attention item for a scored paper)
  const scoredPaperReview = attention.find(a => a.code === 'scored_paper')
  if (scoredPaperReview) {
    return {
      id: scoredPaperReview.id,
      revision: 0,
      availability: 'available',
      destination: scoredPaperReview.destination,
      permittedCommands: ['review_paper'],
      code: 'review_scored_paper',
      title: scoredPaperReview.title,
      rationale: scoredPaperReview.description,
      scope: 'Review',
      timing: 'Now',
      expectedDurationMinutes: null
    }
  }

  // 7. Review a repair/recheck proposal that affects the active week
  if (repairs.proposals.length > 0) {
    const proposal = repairs.proposals[0]
    return {
      id: proposal.id,
      revision: proposal.revision,
      availability: 'available',
      destination: '/app/coach',
      permittedCommands: ['accept_proposal', 'reject_proposal'],
      code: 'review_repair',
      title: `Review proposal: ${proposal.title}`,
      rationale: proposal.summary,
      scope: 'Repair',
      timing: 'Now',
      expectedDurationMinutes: null
    }
  }

  // 8. Start the next timed executable class/study/repair action due now or today
  const timedTask = tasks.find(t => t.placement === 'timed' && t.startsAt)
  if (timedTask) {
    return {
      id: timedTask.id,
      revision: timedTask.revision,
      availability: 'available',
      destination: calendarTaskHref(timedTask.id, today.dateLocal),
      permittedCommands: ['start_task', 'defer_task'],
      code: 'start_timed_task',
      title: timedTask.title,
      rationale: 'This is scheduled for a specific time today.',
      scope: timedTask.taskType,
      timing: 'Scheduled',
      expectedDurationMinutes: timedTask.durationMinutes
    }
  }

  // 9. Start the next accepted day-preferred core task
  const preferredTask = tasks.find(t => t.placement === 'day_preferred')
  if (preferredTask) {
    return {
      id: preferredTask.id,
      revision: preferredTask.revision,
      availability: 'available',
      destination: calendarTaskHref(preferredTask.id, today.dateLocal),
      permittedCommands: ['start_task', 'defer_task'],
      code: 'start_preferred_task',
      title: preferredTask.title,
      rationale: 'This is your next priority task for today.',
      scope: preferredTask.taskType,
      timing: 'Today',
      expectedDurationMinutes: preferredTask.durationMinutes
    }
  }

  // 10. Review/accept a pending weekly draft
  const pendingDraft = attention.find(a => a.code === 'pending_draft')
  if (pendingDraft) {
    return {
      id: pendingDraft.id,
      revision: 0,
      availability: 'available',
      destination: pendingDraft.destination,
      permittedCommands: ['accept_draft', 'review_draft'],
      code: 'review_draft',
      title: pendingDraft.title,
      rationale: pendingDraft.description,
      scope: 'Planning',
      timing: 'Now',
      expectedDurationMinutes: null
    }
  }

  // 11. Place an unplaced core task
  const floatingTask = tasks.find(t => t.placement === 'floating')
  if (floatingTask) {
    return {
      id: floatingTask.id,
      revision: floatingTask.revision,
      availability: 'available',
      destination: calendarTaskHref(floatingTask.id, today.dateLocal),
      permittedCommands: ['place_task'],
      code: 'place_task',
      title: floatingTask.title,
      rationale: 'This task needs to be scheduled.',
      scope: floatingTask.taskType,
      timing: 'Soon',
      expectedDurationMinutes: floatingTask.durationMinutes
    }
  }

  // 12. Complete weekly closure and generate/review the next week
  if (cycle?.closureState === 'closure_ready') {
    return {
      id: 'weekly-closure',
      revision: cycle.revision,
      availability: 'available',
      destination: '/app/review-week',
      permittedCommands: ['start_closure'],
      code: 'complete_closure',
      title: 'Close the week',
      rationale: (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && state.identity.classPattern && state.identity.classPattern !== 'none'
        ? 'Complete your cycle closure to confirm your execution.'
        : 'Complete your weekly Sunday paper to close the seven-day cycle.',
      scope: 'closure',
      timing: 'Now',
      expectedDurationMinutes: 10
    }
  }

  // 13. If none applies, return a typed honest empty state
  return {
    id: 'empty',
    revision: 0,
    availability: 'unavailable',
    destination: '/app/calendar',
    permittedCommands: [],
    code: 'honest_empty',
    title: 'You are all caught up',
    rationale: 'There are no required actions for today.',
    scope: 'Rest',
    timing: 'Future',
    expectedDurationMinutes: null
  }
}
