/**
 * Phase 3 (desktop and 390px): the 48% candidate, end to end through the product UI. One ordinary class-led throwaway student per project, deleted afterwards.
 * Creation through the UI: the report, the debrief reading, the selection, the preview, the confirmation, the drawer and partial progress, the later report,
 * the weekly review and the Coach. Setup seeded (recorded in the evidence, never counted as product proof): the exam date, the cycle window, the study windows.
 * The Coach timeout step simulates the SERVER'S retryable answer at the browser (503 CONTEXT_TIMEOUT) once; the server-side deadline itself is proved in
 * scripts/coach-gate0-test.ts. No expected failures are allowed except that one simulated response, only while that step runs.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, recorder, RUN } from './helpers'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '', cycle: '', tz: 'Europe/London', today: '', report: '', report2: '' }
const unexpected: string[] = []
let allowSimulated503 = false

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
  page.on('response', r => { if (allowSimulated503 && r.status() === 503 && r.request().method() === 'POST' && /\/api\/coach$/.test(r.url())) return; if (r.status() >= 400) unexpected.push(`HTTP ${r.status()} ${r.url()}`) })
  page.on('console', m => { if (m.type() === 'error' && allowSimulated503 && /status of 503/.test(m.text())) return; if (m.type() === 'error') unexpected.push(`${page.url()} ${m.text().slice(0, 600)}`) })
  page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 300)}`))
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message), error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase3-recovery-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name,
    allowance: 'ONE simulated 503 CONTEXT_TIMEOUT on POST /api/coach during the Coach retry step only', fixtures: ['exam date (Feb 2027) on the profile', 'cycle window shifted so room exists in real time', 'study windows 18:00-20:00 every day'], steps: rec.rows, cleanup, unexpected, cancelledReads }, null, 2))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

async function fitsViewport(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(w.scroll, `horizontal overflow on ${page.url()} (${JSON.stringify(w)})`).toBeLessThanOrEqual(w.client + 1)
  expect(w.client).toBeLessThanOrEqual(page.viewportSize()!.width)
}
const evidenceCounts = async () => Object.fromEntries(await Promise.all(['evidence_events', 'assessment_attempts', 'block_scope_confirmations', 'user_module_state', 'repair_threads', 'mock_appointments', 'mock_outcomes'].map(async t => [t, (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', S.id)).count]))) as Record<string, number>

async function fillReport(page: Page, o: { date: string; score: string; topics: Record<string, string>; difficulties: string[]; notes: string }) {
  await page.getByLabel('Date taken').fill(o.date)
  await page.getByRole('radio', { name: 'A full mock' }).check()
  await page.getByLabel(/Provider or name/).fill('Provider A')
  await page.getByLabel('Result type').selectOption('percent')
  await page.getByLabel('Percentage', { exact: true }).fill(o.score)
  await page.getByText('Subject results').click()
  for (const [name, v] of Object.entries(o.topics)) await page.getByLabel(`${name} result`).fill(v)
  for (const d of o.difficulties) await page.getByRole('checkbox', { name: d }).check()
  await page.getByLabel(/^Notes/).fill(o.notes)
}

test('48% candidate: record a past mock -> debrief -> choose scope -> reviewed proposal -> accept -> Calendar drawer -> partial work -> reload -> later report and weekly review; Coach retry after a context timeout', async ({ page }) => {
  test.setTimeout(540_000)
  const persona = await classLedPersona(db)
  const c = await createStudent(db, `p3${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  S.id = c.id; S.email = c.email
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', c.id).eq('status', 'active').single()).data!
  S.cycle = cyc.id as string; S.tz = (cyc.timezone as string) || S.tz
  S.today = new Intl.DateTimeFormat('en-CA', { timeZone: S.tz }).format(new Date())
  await rec.api('fixture: exam Feb 2027, open week with real room, limited study windows (18:00-20:00 daily), 45-minute sittings', async () => {
    await db.from('planning_cycles').update({ starts_at_local: addDays(S.today, -2), ends_at_local: addDays(S.today, 6) }).eq('id', S.cycle).throwOnError()
    await db.from('profiles').update({ max_session_minutes: 45, exam_date: '2027-02-20' }).eq('id', c.id).throwOnError()
    await db.from('plan_blocks').delete().eq('user_id', c.id).eq('cycle_id', S.cycle).throwOnError()
    await db.from('availability_windows').delete().eq('user_id', c.id).throwOnError()
    await db.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: c.id, weekday, start_time: '18:00', end_time: '20:00', status: 'active' }))).throwOnError()
  })
  await login(page, db, c.email)
  const base = await evidenceCounts()

  await rec.browser('Calendar offers "Record a mock already taken" without any booking; Tests offers it too', async () => {
    await page.goto('/app/calendar'); await fitsViewport(page)
    await expect(page.getByTestId('mock-reports')).toBeVisible()
    await page.goto('/app/tests?view=mocks'); await expect(page.getByTestId('tests-record-past-mock').getByRole('link', { name: 'Record a mock already taken' })).toHaveAttribute('href', '/app/calendar/mock-report'); await fitsViewport(page)
    await page.goto('/app/calendar'); await page.getByTestId('mock-reports').getByRole('link', { name: 'Record a mock already taken' }).click(); await page.waitForURL(/mock-report$/)
  })
  await rec.browser('record the 48% mock (FSA 35, Fixed Income 40, ran out of time, changed answers); a double click saves ONE report; the debrief opens', async () => {
    await fitsViewport(page)
    await fillReport(page, { date: addDays(S.today, -3), score: '48', topics: { 'Financial Statement Analysis': '35', 'Fixed Income': '40' }, difficulties: ['Ran out of time', 'Changed right answers to wrong ones'], notes: 'Ran out of time on the last section; changed several answers.' })
    await page.getByRole('button', { name: 'Save this mock' }).dblclick()
    await page.waitForURL(/mock-report\/[0-9a-f-]{36}$/); S.report = page.url().split('/').pop()!
    expect((await db.from('mock_reports').select('id').eq('user_id', c.id)).data).toHaveLength(1)
    await expect(page.getByTestId('report-summary')).toContainText('48%'); await expect(page.getByTestId('report-summary')).toContainText('Full mock')
    expect(await evidenceCounts()).toEqual(base)   // no booking, evidence, coverage or repair
    await fitsViewport(page)
  })
  await rec.browser('the debrief separates facts from hypotheses: source, what is NOT shown and the planning implication; no diagnosis, no pass talk', async () => {
    const d = page.getByTestId('debrief'); await expect(d).toBeVisible()
    for (const id of ['overall', 'topics', 'timing', 'answer_changes']) await expect(d.locator(`[data-finding="${id}"]`)).toBeVisible()
    const t = (await d.innerText()).replace(/\s+/g, ' ')
    expect(t).toMatch(/Source: your report/); expect(t).toMatch(/Not shown:/); expect(t).toMatch(/For planning:/)
    expect(t).toMatch(/does not mean the material was not understood/); expect(t).toMatch(/no universal rule/); expect(t).toMatch(/Not every reading in a subject is assumed weak/)
    expect(t).not.toMatch(/you will pass|you are ready|on track/i)
    await page.reload(); await expect(page.getByTestId('debrief')).toBeVisible()   // reload keeps it
  })
  await rec.browser('choose scope: readings in the reported subjects are the student\'s choice (nothing pre-selected), then preview the plan', async () => {
    for (const subject of ['Financial Statement Analysis', 'Fixed Income']) {
      const group = page.locator('details', { has: page.locator('summary', { hasText: subject }) }).first()
      await expect(group).toHaveJSProperty('open', true)
      const first = group.locator('input[type=checkbox]').first(); await expect(first).not.toBeChecked(); await first.check()
    }
    await expect(page.getByRole('checkbox', { name: 'Pacing and application practice' })).toBeChecked()
    await expect(page.getByRole('checkbox', { name: 'Review answer changes' })).toBeChecked()
    await page.getByLabel('Length of each sitting').selectOption('30')
    await page.getByRole('button', { name: 'Preview the plan' }).click()
    const pv = page.getByTestId('recovery-preview'); await expect(pv).toBeVisible()
    await expect(pv).toContainText('Nothing already in your week is moved, shortened or set aside')
    await expect(pv).toContainText('your own report, not test evidence')
    expect((await db.from('plan_blocks').select('id').eq('user_id', c.id).not('source_report_id', 'is', null)).data).toHaveLength(0)   // previewing wrote nothing
    await fitsViewport(page)
  })
  await rec.browser('confirm once (double click): exactly the previewed sittings exist, linked to the report, inside the sitting limit; no evidence or coverage changed', async () => {
    await page.getByRole('button', { name: 'Confirm and add to my week' }).dblclick()
    await page.waitForURL(u => u.pathname === '/app/calendar')
    const rows = (await db.from('plan_blocks').select('*').eq('user_id', c.id).eq('source_report_id', S.report)).data!
    expect(rows).toHaveLength(4); expect(rows.every(r => r.duration_minutes === 30 && r.local_date >= S.today && r.execution === 'not_started')).toBe(true)
    expect(new Set(rows.map(r => r.source_key)).size).toBe(4)
    expect(await evidenceCounts()).toEqual(base)
  })
  await rec.browser('Calendar shows the sittings; the drawer explains why, how, what done means, links the report and the exact reading', async () => {
    const row = (await db.from('plan_blocks').select('id, local_date, lm_id, title').eq('user_id', c.id).eq('source_report_id', S.report).not('lm_id', 'is', null).order('local_date').limit(1).single()).data!
    await page.goto(`/app/calendar?week=${row.local_date}&view=agenda&task=${row.id}`)
    const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await fitsViewport(page)
    await expect(d.getByText('How to approach it')).toBeVisible(); await expect(d.getByText('What done means')).toBeVisible(); await expect(d.getByText('Why this, now')).toBeVisible()
    await expect(d.getByTestId('task-source-report')).toContainText('your own mock report'); await expect(d.getByTestId('task-source-report').getByRole('link', { name: 'Open the report' })).toHaveAttribute('href', `/app/calendar/mock-report/${S.report}`)
    await expect(d.getByTestId('task-reading-links').getByRole('link', { name: /Curriculum/ })).toHaveAttribute('href', new RegExp(`/app/curriculum/.+/${row.lm_id}`))
    await d.getByRole('button', { name: 'Partly done' }).click(); await d.getByLabel('Actual minutes').fill('12'); await d.getByRole('button', { name: 'Save partial progress' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', row.id).single()).data!.execution).toBe('partial')
    expect((await db.from('plan_blocks').select('duration_minutes').eq('id', row.id).single()).data!.duration_minutes).toBe(30)   // planned minutes stay the plan
    expect((await db.from('task_events').select('actual_duration_minutes').eq('task_id', row.id).eq('event_type', 'partial')).data!.map(e => e.actual_duration_minutes)).toContain(12)
    await page.waitForLoadState('networkidle'); await page.reload(); await expect(page.getByRole('dialog')).toContainText(/partial/i); await page.waitForLoadState('networkidle')
    await page.keyboard.press('Escape')
  })
  await rec.browser('a later report on the same basis is a comparison, not a trend; scope, timing and adherence come first', async () => {
    await page.goto('/app/calendar/mock-report')
    await fillReport(page, { date: addDays(S.today, -1), score: '52', topics: {}, difficulties: ['Ran out of time'], notes: '' })
    await page.getByRole('button', { name: 'Save this mock' }).click(); await page.waitForURL(/mock-report\/[0-9a-f-]{36}$/); S.report2 = page.url().split('/').pop()!
    const cmp = page.getByTestId('comparison'); await expect(cmp).toContainText('a comparison, not a trend'); await expect(cmp).toContainText('how consistently')
    await expect(page.getByRole('heading', { name: 'Planned from this report' })).toHaveCount(0)   // sittings belong to the first report, not this one
  })
  await rec.browser('Calendar lists both reports; editing a report keeps accepted sittings and says so', async () => {
    await page.goto(`/app/calendar/mock-report?edit=${S.report}`); await page.getByLabel('Percentage', { exact: true }).fill('49')
    await page.getByRole('button', { name: 'Save changes' }).click(); await page.waitForURL(/mock-report\/[0-9a-f-]{36}$/)
    await expect(page.getByTestId('report-summary')).toContainText('49%'); await expect(page.getByTestId('report-edited-note')).toContainText('Your accepted sittings are unchanged')
    expect((await db.from('plan_blocks').select('id').eq('user_id', c.id).eq('source_report_id', S.report)).data).toHaveLength(4)
    expect((await db.from('mock_reports').select('version').eq('id', S.report).single()).data!.version).toBe(2)
  })
  await rec.browser('weekly review reports the actual work from the report (done, partly done, still open) as the student\'s own report', async () => {
    await page.goto('/app/review-week'); const r = page.getByTestId('review-recovery'); await expect(r).toBeVisible()
    await expect(r).toContainText('1 partly done'); await expect(r).toContainText('3 still open'); await expect(r).toContainText('not test evidence'); await fitsViewport(page)
  })
  await rec.browser('Coach: the exact poor-mock message links the saved report (no booking exists); reply stays self-reported and writes nothing', async () => {
    await page.goto('/app/coach')
    const before = await evidenceCounts()
    const box = page.getByRole('textbox', { name: 'Ask the coach' }); const n0 = await page.locator('.coach-message--coach').count()
    await box.fill('My February mock was 48%; FSA 35%, Fixed Income 40%. I ran out of time and changed right answers to wrong.'); await box.press('Enter')
    await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 60_000 }).toBeGreaterThan(n0); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 60_000 })
    const reply = page.locator('.coach-message--coach').last(); const t = (await reply.innerText()).replace(/\s+/g, ' ')
    expect(t).toMatch(/not test evidence/); expect(t).not.toMatch(/you will pass|on track|probab/i)
    await expect(reply.getByRole('link', { name: 'Open your saved mock report' })).toHaveAttribute('href', new RegExp(`/app/calendar/mock-report/(${S.report}|${S.report2})`))
    expect(await evidenceCounts()).toEqual(before)
  })
  await rec.browser('Coach context timeout: a retryable answer keeps the question, and Retry (same turn key) produces exactly one answer', async () => {
    await page.goto('/app/coach')
    let calls = 0, firstKey = '', keys: string[] = []
    await page.route('**/api/coach', async route => {
      const req = route.request(); if (req.method() !== 'POST') return route.continue()
      calls++; const key = JSON.parse(req.postData() ?? '{}').turnKey as string; keys.push(key)
      if (calls === 1) { firstKey = key; allowSimulated503 = true; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 'CONTEXT_TIMEOUT', error: 'Your current plan could not be checked in time. Your question is saved; send it again to retry.', turnKey: key, retry: true }) }) }
      return route.continue()
    })
    const box = page.getByRole('textbox', { name: 'Ask the coach' })
    await box.fill('What should I do today?'); await box.press('Enter')
    await expect(page.locator('.coach-error[role=alert]')).toContainText('could not be checked in time'); allowSimulated503 = false
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.coach-message--coach').last()).toContainText(/\w/, { timeout: 60_000 }); await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 60_000 })
    expect(keys.length).toBe(2); expect(keys[1]).toBe(firstKey)   // the retry reuses the SAME turn key
    expect((await db.from('coach_messages').select('id').eq('user_id', c.id).eq('turn_key', firstKey).eq('role', 'student')).data).toHaveLength(1)
    expect((await db.from('coach_messages').select('id').eq('user_id', c.id).eq('turn_key', firstKey).eq('role', 'coach')).data).toHaveLength(1)
    await page.unroute('**/api/coach'); await fitsViewport(page)
  })
  await rec.browser('withdrawing a report keeps the planned sittings and says what changed; keyboard: the form is reachable by Tab', async () => {
    await page.goto(`/app/calendar/mock-report/${S.report2}`); await page.getByRole('button', { name: 'Withdraw it' }).click(); await page.getByRole('button', { name: 'Yes, withdraw' }).click()
    await page.waitForURL(u => u.pathname === '/app/calendar')
    expect((await db.from('mock_reports').select('status').eq('id', S.report2).single()).data!.status).toBe('withdrawn')
    expect((await db.from('plan_blocks').select('id').eq('user_id', c.id).eq('source_report_id', S.report)).data).toHaveLength(4)
    await page.goto('/app/calendar/mock-report'); let found = false
    for (let i = 0; i < 40 && !found; i++) { await page.keyboard.press('Tab'); found = await page.evaluate(() => document.activeElement?.tagName === 'INPUT' && (document.activeElement as HTMLInputElement).type === 'date') }
    expect(found).toBe(true)
  })
})
