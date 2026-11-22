import { onboardingHref } from '../routing/registry'
import { AttentionItem, OperatingState } from './types'
import { calendarReviewHref, calendarTaskHref } from '../routing/calendar'
import { coachProposalHref } from '../coach/selection'

export function computeAttentionQueue(state: OperatingState): AttentionItem[] {
  const items: AttentionItem[] = []

  // Collect potential attention items based on state

  if (state.integrity.activationFailed) {
    items.push({
      id: 'attention-activation-failed',
      code: 'activation_failed',
      priority: 100,
      title: 'PrepPlan Activation Failed',
      description: 'Your roadmap could not be activated successfully.',
      destination: '/app/calendar',
      actionLabel: 'Retry Activation'
    })
  }

  if (state.integrity.isStale || state.integrity.crossPageInvariantFailed) {
    items.push({
      id: 'attention-state-conflict',
      code: 'state_conflict',
      priority: 90,
      title: 'Data Synchronization Issue',
      description: 'We detected a conflict between your devices.',
      destination: '/app/settings',
      actionLabel: 'Refresh State'
    })
  }

  if (state.cycle?.closureState === 'closure_ready' && state.execution.unreportedMinutes > 0) {
    items.push({
      id: 'attention-missing-logs',
      code: 'missing_logs',
      priority: 80,
      title: 'Missing Activity Logs',
      description: 'You have unreported activities holding up your weekly closure.',
      destination: '/app/log',
      actionLabel: 'Log Activities'
    })
  }

  if (state.classRecovery) {
    items.push({
      id: 'attention-class-recovery',
      code: 'class_recovery',
      priority: 75,
      title: `${state.classRecovery.overlaps} study task${state.classRecovery.overlaps === 1 ? '' : 's'} overlap${state.classRecovery.overlaps === 1 ? 's' : ''} a class or booking`,
      description: 'Your class change is saved. Review the proposed new times for your study week; nothing moves until you accept.',
      destination: calendarReviewHref(state.classRecovery.changeKey),
      actionLabel: 'Review changes to my week'
    })
  }

  if (state.classFollowUp) {
    items.push({
      id: 'attention-class-followup', code: 'class_followup_owed', priority: 65,
      title: `${state.classFollowUp.minutes} min of class follow-up has no slot yet`,
      description: `${state.classFollowUp.items.length} class item${state.classFollowUp.items.length === 1 ? '' : 's'} could not be fully scheduled when logged. It is proposed again at your weekly review, or when you log your next class.`,
      destination: '/app/calendar', actionLabel: 'See what is waiting',
    })
  }

  if (state.repairs.proposals.length > 0) {
    items.push({
      id: `attention-proposal-${state.repairs.proposals[0].id}`,
      code: 'coach_proposal',
      priority: 70,
      title: 'New Coach Proposal',
      description: state.repairs.proposals[0].title,
      destination: coachProposalHref(state.repairs.proposals[0].id),
      actionLabel: 'Review Proposal'
    })
  }

  // Onboarding's Week step allows "my schedule changes" or "I cannot schedule this week" as honest
  // answers rather than forcing a fabricated plan. Both leave real work to do: this is that work, not a
  // silent fallback. Priority sits above the routine paper nudge but below data problems.
  if (!state.weekPlan && state.identity.weekAvailabilityMode && state.identity.weekAvailabilityMode !== 'windows') {
    items.push({
      id: 'attention-week-availability',
      code: 'week_availability_needed',
      priority: 65,
      title: state.identity.weekAvailabilityMode === 'varies'
        ? 'Add this week’s study times'
        : 'Add your study times to start this week',
      description: state.identity.weekAvailabilityMode === 'varies'
        ? 'Your schedule changes week to week, so PrepPlan asks each week rather than guessing.'
        : 'No study time was set at setup. Add windows now so this week can be planned.',
      // Straight to the Week step, and back to Calendar afterwards (an allowed return path).
      destination: onboardingHref('week', '/app/calendar'),
      actionLabel: 'Add availability',
    })
  }

  // A variable class pattern deliberately never invents a class-led cycle: the boundary only moves once a
  // real class is known. Left unresolved, the student silently stays on the Monday-Sunday fallback with no
  // idea that adding a class would change it.
  if (state.identity.classPattern === 'variable' && !state.identity.hasKnownNextClass && state.weekPlan?.kind !== 'awaiting_class_input') {
    items.push({
      id: 'attention-next-class-needed',
      code: 'next_class_needed',
      priority: 55,
      title: 'Add your next class',
      description: 'Your classes change week to week, so PrepPlan is using a Monday-Sunday week until it knows your next one.',
      // Deep link: Calendar opens the dedicated next-class dialog directly, one-shot (the query param is
      // dropped once it has opened), rather than leaving the student to find the button themselves.
      destination: '/app/calendar?action=add-next-class',
      actionLabel: 'Add next class',
    })
  }

  // Assessment decisions, each with its own identity and exact destination.
  const a = state.assessment
  const duePaper = state.papers.availablePapers.find(p => p.sufficientBank)
  if (a?.state === 'confirm_scope') {
    items.push({ id: 'attention-confirm-coverage', code: 'confirm_coverage', priority: 75, title: 'Confirm what you covered', description: a.message ?? '', destination: a.destination, actionLabel: 'Confirm coverage' })
  }
  // A scored result is a decision only while its follow-up is open (not yet opened, or a repair from it still needs deciding).
  if (a?.state === 'scored' && a.attemptId && a.followUp?.pending !== false) {
    items.push({ id: `attention-scored-${a.attemptId}`, code: 'scored_paper', priority: 72, title: 'Your paper has been scored', description: a.followUp?.reason ?? 'See what it showed and what it opened.', destination: a.destination, actionLabel: 'See result' })
  }
  if (duePaper) {
    const upcoming = a?.state === 'upcoming'
    items.push({
      id: `attention-paper-${duePaper.id}`, code: 'due_paper', priority: upcoming ? 40 : 60,
      title: upcoming ? `Weekly paper: available now, due ${a?.dueDate ?? 'this cycle'}` : `${duePaper.purpose === 'diagnostic' ? 'Diagnostic' : 'Revisionary'} paper due`,
      description: upcoming ? 'You can take it early. It tests only work you have confirmed.' : (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && state.identity.classPattern && state.identity.classPattern !== 'none'
        ? 'Take your scheduled paper to close the cycle and unlock the next week.'
        : 'Take your weekly Sunday paper to close the seven-day cycle and unlock the next week.',
      destination: '/app/tests', actionLabel: 'Start paper',
    })
  }
  // An unavailable paper is information, not a decision: Home states it under "Next checkpoint" and Tests explains it.

  // Work that needs the student to decide, not just do.
  const work = state.work
  if (work && work.unplaced > 0) {
    items.push({ id: 'attention-unplaced', code: 'unplaced', priority: 68, title: `${work.unplaced} task${work.unplaced === 1 ? '' : 's'} not placed yet`, description: 'Choose a day. PrepPlan does not invent a time.', destination: '/app/calendar?view=agenda#unplaced', actionLabel: 'Place them' })
  }
  if (work && work.overdue > 0) {
    const first = work.open.find(t => t.workStatus === 'overdue')
    items.push({ id: 'attention-overdue', code: 'overdue', priority: 66, title: `${work.overdue} session${work.overdue === 1 ? ' is' : 's are'} overdue`, description: 'Do it, defer it or mark it skipped.', destination: first ? calendarTaskHref(first.id, first.localDate ?? state.today.dateLocal) : '/app/calendar?view=agenda', actionLabel: 'Open the oldest' })
  }
  if (state.cycle?.closureState === 'closure_ready') {
    items.push({ id: 'attention-closure-ready', code: 'closure_ready', priority: 50, title: 'This week is ready to close', description: state.closure ? `${state.closure.label}. ${state.closure.reason}` : 'Your assessment for the week is done.', destination: '/app/review-week', actionLabel: 'Review this week' })
  }

  if (state.weekPlan?.action) {
    items.push({ id: 'attention-current-week-plan', code: 'current_week_plan', priority: 67,
      title: state.weekPlan.title, description: state.weekPlan.message,
      destination: state.weekPlan.action.href, actionLabel: state.weekPlan.action.label })
  }

  // Highest priority first; ties by id so the order never changes between reads. Callers choose how many to show.
  return items.sort((x, y) => y.priority - x.priority || x.id.localeCompare(y.id))
}

/** Which attention item an action already says, so Home never lists a decision twice (deduplicated by identity, not by URL). */
export const ATTENTION_FOR_ACTION: Record<string, string> = {
  review_current_week: 'current_week_plan',
  confirm_coverage: 'confirm_coverage', review_scored_paper: 'scored_paper', place_task: 'unplaced', take_paper: 'due_paper',
  review_repair: 'coach_proposal', add_availability: 'week_availability_needed', complete_closure: 'closure_ready', complete_logs: 'missing_logs',
}
