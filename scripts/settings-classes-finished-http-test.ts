/**
 * "My classes have finished" and undo, on a class-led throwaway student (Tue/Thu evening classes): a reviewable effective-date change.
 *   E2E_BASE_URL=http://localhost:3141 npx tsx scripts/settings-classes-finished-http-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'; dotenv.config({ path: '.env.local', quiet: true } as any)
import ICAL from 'ical.js'
import { createStudent, preflightServer, makeCheck, classLedPersona } from './lib/e2eSession'
import { addDays, todayInZone } from '../src/lib/planning/studyWeek'
import { getStudyWeekContext } from '../src/lib/planning/schedule'

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const { check, finish } = makeCheck()
const owned: string[] = []
const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

;(async () => {
  await preflightServer()
  try {
    const persona = await classLedPersona(admin)
    const S = await createStudent(admin, 'cf', { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
    const tz = 'Europe/London', today = todayInZone(tz)
    const series = async () => (await admin.from('calendar_commitments').select('id, weekdays, ends_on, status, ended_by_completion, ends_on_before_completion').eq('user_id', S.id).eq('kind', 'class').order('id')).data ?? []
    const cIns = await admin.from('calendar_commitments').insert({ user_id: S.id, label: 'Old archived class', kind: 'class', recurrence: 'weekly', weekdays: [5], start_time: '18:00', end_time: '19:00', starts_on: '2026-01-01', status: 'archived', is_protected: true, starts_at: '2026-01-01T18:00:00Z', ends_at: '2026-01-01T19:00:00Z' }).select('id').single(); if (cIns.error) throw new Error('cancelled series fixture: ' + cIns.error.message); const cancelled = cIns.data!
    const cycleBefore = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data!
    const blocksBefore = (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count
    const s0 = (await series()).filter(r => r.status === 'active')
    const ctx0 = await getStudyWeekContext(S.id, addDays(today, 10))
    check('before: two active weekly class series end 2027-01-01 and the cycle is class-anchored (Tuesday to Monday)', s0.length === 2 && s0.every(r => r.ends_on === '2027-01-01') && ctx0.classLed === true && wd(ctx0.week.startDate) === 2)

    const done = await S.s.post('/api/profile/classes-completed', { done: true })
    const s1 = (await series()).filter(r => r.status === 'active')
    check('marking finished ends BOTH active series on the effective date (today), remembering their previous end, in one command', done.body.ok === true && done.body.seriesEnded === 2 && s1.every(r => r.ends_on === today && r.ended_by_completion && r.ends_on_before_completion === '2027-01-01'), JSON.stringify(done.body))
    check('the profile date and the roadmap input agree with it', (await admin.from('profiles').select('classes_completed_at').eq('id', S.id).single()).data!.classes_completed_at === today)
    check('the accepted current cycle, its tasks and the class series rows are untouched (nothing deleted, nothing rewritten)', JSON.stringify((await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data) === JSON.stringify(cycleBefore) && (await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count === blocksBefore && (await series()).length === 3)
    const ctx1 = await getStudyWeekContext(S.id, addDays(today, 10))
    check('prospective cycles are no longer class-anchored: a week after the effective date runs the self-study Monday–Sunday boundary', ctx1.classLed === false && wd(ctx1.week.startDate) === 1, JSON.stringify([ctx1.classLed, ctx1.week.startDate]))
    const again = await S.s.post('/api/profile/classes-completed', { done: true })
    check('repeating the command is idempotent (no series re-ended, previous ends not overwritten)', again.body.seriesEnded === 0 && (await series()).filter(r => r.status === 'active').every(r => r.ends_on_before_completion === '2027-01-01'))
    const ics = async (q: string) => { const r = await S.s.req(`/api/calendar/export?classes=1&${q}`); return new ICAL.Component(ICAL.parse(await r.text())).getAllSubcomponents('vevent').filter((e: any) => /class|Class/.test(String(e.getFirstPropertyValue('summary')))) }
    const future = await ics(`from=${addDays(today, 3)}&to=${addDays(today, 17)}`)
    check('the calendar export has no class occurrences after the effective date', future.length === 0, String(future.length))

    const undo = await S.s.post('/api/profile/classes-completed', { done: false })
    const s2 = await series()
    check('undo restores exactly the series the command ended (back to 2027-01-01) and clears the date', undo.body.ok === true && undo.body.seriesRestored === 2 && s2.filter(r => r.status === 'active').every(r => r.ends_on === '2027-01-01' && !r.ended_by_completion && r.ends_on_before_completion === null) && (await admin.from('profiles').select('classes_completed_at').eq('id', S.id).single()).data!.classes_completed_at === null)
    check('undo does NOT revive an unrelated archived series', s2.find(r => r.id === cancelled.id)!.status === 'archived' && s2.find(r => r.id === cancelled.id)!.ends_on === null)
    const ctx2 = await getStudyWeekContext(S.id, addDays(today, 10))
    check('after undo prospective cycles are class-anchored again', ctx2.classLed === true && wd(ctx2.week.startDate) === 2)
    const back = await ics(`from=${addDays(today, 3)}&to=${addDays(today, 17)}`)
    check('and the export has the class occurrences again', back.length >= 2)

    // ---- composition with other edits (the 2026-11-15 acceptance pass)
    const ver = async () => Number((await admin.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version)
    const v0 = await ver()
    await S.s.post('/api/profile/classes-completed', { done: true })
    const v1 = await ver()
    check('a material class transition (series ended, date set) increments the setup version, so an editor opened before it is stale', v1 === v0 + 1, `${v0} -> ${v1}`)
    await S.s.post('/api/profile/classes-completed', { done: true })
    check('a repeat finish is a no-op and does not move the version', (await ver()) === v1)
    const stale = await S.s.post('/api/onboarding/week', { expectedVersion: v0, commitments: [], availabilityMode: 'windows', windows: [{ weekday: 1, startTime: '19:00', endTime: '20:00' }], maxSessionMinutes: 45 })
    check('an editor that read the version before the transition is refused with nothing written (409 setup_changed)', stale.status === 409 && stale.body.code === 'setup_changed', JSON.stringify(stale.body))
    // the student explicitly edits ONE series after finishing; a late undo must keep that decision
    const act = (await series()).filter(r => r.status === 'active' && r.ended_by_completion)
    await admin.from('calendar_commitments').update({ ends_on: addDays(today, 40) }).eq('id', act[0].id)
    const undo2 = await S.s.post('/api/profile/classes-completed', { done: false })
    const s3 = await series()
    check('undo keeps a series the student edited after finishing (not overwritten) and restores the untouched one', undo2.body.ok === true && s3.find(r => r.id === act[0].id)!.ends_on === addDays(today, 40) && s3.find(r => r.id === act[1].id)!.ends_on === '2027-01-01' && (undo2.body.kept ?? []).some((k: any) => k.id === act[0].id && k.reason === 'edited'), JSON.stringify(undo2.body))
    check('and nothing stays flagged as ended-by-completion afterwards', (await series()).every(r => !r.ended_by_completion))
    // a series added after finishing is ended by the next finish and restored by its undo; an archived one is never touched
    const added = await admin.from('calendar_commitments').insert({ user_id: S.id, label: 'Added later class', kind: 'class', recurrence: 'weekly', weekdays: [3], start_time: '18:00', end_time: '19:00', starts_on: '2026-01-01', ends_on: '2027-02-01', status: 'active', is_protected: true, starts_at: '2026-01-01T18:00:00Z', ends_at: '2026-01-01T19:00:00Z' }).select('id').single(); if (added.error) throw new Error('added series: ' + added.error.message)
    await S.s.post('/api/profile/classes-completed', { done: true })
    check('finishing again ends the newly added series too, and still leaves the archived one alone', (await series()).filter(r => r.ended_by_completion).some(r => r.id === added.data!.id) && (await series()).find(r => r.id === cancelled.id)!.status === 'archived')
    // restoring a class over a booked mock refuses atomically
    let tue = addDays(today, 1); while (wd(tue) !== 2) tue = addDays(tue, 1)
    const mk = await admin.from('mock_appointments').insert({ user_id: S.id, kind: 'provider_mock', planned_date: tue, start_time: '18:30', duration_minutes: 60, label: 'Booked mock', status: 'planned' }).select('id').single(); if (mk.error) throw new Error('mock fixture: ' + mk.error.message)
    const snap = async () => JSON.stringify([(await series()).map(r => [r.id, r.ends_on, r.ended_by_completion]), await ver(), (await admin.from('profiles').select('classes_completed_at').eq('id', S.id).single()).data])
    const beforeRefusal = await snap()
    const refused = await S.s.post('/api/profile/classes-completed', { done: false })
    check('undo that would put a class over a booked mock is refused (409 UNDO_CONFLICT) with a Calendar review action and NOTHING changed', refused.status === 409 && refused.body.code === 'UNDO_CONFLICT' && refused.body.conflicts?.length >= 1 && refused.body.reviewHref === '/app/calendar' && (await snap()) === beforeRefusal, JSON.stringify(refused.body))
    await admin.from('mock_appointments').delete().eq('id', mk.data!.id)
    const okAfter = await S.s.post('/api/profile/classes-completed', { done: false })
    check('after the mock is moved away the same undo succeeds', okAfter.body.ok === true && okAfter.body.seriesRestored >= 2, JSON.stringify(okAfter.body))
    // concurrent finish and undo from two tabs: the end state is one of the two serial orders, never a mix
    await Promise.all([S.s.post('/api/profile/classes-completed', { done: true }), S.s.post('/api/profile/classes-completed', { done: false })])
    const fin = await series(), dateNow = (await admin.from('profiles').select('classes_completed_at').eq('id', S.id).single()).data!.classes_completed_at
    const act2 = fin.filter(r => r.status === 'active')
    check('concurrent finish + undo end in a coherent state (all ended with the date set, or all restored with it cleared)', (dateNow !== null && act2.every(r => r.ended_by_completion && r.ends_on === today)) || (dateNow === null && act2.every(r => !r.ended_by_completion)), JSON.stringify([dateNow, act2.map(r => [r.ends_on, r.ended_by_completion])]))
    const selfStudy = await createStudent(admin, 'cg', { onboard: true, register: id => owned.push(id) })
    check('a self-study student still cannot mark classes finished', (await selfStudy.s.post('/api/profile/classes-completed', { done: true })).status === 400)
  } finally {
    for (const id of owned.splice(0)) { const r = await admin.auth.admin.deleteUser(id); if (r.error) console.error('CLEANUP FAILED', id, r.error.message) }
  }
  finish()
})().catch(async e => { console.error('Crashed:', e); for (const id of owned.splice(0)) await admin.auth.admin.deleteUser(id).catch(() => {}); process.exit(1) })
