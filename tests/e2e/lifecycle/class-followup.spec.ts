/**
 * Phase 1 (desktop and 390px): class log -> preview -> confirm -> exact task drawer -> partial minutes -> reload -> Home / Curriculum / Tests scope.
 * One ordinary class-led throwaway student per project, deleted afterwards. Every assertion about saved state reads the database after the UI acted.
 * No expected failures are allowed: any failed request, HTTP error, console error or page error fails the run (no ignore rules).
 * Constructed fixture (recorded in the evidence): the student's accepted cycle spans six days back to nine ahead, so real room exists in real time.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, recorder, RUN, wd, chooseClassDay } from './helpers'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '', cycle: '', tz: 'Europe/London', task: '', taskDate: '', taskMinutes: 0, partTask: '', sessionId: '', n: 0, bigCount: 0 }
const unexpected: string[] = []
/** True only while the stale-preview step deliberately makes ONE confirmation come back 409 preview_changed (the UI must refuse, keep the input and show a fresh preview). */
let expectStale = false

test.describe.configure({ mode: 'serial' })
const navTimes: number[] = []
test.beforeEach(({ page }) => {
  page.on('framenavigated', f => { if (f === page.mainFrame()) navTimes.push(Date.now()) })
  // An aborted soft-navigation RSC fetch is benign only when the page's own next navigation (within 2s) superseded it; an abort with no navigation around it is still reported.
  page.on('requestfailed', r => { if (r.method() !== 'GET' || !/[?&]_rsc=/.test(r.url()) || r.failure()?.errorText !== 'net::ERR_ABORTED' || r.headers()['next-router-prefetch'] === '1') return; const at = Date.now(); setTimeout(() => { if (!navTimes.some(t => Math.abs(t - at) <= 2000)) unexpected.push(`requestfailed ${r.url()} (no navigation superseded it)`) }, 2100) })
  // The ONLY allowance: the task drawer's scope read cancels its own in-flight request through its AbortController when the drawer re-renders or closes.
  page.on('requestfailed', r => { if (r.method() === 'GET' && /[?&]_rsc=/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return; if (r.method() === 'GET' && r.headers()['rsc'] === '1' && r.headers()['next-router-prefetch'] === '1' && r.failure()?.errorText === 'net::ERR_ABORTED') return; if (r.method() === 'GET' && /\/api\/tests\/scope\/confirm\?blockId=/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED') return; unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`) })
  page.on('response', r => { if (expectStale && r.status() === 409 && r.request().method() === 'POST' && /\/api\/class-log\/confirm$/.test(r.url())) return; if (r.status() >= 400) unexpected.push(`HTTP ${r.status()} ${r.url()}`) })
  page.on('console', m => { if (m.type() === 'error' && expectStale && /status of 409/.test(m.text())) return; if (m.type() === 'error') unexpected.push(`${page.url()} ${m.text().slice(0, 1800)}`) })
  page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 300)}`))
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message), error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/class-followup-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, allowance: 'GET /api/tests/scope/confirm aborted by its own AbortController (drawer re-render/close) only', fixture: 'accepted cycle constructed as today-6..today+9 for the throwaway student', steps: rec.rows, unexpected, cleanup }, null, 2))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

/** The layout fits the CLIENT width, which must itself be the configured viewport (an overflowing page widens the layout viewport on a phone). */
async function fitsViewport(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, inner: window.innerWidth }))
  const vp = page.viewportSize()!.width
  expect(w.scroll, `horizontal overflow on ${page.url()} (${JSON.stringify(w)})`).toBeLessThanOrEqual(w.client + 1)
  expect(w.client, `layout viewport wider than the configured ${vp}px`).toBeLessThanOrEqual(vp)
}

test('class log -> feasible linked sittings -> exact drawer -> partial minutes -> reload -> Home, Curriculum and Tests scope', async ({ page }) => {
  test.setTimeout(240_000)
  const persona = await classLedPersona(db)
  const c = await createStudent(db, `cf${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  S.id = c.id; S.email = c.email
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', c.id).eq('status', 'active').single()).data!
  S.cycle = cyc.id as string; S.tz = (cyc.timezone as string) || S.tz
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: S.tz }).format(new Date())
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: addDays(today, 9) }).eq('id', S.cycle)
  await db.from('profiles').update({ max_session_minutes: 45 }).eq('id', c.id)
  await login(page, db, c.email)
  const ctx = await page.evaluate(async () => (await fetch('/api/class-log/context')).json())
  const classDay = (ctx.context.pendingDates as string[]).slice().sort()[0]; expect(classDay).toBeTruthy()

  // an outcome whose follow-up needs more than one sitting at a 45-minute limit, and a second outcome logged as only a part
  let reading = '', topic = '', big: { id: string; code: string; title: string } | null = null, part: { id: string; code: string; title: string } | null = null
  for (const r of ((await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(60)).data ?? [])) {
    const los = (await db.from('reading_los').select('id, code, title').eq('reading_id', r.id).order('sequence').limit(2)).data ?? []
    if (los.length < 2) continue
    const p = await page.evaluate(async ([d, o]) => (await fetch('/api/class-log/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classDate: d, kind: 'covered', items: [{ outcomeId: o, extent: 'full' }] }) })).json(), [classDay, los[0].id])
    if (p.ok && p.summary.placedMinutes + p.summary.remainingMinutes > 45) { reading = r.id as string; topic = r.topic_id as string; big = los[0] as any; part = los[1] as any; break }
  }
  expect(reading && big && part).toBeTruthy()

  await rec.browser('class log: one outcome "All of it", one "Part of it"; preview shows the sitting limit, linked sittings at or below it, and real placement (no "comfortable" claim without room)', async () => {
    await page.goto('/app/calendar/log-class'); await fitsViewport(page)
    await chooseClassDay(page, classDay); await page.getByRole('radio', { name: /We covered new material/ }).check()
    await page.getByLabel('Subject').selectOption(topic); await page.getByLabel('Reading').selectOption(reading)
    await page.getByText(new RegExp(`^${big!.code}\\.`)).first().click(); await page.getByText(new RegExp(`^${part!.code}\\.`)).first().click()
    await page.getByRole('radio', { name: 'All of it' }).nth(0).check(); await page.getByRole('radio', { name: 'Part of it' }).nth(1).check()
    await page.getByRole('textbox', { name: /Which part of/ }).nth(1).fill('the definition only')
    await fitsViewport(page)
    expect((await db.from('class_sessions').select('id').eq('user_id', c.id)).data).toHaveLength(0)
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await expect(page.getByTestId('class-log-summary')).toContainText('at most 45 min')
    const mins = await page.locator('.class-log__preview li li small').allInnerTexts()
    expect(mins.length).toBeGreaterThanOrEqual(2)
    for (const m of mins) expect(Number(/(\d+) min/.exec(m)![1])).toBeLessThanOrEqual(45)
    await expect(page.locator('.class-log__preview')).toContainText(/sitting 1 of \d/)
    expect((await db.from('class_sessions').select('id').eq('user_id', c.id)).data).toHaveLength(0)   // previewing wrote nothing
    await fitsViewport(page)
  })
  await rec.browser('Confirm: one class session and exactly the previewed sittings, one scope group, declared order, dates after the class and not in the past', async () => {
    await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const sess = (await db.from('class_sessions').select('id').eq('user_id', c.id)).data!; expect(sess).toHaveLength(1)
    const rows = (await db.from('plan_blocks').select('*').eq('class_session_id', sess[0].id).order('local_date')).data!
    const ofBig = rows.filter(r => r.outcome_id === big!.id), ofPart = rows.filter(r => r.outcome_id === part!.id)
    expect(ofBig.length).toBeGreaterThanOrEqual(2); expect(ofBig.every(r => r.duration_minutes <= 45)).toBe(true)
    expect(rows.every(r => r.local_date > classDay && r.local_date >= today && r.lm_id === reading)).toBe(true)
    expect(new Set(ofBig.map(r => r.scope_group_id)).size).toBe(1); expect(ofBig[0].scope_group_id).toBeTruthy()
    expect(ofBig.slice(1).every((r, i) => (r.dependencies as string[])[0] === ofBig[i].id)).toBe(true)
    S.task = ofBig[0].id as string; S.taskDate = ofBig[0].local_date as string; S.taskMinutes = ofBig[0].duration_minutes as number; S.partTask = ofPart[0]?.id ?? ''; S.sessionId = sess[0].id as string; S.n = rows.length
    S.bigCount = ofBig.length
  })
  await rec.browser('the exact drawer: scope, class date and why now, a concrete method for the student\'s own material, what done means, how it is checked, and scoped Curriculum/Tests links', async () => {
    await page.goto(`/app/calendar?week=${S.taskDate}&view=agenda&task=${S.task}`)
    const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await fitsViewport(page)
    await expect(d).toContainText(big!.title); await expect(d).toContainText(`Sitting 1 of ${S.bigCount}`)
    await expect(d.getByText('Why this, now')).toBeVisible(); await expect(d).toContainText('Covered in class on')
    await expect(d.getByText('How to approach it')).toBeVisible(); await expect(d).toContainText('Close your notes')
    await expect(d.getByText('What done means')).toBeVisible(); await expect(d).toContainText('partly done')
    await expect(d.getByTestId('task-verification')).toContainText('later weekly paper can test')
    const links = d.getByTestId('task-reading-links')
    await expect(links.getByRole('link', { name: /Curriculum/ })).toHaveAttribute('href', `/app/curriculum/${topic}/${reading}`)
    await expect(links.getByRole('link', { name: /paper covers/ })).toHaveAttribute('href', '/app/tests')
    await expect(d).toContainText(`${S.bigCount} sittings`.replace(/^\d+ /, '')) // the shared-task notice mentions sittings
  })
  await rec.browser('report 12 minutes studied: partly done; the plan\'s minutes stay the plan, the actual minutes are recorded separately; reload keeps it', async () => {
    const d = page.getByRole('dialog')
    await d.getByRole('button', { name: 'Partly done' }).click(); await d.getByLabel('Actual minutes').fill('12'); await d.getByRole('button', { name: 'Save partial progress' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', S.task).single()).data!.execution).toBe('partial')
    const row = (await db.from('plan_blocks').select('duration_minutes').eq('id', S.task).single()).data!
    expect(row.duration_minutes).toBe(S.taskMinutes)
    const ev = (await db.from('task_events').select('actual_duration_minutes, event_type').eq('task_id', S.task).eq('event_type', 'partial')).data!
    expect(ev.map(e => e.actual_duration_minutes)).toContain(12)
    await page.waitForLoadState('networkidle')   // let the drawer's own in-flight reads finish; a navigation would otherwise abort them
    await page.reload(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog')).toContainText(/partial/i)
    await expect(page.getByRole('dialog')).toContainText('Sitting 1 of'); await fitsViewport(page); await page.waitForLoadState('networkidle')
  })
  await rec.browser('Home, Curriculum and Tests agree: the week count equals the database, the reading link resolves, the part stays pending and the whole outcome is not confused with it', async () => {
    await page.goto('/app')
    const open = (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', c.id).eq('cycle_id', S.cycle).is('cancelled_at', null).neq('execution', 'cancelled').eq('is_protected_commitment', false)).count!
    await expect(page.getByRole('img', { name: /\d+ of \d+ done today/ })).toBeVisible(); expect(open).toBeGreaterThan(0); await fitsViewport(page)
    await page.goto(`/app/curriculum/${topic}/${reading}`); await expect(page.locator('body')).toContainText(big!.title); await fitsViewport(page)
    await page.goto('/app/tests'); const pending = page.getByTestId('pending-portions'); await expect(pending).toBeVisible()
    await expect(pending).toContainText(part!.title); await expect(pending).not.toContainText(big!.title); await fitsViewport(page)
    await expect(pending).toContainText(classDay)
  })
  await rec.browser('keyboard: the drawer opens with focus inside, Tab stays inside, Escape closes it', async () => {
    await page.goto(`/app/calendar?week=${S.taskDate}&view=agenda&task=${S.task}`); await page.waitForLoadState('networkidle')
    const d = page.getByRole('dialog'); await expect(d).toBeVisible()
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true)
    for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true) }
    await page.keyboard.press('Escape'); await expect(d).toHaveCount(0)
  })
})

/** Student with real room on ONE weekend day only (a 120-minute window), so a follow-up of two or more sittings must share that day. */
async function oneDayStudent(page: Page, tag: string) {
  const persona = await classLedPersona(db)
  const c = await createStudent(db, `${tag}${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', c.id).eq('status', 'active').single()).data!
  const tz = (cyc.timezone as string) || 'Europe/London'
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  await db.from('plan_blocks').delete().eq('user_id', c.id).eq('cycle_id', cyc.id)
  await db.from('profiles').update({ max_session_minutes: 45 }).eq('id', c.id)
  let day = addDays(today, 1); while (wd(day) !== 6 && wd(day) !== 0) day = addDays(day, 1)
  // The week ends the day after the study day (its last day takes no follow-up), so exactly ONE day can hold work whatever weekday the suite runs on.
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: addDays(day, 1) }).eq('id', cyc.id)
  const setWindows = async (on: boolean) => { await db.from('availability_windows').delete().eq('user_id', c.id); if (on) await db.from('availability_windows').insert({ user_id: c.id, weekday: wd(day), start_time: '09:00', end_time: '11:00', status: 'active' }) }
  await setWindows(true)
  await login(page, db, c.email)
  const ctx = await page.evaluate(async () => (await fetch('/api/class-log/context')).json())
  const classDay = (ctx.context.pendingDates as string[]).slice().sort()[0]
  // an outcome whose follow-up needs between 46 and 120 minutes: two or more sittings, all fitting the one day
  let pick: { reading: string; topic: string; id: string; code: string; title: string } | null = null
  for (const r of ((await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(80)).data ?? [])) {
    const los = (await db.from('reading_los').select('id, code, title').eq('reading_id', r.id).order('sequence').limit(1)).data ?? []
    if (!los[0]) continue
    const p = await page.evaluate(async ([d, o]) => (await fetch('/api/class-log/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classDate: d, kind: 'covered', items: [{ outcomeId: o, extent: 'full' }] }) })).json(), [classDay, los[0].id] as const)
    const total = p.ok ? p.summary.placedMinutes + p.summary.remainingMinutes : 0
    if (p.ok && total > 45 && total <= 120 && p.summary.remainingMinutes === 0) { pick = { reading: r.id as string, topic: r.topic_id as string, id: los[0].id as string, code: los[0].code as string, title: los[0].title as string }; break }
  }
  expect(pick, 'an outcome needing 46-120 minutes').toBeTruthy()
  return { c, cyc: cyc.id as string, tz, today, day, classDay, pick: pick!, setWindows }
}
async function fillForm(page: Page, o: { classDay: string; pick: { reading: string; topic: string; code: string } }) {
  await page.goto('/app/calendar/log-class'); await fitsViewport(page)
  await chooseClassDay(page, o.classDay); await page.getByRole('radio', { name: /We covered new material/ }).check()
  await page.getByLabel('Subject').selectOption(o.pick.topic); await page.getByLabel('Reading').selectOption(o.pick.reading)
  await page.getByText(new RegExp(`^${o.pick.code}\\.`)).first().click(); await page.getByRole('radio', { name: 'All of it' }).nth(0).check()
}

test('several ordered sittings share one day (no set time, order shown); a preview made stale by the clock is refused, the input is kept, and nothing is saved', async ({ page }) => {
  test.setTimeout(240_000)
  const o = await oneDayStudent(page, 'cs')
  await rec.browser('the preview puts two or more ordered sittings of ONE outcome on the single day that has room, each at or below the limit', async () => {
    await fillForm(page, o)
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await expect(page.locator('.class-log__preview')).toContainText(/sitting 1 of 2/); await expect(page.locator('.class-log__preview')).toContainText(/sitting 2 of 2/)
    await expect(page.locator('.class-log__preview')).toContainText(/\d+ min/); await fitsViewport(page)
  })
  await rec.browser('STALE: the free time disappears after the preview; Confirm is refused, a fresh preview appears, every choice in the form is still there, and nothing was saved', async () => {
    await o.setWindows(false)
    expectStale = true
    try {
      // Wait for the server's actual refusal (409 preview_changed), not for text that may already be on the page: the windows must stay removed until it answers.
      const refused = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/class-log\/confirm$/.test(r.url()))
      await page.getByRole('button', { name: 'Finish class log' }).click()
      const reply = await refused; expect(reply.status()).toBe(409); expect((await reply.json()).code).toBe('preview_changed')
      await expect(page.locator('p.review-error')).toBeVisible()
    } finally { expectStale = false }
    expect((await db.from('class_sessions').select('id').eq('user_id', o.c.id)).data).toHaveLength(0)
    expect((await db.from('plan_blocks').select('id').eq('user_id', o.c.id).not('class_session_id', 'is', null)).data).toHaveLength(0)
    await expect(page.getByLabel('Class', { exact: true }).locator('option:checked')).toContainText(o.classDay)
    await expect(page.getByLabel('Reading')).toHaveValue(o.pick.reading)
    await expect(page.getByRole('radio', { name: 'All of it' }).nth(0)).toBeChecked()
    await fitsViewport(page)
  })
  await rec.browser('with the time back, the student re-previews and confirms: the sittings are saved on ONE day with declared order', async () => {
    await o.setWindows(true)
    // The refused confirmation left the old preview on screen: wait for the NEW preview's reply, or Confirm would act on the old one while it is in flight.
    const fresh = page.waitForResponse(r => /\/api\/class-log\/preview$/.test(r.url()))
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await fresh; await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const rows = (await db.from('plan_blocks').select('id, local_date, duration_minutes, sitting_ordinal, dependencies').eq('user_id', o.c.id).not('class_session_id', 'is', null).order('sitting_ordinal')).data!
    expect(rows.length).toBeGreaterThanOrEqual(2); expect(new Set(rows.map(r => r.local_date)).size).toBe(1); expect(rows.every(r => r.duration_minutes <= 45)).toBe(true)
    expect(rows.map(r => r.sitting_ordinal)).toEqual(rows.map((_, i) => i + 1)); expect((rows[1].dependencies as string[])[0]).toBe(rows[0].id)
    ;(o as any).rows = rows
  })
  await rec.browser('the drawer of the SECOND sitting says it follows the first and has no set time; keyboard: Escape closes it and focus returns', async () => {
    const rows = (o as any).rows as { id: string; local_date: string }[]
    await page.goto(`/app/calendar?week=${rows[1].local_date}&view=agenda&task=${rows[1].id}`); await page.waitForLoadState('networkidle')
    const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await fitsViewport(page)
    await expect(d.getByTestId('task-order')).toContainText('Sitting 2'); await expect(d.getByTestId('task-order')).toContainText('Do it after'); await expect(d.getByTestId('task-order')).toContainText('no set time')
    expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true)
    await page.keyboard.press('Escape'); await expect(d).toHaveCount(0)
    expect(await page.evaluate(() => !!document.activeElement && document.activeElement !== document.body)).toBe(true)   // focus returned to the page (main), not lost
  })
})

test('no room at all: the follow-up is saved as an obligation, shows on Calendar and Home, and the weekly review places it in next week once accepted', async ({ page }) => {
  test.setTimeout(300_000)
  const o = await oneDayStudent(page, 'cw')
  const S2 = { sid: '', planned: 0 }
  await rec.browser('with no free time the entry is still confirmed; the remainder is shown honestly and nothing is placed', async () => {
    await o.setWindows(false)
    await fillForm(page, o)
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await expect(page.getByTestId('class-log-summary')).toContainText(/0 min placed.*\d+ min could not be placed yet/); await fitsViewport(page)
    await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const sess = (await db.from('class_sessions').select('id').eq('user_id', o.c.id)).data!; expect(sess).toHaveLength(1); S2.sid = sess[0].id as string
    expect((await db.from('plan_blocks').select('id').eq('class_session_id', S2.sid)).data).toHaveLength(0)
    S2.planned = (await db.from('class_session_items').select('planned_minutes').eq('session_id', S2.sid).single()).data!.planned_minutes as number; expect(S2.planned).toBeGreaterThan(0)
  })
  await rec.browser('Calendar and Home both say that class follow-up has no slot yet (reload-safe), with the same minutes', async () => {
    await page.goto('/app/calendar'); await expect(page.getByTestId('calendar-owed-class-work')).toContainText(`${S2.planned} min`); await fitsViewport(page)
    await page.reload(); await expect(page.getByTestId('calendar-owed-class-work')).toContainText(`${S2.planned} min`)
    await page.goto('/app'); await expect(page.getByText(new RegExp(`${S2.planned} min of class follow-up`)).first()).toBeVisible(); await fitsViewport(page)
  })
  await rec.browser('the weekly review (week closed by the recorded time fixture) proposes the owed work; nothing exists until Save; then it is in next week with its order, and nothing is owed', async () => {
    const { shiftStudentTimeline } = await import('../../../scripts/lib/timeFixture')
    await db.from('plan_blocks').delete().eq('user_id', o.c.id).eq('cycle_id', o.cyc).throwOnError()
    await shiftStudentTimeline(o.c.id, 1, owned)
    await db.from('planning_cycles').update({ starts_at_local: addDays(o.today, -7), ends_at_local: addDays(o.today, -1) }).eq('id', o.cyc).throwOnError()
    // The next class can end a short cycle before the original weekend window.
    // This case needs real space for both the draft's new work and the follow-up.
    await db.from('calendar_commitments').update({ starts_on: addDays(o.today, 2) })
      .eq('user_id', o.c.id).eq('kind', 'class').eq('recurrence', 'weekly').throwOnError()
    await db.from('availability_windows').insert(Array.from({ length: 7 }, (_, weekday) => ({
      user_id: o.c.id, weekday, start_time: '07:00', end_time: '20:00', status: 'active',
    }))).throwOnError()
    await page.goto('/app/review-week'); await expect(page.getByTestId('review-owed-class-work')).toContainText(`${S2.planned} of ${S2.planned} min`); await fitsViewport(page)
    const ack = page.getByLabel(/Close this week without a paper/); if (await ack.count()) await ack.check()
    // With no reviewable inventory the review requires the explicit no-paper closure before it can preview.
    for (const box of await page.getByRole('checkbox', { name: /Leave unreported/ }).all()) await box.check()   // an open class report must be settled explicitly
    const noPaper = page.getByRole('checkbox', { name: /Close this week without a paper/ }); if (await noPaper.count()) await noPaper.check()
    await page.getByRole('button', { name: 'Preview next week' }).click({ timeout: 60_000 })
    await expect(page.getByTestId('review-class-followup')).toBeVisible({ timeout: 60_000 }); await fitsViewport(page)
    expect((await db.from('plan_blocks').select('id').eq('class_session_id', S2.sid)).data).toHaveLength(0)   // a preview writes nothing
    await page.getByRole('button', { name: 'Save review and open next week' }).click(); await page.waitForURL(u => u.pathname === '/app/calendar')
    await expect.poll(async () => ((await db.from('plan_blocks').select('id').eq('class_session_id', S2.sid)).data ?? []).length).toBeGreaterThanOrEqual(1)
    const rows = (await db.from('plan_blocks').select('id, duration_minutes, sitting_ordinal, dependencies, cycle_id').eq('class_session_id', S2.sid).order('sitting_ordinal')).data!
    expect(rows.reduce((n, r) => n + r.duration_minutes, 0)).toBe(S2.planned); expect(rows.every(r => r.cycle_id !== o.cyc && r.duration_minutes <= 45)).toBe(true)
    expect(rows.slice(1).every((r, i) => (r.dependencies as string[])[0] === rows[i].id)).toBe(true)
    await page.goto('/app/calendar'); await expect(page.getByTestId('calendar-owed-class-work')).toHaveCount(0); await fitsViewport(page)
  })
})
void wd
