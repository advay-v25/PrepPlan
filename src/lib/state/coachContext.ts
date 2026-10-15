import { OperatingState } from './types'

export interface CoachContext {
  identity: {
    examDate: string | null
  }
  roadmap: {
    phase: string
    trajectory: 'holding' | 'ahead' | 'pressure' | 'unknown'
  } | null
  cycle: {
    startDateLocal: string
    endDateLocal: string
    closureState: 'active' | 'closure_ready' | 'closure_failed'
  } | null
  execution: {
    completedMinutes: number
    partialMinutes: number
    deferredMinutes: number
    skippedMinutes: number
    unreportedMinutes: number
    deviations: string[]
  }
  evidence: {
    preparednessBand: 'Insufficient evidence' | 'Building' | 'Developing' | 'Stable' | 'Exam-phase ready' | null
    recentChanges: {
      conceptName: string
      state: 'supported' | 'unstable' | 'needs_repair' | 'stale'
    }[]
  }
  repairs: {
    openThreads: { conceptName: string }[]
  }
  integrity: {
    isStale: boolean
    activationFailed: boolean
    insufficientPaperBank: boolean
  }
}

/**
 * Projects the full OperatingState into a safe, restricted context for the AI Coach.
 * This prevents the coach from reading arbitrary data or the client from spoofing
 * state by sending its own context payload.
 */
export function projectCoachContext(state: OperatingState): CoachContext {
  return {
    identity: {
      examDate: state.identity.examDate
    },
    roadmap: state.roadmap ? {
      phase: state.roadmap.phase,
      trajectory: state.roadmap.trajectory
    } : null,
    cycle: state.cycle ? {
      startDateLocal: state.cycle.startDateLocal,
      endDateLocal: state.cycle.endDateLocal,
      closureState: state.cycle.closureState
    } : null,
    execution: {
      completedMinutes: state.execution.completedMinutes,
      partialMinutes: state.execution.partialMinutes,
      deferredMinutes: state.execution.deferredMinutes,
      skippedMinutes: state.execution.skippedMinutes,
      unreportedMinutes: state.execution.unreportedMinutes,
      deviations: [...state.execution.deviations]
    },
    evidence: {
      preparednessBand: state.evidence.preparednessBand,
      recentChanges: state.evidence.recentChanges.map(c => ({
        conceptName: c.name,
        state: c.state
      }))
    },
    repairs: {
      openThreads: state.repairs.openThreads.map(t => ({
        conceptName: t.conceptName
      }))
    },
    integrity: {
      isStale: state.integrity.isStale,
      activationFailed: state.integrity.activationFailed,
      insufficientPaperBank: state.integrity.insufficientPaperBank
    }
  }
}
