import { PlanBlock, ExecutionSummary } from './types'
import { taskTimes } from './reportedTime'

export interface RawTaskEvent {
  payload?: any
  id: string
  task_id: string
  event_type: string
  duration_minutes?: number | null
  actual_duration_minutes?: number | null
  created_at: string
}

export function computeWeekExecution(blocks: (PlanBlock & { localDate?: string })[], events: RawTaskEvent[], todayLocal: string): ExecutionSummary {
  let completedMinutes = 0
  let partialMinutes = 0
  let deferredMinutes = 0
  let skippedMinutes = 0
  let unreportedMinutes = 0
  const deviations: string[] = []

  // Group events by task ID
  const eventsByTask = new Map<string, RawTaskEvent[]>()
  for (const event of events) {
    const list = eventsByTask.get(event.task_id) || []
    list.push(event)
    eventsByTask.set(event.task_id, list)
  }

  for (const block of blocks) {
    const taskEvents = eventsByTask.get(block.id) || []
    
    // Simplistic reduction for the baseline
    switch (block.execution) {
      case 'completed':
        completedMinutes += block.durationMinutes
        break
      case 'in_progress':
      case 'partial': {
        // Partly done is its own state: what was reported counts as partial, the rest is still open (never "unreported").
        // What was reported (undo reversed, unknown left out); with no minutes given the whole planned block is what we know of.
        const reported = taskTimes(taskEvents).get(block.id)?.minutes
        partialMinutes += reported == null ? block.durationMinutes : Math.min(block.durationMinutes, reported)
        break
      }
      case 'deferred':
        deferredMinutes += block.durationMinutes
        deviations.push(`Deferred: ${block.title}`)
        break
      case 'skipped':
        skippedMinutes += block.durationMinutes
        deviations.push(`Skipped: ${block.title}`)
        break
      case 'not_started':
      default:
        // Count not-started only when due/past rather than future.
        if (!block.localDate || block.localDate <= todayLocal) {
          unreportedMinutes += block.durationMinutes
        }
        break
    }
  }

  return {
    completedMinutes,
    partialMinutes,
    deferredMinutes,
    skippedMinutes,
    unreportedMinutes,
    deviations
  }
}
