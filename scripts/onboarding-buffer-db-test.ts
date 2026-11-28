/**
 * The first-week review buffer, draft reuse and acceptance, against the isolated local stack with an INJECTED planning clock. Owned students, deleted by id.
 *   (set -a; . /tmp/claude-501/stack/run/stack.env; set +a; npx tsx scripts/onboarding-buffer-db-test.ts)
 * Planning cases pass their own instant to the draft service. Acceptance cases call the real command as the student, which reads the database clock.
 */
import { createClient } from '@supabase/supabase-js'
import { addDays, todayInZone, utcToZonedParts, weekdayOf, zonedTimeToUtc } from '../src/lib/planning/studyWeek'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
if (process.env.LOCAL_STACK !== '1' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(new globalThis.URL(URL).origin)) throw new Error('Local stack only: source its stack.env.')
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
type Win = { weekday: number; startTime: string; endTime: string }
type Task = { id: string; scheduled_date: string; duration_minutes: number; metadata: Record<string, unknown> }
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
/** A fixed-offset zone where it is about 10:00 now, for the cases that meet the database clock. */
const midMorning = () => { let o = 10 - new Date().getUTCHours(); if (o > 14) o -= 24; if (o < -12) o += 24; return o === 0 ? 'Etc/GMT' : `Etc/GMT${o > 0 ? '-' : '+'}${Math.abs(o)}` }
/** A Wednesday at least a week ahead: planning cases are independent of the day the suite runs. */
const wednesday = (() => { let d = addDays(new Date().toISOString().slice(0, 10), 7); while (weekdayOf(d) !== 3) d = addDays(d, 1); return d })()
const ZONE = 'Europe/London'
const at = (date: string, hhmm: string, zone = ZONE) => zonedTimeToUtc(date, hhmm, zone)

async function main() {
  const { saveExam, saveRoute, savePosition, saveWeek } = await import('../src/lib/onboarding/service')
  const { generatePreview } = await import('../src/lib/onboarding/previewService')
  const drafts = await import('../src/lib/planning/activation/draftService')
  const owned: string[] = []
  const student = async (zone: string, windows: Win[], max: 20 | 45 = 20) => {
    const email = `integ+buf${Date.now()}${owned.length}@example.com`, password = `Pw-${crypto.randomUUID()}`
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    const id = made.data.user!.id; owned.push(id)
    await admin.from('profiles').upsert({ id, onboarding_status: 'not_started' }).throwOnError()
    const { data: w } = await admin.from('exam_windows').select('id').eq('year', 2027).order('window_opens', { ascending: false }).limit(1).single()
    await saveExam(id, { examWindowId: w!.id, registered: false, examDate: null, timezone: zone })
    await saveRoute(id, { prepMode: 'self_study', classPattern: 'none', recurringClasses: [], nextClass: null })
    await savePosition(id, { stage: 'starting_fresh', topicExposure: {} })
    await saveWeek(id, { availabilityMode: 'windows', windows, commitments: [], maxSessionMinutes: max })
    const me = createClient(URL, ANON, { auth: { persistSession: false } })
    await me.auth.signInWithPassword({ email, password })
    const draft = async (draftId: string) => (await admin.from('plan_drafts').select('status, revision, cycle_start_date, cycle_end_date, draft_json').eq('id', draftId).single().throwOnError()).data!
    const accept = async (draftId: string) => me.rpc('accept_onboarding_preview', { p_draft_id: draftId, p_expected_revision: (await draft(draftId)).revision })
    const blocks = async () => (await admin.from('plan_blocks').select('id').eq('user_id', id).throwOnError()).data!.length
    return { id, me, draft, accept, blocks }
  }
  const plan = async (s: { id: string; draft: (d: string) => Promise<any> }, now: Date) => {
    // generatePreview on its own: retire any ready draft first, as the draft service does before it generates.
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('user_id', s.id).eq('status', 'ready').throwOnError()
    const r = await generatePreview(s.id, { now })
    const d = await s.draft(r.draftId)
    const tasks = d.draft_json.tasks as Task[]
    return { ...d, draftId: r.draftId, tasks, on: (date: string) => tasks.filter(t => t.scheduled_date === date).reduce((n, t) => n + t.duration_minutes, 0) }
  }
  const monday = addDays(wednesday, -2), nextMonday = addDays(monday, 7)
  try {
    console.log(`\nSelection with 15 minutes kept for review (planning instant on Wednesday ${wednesday})`)
    const only = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '21:00' }])
    for (const left of [1, 10, 14, 15, 29]) {
      const p = await plan(only, at(wednesday, clock(21 * 60 - left)))
      check(`${left} min left in the only window: today is not planned, the next week is offered`, p.cycle_start_date === nextMonday && p.on(wednesday) === 0 && p.on(addDays(wednesday, 7)) >= 15, JSON.stringify({ week: p.cycle_start_date, today: p.on(wednesday) }))
    }
    const thirty = await plan(only, at(wednesday, '20:30'))
    check('30 min left: today holds exactly what fits after the buffer', thirty.cycle_start_date === monday && thirty.on(wednesday) === 15, JSON.stringify({ week: thirty.cycle_start_date, today: thirty.on(wednesday) }))
    const thirtyOne = await plan(only, at(wednesday, '20:29'))
    check('31 min left: today holds 16 min aligned to planner precision', thirtyOne.cycle_start_date === monday && thirtyOne.on(wednesday) === 16, JSON.stringify({ week: thirtyOne.cycle_start_date, today: thirtyOne.on(wednesday) }))
    const elapsed = await plan(only, at(wednesday, '21:05'))
    check('the last window elapsed: next week, with the reason', elapsed.cycle_start_date === nextMonday && /first plan covers/.test(elapsed.draft_json.cycle?.initialCycle?.note ?? ''))

    const fragmented = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '20:00' }])
    await admin.from('calendar_commitments').insert([
      { user_id: fragmented.id, label: 'Gap 1 blocker', kind: 'work', recurrence: 'none', starts_at: at(wednesday, '19:14').toISOString(), ends_at: at(wednesday, '19:30').toISOString(), is_protected: true, status: 'active', source: 'student' },
      { user_id: fragmented.id, label: 'Gap 2 blocker', kind: 'work', recurrence: 'none', starts_at: at(wednesday, '19:44').toISOString(), ends_at: at(wednesday, '20:00').toISOString(), is_protected: true, status: 'active', source: 'student' },
    ]).throwOnError()
    const sub15 = await plan(fragmented, at(wednesday, '18:45'))
    check('multiple sub-15-minute gaps after buffer: today stays empty and advances to next week', sub15.cycle_start_date === nextMonday && sub15.on(wednesday) === 0 && sub15.on(addDays(wednesday, 7)) >= 15, JSON.stringify({ week: sub15.cycle_start_date, today: sub15.on(wednesday) }))

    const capped = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '21:00' }], 20)
    const cappedPlan = await plan(capped, at(wednesday, '18:00'))
    const cappedTodayTasks = cappedPlan.tasks.filter(t => t.scheduled_date === wednesday)
    check('sitting limits: today tasks respect maxSessionMinutes=20', cappedTodayTasks.length > 0 && cappedTodayTasks.every(t => t.duration_minutes <= 20), JSON.stringify(cappedTodayTasks.map(t => t.duration_minutes)))

    const classStudent = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '21:00' }, { weekday: 4, startTime: '18:00', endTime: '20:00' }])
    await saveRoute(classStudent.id, { prepMode: 'hybrid', classPattern: 'fixed', recurringClasses: [{ label: 'Class', weekdays: [3], startTime: '18:00', endTime: '19:00' }], nextClass: null })
    const classPlan = await plan(classStudent, at(wednesday, '19:10'))
    check('class-led boundary: cycle starts on class day Wednesday and closes Tuesday before next class', classPlan.draft_json.cycle?.classLed === true && classPlan.cycle_start_date === wednesday && classPlan.cycle_end_date === addDays(wednesday, 6) && classPlan.draft_json.cycle?.closingDay === 2, JSON.stringify({ start: classPlan.cycle_start_date, end: classPlan.cycle_end_date, classLed: classPlan.draft_json.cycle?.classLed, closingDay: classPlan.draft_json.cycle?.closingDay }))

    const ny = await student('America/New_York', [{ weekday: 3, startTime: '20:00', endTime: '23:00' }])
    const nyRollover = await plan(ny, new Date(`${addDays(wednesday, 1)}T01:00:00Z`)) // 20:00 EST on Wednesday while UTC is already Thursday
    check('student-local date rollover: UTC Thursday 01:00 plans on local Wednesday', nyRollover.cycle_start_date === monday && nyRollover.on(wednesday) >= 15 && nyRollover.draft_json.cycle?.timezone === 'America/New_York', JSON.stringify({ week: nyRollover.cycle_start_date, wed: nyRollover.on(wednesday) }))

    const { data: wPre } = await admin.from('exam_windows').select('id, window_opens').eq('year', 2027).order('window_opens', { ascending: false }).limit(1).single()
    const examDay = wPre!.window_opens as string
    const preExam = await student(ZONE, [{ weekday: weekdayOf(examDay), startTime: '18:00', endTime: '19:00' }])
    await saveExam(preExam.id, { examWindowId: wPre!.id, registered: true, examDate: examDay, timezone: ZONE })
    const noTimeExam = await plan(preExam, at(examDay, '18:45'))
    check('no viable time before exam: stays in current cycle with 0 tasks and reason', noTimeExam.tasks.length === 0 && /no study/i.test(noTimeExam.draft_json.cycle?.initialCycle?.note ?? ''), JSON.stringify(noTimeExam.draft_json.cycle))

    const later = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '21:00' }, { weekday: 4, startTime: '18:00', endTime: '19:00' }])
    const tonight = await plan(later, at(wednesday, '20:50'))
    check('10 min tonight with room tomorrow: the current week stays, tonight is left empty', tonight.cycle_start_date === monday && tonight.on(wednesday) === 0 && tonight.on(addDays(wednesday, 1)) >= 15)
    check('the draft says review time was kept clear', /15 minutes/.test(tonight.draft_json.cycle?.reviewNote ?? ''), JSON.stringify(tonight.draft_json.cycle))

    const none = await student(ZONE, [{ weekday: 0, startTime: '10:00', endTime: '11:00' }])
    const empty = await plan(none, at(wednesday, '09:00'))
    check('no study day with room in either week: an empty plan that says so, not a search further ahead', empty.cycle_start_date === monday && empty.tasks.length === 0 && /no study windows|no study/i.test(empty.draft_json.cycle?.initialCycle?.note ?? ''), JSON.stringify(empty.draft_json.cycle))

    const night = await student(ZONE, [{ weekday: 3, startTime: '22:00', endTime: '23:59' }, { weekday: 4, startTime: '00:00', endTime: '02:00' }])
    const midnight = await plan(night, at(wednesday, '23:50'))
    check('a buffer that crosses midnight leaves today empty and plans tomorrow, on the actual date', midnight.cycle_start_date === monday && midnight.on(wednesday) === 0 && midnight.on(addDays(wednesday, 1)) >= 15 && midnight.draft_json.cycle?.timezone === ZONE)

    const slow = await plan(later, at(wednesday, '12:00'))
    check('every task of a draft falls inside the week it is labelled with', slow.tasks.length > 0 && slow.tasks.every(t => t.scheduled_date >= slow.cycle_start_date && t.scheduled_date <= slow.cycle_end_date) && slow.draft_json.cycle?.start === slow.cycle_start_date)

    console.log('\nReuse and replacement')
    const reuse = await student(ZONE, [{ weekday: 3, startTime: '18:00', endTime: '21:00' }, { weekday: 4, startTime: '18:00', endTime: '19:00' }])
    const ask = async (hhmm: string) => drafts.getOrCreateReadyDraft(reuse.id, { now: at(wednesday, hhmm) })
    const a = await ask('20:00'), b = await ask('20:01'), c = await ask('20:20')
    check('inside the review window the same draft is returned', a.draftId === b.draftId)
    check('after the window, a draft that no longer has review time left is replaced and retired', c.draftId !== a.draftId && (await reuse.draft(a.draftId)).status === 'superseded', JSON.stringify([a.draftId === c.draftId, (await reuse.draft(a.draftId)).status]))

    console.log('\nAcceptance against the database clock')
    const zone = midMorning(), today = todayInZone(zone)
    const nowMin = () => { const t = utcToZonedParts(new Date(), zone).time; return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) }
    const everyDay = (start: string, end: string): Win[] => [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: start, endTime: end }))
    const roomy = await student(zone, everyDay('00:00', '23:59'), 45)
    const old = await plan(roomy, new Date(Date.now() - 20 * 60_000))
    const kept = await roomy.accept(old.draftId)
    check('a draft prepared 20 minutes ago that still fits is accepted', !kept.error, kept.error?.message)

    const tight = await student(zone, [{ weekday: weekdayOf(today), startTime: '00:00', endTime: clock(nowMin() + 5) }])
    const gone = await plan(tight, new Date(Date.now() - 40 * 60_000))
    const refused = await tight.accept(gone.draftId)
    check('a draft whose time has passed is refused and writes nothing', gone.on(today) >= 15 && /STALE_PREVIEW.*no longer fit/.test(refused.error?.message ?? '') && (await tight.blocks()) === 0, refused.error?.message)

    const paper = await student(zone, everyDay('00:00', '23:59'), 45)
    const withPaper = await plan(paper, new Date())
    const past = { ...withPaper.tasks[0], id: crypto.randomUUID(), metadata: { ...withPaper.tasks[0].metadata, task_type: 'diagnostic', placement: 'timed', starts_at: new Date(Date.now() - 3_600_000).toISOString(), split_group: '', split_after: '' }, scheduled_date: today }
    await admin.from('plan_drafts').update({ draft_json: { ...withPaper.draft_json, tasks: [...withPaper.tasks, past] } }).eq('id', withPaper.draftId).throwOnError()
    const late = await paper.accept(withPaper.draftId)
    check('a timed paper whose start has passed is refused, nothing written', /STALE_PREVIEW/.test(late.error?.message ?? '') && (await paper.blocks()) === 0, late.error?.message ?? `accepted, ${await paper.blocks()} rows`)

    const twice = await student(zone, everyDay('00:00', '23:59'), 45)
    const first = await plan(twice, new Date())
    await twice.accept(first.draftId).then(r => { if (r.error) throw new Error(r.error.message) })
    const count = await twice.blocks()
    const replay = await twice.me.rpc('accept_onboarding_preview', { p_draft_id: first.draftId, p_expected_revision: 1 })
    check('a replay returns the original acceptance', !replay.error && (await twice.blocks()) === count, replay.error?.message)
    const again = await drafts.getOrCreateReadyDraft(twice.id, { now: new Date(Date.now() + 1000) })
    const doubled = await twice.accept(again.draftId)
    check('a newer draft cannot be accepted over the accepted week: no second copy', /ALREADY_ACCEPTED/.test(doubled.error?.message ?? '') && (await twice.blocks()) === count, doubled.error?.message ?? `accepted: ${count} → ${await twice.blocks()} rows`)

    console.log('\nSupersession under contention')
    const race = await student(zone, everyDay('00:00', '23:59'), 45)
    const held = await plan(race, new Date())
    const supersede = (drafts as any).supersedeOtherReady
    if (!supersede) check('an acceptance that lands during supersession keeps its receipt', false, 'supersession cannot be paused: not exposed')
    else {
      await supersede(race.id, 'some-newer-fingerprint', { afterRead: async () => { const r = await race.accept(held.draftId); if (r.error) throw new Error(r.error.message) } })
      const after = await race.draft(held.draftId)
      const roadmaps = (await admin.from('study_roadmaps').select('status').eq('user_id', race.id).eq('status', 'active').throwOnError()).data!
      check('an acceptance that lands during supersession keeps its receipt', after.status === 'accepted' && roadmaps.length === 1, `${after.status}, ${roadmaps.length} active roadmap(s)`)
    }

    console.log('\nActivation recovery')
    const rec = await student(zone, everyDay('00:00', '23:59'), 45)
    const broken = await plan(rec, new Date())
    await admin.from('plan_drafts').update({ status: 'failed' }).eq('id', broken.draftId).throwOnError()
    const recovered = await drafts.getOrCreateReadyDraft(rec.id, { now: new Date() })
    const recAccept = await rec.accept(recovered.draftId)
    check('activation recovery replaces a failed draft and accepts cleanly once', recovered.draftId !== broken.draftId && !recAccept.error && (await rec.blocks()) > 0, recAccept.error?.message)
  } catch (e) { failed++; console.log(`  ✗ stopped: ${(e as Error).message}`) } finally {
    for (const id of owned) { const { error } = await admin.auth.admin.deleteUser(id); if (error) console.log(`  cleanup failed for ${id}: ${error.message}`) }
    console.log(`  removed ${owned.length} owned students`)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error(e); process.exit(1) })
