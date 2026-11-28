import { expect, test, type Locator, type Page } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, removeStudent, RUN } from './helpers'

const db = admin(), ZONE = 'America/New_York'
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
const hold = (page: Page) => page.route('**/_next/static/**/*.js*', async route => { await new Promise(r => setTimeout(r, 2000)); await route.continue().catch(() => {}) })
const attached = async (target: Locator) => { await expect.poll(() => target.evaluate(e => Object.keys(e).some(k => k.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true) }

async function checkViewportFit(page: Page) {
  await page.waitForLoadState('domcontentloaded')
  await noHorizontalOverflow(page)
  const fit = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  expect(fit.scrollWidth).toBeLessThanOrEqual(fit.clientWidth)
  expect(fit.clientWidth).toBeLessThanOrEqual(fit.innerWidth)
}

test('audit · Home, Tests and setup disclosures under delayed hydration keep native open state without hydration errors', async ({ page }) => {
  local(); test.setTimeout(240_000)
  const owned: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
  try {
    const s = await createStudent(db, `disc${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING, exam: { sittingIndex: 1, registered: false, timezone: ZONE } } })
    await login(page, db, s.email, '/app')

    // 1. Home disclosure (TodaySequence .today__more) opened early before React attaches
    await hold(page)
    await page.goto('/app', { waitUntil: 'commit' })
    const homeMore = page.locator('details.today__more').first()
    if (await homeMore.count() > 0) {
      await homeMore.locator('summary').click()
      await expect(homeMore).toHaveAttribute('open', '')
      await attached(homeMore)
      await expect(homeMore).toHaveAttribute('open', '')
    }
    await checkViewportFit(page)

    // 2. Tests disclosure (MockSchedule / WeeklyPaperCard) opened early
    await page.goto('/app/tests?view=mocks', { waitUntil: 'commit' })
    const testDetails = page.locator('main details').first()
    if (await testDetails.count() > 0) {
      await testDetails.locator('summary').focus()
      await page.keyboard.press('Enter')
      await expect(testDetails).toHaveAttribute('open', '')
      await attached(testDetails)
      await expect(testDetails).toHaveAttribute('open', '')
    }
    await checkViewportFit(page)

    // 3. Setup disclosure (/onboarding/week .ob-fixed) opened early
    await page.goto('/onboarding/week?returnTo=%2Fapp%2Fsettings', { waitUntil: 'commit' })
    const weekDetails = page.locator('details.ob-fixed').first()
    await weekDetails.locator('summary').click()
    await expect(weekDetails).toHaveAttribute('open', '')
    await attached(weekDetails)
    await expect(weekDetails).toHaveAttribute('open', '')
    await checkViewportFit(page)

    expect(errors).toEqual([])
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    for (const id of owned) await removeStudent(db, id)
  }
})

test('audit · Curriculum Notes editor shows loading state, handles IME and preserves newer input during slow save', async ({ page }) => {
  local(); test.setTimeout(240_000)
  const owned: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
  try {
    const s = await createStudent(db, `notes${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING, exam: { sittingIndex: 1, registered: false, timezone: ZONE } } })
    await login(page, db, s.email, '/app/curriculum/quant?tab=notes')

    const editor = page.locator('.note-editor__content[role="textbox"]')
    await expect(editor).toBeVisible({ timeout: 30_000 })
    await editor.click()
    await page.keyboard.type('First note line ')

    // Hold the first POST /api/curriculum/notes while typing newer text + IME composition
    let releaseFirst!: () => void
    const firstHeld = new Promise<void>(r => { releaseFirst = r })
    let postCount = 0
    const sentDocs: string[] = []
    await page.route('**/api/curriculum/notes', async route => {
      postCount += 1
      const body = route.request().postDataJSON() as { doc: unknown }
      sentDocs.push(JSON.stringify(body.doc))
      if (postCount === 1) await firstHeld
      await route.continue()
    })

    // Trigger first autosave, then type newer text while it is in flight
    await expect.poll(() => postCount, { timeout: 10_000 }).toBe(1)
    await page.keyboard.type('newer text ')
    await editor.evaluate(el => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '仮' }))
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '仮' }))
    })
    await expect(editor).toContainText('First note line newer text')
    releaseFirst()

    await expect.poll(() => postCount, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    await expect(page.locator('.note-editor').getByText('Saved')).toBeVisible({ timeout: 15_000 })
    expect(sentDocs.at(-1)).toContain('newer text')
    await checkViewportFit(page)
    expect(errors).toEqual([])
  } finally {
    await page.unrouteAll({ behavior: 'ignoreErrors' })
    for (const id of owned) await removeStudent(db, id)
  }
})

test('audit · Calendar navigation from Settings and direct links at 390 px with student/server timezone difference', async ({ browser }, info) => {
  local(); test.setTimeout(180_000)
  const owned: string[] = [], errors: string[] = []
  const view = info.project.use
  const context = await browser.newContext({ viewport: view.viewport, isMobile: view.isMobile, hasTouch: view.hasTouch, timezoneId: ZONE, locale: 'en-GB', baseURL: view.baseURL })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`) })
  try {
    const s = await createStudent(db, `calnav${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING, exam: { sittingIndex: 1, registered: false, timezone: ZONE } } })
    await login(page, db, s.email, '/app/settings')
    await page.getByRole('link', { name: 'Calendar' }).first().click()
    await page.waitForURL(/\/app\/calendar/, { timeout: 30_000 })
    await checkViewportFit(page)
    await page.goto('/app/calendar?view=agenda#calendar-today', { waitUntil: 'load' })
    await checkViewportFit(page)
    expect(errors).toEqual([])
  } finally {
    await context.close()
    for (const id of owned) await removeStudent(db, id)
  }
})
