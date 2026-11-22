/**
 * Redistribution of missed work against real slots, on the development database with ordinary throwaway students (deleted by recorded id).
 *   npx tsx scripts/redistribution-db-test.ts
 * A day can have enough free MINUTES while a longer timed sitting collides with a manually placed session, a commitment or the end of its
 * study window; these scenarios prove the whole extended interval is checked, and again inside the commit under the planning lock.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { createStudent, makeCheck } from './lib/e2eSession'
import { todayInZone, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const TZ = 'Europe/London'
const today = todayInZone(TZ)
const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const made: string[] = []

async function main() {
  console.log('\nRedistribution against real slots (fixture)\n')
  const redis = await import('../src/lib/planning/pulse/redistribute')
  try {
    const st = await createStudent(admin, 'rd', { onboard: true }); made.push(st.id)
    const cyc = (await admin.from('planning_cycles').select('id').eq('user_id', st.id).eq('status', 'active').single()).data!.id as string
    await admin.from('planning_cycles').update({ starts_at_local: add(today, -3), ends_at_local: add(today, 4) }).eq('id', cyc)
    const old = ((await admin.from('plan_blocks').select('id').eq('user_id', st.id).eq('cycle_id', cyc)).data ?? []).map(r => r.id as string)
    if (old.length) await admin.from('plan_blocks').delete().in('id', old).eq('user_id', st.id)
    // Windows: replace the fixture's with known ones, 18:00–21:00 every day, and no weekday commitment, so the only occupants are the ones this test adds.
    await admin.from('availability_windows').delete().eq('user_id', st.id)
    await admin.from('calendar_commitments').delete().eq('user_id', st.id).eq('source', 'onboarding')
    await admin.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: st.id, weekday, start_time: '18:00', end_time: '21:00', status: 'active', source: 'onboarding' })))
    await admin.from('profiles').update({ max_session_minutes: 60, timezone: TZ }).eq('id', st.id)
    const ids: string[] = []
    const row = (id: string, o: Record<string, unknown> = {}) => { ids.push(id); return { id, user_id: st.id, cycle_id: cyc, title: id, detail: 'd', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: add(today, 1), day: add(today, 1), duration_minutes: 30, duration: '30', created_by: 'algorithm', learning_objective: 'o', suggested_approach: 'a', completion_meaning: 'c', lm_id: 'r028', outcome_id: 'r028-a', ...o } }
    const timed = (hhmm: string, date = add(today, 1)) => ({ placement: 'timed', starts_at: zonedTimeToUtc(date, hhmm, TZ).toISOString(), local_date: date, day: date })
    const dur = async (id: string) => Number((await admin.from('plan_blocks').select('duration_minutes').eq('id', id).single()).data?.duration_minutes)
    const miss = async (id: string, how = 'deferred') => { await admin.from('plan_blocks').update({ execution: how }).eq('id', id).eq('user_id', st.id) }
    const hashNow = async () => (await admin.rpc('current_week_source_hash', { p_user: st.id, p_cycle: cyc })).data as string
    const tomorrow = add(today, 1)

    console.log('1. Same-day deferral and past missed work')
    await admin.from('plan_blocks').insert([row('src-today', { local_date: today, day: today, duration_minutes: 30 }), row('later-a', { duration_minutes: 30 })])
    await miss('src-today')
    const t0 = await redis.redistributeMissedTask(st.id, 'src-today')
    check('a deferral of today’s own task moves nothing automatically', !t0.applied && /another time|waits/i.test(t0.message) && (await dur('later-a')) === 30, t0.message)
    await admin.from('plan_blocks').insert(row('src-past', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 15 }))
    await miss('src-past')
    const p0 = await redis.redistributeMissedTask(st.id, 'src-past')
    check('past missed work is absorbed into the same reading’s later session, within the 60-minute sitting limit', p0.applied && p0.placed === 15 && (await dur('later-a')) === 45, p0.message)
    check('the receipt matches what was committed', ((await admin.from('redistribution_receipts').select('placed_minutes').eq('source_task_id', 'src-past').is('reversed_at', null)).data ?? [])[0]?.placed_minutes === 15)

    console.log('\n2. A timed sitting must keep its whole interval clear')
    await admin.from('plan_blocks').insert([row('t-target', { ...timed('18:00'), duration_minutes: 30, lm_id: 'r030' }), row('t-manual', { ...timed('18:40'), duration_minutes: 30, lm_id: 'r031', title: 'Manually placed' }), row('src-t', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 40, lm_id: 'r030' })])
    await miss('src-t')
    const tt = await redis.redistributeMissedTask(st.id, 'src-t')
    check('with plenty of free minutes that day, the sitting still stops at the manually placed session (30 → 40, not 60)', tt.applied && (await dur('t-target')) === 40 && tt.placed === 10 && /still deferred/.test(tt.message), `${await dur('t-target')} ${tt.message}`)
    check('the minutes that did not fit are stated as still deferred (30 of 40 minutes)', tt.unplaced === 30)

    console.log('\n3. Commitments, moved occurrences, windows, midnight, nothing to extend')
    await admin.from('plan_blocks').insert([row('c-target', { ...timed('18:00', add(today, 2)), duration_minutes: 30, lm_id: 'r032' }), row('src-c', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 30, lm_id: 'r032' })])
    const dayAfter = add(today, 2)
    const one = await admin.from('calendar_commitments').insert({ user_id: st.id, label: 'Appointment', kind: 'appointment', recurrence: 'none', status: 'active', starts_at: zonedTimeToUtc(dayAfter, '18:50', TZ).toISOString(), ends_at: zonedTimeToUtc(dayAfter, '19:30', TZ).toISOString(), is_protected: true, source: 'student' }).select('id').single()
    if (one.error) throw new Error('commitment fixture failed: ' + one.error.message)
    await miss('src-c')
    const cc = await redis.redistributeMissedTask(st.id, 'src-c')
    check('a fixed commitment limits the extension to the gap before it (30 → 50)', cc.applied && (await dur('c-target')) === 50, `${await dur('c-target')} ${cc.message}`)
    await redis.reverseRedistribution(st.id, 'src-c')
    await admin.from('calendar_commitments').delete().eq('id', one.data!.id).eq('user_id', st.id)
    await admin.from('plan_blocks').update({ execution: 'deferred' }).eq('id', 'src-c').eq('user_id', st.id)
    const noClash = await redis.redistributeMissedTask(st.id, 'src-c')
    check('once the commitment is gone the same sitting may grow to the sitting limit (30 → 60)', noClash.applied && (await dur('c-target')) === 60, `${await dur('c-target')}`)

    await admin.from('plan_blocks').insert([row('w-target', { ...timed('20:30', add(today, 3)), duration_minutes: 30, lm_id: 'r033' }), row('src-w', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 30, lm_id: 'r033' })])
    await miss('src-w')
    const w = await redis.redistributeMissedTask(st.id, 'src-w')
    check('a sitting ending at its study window’s end (21:00) cannot grow past it', !w.applied && (await dur('w-target')) === 30 && /no free study time|nothing moved/i.test(w.message), w.message)

    await admin.from('availability_windows').insert({ user_id: st.id, weekday: new Date(`${add(today, 4)}T12:00:00Z`).getUTCDay(), start_time: '22:00', end_time: '23:59', status: 'active', source: 'student' })
    await admin.from('plan_blocks').insert([row('m-target', { ...timed('23:30', add(today, 4)), duration_minutes: 15, lm_id: 'r034' }), row('src-m', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 40, lm_id: 'r034' })])
    await miss('src-m')
    const mid = await redis.redistributeMissedTask(st.id, 'src-m')
    check('near midnight a sitting stops at the window end, never crossing into the next day (23:30–23:45 → at most 23:59)', (await dur('m-target')) <= 29 && (await dur('m-target')) >= 15, `${await dur('m-target')}`)
    void mid

    console.log('\n4. Competing missed tasks and insufficient space')
    await admin.from('plan_blocks').insert([row('k-target', { duration_minutes: 40, lm_id: 'r035' }), row('src-k1', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 15, lm_id: 'r035' }), row('src-k2', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 15, lm_id: 'r035' })])
    await miss('src-k1'); await miss('src-k2')
    const [k1, k2] = [await redis.redistributeMissedTask(st.id, 'src-k1'), await redis.redistributeMissedTask(st.id, 'src-k2')]
    check('two missed tasks competing for one session share its 20 spare minutes (60 limit): 15 + 5, never more', (await dur('k-target')) === 60 && k1.placed === 15 && k2.placed === 5 && k2.unplaced === 10, `${await dur('k-target')} ${k1.placed}/${k2.placed}`)

    console.log('\n5. Stale plan, concurrency, overlap defence, Undo after a change')
    await admin.from('plan_blocks').insert([row('s-target', { local_date: add(today, 4), day: add(today, 4), duration_minutes: 30, lm_id: 'r036' }), row('src-s', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 20, lm_id: 'r036' })])
    await miss('src-s')
    const oldHash = await hashNow()
    await admin.from('availability_windows').insert({ user_id: st.id, weekday: 1, start_time: '07:00', end_time: '08:00', status: 'active', source: 'student' })
    const stale = await admin.rpc('apply_redistribution', { p_user: st.id, p_source: 'src-s', p_changes: [{ task_id: 's-target', expected_revision: 1, add_minutes: 10 }], p_input_hash: oldHash })
    check('a plan made before an availability edit is refused as stale by the commit', !!stale.error && /STALE/.test(stale.error.message) && (await dur('s-target')) === 30, stale.error?.message)
    const racers = await Promise.all([1, 2, 3].map(() => redis.redistributeMissedTask(st.id, 'src-s')))
    check('three concurrent retries produce one absorption and one receipt', (await dur('s-target')) === 50 && ((await admin.from('redistribution_receipts').select('id').eq('source_task_id', 'src-s').is('reversed_at', null)).data ?? []).length === 1 && racers.some(r => r.applied), `${await dur('s-target')}`)
    await admin.from('plan_blocks').insert([row('o-a', { ...timed('18:00', add(today, 3)), duration_minutes: 30, lm_id: 'r037' }), row('o-b', { ...timed('18:40', add(today, 3)), duration_minutes: 30, lm_id: 'r038' }), row('src-o', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 30, lm_id: 'r039' })])
    await miss('src-o')
    const direct = await admin.rpc('apply_redistribution', { p_user: st.id, p_source: 'src-o', p_changes: [{ task_id: 'o-a', expected_revision: (await admin.from('plan_blocks').select('revision').eq('id', 'o-a').single()).data!.revision, add_minutes: 30 }], p_input_hash: await hashNow() })
    check('even a caller that skips the planner cannot overlap two timed tasks: the commit refuses', !!direct.error && /OVERLAP/.test(direct.error.message) && (await dur('o-a')) === 30, direct.error?.message)
    await admin.from('plan_blocks').update({ duration_minutes: 41, duration: '41' }).eq('id', 'k-target')
    const undo = await redis.reverseRedistribution(st.id, 'src-k1')
    check('Undo after the receiving session changed keeps its minutes and says so', /stays because those sessions changed/.test(undo.message ?? '') && (await dur('k-target')) === 41, undo.message ?? '')

    console.log('\n6. A moved or skipped occurrence of a weekly class')
    await admin.from('planning_cycles').update({ ends_at_local: add(today, 6) }).eq('id', cyc)
    const d5 = add(today, 5), dow5 = new Date(`${d5}T12:00:00Z`).getUTCDay()
    const series = await admin.from('calendar_commitments').insert({ user_id: st.id, label: 'Weekly class', kind: 'class', recurrence: 'weekly', weekdays: [dow5], start_time: '19:00', end_time: '20:00', starts_at: zonedTimeToUtc(add(today, -30), '19:00', TZ).toISOString(), ends_at: zonedTimeToUtc(add(today, -30), '20:00', TZ).toISOString(), status: 'active', is_protected: true, source: 'student' }).select('id').single()
    if (series.error) throw new Error('class fixture failed: ' + series.error.message)
    await admin.from('plan_blocks').insert([row('x-target', { ...timed('18:00', d5), duration_minutes: 30, lm_id: 'r040' }), row('src-x', { local_date: add(today, -1), day: add(today, -1), duration_minutes: 30, lm_id: 'r040' })])
    await miss('src-x')
    const ex = await admin.from('commitment_exceptions').insert({ user_id: st.id, commitment_id: series.data!.id, occurrence_date: d5, kind: 'moved', new_date: d5, new_start_time: '18:45', new_end_time: '19:30' })
    if (ex.error) throw new Error('exception fixture failed: ' + ex.error.message)
    const moved = await redis.redistributeMissedTask(st.id, 'src-x')
    check('a class moved earlier (19:00 → 18:45) limits the extension to its NEW start (30 → 45), not the old one', moved.applied && (await dur('x-target')) === 45, `${await dur('x-target')} ${moved.message}`)
    await redis.reverseRedistribution(st.id, 'src-x')
    await admin.from('commitment_exceptions').delete().eq('commitment_id', series.data!.id).eq('user_id', st.id)
    await admin.from('commitment_exceptions').insert({ user_id: st.id, commitment_id: series.data!.id, occurrence_date: d5, kind: 'skipped' })
    await admin.from('plan_blocks').update({ execution: 'deferred' }).eq('id', 'src-x').eq('user_id', st.id)
    const skipped = await redis.redistributeMissedTask(st.id, 'src-x')
    check('a skipped occurrence no longer occupies that time: the sitting grows to the sitting limit (60)', skipped.applied && (await dur('x-target')) === 60, `${await dur('x-target')}`)
    await admin.from('commitment_exceptions').delete().eq('commitment_id', series.data!.id).eq('user_id', st.id)
    await admin.from('calendar_commitments').delete().eq('id', series.data!.id).eq('user_id', st.id)
    await admin.from('plan_blocks').delete().in('id', ids).eq('user_id', st.id)
    await admin.from('redistribution_receipts').delete().in('source_task_id', ids).eq('user_id', st.id)
    void tomorrow
  } finally {
    let removed = true
    for (const id of made.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) { removed = false; console.error('could not delete student', id, r.error.message) } }
    check('the throwaway student was removed by recorded id', removed)
  }
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
