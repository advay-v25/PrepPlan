/** Recovery progress through real owned records and commands; no question bank, shared account or public fault switches. */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, preflightServer, makeCheck, FRESH_STUDENT_ONBOARDING } from './lib/e2eSession'
import { saveReport, getReport } from '../src/lib/mocks/reportService'
import { loadItemStates, previewRecovery, acceptRecovery, recoveryRemainder } from '../src/lib/mocks/recovery'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'

const db = createAdminClient(), owned: string[] = [], { check, finish } = makeCheck()
async function main() {
  await preflightServer()
  const student = await createStudent(db, 'mockprogress', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const uid = student.id
  const current = (await db.from('planning_cycles').select('id, timezone').eq('user_id', uid).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(current.timezone), closed = randomUUID()
  await db.from('plan_blocks').delete().eq('user_id', uid).throwOnError()
  await db.from('calendar_commitments').delete().eq('user_id', uid).throwOnError()
  await db.from('availability_windows').delete().eq('user_id', uid).throwOnError()
  await db.from('availability_windows').insert(Array.from({ length: 7 }, (_, weekday) => ({ user_id: uid, weekday, start_time: '09:00', end_time: '12:00', status: 'active' }))).throwOnError()
  await db.from('planning_cycles').update({ starts_at_local: today, ends_at_local: addDays(today, 7) }).eq('id', current.id).throwOnError()
  await db.from('planning_cycles').insert({ id: closed, user_id: uid, status: 'closed', starts_at: addDays(today, -7), ends_at: today, starts_at_local: addDays(today, -7), ends_at_local: today, timezone: current.timezone }).throwOnError()

  const report = async (minutes: number) => {
    const r = (await saveReport(uid, { action: 'create', key: randomUUID(), input: { takenOn: addDays(today, -2), scope: 'full', scale: 'percent', score: 48, difficulties: ['ran_out_of_time'] } })).report
    await db.from('mock_reports').update({ plan_selection: { items: [{ key: 'pacing', kind: 'pacing', minutes }] } }).eq('id', r.id).throwOnError()
    return (await getReport(uid, r.id))!
  }
  const seed = async (rid: string, minutes: number, execution: string, group: string | null = null) => {
    const id = `mockprogress-${randomUUID()}`
    await db.from('plan_blocks').insert({ id, user_id: uid, cycle_id: closed, local_date: addDays(today, -2), day: addDays(today, -2), title: 'Recovery pacing', detail: '', task_type: 'review', origin: 'planner', created_by: 'algorithm', priority: 'core', placement: 'day_preferred', execution, duration_minutes: minutes, duration: String(minutes), source_report_id: rid, source_key: 'pacing:1', source_report_version: 1, scope_group_id: group }).throwOnError()
    return id
  }
  const event = async (id: string, type: string, minutes: number | null, payload = {}) => {
    const e = randomUUID()
    await db.from('task_events').insert({ id: e, user_id: uid, task_id: id, event_type: type, actual_duration_minutes: minutes, payload, previous: {} }).throwOnError()
    return e
  }
  const r = await report(30), group = randomUUID()
  await db.from('task_scope_groups').insert({ id: group, user_id: uid, original_task_id: `fixture-${randomUUID()}`, expected_parts: 2, original_scope: {} }).throwOnError()
  const one = await seed(r.id, 15, 'completed', group), two = await seed(r.id, 15, 'partial', group)
  await event(one, 'completed', 15)
  const part = await event(two, 'partial', 5)
  let state = (await loadItemStates(uid, r, current.id)).states.get('pacing')!
  check('one finished split is not the whole activity: ten minutes still need a sitting', state.status === 'unfinished' && state.remaining === 10, JSON.stringify(state))
  const undo = await event(two, 'undone', null, { undid_event_id: part, undid: 'partial' })
  await db.from('plan_blocks').update({ execution: 'not_started' }).eq('id', two).throwOnError()
  state = (await loadItemStates(uid, r, current.id)).states.get('pacing')!
  check('Undo restores the outstanding estimate and removes the undone time', state.reported === 15 && state.remaining === 15, JSON.stringify(state))
  await event(two, 'undone', null, { undid_event_id: undo, undid: 'undone' })
  await db.from('plan_blocks').update({ execution: 'partial' }).eq('id', two).throwOnError()
  state = (await loadItemStates(uid, r, current.id)).states.get('pacing')!
  check('undoing Undo restores that report once', state.reported === 20 && state.remaining === 10, JSON.stringify(state))
  const p = await previewRecovery(uid, r, r.planSelection!)
  check('the preview offers only the unfinished split remainder', p.ok && p.placed.length === 1 && p.placed[0].minutes === 10, JSON.stringify(p))
  if (p.ok && p.placed.length) {
    await event(one, 'details_changed', null)
    const stale = await db.rpc('accept_mock_recovery', { p_user: uid, p_key: randomUUID(), p_report_id: r.id, p_report_version: r.version, p_cycle_id: current.id,
      p_selection: { ...r.planSelection, state_token: p.sourceToken }, p_tasks: [] })
    check('the command refuses a scheduling snapshot changed after preview', !stale.error && (stale.data as any)?.code === 'STALE')
    const fresh = await previewRecovery(uid, r, r.planSelection!)
    if (!fresh.ok) throw Error(fresh.message)
    const accepted = await acceptRecovery(uid, r, { key: randomUUID(), selection: r.planSelection!, fingerprint: fresh.fingerprint })
    check('the authoritative command allows that remainder despite a completed earlier split', accepted.placed === 1)
  } else check('the authoritative command allows that remainder despite a completed earlier split', false)

  const exhausted = await report(30), exhaustedTask = await seed(exhausted.id, 30, 'partial')
  await event(exhaustedTask, 'partial', 30)
  const es = (await loadItemStates(uid, exhausted, current.id)).states.get('pacing')!
  check('time at the estimate is not completion: the student must review the status', String(es.status) === 'needs_review', JSON.stringify(es))
  const ep = await previewRecovery(uid, exhausted, exhausted.planSelection!)
  check('the review-needed state creates no invented extra sitting and has an actionable task link', ep.ok && ep.placed.length === 0 && ep.alreadyPlanned[0]?.status === 'needs_review' && Boolean((ep.alreadyPlanned[0] as any).href))
  const left = await recoveryRemainder(uid, exhausted)
  check('review-needed work remains discoverable after reload', left.some(x => String(x.status) === 'needs_review'))
  const empty = await previewRecovery(uid, exhausted, { items: [] })
  check('the last follow-up choice can be removed only through a reviewed change', empty.ok && empty.wouldDrop.length === 1)
  if (empty.ok) {
    let refused = false
    try { await acceptRecovery(uid, exhausted, { key: randomUUID(), selection: { items: [] }, fingerprint: empty.fingerprint }) } catch (e) { refused = (e as any).code === 'removal_unconfirmed' }
    check('unconfirmed removal writes nothing', refused && (await getReport(uid, exhausted.id))!.planSelection!.items.length === 1)
    const removeRequest = { key: randomUUID(), selection: { items: [] }, fingerprint: empty.fingerprint, confirmRemove: ['pacing'] }
    await acceptRecovery(uid, exhausted, removeRequest)
    check('confirmed removal clears the follow-up, preserving partial task history', (await recoveryRemainder(uid, (await getReport(uid, exhausted.id))!)).length === 0
      && (await db.from('plan_blocks').select('execution').eq('id', exhaustedTask).single().throwOnError()).data!.execution === 'partial')
    check('a lost removal response replays its original receipt', (await acceptRecovery(uid, (await getReport(uid, exhausted.id))!, removeRequest)).replayed === true)
  }
  const small = await report(25), smallTask = await seed(small.id, 25, 'partial')
  await event(smallTask, 'partial', 20)
  const sp = await previewRecovery(uid, small, small.planSelection!)
  check('a five-minute remainder is kept, not silently completed or rounded to ten', sp.ok && sp.placed.length === 1 && sp.placed[0].minutes === 5)
  for (const table of ['evidence_events', 'repair_threads', 'assessment_attempts'] as const) {
    const { count } = await db.from(table).select('*', { count: 'exact', head: true }).eq('user_id', uid).throwOnError()
    check(`progress review changes no ${table}`, count === 0)
  }
}
main().catch(e => check('closeout execution', false, e.message)).finally(async () => {
  for (const id of owned) {
    const r = await db.auth.admin.deleteUser(id)
    check('owned student cleanup', !r.error, r.error?.message)
  }
  finish()
})
