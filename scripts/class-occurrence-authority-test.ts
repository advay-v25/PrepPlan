/** Phase 7 §1C: the DATABASE decides whether a NEW class log names a real, finished occurrence. Direct signed-in apply_class_log calls (not the HTTP route),
 *  throwaway students registered by id and deleted in finally. Needs E2E_BASE_URL only for the student fixture's sign-in helper.
 *    E2E_BASE_URL=http://localhost:3171 npx tsx scripts/class-occurrence-authority-test.ts */
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
  const s = await createStudent(db, 'p7auth', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const other = await createStudent(db, 'p7authx', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cyc.timezone), D = addDays(today, -2), D3 = addDays(today, -3)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -8), ends_at_local: addDays(today, 9) }).eq('id', cyc.id).throwOnError()
  for (const t of ['plan_blocks', 'calendar_commitments', 'availability_windows']) await db.from(t).delete().eq('user_id', s.id).throwOnError()
  const email = (await db.auth.admin.getUserById(s.id)).data.user!.email!
  const link = await db.auth.admin.generateLink({ type: 'magiclink', email })
  const uc = createClient(url, anon, { auth: { persistSession: false } })
  const v = await uc.auth.verifyOtp({ token_hash: (link.data!.properties as any).hashed_token, type: 'magiclink' }); if (v.error) throw Error(v.error.message)

  const series = async (label: string, day: string, start: string, end: string, extra: Record<string, unknown> = {}) => (await db.from('calendar_commitments').insert({
    user_id: s.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(day)], start_time: start, end_time: end,
    starts_on: addDays(today, -8), starts_at: `${addDays(today, -8)}T${start}:00Z`, ends_at: `${addDays(today, -8)}T${end}:00Z`, ...extra }).select('id').single().throwOnError()).data!.id as string
  const call = (key: string | null, cid: string | null, odate: string | null, date: string, idem = randomUUID()) => uc.rpc('apply_class_log', {
    p_cycle_id: cyc.id, p_idempotency_key: idem, p_class_date: date, p_kind: 'none', p_note: null, p_items: [], p_tasks: [],
    p_occurrence_key: key, p_commitment_id: cid, p_occurrence_date: odate })
  const sessions = async () => (await db.from('class_sessions').select('id, occurrence_key').eq('user_id', s.id)).data ?? []
  const refused = (r: { error: { message: string } | null }, re: RegExp) => !!r.error && re.test(r.error.message)

  const A = await series('A', D, '09:00', '10:00')
  const ok1 = await call(`series:${A}:${D}`, A, D, D)
  check('a real, finished occurrence is accepted', !ok1.error && (await sessions()).length === 1)
  const wrongDay = await series('W', D3, '09:00', '10:00')
  const bad = await call(`series:${wrongDay}:${D}`, wrongDay, D, D)
  check('a date the series does not meet on is refused, nothing written', refused(bad, /OCCURRENCE_INVALID/) && (await sessions()).length === 1)
  const before = await call(`series:${A}:${addDays(D, -14)}`, A, addDays(D, -14), addDays(D, -14))
  check('a date before the series began is refused', refused(before, /OCCURRENCE_INVALID/))

  // cancelled and moved
  const Cn = await series('Cancelled', D3, '11:00', '12:00')
  await db.from('commitment_exceptions').insert({ user_id: s.id, commitment_id: Cn, occurrence_date: D3, kind: 'skipped' }).throwOnError()
  check('a cancelled occurrence cannot be logged', refused(await call(`series:${Cn}:${D3}`, Cn, D3, D3), /OCCURRENCE_INVALID.*cancelled/))
  const Mv = await series('Moved', D3, '13:00', '14:00'), movedTo = addDays(D3, 1)
  await db.from('commitment_exceptions').insert({ user_id: s.id, commitment_id: Mv, occurrence_date: D3, kind: 'moved', new_date: movedTo, new_start_time: '13:00', new_end_time: '14:00' }).throwOnError()
  check('a moved class cannot be logged on its old date', refused(await call(`series:${Mv}:${D3}`, Mv, D3, D3), /OCCURRENCE_MOVED/))
  const mv = await call(`series:${Mv}:${D3}`, Mv, D3, movedTo)
  check('it logs on its new date under its ORIGINAL identity', !mv.error && (await db.from('class_sessions').select('class_date, occurrence_date').eq('user_id', s.id).eq('occurrence_key', `series:${Mv}:${D3}`).single()).data?.class_date === movedTo)

  // archived / cancelled commitment
  const Ar = await series('Archived', D3, '15:00', '16:00', { status: 'archived' })
  check('an archived class cannot be logged', refused(await call(`series:${Ar}:${D3}`, Ar, D3, D3), /OCCURRENCE_INVALID/))

  // in progress today / one-offs
  // In-progress logging (owner decision 19 Nov 2026): a class that has STARTED can be reported; one that has not started cannot.
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: cyc.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const nowMin = Number(nowParts.find(x => x.type === 'hour')!.value) * 60 + Number(nowParts.find(x => x.type === 'minute')!.value)
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  if (nowMin >= 31 && nowMin <= 23 * 60 + 28) {
    const Ip = await series('In progress', today, hhmm(nowMin - 30), hhmm(nowMin + 30))
    check('a class that has started but not ended is accepted (in progress)', !(await call(`series:${Ip}:${today}`, Ip, today, today)).error)
  }
  if (nowMin <= 23 * 60 + 28) {
    const Td = await series('Not started today', today, hhmm(nowMin + 30), hhmm(Math.min(nowMin + 90, 23 * 60 + 59)))
    check('a class that has not started yet today is refused (OCCURRENCE_NOT_STARTED)', refused(await call(`series:${Td}:${today}`, Td, today, today), /OCCURRENCE_NOT_STARTED/))
  }
  const Ft = await series('Future', addDays(today, 3), '09:00', '10:00')
  check('a future occurrence is refused', refused(await call(`series:${Ft}:${addDays(today, 3)}`, Ft, addDays(today, 3), addDays(today, 3)), /OCCURRENCE_NOT_STARTED/))
  const once = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'One off', kind: 'class', recurrence: 'none', status: 'active', is_protected: true,
    starts_at: new Date(Date.now() + 3600e3).toISOString(), ends_at: new Date(Date.now() + 7200e3).toISOString() }).select('id').single().throwOnError()).data!.id as string
  check('a one-off class that has not started is refused', refused(await call(`once:${once}`, once, null, today), /OCCURRENCE_NOT_STARTED/))
  const onceNow = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'One off running', kind: 'class', recurrence: 'none', status: 'active', is_protected: true,
    starts_at: new Date(Date.now() - 600e3).toISOString(), ends_at: new Date(Date.now() + 3000e3).toISOString() }).select('id').single().throwOnError()).data!.id as string
  const onceDay = new Intl.DateTimeFormat('en-CA', { timeZone: cyc.timezone }).format(new Date(Date.now() - 600e3))
  check('a one-off class in progress is accepted on its own day', !(await call(`once:${onceNow}`, onceNow, null, onceDay)).error)
  const past = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'Past one off', kind: 'class', recurrence: 'none', status: 'active', is_protected: true,
    starts_at: new Date(`${D}T14:00:00Z`).toISOString(), ends_at: new Date(`${D}T15:00:00Z`).toISOString() }).select('id').single().throwOnError()).data!.id as string
  check('a one-off cannot be logged on a date other than its own', refused(await call(`once:${past}`, past, null, D3), /OCCURRENCE_MOVED/))
  check('an ended one-off logs on its own date', !(await call(`once:${past}`, past, null, D)).error)
  check('a future manual session is refused', refused(await call(`manual:${randomUUID()}`, null, null, addDays(today, 1)), /OCCURRENCE_NOT_ENDED/))

  // foreign
  const theirs = (await db.from('calendar_commitments').insert({ user_id: other.id, label: 'Theirs', kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(D)], start_time: '09:00', end_time: '10:00', starts_on: addDays(today, -8), starts_at: `${addDays(today, -8)}T09:00:00Z`, ends_at: `${addDays(today, -8)}T10:00:00Z` }).select('id').single().throwOnError()).data!.id as string
  check("another student's class cannot be named", refused(await call(`series:${theirs}:${D}`, theirs, D, D), /OCCURRENCE_INVALID|Unauthorized/))

  // explicit succession: receipt commitmentId -> successorId, predecessor already logged that date
  const P = await series('P', D3, '16:00', '17:00')
  check('predecessor logs', !(await call(`series:${P}:${D3}`, P, D3, D3)).error)
  const P2 = await series('Different name', D3, '16:00', '17:00')
  const noLineage = await call(`series:${P2}:${D3}`, P2, D3, D3)
  check('a same-time series with NO receipt is an independent class and can be logged', !noLineage.error)
  const P3 = await series('Successor', D3, '16:00', '17:00')
  await db.from('checkpoint_commands').insert({ user_id: s.id, key: `oa-${randomUUID()}`, command: 'class_change', payload_hash: randomUUID(), receipt: { ok: true, action: 'series_from', commitmentId: P, successorId: P3 } }).throwOnError()
  check('a recorded successor cannot log the date its predecessor already logged', refused(await call(`series:${P3}:${D3}`, P3, D3, D3), /OCCURRENCE_ALREADY_LOGGED/))

  // wrapper and replay
  const w = await uc.rpc('apply_class_log', { p_cycle_id: cyc.id, p_idempotency_key: randomUUID(), p_class_date: D3, p_kind: 'none', p_note: null, p_items: [], p_tasks: [] })
  check('the 7-argument form cannot write a new, unnamed log', refused(w as any, /OCCURRENCE_INVALID/))
  const idem = randomUUID(), G = await series('G', addDays(today, -4), '09:00', '10:00'), gd = addDays(today, -4)
  const first = await call(`series:${G}:${gd}`, G, gd, gd, idem)
  await db.from('commitment_exceptions').insert({ user_id: s.id, commitment_id: G, occurrence_date: gd, kind: 'skipped' }).throwOnError()
  await db.from('calendar_commitments').update({ status: 'archived' }).eq('id', G).throwOnError()
  const replay = await call(`series:${G}:${gd}`, G, gd, gd, idem)
  check('a legitimate replay still answers after the class was later cancelled and archived', !first.error && !replay.error && (replay.data as any).already_applied === true && (await sessions()).filter(r => r.occurrence_key === `series:${G}:${gd}`).length === 1)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
