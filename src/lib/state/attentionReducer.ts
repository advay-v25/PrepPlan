import { AttentionItem, OperatingState } from './types'

export function computeAttentionQueue(state: OperatingState): AttentionItem[] {
  const items: AttentionItem[] = []

  // Collect potential attention items based on state

  if (state.integrity.activationFailed) {
    items.push({
      id: 'attention-activation-failed',
      code: 'activation_failed',
      priority: 100,
      title: 'Roadmap Activation Failed',
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

  if (state.repairs.proposals.length > 0) {
    items.push({
      id: `attention-proposal-${state.repairs.proposals[0].id}`,
      code: 'coach_proposal',
      priority: 70,
      title: 'New Coach Proposal',
      description: state.repairs.proposals[0].title,
      destination: '/app/coach',
      actionLabel: 'Review Proposal'
    })
  }

  // Onboarding's Week step allows "my schedule changes" or "I cannot schedule this week" as honest
  // answers rather than forcing a fabricated plan. Both leave real work to do: this is that work, not a
  // silent fallback. Priority sits above the routine paper nudge but below data problems.
  if (state.identity.weekAvailabilityMode && state.identity.weekAvailabilityMode !== 'windows') {
    items.push({
      id: 'attention-week-availability',
      code: 'week_availability_needed',
      priority: 65,
      title: state.identity.weekAvailabilityMode === 'varies'
        ? 'Add this week’s study times'
        : 'Add your study times to start this week',
      description: state.identity.weekAvailabilityMode === 'varies'
        ? 'Your schedule changes week to week, so Roadmap asks each week rather than guessing.'
        : 'No study time was set at setup. Add windows now so this week can be planned.',
      destination: '/app/calendar',
      actionLabel: 'Add availability',
    })
  }

  // A variable class pattern deliberately never invents a class-led cycle: the boundary only moves once a
  // real class is known. Left unresolved, the student silently stays on the Monday-Sunday fallback with no
  // idea that adding a class would change it.
  if (state.identity.classPattern === 'variable' && !state.identity.hasKnownNextClass) {
    items.push({
      id: 'attention-next-class-needed',
      code: 'next_class_needed',
      priority: 55,
      title: 'Add your next class',
      description: 'Your classes change week to week, so Roadmap is using a Monday-Sunday week until it knows your next one.',
      // Deep link: Calendar opens the dedicated next-class dialog directly, one-shot (the query param is
      // dropped once it has opened), rather than leaving the student to find the button themselves.
      destination: '/app/calendar?action=add-next-class',
      actionLabel: 'Add next class',
    })
  }

  const duePaper = state.papers.availablePapers.find(p => p.sufficientBank)
  if (duePaper) {
    items.push({
      id: `attention-paper-${duePaper.id}`,
      code: 'due_paper',
      priority: 60,
      title: `${duePaper.purpose === 'diagnostic' ? 'Diagnostic' : 'Revisionary'} Paper Due`,
      description: (state.roadmap?.route === 'coaching' || state.roadmap?.route === 'hybrid') && state.identity.classPattern && state.identity.classPattern !== 'none'
        ? 'Take your scheduled paper to close the cycle and unlock the next week.'
        : 'Take your weekly Sunday paper to close the seven-day cycle and unlock the next week.',
      destination: '/app/tests',
      actionLabel: 'Start Paper'
    })
  }

  // Sort by priority descending
  items.sort((a, b) => b.priority - a.priority)

  // Return at most three user-actionable items
  return items.slice(0, 3)
}
