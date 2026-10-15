import { OperatingState } from './types'

/**
 * @deprecated This is a temporary adapter to keep the legacy Coach component working
 * while Home V2 is built on the canonical OperatingState.
 * Remove this file once Coach is migrated to consume `CoachContext` directly.
 */
export function toLegacyCoachContext(state: OperatingState): any {
  // Map the new canonical state back to the old, un-versioned shape Coach expects.
  // This ensures there is only one query path (getCurrentOperatingState) even during the transition.
  return {
    identity: {
      examMonth: state.identity.examDate ? state.identity.examDate.slice(0, 7) : null,
      learningMode: null, // No longer tracked in the same way
      priorityTopic: null
    },
    roadmap: {
      activeMilestone: state.roadmap?.currentMilestoneId ? {
        id: state.roadmap.currentMilestoneId,
        title: 'Milestone ' + state.roadmap.currentMilestoneId,
        date: state.roadmap.projectedRange?.end || 'Unknown',
        type: 'topic_finish'
      } : null,
      progress: null
    },
    cycle: {
      isActive: state.cycle !== null,
      weekStart: state.cycle?.startDateLocal || null,
      weekEnd: state.cycle?.endDateLocal || null
    },
    today: {
      tasks: state.today.blocks.map(b => ({
        id: b.id,
        title: b.title,
        detail: b.detail,
        type: b.taskType,
        execution: b.execution,
        durationMinutes: b.durationMinutes,
        startsAt: b.startsAt,
        revision: b.revision
      }))
    },
    readiness: {
      percent: 0, // Outlawed by product rules, spoofed for legacy
      diagnosticAverage: null,
      diagnosticCount: 0
    },
    diagnostics: {
      latest: null
    },
    attention: {
      pendingRepairs: state.repairs.openThreads.length,
      items: state.attention.map(a => ({
        id: a.id,
        title: a.title,
        actionLabel: a.actionLabel,
        actionUrl: a.destination
      }))
    }
  }
}
