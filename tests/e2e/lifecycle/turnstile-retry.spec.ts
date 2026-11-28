import { expect, test } from '@playwright/test'
import { captureHydration } from './helpers'

const widgetScript = /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit$/

test.beforeEach(({ page }) => captureHydration(page))

test('auth navigation shares an in-flight security script', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_TURNSTILE_FIXTURE !== '1', 'Requires a local build with a fixture site key.')
  expect(new URL(baseURL!).hostname).toBe('localhost')
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  await page.route(widgetScript, async route => {
    requests++
    await pending
    await route.fulfill({
      contentType: 'application/javascript',
      body: 'window.turnstile = { render(_host, options) { options.callback("local-widget-fixture"); return "test-widget"; }, remove() {} };',
    })
  })
  try {
    await page.goto('/login', { waitUntil: 'domcontentloaded' })
    await expect.poll(() => requests).toBe(1)
    await page.getByRole('link', { name: 'Create account', exact: true }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByText('Complete the security check to continue.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeDisabled()
    release()
    await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled()
    expect(requests).toBe(1)
    await expect(page.locator('script[src*="turnstile/v0/api.js"]')).toHaveCount(1)
  } finally {
    release()
  }
})

test('local auth forms recover from a delayed or failed security check', async ({ page, baseURL }) => {
  test.skip(process.env.E2E_TURNSTILE_FIXTURE !== '1', 'Requires a local build with a fixture site key.')
  expect(new URL(baseURL!).hostname).toBe('localhost')
  await page.clock.install()
  const writes: string[] = []
  await page.route('**/api/auth', route => {
    writes.push(route.request().method())
    return route.abort()
  })
  await page.route(widgetScript, route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.turnstile = {
      render(host, options) {
        this.options = options;
        if (location.pathname === '/signup') options['timeout-callback']();
        return 'test-widget';
      },
      reset() { this.options.callback('local-widget-fixture'); },
      remove() {}
    };`,
  }))
  for (const [path, action] of [['/login', 'Sign in'], ['/signup', 'Create account']]) {
    await page.goto(path)
    const submit = page.getByRole('button', { name: action, exact: true })
    const retry = page.getByRole('button', { name: 'Retry security check', exact: true })
    if (path === '/login') {
      await expect(page.getByText('Complete the security check to continue.')).toBeVisible()
      await expect(submit).toBeDisabled()
      await page.clock.fastForward(12_100)
    }
    await expect(retry).toBeVisible()
    await expect(submit).toBeDisabled()
    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('local-fixture@example.invalid')
    await retry.click()
    await expect(retry).toHaveCount(0)
    await expect(submit).toBeEnabled()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('local-fixture@example.invalid')
  }
  await page.unroute(widgetScript)
  await page.route(widgetScript, route => route.abort())
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Retry security check' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('local-fixture@example.invalid')
  await page.getByLabel('Password', { exact: true }).fill('Local fixture only')
  await page.unroute(widgetScript)
  await page.route(widgetScript, route => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.turnstile = { render(_host, options) { options.callback("local-widget-fixture"); return "test-widget"; }, remove() {} };',
  }))
  await page.getByRole('button', { name: 'Retry security check' }).click()
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled()
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue('local-fixture@example.invalid')
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Local fixture only')
  expect(writes).toEqual([])
})
