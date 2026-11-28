/**
 * Focused browser controls on one fresh ordinary student per viewport:
 *  - Calendar's own edit control moves a task (one `moved` event) and re-places a DEFERRED task back into the plan (one `moved` event carrying reopened:true)
 *  - Actual-bank shortage: Tests says so honestly, offers no broken paper-start action, and Calendar / logging / review stay usable
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN } from './helpers'
import { todayInZone } from '../../../src/lib/planning/studyWeek'

const db = admin(), rec = recorder(), owned: string[] = []
const S: { id: string; email: string; tasks: any[] } = { id: '', email: '', tasks: [] }
test.describe.configure({ mode: 'serial' })
const consoleErrors: string[] = []
test.beforeEach(({ page }) => { page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${page.url()} ${m.text().slice(0, 200)}`) }); page.on('pageerror', e => consoleErrors.push(`${page.url()} PAGEERROR ${e.message.slice(0, 200)}`)) })
test.beforeAll(async () => { const st = await createStudent(db, `lf${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = st.id; S.email = st.email
  S.tasks = (await db.from('plan_blocks').select('id, title, local_date, execution, revision, task_type, scope_group_id, dependencies, lm_id, outcome_id').eq('user_id', S.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').order('title').throwOnError()).data ?? [] })
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) {
    const { error } = await db.auth.admin.deleteUser(id)
    // createStudent has already removed this same ID if setup failed.
    const ok = !error || error.status === 404
    cleanup.push({ what: `student ${id}`, ok, error: ok ? undefined : error?.message })
  }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/lifecycle-browser-focused-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, consoleErrors, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(consoleErrors, 'unexpected console / page errors').toEqual([])
})
const events = async (id: string, type: string) => (await db.from('task_events').select('event_type, payload').eq('task_id', id).eq('event_type', type)).data ?? []

test('Calendar edit control: move a task, then defer another and place it back (one moved event with reopened:true)', async ({ page }) => {
  await login(page, db, S.email)
  // Generated work may all be split. Create two independent tasks through the ordinary owned command.
  const date = todayInZone('Europe/London')
  const independent = async (title: string) => {
    const response = await page.request.post('/api/tasks', { data: { key: crypto.randomUUID(), title, date, durationMinutes: 20, acceptWarnings: true } })
    expect(response.status()).toBe(200)
    const { task } = await response.json()
    const { data } = await db.from('plan_blocks').select('id, local_date, revision').eq('id', task.id).eq('user_id', S.id).single().throwOnError()
    return data!
  }
  const t = await independent('Unsplit study fixture')
  const u = await independent('Independent deferral fixture')
  const open = async (x: any) => { await page.goto(`/app/calendar?view=agenda&week=${x.local_date}&task=${x.id}`); const d = page.getByRole('dialog'); await expect(d).toBeVisible(); return d }
  await rec.browser('the drawer\'s Day and Start fields move the task; exactly one moved event is recorded and the revision advances', async () => {
    const d = await open(t); const days = d.getByRole('combobox', { name: 'Day' })
    const options = await days.locator('option:not([disabled])').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))
    const target = options.find(v => v !== t.local_date)!; expect(target).toBeTruthy()
    await days.selectOption(target); await d.getByRole('textbox', { name: 'Start' }).fill('19:30')
    const saved = page.waitForResponse(r => r.request().method() === 'PATCH' && new URL(r.url()).pathname === `/api/tasks/${t.id}`)
    await d.getByRole('button', { name: 'Apply' }).click()
    expect((await saved).status(), 'the selected placement is accepted').toBe(200)
    await expect.poll(async () => (await db.from('plan_blocks').select('local_date, placement, revision').eq('id', t.id).single()).data?.local_date, { timeout: 20_000 }).toBe(target)
    const row = (await db.from('plan_blocks').select('placement, revision, starts_at').eq('id', t.id).single()).data!
    expect(row.placement).toBe('timed'); expect(Number(row.revision)).toBeGreaterThan(Number(t.revision)); expect((await events(t.id, 'moved')).length).toBe(1)
  })
  await rec.browser('defer a task in the drawer, then "Place it and reopen": back to open work with ONE moved event carrying reopened:true', async () => {
    let d = await open(u); await d.getByRole('button', { name: 'Defer', exact: true }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', u.id).single()).data?.execution, { timeout: 20_000 }).toBe('deferred')
    d = await open(u); const days = d.getByRole('combobox', { name: 'Day' })
    const options = await days.locator('option:not([disabled])').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value)); await days.selectOption(options[options.length - 1])
    await d.getByRole('button', { name: 'Place it and reopen' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', u.id).single()).data?.execution, { timeout: 20_000 }).toBe('not_started')
    const ev = await events(u.id, 'moved'); expect(ev.length).toBe(1); expect((ev[0].payload as any).reopened).toBe(true)
  })
  await noHorizontalOverflow(page)
})

test('actual-bank shortage: the student is told, no paper-start action is offered, and Calendar, logging and review stay usable', async ({ page }) => {
  const { count: ids } = await db.from('student_eligible_items').select('id', { count: 'exact', head: true }).throwOnError()
  if (ids === null) throw new Error('Could not count the actual bank.')
  test.skip(ids > 0, `eligible inventory exists (${ids} items, possibly another worker's fixture bank): this is not an actual-shortage run`)
  await login(page, db, S.email)
  const t = S.tasks.find(task => task.lm_id)
  expect(t, 'the fixture needs a mapped reading').toBeTruthy()
  const { data: reading } = await db.from('curriculum_readings').select('reading_no').eq('id', t.lm_id).single().throwOnError()
  await page.goto('/app/log')
  await page.getByRole('radio', { name: /Log a separate session/ }).click()
  await page.getByLabel('Search readings').fill(String(reading!.reading_no))
  await page.getByRole('option').first().click()
  await page.getByRole('checkbox').first().check()
  await page.getByRole('button', { name: '45m' }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Session logged.' })).toBeVisible()
  await rec.browser('Tests: no "Start weekly paper" action exists while the bank cannot serve it; the page explains and offers a working planning path', async () => {
    await page.goto('/app/tests')
    await expect(page.getByRole('button', { name: /Start weekly paper|Review and start/ })).toHaveCount(0)
    await expect(page.locator('.weekly-card').getByRole('status')).toContainText(/question|bank/i)
    await noHorizontalOverflow(page)
    const next = page.locator('.weekly-card a.primary-button, .weekly-card a.secondary-button').first(); await expect(next).toBeVisible()
    const href = await next.getAttribute('href'); expect(href).toBeTruthy()
    const r = await page.request.get(href!); expect(r.status(), `the offered path ${href} works`).toBeLessThan(400)
  })
  await rec.browser('Calendar, logging, Curriculum and the weekly review all still open and fit the viewport', async () => {
    for (const path of ['/app/calendar', '/app/log', '/app/curriculum', '/app/review-week', '/app']) { const r = await page.goto(path); expect(r!.status(), path).toBeLessThan(400); await noHorizontalOverflow(page) }
  })
})
