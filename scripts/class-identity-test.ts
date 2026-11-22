/** Phase 7 §1: a date is not a class. Real owned rows through the real HTTP commands; throwaway student (cascades). Needs E2E_BASE_URL. */
import { randomUUID } from 'node:crypto'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createAdminClient } from '../src/lib/supabase/admin'
import { createStudent, classLedPersona, preflightServer, makeCheck } from './lib/e2eSession'
import { getClassLogContext } from '../src/lib/planning/classlog/service'
import { addDays, todayInZone, weekdayOf } from '../src/lib/planning/studyWeek'

const db = createAdminClient(), { check, finish } = makeCheck(), owned: string[] = []

async function main() {
  await preflightServer()
  const persona = await classLedPersona(db)
  const s = await createStudent(db, 'p7ident', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const other = await createStudent(db, 'p7other', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', s.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone), D = addDays(today, -1), D2 = addDays(today, -2)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -7), ends_at_local: addDays(today, 9) }).eq('id', cycle.id).throwOnError()
  for (const t of ['plan_blocks', 'calendar_commitments', 'availability_windows']) await db.from(t).delete().eq('user_id', s.id).throwOnError()
  const series = async (label: string, day: string, start: string, end: string) => (await db.from('calendar_commitments').insert({
    user_id: s.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(day)], start_time: start, end_time: end,
    starts_on: addDays(today, -7), starts_at: `${addDays(today, -7)}T${start}:00Z`, ends_at: `${addDays(today, -7)}T${end}:00Z` }).select('id').single().throwOnError()).data!.id as string
  const A = await series('Class A', D, '09:00', '10:00'), B = await series('Class B', D, '11:00', '12:00')
  const [x, y] = (await db.from('reading_los').select('id').order('id').limit(2).throwOnError()).data!.map(r => r.id as string)
  const ctx = async () => { const c = await getClassLogContext(s.id); if (!c.classLed || !c.cycle) throw Error('not class led'); return c }
  const sessions = async () => (await db.from('class_sessions').select('id, class_date, occurrence_key, commitment_id, occurrence_date, kind').eq('user_id', s.id).order('logged_at')).data ?? []
  const entry = (key: string | undefined, date: string, outcome: string, extent: 'full' | 'part' = 'full') => ({ occurrenceKey: key, classDate: date, kind: 'covered' as const, items: [{ outcomeId: outcome, extent }] })
  const log = async (e: ReturnType<typeof entry>, idem = randomUUID()) => {
    const pv = await s.s.post('/api/class-log/preview', e)
    if (!pv.body.ok) return { pv, cf: pv }
    return { pv, cf: await s.s.post('/api/class-log/confirm', { ...e, idempotencyKey: idem, fingerprint: pv.body.fingerprint }), idem }
  }
  const kA = `series:${A}:${D}`, kB = `series:${B}:${D}`

  let c = await ctx()
  check('two same-day series are two separate pending classes, not one date', c.occurrences.filter(o => o.date === D).length === 2 && c.occurrences.every(o => o.status === 'pending') && c.pendingDates.filter(d => d === D).length === 1)
  const a1 = await log(entry(kA, D, x))
  check('class A logs as its own session carrying its identity', a1.cf.body.ok === true && (await sessions()).length === 1 && (await sessions())[0].occurrence_key === kA && (await sessions())[0].commitment_id === A && (await sessions())[0].occurrence_date === D)
  c = await ctx()
  check('after logging A, B on the SAME date is still pending (a logged date no longer hides it)', c.occurrences.find(o => o.key === kA)?.status === 'logged' && c.occurrences.find(o => o.key === kB)?.status === 'pending' && c.pendingDates.includes(D))
  const retry = await s.s.post('/api/class-log/confirm', { ...entry(kA, D, x), idempotencyKey: a1.idem, fingerprint: a1.pv.body.fingerprint })
  check('a duplicate retry (same request key) replays the same session; no second session', retry.body.ok && retry.body.alreadyApplied === true && retry.body.sessionId === a1.cf.body.sessionId && (await sessions()).length === 1)
  const again = await log(entry(kA, D, x))
  check('logging class A again under a NEW request key is refused, nothing added', again.cf.body.ok === false && /already been logged/i.test(again.cf.body.message) && (await sessions()).length === 1)
  const b1 = await log(entry(kB, D, x, 'part'))
  const ss = await sessions()
  check('class B (same day, a different series, the same outcome as a part) is a second legitimate session', b1.cf.body.ok === true && ss.length === 2 && new Set(ss.map(r => r.id)).size === 2 && ss.every(r => r.class_date === D))
  const items = (await db.from('class_session_items').select('session_id, extent').in('session_id', ss.map(r => r.id))).data!
  check('one full and one partial outcome stay separate items on their own sessions', items.length === 2 && items.filter(i => i.extent === 'full').length === 1 && items.filter(i => i.extent === 'part').length === 1 && new Set(items.map(i => i.session_id)).size === 2)
  const tasksBy = (await db.from('plan_blocks').select('class_session_id').eq('user_id', s.id).not('class_session_id', 'is', null)).data ?? []
  check('follow-up work (if any was placed) points only at the session that owns it', tasksBy.every(t => ss.some(r => r.id === t.class_session_id)))

  // recurring plus a one-off on the same day
  const once = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'Workshop', kind: 'class', recurrence: 'none', status: 'active', is_protected: true,
    starts_at: new Date(`${D2}T14:00:00Z`).toISOString(), ends_at: new Date(`${D2}T15:00:00Z`).toISOString() }).select('id').single().throwOnError()).data!.id as string
  const A2 = `series:${A}:${addDays(D, -7)}`
  c = await ctx()
  check('a one-off class has its own identity beside the weekly series', c.occurrences.some(o => o.key === `once:${once}`) && c.occurrences.every(o => o.key !== A2 || o.date !== D2))

  // two manual sessions on one day
  const m1 = `manual:${randomUUID()}`, m2 = `manual:${randomUUID()}`
  const r1 = await log(entry(m1, D2, y)), r2 = await log(entry(m2, D2, y))
  check('two manual sessions on one day are two sessions', r1.cf.body.ok && r2.cf.body.ok && (await sessions()).filter(r => r.occurrence_key?.startsWith('manual:')).length === 2)
  const r3 = await log(entry(m1, D2, y))
  check('the same manual session cannot be logged twice under a new request key', r3.cf.body.ok === false && (await sessions()).filter(r => r.occurrence_key === m1).length === 1)

  // concurrent submits for one occurrence with different keys
  const kOnce = `once:${once}`
  const race = await Promise.all([log(entry(kOnce, D2, x)), log(entry(kOnce, D2, x))])
  check('two concurrent submits for one class make exactly one session', (await sessions()).filter(r => r.occurrence_key === kOnce).length === 1 && race.filter(r => r.cf.body.ok === true).length >= 1, JSON.stringify(race.map(r => r.cf.body.ok)))

  // moved occurrence keeps its original-date identity; the unrelated class is untouched
  const F = addDays(today, -6), G = addDays(today, -5), E = addDays(today, -3)
  const M = await series('Class M', F, '16:00', '17:00'), C = await series('Class C', E, '13:00', '14:00')
  await db.from('commitment_exceptions').insert({ user_id: s.id, commitment_id: M, occurrence_date: F, kind: 'moved', new_date: G }).throwOnError()
  c = await ctx()
  const moved = c.occurrences.find(o => o.key === `series:${M}:${F}`)
  check('a moved occurrence keeps its ORIGINAL-date identity at its new date', !!moved && moved.date === G && moved.moved && moved.originalDate === F && moved.status === 'pending')
  const before = JSON.stringify((await sessions()).find(r => r.occurrence_key === kA))
  const mv = await log(entry(`series:${M}:${F}`, G, y))
  const mvRow = (await sessions()).find(r => r.occurrence_key === `series:${M}:${F}`)
  check('logging the moved class stores class_date at the new day and occurrence_date at the original', mv.cf.body.ok === true && mvRow?.class_date === G && mvRow?.occurrence_date === F)
  const stale = await log(entry(`series:${M}:${F}`, F, y))
  check('naming the moved class by its OLD date is refused', stale.cf.body.ok === false)
  check('the unrelated class on the old date is unchanged', JSON.stringify((await sessions()).find(r => r.occurrence_key === kA)) === before)

  // cancellation and restore of an occurrence
  const kC = `series:${C}:${E}`
  await db.from('commitment_exceptions').insert({ user_id: s.id, commitment_id: C, occurrence_date: E, kind: 'skipped' }).throwOnError()
  c = await ctx()
  check('a cancelled occurrence is not a pending class', !c.occurrences.some(o => o.key === kC))
  await db.from('commitment_exceptions').delete().eq('commitment_id', C).eq('occurrence_date', E).throwOnError()
  c = await ctx()
  check('restoring it brings back that one occurrence, pending, and no other changed', c.occurrences.find(o => o.key === kC)?.status === 'pending' && c.occurrences.find(o => o.key === kA)?.status === 'logged')

  // legacy date-level entry: never guessed onto an occurrence
  await db.from('class_sessions').insert({ user_id: s.id, cycle_id: cycle.id, class_date: E, kind: 'covered', idempotency_key: `legacy-${randomUUID()}` }).throwOnError()
  c = await ctx()
  const legacyDay = c.occurrences.filter(o => o.date === E)
  check('a legacy date-only log is shown as unresolved, never assigned to a guessed class', legacyDay.length > 0 && legacyDay.every(o => o.status === 'legacy' && o.sessionId === null))
  const lg = await log(entry(kC, E, x))
  check('and it is not logged a second time on top of that legacy entry', lg.cf.body.ok === false && (await sessions()).filter(r => r.class_date === E).length === 1)

  // a "from this date" series change keeps the earlier log: the successor's first occurrence is the SAME class, not a new pending one
  const P = await series('Class P', D2, '15:00', '16:00')
  const lp = await log(entry(`series:${P}:${D2}`, D2, y))
  await db.from('calendar_commitments').update({ ends_on: addDays(D2, -1) }).eq('id', P).throwOnError()
  const P2 = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'Class P', kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(D2)], start_time: '15:30', end_time: '16:30',
    starts_on: D2, starts_at: `${D2}T15:30:00Z`, ends_at: `${D2}T16:30:00Z` }).select('id').single().throwOnError()).data!.id as string
  // the engine's own record of the change (class_change receipt: commitmentId -> successorId) is the ONLY lineage
  await db.from('checkpoint_commands').insert({ user_id: s.id, key: `ci-${randomUUID()}`, command: 'class_change', payload_hash: randomUUID(), receipt: { ok: true, action: 'series_from', commitmentId: P, successorId: P2 } }).throwOnError()
  c = await ctx()
  const succ = c.occurrences.find(o => o.key === `series:${P2}:${D2}`)
  check('after a series change from that day, the successor\'s occurrence is the class already logged, not a second pending one', lp.cf.body.ok === true && succ?.status === 'logged' && succ.sessionId === lp.cf.body.sessionId)
  const dup = await log(entry(`series:${P2}:${D2}`, D2, y))
  check('and it cannot be logged again under the successor identity', dup.cf.body.ok === false && (await sessions()).filter(r => r.class_date === D2 && r.commitment_id === P2).length === 0)

  // negative control: an unrelated series with the SAME label that merely starts the day another ended is a different class (no receipt, no lineage)
  const Q = await series('Class Q', D2, '17:00', '18:00')
  const lq = await log(entry(`series:${Q}:${D2}`, D2, x))
  await db.from('calendar_commitments').update({ ends_on: addDays(D2, -1) }).eq('id', Q).throwOnError()
  const Q2 = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'Class Q', kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(D2)], start_time: '17:00', end_time: '18:00',
    starts_on: D2, starts_at: `${D2}T17:00:00Z`, ends_at: `${D2}T18:00:00Z` }).select('id').single().throwOnError()).data!.id as string
  c = await ctx()
  check('an unrelated same-name series is NOT treated as a successor: its occurrence stays pending', lq.cf.body.ok === true && c.occurrences.find(o => o.key === `series:${Q2}:${D2}`)?.status === 'pending')

  // foreign and malformed identities
  const foreign = (await db.from('calendar_commitments').insert({ user_id: other.id, label: 'Theirs', kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [weekdayOf(D)], start_time: '09:00', end_time: '10:00', starts_on: addDays(today, -7), starts_at: `${addDays(today, -7)}T09:00:00Z`, ends_at: `${addDays(today, -7)}T10:00:00Z` }).select('id').single().throwOnError()).data!.id as string
  const f = await log(entry(`series:${foreign}:${D}`, D, x))
  check("another student's class cannot be named", f.cf.body.ok === false && (await sessions()).every(r => r.commitment_id !== foreign))
  const bad = await s.s.post('/api/class-log/preview', entry('series:nope', D, x))
  check('a malformed identity is refused at the boundary', bad.status === 400)
  const countBefore = (await sessions()).length
  const nokey = await log(entry(undefined, addDays(today, -3), y))
  check('a new log with no named class is refused: a date alone is never a class', nokey.cf.body.ok === false && (await sessions()).length === countBefore)
}
main().then(() => finish()).catch(e => { console.error(e); process.exitCode = 1 }).finally(async () => { for (const id of owned) await db.auth.admin.deleteUser(id).catch(() => {}); console.log(`cleanup: ${owned.length} owned student(s) removed`) })
