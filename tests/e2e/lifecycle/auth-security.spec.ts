import { expect, test } from '@playwright/test'
import { makeRecoveryIntent } from '../../../src/lib/auth/securityServer'
import { admin, noHorizontalOverflow, TARGET } from './helpers'

test('verification, recovery and app entry use the rendered security controls', async ({ page, browser, baseURL }) => {
  const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!)
  const local = new URL(baseURL!)
  expect(project.hostname).toBe(TARGET + '.supabase.co')
  expect(['localhost', '127.0.0.1']).toContain(local.hostname)
  const db = admin()
  const email = 'authbrowser+' + crypto.randomUUID().slice(0, 12) + '@example.com'
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

    const signup = await db.auth.admin.generateLink({ type: 'signup', email, password: original })
    if (signup.error) throw new Error('Could not generate a confirmation fixture.')
    const response = await page.goto('/auth/verify#' + new URLSearchParams({ type: 'signup', token_hash: signup.data.properties.hashed_token }))
    expect(response?.headers()['content-security-policy']).toMatch(/script-src.*nonce-.+.*strict-dynamic/)
    // Production sends private, no-store (src/lib/supabase/proxy.ts); `next dev` overwrites every page with no-cache, must-revalidate.
    expect(response?.headers()['cache-control']).toMatch(/no-store|no-cache/)
    await expect(page.getByRole('heading', { name: 'Confirm your email', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
    expect(new URL(page.url()).hash).toBe('')
    expect((await page.context().cookies()).some(value => value.name.includes('-auth-token'))).toBe(false)
    expect(Boolean((await db.auth.admin.getUserById(userId)).data.user?.email_confirmed_at)).toBe(false)
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
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
    await recoveryPage.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(recoveryPage.getByRole('heading', { name: 'Choose a new password', exact: true })).toBeVisible()
    await recoveryPage.reload()
    await noHorizontalOverflow(recoveryPage)
    await recoveryPage.getByLabel('New password', { exact: true }).fill(updated)
    await recoveryPage.getByLabel('Confirm password', { exact: true }).fill(updated)
    await recoveryPage.getByRole('button', { name: 'Update password', exact: true }).click()
    await expect(recoveryPage.getByRole('status').filter({ hasText: 'Password updated' })).toBeVisible()
    expect((await recoveryContext.cookies()).some(value => value.name.includes('-auth-token'))).toBe(false)

    await recoveryPage.getByLabel('Email', { exact: true }).fill(email)
    await recoveryPage.getByLabel(/^Password/).fill(updated)
    await recoveryPage.getByRole('button', { name: 'Sign in', exact: true }).click()
    await recoveryPage.waitForURL(url => url.pathname.startsWith('/onboarding'))
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
