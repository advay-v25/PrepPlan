import { expect, test } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { makeRecoveryIntent } from '../../../src/lib/auth/securityServer'
import { admin, captureHydration, noHorizontalOverflow, TARGET_HOST } from './helpers'

// These journeys sign in without the shared helper, so each one registers the full hydration capture itself.
test.beforeEach(({ page }) => captureHydration(page))

test('auth controls wait for the form handler', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    for (const [path, label] of [['/login', 'Sign in'], ['/signup', 'Create account'], ['/forgot-password', 'Send reset link'], ['/check-email', 'Send confirmation link']]) {
      await page.goto(path)
      await expect(page.getByRole('button', { name: label, exact: true })).toBeDisabled()
    }
  } finally {
    await context.close()
  }
})

test('unusable links keep the recovery action for their original flow', async ({ page }) => {
  for (const [kind, label, destination] of [
    ['recovery', 'Send a new reset link', '/forgot-password'],
    ['signup', 'Send a new confirmation email', '/check-email'],
    ['magiclink', 'Start sign-in again', '/login'],
  ]) {
    await page.goto('/login')
    await page.goto('/auth/verify#type=' + kind)
    await expect(page.getByRole('heading', { name: 'This link can’t be used', exact: true })).toBeVisible()
    await expect(page.locator('a.auth-primary')).toHaveText(label)
    await expect(page.locator('a.auth-primary')).toHaveAttribute('href', destination)
    expect(new URL(page.url()).hash).toBe('')
  }
})

test('verification, recovery and app entry use the rendered security controls', async ({ page, browser, baseURL }) => {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  const local = new URL(baseURL!)
  expect(['localhost', '127.0.0.1']).toContain(local.hostname)
  const deployed = project.origin === 'https://woboyakjtgltgekwtddo.supabase.co' && process.env.E2E_AUTH_DEPLOYED_PROJECT === 'woboyakjtgltgekwtddo'
  const db = deployed ? createClient(project.origin, process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '', { auth: { persistSession: false } }) : admin()
  if (!deployed) expect(project.hostname).toBe(TARGET_HOST)
  const email = 'authbrowser+' + crypto.randomUUID().slice(0, 12) + '@example.invalid'
  const original = 'Original fixture passphrase 101'
  const updated = 'Replacement fixture passphrase 105'
  const created = await db.auth.admin.createUser({ email, password: original, email_confirm: false })
  const userId = created.data.user?.id
  if (created.error || !userId) throw new Error('Could not create an owned browser fixture.')
  const recoveryContext = await browser.newContext({ baseURL, viewport: page.viewportSize()!, isMobile: page.viewportSize()!.width < 500 })
  const recoveryPage = await recoveryContext.newPage()
  const unexpected: string[] = []
  for (const tab of [page, recoveryPage]) {
    tab.on('pageerror', error => unexpected.push(error.name))
    tab.on('console', event => {
      if (event.type() === 'error') {
        const message = event.text()
        const source = event.location().url
        // The provider frame applies its own policy. Keep every app-origin CSP error actionable.
        if (source.startsWith('https://challenges.cloudflare.com/cdn-cgi/challenge-platform/')
          && (/^Connecting to 'data:,' violates .*Content Security Policy/.test(message)
            || /^Fetch API cannot load data:,. Refused to connect because it violates .*Content Security Policy/.test(message))) return
        if (/content security policy|hydration|refused to|uncaught|Minified React error/i.test(message)) {
          unexpected.push(message.split(':')[0].slice(0, 100))
        }
      }
    })
  }
  try {
    await page.goto('/app/calendar?week=2027-01-04')
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    expect(new URL(page.url()).searchParams.get('next')).toBe('/app/calendar?week=2027-01-04')
    await noHorizontalOverflow(page)
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
    await page.goto('/login?reset=success')
    await expect(page.getByText('Password updated. Sign in with it now.')).toHaveCount(0)

    const signup = await db.auth.admin.generateLink({ type: 'signup', email, password: original })
    if (signup.error) throw new Error('Could not generate a confirmation fixture.')
    const response = await page.goto('/auth/verify#' + new URLSearchParams({ type: 'signup', token_hash: signup.data.properties.hashed_token }))
    expect(response?.headers()['content-security-policy']).toMatch(/script-src.*nonce-.+.*strict-dynamic/)
    // Production sends private, no-store (src/lib/supabase/proxy.ts); `next dev` overwrites every page with no-cache, must-revalidate.
    expect(response?.headers()['cache-control']).toMatch(/no-store|no-cache/)
    await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Confirm email', exact: true })).toBeEnabled()
    expect(new URL(page.url()).hash).toBe('')
    expect((await page.context().cookies()).some(value => value.name.includes('-auth-token'))).toBe(false)
    expect(Boolean((await db.auth.admin.getUserById(userId)).data.user?.email_confirmed_at)).toBe(false)
    await page.getByRole('button', { name: 'Confirm email', exact: true }).click()
    await page.waitForURL(url => url.pathname.startsWith('/onboarding'))
    const sessionCookies = (await page.context().cookies()).filter(value => value.name.includes('-auth-token'))
    expect(sessionCookies.length).toBeGreaterThan(0)
    expect(sessionCookies.every(value => value.httpOnly && value.sameSite === 'Lax')).toBe(true)
    await page.goto('/update-password')
    await expect(page.getByRole('heading', { name: 'Reset your password', exact: true })).toBeVisible()

    const link = await db.auth.admin.generateLink({ type: 'recovery', email })
    if (link.error) throw new Error('Could not generate a recovery fixture.')
    const query = new URLSearchParams({ type: 'recovery', token_hash: link.data.properties.hashed_token, intent: makeRecoveryIntent(email) })
    await recoveryPage.goto('/auth/verify#' + query)
    await expect(recoveryPage.getByRole('heading', { name: 'Confirm password reset', exact: true })).toBeVisible()
    await recoveryPage.getByRole('button', { name: 'Continue to new password', exact: true }).click()
    await expect(recoveryPage.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible()
    await recoveryPage.reload()
    await noHorizontalOverflow(recoveryPage)
    await recoveryPage.getByLabel('New password', { exact: true }).fill(updated)
    await recoveryPage.getByLabel('Confirm password', { exact: true }).fill(updated)
    await recoveryPage.getByRole('button', { name: 'Update password', exact: true }).click()
    await expect(recoveryPage.getByRole('status').filter({ hasText: 'Password updated' })).toBeVisible()
    expect((await recoveryContext.cookies()).some(value => value.name.includes('-auth-token'))).toBe(false)

    if (deployed) {
      // The deployed project requires a real CAPTCHA for password sign-in. This run proves the
      // recovery write and then uses a fresh owned link to test onboarding separately.
      expect((await db.auth.admin.getUserById(userId)).data.user?.user_metadata?.password_set).toBe(true)
      const entry = await db.auth.admin.generateLink({ type: 'magiclink', email })
      if (entry.error) throw new Error('Could not generate an onboarding sign-in fixture.')
      await recoveryPage.goto('/auth/verify#' + new URLSearchParams({ type: 'magiclink', token_hash: entry.data.properties.hashed_token }))
      await recoveryPage.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
    } else {
      const signIn = recoveryPage.getByRole('button', { name: 'Sign in', exact: true })
      await expect(signIn).toBeEnabled()
      await recoveryPage.getByLabel('Email', { exact: true }).fill(email)
      await recoveryPage.getByLabel(/^Password/).fill(updated)
      const response = recoveryPage.waitForResponse(r => new URL(r.url()).pathname === '/api/auth' && r.request().method() === 'POST')
      await signIn.click()
      expect((await response).ok()).toBe(true)
    }
    await recoveryPage.waitForURL(url => url.pathname.startsWith('/onboarding'))
    if (process.env.E2E_ENTRY_ONBOARDING === '1') {
      const proceed = async (step: string) => {
        await recoveryPage.getByRole('button', { name: 'Continue', exact: true }).click()
        await recoveryPage.waitForURL(url => url.pathname === '/onboarding/' + step)
      }
      await recoveryPage.getByRole('button', { name: /^(February|May|August|November)/ }).first().click()
      await recoveryPage.getByRole('button', { name: 'Not yet', exact: true }).click()
      await proceed('route')
      await recoveryPage.getByRole('button', { name: /^On my own/ }).click()
      await proceed('position')
      await recoveryPage.getByRole('button', { name: 'Starting fresh', exact: true }).click()
      await proceed('week')
      await recoveryPage.reload()
      await recoveryPage.getByRole('button', { name: /^Saturday morning/ }).click()
      await expect(recoveryPage.getByLabel('Saturday end')).toBeVisible()
      await expect(recoveryPage.getByLabel('Sunday end')).toHaveCount(0)
      await recoveryPage.getByRole('button', { name: '45 min', exact: true }).click()
      await proceed('plan')
      await expect(recoveryPage.getByRole('heading', { name: 'Your first week', exact: true })).toBeVisible()
      await noHorizontalOverflow(recoveryPage)
      await recoveryPage.getByRole('button', { name: 'Accept and open Calendar' }).click()
      await recoveryPage.waitForURL(url => url.pathname === '/app/calendar')
      const profile = await db.from('profiles').select('onboarding_status,max_session_minutes').eq('id', userId).single()
      expect(profile.data).toEqual({ onboarding_status: 'complete', max_session_minutes: 45 })
    }
    await recoveryPage.goto('/account')
    await recoveryPage.getByRole('button', { name: 'Sign out of this device', exact: true }).click()
    await expect(recoveryPage.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await noHorizontalOverflow(recoveryPage)
    expect(unexpected).toEqual([])
  } finally {
    await recoveryContext.close()
    const deleted = await db.auth.admin.deleteUser(userId)
    if (deleted.error && deleted.error.status !== 404) throw new Error('Could not clean up the browser fixture by ID.')
  }
})
