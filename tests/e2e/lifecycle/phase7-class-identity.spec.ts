/**
 * Phase 7 §1 browser proof (desktop + 390px): two classes on ONE day are two entries. An ordinary class-led student (SEEDED: onboarding, then two weekly
 * series on the same weekday; no study windows so no follow-up placement is needed). UI-driven: the log form picks each class by identity, a lost confirm
 * response is retried under the same key, the logged class is disabled in the list, and the second class on the same date logs separately.
 * Assertions read class_sessions / class_session_items; the unrelated class's row is compared before and after.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, noHorizontalOverflow, recorder, RUN, wd, chooseClassDay } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '', cyc: '', D: '', A: '', B: '', topic: '', reading: '', outcome: { id: '', code: '' } }, se = scopedErrors()
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  const persona = await classLedPersona(db)
  const a = await createStudent(db, `p7c${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) }); S.id = a.id; S.email = a.email
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single().throwOnError()).data!
  const today = new Date().toLocaleDateString('en-CA', { timeZone: cyc.timezone }); S.cyc = cyc.id; S.D = addDays(today, -1)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -7), ends_at_local: addDays(today, 9) }).eq('id', cyc.id).throwOnError()
  for (const t of ['plan_blocks', 'calendar_commitments', 'availability_windows']) await db.from(t).delete().eq('user_id', S.id).throwOnError()
  const series = async (label: string, start: string, end: string) => (await db.from('calendar_commitments').insert({ user_id: S.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [wd(S.D)],
    start_time: start, end_time: end, starts_on: addDays(today, -7), starts_at: `${addDays(today, -7)}T${start}:00Z`, ends_at: `${addDays(today, -7)}T${end}:00Z` }).select('id').single().throwOnError()).data!.id as string
  S.A = await series('Financial reporting class', '09:00', '10:00'); S.B = await series('Economics class', '11:00', '12:00')
  const lo = (await db.from('reading_los').select('id, code, reading_id').order('id').limit(1).throwOnError()).data![0]
  S.outcome = { id: lo.id, code: lo.code }; S.reading = lo.reading_id
  S.topic = (await db.from('curriculum_readings').select('topic_id').eq('id', lo.reading_id).single().throwOnError()).data!.topic_id
})
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message) }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase7-class-identity-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, seeded: 'student via onboarding; two weekly class series on one weekday; windows removed', unexpected: se.unexpected, allowances: se.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(se.unexpected, 'unexpected console/page errors').toEqual([])
})
const sessions = async () => (await db.from('class_sessions').select('id, class_date, occurrence_key, commitment_id, occurrence_date, kind').eq('user_id', S.id).order('logged_at')).data ?? []
async function fill(page: import('@playwright/test').Page, extent: 'All of it' | 'Part of it') {
  await page.getByRole('radio', { name: /We covered new material/ }).check()
  await page.getByLabel('Subject').selectOption(S.topic); await page.getByLabel('Reading').selectOption(S.reading)
  await page.getByText(new RegExp(`^${S.outcome.code}\\.`)).first().click(); await page.getByRole('radio', { name: extent }).first().check()
  await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
}

test('two classes on one day: each is its own entry; a lost confirm response is retried without a duplicate', async ({ page }) => {
  await login(page, db, S.email, '/app/calendar/log-class')
  await rec.browser('the form lists both same-day classes by name, and the page fits the viewport', async () => {
    const options = await page.getByLabel('Class', { exact: true }).locator('option').allInnerTexts()
    expect(options.filter(o => o.includes(S.D))).toHaveLength(2)
    expect(options.some(o => /Financial reporting class/.test(o)) && options.some(o => /Economics class/.test(o))).toBe(true)
    await noHorizontalOverflow(page)
  })
  await rec.browser('Class A: log "All of it"; the confirm reply is lost, the retry uses the same key, and exactly one session exists', async () => {
    await page.getByLabel('Class', { exact: true }).selectOption({ label: await page.getByLabel('Class', { exact: true }).locator('option', { hasText: 'Financial reporting class' }).innerText() })
    await fill(page, 'All of it')
    let seen = 0
    await se.expecting([{ label: 'owned class-log confirm reply lost after commit', url: /\/api\/class-log\/confirm$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
      await page.route('**/api/class-log/confirm', async route => { if (seen++ > 0) return route.continue(); await route.fetch(); await route.abort() })
      await page.getByRole('button', { name: 'Finish class log' }).click()
      await expect(page.locator('p.review-error')).toContainText(/Press Retry to send exactly the same request/i)
    })
    expect(await sessions()).toHaveLength(1)
    await page.getByRole('button', { name: 'Retry' }).click() // same key, same MANUAL/scheduled identity: the form was frozen meanwhile
    await page.waitForURL(u => !u.pathname.includes('log-class')); await page.unroute('**/api/class-log/confirm')
    const rows = await sessions()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ occurrence_key: `series:${S.A}:${S.D}`, commitment_id: S.A, occurrence_date: S.D, class_date: S.D })
  })
  const before = JSON.stringify((await sessions())[0])
  await rec.browser('Class A is now shown as logged and finished (selectable only to add or correct); Class B on the SAME day is still pending and is the default', async () => {
    await page.goto('/app/calendar/log-class')
    const sel = page.getByLabel('Class', { exact: true })
    await expect(sel.locator('option', { hasText: 'Financial reporting class' })).not.toHaveAttribute('disabled', '')
    await expect(sel.locator('option', { hasText: 'Financial reporting class' })).toContainText(/already logged and finished/i)
    await expect(sel.locator('option:checked')).toContainText('Economics class')
    await noHorizontalOverflow(page)
  })
  await rec.browser('Class B on the same date logs "Part of it" as a second session; Class A is unchanged; items stay separate', async () => {
    await chooseClassDay(page, S.D) // the only enabled class that day is B
    await fill(page, 'Part of it')
    await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const rows = await sessions()
    expect(rows).toHaveLength(2)
    expect(rows.map(r => r.occurrence_key).sort()).toEqual([`series:${S.A}:${S.D}`, `series:${S.B}:${S.D}`].sort())
    expect(rows.every(r => r.class_date === S.D)).toBe(true)
    expect(JSON.stringify(rows.find(r => r.commitment_id === S.A))).toBe(before)
    const items = (await db.from('class_session_items').select('session_id, extent').in('session_id', rows.map(r => r.id))).data!
    const ofA = items.find(i => i.session_id === rows.find(r => r.commitment_id === S.A)!.id), ofB = items.find(i => i.session_id === rows.find(r => r.commitment_id === S.B)!.id)
    expect([ofA?.extent, ofB?.extent]).toEqual(['full', 'part'])
  })
})
