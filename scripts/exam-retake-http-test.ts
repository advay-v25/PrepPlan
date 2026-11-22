/** Phase 7C §4: retake activation through the real /api/exam route. Owned throwaway students, deleted in finally.
 *    E2E_BASE_URL=http://localhost:3175 npx tsx scripts/exam-retake-http-test.ts */
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'

const db = createAdminClient(), { check, finish } = makeCheck(), owned: string[] = []
async function main() {
  await preflightServer()
  const a = await createStudent(db, 'p7rt', { onboard: true, register: id => owned.push(id) })
  const b = await createStudent(db, 'p7rtx', { onboard: true, register: id => owned.push(id) })
  const tz = (await db.from('profiles').select('timezone').eq('id', a.id).single()).data!.timezone as string, today = todayInZone(tz)
  const post = (s: any, body: unknown) => s.s.post('/api/exam', body)
  const hist = async () => (await db.from('exam_completion_history').select('*').eq('user_id', a.id)).data ?? []
  const sat = addDays(today, -10)
  check('sat is recorded', (await post(a, { action: 'sat', satOn: sat })).body.ok === true)
  check('preview before a retake request is refused', (await post(a, { action: 'preview_retake' })).body.code === 'NO_RETAKE_REQUEST')
  await post(a, { action: 'follow_up', result: 'a band', psm: 'done', retake: true, retakeNote: 'again' })
  const up0 = await db.from('profiles').update({ exam_date: addDays(sat, -5) }).eq('id', a.id); if (up0.error) throw Error(up0.error.message)
  const nn = await post(a, { action: 'preview_retake' })
  check('preview with no later booked date is refused', nn.body.code === 'NO_NEW_SITTING', JSON.stringify(nn.body).slice(0, 200))
  const next = addDays(today, 120)
  await db.from('profiles').update({ exam_date: next }).eq('id', a.id)
  const st = (await a.s.json('/api/exam')).body.status
  check('CONFIRMED FAILURE (kept by design until explicit acceptance): a later booked date alone still reads as sat', st.phase === 'sat' && st.examDate === next)
  const taskCount = (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', a.id)).count
  const preview = async () => {
    const result = await post(a, { action: 'preview_retake' })
    if (!result.body.ok) throw new Error(`Retake preview failed with ${result.status}: ${result.body.code} ${result.body.error}`)
    return { draftId: result.body.preview.draftId, revision: result.body.preview.revision }
  }
  const p0 = await preview()
  check('a draft cannot be accepted through the old unbound request', (await post(a, { action: 'activate_retake' })).status === 400)
  check('another student cannot accept an owned draft', (await post(b, { action: 'activate_retake', ...p0 })).body.code === 'DRAFT_UNAVAILABLE')
  check('cancel preserves the pause and prevents a delayed acceptance', (await post(a, { action: 'cancel_retake', ...p0 })).body.ok === true
    && (await post(a, { action: 'activate_retake', ...p0 })).body.code === 'STALE_RETAKE' && (await hist()).length === 0)
  const stale = await preview()
  await db.from('profiles').update({ exam_date: addDays(next, 1) }).eq('id', a.id).throwOnError()
  check('a changed date makes the reviewed draft stale, preserving the previous sitting', (await post(a, { action: 'activate_retake', ...stale })).body.code === 'STALE_RETAKE'
    && (await hist()).length === 0 && (await a.s.json('/api/exam')).body.status.satOn === sat)
  await db.from('profiles').update({ exam_date: next }).eq('id', a.id).throwOnError()
  const accepted = await preview()
  const r1 = await post(a, { action: 'activate_retake', ...accepted })
  check('explicit acceptance makes the new sitting active (long horizon) and clears the pause', r1.body.ok === true && r1.body.status.phase === 'long_horizon' && r1.body.status.satOn === null)
  const h = await hist()
  check('the completed sitting, reported result, PSM and retake note are kept in history with the new date', h.length === 1 && h[0].sat_on === sat && h[0].reported_result === 'a band' && h[0].psm_status === 'done' && h[0].retake_note === 'again' && h[0].new_exam_date === next)
  check('tasks are untouched by activation', (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', a.id)).count === taskCount)
  await db.from('profiles').update({ exam_date: addDays(next, 2) }).eq('id', a.id).throwOnError()
  const r2 = await post(a, { action: 'activate_retake', ...accepted })
  check('a repeat accept after a different date still returns the original receipt', r2.body.ok === true && r2.body.alreadyActive === true
    && r2.body.receipt.exam_date === next && (await hist()).length === 1 && r2.body.status.examDate === addDays(next, 2))
  check("another student cannot read this student's history", (await db.from('exam_completion_history').select('id').eq('user_id', b.id)).data!.length === 0)

  check('the next exam completion is independent of the earlier receipt', (await post(a, { action: 'sat', satOn: today })).body.ok === true
    && (await post(a, { action: 'activate_retake', ...accepted })).body.status.satOn === today)
  check('a delayed undo carries the version from the sitting that was shown', (await post(a, { action: 'undo', version: st.version })).body.code === 'STALE_EXAM')
  await post(a, { action: 'follow_up', retake: true })
  const oldCycle = (await db.from('planning_cycles').select('id').eq('user_id', a.id).eq('status', 'active').single().throwOnError()).data!
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -14), ends_at_local: addDays(today, -8) }).eq('id', oldCycle.id).throwOnError()
  const second = await preview()
  const secondResult = await post(a, { action: 'activate_retake', ...second })
  check('the second accepted retake starts a new cycle and keeps the older state', secondResult.body.ok === true
    && secondResult.body.receipt.cycle_id !== oldCycle.id && (await hist()).length === 2
    && (await db.from('planning_cycles').select('status').eq('id', oldCycle.id).single().throwOnError()).data!.status === 'closed',
    JSON.stringify(secondResult.body).slice(0, 400))
  const ex = JSON.parse(await (await a.s.req('/api/account/export')).text())
  check('the personal download carries both history rows', (ex.tables.exam_completion_history ?? []).length === 2)
  const bad = await post(a, { action: 'nope' })
  check('an unknown action is refused', bad.status === 400)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
