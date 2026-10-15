import { createAdminClient } from '../supabase/admin'
import { getCurrentOperatingState } from '../state/operatingState'
import { projectCoachContext } from '../state/coachContext'
import { getCoachEvidencePack } from '../signals/coachPack'
import { getLosTracker } from '../curriculum/losTrackerService'
import { getStudyWeekContext } from '../planning/schedule'
import { RevisionMismatchError, setExecution } from '../planning/taskService'
import { FULL_DAY_MINUTES, RECHECK_MINUTES, type CoachIntent, type CoachSituation, type Proposal } from './actions'

export type CoachWorld = {
  situation: CoachSituation
  context: ReturnType<typeof projectCoachContext>
  pack: Awaited<ReturnType<typeof getCoachEvidencePack>> | null
  band: string
  todayTitles: string[]
}

/** Everything the Coach is allowed to see, gathered once per message. Read-only. */
export async function loadCoachWorld(userId: string, intent: CoachIntent, now = new Date()): Promise<CoachWorld> {
  const admin = createAdminClient()
  const [state, ctx] = await Promise.all([getCurrentOperatingState(userId), getStudyWeekContext(userId)])
  let pack: CoachWorld['pack'] = null
  try { pack = await getCoachEvidencePack(userId, now) } catch { pack = null }

  let repairs: CoachSituation['repairs'] = []
  try {
    const tracker = await getLosTracker(userId, now)
    const byReading = new Map<string, { subjectId: string; label: string }>()
    for (const t of tracker.topics) for (const m of t.modules) byReading.set(m.id, { subjectId: t.id, label: `Reading ${m.readingNo}: ${m.name}` })
    repairs = tracker.studyOrder.filter(r => r.band === 'repair').slice(0, 3).flatMap(r => {
      const where = byReading.get(r.readingId)
      return where ? [{ outcomeId: r.outcomeId, name: r.name, readingId: r.readingId, subjectId: where.subjectId, readingLabel: where.label }] : []
    })
  } catch { repairs = [] }

  const cycle = state.cycle ? { start: state.cycle.startDateLocal, end: state.cycle.endDateLocal } : null
  const load: Record<string, number> = {}
  if (cycle) {
    const { data } = await admin.from('plan_blocks').select('local_date, duration_minutes, execution')
      .eq('user_id', userId).gte('local_date', cycle.start).lte('local_date', cycle.end)
    for (const b of data ?? []) if (b.execution !== 'skipped' && b.local_date) load[b.local_date as string] = (load[b.local_date as string] ?? 0) + Number(b.duration_minutes ?? 0)
  }

  const open = state.today.blocks.filter(b => b.execution !== 'completed' && b.execution !== 'skipped' && b.execution !== 'deferred')
  const paperState = pack?.paper.state ?? (state.papers.activeReservation ? 'resume' : state.papers.availablePapers[0] ? 'start' : 'none')
  return {
    situation: {
      intent, today: ctx.today, cycle, load, repairs,
      todayOpen: open.map(b => ({ id: b.id, title: b.title, revision: b.revision, durationMinutes: b.durationMinutes })),
      paper: paperState, closing: state.cycle?.closureState === 'closure_ready',
    },
    context: projectCoachContext(state),
    pack,
    band: pack?.understanding.band ?? state.evidence.preparednessBand ?? 'Insufficient evidence',
    todayTitles: open.map(b => b.title),
  }
}

export type StoredMessage = {
  id: string; role: 'student' | 'coach'; body: string; intent: string | null; links: { label: string; href: string }[]
  createdAt: string
  proposals: { id: string; kind: string; title: string; reasoning: string; status: string }[]
}

export async function saveMessage(userId: string, role: 'student' | 'coach', body: string, intent: CoachIntent | null, links: { label: string; href: string }[] = []) {
  const admin = createAdminClient()
  const { data, error } = await admin.from('coach_messages')
    .insert({ user_id: userId, role, body: body.slice(0, 4000), intent, links }).select('id, created_at').single()
  if (error) throw new Error(error.message)
  return data as { id: string; created_at: string }
}

export async function saveProposals(userId: string, messageId: string, proposals: Proposal[], cycleId: string | null) {
  if (!proposals.length) return []
  const admin = createAdminClient()
  const rows = proposals.map(p => ({
    user_id: userId, message_id: messageId, intent: p.kind, kind: p.kind, title: p.title, reasoning: p.reasoning,
    proposed_changes: p.changes, origin: 'coach', status: 'pending', target_cycle_id: cycleId,
  }))
  const { data, error } = await admin.from('coach_proposals').insert(rows).select('id, kind, title, reasoning, status')
  if (error) throw new Error(error.message)
  await admin.from('coach_messages').update({ proposal_ids: (data ?? []).map(d => d.id) }).eq('id', messageId).eq('user_id', userId)
  return (data ?? []) as StoredMessage['proposals']
}

export async function loadHistory(userId: string, limit = 40): Promise<StoredMessage[]> {
  const admin = createAdminClient()
  const { data: msgs } = await admin.from('coach_messages').select('id, role, body, intent, links, created_at, proposal_ids')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  const rows = (msgs ?? []).reverse()
  const ids = rows.flatMap(m => (m.proposal_ids ?? []) as string[])
  const { data: props } = ids.length
    ? await admin.from('coach_proposals').select('id, kind, title, reasoning, status').eq('user_id', userId).in('id', ids)
    : { data: [] as any[] }
  const byId = new Map((props ?? []).map(p => [p.id as string, p]))
  return rows.map(m => ({
    id: m.id as string, role: m.role as 'student' | 'coach', body: m.body as string, intent: (m.intent as string) ?? null,
    links: (m.links ?? []) as StoredMessage['links'], createdAt: m.created_at as string,
    proposals: ((m.proposal_ids ?? []) as string[]).map(i => byId.get(i)).filter(Boolean) as StoredMessage['proposals'],
  }))
}

export async function clearHistory(userId: string) {
  const admin = createAdminClient()
  // Pending proposals go with the conversation; executed ones stay as the record of what changed.
  await admin.from('coach_proposals').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'pending')
  await admin.from('coach_messages').delete().eq('user_id', userId)
}

export type DecisionResult =
  | { ok: true; status: 'executed' | 'rejected'; already?: boolean; applied?: number; taskId?: string }
  | { ok: false; code: 'NOT_FOUND' | 'STALE' | 'INVALID'; error: string }

const isoDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d)

/** The only place a Coach proposal turns into a change, and only when the student says so. */
export async function decideProposal(userId: string, proposalId: string, decision: 'accept' | 'reject'): Promise<DecisionResult> {
  const admin = createAdminClient()
  const { data: p } = await admin.from('coach_proposals').select('*').eq('id', proposalId).eq('user_id', userId).maybeSingle()
  if (!p) return { ok: false, code: 'NOT_FOUND', error: 'That suggestion no longer exists.' }
  if (p.status === 'executed') return { ok: true, status: 'executed', already: true }
  if (p.status === 'rejected') return decision === 'reject' ? { ok: true, status: 'rejected', already: true } : { ok: false, code: 'STALE', error: 'You dismissed this suggestion. Ask again for a fresh one.' }
  if (p.status === 'stale') return { ok: false, code: 'STALE', error: 'The plan changed since this was suggested. Ask again for a fresh one.' }

  const now = new Date().toISOString()
  if (decision === 'reject') {
    await admin.from('coach_proposals').update({ status: 'rejected', decided_at: now }).eq('id', proposalId).eq('user_id', userId).eq('status', 'pending')
    return { ok: true, status: 'rejected' }
  }

  // Claim first, so a double click or a second device cannot apply it twice.
  const { data: claimed } = await admin.from('coach_proposals').update({ status: 'executed', executed_at: now, decided_at: now })
    .eq('id', proposalId).eq('user_id', userId).eq('status', 'pending').select('id').maybeSingle()
  if (!claimed) return { ok: true, status: 'executed', already: true }

  const release = async (status: 'stale' | 'pending', why: string): Promise<DecisionResult> => {
    await admin.from('coach_proposals').update({ status, executed_at: null, decided_at: status === 'stale' ? now : null }).eq('id', proposalId).eq('user_id', userId)
    return { ok: false, code: status === 'stale' ? 'STALE' : 'INVALID', error: why }
  }

  const c = p.proposed_changes as any
  if (p.kind === 'defer_today') {
    const tasks: { id: string; revision: number }[] = c?.tasks ?? []
    let applied = 0
    for (const [i, t] of tasks.entries()) {
      // The first task proves the suggestion is still current. Later ones may have been re-placed by the
      // week's redistribution after the first deferral, so they are re-read rather than trusted.
      let revision = t.revision
      if (i > 0) {
        const { data: cur } = await admin.from('plan_blocks').select('revision, execution').eq('id', t.id).eq('user_id', userId).maybeSingle()
        if (!cur || ['completed', 'skipped', 'deferred'].includes(cur.execution as string)) continue
        revision = cur.revision as number
      }
      try {
        await setExecution(userId, t.id, { execution: 'deferred', expectedRevision: revision, note: 'Moved on your confirmation from the Coach' })
        applied++
      } catch (e) {
        if (e instanceof RevisionMismatchError && i === 0) return release('stale', 'That task changed since I suggested this. Ask again for a fresh suggestion.')
        if (e instanceof RevisionMismatchError) continue
        return release('pending', e instanceof Error ? e.message : 'Could not apply that.')
      }
    }
    await admin.from('coach_proposals').update({ proposed_changes: { ...c, applied } }).eq('id', proposalId).eq('user_id', userId)
    return { ok: true, status: 'executed', applied }
  }

  if (p.kind === 'recheck_block') {
    const ctx = await getStudyWeekContext(userId)
    const { data: cycle } = await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', userId).eq('status', 'active').maybeSingle()
    if (!cycle || !isoDay(c?.date) || c.date <= ctx.today || c.date > (cycle.ends_at_local as string)) {
      return release('stale', 'That day is no longer inside your current week. Ask again for a fresh suggestion.')
    }
    const { data: day } = await admin.from('plan_blocks').select('duration_minutes, execution').eq('user_id', userId).eq('local_date', c.date)
    const load = (day ?? []).filter(b => b.execution !== 'skipped').reduce((s, b) => s + Number(b.duration_minutes ?? 0), 0)
    if (load >= FULL_DAY_MINUTES) return release('stale', 'That day has filled up since. Ask again for a fresh suggestion.')

    const minutes = Number(c.durationMinutes) || RECHECK_MINUTES
    const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const { data: task, error } = await admin.from('plan_blocks').insert({
      id, user_id: userId, cycle_id: cycle.id, title: `Re-check: ${c.outcomeName}`,
      detail: 'Work this outcome from your own materials, then let the weekly paper re-test it.',
      task_type: 'repair', origin: 'coach', priority: 'core', placement: 'day_preferred', execution: 'not_started',
      local_date: c.date, day: c.date, starts_at: null, duration_minutes: minutes, duration: String(minutes),
      rationale: p.reasoning, is_protected_commitment: false, created_by: 'coach', outcome_id: c.outcomeId,
    }).select('id').single()
    if (error) return release('pending', error.message)
    await admin.from('task_events').insert({ user_id: userId, task_id: id, event_type: 'created', payload: { title: `Re-check: ${c.outcomeName}`, date: c.date, source: 'coach', proposalId }, previous: {} })
    return { ok: true, status: 'executed', applied: 1, taskId: task.id as string }
  }

  return release('pending', 'This kind of suggestion is not supported.')
}
