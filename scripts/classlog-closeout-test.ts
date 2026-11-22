/** Owner closeout: real owned rows, no bank, no shared-account resets. All created rows cascade with the registered throwaway student. */
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, classLedPersona, preflightServer, makeCheck } from './lib/e2eSession'
import { loadClassObligations, roomOfDay } from '../src/lib/planning/classlog/service'
import { previewClassLogK as previewClassLog } from './lib/classKeys'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { readAll } from '../src/lib/supabase/readAll'
import { getScopeGroups } from '../src/lib/planning/taskScopeService'

const { connect } = createRequire(import.meta.url)('./db.cjs')
const db = createAdminClient(), { check, finish } = makeCheck()
const owned: string[] = []

async function main() {
  await preflightServer()
  const persona = await classLedPersona(db)
  const s = await createStudent(db, 'p1close', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone), tomorrow = addDays(today, 1)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -7), ends_at_local: addDays(today, 9) }).eq('id', cycle.id).throwOnError()
  await db.from('plan_blocks').delete().eq('user_id', s.id).throwOnError()
  await db.from('calendar_commitments').delete().eq('user_id', s.id).throwOnError()
  await db.from('availability_windows').delete().eq('user_id', s.id).throwOnError()
  await db.from('availability_windows').insert(Array.from({ length: 7 }, (_, weekday) => [
    { user_id: s.id, weekday, start_time: '09:00', end_time: '09:30', status: 'active' },
    { user_id: s.id, weekday, start_time: '10:00', end_time: '10:30', status: 'active' },
  ]).flat()).throwOnError()

  const accepted = { id: `p1-overload-${randomUUID()}`, duration_minutes: 40, placement: 'day_preferred', starts_at: null, execution: 'not_started' }
  const gaps = await roomOfDay(s.id, tomorrow, cycle.timezone, new Date(), [accepted])
  check('an accepted unsplittable sitting that cannot fit does not become free capacity', gaps.length === 0, JSON.stringify(gaps))
  await db.from('plan_blocks').insert({ ...accepted, user_id: s.id, cycle_id: cycle.id, local_date: tomorrow, day: tomorrow, title: 'Existing 40-minute sitting', detail: '', task_type: 'study', origin: 'planner', priority: 'core', duration: '40', created_by: 'algorithm' }).throwOnError()
  const sql = connect()
  try {
    await sql.connect()
    const p = await sql.query('select public.class_day_packs($1,$2,$3,now(),array[10]) as fits', [s.id, tomorrow, cycle.timezone])
    check('the authoritative packing check also refuses new work alongside that impossible accepted sitting', p.rows[0].fits === false)
  } finally { await sql.end() }
  await db.from('plan_blocks').delete().eq('id', accepted.id).throwOnError()

  // No room: recording the real class must still succeed, retaining a stable obligation.
  await db.from('availability_windows').delete().eq('user_id', s.id).throwOnError()
  const los = (await db.from('reading_los').select('id').order('id').limit(1).throwOnError()).data![0].id
  const entry = { classDate: addDays(today, -1), kind: 'covered' as const, note: 'Original class note', items: [{ outcomeId: los, extent: 'part' as const, portionNote: 'Original portion', studiedInClass: false }] }
  const preview = await previewClassLog(s.id, entry)
  if (!preview.ok) throw Error(preview.message)
  const key = randomUUID(), body = { ...entry, idempotencyKey: key, fingerprint: preview.fingerprint }
  const saved = await s.s.post('/api/class-log/confirm', body)
  check('class recording succeeds with no placement room', saved.body.ok === true, JSON.stringify(saved.body))
  const sid = saved.body.sessionId as string
  for (const [label, patch] of [
    ['changed class note', { note: 'Different note' }],
    ['changed portion note', { items: [{ ...entry.items[0], portionNote: 'Different portion' }] }],
    ['changed studied-in-class flag', { items: [{ ...entry.items[0], studiedInClass: true }] }],
  ] as const) {
    const retry = await s.s.post('/api/class-log/confirm', { ...body, ...patch })
    check(`same key with ${label} is a conflict, never false success`, retry.body.ok === false && retry.body.code === 'invalid', JSON.stringify(retry.body))
  }
  const exact = await s.s.post('/api/class-log/confirm', body)
  check('the identical retry still returns its original class entry', exact.body.ok === true && exact.body.sessionId === sid && exact.body.alreadyApplied === true)

  // Direct RPC replay remains legitimate after closing the original cycle.
  const c = connect()
  try {
    await c.connect(); await c.query('begin')
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [s.id])
    await c.query("update public.planning_cycles set status='closed' where id=$1", [cycle.id])
    try {
      const sess = (await db.from('class_sessions').select('occurrence_key, commitment_id, occurrence_date').eq('user_id', s.id).eq('idempotency_key', key).single()).data!
      const oc = { key: sess.occurrence_key as string, commitmentId: sess.commitment_id as string | null, originalDate: sess.occurrence_date as string | null }
      const replay = await c.query('select public.apply_class_log($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9::uuid,$10::date) as r', [cycle.id, key, entry.classDate, entry.kind, entry.note, JSON.stringify(entry.items.map(i => ({ outcome_id: i.outcomeId, extent: i.extent, portion_note: i.portionNote, studied_in_class: i.studiedInClass }))), '[]', oc.key, oc.commitmentId, oc.originalDate])
      check('the database replays the same entry after the cycle closes', replay.rows[0].r?.already_applied === true)
    } catch (e) { check('the database replays the same entry after the cycle closes', false, (e as Error).message) }
  } finally { await c.query('rollback'); await c.end() }

  // 1001 actual allocations must not be truncated into a spurious new obligation.
  const historySid = randomUUID(), sessionRows = Array.from({ length: 1001 }, () => ({ id: randomUUID(), user_id: s.id, cycle_id: cycle.id, class_date: entry.classDate, kind: 'covered', idempotency_key: randomUUID() }))
  sessionRows[1000].id = historySid
  await db.from('class_sessions').insert(sessionRows).throwOnError()
  for (let i = 0; i < sessionRows.length; i += 200) {
    const batch = sessionRows.slice(i, i + 200)
    await db.from('class_session_items').insert(batch.map(x => ({ session_id: x.id, outcome_id: los, extent: 'part', studied_in_class: false, planned_minutes: 10 }))).throwOnError()
    await db.from('plan_blocks').insert(batch.map(x => ({ id: `p1-history-${x.id}`, user_id: s.id, cycle_id: cycle.id, class_session_id: x.id, outcome_id: los, sitting_ordinal: 1, title: 'History', detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'completed', local_date: today, day: today, duration_minutes: 10, duration: '10', created_by: 'algorithm' }))).throwOnError()
  }
  const history = await loadClassObligations(s.id, cycle.id, 85)
  check('all 1001 historical items plus the original item are read', history.items.length === 1002, String(history.items.length))
  check('every historical allocation is counted once, with no fabricated debt', history.items.filter(x => x.sessionId !== sid).every(x => x.allocated === 10 && x.remaining === 0))
  check('the original unallocated portion remains owed', history.items.some(x => x.sessionId === sid && x.remaining > 0))
  const replacementId = `p1-history-${historySid}`, cancelledId = `p1-replaced-${randomUUID()}`
  const g = (await db.from('task_scope_groups').insert({ user_id: s.id, original_task_id: cancelledId, expected_parts: 2,
    original_scope: { session_id: historySid, outcome_id: los, source: 'class_log' } }).select('id').single().throwOnError()).data!
  await db.from('plan_blocks').update({ scope_group_id: g.id }).eq('id', replacementId).throwOnError()
  await db.from('plan_blocks').insert({ id: cancelledId, user_id: s.id, cycle_id: cycle.id, class_session_id: historySid, outcome_id: los, sitting_ordinal: 2,
    scope_group_id: g.id, title: 'Replaced sitting', detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'cancelled',
    cancelled_at: new Date().toISOString(), local_date: today, day: today, duration_minutes: 5, duration: '5', created_by: 'algorithm' }).throwOnError()
  const scope = (await getScopeGroups(s.id, [g.id])).get(g.id)
  check('cancelled class sittings do not become phantom parts after all their work is reallocated and completed', scope?.complete === true && scope.owedMinutes === 0, JSON.stringify(scope))
  let pageCalls = 0, failedClosed = false
  try {
    await readAll(async () => ++pageCalls === 1 ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
      : { data: null, error: { message: 'Controlled second-page failure' } })
  } catch (e) { failedClosed = (e as Error).message.includes('Controlled second-page failure') }
  check('a failed later history page throws instead of returning a partial count', pageCalls === 2 && failedClosed)
}

main().catch(e => { check('closeout execution', false, e.message) }).finally(async () => {
  for (const id of owned) {
    const r = await db.auth.admin.deleteUser(id)
    if (r.error) { check('owned student cleanup', false, r.error.message); continue }
    const left = await db.from('profiles').select('id').eq('id', id).throwOnError()
    check('owned student and dependent data removed', left.data.length === 0)
  }
  finish()
})
