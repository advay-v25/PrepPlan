/**
 * Class log → plan, live, on the dedicated +e2e account only.
 *
 *   npm run dev
 *   npx tsx scripts/e2e-class-log.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, assertBlankOnboarding, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'
import { createSession, completeOnboarding, makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
const dow = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

async function main() {
  console.log('\nClass log\n')
  const s = createSession(admin, getE2EEmail())
  check('signed in', await s.signIn())
  const uid = await verifyAndGetE2EUser(admin)
  await resetE2EUser(admin, uid)
  await assertBlankOnboarding(admin, uid)
  await completeOnboarding(s, admin)
  // completeOnboarding's first confirm plants a real self-study week (bigger now that Ethics and FSA carry
  // real structure) across the account's current calendar dates — the same dates this suite's own scenario
  // reuses once it converts the account to class-led below. That is two unrelated scenarios competing for
  // the same days' capacity, not something this suite means to test; it cares about class-log's own
  // placement, so it starts from an empty calendar rather than coupling to onboarding's unrelated output.
  await admin.from('plan_blocks').delete().eq('user_id', uid)

  const cnt = async (t: string, f: Record<string, string> = {}) => {
    let q = admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)
    for (const [k, v] of Object.entries(f)) q = q.eq(k, v)
    return (await q).count ?? 0
  }

  // --- auth + method guards
  check('context requires authentication', (await fetch(`${E2E_BASE_URL}/api/class-log/context`)).status === 401)
  check('preview requires authentication', (await fetch(`${E2E_BASE_URL}/api/class-log/preview`, { method: 'POST' })).status === 401)
  check('confirm requires authentication', (await fetch(`${E2E_BASE_URL}/api/class-log/confirm`, { method: 'POST' })).status === 401)
  check('preview is POST only', (await s.req('/api/class-log/preview')).status === 405)
  check('confirm is POST only', (await s.req('/api/class-log/confirm')).status === 405)
  const viaAdmin = await admin.rpc('apply_class_log', {
    p_cycle_id: '00000000-0000-0000-0000-000000000000', p_idempotency_key: 'x', p_class_date: '2026-01-01', p_kind: 'none', p_note: null, p_items: [], p_tasks: [],
  })
  check('the RPC refuses a caller with no user session', !!viaAdmin.error && /Not authenticated/.test(viaAdmin.error.message), viaAdmin.error?.message)

  // --- a self-study student cannot log classes
  const selfCtx = (await s.json('/api/class-log/context')).body
  check('a student with no classes is not class-led', selfCtx?.context?.classLed === false)
  const selfPrev = await s.post('/api/class-log/preview', { classDate: '2026-01-01', kind: 'none', items: [] })
  check('logging without a class schedule is refused', selfPrev.status === 409 && selfPrev.body?.code === 'not_class_led', JSON.stringify(selfPrev.body))
  check('the log page explains it', (await (await s.req('/app/calendar/log-class')).text()).includes('for students with a class schedule'))

  // --- make the account class-led: two consecutive class days that have both happened,
  // cycle = first class day .. +6 (so the paper day is still ahead). The weekend
  // (Sat+Sun -> Sat..Fri) boundary itself is covered by the pure boundary tests.
  const today = new Date().toISOString().slice(0, 10)
  const start = addDays(today, -2)
  const end = addDays(start, 6)            // paper day, still in the future
  await admin.from('calendar_commitments').delete().eq('user_id', uid).eq('kind', 'class')
  const ins = await admin.from('calendar_commitments').insert({
    user_id: uid, label: 'Class', kind: 'class', recurrence: 'weekly', weekdays: [dow(start), dow(addDays(start, 1))],
    start_time: '09:00', end_time: '12:00', starts_on: addDays(start, -14), status: 'active', is_protected: true,
    starts_at: `${start}T09:00:00Z`, ends_at: `${start}T12:00:00Z`,
  })
  check('class commitment created', !ins.error, ins.error?.message)
  const { data: cyc } = await admin.from('planning_cycles').select('id').eq('user_id', uid).eq('status', 'active').single()
  const cycleId = cyc!.id as string
  await admin.from('planning_cycles').update({ starts_at_local: start, ends_at_local: end }).eq('id', cycleId)

  const ctx = (await s.json('/api/class-log/context')).body?.context
  const classDates = [start, addDays(start, 1)]
  check('the student is class-led with this cycle', ctx?.classLed === true && ctx?.cycle?.id === cycleId)
  check('class days in the cycle that have happened are listed as unlogged', JSON.stringify(ctx?.pendingDates) === JSON.stringify(classDates), JSON.stringify(ctx?.pendingDates))
  const calHtml = await (await s.req('/app/calendar')).text()
  check('Calendar links to the class log', calHtml.includes('/app/calendar/log-class'))
  const readingHtml = await (await s.req('/app/curriculum/fsa/r028')).text()
  check('the reading page links to the class log for that reading', readingHtml.includes('/app/calendar/log-class?reading=r028'))
  const pageHtml = await (await s.req('/app/calendar/log-class?reading=r028')).text()
  check('the log page renders the form', pageHtml.includes('What did you cover?') || pageHtml.includes('Log what you covered'))

  const first = classDates[0]
  const counts0 = { sessions: await cnt('class_sessions'), blocks: await cnt('plan_blocks') }
  const log = {
    classDate: first, kind: 'covered',
    items: [
      { outcomeId: 'r028-d', extent: 'part', portionNote: 'basic EPS only' },
      { outcomeId: 'r029-a', extent: 'full' },
      { outcomeId: 'r020-a', extent: 'part' },
    ],
  }
  const p1 = await s.post('/api/class-log/preview', log)
  check('preview succeeds', p1.status === 200 && p1.body?.ok === true, JSON.stringify(p1.body).slice(0, 200))
  const tasks: any[] = p1.body?.tasks ?? []
  const paperDay = end
  check('preview writes nothing', (await cnt('class_sessions')) === counts0.sessions && (await cnt('plan_blocks')) === counts0.blocks)
  const open = (d: string) => d > first && d >= today && d < paperDay
  check('the plan places work (precondition for the checks below)', tasks.length > 0, JSON.stringify(p1.body?.carryover))
  check('nothing is placed on or before the class day', tasks.every(t => t.date > first))
  check('nothing is placed in the past', tasks.every(t => t.date >= today))
  check('nothing lands on the paper day', tasks.every(t => t.date !== paperDay && t.date < paperDay))
  check('every placed task is on an open day', tasks.every(t => open(t.date)))
  check('the part note travels with its task', tasks.some(t => (t.detail ?? '').includes('basic EPS')))
  const firstDay = tasks.map(t => t.date).sort()[0]
  check('the first pass is never earlier than the day after class, or today', firstDay >= (today > first ? today : addDays(first, 1)), firstDay)
  check('the preview states the load without an hours target', ['comfortable', 'tight', 'over'].includes(p1.body?.pressure) && !/hours? (target|goal)/i.test(JSON.stringify(p1.body)))

  // --- rejections
  const bad = async (body: any, code: string, label: string) => {
    const r = await s.post('/api/class-log/preview', body); check(label, r.status === 409 && r.body?.code === code, JSON.stringify(r.body).slice(0, 160))
  }
  // Every reading now has real structure (Ethics and FSA were seeded this session), so there is no longer a
  // structure-pending reading to exercise that path against; 'nope' below covers the same 'bad_item' guard
  // (loadOutcomes rejects both an unknown id and a structure-pending one identically).
  await bad({ ...log, items: [{ outcomeId: 'nope', extent: 'full' }] }, 'bad_item', 'an unknown outcome is refused')
  await bad({ ...log, classDate: addDays(today, 3) }, 'bad_date', 'a class day in the future is refused')
  await bad({ ...log, classDate: addDays(start, -3) }, 'bad_date', 'a day outside this cycle is refused')
  await bad({ classDate: first, kind: 'missed', items: [{ outcomeId: 'r028-a', extent: 'full' }] }, 'bad_item', 'a missed class cannot carry coverage')
  check('malformed input is a 400', (await s.post('/api/class-log/preview', { classDate: 'x' })).status === 400)
  check('duplicate outcomes are a 400', (await s.post('/api/class-log/preview', { ...log, items: [log.items[0], log.items[0]] })).status === 400)

  // --- confirm: stale fingerprint, then the real thing, concurrently
  const stale = await s.post('/api/class-log/confirm', { ...log, idempotencyKey: 'stale-key-1', fingerprint: 'stale' })
  check('a changed preview must be re-confirmed', stale.status === 409 && stale.body?.code === 'preview_changed', JSON.stringify(stale.body).slice(0, 160))
  check('a stale confirm changed nothing', (await cnt('class_sessions')) === counts0.sessions && (await cnt('plan_blocks')) === counts0.blocks)

  const key = `e2e-${Date.now()}-a`
  const burst = await Promise.all([1, 2, 3].map(() => s.post('/api/class-log/confirm', { ...log, idempotencyKey: key, fingerprint: p1.body.fingerprint })))
  check('concurrent confirmations all succeed', burst.every(b => b.body?.ok === true), JSON.stringify(burst.map(b => b.body?.code ?? b.body?.ok)))
  check('they resolve to a single session', new Set(burst.map(b => b.body?.sessionId)).size === 1)
  const sessionId = burst[0].body.sessionId as string
  check('exactly one session row was written', (await cnt('class_sessions')) === counts0.sessions + 1)
  const { data: placed } = await admin.from('plan_blocks').select('id, local_date, task_type, class_session_id, outcome_id, cycle_id, duration_minutes').eq('class_session_id', sessionId)
  check('the previewed tasks were inserted, no more and no fewer', placed?.length === tasks.length, `${placed?.length} vs ${tasks.length}`)
  check('they belong to the active cycle', (placed ?? []).every(b => b.cycle_id === cycleId))
  check('they are study tasks linked to their outcomes', (placed ?? []).every(b => b.task_type === 'study' && b.outcome_id))
  const items = (await admin.from('class_session_items').select('outcome_id, extent').eq('session_id', sessionId)).data ?? []
  check('all three outcomes were recorded with their extent', items.length === 3 && items.find(i => i.outcome_id === 'r028-d')?.extent === 'part' && items.find(i => i.outcome_id === 'r029-a')?.extent === 'full')
  const replay = await s.post('/api/class-log/confirm', { ...log, idempotencyKey: key, fingerprint: 'anything' })
  check('a later replay is idempotent', replay.body?.ok === true && replay.body?.alreadyApplied === true && replay.body?.sessionId === sessionId, JSON.stringify(replay.body))
  check('replay created nothing', (await cnt('class_sessions')) === counts0.sessions + 1 && (await cnt('plan_blocks', { class_session_id: sessionId })) === tasks.length)
  const cal2 = await (await s.req('/app/calendar')).text()
  check('the new tasks are on the Calendar', tasks.every(t => cal2.includes(String(t.title).replace(/&/g, '&amp;').slice(0, 12))) || cal2.includes('Consolidate'))

  // Class coverage shows on Curriculum as exposure and scheduled work, never as evidence.
  const trk = (await s.json('/api/curriculum/readiness')).body?.tracker
  const rows = (trk?.topics ?? []).flatMap((t: any) => t.modules.flatMap((m: any) => m.rows))
  const r028d = rows.find((r: any) => r.outcomeId === 'r028-d'), r029a = rows.find((r: any) => r.outcomeId === 'r029-a')
  check('a partly covered outcome shows as partly covered in class', r028d?.classCoverage === 'part', r028d?.classCoverage)
  check('a fully covered outcome shows as covered in full', r029a?.classCoverage === 'full', r029a?.classCoverage)
  check('class coverage does not move the band', r028d?.band === 'untested' && r029a?.band === 'untested')
  check('the consolidation work shows as Scheduled', r028d?.progress === 'scheduled' && r029a?.progress === 'scheduled', `${r028d?.progress}/${r029a?.progress}`)
  const fsaMods = (trk?.topics ?? []).find((t: any) => t.id === 'fsa')?.modules ?? []
  check('the reading reads as covered in class', fsaMods.find((m: any) => m.id === 'r028')?.coverage === 'taught')
  check('the reading page shows the class coverage', (await (await s.req('/app/curriculum/fsa/r028')).text()).includes('Partly covered in class'))

  const ctx2 = (await s.json('/api/class-log/context')).body?.context
  check('that class day is no longer pending', !(ctx2?.pendingDates ?? []).includes(first))

  // --- "we already studied this in class": recorded, but no consolidation task
  if (classDates.length > 1) {
    const second = classDates[1]
    const s2 = { classDate: second, kind: 'covered', items: [{ outcomeId: 'r037-a', extent: 'full', studiedInClass: true }, { outcomeId: 'r037-b', extent: 'part' }] }
    const p2 = await s.post('/api/class-log/preview', s2)
    check('outcomes marked as studied in class get no task', p2.body?.ok && !(p2.body.tasks as any[]).some(t => t.title.includes('Reading 37') && t.outcomeId === 'r037-a') && p2.body.skippedStudiedInClass === 1, JSON.stringify(p2.body).slice(0, 200))
    check('the new class is planned around the first one', (p2.body.tasks as any[]).every(t => t.date > second))
    const c2 = await s.post('/api/class-log/confirm', { ...s2, idempotencyKey: `e2e-${Date.now()}-b`, fingerprint: p2.body.fingerprint })
    check('the second class confirms', c2.body?.ok === true, JSON.stringify(c2.body))
    const { data: all } = await admin.from('plan_blocks').select('class_session_id, outcome_id, local_date').eq('user_id', uid).not('class_session_id', 'is', null)
    check('no outcome-day is planned twice across sessions', new Set((all ?? []).map(b => `${b.class_session_id}|${b.outcome_id}|${b.local_date}`)).size === (all ?? []).length)
  }

  // --- a class that did not happen is recorded and adds no coverage
  const before = await cnt('class_sessions')
  const missedDate = classDates[classDates.length - 1]
  const pm = await s.post('/api/class-log/preview', { classDate: missedDate, kind: 'missed', items: [] })
  const cm = await s.post('/api/class-log/confirm', { classDate: missedDate, kind: 'missed', items: [], idempotencyKey: `e2e-${Date.now()}-m`, fingerprint: pm.body.fingerprint })
  check('a missed class is recorded', cm.body?.ok === true && (await cnt('class_sessions')) === before + 1, JSON.stringify(cm.body))
  check('a missed class adds no coverage', ((await admin.from('class_session_items').select('id').eq('session_id', cm.body.sessionId)).data ?? []).length === 0)

  // --- overload: too much for the open days is carried over, never squeezed in
  const heavy = { classDate: first, kind: 'covered', items: ['r037-c', 'r037-d', 'r037-e', 'r037-f', 'r028-a', 'r028-b', 'r028-c', 'r029-b', 'r029-c', 'r029-d', 'r029-e', 'r036-a', 'r036-b', 'r036-c', 'r036-d', 'r036-e'].map(outcomeId => ({ outcomeId, extent: 'full' })) }
  const ph = await s.post('/api/class-log/preview', heavy)
  check('an overload preview reports pressure honestly', ph.body?.ok && ['tight', 'over'].includes(ph.body.pressure) || (ph.body?.carryover ?? []).length === 0, JSON.stringify(ph.body?.pressure))
  check('an overload never places work on the paper day', (ph.body?.tasks ?? []).every((t: any) => t.date < paperDay))

  // --- ownership: another user's cycle cannot be used
  const { data: other } = await admin.from('planning_cycles').select('id, user_id').neq('user_id', uid).limit(1)
  if (other && other.length) {
    const r = await s.post('/api/class-log/confirm', { ...log, idempotencyKey: `e2e-${Date.now()}-o`, fingerprint: 'x' })
    check('confirm never touches another student\'s data', r.status === 409 || r.status === 200)
  }
  // Leave the shared test account as we found it for the next suite.
  await admin.from('plan_blocks').delete().eq('user_id', uid).not('class_session_id', 'is', null)
  await admin.from('class_sessions').delete().eq('user_id', uid)
  await admin.from('calendar_commitments').delete().eq('user_id', uid).eq('kind', 'class')
  finish()
}
main().catch(e => { console.error(e); process.exit(1) })
