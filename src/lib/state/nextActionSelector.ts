import { OperatingState, ActionableDecision, PlanBlock, PaperForm, CoachProposal } from './types'
import { calendarTaskHref } from '../routing/calendar'
import { buildWork } from './homeModel'
import { coachProposalHref } from '../coach/selection'

/** A revision task says why it is next, in the planner's own words (first sentence); other tasks keep their generic line. */
function whyNow(task: PlanBlock, fallback: string): string {
  if (task.taskType !== 'review' || !task.rationale) return fallback
  const first = task.rationale.split(/(?<=\.)\s/)[0]
  return `Revision. ${first}`
}

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

  // Today's work comes from the shared Home work model: today's, overdue and undated tasks, already in a deterministic order
  // (see homeModel.ts). A state built without it (older callers, tests) gets the same model from its own today list.
  const work = state.work ?? buildWork(today.blocks.map(b => ({ ...b, localDate: b.localDate ?? today.dateLocal })), [], today.dateLocal, Date.now())
  const assessment = state.assessment
  // A paper or re-check that is waiting or unavailable is not something to do now; it is explained where it appears, never "done" by hand.
  const dated = work.open.filter(t => t.workStatus !== 'unplaced' && (!t.assessmentControl || ['start', 'resume', 'result'].includes(t.assessmentControl.kind)))
  const hasOpenToday = dated.length > 0

  const taskDecision = (t: (typeof work.open)[number]): ActionableDecision => {
    const c = t.assessmentControl
    if (c) {
      const check = t.taskType === 'recheck'
      return {
        id: t.id, revision: t.revision, availability: 'available', destination: c.href,
        permittedCommands: c.kind === 'resume' ? ['resume_paper'] : c.kind === 'result' ? ['review_paper'] : ['start_paper'],
        code: c.kind === 'result' ? 'review_scored_paper' : check ? 'repair_check' : 'take_paper',
        title: c.kind === 'result' ? t.title : check ? `${c.kind === 'resume' ? 'Resume' : 'Start'} your re-check` : `${c.kind === 'resume' ? 'Resume' : 'Your'} ${t.taskType === 'diagnostic' ? 'weekly paper' : 'paper'}${c.kind === 'resume' ? '' : c.kind === 'start' ? ' is ready' : ''}`,
        rationale: c.note ?? (check ? 'Your repair work is done and the spacing has passed.' : 'It tests only the work you have confirmed.'),
        scope: t.taskType, timing: ({ in_progress: 'Now', current: 'Now', overdue: 'Overdue', upcoming: 'Scheduled', today: 'Today', unplaced: 'Soon' } as const)[t.workStatus], expectedDurationMinutes: t.durationMinutes,
      }
    }
    const code = t.workStatus === 'in_progress' ? 'resume_task' : t.placement === 'timed' && t.startsAt ? 'start_timed_task' : t.placement === 'floating' ? 'place_task' : 'start_preferred_task'
    const r = t.reportedMinutes, p = t.durationMinutes
    // Planned, reported and remaining stay distinct: unknown time says so, and a used-up allocation says it is still open.
    const partial = t.execution !== 'partial' ? ''
      : r == null ? 'Partly done; time not reported. '
      : r >= p && p > 0 ? `Partly done: ${r} min reported against ${p} min planned. The planned time is used, and it is still open. `
      : `Partly done (${r} of ${p} min reported). `
    const why = t.workStatus === 'in_progress' ? 'You already started this task.'
      : t.workStatus === 'overdue' ? `${partial}Planned for ${t.localDate === today.dateLocal ? 'earlier today' : t.localDate} and still open.`
      : t.workStatus === 'current' ? `${partial}Its time slot is under way.`
      : t.workStatus === 'upcoming' ? `${partial}Scheduled for later today.`
      : `${partial}This is your next priority task for today.`
    return {
      id: t.id, revision: t.revision, availability: 'available',
      destination: calendarTaskHref(t.id, t.localDate ?? today.dateLocal),
      permittedCommands: code === 'resume_task' ? ['complete_task', 'defer_task'] : ['start_task', 'defer_task'],
      code, title: t.title, rationale: whyNow(t, why), scope: t.taskType,
      timing: ({ in_progress: 'Now', current: 'Now', overdue: 'Overdue', upcoming: 'Scheduled', today: 'Today', unplaced: 'Soon' } as const)[t.workStatus],
      expectedDurationMinutes: t.durationMinutes,
    }
  }

  // 3. Resume an in-progress executable task
  const started = work.open.find(t => t.workStatus === 'in_progress')
  if (started) return taskDecision(started)

  // 4. Complete missing logs required to unlock weekly closure
  // Missing logs come first only when nothing is left to DO today or later: work still ahead (today's sessions, a re-check) is not "missing", it is next.
  if (cycle?.closureState === 'closure_ready' && execution.unreportedMinutes > 0 && dated.every(t => t.workStatus === 'overdue')) {
    return {
      id: 'complete-logs', revision: cycle.revision, availability: 'available', destination: '/app/review-week', permittedCommands: ['submit_logs'],
      code: 'complete_logs', title: 'Complete missing logs', rationale: 'You need to log your remaining activities to close the week.',
      scope: 'Weekly Closure', timing: 'Now', expectedDurationMinutes: 5,
    }
  }

  // 4b. A paper already in progress comes before starting anything new.
  if (papers.activeReservation) {
    const r = papers.activeReservation
    return {
      id: r.id, revision: r.revision, availability: 'available', destination: r.destination, permittedCommands: ['resume_paper'],
      code: 'take_paper', title: `Resume your ${r.purpose} paper`, rationale: `Your paper is open. ${assessment?.clock ?? ''}`.trim(),
      scope: r.purpose, timing: 'Now', expectedDurationMinutes: 0,
    }
  }

  // 5. A paper that can actually be started, and is due (its due day has come). Before that day it is a decision, not the next step.
  const duePaper = papers.availablePapers.find(p => p.sufficientBank)
  if (duePaper && assessment?.state !== 'upcoming') {
    return {
      id: duePaper.id, revision: duePaper.revision, availability: 'available', destination: '/app/tests', permittedCommands: ['start_paper'],
      code: 'take_paper', title: `Your ${duePaper.purpose} paper is ready`,
      rationale: (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && state.identity.classPattern && state.identity.classPattern !== 'none'
        ? 'Take your scheduled paper to close the cycle and unlock next week.'
        : 'Take your weekly Sunday paper to close the seven-day cycle and unlock next week.',
      scope: duePaper.purpose, timing: 'Now', expectedDurationMinutes: duePaper.estimatedDurationMinutes,
    }
  }

  // 6. Dated work, in the shared order: under way, overdue (oldest first), upcoming, flexible today.
  if (hasOpenToday) return taskDecision(dated[0])

  // 7. Nothing dated is left: finished sittings that Tests cannot use until the student says what they covered.
  if (assessment?.state === 'confirm_scope') {
    return {
      id: 'confirm-coverage', revision: 0, availability: 'available', destination: assessment.destination, permittedCommands: ['confirm_scope'],
      code: 'confirm_coverage', title: 'Confirm what you covered',
      rationale: assessment.message ?? 'Finished work needs the outcomes it covered before it can be tested.',
      scope: 'Coverage', timing: 'Now', expectedDurationMinutes: 2,
    }
  }

  // 8. A scored paper's result, and what it opened.
  const scoredPaperReview = attention.find(a => a.code === 'scored_paper')
  if (scoredPaperReview) {
    return {
      id: scoredPaperReview.id, revision: 0, availability: 'available', destination: scoredPaperReview.destination, permittedCommands: ['review_paper'],
      code: 'review_scored_paper', title: scoredPaperReview.title, rationale: scoredPaperReview.description, scope: 'Review', timing: 'Now', expectedDurationMinutes: null,
    }
  }

  // 9. Review a repair/recheck proposal that affects the active week
  if (repairs.proposals.length > 0) {
    const proposal = repairs.proposals[0]
    return {
      id: proposal.id, revision: proposal.revision, availability: 'available', destination: coachProposalHref(proposal.id), permittedCommands: ['accept_proposal', 'reject_proposal'],
      code: 'review_repair', title: `Review proposal: ${proposal.title}`, rationale: proposal.summary, scope: 'Repair', timing: 'Now', expectedDurationMinutes: null,
    }
  }

  // 10. Review/accept a pending weekly draft
  const pendingDraft = attention.find(a => a.code === 'pending_draft')
  if (pendingDraft) {
    return {
      id: pendingDraft.id, revision: 0, availability: 'available', destination: pendingDraft.destination, permittedCommands: ['accept_draft', 'review_draft'],
      code: 'review_draft', title: pendingDraft.title, rationale: pendingDraft.description, scope: 'Planning', timing: 'Now', expectedDurationMinutes: null,
    }
  }

  // 11. Work with no day yet is unresolved planning, not a free day.
  if (work.unplaced > 0) {
    const first = work.open.find(t => t.workStatus === 'unplaced')!
    return {
      id: 'place-work', revision: first.revision, availability: 'available', destination: `${calendarTaskHref(first.id, today.dateLocal)}#unplaced`, permittedCommands: ['place_task'],
      code: 'place_task', title: `Place ${work.unplaced} unplaced task${work.unplaced === 1 ? '' : 's'}`,
      rationale: 'These belong to this week but have no day. Roadmap does not invent a time for them.', scope: 'Planning', timing: 'Soon',
      expectedDurationMinutes: work.open.filter(t => t.workStatus === 'unplaced').reduce((n, t) => n + t.durationMinutes, 0) || null,
    }
  }

  // 12. Complete weekly closure, with the canonical gate's own reason (scored paper, external mock, rehearsal, or no paper permitted).
  if (cycle?.closureState === 'closure_ready') {
    const c = state.closure
    return {
      id: 'weekly-closure', revision: cycle.revision, availability: 'available', destination: '/app/review-week', permittedCommands: ['start_closure'],
      code: 'complete_closure', title: c?.canClose ? 'Close the week' : 'Close the week',
      rationale: c ? `${c.label}. ${c.reason}` : 'Review what happened this week and plan the next.',
      scope: 'closure', timing: 'Now', expectedDurationMinutes: 10,
    }
  }

  const weekPlan = state.weekPlan
  if (weekPlan?.action && weekPlan.kind !== 'intentionally_empty') {
    return {
      id: 'week-plan', revision: weekPlan.draft?.revision ?? 0, availability: 'available',
      destination: weekPlan.action.href, permittedCommands: [], code: 'review_current_week',
      title: weekPlan.title, rationale: weekPlan.message, scope: 'Planning', timing: 'Now',
      expectedDurationMinutes: null, actionLabel: weekPlan.action.label,
    }
  }

  // 13. A week accepted without study times is not "all caught up".
  const needsTimes = attention.find(a => a.code === 'week_availability_needed')
  if (needsTimes) {
    return {
      id: 'add-availability', revision: 0, availability: 'available', destination: needsTimes.destination, permittedCommands: [],
      code: 'add_availability', title: needsTimes.title, rationale: needsTimes.description, scope: 'Setup', timing: 'Now', expectedDurationMinutes: null,
    }
  }

  // 13b. Class follow-up with no task yet is an actionable obligation: never "all caught up" while it exists.
  const owedFollowUp = attention.find(a => a.code === 'class_followup_owed')
  if (owedFollowUp) {
    return {
      id: 'class-followup-owed', revision: 0, availability: 'available', destination: owedFollowUp.destination, permittedCommands: [],
      code: 'class_followup_owed', title: owedFollowUp.title, rationale: owedFollowUp.description, scope: 'Planning', timing: 'Now', expectedDurationMinutes: null, actionLabel: owedFollowUp.actionLabel,
    }
  }

  // 14. Honest empty states, kept distinct: a day that was worked, and a day with nothing planned.
  const done = work.completedToday.length > 0
  return {
    id: 'empty', revision: 0, availability: 'unavailable', destination: '/app/calendar', permittedCommands: [],
    code: 'honest_empty', title: done ? 'Today’s work is done' : 'Nothing is planned today',
    rationale: done
      ? `${work.completedToday.length} session${work.completedToday.length === 1 ? '' : 's'} completed${work.reportedMinutesToday ? ` · ${work.reportedMinutesToday} min reported` : ''}. Nothing else is required today.`
      : 'This is a free day in your plan. Add work in Calendar if you want to use it.',
    scope: 'Rest', timing: 'Future', expectedDurationMinutes: null,
  }
}
