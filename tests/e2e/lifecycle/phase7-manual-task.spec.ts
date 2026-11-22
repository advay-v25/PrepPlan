/**
 * Phase 7 §4: adding a study task is ONE retry-safe command. Desktop + 390px, an owned student with an accepted first week (SEEDED via createStudent).
 * UI-driven: the toolbar "Add study task" with an explicit day, a lost response retried under the same key (one task, one history event),
 * the one-time window/limit warning, and a system type refused at the endpoint. Assertions read plan_blocks and task_events.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN, J } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '' }, se = scopedErrors()
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { const a = await createStudent(db, `p7${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = a.id; S.email = a.email })
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message) }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase7-manual-task-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, seeded: 'student + accepted first week via createStudent onboarding', unexpected: se.unexpected, allowances: se.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(se.unexpected, 'unexpected console/page errors').toEqual([])
})
const mine = async (title: string) => (await db.from('plan_blocks').select('id, origin, task_type, execution, local_date, starts_at, duration_minutes, cycle_id, cancelled_at').eq('user_id', S.id).eq('title', title)).data ?? []
const created = async (id: string) => (await db.from('task_events').select('id').eq('task_id', id).eq('event_type', 'created')).data?.length ?? 0

test('Add study task: explicit day, lost response retried once, one-time warning, system type refused', async ({ page }) => {
  await login(page, db, S.email, '/app/calendar')
  const todayIso = (await db.from('planning_cycles').select('starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data!
  const open = () => page.getByRole('button', { name: 'Add study task' })
  const T1 = `Reread worked examples ${RUN}`, T2 = `Long catch-up ${RUN}`, T5 = `Clean add ${RUN}`, T6 = `Never reached ${RUN}`
  await rec.browser('the Add study task action is reachable and the page fits the viewport', async () => {
    await expect(open()).toBeVisible(); await noHorizontalOverflow(page)
  })
  await rec.browser('a task is added on an explicitly chosen day with the time left open', async () => {
    await open().click()
    const dlg = page.getByRole('dialog')
    const day = dlg.getByLabel('Day'); await expect(day).toBeVisible()
    const chosen = await day.inputValue(); expect(chosen).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await expect(dlg.getByLabel(/Start time/)).toHaveCount(0) // toolbar entry leaves the time open
    await dlg.getByLabel('What is it?').fill(T1)
    // the reply is lost AFTER the server committed: nothing is shown as added until it is known
    let seen = 0
    await se.expecting([{ label: 'owned add-task reply lost after commit', url: /\/api\/tasks$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
      await page.route('**/api/tasks', async route => { if (route.request().method() !== 'POST' || seen++ > 0) return route.continue(); await route.fetch(); await route.abort() })
      await dlg.getByRole('button', { name: 'Add task' }).click()
      await expect(dlg.getByRole('alert')).toContainText(/Press Retry/i)
    })
    expect((await mine(T1)).length).toBe(1) // committed
    await expect(dlg.getByLabel('What is it?')).toBeDisabled() // the submitted request is frozen with its key
    await expect(dlg.getByText(/Check your Calendar for/)).toBeVisible()
    await dlg.getByRole('button', { name: 'Retry' }).click() // same key + same payload: replay
    const receipt = page.locator('[data-task-receipt]')
    await expect(receipt).toHaveAttribute('data-task-receipt', 'replayed')
    await expect(receipt).toContainText(/already saved earlier. Nothing new was added/i)
    await expect(receipt).not.toContainText(/^Added/)
    await expect(page.getByRole('link', { name: 'Open in Calendar' })).toHaveAttribute('href', /task=task-/)
    await page.unroute('**/api/tasks')
    await dlg.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const rows = await mine(T1)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ origin: 'student', task_type: 'study', execution: 'not_started', local_date: chosen, starts_at: null, duration_minutes: 45 })
    expect(await created(rows[0].id)).toBe(1)
    await noHorizontalOverflow(page)
  })
  await rec.browser('a clean save says Added; Cancel, Escape and the overlay do nothing while a save is in flight', async () => {
    await open().click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('What is it?').fill(T5)
    let release!: () => void; const gate = new Promise<void>(r => { release = r })
    await page.route('**/api/tasks', async route => { if (route.request().method() !== 'POST') return route.continue(); await gate; await route.continue() })
    await dlg.getByRole('button', { name: 'Add task' }).click()
    await expect(dlg.getByRole('button', { name: /Adding/ })).toBeDisabled()
    await expect(dlg.getByLabel('What is it?')).toBeDisabled()
    await expect(dlg.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await page.keyboard.press('Escape')
    await page.mouse.click(2, 2) // the overlay
    await expect(page.getByRole('dialog')).toHaveCount(1)
    release()
    await expect(page.locator('[data-task-receipt]')).toHaveAttribute('data-task-receipt', 'created')
    await expect(page.locator('[data-task-receipt]')).toContainText(`Added “${T5}”`)
    await page.unroute('**/api/tasks')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    expect((await mine(T5))).toHaveLength(1)
  })
  for (const mode of ['completed', 'deleted'] as const) {
    await rec.browser(`a task ${mode} after a lost reply: the retry reports the earlier save and its state, and does not bring it back`, async () => {
      const T = `${mode === 'completed' ? 'Edited' : 'Removed'} after loss ${RUN}`
      await open().click()
      const dlg = page.getByRole('dialog')
      await dlg.getByLabel('What is it?').fill(T)
      let n = 0
      await se.expecting([{ label: `owned add-task reply lost (${mode})`, url: /\/api\/tasks$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
        await page.route('**/api/tasks', async route => { if (route.request().method() !== 'POST' || n++ > 0) return route.continue(); await route.fetch(); await route.abort() })
        await dlg.getByRole('button', { name: 'Add task' }).click()
        await expect(dlg.getByRole('alert')).toContainText(/Press Retry/i)
      })
      const [row] = await mine(T); expect(row).toBeTruthy()
      const rev = (await db.from('plan_blocks').select('revision').eq('id', row.id).single()).data!.revision
      const res = mode === 'completed'
        ? await page.request.patch(`/api/tasks/${row.id}`, { headers: J, data: { action: 'execution', execution: 'completed', expectedRevision: rev, actualDurationMinutes: 20 } })
        : await page.request.delete(`/api/tasks/${row.id}?expectedRevision=${rev}`)
      expect(res.ok()).toBe(true)
      await dlg.getByRole('button', { name: 'Retry' }).click()
      const receipt = page.locator('[data-task-receipt]')
      await expect(receipt).toHaveAttribute('data-task-receipt', 'replayed')
      await expect(receipt).toContainText(mode === 'completed' ? /Its status now: completed/ : /no longer on your Calendar/)
      await page.unroute('**/api/tasks')
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      const after = (await mine(T)).filter(r => !r.cancelled_at && r.execution !== 'deleted')
      expect(after.length).toBe(mode === 'completed' ? 1 : 0)
      if (mode === 'completed') expect(after[0].execution).toBe('completed')
    })
  }
  await rec.browser('Start a different task after an uncertain reply mints a new request; the changed one is never sent under the old key', async () => {
    await open().click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('What is it?').fill(T6)
    let n = 0
    await se.expecting([{ label: 'owned add-task reply lost (different task)', url: /\/api\/tasks$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
      await page.route('**/api/tasks', async route => { if (route.request().method() !== 'POST' || n++ > 0) return route.continue(); await route.abort() }) // never reaches the server
      await dlg.getByRole('button', { name: 'Add task' }).click()
      await expect(dlg.getByRole('alert')).toContainText(/Press Retry/i)
    })
    expect(await mine(T6)).toHaveLength(0) // not committed
    await dlg.getByRole('button', { name: 'Start a different task' }).click()
    await expect(dlg.getByLabel('What is it?')).toBeEnabled()
    await dlg.getByLabel('What is it?').fill(`${T6} changed`)
    await dlg.getByRole('button', { name: 'Add task' }).click()
    await expect(page.locator('[data-task-receipt]')).toHaveAttribute('data-task-receipt', 'created')
    await page.unroute('**/api/tasks')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    expect(await mine(T6)).toHaveLength(0); expect(await mine(`${T6} changed`)).toHaveLength(1)
  })
  await rec.browser('a sitting above the usual limit asks once, then keeps the choice without changing Settings', async () => {
    const before = (await db.from('profiles').select('max_session_minutes').eq('id', S.id).single()).data!.max_session_minutes
    await open().click()
    const dlg = page.getByRole('dialog')
    await dlg.getByLabel('What is it?').fill(T2); await dlg.getByLabel('How long?').selectOption('120')
    await se.expecting([{ label: 'one-time placement warning (409 NEEDS_CONFIRMATION)', url: /\/api\/tasks$/, statuses: [409], method: 'POST', min: 1, max: 1 }], async () => {
      await dlg.getByRole('button', { name: 'Add task' }).click()
      await expect(dlg.getByRole('alert')).toContainText(/longer than your usual/i)
    })
    expect(await mine(T2)).toHaveLength(0)
    await dlg.getByRole('button', { name: 'Add it anyway' }).click()
    await expect(page.locator('[data-task-receipt]')).toHaveAttribute('data-task-receipt', 'created')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await mine(T2)).toHaveLength(1)
    expect((await db.from('profiles').select('max_session_minutes').eq('id', S.id).single()).data!.max_session_minutes).toBe(before)
  })
  await rec.browser('the downloaded personal-data export, parsed in the browser session, contains the creation receipt with its original request and result', async () => {
    const res = await page.request.get('/api/account/export'); expect(res.status()).toBe(200)
    const j = JSON.parse(await res.text())
    const t1 = (await mine(T1))[0]
    const r = (j.tables.task_create_receipts as any[]).find(x => x.key === t1.id)
    expect(r, 'receipt present in the download').toBeTruthy()
    expect(r.request).toMatchObject({ title: T1, minutes: 45, priority: 'core' })
    expect(r.result).toMatchObject({ id: t1.id, title: T1 })
    expect(j.counts.task_create_receipts).toBe(j.tables.task_create_receipts.length)
  })
  await rec.browser('system work cannot be added by hand: repair, re-check and mock types are refused with nothing written', async () => {
    await se.expecting([{ label: 'refused system types (400 BAD_TYPE)', url: /\/api\/tasks$/, statuses: [400], method: 'POST', min: 0, max: 3 }], async () => {
      for (const type of ['repair', 'recheck', 'mock']) {
        const res = await page.request.post('/api/tasks', { headers: J, data: { key: crypto.randomUUID(), title: `Sneaky ${type} ${RUN}`, date: todayIso.starts_at_local, startMinutes: null, durationMinutes: 30, taskType: type, acceptWarnings: true } })
        expect(res.status(), type).toBe(400)
        expect((await mine(`Sneaky ${type} ${RUN}`))).toHaveLength(0)
      }
    })
  })
})
