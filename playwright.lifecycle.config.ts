import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local', quiet: true } as any)

/** Browser lifecycle proof (Journey A). Real UI in a real browser, one ordinary student per viewport, run in order.
 *  E2E_BASE_URL=http://localhost:3141 npx playwright test -c playwright.lifecycle.config.ts [--project=desktop|mobile-390] */
export default defineConfig({
  testDir: './tests/e2e/lifecycle',
  fullyParallel: false, workers: 1, retries: 0, timeout: 12 * 60_000, expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { actionTimeout: 20_000, navigationTimeout: 45_000, baseURL: process.env.E2E_BASE_URL || 'http://localhost:3141', timezoneId: 'Europe/London', locale: 'en-GB', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
})
