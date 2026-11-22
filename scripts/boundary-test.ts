/**
 * Study-week boundaries against the real schema with an INJECTED clock. No server and no client-controlled time:
 * `getStudyWeekContext(userId, now)` takes its clock from the caller, so each case fixes the instant and builds its own fixture.
 * Ordinary throwaway students (no role), all deleted afterwards. Pure clock cases live in first-cycle-test.ts.
 *
 *   npx tsx scripts/boundary-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getStudyWeekContext } from '../src/lib/planning/schedule'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const made: string[] = []
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const TZ = 'Europe/London'

async function student(tag: string, o: { prep?: 'self_study' | 'instructor_led'; windows?: boolean } = {}) {
  const { data } = await admin.auth.admin.createUser({ email: `integ+${tag}${Date.now()}@example.com`, email_confirm: true })
  const id = data.user!.id
  made.push(id)
  const { error } = await admin.from('profiles').upsert({ id, onboarding_status: 'complete', timezone: TZ, prep_mode: o.prep ?? 'self_study' })
  if (error) throw new Error(`profile: ${error.message}`)
  if (o.windows !== false) {
    const { error: e2 } = await admin.from('availability_windows').insert([1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: id, weekday, start_time: '18:00', end_time: '21:00', source: 'onboarding', status: 'active' })))
    if (e2) throw new Error(`windows: ${e2.message}`)
  }
  return id
}
const cycle = async (uid: string, start: string, end: string, status = 'active') => {
  const { error } = await admin.from('planning_cycles').insert({ user_id: uid, status, starts_at: `${start}T00:00:00Z`, ends_at: `${end}T23:59:59Z`, starts_at_local: start, ends_at_local: end, timezone: TZ, anchor_day: new Date(`${end}T12:00:00Z`).getUTCDay() })
  if (error) throw new Error(`cycle: ${error.message}`)
}
const ctx = (uid: string, iso: string) => getStudyWeekContext(uid, new Date(iso))

async function main() {
  console.log('\nSunday evening, a student who has never had a cycle')
  const sun = await student('bSun')
  const a = await ctx(sun, '2026-11-01T20:00:00Z') // Sun 1 Nov, 20:00 London
  check('the first cycle is the upcoming Monday–Sunday week', a.week.startDate === '2026-11-02' && a.week.endDate === '2026-11-08', JSON.stringify(a.week))
  check('and the decision says why', a.initialCycle?.advanced === true && a.initialCycle.reason === 'no_study_day_left')

  console.log('\nMonday entry')
  const mon = await student('bMon')
  const b = await ctx(mon, '2026-11-02T08:00:00Z')
  check('Monday morning uses the current week, unmoved', b.week.startDate === '2026-11-02' && b.week.endDate === '2026-11-08' && b.initialCycle?.advanced === false, JSON.stringify(b.initialCycle))

  console.log('\nTuesday with an upcoming variable class')
  const tue = await student('bTue', { prep: 'instructor_led' })
  const ins0 = await admin.from('calendar_commitments').insert({ user_id: tue, label: 'Class', kind: 'class', recurrence: 'none', status: 'active', defines_cycle: true, starts_at: '2026-11-07T18:00:00Z', ends_at: '2026-11-07T20:00:00Z' })
  if (ins0.error) throw new Error(`class: ${ins0.error.message}`)
  const c = await ctx(tue, '2026-11-03T10:00:00Z')
  check('the week ends the day before the confirmed class and is class-led', c.week.endDate === '2026-11-06' && c.classLed === true, JSON.stringify(c.week))
  const stale = await ctx(tue, '2026-11-08T10:00:00Z') // the class is now in the past for THIS clock, so it no longer anchors
  check('with the clock after the class, the anchor is gone (the injected clock, not the real one, decides)', stale.week.endDate !== '2026-11-06' && stale.classLed === false, JSON.stringify(stale.week))

  console.log('\nA recurring class-led cycle')
  const cl = await student('bCls', { prep: 'instructor_led' })
  const ins = await admin.from('calendar_commitments').insert({ user_id: cl, label: 'Class', kind: 'class', recurrence: 'weekly', status: 'active', weekdays: [2, 4], start_time: '18:00', end_time: '20:00', starts_on: '2026-09-01', starts_at: '2026-09-01T18:00:00Z', ends_at: '2026-09-01T20:00:00Z' })
  if (ins.error) throw new Error(`class: ${ins.error.message}`)
  const d = await ctx(cl, '2026-11-03T10:00:00Z') // Tue 3 Nov
  check('the cycle is defined by the class pattern (Tue/Thu: Tuesday to Monday) and is class-led', d.classLed === true && d.week.startDate === '2026-11-03' && d.week.endDate === '2026-11-09', JSON.stringify(d.week))

  console.log('\nAn accepted EMPTY cycle is never moved')
  const emp = await student('bEmpty')
  await cycle(emp, '2026-10-26', '2026-11-01')
  const e = await ctx(emp, '2026-11-01T20:00:00Z') // same Sunday evening that moves a student with no cycle
  check('the accepted cycle stays the current one even though it has no tasks and no time is left', e.week.startDate === '2026-10-26' && e.week.endDate === '2026-11-01' && e.initialCycle === null, JSON.stringify({ w: e.week, i: e.initialCycle }))

  console.log('\nA cycle accepted on Sunday evening that starts tomorrow')
  const acc = await student('bAcc')
  await cycle(acc, '2026-11-02', '2026-11-08')
  const f = await ctx(acc, '2026-11-01T20:00:00Z')
  check('the accepted Monday–Sunday cycle is the current plan', f.week.startDate === '2026-11-02' && f.week.endDate === '2026-11-08' && f.initialCycle === null, JSON.stringify(f.week))

  console.log('\nAccepted dates survive a changed class pattern and an ended week')
  const changed = await student('bChanged', { prep: 'instructor_led' })
  await cycle(changed, '2026-11-04', '2026-11-10')
  await admin.from('profiles').update({ class_pattern: 'variable' }).eq('id', changed)
  const unchanged = await ctx(changed, '2026-11-05T10:00:00Z')
  check('removing the recurring pattern keeps the accepted Wednesday–Tuesday cycle', unchanged.week.startDate === '2026-11-04' && unchanged.week.endDate === '2026-11-10' && unchanged.classLed)
  const ended = await ctx(changed, '2026-11-12T10:00:00Z')
  check('an ended active cycle stays available for review instead of becoming a new unplanned week', ended.week.startDate === '2026-11-04' && ended.week.endDate === '2026-11-10')

  console.log('\nNo availability')
  const none = await student('bNone', { windows: false })
  const g = await ctx(none, '2026-11-01T20:00:00Z')
  check('Sunday evening with no windows still lands on the upcoming week (nothing is invented)', g.week.startDate === '2026-11-02' && g.initialCycle?.reason === 'no_availability')
  const g2 = await ctx(none, '2026-11-04T10:00:00Z') // Wed
  check('midweek with no windows keeps the current week rather than searching further', g2.week.startDate === '2026-11-02' && g2.initialCycle?.advanced === false && g2.initialCycle.reason === 'no_availability')
}

main().catch(e => { console.error(e); failed++ }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})
