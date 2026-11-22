import type { GeneratedPortion } from './generateWeek'

/** Divide planned work into sittings without deleting effort or claiming learning. */
export function splitIntoSittings(portion: GeneratedPortion, limit = 180): GeneratedPortion[] {
  // Papers are intentional timed assessments, not ordinary study sittings.
  if (portion.taskType === 'diagnostic') return [portion]
  if (!Number.isInteger(limit) || limit < 20 || limit > 180) throw new Error('A valid study sitting limit is required.')
  if (portion.durationMinutes <= limit) return [portion]
  const count = Math.ceil(portion.durationMinutes / limit)
  const key = globalThis.crypto.randomUUID()   // shared by the sittings of ONE portion: explicit sibling identity, never inferred from a title
  const base = Math.floor(portion.durationMinutes / count)
  const extra = portion.durationMinutes % count
  let allocatedEffort = 0
  return Array.from({ length: count }, (_, i) => {
    const minutes = base + (i < extra ? 1 : 0)
    const effort = i === count - 1 ? portion.effortUnits - allocatedEffort : portion.effortUnits * minutes / portion.durationMinutes
    allocatedEffort += effort
    return {
      ...portion,
      title: `${portion.title} · sitting ${i + 1} of ${count}`,
      split: { key, index: i + 1, count },
      durationMinutes: minutes,
      effortUnits: effort,
      learningObjective: `${portion.learningObjective ?? portion.title} Planned sitting ${i + 1} of ${count} for this portion.`,
      completionMeaning: `${portion.completionMeaning ?? 'Record what you actually covered.'} This records this sitting only; confirm covered outcomes separately.`,
    }
  })
}
