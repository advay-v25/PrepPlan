import { perRequest } from '../ops/perRequest'
import { createAdminClient } from '../supabase/admin'
import { summarizeScopeGroups } from './taskScope'
import { readAll } from '../supabase/readAll'
import { terminalIds } from './taskLineage'
import type { OwnedBlock } from '../ops/sharedReads'

async function loadScopeGroups(userId: string, ids: string[], known?: OwnedBlock[]) {
  const unique = [...new Set(ids)]
  if (!unique.length) return summarizeScopeGroups([], [])
  const admin = createAdminClient()
  const groups: { id: string; expected_parts: number; original_scope: any }[] = []
  const parts: { id: string; scope_group_id: string; execution: string; cancelled_at: string | null; cycle_id: string | null; continued_from_task_id: string | null }[] = []
  // Bound URL size as the student's sitting history grows, and read every page.
  for (let i = 0; i < unique.length; i += 100) {
    const ids = unique.slice(i, i + 100)
    const wanted = new Set(ids)
    const [g, p] = await Promise.all([
      readAll<typeof groups[number]>((a, z) => admin.from('task_scope_groups').select('id, expected_parts, original_scope').eq('user_id', userId).in('id', ids).order('id').range(a, z)),
      // A caller that already holds the student's whole block history passes it: the rows are the same ones this select would return.
      known ? Promise.resolve(known.filter(b => b.scope_group_id && wanted.has(b.scope_group_id)) as unknown as typeof parts)
        : readAll<typeof parts[number]>((a, z) => admin.from('plan_blocks').select('id, scope_group_id, execution, cancelled_at, cycle_id, continued_from_task_id').eq('user_id', userId).in('scope_group_id', ids).order('id').range(a, z)),
    ])
    groups.push(...g); parts.push(...p)
  }
  if (groups.length !== unique.length) throw new Error('Shared study scope could not be checked. Try again shortly.')
  // Work from a logged class that never received a sitting keeps its group unfinished (the obligation is durable, not an estimate of future parts).
  const owed = new Map<string, number>()
  const measuredClassGroups = new Set<string>()
  const items = groups.flatMap(g => g.original_scope?.session_id && g.original_scope?.outcome_id ? [{ g: g.id, s: String(g.original_scope.session_id), o: String(g.original_scope.outcome_id) }] : [])
  if (items.length) {
    const sessions = [...new Set(items.map(i => i.s))]
    const plannedRows: { session_id: string; outcome_id: string; planned_minutes: number | null }[] = []
    const allocatedRows: { class_session_id: string; outcome_id: string; duration_minutes: number; cancelled_at: string | null; execution: string }[] = []
    for (let offset = 0; offset < sessions.length; offset += 100) {
      const batch = sessions.slice(offset, offset + 100)
      const [pl, al] = await Promise.all([
        readAll((a, z) => admin.from('class_session_items').select('session_id, outcome_id, planned_minutes').in('session_id', batch).order('session_id').order('outcome_id').range(a, z)),
        known ? Promise.resolve(known.filter(b => b.class_session_id && batch.includes(b.class_session_id)) as unknown as typeof allocatedRows)
          : readAll((a, z) => admin.from('plan_blocks').select('class_session_id, outcome_id, duration_minutes, cancelled_at, execution').eq('user_id', userId).in('class_session_id', batch).order('id').range(a, z)),
      ])
      plannedRows.push(...pl); allocatedRows.push(...al)
    }
    for (const i of items) {
      const planned = plannedRows.find(x => x.session_id === i.s && x.outcome_id === i.o)?.planned_minutes
      if (planned == null) continue
      measuredClassGroups.add(i.g)
      const have = allocatedRows.filter(x => x.class_session_id === i.s && x.outcome_id === i.o && !x.cancelled_at && x.execution !== 'cancelled').reduce((n, x) => n + Number(x.duration_minutes ?? 0), 0)
      owed.set(i.g, Math.max(0, planned - have))
    }
  }
  // A cancelled class sitting returns minutes to its measured obligation. Once reallocated, it is not an extra unfinished sibling.
  // Legacy/unmeasured and ordinary split groups keep the existing conservative cancelled-part rule.
  const currentParts = parts.filter(p => !measuredClassGroups.has(p.scope_group_id) || (!p.cancelled_at && p.execution !== 'cancelled'))
  return summarizeScopeGroups(groups.map(g => ({ id: g.id,
    expected: measuredClassGroups.has(g.id) ? Math.max(1, terminalIds(currentParts.filter(p => p.scope_group_id === g.id).map(p => ({ id: p.id, continuedFromId: p.continued_from_task_id }))).size) : g.expected_parts,
    owedMinutes: owed.get(g.id) ?? 0 })), currentParts.map(p => ({
    id: p.id, groupId: p.scope_group_id, execution: p.execution, cancelled: Boolean(p.cancelled_at), cycleId: p.cycle_id, continuedFromId: p.continued_from_task_id ?? null,
  })))
}

/** One read per distinct (student, set of groups) within a request: Home and Calendar both ask for the same groups. */
export const getScopeGroups = perRequest(loadScopeGroups, (userId: string, ids: string[], _known?: OwnedBlock[]) => `${userId}|${[...new Set(ids)].sort().join(',')}`)
