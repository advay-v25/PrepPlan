import { test, expect } from '@playwright/test'
import { noHorizontalOverflow } from './helpers'
import { scopedErrors } from './scopedErrors'

test('the public walkthrough works without an account and sends no app writes', async ({ page }) => {
  const events = scopedErrors()
  events.attach(page)
  const writes: string[] = []
  page.on('request', request => {
    if (/\/api\//.test(request.url()) && request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Try the walkthrough' }).click()
  await expect(page.getByRole('heading', { name: 'Try a study week' })).toBeVisible()
  await noHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Open the sample paper' }).click()
  await page.getByRole('radio', { name: '$9,200', exact: true }).check()
  await expect(page.getByRole('button', { name: 'See my example result' })).toBeDisabled()
  await page.getByRole('radio', { name: 'Sure', exact: true }).check()
  await page.getByRole('button', { name: 'See my example result' }).click()
  await expect(page.getByText('0 of 1 correct')).toBeVisible()
  await page.getByRole('button', { name: 'Review the week' }).click()
  await page.getByRole('checkbox', { name: /Carry the missed/ }).uncheck()
  await page.getByRole('button', { name: 'Show the adjusted week' }).click()
  await expect(page.getByText(/Rework the gain calculation/)).toBeVisible()
  await expect(page.getByText(/Continue the retrieval session/)).toHaveCount(0)
  await page.getByRole('link', { name: 'Sign in to PrepPlan' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect(writes).toEqual([])
  expect(events.unexpected).toEqual([])
})
