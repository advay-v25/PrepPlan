import { expect, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'

// Disposable project by default. Any other project needs BOTH the exact ref and the same ref repeated as an explicit opt-in.
export const TARGET = process.env.E2E_TARGET || 'mnlezctdqkdfgvmipmcj'
// The isolated local stack (scripts/local-stack.cjs): loopback Postgres + Auth + PostgREST, created for this run and deleted after. Never a hosted project.
export const LOCAL = process.env.E2E_SUITE === 'local-stack' && process.env.LOCAL_STACK === '1'
export const TARGET_HOST = LOCAL ? '127.0.0.1' : `${TARGET}.supabase.co`
if (!LOCAL && TARGET !== 'mnlezctdqkdfgvmipmcj' && process.env.E2E_ALLOW_TARGET !== TARGET) throw new Error('Refusing to run fixtures against a non-disposable project without E2E_ALLOW_TARGET set to its exact ref.')
export const RUN = `lb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
export const J = { 'Content-Type': 'application/json' }
export const admin = (): SupabaseClient => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url || (LOCAL ? !/^http:\/\/127\.0\.0\.1:\d+$/.test(new URL(url).origin) : new URL(url).origin !== `https://${TARGET}.supabase.co`)) {
    throw new Error('Browser fixtures require the configured fixture project.')
  }
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Configure a server key for the disposable Supabase project.')
  return createClient(url, key, { auth: { persistSession: false } })
}
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
const watched = new WeakSet<object>()
const safeRoute = (url: string) => url.replace(/([?&#](?:token_hash|token|code|access_token|refresh_token)=)[^&#]*/g, '$1[redacted]')
/**
 * Records every hydration error in full, whichever journey it happens in: route, viewport, time zones and the whole message (which names the element
 * that differed). It changes no assertion; it only keeps the evidence an intermittent mismatch would otherwise lose.
 */
export function captureHydration(page: Page, file = process.env.HYDRATION_CAPTURE_FILE || 'docs/evidence/hydration-captures.jsonl') {
  const context = page.context()
  if (watched.has(context)) return
  watched.add(context)
  const record = async (at: Page | null, text: string) => {
    if (!/hydrat|did(?:n't| not) match|#418|#423|#425/i.test(text)) return
    const browserZone = await at?.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => null)
    fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), url: at ? safeRoute(at.url()) : null, viewport: at?.viewportSize() ?? null, browserTimezone: browserZone ?? null, runnerTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone, fixtureStudentTimezone: 'Europe/London unless the journey sets another', error: text })}\n`)
  }
  context.on('console', m => { if (m.type() === 'error') void record(m.page(), m.text()) })
  context.on('weberror', e => void record(e.page(), `${e.error().message}\n${e.error().stack ?? ''}`))
}

export async function login(page: Page, db: SupabaseClient, email: string, next = '/app') {
  captureHydration(page)
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw new Error(error.message)
  await page.goto(`/auth/verify#${new URLSearchParams({ token_hash: data.properties.hashed_token, type: 'magiclink', next })}`)
  await page.getByRole('button', { name: 'Confirm sign-in', exact: true }).click()
  await page.waitForURL(url => url.pathname === new URL(next, url).pathname)
  await page.waitForLoadState('load')
  expect(new URL(page.url()).pathname, 'Magic-link login must reach its requested destination before the journey starts').toBe(new URL(next, page.url()).pathname)
  const sessionCookies = (await page.context().cookies()).filter(c => /^sb-.*-auth-token(?:\.\d+)?$/.test(c.name))
  expect(sessionCookies.length, 'Magic-link login must install a browser session cookie').toBeGreaterThan(0)
  expect(sessionCookies.every(cookie => cookie.httpOnly && cookie.sameSite === 'Lax'), 'Each session cookie is server-only and scoped to same-site requests').toBe(true)
}

/** Fixture bank through the existing guarded command, for the readings the planner actually placed. Test-only; never real inventory. */
export async function makeBank(readings: string[]) {
  await acquireBankLock()
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lifecycle-b-')), 'bank.json')
  try { execFileSync('node', LOCAL ? ['scripts/local-stack.cjs', 'bank', 'create', `--dir=${process.env.LOCAL_STACK_DIR}`, `--out=${file}`, `--readings=${readings.join(',')}`, '--per-outcome=10', '--variants=2'] : ['scripts/fixture-bank.cjs', 'create', `--confirm-target=${TARGET}`, `--out=${file}`, `--readings=${readings.join(',')}`, '--per-outcome=10', '--variants=2'], { stdio: 'inherit' }) }
  catch (e) { if (fs.existsSync(file)) destroyBank(file); else releaseBankLock(); throw e }   // a half-created bank is removed by its recorded ids, never left behind
  return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) as { tag: string; items: string[]; families: string[] } }
}
export function destroyBank(file: string) { try { execFileSync('node', LOCAL ? ['scripts/local-stack.cjs', 'bank', 'destroy', `--dir=${process.env.LOCAL_STACK_DIR}`, `--file=${file}`] : ['scripts/fixture-bank.cjs', 'destroy', `--confirm-target=${TARGET}`, `--file=${file}`], { stdio: 'inherit' }) } finally { releaseBankLock() } }

/** The fixture-bank command line for the selected target: the local stack, or the guarded hosted-fixture command. */
export const bankCli = (sub: 'create' | 'destroy', args: string[]) => LOCAL
  ? ['scripts/local-stack.cjs', 'bank', sub, `--dir=${process.env.LOCAL_STACK_DIR}`, ...args]
  : ['scripts/fixture-bank.cjs', sub, `--confirm-target=${TARGET}`, ...args]

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

/**
 * Removes an owned student at the end of a journey. An account that setup already removed is not a failure, and a real cleanup problem is reported
 * as a SOFT failure: it is shown beside whatever failed first and can never replace it.
 */
export async function removeStudent(db: SupabaseClient, id: string) {
  const { error } = await db.auth.admin.deleteUser(id)
  expect.soft(error && !/not found/i.test(error.message) ? error.message : null, `cleanup of owned student ${id}`).toBeNull()
}

/** A time zone where it is `hour` o'clock right now (a fixed-offset zone, so no daylight saving), preferring one where today is not a Sunday. */
export function zoneAtLocalHour(...hours: number[]) {
  const utc = new Date().getUTCHours()
  const zones = hours.map(hour => { let o = hour - utc; if (o > 14) o -= 24; if (o < -12) o += 24; return o === 0 ? 'Etc/GMT' : `Etc/GMT${o > 0 ? '-' : '+'}${Math.abs(o)}` })
  const sunday = (zone: string) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, weekday: 'short' }).format(new Date()) === 'Sun'
  return zones.find(z => !sunday(z)) ?? zones[0]
}
