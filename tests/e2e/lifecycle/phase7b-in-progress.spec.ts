/**
 * Phase 7B §2A, the primary chain driven through the class-log UI (desktop + 390px), one owned class-led student:
 * log part during class → reload → continue the SAME session → add an explicitly whole outcome → preview only the additional work → save → a second tab on an
 * older version is refused → a lost reply after the finish commits (Retry replays) → explicit finish. Asserts one session, no duplicate tasks, no evidence,
 * and that the other class the same day is untouched.
 * SEEDED (not driven): the student and accepted first week via the API onboarding helper; a deterministic timetable of two NAMED classes on one finished day
 * (the persona's own classes depend on the time of day) and a cycle that started six days ago.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN, addDays, wd } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = [], se = scopedErrors()
const S = { id: '', email: '', day: '', cycle: '' }
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  const p = await classLedPersona(db), a = await createStudent(db, `p7i${RUN}`, { onboard: true, onboarding: p.options, register: id => owned.push(id) }); S.id = a.id; S.email = a.email
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', S.id).eq('status', 'active').single()).data!
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: cyc.timezone as string }).format(new Date()); S.cycle = cyc.id as string; S.day = addDays(today, -2)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: addDays(today, 9) }).eq('id', cyc.id)
  await db.from('plan_blocks').delete().eq('user_id', S.id).eq('cycle_id', cyc.id)
  await db.from('availability_windows').delete().eq('user_id', S.id)
  await db.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: S.id, weekday, start_time: '09:00', end_time: '13:00', status: 'active' })))
  await db.from('calendar_commitments').delete().eq('user_id', S.id).eq('kind', 'class')
  for (const [label, st, en] of [['Financial reporting', '09:00', '10:00'], ['Economics', '11:00', '12:00']])
    await db.from('calendar_commitments').insert({ user_id: S.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [wd(S.day)], start_time: st, end_time: en, starts_on: addDays(today, -8), starts_at: `${addDays(today, -8)}T${st}:00Z`, ends_at: `${addDays(today, -8)}T${en}:00Z` })
})
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message) }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase7b-in-progress-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, seeded: 'student + accepted week via API onboarding helper; two named same-day classes and a 6-day-old cycle via guarded fixture', unexpected: se.unexpected, allowances: se.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([]); expect(se.unexpected, 'unexpected console/page errors').toEqual([])
})
const sessions = async () => (await db.from('class_sessions').select('id, version, completed_at, occurrence_key, class_date').eq('user_id', S.id)).data ?? []
const tasksOf = async (sid: string) => ((await db.from('plan_blocks').select('id, outcome_id').eq('class_session_id', sid).is('cancelled_at', null)).data ?? [])
const evidence = async () => (await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count
const pickClass = async (page: any, name: string) => { const sel = page.getByLabel('Class', { exact: true }); await sel.selectOption({ label: await sel.locator('option', { hasText: name }).first().innerText() }) }
const pickOutcome = async (page: any, code: string, extent: 'Part of it' | 'All of it') => {
  await page.getByLabel('Subject').selectOption((await db.from('curriculum_readings').select('topic_id').eq('id', 'r028').single()).data!.topic_id as string)
  await page.getByLabel('Reading').selectOption('r028')
  const box = page.locator('.class-log__outcomes li', { hasText: new RegExp(`^\\s*${code}\\.`) }).first()
  if (!(await box.locator('input[type=checkbox]').first().isChecked())) await box.locator('input[type=checkbox]').first().check()
  await box.getByRole('radio', { name: extent }).check()
}

test('log part, continue the same session, add a whole outcome, stale tab, lost finish reply, explicit finish', async ({ page, context }) => {
  const E0 = await evidence()
  await login(page, db, S.email, '/app/calendar/log-class')
  await rec.browser('Save coverage so far: a part outcome is saved to ONE session that is not finished; the page stays', async () => {
    await pickClass(page, 'Financial reporting'); await page.getByRole('radio', { name: /We covered new material/ }).check()
    await pickOutcome(page, 'a', 'Part of it'); await noHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await page.getByRole('button', { name: 'Save coverage so far' }).click()
    await expect(page.getByTestId('class-log-done')).toContainText(/not finished/i)
    await expect(page.getByTestId('class-log-saved')).toContainText('Part of it')
    const ss = (await sessions()).filter(s => s.occurrence_key?.startsWith('series:')); expect(ss).toHaveLength(1)
    expect(ss[0]).toMatchObject({ version: 1, completed_at: null, class_date: S.day })
  })
  await rec.browser('reload: the same class is offered as "continue", its saved coverage is shown, and the other same-day class is still pending', async () => {
    await page.reload(); await page.waitForLoadState('networkidle')
    await expect(page.getByLabel('Class', { exact: true }).locator('option:checked')).toContainText(/Financial reporting.*saved, in progress: continue logging/)
    await expect(page.getByTestId('class-log-saved')).toContainText(/still open/i)
    await expect(page.getByTestId('class-log-saved')).toContainText(/Part of it/)
    await expect(page.getByLabel('Class', { exact: true }).locator('option', { hasText: 'Economics' })).not.toContainText(/logged|saved/)
  })
  await rec.browser('continue: add an explicitly whole outcome; the preview reports ONE change and plans only the additional work; saving keeps the same session (version 2)', async () => {
    await pickOutcome(page, 'b', 'All of it')
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await expect(page.getByTestId('class-log-update-summary')).toContainText(/1 outcome added or corrected/)
    const before = (await sessions())[0]; const tBefore = (await tasksOf(before.id)).length
    await page.getByRole('button', { name: 'Save coverage so far' }).click(); await expect(page.getByTestId('class-log-done')).toBeVisible()
    await expect(page.getByTestId('class-log-saved')).toContainText('All of it')
    const ss = (await sessions()).filter(s => s.occurrence_key?.startsWith('series:')); expect(ss).toHaveLength(1)
    expect(ss[0]).toMatchObject({ version: 2, completed_at: null })
    const t = await tasksOf(ss[0].id); expect(t.length).toBeGreaterThan(tBefore)
    expect(new Set(t.map(x => x.id)).size).toBe(t.length)
  })
  await rec.browser('a second tab opened on the older version is refused atomically and keeps its input; nothing is saved by it', async () => {
    const tab2 = await context.newPage(); se.attach(tab2)
    // tab 2 opens now (version 2) and previews an addition; tab 1 then saves version 3; tab 2's save must be refused
    await tab2.goto('/app/calendar/log-class'); await tab2.waitForLoadState('networkidle')
    await pickOutcome(tab2, 'c', 'Part of it'); await tab2.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(tab2.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await pickOutcome(page, 'c', 'All of it'); await page.getByRole('button', { name: 'Preview the plan update' }).click(); await page.getByRole('button', { name: 'Save coverage so far' }).click(); await expect(page.getByTestId('class-log-done')).toBeVisible()
    await expect(page.getByTestId('class-log-saved').getByRole('listitem')).toHaveCount(3)
    expect((await sessions()).find(s => s.occurrence_key?.startsWith('series:'))!.version).toBe(3)
    await se.expecting([{ label: 'stale second tab refused (409 preview_changed or version_changed)', url: /\/api\/class-log\/confirm$/, statuses: [409], method: 'POST', min: 1, max: 1 }], async () => {
      await tab2.getByRole('button', { name: 'Save coverage so far' }).click()
      // the reviewed plan itself went stale (tab 1 changed what is owed), so the stale-preview rule refuses first; a pure version clash is proven at the HTTP layer
      await expect(tab2.locator('.review-error')).toContainText(/changed since you previewed|changed in another tab or device/i)
    })
    await expect(tab2.getByLabel('Class', { exact: true })).toBeVisible()
    expect((await sessions()).find(s => s.occurrence_key?.startsWith('series:'))!.version).toBe(3)
    await tab2.close()
  })
  await rec.browser('Finish class log: the reply is lost AFTER the commit → Retry replays; the form is frozen meanwhile; one session, finished once, no extra tasks or evidence', async () => {
    await page.reload(); await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    const sid = (await sessions()).find(s => s.occurrence_key?.startsWith('series:'))!.id, tCount = (await tasksOf(sid)).length
    let n = 0
    await se.expecting([{ label: 'finish reply lost after commit', url: /\/api\/class-log\/confirm$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
      await page.route('**/api/class-log/confirm', async route => { if (n++ > 0) return route.continue(); await route.fetch(); await route.abort() })
      await page.getByRole('button', { name: 'Finish class log' }).click()
      await expect(page.getByTestId('class-log-unsure')).toBeVisible()
    })
    await expect(page.getByLabel('Class', { exact: true })).toBeDisabled()
    const mid = (await sessions()).find(s => s.id === sid)!; expect(mid.completed_at).not.toBeNull()
    await page.getByRole('button', { name: 'Retry' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class')); await page.unroute('**/api/class-log/confirm')
    const end = (await sessions()).filter(s => s.occurrence_key?.startsWith('series:'))
    expect(end).toHaveLength(1); expect(end[0].version).toBe(mid.version)
    expect((await tasksOf(sid)).length).toBe(tCount)
    expect(await evidence()).toBe(E0)
    expect((await sessions()).some(s => s.occurrence_key?.includes('Economics'))).toBe(false)
  })
  await rec.browser('the finished class is still offered for adding or correcting, and the Economics class on the same day has no session', async () => {
    await page.goto('/app/calendar/log-class'); await page.waitForLoadState('networkidle')
    await expect(page.getByLabel('Class', { exact: true }).locator('option', { hasText: 'Financial reporting' })).toContainText(/already logged and finished/)
    await expect(page.getByLabel('Class', { exact: true }).locator('option', { hasText: 'Economics' })).not.toContainText(/logged|saved/)
    expect((await sessions()).length).toBe(1)
  })
})
