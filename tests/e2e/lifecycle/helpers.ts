import { expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'

export const TARGET = 'asylsxszdhlnzewhwtga'
export const RUN = `lb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
export const J = { 'Content-Type': 'application/json' }
export const admin = (): SupabaseClient => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10)
export const wd = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()

export type Rec = { step: string; status: 'pass' | 'fail'; detail?: string; how: 'browser' | 'endpoint-supplement' }
/** Every step is recorded with HOW it was driven. A failing step is recorded and rethrown, so a serial run stops at the first real failure. */
export function recorder() {
  const rows: Rec[] = []
  const run = async (how: Rec['how'], step: string, fn: () => Promise<void>) => {
    try { await fn(); rows.push({ step, status: 'pass', how }) } catch (e) {
      const detail = String((e as Error).message)
        .replace(/\b(cookie|set-cookie|authorization|apikey):[^\r\n]*/gi, '$1: [redacted]')
        .replace(/([?&](?:token_hash|code|access_token|refresh_token)=)[^&#\s"'<>]+/gi, '$1[redacted]')
        .slice(0, 600)
      rows.push({ step, status: 'fail', how, detail })
      throw e
    }
  }
  return { rows, browser: (s: string, fn: () => Promise<void>) => run('browser', s, fn), api: (s: string, fn: () => Promise<void>) => run('endpoint-supplement', s, fn) }
}

/** Sign the browser in as the student through the same magic-link confirmation the app uses. */
export async function login(page: Page, db: SupabaseClient, email: string, next = '/app') {
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(error.message)
  await page.goto(`/auth/verify#${new URLSearchParams({ token_hash: data.properties.hashed_token, type: 'magiclink', next })}`)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.waitForURL(url => url.pathname === new URL(next, url).pathname)
  await page.waitForLoadState('networkidle')
  expect(new URL(page.url()).pathname, 'Magic-link login must reach its requested destination before the journey starts').toBe(new URL(next, page.url()).pathname)
  const sessionCookies = (await page.context().cookies()).filter(c => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
  expect(sessionCookies.length, 'Magic-link login must install a browser session cookie').toBeGreaterThan(0)
  expect(sessionCookies.every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax'), 'Each session cookie is server-only and scoped to same-site requests').toBe(true)
}

/** Fixture bank through the existing guarded command, for the readings the planner actually placed. Test-only; never real inventory. */
export async function makeBank(readings: string[]) {
  await acquireBankLock()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-b-')), 'bank.json')
  try { execFileSync('node', ['scripts/fixture-bank.cjs', 'create', `--confirm-target=${TARGET}`, `--out=${file}`, `--readings=${readings.join(',')}`, '--per-outcome=10', '--variants=2'], { stdio: 'inherit' }) }
  catch (e) { if (fs.existsSync(file)) destroyBank(file); else releaseBankLock(); throw e }   // a half-created bank is removed by its recorded ids, never left behind
  return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) as { tag: string; items: string[]; families: string[] } }
}
export function destroyBank(file: string) { try { execFileSync('node', ['scripts/fixture-bank.cjs', 'destroy', `--confirm-target=${TARGET}`, `--file=${file}`], { stdio: 'inherit' }) } finally { releaseBankLock() } }

/** No horizontal overflow, no console/page errors collected by the caller. */
export async function noHorizontalOverflow(page: Page) {
  // Compare with the CONFIGURED viewport and the document's client width: on mobile emulation innerWidth expands to fit overflowing content and hides the failure.
  const vp = page.viewportSize()!.width
  const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, body: document.body.scrollWidth }))
  expect(Math.max(w.scroll, w.body), `horizontal overflow on ${page.url()} (viewport ${vp}, client ${w.client})`).toBeLessThanOrEqual(vp + 1)
  expect(w.client, `document client width exceeds the configured viewport on ${page.url()}`).toBeLessThanOrEqual(vp + 1)
}

/** The class log chooses an actual class (its own identity), not a bare date: pick the enabled class on that day that is not yet logged (a logged class is for continuing). */
export async function chooseClassDay(page: Page, date: string) {
  const select = page.getByLabel('Class', { exact: true })
  const label = await select.locator('option:not([disabled])', { hasText: date, hasNotText: /already logged|saved, in progress/ }).first().innerText()
  await select.selectOption({ label })
}
