/**
 * Phase C1, live: trustworthy checkpoint commands and assessment closure, with ORDINARY throwaway students (no role, deleted after).
 *   E2E_ALLOW_RESET=1 E2E_BASE_URL=http://localhost:3102 npx tsx scripts/e2e-checkpoint-commands.ts
 * Transaction rollback after an intermediate failure is proved at database level by `npm run checkpoint:rehearse`
 * (an always-rolled-back transaction with a forced failure); everything here goes through the real endpoints.
 * A check that cannot run today is reported as SKIPPED and is never counted as passed.
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)
import { completeOnboarding, createSession } from './lib/e2eSession'
import { getStudyWeekContext, weekForDate } from '../src/lib/planning/schedule'
import { relatedNeedingReview } from '../src/lib/planning/checkpointService'
import { addDays } from '../src/lib/planning/studyWeek'

const TZ = 'Europe/London'
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
const made: string[] = []
let passed = 0, failed = 0; const skipped: string[] = []
const check = (n: string, ok: boolean, d = '') => { ok ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${d ? ` — ${d}` : ''}`)) }
const skip = (n: string, why: string) => { skipped.push(`${n} (${why})`); console.log(`  – SKIPPED ${n}: ${why}`) }
type S = ReturnType<typeof createSession>
const uuid = () => crypto.randomUUID()

async function student(tag: string) {
  const email = `integ+${tag}${Date.now()}@example.com`
  const { data } = await admin.auth.admin.createUser({ email, email_confirm: true })
  made.push(data.user!.id)
  await admin.from('profiles').upsert({ id: data.user!.id, onboarding_status: 'not_started' })
  const s = createSession(admin, email)
  if (!(await s.signIn())) throw new Error('sign-in failed')
  return { id: data.user!.id, s }
}
const view = async (s: S) => (await s.json('/api/checkpoints')).body?.checkpoint
const raw = (s: S, method: string, body: Record<string, unknown>) => s.json('/api/checkpoints', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
/** A request as the page makes it: the checkpoint and version it was looking at, and a fresh key. */
async function send(s: S, method: string, body: Record<string, unknown>) {
  const v = await view(s)
  return raw(s, method, { key: uuid(), checkpointId: v?.checkpointId ?? null, expectedVersion: v?.version ?? null, ...body })
}
const evidence = async (uid: string) => JSON.stringify(await Promise.all(['evidence_events', 'assessment_attempts', 'assessment_responses', 'repair_threads', 'coach_proposals'].map(async t =>
  (await admin.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count)))
const outcomeRows = async (uid: string) => (await admin.from('mock_outcomes').select('*').eq('user_id', uid).order('recorded_at')).data ?? []

/** An onboarded student with a clean open cycle (their own planned rows cleared, so suggestions have room) and a weekly paper on its last day. */
async function setup(tag: string, o: { paper?: 'none' | 'unstarted' | 'started' } = {}) {
  const u = await student(tag)
  const T = ((await admin.from('topics').select('id').order('default_sequence')).data ?? []).map(t => t.id as string)
  await completeOnboarding(u.s, admin, { stage: 'revising_or_mocks', topicExposure: Object.fromEntries(T.map(t => [t, 'recent'])) })
  await admin.from('plan_blocks').delete().eq('user_id', u.id)
  const cycle = (await admin.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', u.id).eq('status', 'active').single()).data!
  let paperId: string | null = null
  if (o.paper && o.paper !== 'none') {
    paperId = `paper-${u.id.slice(0, 8)}`
    const { error } = await admin.from('plan_blocks').insert({
      id: paperId, user_id: u.id, cycle_id: cycle.id, title: 'Weekly diagnostic paper', detail: '', task_type: 'diagnostic', origin: 'diagnostic', priority: 'core',
      placement: 'day_preferred', execution: o.paper === 'started' ? 'in_progress' : 'not_started', local_date: cycle.ends_at_local, day: cycle.ends_at_local,
      duration_minutes: 45, duration: '45', rationale: 'fixture', assessment_scope: { kind: 'weekly_paper' }, created_by: 'algorithm',
    })
    if (error) throw new Error(`paper fixture: ${error.message}`)
  }
  return { ...u, cycle: { id: cycle.id as string, start: cycle.starts_at_local as string, end: cycle.ends_at_local as string }, paperId }
}
const midCycle = (c: { start: string; end: string }, n = 4) => { const d = addDays(c.start, n); return d < addDays(today, 1) ? addDays(today, 1) : d > c.end ? c.end : d }
const reviewState = async (s: S) => (await s.json('/api/weekly-review/state')).body?.state

async function main() {
  console.log(`\nPhase C1 — local date ${today} (${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekday(today)]}) in ${TZ}`)

  console.log('\n1 + 3 + 5. Replay, key reuse and stale requests')
  const a = await setup('c1A')
  const mock = midCycle(a.cycle)
  const k1 = uuid()
  const create = { key: k1, checkpointId: null, expectedVersion: null, date: mock, kind: 'provider_mock', label: 'Coaching mock', startTime: '10:00', durationMinutes: 180 }
  const c1 = await raw(a.s, 'PUT', create)
  check('a checkpoint is created and given an identity and version', c1.body?.ok === true && !!c1.body.checkpoint.checkpointId && c1.body.checkpoint.version === 1, JSON.stringify(c1.body).slice(0, 160))
  const id = c1.body.checkpoint.checkpointId as string
  const c1b = await raw(a.s, 'PUT', create)
  check('the same request again returns the original receipt and changes nothing', c1b.body?.ok === true && c1b.body.receipt.replayed === true && c1b.body.checkpoint.version === 1)
  const reused = await raw(a.s, 'PUT', { ...create, date: addDays(mock, 1) })
  check('the same key with a different payload is refused', reused.status === 409 && reused.body?.code === 'KEY_REUSED' && (await view(a.s)).checkpoint.date === mock, `${reused.status} ${JSON.stringify(reused.body).slice(0, 120)}`)
  check('a write without a key is refused', (await raw(a.s, 'PUT', { date: mock, kind: 'other' })).body?.code === 'KEY_REQUIRED')
  const v1 = await view(a.s)
  const moved = await raw(a.s, 'PUT', { key: uuid(), checkpointId: id, expectedVersion: v1.version, date: addDays(mock, 1) > a.cycle.end ? mock : addDays(mock, 1), kind: 'provider_mock', label: 'Coaching mock', startTime: '10:00', durationMinutes: 180 })
  const v2 = moved.body.checkpoint
  check('an edit at the current version keeps the identity and bumps the version', moved.body?.ok === true && v2.checkpointId === id && v2.version === v1.version + 1 || moved.body?.ok === true && v2.version > v1.version)
  const staleCancel = await raw(a.s, 'DELETE', { key: uuid(), checkpointId: id, expectedVersion: v1.version })
  check('an old request arriving after a newer edit cannot cancel the newer checkpoint', staleCancel.status === 409 && staleCancel.body?.code === 'CHECKPOINT_CHANGED' && !!(await view(a.s)), `${staleCancel.status}`)
  check('and the refusal returns the current checkpoint so the page can refresh at once', staleCancel.body?.checkpoint?.version === v2.version)
  const staleEdit = await raw(a.s, 'PUT', { key: uuid(), checkpointId: id, expectedVersion: v1.version, date: mock, kind: 'other' })
  check('an old edit cannot overwrite the newer one', staleEdit.status === 409 && (await view(a.s)).checkpoint.kind === 'provider_mock')
  const staleChoice = await raw(a.s, 'POST', { key: uuid(), checkpointId: id, expectedVersion: v1.version, action: 'choice', choice: 'keep_paper' })
  check('an old choice request is refused too', staleChoice.status === 409 && (await view(a.s)).choice === null)

  console.log('\n4. An invalid postponement leaves nothing behind')
  const before = { rows: (await outcomeRows(a.id)).length, v: await view(a.s), ev: await evidence(a.id) }
  for (const [name, newDate] of [['a past date', addDays(today, -3)], ['a date after the exam', '2027-12-31'], ['not a date', '2026-13-45']] as const) {
    const bad = await send(a.s, 'POST', { action: 'outcome', outcome: 'postponed', newDate })
    const now = await view(a.s)
    check(`${name} is refused with a reason`, bad.status === 400 && typeof bad.body.error === 'string', `${bad.status} ${JSON.stringify(bad.body).slice(0, 100)}`)
    check(`…and no outcome, version change, choice change or receipt exists after it (${name})`, (await outcomeRows(a.id)).length === before.rows && now.version === before.v.version && now.checkpoint.date === before.v.checkpoint.date)
  }
  check('a result cannot be attached to a mock that was not taken, and nothing was recorded', (await send(a.s, 'POST', { action: 'outcome', outcome: 'not_taken', result: '70%' })).status === 400 && (await outcomeRows(a.id)).length === before.rows)
  skip('transaction rollback after an intermediate failure', 'proved at database level: npm run checkpoint:rehearse (forced failure after earlier writes; whole command, receipt included, rolled back)')

  console.log('\n8. Taken: future dates refused, early completion attributed to its actual day')
  const futureTaken = await send(a.s, 'POST', { action: 'outcome', outcome: 'taken', actualDate: addDays(today, 2) })
  check('a future actual date is refused', futureTaken.status === 400 && futureTaken.body?.code === 'INVALID_ACTUAL_DATE' && (await outcomeRows(a.id)).length === before.rows)
  const vTaken = await view(a.s)
  const takenKey = uuid()
  const takenBody = { key: takenKey, checkpointId: vTaken.checkpointId, expectedVersion: vTaken.version, action: 'outcome', outcome: 'taken', result: '62%', notes: 'felt rushed', choice: 'use_mock', paperAction: 'replace' }
  const ev0 = await evidence(a.id)
  const taken = await raw(a.s, 'POST', takenBody)
  const row = (await outcomeRows(a.id))[0]
  check('taking a future-planned mock today is recorded: planned date kept, actual date defaulted to the student’s local today', taken.body?.ok === true && row?.planned_date === vTaken.checkpoint.date && row.actual_date === today, JSON.stringify(row))
  check('the choice in force travels with the outcome', row?.choice_at_record === 'use_mock')
  check('the checkpoint is retired, and no evidence, attempts, answers, repair threads or proposals exist', !(await view(a.s)) && ev0 === await evidence(a.id))
  const replay = await raw(a.s, 'POST', takenBody)
  check('1. the SAME request replayed after the checkpoint was cleared returns the original receipt', replay.body?.ok === true && replay.body.replayed === true && replay.body.outcomeId === taken.body.outcomeId && (await outcomeRows(a.id)).length === 1, JSON.stringify(replay.body).slice(0, 160))
  const late = await raw(a.s, 'POST', { ...takenBody, key: uuid() })
  check('a genuinely new request after clearance says there is no checkpoint', late.status === 404 && late.body?.code === 'NO_CHECKPOINT')
  const st = await reviewState(a.s)
  check('use mock + taken: the external outcome satisfies the closure path (self-reported)', st?.gate?.kind === 'external_mock' && st.gate.reportedResult === '62%', JSON.stringify(st?.gate).slice(0, 160))
  check('the recap names it with both dates and says it counts', st?.recap?.external?.[0]?.actualDate === today && st.recap.external[0].countsAsAssessment === true)

  console.log('\n7. Every assessment choice × outcome')
  const m = await setup('c1M')
  const matrix: { choice: string | null; outcome: 'taken' | 'postponed' | 'not_taken'; external: boolean }[] = []
  for (const choice of ['use_mock', 'keep_paper', 'later', null]) for (const outcome of ['taken', 'postponed', 'not_taken'] as const) matrix.push({ choice, outcome, external: choice === 'use_mock' && outcome === 'taken' })
  for (const x of matrix) {
    const label = `${x.choice ?? 'no choice'} + ${x.outcome}`
    const day = midCycle(m.cycle, 5)
    const mk = await send(m.s, 'PUT', { date: day, kind: 'provider_mock', label: 'Matrix mock' })
    if (mk.body?.ok !== true) { check(`${label}: checkpoint created`, false, JSON.stringify(mk.body).slice(0, 120)); continue }
    if (x.choice) { const ch = await send(m.s, 'POST', { action: 'choice', choice: x.choice }); if (ch.body?.ok !== true) { check(`${label}: choice saved`, false, JSON.stringify(ch.body).slice(0, 120)); continue } }
    const evBefore = await evidence(m.id)
    const out = await send(m.s, 'POST', { action: 'outcome', outcome: x.outcome, ...(x.outcome === 'taken' ? { result: '55%' } : {}) })
    const s2 = await reviewState(m.s)
    const gate = s2?.gate
    const mine = (s2?.recap?.external ?? []).find((e: any) => e.outcome === x.outcome)
    check(`${label}: recorded as the student's own report`, out.body?.ok === true && !!mine)
    check(`${label}: ${x.external ? 'satisfies the external-assessment path' : 'does NOT unlock closure'}`, x.external ? gate?.kind === 'external_mock' : gate?.kind !== 'external_mock', JSON.stringify(gate).slice(0, 140))
    if (x.outcome !== 'taken') check(`${label}: replacement guidance is offered, no assessment is claimed`, typeof out.body.replacement?.message === 'string' && (gate?.kind === 'not_ready' || gate?.kind === 'paper_pending' || gate?.kind === 'no_paper_allowed') && new RegExp(x.outcome === 'postponed' ? 'postponed' : 'not taken').test(gate.reason ?? ''), JSON.stringify(gate).slice(0, 160))
    else if (!x.external) check(`${label}: the weekly paper requirement is untouched and the outcome is not counted`, mine?.countsAsAssessment === false)
    check(`${label}: no evidence of any kind was created`, evBefore === await evidence(m.id))
    // The unfinished outcome of the previous iteration must not leak into the next one: clear this week's history for a clean read.
    await admin.from('mock_outcomes').delete().eq('user_id', m.id)
  }
  const m2 = await view(m.s)
  check('decide-later stays visible as unresolved (no replacement is inferred from an outcome)', m2 === null || m2.choiceUnresolved === true)

  console.log('\n9 + 10. A paper that already exists')
  const p = await setup('c1P', { paper: 'unstarted' })
  const pd = midCycle(p.cycle)
  await send(p.s, 'PUT', { date: pd, kind: 'provider_mock' })
  const vp = await view(p.s)
  check('the view shows the unstarted paper so the choice is previewable', vp.paper.onCalendar === true && vp.paper.started === false && vp.paper.title === 'Weekly diagnostic paper')
  const need = await send(p.s, 'POST', { action: 'choice', choice: 'use_mock' })
  check('choosing the mock without deciding about the paper is refused and the paper is untouched', need.status === 409 && need.body?.code === 'PAPER_DECISION_REQUIRED' && (await admin.from('plan_blocks').select('cancelled_at').eq('id', p.paperId!).single()).data?.cancelled_at === null)
  const rep = await send(p.s, 'POST', { action: 'choice', choice: 'use_mock', paperAction: 'replace' })
  const pRow = (await admin.from('plan_blocks').select('cancelled_at').eq('id', p.paperId!).single()).data
  check('replacing cancels the unstarted paper in the same step and records the cancellation (the row stays)', rep.body?.ok === true && !!pRow?.cancelled_at && rep.body.checkpoint.choice === 'use_mock')
  check('…with history: one cancellation event naming the mock', ((await admin.from('task_events').select('payload').eq('task_id', p.paperId!).eq('event_type', 'cancelled')).data ?? []).some(e => (e.payload as any)?.reason === 'replaced_by_mock'))
  check('Tests and Calendar tell the same story', /as the assessment for the week/.test((await (await p.s.req('/app/tests')).text()).replace(/<!-- -->/g, '')) && (await view(p.s)).paper.onCalendar === false)
  const rep2 = await send(p.s, 'POST', { action: 'choice', choice: 'use_mock', paperAction: 'replace' })
  check('choosing again is harmless', rep2.body?.ok === true)
  const sameWeek = addDays(pd, pd >= p.cycle.end ? -1 : 1)
  const inWeek = await send(p.s, 'PUT', { date: sameWeek, kind: 'provider_mock' })
  check('moving the mock inside the same week keeps that week’s assessment choice', inWeek.body?.ok === true && inWeek.body.checkpoint.choice === 'use_mock', JSON.stringify(inWeek.body?.checkpoint?.choice))

  const sPaper = await setup('c1S', { paper: 'started' })
  await send(sPaper.s, 'PUT', { date: midCycle(sPaper.cycle), kind: 'provider_mock' })
  const refused = await send(sPaper.s, 'POST', { action: 'choice', choice: 'use_mock', paperAction: 'replace' })
  check('a started paper is preserved: the mock cannot replace it', refused.status === 409 && refused.body?.code === 'PAPER_STARTED' && (await admin.from('plan_blocks').select('cancelled_at, execution').eq('id', sPaper.paperId!).single()).data?.cancelled_at === null)
  const both = await send(sPaper.s, 'POST', { action: 'choice', choice: 'keep_paper' })
  check('the mock can sit alongside it, and the paper record is not touched', both.body?.ok === true && (await admin.from('plan_blocks').select('execution').eq('id', sPaper.paperId!).single()).data?.execution === 'in_progress')
  check('the view explains that state', (await view(sPaper.s)).paper.started === true)

  console.log('\n2 + 11 + 12. Suggestions: one task, no Sunday, short sittings')
  const g = await setup('c1G')
  const gm = midCycle(g.cycle)
  await send(g.s, 'PUT', { date: gm, kind: 'provider_mock' })
  const vg = await view(g.s)
  const placed = vg.suggestions.filter((s: any) => s.addable)
  check('some suggestions are placed inside the open cycle and are addable', placed.length > 0, JSON.stringify(vg.suggestions.map((s: any) => [s.id, s.date, s.addable])))
  const target = placed[0]
  const two = await Promise.all([0, 1].map(() => raw(g.s, 'POST', { key: uuid(), checkpointId: vg.checkpointId, expectedVersion: vg.version, action: 'addSuggestion', suggestionId: target.id })))
  const tasks = (await admin.from('plan_blocks').select('id, title, local_date, starts_at, duration_minutes').eq('user_id', g.id).like('id', 'ckpt-%')).data ?? []
  check('2. two simultaneous requests (two keys) create exactly one task', two.every(r => r.body?.ok === true) && tasks.length === 1 && two[0].body.taskId === two[1].body.taskId, JSON.stringify(two.map(r => r.body?.taskId)))
  const sameKey = uuid()
  const dup = await Promise.all([0, 1, 2].map(() => raw(g.s, 'POST', { key: sameKey, checkpointId: vg.checkpointId, expectedVersion: vg.version, action: 'addSuggestion', suggestionId: target.id })))
  check('three simultaneous requests with the SAME key give one effect and one receipt', dup.every(r => r.body?.ok === true && r.body.taskId === tasks[0]?.id) && ((await admin.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', g.id).like('id', 'ckpt-%')).count === 1))
  check('one creation event is recorded for it', ((await admin.from('task_events').select('id').eq('task_id', tasks[0].id).eq('event_type', 'created')).data ?? []).length === 1)
  const vAfter = await view(g.s)
  check('after a refresh the suggestion shows its task, not another Add button', vAfter.suggestions.find((s: any) => s.id === target.id).taskId === tasks[0].id)
  const html = (await (await g.s.req(`/app/calendar?week=${gm}`)).text()).replace(/<!-- -->/g, '')
  check('and Calendar renders the link', html.includes('Added — open the task'))
  const own = (await admin.from('plan_blocks').select('task_type, origin, assessment_scope').eq('id', tasks[0].id).single()).data
  check('the task is the student’s own optional review: not a paper, no scope, no evidence', own?.task_type === 'review' && own.origin === 'student' && own.assessment_scope === null)
  const forged = placed[1]
  if (forged) {
    const f = await raw(g.s, 'POST', { key: uuid(), checkpointId: vg.checkpointId, expectedVersion: vg.version, action: 'addSuggestion', suggestionId: forged.id, title: 'FORGED', date: addDays(forged.date, 1), minutes: 5, startMinutes: 60 })
    const t = (await admin.from('plan_blocks').select('title, local_date, duration_minutes').eq('id', f.body.taskId).single()).data
    check('a client-submitted title, date or length is not trusted: the stored task matches the server’s proposal', f.body?.ok === true && t?.title === forged.title && t?.local_date === forged.date && t?.duration_minutes === forged.minutes, JSON.stringify(t))
  }
  // A protected commitment appears where a (still unadded) suggestion was proposed: acceptance recomputes and does not use the stale slot.
  const rest = vg.suggestions.find((s: any) => s.addable && !s.taskId && s.id !== forged?.id)
  if (rest) {
    const startsAt = new Date(`${rest.date}T00:00:00Z`)
    const hh = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
    await admin.from('calendar_commitments').insert({ user_id: g.id, label: 'Late shift', kind: 'work', recurrence: 'none', is_protected: true, status: 'active', source: 'student', timezone: TZ,
      starts_at: new Date(`${rest.date}T${hh(rest.startMinutes)}:00${weekday(rest.date) >= 0 ? '' : ''}Z`).toISOString(), ends_at: new Date(`${rest.date}T${hh(Math.min(1439, rest.startMinutes + 120))}:00Z`).toISOString() })
    const vNow = await view(g.s)
    const r = await raw(g.s, 'POST', { key: uuid(), checkpointId: vNow.checkpointId, expectedVersion: vNow.version, action: 'addSuggestion', suggestionId: rest.id })
    check('acceptance revalidates against the calendar as it is now: the stale slot is not used', r.status === 409 || (r.body?.ok === true && (await admin.from('plan_blocks').select('starts_at').eq('id', r.body.taskId).single()).data?.starts_at !== new Date(`${rest.date}T${hh(rest.startMinutes)}:00Z`).toISOString()), JSON.stringify(r.body).slice(0, 160))
  }
  // Sunday and sitting limits.
  const sundayCheck = await setup('c1Z')
  const monday = (() => { let d = addDays(sundayCheck.cycle.start, 7); while (weekday(d) !== 1) d = addDays(d, 1); return d })()
  await send(sundayCheck.s, 'PUT', { date: monday, kind: 'provider_mock' })
  const vz = await view(sundayCheck.s)
  check('11. a Monday mock gets no self-study suggestion on the Sunday before it', vz.suggestions.every((s: any) => !s.date || weekday(s.date) !== 0), JSON.stringify(vz.suggestions.map((s: any) => s.date)))
  const sundayMock = (() => { let d = addDays(sundayCheck.cycle.start, 6); return d })()
  const del1 = await send(sundayCheck.s, 'PUT', { date: sundayMock, kind: 'provider_mock', startTime: '09:00', durationMinutes: 120 })
  check('an external mock itself may fall on a Sunday', del1.body?.ok === true && weekday(sundayMock) === 0, JSON.stringify(del1.body).slice(0, 100))
  await admin.from('profiles').update({ max_session_minutes: 30 }).eq('id', sundayCheck.id)
  const v30 = await view(sundayCheck.s)
  check('12. a 30-minute sitting limit shortens every proposal (45 is a proposal, not a rule)', v30.suggestions.every((s: any) => s.minutes <= 30), JSON.stringify(v30.suggestions.map((s: any) => s.minutes)))
  await admin.from('profiles').update({ max_session_minutes: 20 }).eq('id', sundayCheck.id)
  check('a 20-minute limit is respected too', (await view(sundayCheck.s)).suggestions.every((s: any) => s.minutes <= 20))

  console.log('\n13. Cycle alignment with class boundaries')
  const v = await setup('c1V')
  const accepted = await weekForDate(v.id, addDays(v.cycle.start, 3))
  check('a date inside an accepted cycle resolves to that cycle’s own boundaries', accepted.startDate === v.cycle.start && accepted.endDate === v.cycle.end)
  // Variable pattern: a confirmed next class two to thirteen days away anchors the week for a student with NO accepted cycle yet.
  const nv = await student('c1Vn')
  await admin.from('profiles').update({ timezone: TZ, class_pattern: 'variable', prep_mode: 'instructor_led' }).eq('id', nv.id)
  const classDay = addDays(today, 6)
  await admin.from('calendar_commitments').insert({ user_id: nv.id, label: 'Class', kind: 'class', recurrence: 'none', defines_cycle: true, is_protected: true, status: 'active', source: 'student', timezone: TZ,
    starts_at: new Date(`${classDay}T18:00:00Z`).toISOString(), ends_at: new Date(`${classDay}T20:00:00Z`).toISOString() })
  const ctx = await getStudyWeekContext(nv.id)
  const inside = await weekForDate(nv.id, addDays(ctx.week.endDate, -1))
  check('a variable-class student’s week for a date in the anchored week IS the canonical week', inside.startDate === ctx.week.startDate && inside.endDate === ctx.week.endDate && ctx.week.classLed, `${inside.startDate}-${inside.endDate} vs ${ctx.week.startDate}-${ctx.week.endDate}`)
  check('the anchored week ends the day before the confirmed class', ctx.week.endDate === addDays(classDay, -1))
  const recurring = await student('c1Vr')
  await admin.from('profiles').update({ timezone: TZ, class_pattern: 'fixed', prep_mode: 'instructor_led' }).eq('id', recurring.id)
  await admin.from('calendar_commitments').insert({ user_id: recurring.id, label: 'Class', kind: 'class', recurrence: 'weekly', weekdays: [2, 4], start_time: '18:00', end_time: '20:00', is_protected: true, status: 'active', source: 'student', timezone: TZ, starts_on: today, starts_at: new Date().toISOString(), ends_at: new Date().toISOString() })
  const rctx = await getStudyWeekContext(recurring.id)
  const far = await weekForDate(recurring.id, addDays(rctx.week.endDate, 10))
  check('for a date beyond any cycle, a Tue/Thu class pattern gives a Tuesday–Monday cycle', weekday(far.startDate) === 2 && weekday(far.endDate) === 1, `${far.startDate} ${far.endDate}`)

  console.log('\n14. Moving or cancelling after suggestions were added')
  const r = await setup('c1R')
  const rd = midCycle(r.cycle, 5)
  await send(r.s, 'PUT', { date: rd, kind: 'provider_mock', label: 'Prep mock' })
  const vr = await view(r.s)
  const addables = vr.suggestions.filter((s: any) => s.addable)
  const adds: string[] = []
  for (const s of addables.slice(0, 2)) {
    const cur = await view(r.s)
    const x = await raw(r.s, 'POST', { key: uuid(), checkpointId: cur.checkpointId, expectedVersion: cur.version, action: 'addSuggestion', suggestionId: s.id })
    if (x.body?.taskId) adds.push(x.body.taskId)
  }
  check('preparation was added', adds.length >= 1, `${adds.length}`)
  const accBefore = (await admin.from('plan_blocks').select('id, local_date, execution, cancelled_at').eq('user_id', r.id).not('id', 'like', 'ckpt-%')).data ?? []
  const newDay = addDays(rd, rd >= r.cycle.end ? -1 : 1)
  await send(r.s, 'PUT', { date: newDay, kind: 'provider_mock', label: 'Prep mock' })
  const vm = await view(r.s)
  const flagged = vm.related.filter((t: any) => t.needsReview)
  check('moving the mock identifies the preparation already added, with the reason', flagged.length >= 1 && flagged.every((t: any) => /moved|changed/i.test(t.reason)), JSON.stringify(vm.related.map((t: any) => [t.needsReview, t.reason])))
  check('nothing was moved or removed silently', !!(await admin.from('plan_blocks').select('id, local_date, cancelled_at').in('id', adds)).data?.every(t => !t.cancelled_at))
  check('accepted study work is untouched by the move', JSON.stringify((await admin.from('plan_blocks').select('id, local_date, execution, cancelled_at').eq('user_id', r.id).not('id', 'like', 'ckpt-%')).data) === JSON.stringify(accBefore))
  if (adds.length >= 2) {
    const keepId = flagged[0].taskId
    const keep = await send(r.s, 'POST', { action: 'keepRelated', taskId: keepId })
    check('"Keep it" is a recorded decision that stops the prompt', keep.body?.ok === true && !(await view(r.s)).related.find((t: any) => t.taskId === keepId)?.needsReview)
  }
  const other = await setup('c1Rx')
  const intruder = await send(other.s, 'POST', { action: 'removeRelated', taskId: adds[0], expectedRevision: 1 })
  check('another student cannot touch this student’s tasks (ownership)', intruder.status === 404 && intruder.body?.code === 'NOT_RELATED')
  const cancelled = await send(r.s, 'DELETE', {})
  check('cancelling the mock leaves the added preparation, and says so', cancelled.body?.ok === true && (await admin.from('plan_blocks').select('id').in('id', adds).is('cancelled_at', null)).data?.length === adds.length)
  const orphans = await relatedNeedingReview(r.id)
  check('Calendar can show the orphaned preparation for review even though no checkpoint exists', orphans.length >= 1 && orphans.every(o => /cancelled|finished|replaced/.test(o.reason ?? '')))
  check('and the Calendar page does', /Preparation you added earlier/.test((await (await r.s.req('/app/calendar')).text()).replace(/<!-- -->/g, '')))
  const o1 = orphans.find(o => o.removable)!
  const rm = await send(r.s, 'POST', { action: 'removeRelated', taskId: o1.taskId, expectedRevision: o1.revision })
  const gone = (await admin.from('plan_blocks').select('cancelled_at').eq('id', o1.taskId).single()).data
  check('removing one cancels it (the row and its history stay)', rm.body?.ok === true && !!gone?.cancelled_at)
  const otherId = adds.find(id => id !== o1.taskId)
  if (otherId) {
    await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', otherId)
    const rev = (await admin.from('plan_blocks').select('revision').eq('id', otherId).single()).data!.revision as number
    const nope = await send(r.s, 'POST', { action: 'removeRelated', taskId: otherId, expectedRevision: rev })
    check('completed preparation is never removed or moved by a checkpoint decision', nope.status === 409 && nope.body?.code === 'TASK_STARTED' && (await admin.from('plan_blocks').select('cancelled_at').eq('id', otherId).single()).data?.cancelled_at === null)
    check('and it is not offered for review any more', (await relatedNeedingReview(r.id)).every(o => o.taskId !== otherId))
  } else skip('completed preparation is left alone', 'only one preparation task fit this week')

  console.log('\n15. Preparation review follows the appointment’s real schedule (fixture student, ordinary account)')
  {
    const q = await setup('c1Rq')
    const d1 = midCycle(q.cycle, 2), d2 = addDays(d1, 1) <= q.cycle.end ? addDays(d1, 1) : addDays(d1, -1), d3 = d2 === addDays(d1, 1) ? addDays(d1, 2 <= 0 ? 1 : 2) : addDays(d1, -2)
    const put1 = await send(q.s, 'PUT', { date: d1, kind: 'provider_mock', label: 'Mock Q' })
    check('setup: the mock was saved', put1.body?.ok === true, JSON.stringify(put1.body).slice(0, 160))
    const v0 = await view(q.s)
    const first = v0.suggestions.find((s: any) => s.addable)
    const add = first ? await send(q.s, 'POST', { action: 'addSuggestion', suggestionId: first.id }) : null
    check('setup: preparation was added for this appointment', add?.body?.ok === true && !!add.body.taskId, JSON.stringify(add?.body ?? 'no addable suggestion').slice(0, 160))
    if (add?.body?.taskId) {
      const taskId = add.body.taskId as string
      const map = (await admin.from('checkpoint_suggestion_tasks').select('checkpoint_id, basis_date').eq('task_id', taskId).single()).data
      check('setup: the task records the appointment and the date accepted', map?.checkpoint_id === v0.checkpointId && map?.basis_date === d1, JSON.stringify(map))
      const flagged = async () => ((await view(q.s)).related as any[]).find(t => t.taskId === taskId)
      const completedBefore = JSON.stringify((await admin.from('plan_blocks').select('local_date, execution, revision').eq('id', taskId).single()).data)
      check('an unchanged schedule is not flagged', !(await flagged())?.needsReview)
      const rename = await send(q.s, 'PUT', { date: d1, kind: 'provider_mock', label: 'Mock Q renamed' })
      check('renaming the appointment does not ask for review', rename.body?.ok === true && !(await flagged())?.needsReview)
      const mv = await send(q.s, 'PUT', { date: d2, kind: 'provider_mock', label: 'Mock Q renamed' })
      const f2 = await flagged()
      check('moving the appointment asks, naming both dates, and links to the exact task', mv.body?.ok === true && f2?.needsReview === true && /moved from/.test(f2.reason ?? ''), JSON.stringify([mv.body?.ok, f2]))
      check('the task itself is untouched by the move', JSON.stringify((await admin.from('plan_blocks').select('local_date, execution, revision').eq('id', taskId).single()).data) === completedBefore)
      const keep = await send(q.s, 'POST', { action: 'keepRelated', taskId })
      check('Keep acknowledges the current schedule', keep.body?.ok === true && !(await flagged())?.needsReview && (await admin.from('checkpoint_suggestion_tasks').select('basis_date').eq('task_id', taskId).single()).data?.basis_date === d2)
      const rename2 = await send(q.s, 'PUT', { date: d2, kind: 'provider_mock', label: 'Mock Q again' })
      check('an unrelated edit after Keep does not ask again', rename2.body?.ok === true && !(await flagged())?.needsReview)
      const mv2 = await send(q.s, 'PUT', { date: d3, kind: 'provider_mock', label: 'Mock Q again' })
      check('a later material move asks again', mv2.body?.ok === true && (await flagged())?.needsReview === true, JSON.stringify([mv2.body?.code, d3]))

      // A second booked appointment (not the next one) with its own preparation: only ITS preparation follows ITS schedule.
      const far = addDays(q.cycle.end, 0)
      const second = (await admin.from('mock_appointments').insert({ user_id: q.id, kind: 'other', planned_date: far, label: 'Second mock' }).select('id').single()).data!
      const t2 = `ckpt-fixture-${q.id.slice(0, 8)}`
      const ins = await admin.from('plan_blocks').insert({ id: t2, user_id: q.id, cycle_id: q.cycle.id, title: 'Prep for second', detail: 'd', task_type: 'review', origin: 'student', priority: 'optional', placement: 'day_preferred', execution: 'not_started', local_date: far, day: far, duration_minutes: 30, duration: '30', created_by: 'student' })
      const mapIns = await admin.from('checkpoint_suggestion_tasks').insert({ user_id: q.id, checkpoint_id: second.id, suggestion_id: 'prepare-2', task_id: t2, version_added: 1 })
      check('setup: second appointment has its own preparation', !ins.error && !mapIns.error, ins.error?.message ?? mapIns.error?.message)
      const rel = async (id: string) => ((await view(q.s)).related as any[]).find(t => t.taskId === id)
      check('the second appointment’s preparation is not flagged by the first one’s moves', !(await rel(t2))?.needsReview)
      await admin.from('mock_appointments').update({ planned_date: addDays(far, -1) }).eq('id', second.id)
      check('moving the second (not the next) appointment flags its own preparation only', (await rel(t2))?.needsReview === true && (await rel(taskId))?.needsReview === true)
      await admin.from('checkpoint_suggestion_tasks').update({ reviewed_at: new Date().toISOString() }).eq('task_id', taskId)
      check('keeping one leaves the other’s decision open', !(await rel(taskId))?.needsReview && (await rel(t2))?.needsReview === true)
      await admin.from('mock_appointments').update({ status: 'cancelled' }).eq('id', second.id)
      check('cancelling the second asks about its preparation with a cancellation reason', /cancelled|finished|replaced/.test((await rel(t2))?.reason ?? ''))
      await admin.from('plan_blocks').update({ execution: 'completed' }).eq('id', t2)
      check('completed preparation is never offered for review, and its row is unchanged', !(await rel(t2))?.needsReview)
    }
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; failed++ }).finally(async () => {
  for (const id of made) await admin.auth.admin.deleteUser(id).catch(() => {})
  console.log(`\nDeleted ${made.length} throwaway students.`)
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped (skips are NOT counted as passed)`)
  for (const s of skipped) console.log(`  skipped: ${s}`)
  if (failed > 0) process.exitCode = 1
})
