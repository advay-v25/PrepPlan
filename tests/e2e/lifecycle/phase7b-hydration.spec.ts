/**
 * Phase 7B §5: the `class-editing` mobile hydration warning. The original console message (docs/evidence/class-editing-browser-2026-11-18-mobile-390-*.json)
 * names a mismatch under <CalendarWeekGrid> > .calendar-grid. The only server/client-varying value in that subtree is the "current time" line, whose top
 * offset is computed from `new Date()` at render. This spec makes the CLIENT clock differ from the SERVER clock by a bounded, recorded amount before
 * hydration (Playwright's fake clock) and asserts there is no hydration error: deterministic, no waiting for a minute boundary, no waiver.
 * Offsets: 0 (control), +5 min, and across local midnight (+1 day) at desktop and 390px. Needs an owned student only.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { admin, login, RUN } from './helpers'

const db = admin(), owned: string[] = [], S = { id: '', email: '' }, seen: { offsetMin: number; messages: string[] }[] = []
test.beforeAll(async () => { const a = await createStudent(db, `p7h${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = a.id; S.email = a.email })
test.afterAll(async ({}, info) => {
  for (const id of owned.splice(0)) await db.auth.admin.deleteUser(id)
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase7b-hydration-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, clockOffsets: seen }, null, 1))
})

for (const offsetMin of [0, 5, 24 * 60]) {
  test(`calendar hydrates with a client clock ${offsetMin} min from the server's`, async ({ page }) => {
    const messages: string[] = []
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') messages.push(m.text().slice(0, 400)) })
    page.on('pageerror', e => messages.push(`pageerror: ${e.message.slice(0, 300)}`))
    await login(page, db, S.email, '/app')
    await page.clock.install({ time: new Date(Date.now() + offsetMin * 60_000) })
    await page.goto('/app/calendar?view=week')
    await page.waitForLoadState('networkidle')
    await expect(page.getByRole('tabpanel').first()).toBeVisible()
    seen.push({ offsetMin, messages: messages.filter(t => /hydrat/i.test(t)) })
    expect(messages.filter(t => /hydrat|did not match|didn't match/i.test(t)), `hydration messages with the client clock ${offsetMin} min ahead`).toEqual([])
  })
}
