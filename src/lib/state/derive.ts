import { OperatingState, ActionableDecision } from './types'

export function deriveActivation(
  onboardingStatus: string | null,
  activeRoadmapId: string | null,
  activeCycleId: string | null,
  draftStatus: 'ready' | 'failed' | 'accepted' | null,
  activationFailedFlag: boolean
): OperatingState['activation'] {
  if (!onboardingStatus || onboardingStatus === 'not_started' || onboardingStatus === 'in_progress') {
    return 'not_onboarded'
  }

  if (activationFailedFlag || draftStatus === 'failed') {
    return 'activation_failed'
  }

  if (activeRoadmapId && activeCycleId) {
    return 'ready'
  }

  if (draftStatus === 'ready') {
    return 'acceptance_required'
  }

  return 'preview_required'
}
