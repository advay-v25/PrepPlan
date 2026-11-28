import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
process.env.E2E_ENV_FILE ||= '.env.staging.local'
dotenv.config({ path: process.env.E2E_ENV_FILE, quiet: true })
const deployedOwned = process.env.E2E_SUITE === 'deployed-owned'
if (!(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  || !(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)) {
  throw new Error('Lifecycle setup blocked: configure public Auth and server keys for the selected disposable environment. No test fixtures were created.')
}

/** Browser lifecycle proof (Journey A). Real UI in a real browser, one ordinary student per viewport, run in order.
 *  E2E_BASE_URL=http://localhost:3141 npx playwright test -c playwright.lifecycle.config.ts [--project=desktop|mobile-390] */
export default defineConfig({
  globalSetup: './scripts/lifecycle-setup.ts',
  testDir: './tests/e2e/lifecycle',
  ...(deployedOwned ? {
    // These specs use only their own students and read the actual bank. Fixture-bank specs stay in the disposable lane.
    testMatch: '**/{app-audit,phase1-log,focused,class-followup,class-editing,phase7-manual-task,phase7b-in-progress}.spec.ts',
  } : {}),
  fullyParallel: false, workers: 1, retries: 0, timeout: 12 * 60_000, expect: { timeout: 20_000 },
  reporter: [['list']],
  use: { actionTimeout: 20_000, navigationTimeout: 45_000, baseURL: process.env.E2E_BASE_URL || 'http://localhost:3141', timezoneId: 'Europe/London', locale: 'en-GB', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  ],
})
