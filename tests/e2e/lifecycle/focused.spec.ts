/**
 * Focused browser controls on one fresh ordinary student per viewport:
 *  - Calendar's own edit control moves a task (one `moved` event) and re-places a DEFERRED task back into the plan (one `moved` event carrying reopened:true)
 *  - Actual-bank shortage: Tests says so honestly, offers no broken paper-start action, and Calendar / logging / review stay usable
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN, wd } from './helpers'

const db = admin(), rec = recorder(), owned: string[] = []
const S: { id: string; email: string; tasks: any[] } = { id: '', email: '', tasks: [] }
test.describe.configure({ mode: 'serial' })
const consoleErrors: string[] = []
test.beforeEach(({ page }) => { page.on('console', m => { if (m.type() === 'error') consoleErrors.push(`${page.url()} ${m.text().slice(0, 200)}`) }); page.on('pageerror', e => consoleErrors.push(`${page.url()} PAGEERROR ${e.message.slice(0, 200)}`)) })
test.beforeAll(async () => { const st = await createStudent(db, `lf${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = st.id; S.email = st.email
  S.tasks = (await db.from('plan_blocks').select('id, title, local_date, execution, revision, task_type').eq('user_id', S.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').order('title')).data ?? [] })
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/lifecycle-browser-focused-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, consoleErrors, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(consoleErrors, 'unexpected console / page errors').toEqual([])
})
const events = async (id: string, type: string) => (await db.from('task_events').select('event_type, payload').eq('task_id', id).eq('event_type', type)).data ?? []

test('Calendar edit control: move a task, then defer another and place it back (one moved event with reopened:true)', async ({ page }) => {
  await login(page, db, S.email)
  const t = S.tasks[0], u = S.tasks[1]
  const open = async (x: any) => { await page.goto(`/app/calendar?view=agenda&week=${x.local_date}&task=${x.id}`); const d = page.getByRole('dialog'); await expect(d).toBeVisible(); return d }
  await rec.browser('the drawer\'s Day and Start fields move the task; exactly one moved event is recorded and the revision advances', async () => {
    const d = await open(t); const days = d.getByRole('combobox', { name: 'Day' })
    const options = await days.locator('option:not([disabled])').evaluateAll(os => os.map(o => (o as HTMLOptionElement).value))
    const target = options.find(v => v !== t.local_date)!; expect(target).toBeTruthy()
    await days.selectOption(target); await d.getByRole('textbox', { name: 'Start' }).fill('19:30'); await d.getByRole('button', { name: 'Apply' }).click()
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
  const ids = ((await db.from('student_eligible_items').select('id')).data ?? []).length
  test.skip(ids > 0, `eligible inventory exists (${ids} items, possibly another worker's fixture bank): this is not an actual-shortage run`)
  await login(page, db, S.email)
  // finish the first planned sitting through the real Calendar command so there is scope for the paper decision to be about the BANK, not about missing scope
  const t = S.tasks[2]
  await page.goto(`/app/calendar?view=agenda&week=${t.local_date}&task=${t.id}`)
  const d = page.getByRole('dialog'); await d.getByRole('button', { name: 'Done', exact: true }).click(); await d.getByRole('button', { name: 'Save as done' }).click()
  await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', t.id).single()).data?.execution, { timeout: 20_000 }).toBe('completed')
  await rec.browser('Tests: no "Start weekly paper" action exists while the bank cannot serve it; the page explains and offers a working planning path', async () => {
    await page.goto('/app/tests')
    await expect(page.getByRole('button', { name: /Start weekly paper|Review and start/ })).toHaveCount(0)
    await expect(page.locator('.weekly-card')).toBeVisible(); await noHorizontalOverflow(page)
    const next = page.locator('.weekly-card a.primary-button, .weekly-card a.secondary-button').first(); await expect(next).toBeVisible()
    const href = await next.getAttribute('href'); expect(href).toBeTruthy()
    const r = await page.request.get(href!); expect(r.status(), `the offered path ${href} works`).toBeLessThan(400)
  })
  await rec.browser('Calendar, logging, Curriculum and the weekly review all still open and fit the viewport', async () => {
    for (const path of ['/app/calendar', '/app/log', '/app/curriculum', '/app/review-week', '/app']) { const r = await page.goto(path); expect(r!.status(), path).toBeLessThan(400); await noHorizontalOverflow(page) }
  })
  void wd
})
