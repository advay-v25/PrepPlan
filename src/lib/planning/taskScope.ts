import { terminalIds } from './taskLineage'

/** Sittings are separate calendar actions but share one immutable learning scope. */
export type ScopePart = { id?: string; groupId: string; execution: string; cancelled: boolean; cycleId: string | null; continuedFromId?: string | null }
export type ScopeGroupSummary = { expected: number; completed: number; complete: boolean; cycles: (string | null)[]
  /** Minutes of the same work that never received a sitting. While any remain, finishing every existing sitting does NOT complete the scope. */
  owedMinutes: number }

/**
 * A continuation replaces the occurrence it continues, so each logical sitting counts once however many
 * weeks it took. Only a genuine split raises `expected`. Missing or cancelled work never counts as done.
 */
export function summarizeScopeGroups(groups: { id: string; expected: number; owedMinutes?: number }[], parts: ScopePart[]) {
  const members = new Map<string, ScopePart[]>()
  for (const p of parts) members.set(p.groupId, [...(members.get(p.groupId) ?? []), p])
  return new Map<string, ScopeGroupSummary>(groups.map(g => {
    const rows = members.get(g.id) ?? []
    const withIds = rows.filter((p): p is ScopePart & { id: string } => Boolean(p.id))
    const terminal = withIds.length === rows.length ? terminalIds(withIds) : null
    const logical = terminal ? rows.filter(p => terminal.has(p.id!)) : rows
    const completed = logical.filter(p => p.execution === 'completed' && !p.cancelled).length
    return [g.id, { expected: g.expected, completed, complete: logical.length === g.expected && completed === g.expected && !(g.owedMinutes && g.owedMinutes > 0), cycles: rows.map(p => p.cycleId), owedMinutes: g.owedMinutes ?? 0 }]
  }))
}
