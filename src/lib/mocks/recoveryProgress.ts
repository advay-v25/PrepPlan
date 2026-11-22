import { terminalIds } from '../planning/taskLineage'
import type { TaskTime } from '../state/reportedTime'
import type { SelectionItem } from './report'

export type ItemStatus = 'none' | 'planned' | 'continues' | 'completed' | 'unfinished' | 'needs_review'
export type ItemState = { itemKey: string; status: ItemStatus; allocated: number; reported: number; remaining: number; where: string | null; title: string | null; taskId?: string }
export type Occurrence = { id: string; cycle_id: string | null; source_key: string; execution: string; cancelled_at: string | null; duration_minutes: number; continued_from_task_id: string | null; local_date: string | null; title: string; outcome_id: string | null; lm_id: string | null }
export const recoveryItemKey = (key: string) => key.replace(/:\d+$/, '')
const ordinal = (row: Occurrence) => Number(row.source_key.match(/:(\d+)$/)?.[1] ?? 0)
const cancelled = (row: Occurrence) => Boolean(row.cancelled_at) || row.execution === 'cancelled'

/** Every split must finish. Reported time informs an estimate; it never certifies completion. */
export function recoveryItemState(item: SelectionItem, rows: Occurrence[], times: Map<string, TaskTime>, cycleId: string | null): ItemState {
  const mine = rows.filter(r => recoveryItemKey(r.source_key) === item.key)
  const leafIds = terminalIds(mine.map(r => ({ id: r.id, continuedFromId: r.continued_from_task_id })))
  const live = mine.filter(r => !cancelled(r))
  const minutes = (r: Occurrence) => times.get(r.id)?.minutes ?? 0
  // A later re-proposal replaces cancelled work; the old occurrence and its actual time remain history.
  const leaves = mine.filter(r => leafIds.has(r.id) && (!cancelled(r) || !live.some(s => ordinal(s) > ordinal(r))))
  const liveLeaves = leaves.filter(r => !cancelled(r))
  const reported = mine.reduce((n, r) => n + minutes(r), 0)
  const allocated = mine.reduce((n, r) => n + (leafIds.has(r.id) && !cancelled(r) ? r.duration_minutes : minutes(r)), 0)
  const target = liveLeaves.find(r => !['skipped', 'completed'].includes(r.execution) && r.cycle_id === cycleId)
  const at = target ?? leaves.find(r => r.execution !== 'completed') ?? liveLeaves[0]
  const base = { itemKey: item.key, allocated, reported, where: at?.local_date ?? null, title: at?.title ?? null, taskId: at?.id }
  if (target) return { ...base, status: target.continued_from_task_id ? 'continues' : 'planned', remaining: 0 }
  if (leaves.length && leaves.every(r => !cancelled(r) && r.execution === 'completed')) return { ...base, status: 'completed', remaining: 0 }
  if (!mine.length) return { ...base, status: 'none', remaining: item.minutes }
  const unfinished = leaves.filter(r => cancelled(r) || r.execution !== 'completed')
  const unknown = unfinished.some(r => times.get(r.id)?.unknown || (r.execution === 'partial' && !times.get(r.id)?.reports.length))
  const remaining = unfinished.reduce((n, r) => n + Math.max(0, r.duration_minutes - minutes(r)), 0)
  if (unknown || remaining < 5) return { ...base, status: 'needs_review', remaining: 0 }
  return { ...base, status: 'unfinished', remaining }
}
