/**
 * Phase 7B §5: real typo/phrasing examples reach the exact class-log editor through the Coach, provider-free (the deterministic interpreter; this is NOT a
 * claim about live-model language quality). Nothing is written by the Coach: it only links the reviewed editor. A message that does not clearly ask for a
 * class log gets no class-log link and writes nothing. Desktop + 390px, one owned class-led student.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, RUN } from './helpers'

const db = admin(), owned: string[] = [], S = { id: '', email: '' }, rows: unknown[] = []
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => { const p = await classLedPersona(db); const a = await createStudent(db, `p7c${RUN}`, { onboard: true, onboarding: p.options, register: id => owned.push(id) }); S.id = a.id; S.email = a.email })
test.afterAll(async ({}, info) => {
  for (const id of owned.splice(0)) await db.auth.admin.deleteUser(id)
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase7b-coach-phrasing-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, provider: 'none (deterministic interpreter)', rows }, null, 1))
})
const writes = async () => ((await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0) + ((await db.from('class_sessions').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0)

test('class-log phrasing: typo and plain variants link the editor; an unclear message does not; the Coach writes nothing', async ({ page }) => {
  await login(page, db, S.email, '/app/coach')
  const ask = async (text: string) => { await page.getByRole('textbox', { name: 'Ask the coach' }).fill(text); await page.getByRole('button', { name: 'Send' }).click() }
  for (const text of ['i attnded clas yesterday, can u log it', 'I atended class yday please log it', 'I attended class yesterday, can you log it']) {
    await page.goto('/app/coach')
    const before = await writes()
    await ask(text)
    await expect(page.locator('a[href^="/app/calendar/log-class"]').first(), text).toBeVisible({ timeout: 45_000 })
    expect(await writes(), `${text}: the Coach itself writes nothing`).toBe(before)
    await noHorizontalOverflow(page)
    rows.push({ text, result: 'linked the reviewed class-log editor', writesBefore: before, writesAfter: await writes() })
  }
  await page.goto('/app/coach')
  const before = await writes(), linksBefore = await page.locator('a[href^="/app/calendar/log-class"]').count() // earlier answers stay in the history
  await ask('i went to clas')
  await expect(page.locator('.coach-message, [data-coach-message]').last()).toBeVisible({ timeout: 45_000 })
  await page.waitForTimeout(1500)
  await expect(page.locator('a[href^="/app/calendar/log-class"]')).toHaveCount(linksBefore) // this message added no class-log link
  expect(await writes()).toBe(before)
  rows.push({ text: 'i went to clas', result: 'no class-log link, nothing written' })
})
