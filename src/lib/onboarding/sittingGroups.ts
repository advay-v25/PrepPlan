type T = { id: string; title: string; duration_minutes: number; task_type: string; local_date: string }
export type SittingGroup<X extends T = T> = { key: string; date: string; title: string; minutes: number; paper: boolean; items: X[] }

const SITTING = / · sitting \d+ of \d+$/

/** Groups the sittings the planner split from one portion (same day, same reading title) so Review stays brief; every task stays listed inside. */
export function groupSittings<X extends T>(tasks: X[]): SittingGroup<X>[] {
  const out = new Map<string, SittingGroup<X>>()
  for (const t of tasks) {
    const title = t.title.replace(SITTING, '')
    const key = `${t.local_date}|${title}`
    const g = out.get(key) ?? { key, date: t.local_date, title, minutes: 0, paper: t.task_type === 'diagnostic', items: [] }
    g.items.push(t); g.minutes += t.duration_minutes
    out.set(key, g)
  }
  return [...out.values()]
}
