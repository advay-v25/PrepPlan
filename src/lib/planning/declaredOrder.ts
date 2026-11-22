/** A sitting never leads its own open predecessor: pull each open predecessor in front of the task that declares it (stable otherwise). Shared by Home and Calendar. */
export function inDeclaredOrder<T>(list: T[], id: (t: T) => string, follows: (t: T) => string[]): T[] {
  const byId = new Map(list.map(t => [id(t), t])), out: T[] = [], seen = new Set<string>()
  const put = (t: T) => {
    if (seen.has(id(t))) return
    seen.add(id(t)) // marked first, so a (never expected) dependency cycle ends instead of looping
    for (const d of follows(t)) { const p = byId.get(d); if (p) put(p) }
    out.push(t)
  }
  list.forEach(put)
  return out
}
