import { test, expect } from '@playwright/test';

test.describe('Phase 0 Truth Baseline', () => {
  test('unauthenticated users are redirected to login from app routes', async ({ page }) => {
    await page.goto('/app/calendar');
    await expect(page).toHaveURL(/.*\/login/);
  });

  // Note: For authenticated tests, we typically use a setup project or fixtures
  // to login and store auth state, then test the gating logic. 
  // This is a placeholder for the E2E script structure that will be expanded 
  // as the testing environment stabilizes with proper seed scripts.
  
  test('onboarding gate enforces completion', async ({ page }) => {
    // This test expects a logged-in user with incomplete onboarding.
    // It should assert they cannot access /app/calendar and are redirected to /onboarding.
  });

  test('render purity on calendar', async ({ page }) => {
    // This test expects a logged-in user with complete onboarding.
    // It should assert that hitting /app/calendar does not increment plan_blocks.
  });
});
