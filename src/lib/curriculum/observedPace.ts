import { chainOf, terminalIds } from '../planning/taskLineage'

/**
 * Minutes a student actually spends per unit of module effort. Pure.
 *
 * An observation is a module that is recorded as covered, whose every logical sitting is finished
 * (a continuation chain counts as one sitting, judged by its newest occurrence) and whose time the
 * student reported. Planned durations are never used (a planned hour is not a studied hour), a
 * module's effort is counted once however many sittings or weeks it took, and unreported time is
 * unknown, not zero: an occurrence with activity but no reported time disqualifies the module rather
 * than being guessed. An occurrence that never started adds nothing and does not disqualify.
 * Too few observations means "not enough to say"; the planner then uses a labelled planning
 * assumption (SEEDED_MINUTES_PER_EFFORT_UNIT in roadmap.ts), never a figure presented as observed.
 */
export type PaceBlock = { id: string; lmId: string | null; execution: string; cancelled: boolean; continuedFromId?: string | null }
export type PaceEvent = { taskId: string; actualMinutes: number | null }

export const MIN_PACE_MODULES = 4
const NEVER_STARTED = ['not_started', 'deferred', 'skipped']

export function observedPaceFrom(
  blocks: PaceBlock[], events: PaceEvent[], effortByModule: Map<string, number>, coveredModules: Set<string>,
): { minutesPerEffortUnit: number | null; modules: number } {
  const reported = new Map<string, number>()
  for (const e of events) {
    if (e.actualMinutes == null) continue
    reported.set(e.taskId, (reported.get(e.taskId) ?? 0) + e.actualMinutes)
  }

  const byModule = new Map<string, PaceBlock[]>()
  for (const b of blocks) {
    if (!b.lmId) continue
    byModule.set(b.lmId, [...(byModule.get(b.lmId) ?? []), b])
  }

  let minutes = 0, effort = 0, modules = 0
  for (const [lmId, rows] of byModule) {
    const band = effortByModule.get(lmId)
    if (!band || !coveredModules.has(lmId)) continue
    const byId = new Map(rows.map(r => [r.id, r]))
    const terminals = [...terminalIds(rows)].map(id => byId.get(id)!)
    let total = 0, usable = true, live = 0
    for (const t of terminals) {
      const chain = chainOf(t.id, rows).map(id => byId.get(id)!)
      if (t.cancelled) {
        // Removed from the plan. Harmless if it never started; if study time was spent, the module's
        // time is incomplete and counting it would flatter the student's pace.
        if (chain.some(o => !NEVER_STARTED.includes(o.execution))) usable = false
        continue
      }
      live++
      if (t.execution !== 'completed') usable = false
      for (const o of chain) {
        if (reported.has(o.id)) total += reported.get(o.id)!
        else if (!NEVER_STARTED.includes(o.execution)) usable = false   // activity with unknown time: do not invent it
      }
    }
    if (live === 0) continue
    if (!usable || total <= 0) continue
    minutes += total; effort += band; modules++
  }
  return { minutesPerEffortUnit: modules >= MIN_PACE_MODULES && effort > 0 ? Math.round(minutes / effort) : null, modules }
}

export const observedMinutesPerEffortUnitFrom = (...a: Parameters<typeof observedPaceFrom>) => observedPaceFrom(...a).minutesPerEffortUnit
