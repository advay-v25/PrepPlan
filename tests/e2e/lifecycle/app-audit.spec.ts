import { expect, test, type Page } from '@playwright/test'
import { classLedPersona, createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, TARGET } from './helpers'

const BASE_TITLES = [
  ['/', 'CFA Level I study planner'],
  ['/login', 'Sign in'],
  ['/signup', 'Create account'],
  ['/forgot-password', 'Forgot password'],
  ['/check-email', 'Check your email'],
  ['/not-invited', 'Private beta invitation'],
  ['/demo', 'Planner walkthrough'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
] as const
const APP_TITLES = [
  ['/app', 'Home'],
  ['/app/calendar', 'Calendar'],
  ['/app/curriculum', 'Curriculum'],
  ['/app/tests', 'Tests'],
  ['/app/coach', 'Coach'],
  ['/app/settings', 'Settings'],
  ['/app/exam', 'Exam status'],
  ['/app/log', 'Log learning'],
  ['/app/curriculum/flashcards', 'Flashcards'],
  ['/account', 'Manage your account'],
] as const

function watchPage(page: Page) {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.name))
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      errors.push(message.text().slice(0, 120))
    }
  })
  return errors
}

async function viewPages(page: Page, routes: ReadonlyArray<readonly [string, string]>) {
  const times: { path: string; ms: number }[] = []
  for (const [path, title] of routes) {
    const started = performance.now()
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(200)
    await expect(page).toHaveTitle(`${title} · Roadmap`)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await noHorizontalOverflow(page)
    times.push({ path, ms: Math.round(performance.now() - started) })
  }
  return times
}

test('public pages, protection redirects and search indexing', async ({ page, request }, info) => {
  const errors = watchPage(page)
  const timings = await viewPages(page, BASE_TITLES)
  for (const path of ['/app', '/app/calendar?view=agenda', '/onboarding', '/account']) {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status()).toBe(307)
    const destination = new URL(response.headers().location, response.url())
    expect(destination.pathname).toBe('/login')
    expect(destination.searchParams.get('next')).toBe(path)
    expect(response.headers()['x-robots-tag']).toContain('noindex')
    expect(response.headers()['cache-control']).toContain('no-store')
    expect(response.headers()['content-security-policy']).toContain('strict-dynamic')
  }
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  expect(await robots.text()).toContain('Disallow: /app/')
  const recovery = await request.get('/update-password', { maxRedirects: 0 })
  expect(recovery.status()).toBe(307)
  expect(new URL(recovery.headers().location, recovery.url()).pathname).toBe('/forgot-password')
  expect((await request.post('/api/reminders/run')).status()).toBe(401)
  const missing = await page.goto('/a-page-that-does-not-exist')
  expect(missing?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  expect(errors).toEqual([])
  await info.attach('public-navigation-times', { body: JSON.stringify(timings), contentType: 'application/json' })
})

for (const classLed of [false, true]) {
  test(`${classLed ? 'Class-led' : 'Self-study'} workspace and connected actions`, async ({ page, baseURL }, info) => {
    expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname).toBe(`${TARGET}.supabase.co`)
    expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname)
    const db = admin()
    const errors = watchPage(page)
    const student = await createStudent(db, `audit${classLed ? 'class' : 'self'}`, {
      onboard: true,
      onboarding: classLed ? (await classLedPersona(db)).options : FRESH_STUDENT_ONBOARDING,
    })

    try {
      await login(page, db, student.email)
      const timings = await viewPages(page, APP_TITLES)
      await info.attach('workspace-navigation-times', { body: JSON.stringify(timings), contentType: 'application/json' })

      await page.goto('/app/coach')
      await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      await page.goto('/app/settings')
      await expect(page.getByRole('link', { name: /exam status and retake/i })).toHaveAttribute('href', '/app/exam')
      await page.goto('/app')
      await expect(page.locator('a[href="/app/exam"]').first()).toBeVisible()

      for (const path of ['/app/tests/unknown-paper', '/app/tests/00000000-0000-4000-8000-000000000001/result', '/app/tests/rehearsal/unknown-paper']) {
        await page.goto(path)
        await expect(page.getByText('That paper could not be found.', { exact: false })).toBeVisible()
      }
      for (const path of ['/app/tests/review', '/app/tests/manifest', '/app/curriculum/missing-subject', '/app/calendar/mock-report/00000000-0000-4000-8000-000000000001']) {
        const response = await page.goto(path)
        expect(response?.status(), path).toBe(404)
        await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
      }

      if (!classLed) {
        const reading = '/app/curriculum/fsa/r028'
        await page.goto(reading)
        await expect(page).toHaveTitle(/Reading 28 · .+ · Roadmap$/)
        const reported = await page.request.post('/api/curriculum/coverage', { data: { readingId: 'r028', state: 'partly' } })
        expect(reported.ok()).toBe(true)
        const coverage = '0 of 102 readings recorded as covered · 1 partly'
        await page.goto('/app/curriculum')
        await expect(page.getByText(coverage, { exact: false }).first()).toBeVisible()
        await page.goto('/app')
        await expect(page.getByText(coverage, { exact: false }).first()).toBeVisible()

        await page.goto(reading)
        const mark = page.locator('.reading-mark')
        await mark.getByRole('radio', { name: 'Shaky' }).click()
        await expect(mark.getByText('Confidence saved.')).toBeVisible()
        await expect(mark.getByRole('radio', { name: 'Shaky' })).toBeChecked()
        await page.route('**/api/curriculum/marks', route => route.fulfill({ status: 500, contentType: 'text/html', body: 'Temporary outage' }))
        await mark.getByRole('radio', { name: 'Solid' }).click()
        await expect(mark.getByRole('alert')).toContainText('Could not confirm the save')
        await expect(mark.getByRole('radio', { name: 'Shaky' })).toBeChecked()
        await expect(mark.getByRole('radio', { name: 'Solid' })).not.toBeChecked()
        await page.unroute('**/api/curriculum/marks')
        await mark.getByRole('radio', { name: 'Solid' }).click()
        await expect(mark.getByText('Confidence saved.')).toBeVisible()
        await expect(mark.getByRole('radio', { name: 'Solid' })).toBeChecked()

        await page.goto('/app/log?reading=r028')
        await page.getByText('Add a note (optional)', { exact: true }).click()
        await expect(page.getByRole('textbox', { name: 'Session note (optional)' })).toBeVisible()
        await page.goto('/app/tests')
        await expect(page.getByRole('button', { name: 'Log learning', exact: true })).toHaveCount(1)

        await page.goto('/app/log?reading=r028')
        await page.locator('.log-sheet__outcomes').getByRole('checkbox').first().check()
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(page.getByRole('heading', { name: 'Logged.', exact: true })).toBeVisible()
        await page.goto('/app/log')
        await expect(page.getByRole('option', { name: /Analyzing Income Statements/i })).toHaveAttribute('aria-selected', 'true')
        await expect(page.locator('.log-sheet__outcomes input:checked')).toHaveCount(0)
      }
      expect(errors).toEqual([])
    } finally {
      const result = await db.auth.admin.deleteUser(student.id)
      expect(result.error, 'delete only this test student').toBeNull()
    }
  })
}
