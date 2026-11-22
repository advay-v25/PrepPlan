/**
 * Continuation lineage. When unfinished work moves to the next week, the original task stays in the
 * week it happened and a new task continues it. A chain is oldest → newest; only the newest
 * occurrence is actionable. Pure, so every reader (scope groups, pace, the task drawer) shares one rule.
 */
export type LineageNode = { id: string; continuedFromId?: string | null }

/** Occurrences that nothing continues: the actionable end of each chain. */
export function terminalIds(nodes: LineageNode[]): Set<string> {
  const continued = new Set(nodes.map(n => n.continuedFromId).filter((id): id is string => Boolean(id)))
  return new Set(nodes.map(n => n.id).filter(id => !continued.has(id)))
}

/** The chain ending at `terminalId`, oldest first. Safe against a missing link or a loop. */
export function chainOf(terminalId: string, nodes: LineageNode[]): string[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const chain: string[] = []
  const seen = new Set<string>()
  for (let id: string | null | undefined = terminalId; id && byId.has(id) && !seen.has(id); id = byId.get(id)!.continuedFromId) {
    seen.add(id)
    chain.unshift(id)
  }
  return chain
}

/**
 * Time the student reported across a chain, kept per occurrence so each week shows its own figure and
 * the logical work shows the total. `unknown` means an occurrence with activity has no reported time;
 * the total is then a floor, never a claim.
 */
export function reportedMinutesByChain(
  terminalId: string, nodes: LineageNode[], events: { taskId: string; actualMinutes: number | null }[],
) {
  const reported = new Map<string, number>()
  for (const e of events) if (e.actualMinutes != null) reported.set(e.taskId, (reported.get(e.taskId) ?? 0) + e.actualMinutes)
  const byOccurrence = chainOf(terminalId, nodes).filter(id => reported.has(id)).map(id => ({ id, minutes: reported.get(id)! }))
  const unknown = chainOf(terminalId, nodes).some(id => !reported.has(id))
  return { byOccurrence, total: byOccurrence.reduce((s, o) => s + o.minutes, 0), unknown }
}
