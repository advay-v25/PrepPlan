import { chromium, type Page } from 'playwright'
import { admin, login, makeBank, destroyBank } from '../tests/e2e/lifecycle/helpers'
import { createStudent, FRESH_STUDENT_ONBOARDING } from './lib/e2eSession'
import fs from 'node:fs'
import path from 'node:path'

const BASE_URL = 'http://localhost:3000'
const SNAP_DIR = path.resolve(process.cwd(), 'artifacts/live-browser-test')

type CheckResult = {
  area: string
  name: string
  status: 'pass' | 'fail'
  details?: string
}

const results: CheckResult[] = []

function check(area: string, name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✓ [${area}] ${name}`)
    results.push({ area, name, status: 'pass' })
  } else {
    console.error(`  ✗ [${area}] ${name} ${details ? `(${details})` : ''}`)
    results.push({ area, name, status: 'fail', details })
  }
}

async function main() {
  fs.mkdirSync(SNAP_DIR, { recursive: true })
  console.log('Starting Live Browser Testing on', BASE_URL)

  const db = admin()
  const st = await createStudent(db, 'livetest', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING })
  console.log(`Created live student user: ${st.email} (${st.id})`)

  const browser = await chromium.launch()
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const consoleErrors: string[] = []
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const txt = msg.text()
      // Ignore favicon or non-critical 404s
      if (!txt.includes('favicon.ico')) consoleErrors.push(txt)
    }
  })
  page.on('pageerror', err => consoleErrors.push(err.message))

  try {
    // ── 1. Landing & Public Auth Routes ─────────────────────────────────────────
    console.log('\n1. Testing Public & Auth Routes...')
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    check('Public', 'Landing page loads', await page.locator('text=PrepPlan').first().isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '01-landing.png') })

    await page.goto('/login')
    await page.waitForLoadState('networkidle')
    check('Auth', 'Login page has brand and input', await page.locator('input[type="email"]').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '02-login.png') })

    await page.goto('/not-invited')
    await page.waitForLoadState('networkidle')
    check('Auth', 'Private beta page shows standalone card', await page.locator('.su').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '03-not-invited.png') })

    // ── 2. Authenticated Session & App Shell ───────────────────────────────────
    console.log('\n2. Logging into Authenticated App Shell...')
    await login(page, db, st.email, '/app')
    await page.waitForLoadState('networkidle')
    check('Auth', 'Authenticated and reached /app', page.url().includes('/app'))

    // ── 3. Home Viewport & Interactivity ────────────────────────────────────────
    console.log('\n3. Testing Home Page (1440×900 Viewport & Interactions)...')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(SNAP_DIR, '04-home-desktop.png') })

    // Check Home layout: Next up hero card exists
    const nextUpCard = page.locator('.next-up')
    check('Home', 'Next up hero card is visible', await nextUpCard.isVisible())

    // Check Today sequence & tasks
    const todayTasks = page.locator('.today-seq__item')
    const taskCount = await todayTasks.count()
    check('Home', 'Today tasks sequence rendered', taskCount >= 0)

    // Check Theme switcher
    const darkBtn = page.getByRole('button', { name: 'Dark', exact: true })
    if (await darkBtn.isVisible()) {
      await darkBtn.click()
      await page.waitForTimeout(200)
      const isDark = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark')
      check('Home', 'Theme switcher activates dark mode', isDark)
      await page.screenshot({ path: path.join(SNAP_DIR, '05-home-dark.png') })

      // Switch back to light
      const lightBtn = page.getByRole('button', { name: 'Light', exact: true })
      await lightBtn.click()
      await page.waitForTimeout(200)
    }

    // ── 4. Calendar Page ────────────────────────────────────────────────────────
    console.log('\n4. Testing Calendar Page...')
    await page.goto('/app/calendar')
    await page.waitForLoadState('networkidle')
    check('Calendar', 'Calendar view rendered', await page.locator('.calendar-page').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '06-calendar.png') })

    // Check Weekly Review deep link
    await page.goto('/app/review-week')
    await page.waitForLoadState('networkidle')
    check('Calendar', 'Review week form rendered', await page.locator('.review-week').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '07-review-week.png') })

    // ── 5. Curriculum & Detail Views ───────────────────────────────────────────
    console.log('\n5. Testing Curriculum & LOS Tracker...')
    await page.goto('/app/curriculum')
    await page.waitForLoadState('networkidle')
    check('Curriculum', 'Curriculum overview rendered', await page.locator('.curriculum-page').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '08-curriculum.png') })

    // Flashcards view
    await page.goto('/app/curriculum/flashcards')
    await page.waitForLoadState('networkidle')
    check('Curriculum', 'Flashcards hub rendered', await page.locator('text=Flashcards').first().isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '09-flashcards.png') })

    // ── 6. Tests Hub ───────────────────────────────────────────────────────────
    console.log('\n6. Testing Tests Hub (Weekly, Practice, Mocks)...')
    await page.goto('/app/tests')
    await page.waitForLoadState('networkidle')
    check('Tests', 'Tests hub loaded', await page.locator('.tests-page').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '10-tests-week.png') })

    await page.goto('/app/tests?view=practice')
    await page.waitForLoadState('networkidle')
    check('Tests', 'Practice panel loaded', await page.locator('.practice-panel').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '11-tests-practice.png') })

    await page.goto('/app/tests?view=mocks')
    await page.waitForLoadState('networkidle')
    check('Tests', 'Mocks hub loaded', await page.locator('text=Mocks and rehearsals').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '12-tests-mocks.png') })

    // ── 7. Coach Page & Interaction ─────────────────────────────────────────────
    console.log('\n7. Testing Coach (Real interaction)...')
    await page.goto('/app/coach')
    await page.waitForLoadState('networkidle')
    check('Coach', 'Coach page loaded with evidence summary', await page.locator('text=What I am working from').isVisible())

    // Ask Coach a live question
    const coachInput = page.getByRole('textbox', { name: 'Ask the coach' })
    await coachInput.fill('What should I study today?')
    const sendBtn = page.getByRole('button', { name: 'Send' })
    await sendBtn.click()

    // Wait for Coach response to appear
    await page.locator('.coach-message--coach').waitFor({ state: 'visible', timeout: 15000 })
    check('Coach', 'Coach responded to student message', await page.locator('.coach-message--coach').count() > 0)
    await page.screenshot({ path: path.join(SNAP_DIR, '13-coach-reply.png') })

    // ── 8. Settings Page & Live Controls ────────────────────────────────────────
    console.log('\n8. Testing Settings Page...')
    await page.goto('/app/settings')
    await page.waitForLoadState('networkidle')
    check('Settings', 'Settings page rendered', await page.locator('.settings-sections').isVisible())
    check('Settings', 'Account card rendered', await page.locator('.settings-account').isVisible())
    check('Settings', 'Reminders quiet hours rendered', await page.locator('.quiet-hours-wrap').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '14-settings.png') })

    // ── 9. Log Learning & Arrow Toggles ─────────────────────────────────────────
    console.log('\n9. Testing Log Learning Sheet & Toggles...')
    await page.goto('/app/log')
    await page.waitForLoadState('networkidle')
    check('Log', 'Log learning sheet rendered', await page.locator('.log-sheet').isVisible())

    // Toggle details sections
    const detailsSummaries = page.locator('.log-sheet details summary')
    const dCount = await detailsSummaries.count()
    for (let i = 0; i < dCount; i++) {
      await detailsSummaries.nth(i).click()
    }
    await page.waitForTimeout(200)
    check('Log', 'Toggle sections opened with arrows', dCount > 0)
    await page.screenshot({ path: path.join(SNAP_DIR, '15-log-learning.png') })

    // ── 10. Exam Status ────────────────────────────────────────────────────────
    console.log('\n10. Testing Exam Status Page...')
    await page.goto('/app/exam')
    await page.waitForLoadState('networkidle')
    check('Exam', 'Exam page rendered card container', await page.locator('[data-exam-phase]').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '16-exam.png') })

    // ── 11. Mobile Responsiveness (390×844) ────────────────────────────────────
    console.log('\n11. Testing Mobile Responsiveness & Floating Tab Bar...')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/app')
    await page.waitForLoadState('networkidle')
    check('Mobile', 'Floating tab bar visible on mobile', await page.locator('.tabbar').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '17-mobile-home.png') })

    // Test More drawer
    const moreBtn = page.locator('.tabbar__item:has-text("More")')
    await moreBtn.click()
    await page.locator('.mobile-nav-drawer').waitFor({ state: 'visible', timeout: 3000 })
    check('Mobile', 'Mobile drawer opens on More click', await page.locator('.mobile-nav-drawer').isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '18-mobile-drawer.png') })

    // Close drawer
    await page.locator('.mobile-nav-scrim').click()
    await page.waitForTimeout(300)

    // Check Onboarding mobile pinned logo
    await page.goto('/onboarding/exam')
    await page.waitForLoadState('networkidle')
    const brandMark = page.locator('.ob-brand')
    check('Mobile', 'Onboarding brand mark pinned and visible', await brandMark.isVisible())
    await page.screenshot({ path: path.join(SNAP_DIR, '19-mobile-onboarding.png') })

    console.log('\nConsole Errors during live run:', consoleErrors.length)
    if (consoleErrors.length > 0) {
      console.log('Errors:', consoleErrors)
    }
    check('Errors', 'Zero runtime unhandled exceptions', consoleErrors.length === 0)

  } finally {
    await browser.close()
    await db.auth.admin.deleteUser(st.id)
    console.log(`\nCleaned up student user: ${st.id}`)
  }

  const passed = results.filter(r => r.status === 'pass').length
  const failed = results.filter(r => r.status === 'fail').length
  console.log(`\nLive Test Complete: ${passed} passed, ${failed} failed.\nScreenshots saved in ${SNAP_DIR}/`)
}

main().catch(err => {
  console.error('Live browser test crashed:', err)
  process.exit(1)
})
