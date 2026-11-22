import { chromium } from 'playwright'
import { admin, login } from '../tests/e2e/lifecycle/helpers'
import { createStudent, FRESH_STUDENT_ONBOARDING } from './lib/e2eSession'
import fs from 'node:fs'
import path from 'node:path'

async function main() {
  const outDir = path.resolve(process.cwd(), 'artifacts/audit-phase9')
  fs.mkdirSync(outDir, { recursive: true })

  const db = admin()
  const st = await createStudent(db, 'p9audit', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING })

  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL: 'http://localhost:3000' })

    // 1. Terms & Privacy (Desktop & Mobile, Light & Dark)
    for (const route of ['/terms', '/privacy', '/demo']) {
      const name = route.replace('/', '')
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
        await page.screenshot({ path: path.join(outDir, `${name}-desktop-${theme}.png`) })

        await page.setViewportSize({ width: 390, height: 844 })
        await page.goto(route)
        await page.waitForLoadState('networkidle')
        await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
        await page.screenshot({ path: path.join(outDir, `${name}-mobile-${theme}.png`) })
      }
    }

    // 2. Authenticated Curriculum Subject & Reading Pages
    await page.setViewportSize({ width: 1440, height: 900 })
    await login(page, db, st.email, '/app/curriculum/quant')
    await page.waitForLoadState('networkidle')

    for (const theme of ['light', 'dark']) {
      // Subject page
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/app/curriculum/quant')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `subject-quant-desktop-${theme}.png`) })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/app/curriculum/quant')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `subject-quant-mobile-${theme}.png`) })

      // Reading page (r007)
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/app/curriculum/quant/r007')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `reading-r007-desktop-${theme}.png`) })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/app/curriculum/quant/r007')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `reading-r007-mobile-${theme}.png`) })

      // Home Progress Tiles (showing fixed bar alignment on phone)
      await page.goto('/app')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `home-progress-mobile-${theme}.png`) })
    }

    // 3. Error Page
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto('/auth/error?reason=unavailable')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `error-desktop-${theme}.png`) })

      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto('/auth/error?reason=unavailable')
      await page.waitForLoadState('networkidle')
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme)
      await page.screenshot({ path: path.join(outDir, `error-mobile-${theme}.png`) })
    }

    console.log('Phase 9 audit screenshots saved to artifacts/audit-phase9/')
  } finally {
    await browser.close()
    await db.auth.admin.deleteUser(st.id)
  }
}

main().catch(err => {
  console.error('Audit capture failed:', err)
  process.exit(1)
})
