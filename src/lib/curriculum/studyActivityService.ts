import { scopeConfirmations } from '../ops/sharedReads'
import { createAdminClient } from '../supabase/admin'
import { readAll } from '../supabase/readAll'
import { getScopeGroups } from '../planning/taskScopeService'
import type { StudyActivityBlock } from './studyActivity'
import { zonedTimeToUtc } from '../planning/studyWeek'
import { perRequest } from '../ops/perRequest'
import { ownedBlocks, type OwnedBlock } from '../ops/sharedReads'

/** Shared owned activity inputs for Curriculum and Tests, including prior weeks. */
async function loadStudyActivity(userId: string) {
  const db = createAdminClient()
  const [blocks, confirmed, events] = await Promise.all([
    ownedBlocks(userId) as Promise<(StudyActivityBlock & { activity: any })[]>,
    scopeConfirmations(userId),
    readAll<{ task_id: string; created_at: string; event_type: string; payload: any }>((a, z) => db.from('task_events').select('task_id,created_at,id,event_type,payload').eq('user_id', userId).in('event_type', ['completed', 'partial', 'skipped', 'deferred']).order('created_at').order('id').range(a, z)),
  ])
  const confirmations = new Map<string, string[]>()
  for (const c of confirmed) confirmations.set(c.block_id, [...(confirmations.get(c.block_id) ?? []), c.outcome_id])
  // A date-only external log is not proof of work after a test on the SAME day.
  // Use its day's lower bound; created_at remains the truthful audit/save time.
  const observedAt = (e: typeof events[number]) => e.payload?.kind === 'learning_log'
    ? zonedTimeToUtc(e.payload.local_date,'00:00',e.payload.timezone ?? 'UTC').toISOString() : e.created_at
  const completedAt = new Map(events.filter(e => ['completed', 'partial'].includes(e.event_type)).map(e => [e.task_id, observedAt(e)]))
  // A logged sitting carries the study date the student gave; every other completion is dated by when it was recorded.
  const completedKind = new Map(events.filter(e => ['completed', 'partial'].includes(e.event_type)).map(e => [e.task_id, e.payload?.kind === 'learning_log' ? 'study_date' as const : 'recorded' as const]))
  const executionAt = new Map(events.map(e => [`${e.task_id}:${e.event_type}`, observedAt(e)]))
  const groups = await getScopeGroups(userId, blocks.flatMap(b => b.scope_group_id ? [b.scope_group_id] : []), blocks as unknown as OwnedBlock[])
  const pendingGroups = new Set([...groups].filter(([, g]) => !g.complete).map(([id]) => id))
  return { blocks:blocks.map(b => ({...b,activityKind:b.activity?.activity_type ?? null})), confirmations, completedAt, completedKind, executionAt, groups, pendingGroups }
}

export const getStudyActivity = perRequest(loadStudyActivity, (userId: string) => userId)
