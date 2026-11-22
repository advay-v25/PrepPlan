import type { CalendarEntry } from '../planning/calendarData'

type Learning = Pick<CalendarEntry, 'layer' | 'execution' | 'durationMinutes' | 'taskType' | 'reading' | 'continuation' | 'isTask'>
const LEARNING_TASKS = new Set(['study', 'review', 'class_consolidation', 'verification'])

/**
 * Names the difference between the roadmap's current milestone and the accepted week, from RECORDED provenance only (carried-over work, class follow-up,
 * revision). Returns null when the week is mostly on the milestone's topic or has no topic-mapped learning work. It explains; it never rewrites the plan.
 */
export function weekVsMilestone(milestone: { topicId: string; topicName: string } | null, entries: Learning[], topicName: (id: string) => string | null): string | null {
  if (!milestone) return null
  const live = entries.filter(e => e.isTask && LEARNING_TASKS.has(e.taskType ?? '') && !['cancelled', 'skipped'].includes(e.execution ?? '') && e.reading?.topicId)
  const total = live.reduce((n, e) => n + e.durationMinutes, 0)
  if (!total) return null
  const by = new Map<string, number>()
  for (const e of live) by.set(e.reading!.topicId!, (by.get(e.reading!.topicId!) ?? 0) + e.durationMinutes)
  if ((by.get(milestone.topicId) ?? 0) * 2 >= total) return null
  const lead = [...by.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => topicName(id) ?? 'another subject')
  const why = [
    live.some(e => e.continuation) ? 'work carried over from an earlier week' : '',
    live.some(e => e.taskType === 'class_consolidation') ? 'follow-up from a class you logged' : '',
    live.some(e => e.taskType === 'review') ? 'revision of earlier material' : '',
  ].filter(Boolean)
  return `This week’s accepted tasks are mainly on ${lead.join(' and ')}, while the roadmap’s current milestone is ${milestone.topicName}.${why.length ? ` The week includes ${why.join(', ')}.` : ''} Your accepted week stands; the roadmap shows the longer-term order and was not changed.`
}
