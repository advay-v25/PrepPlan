/** Owned fixture: an exhausted estimate with explicitly PARTIAL work. The review, history, removal and reload are driven through the UI. */
import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { saveReport } from '../../../src/lib/mocks/reportService'
import { addDays, todayInZone } from '../../../src/lib/planning/studyWeek'
import { admin, login } from './helpers'

const db = admin(), owned: string[] = []
// The development server compiles a route on its first request, which can outlast an assertion's wait. The recovery route is asked for once
// beforehand (unauthenticated, so nothing happens); the journey and its assertions are unchanged. A production build needs no warming.
test.beforeAll(async ({}, info) => { await fetch(`${info.project.use.baseURL}/api/mock-reports/00000000-0000-4000-8000-000000000000/recovery`, { method: 'POST', signal: AbortSignal.timeout(120_000) }).catch(() => {}) })
test.afterEach(async () => {
  for (const id of owned.splice(0)) {
    const r = await db.auth.admin.deleteUser(id)
    expect(r.error, 'owned student cleanup').toBeNull()
  }
})
test('recovery time does not imply completion; review the sitting, explicitly clear the last choice, and reload', async ({ page }, info) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()) })
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`) })
  const student = await createStudent(db, 'mockprogressbrowser', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('id, timezone').eq('user_id', student.id).eq('status', 'active').single().throwOnError()).data!
  const today = todayInZone(cycle.timezone), closed = randomUUID()
  await db.from('planning_cycles').insert({ id: closed, user_id: student.id, status: 'closed', starts_at: addDays(today, -7), ends_at: today, starts_at_local: addDays(today, -7), ends_at_local: today, timezone: cycle.timezone }).throwOnError()
  const report = (await saveReport(student.id, { action: 'create', key: randomUUID(), input: { takenOn: addDays(today, -2), scope: 'full', scale: 'percent', score: 48, difficulties: ['ran_out_of_time'] } })).report
  await db.from('mock_reports').update({ plan_selection: { items: [{ key: 'pacing', kind: 'pacing', minutes: 30 }] } }).eq('id', report.id).throwOnError()
  const task = `owner-progress-${randomUUID()}`
  await db.from('plan_blocks').insert({ id: task, user_id: student.id, cycle_id: closed, local_date: addDays(today, -2), day: addDays(today, -2), title: 'Review pacing practice', detail: '', task_type: 'review', origin: 'planner', created_by: 'algorithm', priority: 'core', placement: 'day_preferred', execution: 'partial', duration_minutes: 30, duration: '30', source_report_id: report.id, source_key: 'pacing:1', source_report_version: 1 }).throwOnError()
  await db.from('task_events').insert({ user_id: student.id, task_id: task, event_type: 'partial', actual_duration_minutes: 30, payload: {}, previous: {} }).throwOnError()
  await login(page, db, student.email)
  await page.goto('/app/calendar')
  await expect(page.getByTestId('recovery-waiting')).toContainText('needs a completion decision')
  await page.getByRole('link', { name: 'Review the follow-up' }).click()
  await expect(page.getByTestId('recovery-already')).toContainText('Completion has not been confirmed')
  await page.getByRole('link', { name: 'Review this sitting' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('Review pacing practice')
  await page.getByRole('dialog').locator(`a[href="/app/calendar/mock-report/${report.id}"]`).click()
  await page.getByLabel('Pacing and application practice', { exact: true }).uncheck()
  await page.getByRole('button', { name: 'Preview the plan', exact: true }).click()
  const confirm = page.getByRole('button', { name: 'Confirm follow-up changes' })
  await expect(confirm).toBeDisabled()
  await page.getByTestId('recovery-drop').getByRole('checkbox').check()
  await confirm.click()
  await page.waitForURL(u => u.pathname === '/app/calendar')
  const saved = (await db.from('mock_reports').select('plan_selection').eq('id', report.id).single().throwOnError()).data!
  expect(saved.plan_selection.items).toEqual([])
  expect((await db.from('plan_blocks').select('execution').eq('id', task).single().throwOnError()).data!.execution).toBe('partial')
  await page.goto(`/app/calendar/mock-report/${report.id}`)
  await page.reload()
  await expect(page.getByLabel('Pacing and application practice', { exact: true })).not.toBeChecked()
  await expect(page.getByTestId('recovery-remainder')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: `/tmp/roadmap-p3-progress-${info.project.name}.png`, fullPage: false })
  expect(errors).toEqual([])
})
