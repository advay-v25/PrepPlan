import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { addDays as plus, todayInZone, zonedTimeToUtc } from '../../../src/lib/planning/studyWeek'
import { admin, captureHydration, login, RUN, removeStudent } from './helpers'

/**
 * Phase 6 · the open 390 px Calendar agenda hydration mismatch. Replays the Phase 5 deep link and the Settings → Calendar sequence under conditions
 * that could make the server's and the browser's first render differ. The collector is strict: any hydration message or page error fails the run and
 * is kept in full (docs/evidence/hydration-captures.jsonl). A clean run measures how often it did not happen; it does not establish a fix.
 */
const db = admin(), ZONE = 'Europe/London'
const REPEATS = Number(process.env.HYDRATION_REPEATS || 3)
const BROWSER_ZONES = ['Europe/London', 'Pacific/Auckland', 'America/Los_Angeles']

test('hydration · Settings → Calendar agenda deep link across browser time zones, a local date boundary and slow loads', async ({ browser }, info) => {
  test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
  test.setTimeout(900_000)
  const owned: string[] = [], messages: { conditions: string; url: string; text: string }[] = []
  const attempts: Record<string, number> = {}
  try {
    const s = await createStudent(db, `hyd${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
    const today = todayInZone(ZONE)
    const deepLink = `/app/calendar?week=${today}&view=agenda#calendar-today`
    const view = info.project.use
    for (const zone of BROWSER_ZONES) {
      // 'boundary': the browser's clock reads seconds after the student's next local midnight while the server still renders today.
      for (const clock of ['real', 'boundary'] as const) {
        const context = await browser.newContext({ viewport: view.viewport, isMobile: view.isMobile, hasTouch: view.hasTouch, timezoneId: zone, locale: 'en-GB', baseURL: view.baseURL })
        let conditions = `browser ${zone}, clock ${clock}`
        context.on('console', m => { if (m.type() === 'error') messages.push({ conditions, url: m.page()?.url() ?? '', text: m.text() }) })
        context.on('weberror', e => messages.push({ conditions, url: e.page()?.url() ?? '', text: e.error().message }))
        const page: Page = await context.newPage()
        captureHydration(page)
        try {
          await login(page, db, s.email, '/app/settings')
          if (clock === 'boundary') await page.clock.install({ time: new Date(zonedTimeToUtc(plus(today, 1), '00:00', ZONE).getTime() + 20_000) })
          for (const load of ['normal', 'slow'] as const) {
            await page.unrouteAll({ behavior: 'ignoreErrors' })
            if (load === 'slow') await page.route('**/_next/static/**/*.js*', async r => { await new Promise(x => setTimeout(x, 900)); await r.continue().catch(() => {}) })
            conditions = `browser ${zone}, clock ${clock}, ${load} load`
            for (let i = 0; i < REPEATS; i++) {
              // 1. Settings, then Calendar by the app's own link; 2. the exact deep link as a full load; 3. a past week, then "Today" as it loads.
              await page.goto('/app/settings'); await expect(page.getByRole('heading', { name: 'Your setup' })).toBeVisible()
              await page.getByRole('link', { name: 'Calendar', exact: true }).first().click(); await page.waitForURL(/\/app\/calendar/)
              await page.goto(deepLink); await expect(page.locator('#calendar-today')).toBeAttached()
              await page.waitForLoadState('networkidle')
              await page.goto(`/app/calendar?week=${plus(today, -7)}&view=agenda`)
              await page.getByRole('link', { name: 'Today', exact: true }).click(); await page.waitForURL(/#calendar-today$/)
              await expect(page.locator('#calendar-today')).toBeAttached()
              await page.waitForLoadState('networkidle')
              attempts[conditions] = (attempts[conditions] ?? 0) + 1
            }
          }
        } finally { await context.close() }
      }
    }
  } finally {
    fs.writeFileSync(`docs/evidence/phase6-hydration-attempts-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.use.viewport, runnerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, studentTimezone: ZONE, sequence: 'settings → calendar link; agenda deep link; past week → Today', sequencesPerCondition: attempts, messages }, null, 1))
    for (const id of owned) await removeStudent(db, id)
  }
  expect(messages).toEqual([])
})

test('hydration · a Calendar disclosure opened while the page is still loading stays open and raises no mismatch', async ({ page }) => {
  test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
  test.setTimeout(240_000)
  const owned: string[] = [], messages: string[] = []
  try {
    const s = await createStudent(db, `hydopen${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
    await login(page, db, s.email, '/app')
    page.on('console', m => { if (m.type() === 'error') messages.push(m.text()) })
    page.on('pageerror', e => messages.push(e.message))
    await page.route('**/_next/static/**/*.js*', async r => { await new Promise(x => setTimeout(x, 2500)); await r.continue().catch(() => {}) })
    for (const selector of ['.cal-export', '[data-week-context]', '[data-placement-summary]']) {
      await page.goto('about:blank')   // the same fragment URL again would not reload the document
      await page.goto(`/app/calendar?week=${todayInZone(ZONE)}&view=agenda#calendar-today`, { waitUntil: 'commit' })
      const details = page.locator(selector)
      if (selector === '[data-placement-summary]') await page.locator('[data-week-context] > summary').click()
      await details.locator(':scope > summary').click()
      await expect(details).toHaveAttribute('open', '')
      // Wait for React to take the page over, then give a late mismatch time to be reported.
      await expect.poll(() => page.locator('.cal-export > summary').evaluate(e => Object.keys(e).some(k => k.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true)
      await page.waitForLoadState('networkidle')
      await expect(details).toHaveAttribute('open', '')
      expect(messages, `console after opening ${selector} early`).toEqual([])
    }
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); for (const id of owned) await removeStudent(db, id) }
})
