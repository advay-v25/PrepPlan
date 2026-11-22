/** The completed-sitting and retake screens, including the canonical date editor. Only the past-exam premise is preloaded. */
import { test, expect } from '@playwright/test'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, RUN, addDays } from './helpers'
const db = admin(), owned: string[] = [], S = { id: '', email: '' }
test.beforeAll(async () => { const a = await createStudent(db, `p7r${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = a.id; S.email = a.email })
test.afterAll(async () => { for (const id of owned.splice(0)) await db.auth.admin.deleteUser(id) })
test('review a new sitting, cancel, refuse a stale date and resume the saved plan', async ({ page, context }) => {
  const today = new Intl.DateTimeFormat('en-CA').format(new Date()), sat = addDays(today, -10)
  const { data: windows } = await db.from('exam_windows').select('sitting,window_opens').eq('year', 2027).gt('window_opens', today).order('window_opens').limit(2).throwOnError()
  if (!windows || windows.length !== 2) throw Error('This journey needs two upcoming exam windows.')
  await db.from('profiles').update({ exam_date: sat }).eq('id', S.id).throwOnError()
  await login(page, db, S.email, '/app/exam')
  const editDate = async (tab: typeof page, i: number) => {
    const window = windows[i]
    await tab.getByRole('button', { name: new RegExp(`^${window.sitting}`, 'i') }).click()
    await tab.getByRole('button', { name: 'Yes, I have a date' }).click()
    await tab.getByLabel('Exact booked exam date').fill(String(window.window_opens).slice(0, 10))
    await tab.getByRole('button', { name: 'Save', exact: true }).click()
    const continueAfterImpact = tab.getByRole('button', { name: 'Continue', exact: true })
    await expect(tab.getByRole('heading', { name: 'After the exam' }).or(continueAfterImpact)).toBeVisible()
    if (await continueAfterImpact.isVisible()) await continueAfterImpact.click()
    await expect(tab).toHaveURL(/\/app\/exam/)
  }
  await page.getByRole('button', { name: 'I sat the exam', exact: true }).click()
  await expect(page.locator('[data-exam-phase="sat"]')).toBeVisible()
  await page.getByLabel('What you were told').fill('my band')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Saved as your own report.')).toBeVisible()
  await page.getByRole('button', { name: 'Request a retake plan' }).click()
  await page.getByRole('link', { name: 'Choose your next exam date' }).click()
  await editDate(page, 0)
  const prepare = async () => {
    await page.getByRole('button', { name: 'Preview my retake plan' }).click()
    await expect(page.getByTestId('retake-preview')).toBeVisible()
    await noHorizontalOverflow(page)
  }
  await prepare()
  await page.getByRole('button', { name: 'Cancel preview' }).click()
  await expect(page.getByText('Preview cancelled. Study is still paused.')).toBeVisible()
  expect((await db.from('exam_completion_history').select('id').eq('user_id', S.id)).data).toEqual([])
  await prepare()
  const second = await context.newPage()
  await second.goto('/onboarding/exam?returnTo=/app/exam')
  await editDate(second, 1)
  await second.close()
  await page.getByRole('button', { name: 'Start preparing for this sitting' }).click()
  const examAlert = page.locator('[data-exam-phase="sat"]').getByRole('alert')
  await expect(examAlert).toContainText('Prepare a new preview')
  await expect(page.locator('[data-exam-phase="sat"]')).toBeVisible()
  await prepare()
  let lost = false
  await page.route('**/api/exam', async route => {
    if (!lost && route.request().method() === 'POST' && route.request().postDataJSON().action === 'activate_retake') {
      const response = await route.fetch()
      if (response.ok()) { lost = true; await route.abort(); return }
      await route.fulfill({ response }); return
    }
    await route.continue()
  })
  const start = page.getByRole('button', { name: 'Start preparing for this sitting' })
  await start.click()
  await expect(examAlert).toContainText('We could not confirm the result')
  await start.click()
  await expect(page.getByRole('status').filter({ hasText: /New sitting started/ })).toBeVisible()
  await page.reload()
  await expect(page.locator('[data-exam-phase="sat"]')).toHaveCount(0)
  await expect(page.locator('[data-retake-activate]')).toHaveCount(0)
  const h = (await db.from('exam_completion_history').select('sat_on, reported_result').eq('user_id', S.id)).data!
  expect(h).toEqual([{ sat_on: sat, reported_result: 'my band' }])
  await expect(page.getByRole('heading', { name: 'Previous sittings' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Calendar at this sitting' })).toHaveAttribute('href', `/app/calendar?week=${sat}`)
  await noHorizontalOverflow(page)
})
