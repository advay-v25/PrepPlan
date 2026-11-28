/**
 * Phase 3 closeout (desktop and 390px), in a real browser against an ISOLATED dev server whose Supabase REST dependency goes through the private loopback
 * harness scripts/fault-upstream.cjs (a transparent pass-through unless this spec writes a fault rule). Two ordinary throwaway students per project, deleted after.
 *
 *   node scripts/fault-upstream.cjs --port=4144 --faults=/tmp/claude-501/p3/faults.json --log=/tmp/claude-501/p3/upstream.log
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:4144 NVIDIA_API_KEY= node scripts/isolated-next.cjs .next-p3b dev -p 3144
 *   E2E_BASE_URL=http://localhost:3144 caffeinate -i npx playwright test -c playwright.lifecycle.config.ts tests/e2e/lifecycle/phase3-closeout.spec.ts --project=desktop
 *
 * What is SEEDED (recorded, never counted as product proof): the study windows/cycle window, two reports + their first accepted plan (through the real report and
 * recovery routes, authenticated as the student), the real weekly rollover (the real command; only the cycle dates are moved into the past), and the exam edit
 * (the canonical /api/onboarding/exam route, not the Settings form). What is driven through the UI: the follow-up links, the preview, the confirmations, the
 * drawer, the selected-report Coach, the stale exam target, the failed Calendar read and the Coach deadline.
 * The Coach provider is unavailable on this server (empty key), so replies are the deterministic ones; no live model is called or claimed.
 */
import { test, expect, type Page, type APIResponse } from '@playwright/test'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, recorder, RUN } from './helpers'

const FAULTS = process.env.FAULTS_FILE ?? '/tmp/claude-501/p3/faults.json', UPLOG = process.env.UPSTREAM_LOG ?? '/tmp/claude-501/p3/upstream.log', SERVERLOG = process.env.SERVER_LOG ?? '/tmp/claude-501/p3/dev3144.log'
const setFaults = (rules: object[]) => fs.writeFileSync(FAULTS, JSON.stringify({ rules }))
const upstream = () => fs.readFileSync(UPLOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) as { t: string; event: string; id?: string; url?: string }[]
const db = admin(), rec = recorder(), owned: string[] = []
const tz = 'Europe/London', today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7))
const J = { 'Content-Type': 'application/json' }
const unexpected: string[] = [], evidence: Record<string, unknown> = {}
let allowed503 = false, allowed409 = false

const cancelledReads: { path:string; kind:string }[] = []
test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => {
  page.on('requestfailed', r => {
    const u = new URL(r.url())
    if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && ((r.headers()['rsc'] === '1' && u.searchParams.has('_rsc')) || (u.pathname === '/api/tests/scope/confirm' && u.searchParams.has('blockId')))) {
      cancelledReads.push({ path:u.pathname, kind:u.pathname === '/api/tests/scope/confirm' ? 'drawer scope read cancelled on cleanup' : 'Next markup read cancelled by navigation' }); return
    }
    unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`)
  })
  page.on('response', r => { if (allowed409 && r.status() === 409 && /\/recovery$/.test(r.url())) return; if (allowed503 && r.status() === 503 && r.request().method() === 'POST' && /\/api\/coach$/.test(r.url())) return; if (r.status() >= 400) unexpected.push(`HTTP ${r.status()} ${r.url()}`) })
  page.on('console', m => { if (m.type() === 'error' && allowed409 && /status of 409/.test(m.text())) return; if (m.type() === 'error' && allowed503 && /status of 503/.test(m.text())) return; if (m.type() === 'error') unexpected.push(`${page.url()} ${m.text().slice(0, 4000)}`) })
  page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 300)}`))
})
test.afterAll(async ({}, info) => {
  setFaults([])
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message), error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase3-closeout-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name,
    harness: { upstream: 'scripts/fault-upstream.cjs (loopback pass-through to the real Supabase REST host; faults only while a rule is written)', substituted: 'the Supabase REST dependency of the isolated dev server (status 500 on evidence_events reads; a stalled plan_blocks read)', provider: 'unavailable on this server (empty key): deterministic replies, no live model' },
    seeded: ['study windows and cycle windows', 'two reports and the first accepted plan through the real routes', 'the weekly rollover (real command; cycle dates moved into the past)', 'the exam edit via the canonical /api/onboarding/exam route'], evidence, steps: rec.rows, cleanup, unexpected, cancelledReads }, null, 2))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

async function fitsViewport(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(w.scroll, `horizontal overflow on ${page.url()} (${JSON.stringify(w)})`).toBeLessThanOrEqual(w.client + 1)
  expect(w.client).toBeLessThanOrEqual(page.viewportSize()!.width)
}
const json = async (r: APIResponse) => ({ status: r.status(), body: await r.json().catch(() => ({})) as any })
const counts = async (uid: string) => Object.fromEntries(await Promise.all(['evidence_events', 'assessment_attempts', 'block_scope_confirmations', 'user_module_state', 'repair_threads', 'mock_appointments'].map(async t => [t, (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count ?? 0])))
const input = (o: Record<string, unknown>) => ({ scope: 'full', scale: 'percent', difficulties: ['ran_out_of_time'], topics: [], notes: null, ...o })
const wdOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

test('continuity, the unplaced remainder, the selected report, the exam boundary, and the real failed-read / deadline recovery', async ({ page }) => {
  test.setTimeout(900_000)
  // ===== student A: reports, an unplaced remainder, a continuation =====
  const A = await createStudent(db, `p3c${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id').eq('user_id', A.id).eq('status', 'active').single()).data!
  const windowsOf = async (uid: string, rows: { weekday: number; start: string; end: string }[]) => { await db.from('availability_windows').delete().eq('user_id', uid).throwOnError(); if (rows.length) await db.from('availability_windows').insert(rows.map(r => ({ user_id: uid, weekday: r.weekday, start_time: r.start, end_time: r.end, status: 'active' }))).throwOnError() }
  const allDays = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '10:30' }))
  const readings = (await db.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(3)).data!.map(r => r.id as string)
  const R: { old: string; neu: string } = { old: '', neu: '' }
  let T: string[] = []
  await login(page, db, A.email)

  await rec.api('seed: a window where only two of three 30-minute sittings fit (tomorrow and the day after, 30 minutes each), 60-minute sitting limit', async () => {
    await db.from('planning_cycles').update({ starts_at_local: addDays(today, -1), ends_at_local: addDays(today, 3) }).eq('id', cyc.id).throwOnError()
    await db.from('profiles').update({ max_session_minutes: 60 }).eq('id', A.id).throwOnError()
    await db.from('plan_blocks').delete().eq('user_id', A.id).throwOnError(); await db.from('calendar_commitments').delete().eq('user_id', A.id).throwOnError()
    await windowsOf(A.id, [1, 2].map(n => ({ weekday: wdOf(addDays(today, n)), start: '09:00', end: '09:30' })))
  })
  await rec.api('seed: an OLDER report (Provider Old, 55%) and a NEWER one (Provider New, 48%) through the real route; the older one gets three chosen readings, two fit', async () => {
    const mk = async (takenOn: string, provider: string, score: number) => (await json(await page.request.post('/api/mock-reports', { data: { action: 'create', key: randomUUID(), input: input({ takenOn, provider, score }) } }))).body.report.id as string
    R.old = await mk(addDays(today, -10), 'Provider Old', 55); R.neu = await mk(addDays(today, -3), 'Provider New', 48)
    const selection = { items: readings.map(id => ({ key: `review:${id}`, kind: 'review', readingId: id, minutes: 30 })) }
    const pv = await json(await page.request.post(`/api/mock-reports/${R.old}/recovery`, { data: { mode: 'preview', selection } }))
    expect(pv.body.placed, JSON.stringify(pv.body).slice(0, 700)).toHaveLength(2); expect(pv.body.remainder).toHaveLength(1)
    const ac = await json(await page.request.post(`/api/mock-reports/${R.old}/recovery`, { data: { mode: 'accept', selection, fingerprint: pv.body.fingerprint, key: randomUUID(), reportVersion: 1 } }))
    expect(ac.body.ok).toBe(true); T = ac.body.taskIds
  })
  await rec.api('seed: both sittings are finished through the task API, then the week closes through the REAL weekly command (cycle dates moved into the past) and full windows return', async () => {
    for (const id of T) { const rev = (await db.from('plan_blocks').select('revision').eq('id', id).single()).data!.revision; expect((await page.request.patch(`/api/tasks/${id}`, { data: { action: 'execution', execution: 'completed', actualDurationMinutes: 30, expectedRevision: rev } })).status()).toBe(200) }
    const start = addDays(weekStart, -7), end = addDays(start, 6)
    await db.from('planning_cycles').update({ starts_at_local: start, ends_at_local: end }).eq('id', cyc.id).throwOnError()
    for (const id of T) await db.from('plan_blocks').update({ local_date: addDays(start, 2), day: addDays(start, 2) }).eq('id', id).throwOnError()
    const p = await json(await page.request.post('/api/weekly-review/preview', { data: { cycleId: cyc.id, choices: {}, acknowledgeNoPaper: true } })); expect(p.body.ok).toBe(true)
    expect((await json(await page.request.post('/api/weekly-review/accept', { data: { draftId: p.body.draftId } }))).body.ok).toBe(true)
    await windowsOf(A.id, allDays)
  })
  const base = await counts(A.id)

  await rec.browser('weekly review offers a direct "Plan what is left" for the exact remaining selection (30 minutes) and says what was done', async () => {
    await page.goto('/app/review-week'); const r = page.getByTestId('review-recovery'); await expect(r).toBeVisible()
    await expect(r).toContainText('30 min you chose still has no sitting'); await expect(r.getByTestId('review-plan-left')).toHaveAttribute('href', `/app/calendar/mock-report/${R.old}?plan=left`); await fitsViewport(page)
  })
  await rec.browser('Calendar offers the same action with the same minutes; it opens the report with the proposal already built from the SAVED selection', async () => {
    await page.goto('/app/calendar'); const w = page.getByTestId('recovery-waiting'); await expect(w).toContainText('30 min'); await fitsViewport(page)
    await w.getByTestId('recovery-plan-left').click(); await page.waitForURL(/mock-report\/.+\?plan=left/)
    const pv = page.getByTestId('recovery-preview'); await expect(pv).toBeVisible({ timeout: 30_000 })
    const already = page.getByTestId('recovery-already'); await expect(already).toContainText('Completed previously'); expect((await already.innerText()).match(/Completed previously/g)).toHaveLength(2)
    await expect(already).not.toContainText('already in your week'); await expect(pv.locator('li small', { hasText: '30 min' })).toHaveCount(1); await fitsViewport(page)
  })
  await rec.browser('accepting adds exactly ONE sitting (the remaining reading); the two finished sittings are not repeated and nothing fails', async () => {
    await page.getByRole('button', { name: 'Confirm and add to my week' }).dblclick(); await page.waitForURL(u => u.pathname === '/app/calendar')
    const rows = (await db.from('plan_blocks').select('id, source_key, execution, cycle_id').eq('user_id', A.id).eq('source_report_id', R.old).is('cancelled_at', null)).data!
    expect(rows).toHaveLength(3); expect(new Set(rows.map(r => r.source_key)).size).toBe(3); expect(rows.filter(r => r.execution === 'completed')).toHaveLength(2)
    const fresh = rows.find(r => r.execution === 'not_started')!; T.push(fresh.id)
    expect(await counts(A.id)).toEqual(base)
    await page.reload(); await expect(page.getByTestId('recovery-waiting')).toHaveCount(0)
  })
  await rec.api('seed: the new sitting is partly done (10 minutes), then rolled over by the REAL weekly command with a 20-minute continuation', async () => {
    const id = T[2], rev = (await db.from('plan_blocks').select('revision').eq('id', id).single()).data!.revision
    expect((await page.request.patch(`/api/tasks/${id}`, { data: { action: 'execution', execution: 'partial', actualDurationMinutes: 10, expectedRevision: rev } })).status()).toBe(200)
    const c2 = (await db.from('planning_cycles').select('id').eq('user_id', A.id).eq('status', 'active').single()).data!.id as string
    const start = addDays(weekStart, -21), end = addDays(start, 6)
    await db.from('planning_cycles').update({ starts_at_local: start, ends_at_local: end }).eq('id', c2).throwOnError()
    await db.from('plan_blocks').update({ local_date: addDays(start, 2), day: addDays(start, 2) }).eq('id', id).throwOnError()
    const p = await json(await page.request.post('/api/weekly-review/preview', { data: { cycleId: c2, choices: { [id]: { happened: 'partial', next: 'continue', estimateMinutes: 20 } }, acknowledgeNoPaper: true } })); expect(p.body.ok).toBe(true)
    const acc = await json(await page.request.post('/api/weekly-review/accept', { data: { draftId: p.body.draftId } }))
    expect(acc.body.continued, `accept: ${JSON.stringify(acc.body).slice(0, 400)}`).toBe(1)
  })
  await rec.browser('the continuation keeps the report provenance; its drawer says what it continues; the original keeps its own week and 10 reported minutes', async () => {
    const succ = (await db.from('plan_blocks').select('id, local_date, source_report_id, duration_minutes').eq('continued_from_task_id', T[2]).single()).data!
    expect(succ.source_report_id).toBe(R.old); expect(succ.duration_minutes).toBe(20)
    await page.goto(`/app/calendar?week=${succ.local_date ?? addDays(weekStart, 0)}&view=agenda&task=${succ.id}`)
    const d = page.getByRole('dialog'); await expect(d).toBeVisible({ timeout: 30_000 }); await fitsViewport(page)
    await expect(d.getByTestId('task-source-report')).toContainText('your own mock report'); await expect(d.getByRole('region', { name: 'Continuation' })).toContainText(/Continued from/)
    await expect(d.getByTestId('task-source-coach')).toHaveAttribute('href', new RegExp(`/app/coach\\?report=${R.old}`)); await page.keyboard.press('Escape')
    expect((await db.from('plan_blocks').select('execution, duration_minutes').eq('id', T[2]).single()).data).toEqual({ execution: 'partial', duration_minutes: 30 })
  })
  await rec.browser('a new proposal for the same selection reads "Continues this week" for it, "Completed previously" for the other two, and adds nothing', async () => {
    await page.goto(`/app/calendar/mock-report/${R.old}`); await expect(page.getByRole('heading', { name: 'Planned from this report' })).toBeVisible()
    await page.getByRole('checkbox', { name: 'Pacing and application practice' }).uncheck()   // the debrief offers pacing practice by default; the student leaves it out here
    await page.getByRole('button', { name: 'Preview the plan' }).click(); const a = page.getByTestId('recovery-already'); await expect(a).toBeVisible()
    await expect(a).toContainText('Continues this week'); expect((await a.innerText()).match(/Completed previously/g)).toHaveLength(2)
    await expect(page.getByTestId('recovery-preview')).toContainText('Nothing new to add'); expect((await db.from('plan_blocks').select('id').eq('source_report_id', R.old).is('cancelled_at', null)).data).toHaveLength(4); await fitsViewport(page)
  })

  // ===== the selected report in the Coach =====
  await rec.browser('Coach opened from the OLDER report discusses THAT report (date and provider), not the latest; the card and link survive a reload', async () => {
    await page.goto(`/app/calendar/mock-report/${R.old}`); await page.getByTestId('report-ask-coach').click(); await page.waitForURL(/\/app\/coach\?report=/)
    const card = page.getByTestId('coach-selected-report'); await expect(card).toContainText('Provider Old'); await expect(card).not.toContainText('Provider New'); await fitsViewport(page)
    const box = page.getByRole('textbox', { name: 'Ask the coach' }); const n0 = await page.locator('.coach-message--coach').count()
    await page.getByRole('button', { name: /Send/ }).click()
    await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 90_000 }).toBeGreaterThan(n0); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 90_000 })
    const reply = page.locator('.coach-message--coach').last(), text = (await reply.innerText()).replace(/\s+/g, ' ')
    expect(text).toContain(addDays(today, -10)); expect(text).toContain('Provider Old'); expect(text).not.toContain('Provider New'); expect(text).toMatch(/not test evidence/); expect(text).not.toMatch(/you will pass|on track/i)
    await expect(reply.getByRole('link', { name: 'Open this mock report' })).toHaveAttribute('href', `/app/calendar/mock-report/${R.old}`)
    expect(box).toBeTruthy(); await page.reload(); await expect(page.getByTestId('coach-selected-report')).toContainText('Provider Old'); await expect(page.locator('.coach-message--coach').last()).toContainText('Provider Old')
  })
  await rec.browser('with NO selection the Coach still defaults to the latest report; a foreign or missing id is said to be unavailable and never replaced', async () => {
    await page.goto('/app/coach'); const box = page.getByRole('textbox', { name: 'Ask the coach' }); let n = await page.locator('.coach-message--coach').count()
    await box.fill('What does my latest mock report mean for this week?'); await box.press('Enter')
    await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 90_000 }).toBeGreaterThan(n); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 90_000 })
    expect((await page.locator('.coach-message--coach').last().innerText())).toContain('Provider New')
    const missing = randomUUID(); await page.goto(`/app/coach?report=${missing}&q=${encodeURIComponent('How should I work on this mock report?')}`)
    await expect(page.getByRole('status', { name: 'Selected item' })).toContainText('not available'); n = await page.locator('.coach-message--coach').count()
    await page.getByRole('button', { name: /Send/ }).click(); await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 90_000 }).toBeGreaterThan(n); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 90_000 })
    const t = (await page.locator('.coach-message--coach').last().innerText()).replace(/\s+/g, ' ')
    expect(t).toMatch(/cannot open the mock report you chose/); expect(t).not.toContain('Provider New'); expect(t).not.toContain('Provider Old'); expect(t).toMatch(/not substituted another report/)
  })
  await rec.browser('a withdrawn report is explained as withdrawn (sittings stay), and editing/withdrawal keeps the accepted sittings as history with their source', async () => {
    await page.goto(`/app/calendar/mock-report/${R.neu}`); await page.getByRole('button', { name: 'Withdraw it' }).click()
    await expect(page.getByRole('group', { name: 'Confirm withdrawal' })).toContainText('Nothing has been planned from it yet'); await page.getByRole('button', { name: 'Yes, withdraw' }).click(); await page.waitForURL(u => u.pathname === '/app/calendar')
    await page.goto(`/app/coach?report=${R.neu}&q=${encodeURIComponent('How should I work on this mock report?')}`); await expect(page.getByTestId('coach-selected-report')).toContainText('You withdrew this report')
    const n = await page.locator('.coach-message--coach').count(); await page.getByRole('button', { name: /Send/ }).click(); await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 90_000 }).toBeGreaterThan(n); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 90_000 })
    expect((await page.locator('.coach-message--coach').last().innerText()).replace(/\s+/g, ' ')).toMatch(/You withdrew the mock report from/)
    await page.goto(`/app/calendar/mock-report/${R.old}`); await page.getByRole('button', { name: 'Withdraw it' }).click()
    await expect(page.getByRole('group', { name: 'Confirm withdrawal' })).toContainText('4 sittings already planned from it stay in your Calendar'); await page.getByRole('button', { name: 'Keep it' }).click()
  })
  evidence.studentA = { counts: await counts(A.id) }

  // ===== the real failed Calendar read and the real Coach deadline =====
  await rec.browser('Calendar failed read: an upstream 500 on the progress read is shown as "could not be loaded", the rest of the page works, and Try again recovers', async () => {
    const before = upstream().length
    const progressRead = '/rest/v1/evidence_events?select=attempt_id'
    setFaults([{ id: 'signals-500', match: progressRead, method: 'GET', mode: 'status', status: 500 }])
    await page.goto('/app/calendar')
    await page.locator('[data-week-context] > summary').click()
    const msg = page.getByTestId('calendar-signals-unavailable')
    await expect(msg).toBeVisible(); await expect(msg).toContainText('could not be loaded just now'); await expect(msg).not.toContainText(/0 of|nothing/i)
    await expect(page.getByTestId('mock-reports')).toBeVisible(); await fitsViewport(page)
    evidence.calendarFault = { rule: `status 500 on the progress read: ${progressRead},… (src/lib/signals/signals-loader.ts)`, applied: upstream().slice(before).filter(e => e.event === 'fault_status' && e.id === 'signals-500').length }
    expect((evidence.calendarFault as any).applied).toBeGreaterThan(0)
    setFaults([]); await msg.getByRole('link', { name: 'Try again' }).click(); await expect(page.getByTestId('calendar-signals-unavailable')).toHaveCount(0); await fitsViewport(page)
  })
  await rec.browser('Coach deadline: a REAL stalled upstream read hits the server context deadline (reads aborted, lease expired, retryable 503), the question is kept, and Retry gives exactly one answer', async () => {
    test.setTimeout(900_000)
    expect(fs.existsSync(SERVERLOG), `SERVER_LOG missing: ${SERVERLOG}`).toBe(true)
    expect(fs.existsSync(UPLOG), `UPSTREAM_LOG missing: ${UPLOG}`).toBe(true)
    await page.goto('/app/coach'); const box = page.getByRole('textbox', { name: 'Ask the coach' })
    const propBefore = (await db.from('coach_proposals').select('id', { count: 'exact', head: true }).eq('user_id', A.id)).count
    const t0 = Date.now(); const upBefore = upstream().length, srvBefore = fs.statSync(SERVERLOG).size
    setFaults([{ id: 'ctx-stall', match: '/rest/v1/plan_blocks', method: 'GET', mode: 'stall', ms: 120000 }])
    let key = ''; page.on('request', r => { if (r.method() === 'POST' && /\/api\/coach$/.test(r.url())) key = JSON.parse(r.postData() ?? '{}').turnKey })
    const coachResPromise = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/coach$/.test(r.url()), { timeout: 120_000 })
    allowed503 = true; await box.fill('What should I do today?'); await box.press('Enter')
    const coachRes = await coachResPromise
    expect(coachRes.status()).toBe(503)
    const coachBody = await coachRes.json()
    expect(coachBody.code).toBe('CONTEXT_TIMEOUT')
    await expect(page.locator('.coach-error[role=alert]')).toContainText('could not be checked in time', { timeout: 120_000 }); const waited = Date.now() - t0; allowed503 = false
    setFaults([])
    const up = upstream().slice(upBefore)
    let srv = ''
    await expect.poll(() => {
      srv = fs.readFileSync(SERVERLOG).subarray(srvBefore).toString('utf8')
      return srv
    }, { timeout: 5000 }).toMatch(/Coach context exceeded its budget \(\d+ ms\); reads aborted, late result discarded/)
    const stalled = up.filter(e => e.event === 'fault_stall' && e.id === 'ctx-stall'), cancelled = up.filter(e => e.event === 'client_cancelled' && /plan_blocks/.test(e.url ?? ''))
    expect(waited, 'the server answered at its own deadline, not at the stall length').toBeGreaterThan(20_000); expect(waited).toBeLessThan(75_000)
    expect(stalled.length).toBeGreaterThan(0); expect(cancelled.length, 'the server CANCELLED the in-flight read').toBeGreaterThan(0)
    const student = (await db.from('coach_messages').select('id, lease_until, lease_token').eq('user_id', A.id).eq('turn_key', key).eq('role', 'student')).data!
    expect(student).toHaveLength(1); expect(new Date(student[0].lease_until as string).getTime(), 'the lease was expired, not left held').toBeLessThanOrEqual(Date.now() + 1000)
    expect((await db.from('coach_messages').select('id').eq('user_id', A.id).eq('turn_key', key).eq('role', 'coach')).data).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    const prop0 = (await db.from('coach_proposals').select('id', { count: 'exact', head: true }).eq('user_id', A.id)).count
    expect(prop0, 'timed-out request wrote no proposal').toBe(propBefore)
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.coach-message--coach').last()).toContainText(/\w/, { timeout: 90_000 }); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 90_000 })
    expect((await db.from('coach_messages').select('id').eq('user_id', A.id).eq('turn_key', key).eq('role', 'student')).data).toHaveLength(1)
    expect((await db.from('coach_messages').select('id').eq('user_id', A.id).eq('turn_key', key).eq('role', 'coach')).data).toHaveLength(1)
    expect((await db.from('coach_proposals').select('id', { count: 'exact', head: true }).eq('user_id', A.id)).count).toBe(prop0)
    evidence.coachDeadline = { waitedMs: waited, stalledReads: stalled.length, clientCancelledReads: cancelled.length, serverStageLog: srv.match(/exceeded its budget[^\n]*/)?.[0], turnKey: key, leaseExpired: true, retryAnswers: 1 }
    await fitsViewport(page)
  })

  // ===== student B: the exam boundary and a stale target =====
  const B = await createStudent(db, `p3d${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const feb = (d: number) => `2027-02-${String(d).padStart(2, '0')}`
  const fw = (await db.from('exam_windows').select('id').eq('year', 2027).eq('sitting', 'february').single()).data!.id as string
  const exam = async (examDate: string) => { const p = (await db.from('profiles').select('onboarding_context_version, timezone').eq('id', B.id).single()).data!; return json(await page.request.post('/api/onboarding/exam', { data: { timezone: p.timezone ?? tz, examWindowId: fw, registered: true, examDate, expectedVersion: p.onboarding_context_version } })) }
  let RB = ''
  await page.context().clearCookies(); await login(page, db, B.email)
  await rec.api('seed (student B): a cycle in February 2027, windows 09:00-10:30 every day, a booked exam on 20 Feb (canonical editor route), and a poor-mock report with timing and answer-change difficulties', async () => {
    const c = (await db.from('planning_cycles').select('id').eq('user_id', B.id).eq('status', 'active').single()).data!
    await db.from('planning_cycles').update({ starts_at_local: feb(15), ends_at_local: feb(22) }).eq('id', c.id).throwOnError(); await db.from('profiles').update({ max_session_minutes: 60 }).eq('id', B.id).throwOnError()
    await db.from('plan_blocks').delete().eq('user_id', B.id).throwOnError(); await db.from('calendar_commitments').delete().eq('user_id', B.id).throwOnError(); await windowsOf(B.id, allDays)
    expect((await exam(feb(20))).body.ok).toBe(true)
    RB = (await json(await page.request.post('/api/mock-reports', { data: { action: 'create', key: randomUUID(), input: input({ takenOn: addDays(today, -3), provider: 'Provider B', score: 48, difficulties: ['ran_out_of_time', 'changed_right_to_wrong'] }) } }))).body.report.id
  })
  await rec.browser('student reviews a plan (two activities) before the exam is moved earlier; the proposal lies inside the exam boundary', async () => {
    await page.goto(`/app/calendar/mock-report/${RB}`); await page.getByLabel('Length of each sitting').selectOption('30'); await page.getByRole('button', { name: 'Preview the plan' }).click()
    const pv = page.getByTestId('recovery-preview'); await expect(pv).toBeVisible(); await expect(pv.locator('li small', { hasText: '30 min' })).toHaveCount(2); await fitsViewport(page)
  })
  await rec.api('the exam is moved EARLIER (16 Feb: last study day 15 Feb) through the canonical editor route while the plan is open', async () => { expect((await exam(feb(16))).body.ok).toBe(true) })
  await rec.browser('Confirm is refused as out of date: nothing is written, the student\'s choices are kept, and the rebuilt plan stays on or before 15 Feb', async () => {
    allowed409 = true; await page.getByRole('button', { name: 'Confirm and add to my week' }).click()
    await expect(page.locator('p.review-error')).toContainText(/changed since you reviewed/); allowed409 = false; expect((await db.from('plan_blocks').select('id').eq('user_id', B.id).not('source_report_id', 'is', null)).data).toHaveLength(0)
    await expect(page.getByRole('checkbox', { name: 'Pacing and application practice' })).toBeChecked(); await expect(page.getByRole('checkbox', { name: 'Review answer changes' })).toBeChecked(); await fitsViewport(page)
    await page.getByRole('button', { name: 'Preview the plan' }).click(); await expect(page.getByTestId('recovery-preview')).toBeVisible()
    await page.getByRole('button', { name: 'Confirm and add to my week' }).click(); await page.waitForURL(u => u.pathname === '/app/calendar')
    const rows = (await db.from('plan_blocks').select('local_date').eq('user_id', B.id).eq('source_report_id', RB)).data!
    expect(rows).toHaveLength(2); expect(rows.every(r => r.local_date <= feb(15)), JSON.stringify(rows)).toBe(true)
  })
})
