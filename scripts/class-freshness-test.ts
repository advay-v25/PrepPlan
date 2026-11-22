/** Phase 7C §2: the staleness fingerprints read mutable class facts. A class outcome corrected in place (no task, no new item) must move
 *  paper_scope_source and weekly_source_version; a repeat of the same report and a no-change read must not. Real Postgres, owned student, deleted in finally.
 *    E2E_BASE_URL=http://localhost:3173 npx tsx scripts/class-freshness-test.ts */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createClient } from '@supabase/supabase-js'
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, classLedPersona, preflightServer, makeCheck } from './lib/e2eSession'
import { addDays, todayInZone, weekdayOf } from '../src/lib/planning/studyWeek'

const db = createAdminClient(), { check, finish } = makeCheck(), owned: string[] = []
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
async function main() {
  await preflightServer()
  const persona = await classLedPersona(db)
  const s = await createStudent(db, 'p7f', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cyc.timezone as string), D = addDays(today, -2)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -8), ends_at_local: addDays(today, 9) }).eq('id', cyc.id).throwOnError()
  await db.from('calendar_commitments').delete().eq('user_id', s.id).eq('kind', 'class')
  const A = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'A', kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(D)], start_time: '09:00', end_time: '10:00', starts_on: addDays(today, -9), starts_at: `${addDays(today, -9)}T09:00:00Z`, ends_at: `${addDays(today, -9)}T10:00:00Z` }).select('id').single().throwOnError()).data!.id as string
  const email = (await db.auth.admin.getUserById(s.id)).data.user!.email!, link = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const uc = createClient(url, anon, { auth: { persistSession: false } })
  await uc.auth.verifyOtp({ token_hash: (link.data!.properties as any).hashed_token, type: 'magiclink' })
  const O = (await db.from('reading_los').select('id').eq('reading_id', 'r028').order('sequence').limit(1).single().throwOnError()).data!.id as string
  const create = await uc.rpc('apply_class_log', { p_cycle_id: cyc.id, p_idempotency_key: `f-${randomUUID()}`, p_class_date: D, p_kind: 'covered', p_note: null, p_items: [{ outcome_id: O, extent: 'full', portion_note: '', studied_in_class: false, planned_minutes: 0 }], p_tasks: [], p_occurrence_key: `series:${A}:${D}`, p_commitment_id: A, p_occurrence_date: D, p_finalise: false })
  if (create.error) throw Error(create.error.message)
  const sid = (create.data as any).session_id as string
  const P = async () => String((await db.rpc('paper_scope_source', { p_user: s.id })).data), W = async () => String((await db.rpc('weekly_source_version', { p_user: s.id, p_cycle: cyc.id })).data)
  const taskCount = async () => (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', s.id)).count
  const up = async (version: number, extent: 'full' | 'part', finalise = false) => uc.rpc('apply_class_log_update', { p_cycle_id: null, p_session_id: sid, p_idempotency_key: `f-${randomUUID()}`, p_expected_version: version, p_finalise: finalise, p_items: [{ outcome_id: O, extent, portion_note: '', studied_in_class: false, planned_minutes: 0 }], p_tasks: [] })
  const [p0, w0, t0] = [await P(), await W(), await taskCount()]
  check('a no-change read is stable', p0 === await P() && w0 === await W())
  const r1 = await up(1, 'part')
  const [p1, w1] = [await P(), await W()]
  check('whole -> part with ZERO new tasks moves the paper-scope fingerprint', !r1.error && p1 !== p0 && (await taskCount()) === t0, r1.error?.message)
  check('...and the weekly fingerprint', w1 !== w0)
  const r2 = await up(2, 'full')
  const [p2, w2] = [await P(), await W()]
  check('part -> whole (separately) moves both again, to values that differ from the part state', !r2.error && p2 !== p1 && w2 !== w1 && (await taskCount()) === t0)
  const r3 = await up(3, 'full')
  check('repeating the same report changes nothing (version stays, fingerprints stable)', !r3.error && (r3.data as any).changed === false && p2 === await P() && w2 === await W())
  const r4 = await up(3, 'full', true)
  const [p4, w4] = [await P(), await W()]
  check('no-change finalisation is its own event: it bumps the version and the completion, adds no coverage', !r4.error && (r4.data as any).completed === true && (await db.from('class_session_items').select('extent').eq('session_id', sid)).data![0].extent === 'full' && w4 !== w2 && p4 !== p2)
  const other = await createStudent(db, 'p7fx', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const xw = String((await db.rpc('weekly_source_version', { p_user: other.id, p_cycle: cyc.id })).data), xp0 = String((await db.rpc('paper_scope_source', { p_user: other.id })).data)
  await up(4, 'part')
  check("another student's fingerprints are not moved by this student's correction", xp0 === String((await db.rpc('paper_scope_source', { p_user: other.id })).data) && xw === String((await db.rpc('weekly_source_version', { p_user: other.id, p_cycle: cyc.id })).data))
  const anonCall = await createClient(url, anon, { auth: { persistSession: false } }).rpc('paper_scope_source', { p_user: s.id })
  check('the fingerprints are not readable by a signed-in or anonymous caller', !!anonCall.error && !!(await uc.rpc('paper_scope_source', { p_user: s.id })).error)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
