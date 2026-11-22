import { createAdminClient } from '../../supabase/admin'
import { dailyCapacityMinutes } from './capacity'
import { getStudyWeekContext } from '../schedule'
import { utcToZonedParts, weekdayOf } from '../studyWeek'

/**
 * Absorbing a missed study sitting into the rest of the week, honestly.
 *
 *  - Only into later, untouched sessions of the SAME reading, so the missed learning scope is carried by the same scope.
 *  - Only into time that exists: each day's real free minutes (availability minus commitments, from now) less what is already scheduled
 *    that day, and never past the student's sitting limit or the 180-minute task ceiling.
 *  - At most once per missed task (a receipt per source task makes a repeat a no-op), and in one database transaction (all or nothing).
 *  - The receipt records what was actually committed; Undo or choosing another time takes back exactly that.
 * What cannot be absorbed stays deferred and is reported as such. Nothing is added to a different reading to "make room".
 */
export const MAX_TASK_MINUTES = 180

/** `maxAdd`: for a timed session, the minutes its END can move later before leaving its study window or reaching another occupant (unlimited for day-preferred work). */
export type Candidate = { id: string; revision: number; date: string; duration: number; title: string; maxAdd?: number }
export type Change = { task_id: string; expected_revision: number; add_minutes: number }

/** Pure: spread `missed` minutes over candidate sessions, earliest first, within each day's room and each session's sitting room. */
export function planRedistribution(input: { missedMinutes: number; candidates: Candidate[]; dayRoom: Record<string, number>; sittingLimit: number }): { changes: Change[]; placed: number; unplaced: number } {
  const room = { ...input.dayRoom }
  const cap = Math.min(MAX_TASK_MINUTES, input.sittingLimit > 0 ? input.sittingLimit : MAX_TASK_MINUTES)
  let left = Math.max(0, Math.round(input.missedMinutes))
  const changes: Change[] = []
  for (const c of [...input.candidates].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    if (left <= 0) break
    const add = Math.min(left, Math.max(0, cap - c.duration), Math.max(0, room[c.date] ?? 0), Math.max(0, c.maxAdd ?? Infinity))
    if (add <= 0) continue
    changes.push({ task_id: c.id, expected_revision: c.revision, add_minutes: add })
    room[c.date] = (room[c.date] ?? 0) - add
    left -= add
  }
  const placed = changes.reduce((n, c) => n + c.add_minutes, 0)
  return { changes, placed, unplaced: Math.max(0, Math.round(input.missedMinutes) - placed) }
}

export type RedistributionReceipt = {
  applied: boolean
  replayed: boolean
  requested: number
  placed: number
  unplaced: number
  changes: { task_id: string; title: string; date: string; before: number; after: number }[]
  reason: string | null
  message: string
}

/** Absorbs ONE missed task that lies in the past. Safe to call repeatedly and concurrently: the receipt and the row locks decide. */
export async function redistributeMissedTask(userId: string, taskId: string, now = new Date()): Promise<RedistributionReceipt> {
  const admin = createAdminClient()
  const none = (reason: string, requested = 0, message = ''): RedistributionReceipt => ({ applied: false, replayed: false, requested, placed: 0, unplaced: requested, changes: [], reason, message: message || reason })
  const { data: src } = await admin.from('plan_blocks').select('id, cycle_id, task_type, lm_id, execution, local_date, duration_minutes, cancelled_at').eq('id', taskId).eq('user_id', userId).maybeSingle()
  if (!src || !['deferred', 'skipped'].includes(src.execution as string) || src.cancelled_at) return none('That task is not missed work.')
  if (src.task_type !== 'study' || !src.cycle_id) return none('Only study sittings are absorbed into the week.')
  const ctx = await getStudyWeekContext(userId, now)
  const requested = (src.duration_minutes ?? 0) as number
  // Today's own deferrals are not "missed" yet: the student can choose another time, so nothing is moved automatically.
  if (!src.local_date || (src.local_date as string) >= ctx.today) return none('Set aside for now. Choose another time for it, or it waits for your weekly review.', requested)
  // Already absorbed (and not taken back): a repeat reports the original receipt and changes nothing.
  const { data: prior } = await admin.from('redistribution_receipts').select('placed_minutes, changes').eq('source_task_id', taskId).eq('user_id', userId).is('reversed_at', null).maybeSingle()
  if (prior) {
    const ch = (prior.changes ?? []) as RedistributionReceipt['changes']; const placed = prior.placed_minutes as number
    return { applied: placed > 0, replayed: true, requested, placed, unplaced: Math.max(0, requested - placed), changes: ch, reason: null, message: `Already added: ${placed} min went to ${ch.length} later session${ch.length === 1 ? '' : 's'} of the same reading.` }
  }
  if (!src.lm_id) return none('This sitting is not tied to a reading, so nothing else can carry its scope.', requested)

  // The hash of every planning input is taken BEFORE planning; the database refuses the commit if any of them moved since (see apply_redistribution).
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: hash } = await admin.rpc('current_week_source_hash', { p_user: userId, p_cycle: src.cycle_id as string })
    const [{ data: rows }, { data: profile }, { data: windows }, { data: mocks }] = await Promise.all([
      admin.from('plan_blocks').select('id, title, task_type, lm_id, execution, local_date, duration_minutes, revision, cancelled_at, placement, starts_at')
        .eq('user_id', userId).eq('cycle_id', src.cycle_id as string).is('learning_activity_id', null),
      admin.from('profiles').select('max_session_minutes').eq('id', userId).maybeSingle(),
      admin.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', userId).eq('status', 'active'),
      admin.from('mock_appointments').select('planned_date, start_time, duration_minutes').eq('user_id', userId).eq('status', 'planned'),
    ])
    const live = (rows ?? []).filter(r => !r.cancelled_at && r.execution !== 'cancelled' && r.local_date && (r.local_date as string) >= ctx.today)
    const same = live.filter(r => r.task_type === 'study' && r.lm_id === src.lm_id && r.execution === 'not_started' && r.id !== taskId)
    if (same.length === 0) return none('Nothing later this week is for the same reading, so nothing moved.', requested)

    const dates = [...new Set(same.map(r => r.local_date as string))]
    const { occupantsFor } = await import('../taskService')   // loaded lazily: taskService imports this module
    const occupants = await occupantsFor(userId, dates, ctx.timezone)
    const mm = (t: unknown) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); return h * 60 + m }
    const winOf = (weekday: number) => (windows ?? []).filter(w => (w.weekday as number) === weekday).map(w => ({ s: mm(w.start_time), e: mm(w.end_time) }))
    const nowMs = now.getTime()
    const candidates: Candidate[] = same.map(r => {
      const base = { id: r.id as string, revision: r.revision as number, date: r.local_date as string, duration: (r.duration_minutes ?? 0) as number, title: r.title as string }
      if (r.placement !== 'timed' || !r.starts_at) return base
      // A timed session grows at its END, so the whole extended interval must stay inside a study window, clear of every occupant
      // (commitments with their moved/skipped occurrences, classes, other timed tasks, mocks), and not already under way.
      const start = utcToZonedParts(new Date(r.starts_at as string), ctx.timezone).minutesOfDay
      const curEnd = start + base.duration
      if (Date.parse(r.starts_at as string) <= nowMs) return { ...base, maxAdd: 0 }
      const win = winOf(weekdayOf(base.date)).find(w => w.s <= start && curEnd <= w.e)
      if (!win) return { ...base, maxAdd: 0 }
      let limit = Math.min(win.e, 24 * 60)
      for (const o of occupants) if (o.id !== r.id && o.date === base.date && o.start >= curEnd) limit = Math.min(limit, o.start)
      for (const m of mocks ?? []) if (m.planned_date === base.date && m.start_time && mm(m.start_time) >= curEnd) limit = Math.min(limit, mm(m.start_time))
      return { ...base, maxAdd: Math.max(0, limit - curEnd) }
    })
    const dayRoom: Record<string, number> = {}
    await Promise.all(dates.map(async d => {
      const free = await dailyCapacityMinutes(userId, weekdayOf(d), d, ctx.timezone, now)
      const scheduled = live.filter(r => r.local_date === d && !['completed', 'skipped', 'deferred'].includes(r.execution as string)).reduce((n, r) => n + ((r.duration_minutes ?? 0) as number), 0)
      dayRoom[d] = Math.max(0, free - scheduled)
    }))
    const plan = planRedistribution({ missedMinutes: requested, candidates, dayRoom, sittingLimit: (profile?.max_session_minutes ?? 0) as number })
    if (plan.placed === 0) return none('There is no free study time later this week for it, so nothing moved.', requested)

    const { data, error } = await admin.rpc('apply_redistribution', { p_user: userId, p_source: taskId, p_changes: plan.changes, p_input_hash: hash })
    // A competing edit moved an input since this was planned: plan again from what is there now, once; then give up honestly.
    if (error && /STALE/.test(error.message) && attempt === 0) continue
    if (error?.code === 'BK409') return none('The longer session would run into your booked mock, so nothing moved.', requested)
    if (error) return none(/STALE/.test(error.message) ? 'The week changed while this was being planned, so nothing moved.' : /OVERLAP/.test(error.message) ? 'The longer session would overlap other work, so nothing moved.' : 'Calendar could not make the change, so nothing moved.', requested)
    return finish(data as any)
  }
  return none('The week changed while this was being planned, so nothing moved.', requested)

  function finish(r: any): RedistributionReceipt {
    if (!r?.ok) return none('Calendar could not make the change, so nothing moved.', requested)
    const changes = (r.changes ?? []) as RedistributionReceipt['changes']
    const placed = r.placed as number
    return {
      applied: placed > 0, replayed: Boolean(r.replayed), requested, placed, unplaced: Math.max(0, requested - placed), changes, reason: null,
      message: placed > 0
        ? `${placed} of ${requested} min was added to ${changes.length} later session${changes.length === 1 ? '' : 's'} of the same reading${placed < requested ? `; the other ${requested - placed} min is still deferred` : ''}.`
        : 'Nothing moved.',
    }
  }
}

/** Takes back what a missed task's receipt added (undo, or the student chose another time). Reports what was and was not reversed. */
export async function reverseRedistribution(userId: string, taskId: string): Promise<{ reversedMinutes: number; keptMinutes: number; message: string | null }> {
  const { data, error } = await createAdminClient().rpc('reverse_redistribution', { p_user: userId, p_source: taskId })
  if (error || !data?.ok) return { reversedMinutes: 0, keptMinutes: 0, message: 'Calendar could not take back the earlier adjustment; check the later sessions.' }
  const sum = (a: any[]) => (a ?? []).reduce((n, c) => n + (c.after - c.before), 0)
  const reversedMinutes = sum(data.reversed), keptMinutes = sum(data.kept)
  return { reversedMinutes, keptMinutes, message: reversedMinutes || keptMinutes ? `${reversedMinutes} min added to later sessions was taken back${keptMinutes ? `; ${keptMinutes} min stays because those sessions changed since` : ''}.` : null }
}
