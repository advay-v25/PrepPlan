/**
 * Remaining onboarding checks against the development database, isolated throwaway students (deleted by recorded id):
 * fixed classes vs a study window, a returning student changing coverage, clearing/editing the next of several mocks, a started rehearsal.
 *   npx tsx scripts/onboarding-checks-db-test.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

let passed = 0, failed = 0
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!, ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const admin = createClient(URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const ids: string[] = []
const add = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)

async function main() {
  console.log('\nOnboarding checks (fixture)\n')
  try {
    const svc = await import('../src/lib/onboarding/service')
    const { generatePreview } = await import('../src/lib/onboarding/previewService')
    const { loadPlacementContext } = await import('../src/lib/planning/pulse/generateWeek')
    const { weekForDate } = await import('../src/lib/planning/schedule')
    const { todayInZone } = await import('../src/lib/planning/studyWeek')
    const { data: feb } = await admin.from('exam_windows').select('id').eq('year', 2027).eq('sitting', 'february').single()
    const today = todayInZone('Europe/London')

    async function onboarded(tag: string, route: any = { prepMode: 'self_study', classPattern: 'none', recurringClasses: [], nextClass: null }, week: any = null) {
      const email = `integ+${tag}${Date.now()}@example.com`, password = `Pw-${crypto.randomUUID()}`
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (!created.data.user) throw new Error('could not create the student: ' + created.error?.message)
      const uid = created.data.user.id; ids.push(uid)
      const client = createClient(URL, ANON, { auth: { persistSession: false } }); await client.auth.signInWithPassword({ email, password })
      await svc.saveExam(uid, { examWindowId: feb!.id, registered: false, timezone: 'Europe/London' })
      await svc.saveRoute(uid, route)
      await svc.savePosition(uid, { stage: 'first_pass_underway', topicExposure: {} })
      await svc.saveWeek(uid, week ?? { availabilityMode: 'windows', windows: [1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '18:00', endTime: '21:00' })), commitments: [], maxSessionMinutes: 60 })
      const p = await generatePreview(uid)
      const acc = await client.rpc('accept_onboarding_preview', { p_draft_id: p.draftId, p_expected_revision: p.revision })
      if (acc.error) throw new Error(acc.error.message)
      return { uid, client, cycleId: acc.data.cycle_id as string }
    }
    const version = async (uid: string) => ((await admin.from('profiles').select('onboarding_context_version').eq('id', uid).single()).data!.onboarding_context_version as number)
    const appts = async (uid: string) => ((await admin.from('mock_appointments').select('id, planned_date, status, kind').eq('user_id', uid).order('planned_date')).data ?? []) as any[]
    const pos = (mock: any, extra: any = {}) => ({ stage: 'first_pass_underway', topicExposure: {}, mock, ...extra })

    console.log('1. Fixed classes overlapping a study window')
    const fx = await onboarded('oc1', { prepMode: 'instructor_led', classPattern: 'fixed', recurringClasses: [{ label: 'Class', weekdays: [2], startTime: '18:00', endTime: '20:00', endsOn: null }], nextClass: null },
      { availabilityMode: 'windows', windows: [{ weekday: 2, startTime: '18:00', endTime: '21:00' }], commitments: [], maxSessionMinutes: 60 })
    const wk = await weekForDate(fx.uid, today)
    const tuesday = wk.days.find(d => new Date(`${d}T12:00:00Z`).getUTCDay() === 2)!
    const ctx = await loadPlacementContext(fx.uid, wk, new Date(`${wk.startDate}T06:00:00Z`))
    check('the saved class and the saved window both exist', ((await admin.from('calendar_commitments').select('id').eq('user_id', fx.uid).eq('kind', 'class').eq('status', 'active')).data ?? []).length >= 1 && ((await admin.from('availability_windows').select('id').eq('user_id', fx.uid).eq('status', 'active')).data ?? []).length === 1)
    check('study time on that day is the window MINUS the class (180 → 60 min), never the whole window', ctx.capacity[tuesday] === 60, `${ctx.capacity[tuesday]} min`)

    console.log('\n2. Returning student changes coverage; accepted work and history stay')
    const rt = await onboarded('oc2')
    const snap = async () => JSON.stringify({ b: (await admin.from('plan_blocks').select('id, revision, execution, local_date').eq('cycle_id', rt.cycleId).order('id')).data, c: (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', rt.uid)).data, d: (await admin.from('plan_drafts').select('id, status, accepted_cycle_id').eq('user_id', rt.uid).eq('status', 'accepted')).data })
    const before = await snap(), v0 = await version(rt.uid)
    const { data: topics } = await admin.from('topics').select('id').order('default_sequence').limit(3)
    await svc.savePosition(rt.uid, pos(null, { stage: 'revising_or_mocks', topicExposure: Object.fromEntries((topics ?? []).map(t => [t.id as string, 'recent'])), uncertainty: { [topics![0].id as string]: { level: 'several', lmIds: [] } } }))
    check('the accepted blocks, cycle and acceptance receipt are untouched', (await snap()) === before)
    check('coverage is stored as self-report', ((await admin.from('user_module_state').select('source').eq('user_id', rt.uid)).data ?? []).length > 0 && ((await admin.from('user_module_state').select('source').eq('user_id', rt.uid)).data ?? []).every(r => r.source === 'self_report'))
    const ev = async (t: string) => (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', rt.uid)).count ?? 0
    check('no evidence, attempt or scope confirmation was created', (await ev('evidence_events')) === 0 && (await ev('assessment_attempts')) === 0 && (await ev('block_scope_confirmations')) === 0)
    check('the setup version advanced once for the save', (await version(rt.uid)) === v0 + 1)

    console.log('\n3. Several mocks: edit and clear the NEXT one')
    const m = await onboarded('oc3')
    const d1 = add(today, 30), d2 = add(today, 45), d3 = add(today, 60)
    for (const d of [d1, d2, d3]) await admin.from('mock_appointments').insert({ user_id: m.uid, kind: 'provider_mock', planned_date: d })
    let a = await appts(m.uid)
    check('three planned appointments, the profile projects the earliest', a.length === 3 && (await admin.from('profiles').select('mock_date').eq('id', m.uid).single()).data!.mock_date === d1)
    const v1 = await version(m.uid)
    await svc.savePosition(m.uid, pos({ date: add(today, 33), kind: 'provider_mock' }))
    a = await appts(m.uid)
    check('editing the next mock moves only that one', a.map(x => x.planned_date).join() === [add(today, 33), d2, d3].join() && a.every(x => x.status === 'planned'), a.map(x => x.planned_date).join())
    await svc.savePosition(m.uid, pos(null))
    a = await appts(m.uid)
    check('clearing it cancels only the next appointment; the later two stay planned', a.filter(x => x.status === 'cancelled').length === 1 && a.filter(x => x.status === 'planned').map(x => x.planned_date).join() === [d2, d3].join(), JSON.stringify(a.map(x => [x.planned_date, x.status])))
    check('the profile now projects the next remaining appointment', (await admin.from('profiles').select('mock_date').eq('id', m.uid).single()).data!.mock_date === d2)
    check('each save advanced the version by one', (await version(m.uid)) === v1 + 2)

    console.log('\n4. A started rehearsal keeps its restrictions')
    const [next] = (await appts(m.uid)).filter(x => x.status === 'planned')
    await admin.from('mock_appointments').update({ kind: 'internal_rehearsal' }).eq('id', next.id)
    await admin.from('mock_rehearsals').insert({ user_id: m.uid, appointment_id: next.id, blueprint_version: 'fixture', status: 'in_progress' })
    const vr = await version(m.uid)
    let refused = ''
    try { await svc.savePosition(m.uid, pos(null)) } catch (e: any) { refused = e.message }
    check('clearing a started rehearsal from setup is refused, with a plain reason', /rehearsal has started/i.test(refused), refused)
    check('…the appointment is still planned, the rehearsal still in progress, and the version unchanged', (await appts(m.uid)).find(x => x.id === next.id)?.status === 'planned' && (await admin.from('mock_rehearsals').select('status').eq('appointment_id', next.id).single()).data!.status === 'in_progress' && (await version(m.uid)) === vr)
    await svc.savePosition(m.uid, pos({ date: add(today, 47), kind: 'provider_mock' }))
    const moved = (await appts(m.uid)).find(x => x.id === next.id)!
    check('editing its date is still allowed and it stays a rehearsal', moved.planned_date === add(today, 47) && moved.kind === 'internal_rehearsal', `${moved.planned_date} ${moved.kind}`)
    // An unstarted rehearsal is closed (not left orphaned) when its appointment is cleared from setup.
    const r = await onboarded('oc4'); await admin.from('mock_appointments').insert({ user_id: r.uid, kind: 'internal_rehearsal', planned_date: d1 })
    const ra = (await appts(r.uid))[0]; await admin.from('mock_rehearsals').insert({ user_id: r.uid, appointment_id: ra.id, blueprint_version: 'fixture', status: 'ready' })
    await svc.savePosition(r.uid, pos(null))
    check('clearing an appointment with an UNSTARTED rehearsal cancels both', (await appts(r.uid))[0].status === 'cancelled' && (await admin.from('mock_rehearsals').select('status').eq('appointment_id', ra.id).single()).data!.status === 'cancelled')
  } finally {
    let ok = true
    for (const id of ids) { const del = await admin.auth.admin.deleteUser(id); ok &&= !del.error }
    check('every throwaway student was removed by recorded id', ok)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}
main().catch(e => { console.error('FAILED:', e.stack); process.exit(1) })
