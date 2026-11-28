import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { createStudent, classLedPersona, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { addDays, admin, login, noHorizontalOverflow, RUN, wd, removeStudent } from './helpers'

/**
 * Phase 6 · input given while a page is still loading. The load is really slow (the page's scripts are held back), the student acts as soon as a control
 * accepts input, and every confirmed save is checked twice: the request the app sent and the saved row must equal what was on screen. A half-entered
 * value must be refused and kept. Desktop and 390 px.
 */
const db = admin(), ZONE = 'Europe/London'
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
const hold = (page: Page) => page.route('**/_next/static/**/*.js*', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue().catch(() => {}) })
/** Resolves once React is attached to the element: from here on the app can hear it. */
const attached = async (target: Locator) => { await expect.poll(() => target.evaluate(e => Object.keys(e).some(k => k.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true) }
const sent = (page: Page, method: string, path: RegExp) => { const out: Record<string, any>[] = []; page.on('request', (r: Request) => { if (r.method() === method && path.test(new URL(r.url()).pathname)) out.push(r.postDataJSON() ?? {}) }); return out }
const halfType = async (page: Page, field: Locator) => { await field.fill(''); await field.focus(); await page.keyboard.type('1'); expect(await field.evaluate((e: HTMLInputElement) => e.validity.badInput)).toBe(true) }
const badInput = (field: Locator) => field.evaluate((e: HTMLInputElement) => e.validity.badInput)
/** The browser itself refuses to submit the form holding this field: nothing is sent and the typing stays. */
const refusedByBrowser = async (page: Page, field: Locator, requests: unknown[]) => {
  expect(await field.evaluate((e: HTMLInputElement) => e.form!.checkValidity())).toBe(false)
  await page.waitForTimeout(500)
  expect(requests).toHaveLength(0)
  expect(await badInput(field)).toBe(true)
}

async function run(page: Page, tag: string, body: (s: { id: string; email: string }, owned: string[]) => Promise<void>, classLed = false) {
  const owned: string[] = []
  try {
    const s = await createStudent(db, `${tag}${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: classLed ? (await classLedPersona(db)).options : { ...FRESH_STUDENT_ONBOARDING } })
    await body(s, owned)
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); for (const id of owned) await removeStudent(db, id) }
}

test('early input · display name typed while Settings loads is the name saved; a blank name is refused and kept', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiName', async s => {
    await login(page, db, s.email, '/app')
    const puts = sent(page, 'PUT', /^\/api\/profile$/)
    await hold(page); await page.goto('/app/settings', { waitUntil: 'commit' })
    const field = page.getByLabel('Display name')
    await field.fill('Early Typist')
    await attached(field)
    await expect(field).toHaveValue('Early Typist')
    await field.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => puts.length, { timeout: 30_000 }).toBe(1)
    expect(puts[0]).toEqual({ name: 'Early Typist' })
    await expect(page.locator('[data-display-name]').getByRole('status')).toHaveText('Saved.')
    expect((await db.from('profiles').select('display_name').eq('id', s.id).single().throwOnError()).data!.display_name).toBe('Early Typist')
    await field.fill(''); await field.press('Enter')
    await expect(page.getByRole('button', { name: 'Save name' })).toBeDisabled()
    await expect(field).toHaveValue(''); expect(puts).toHaveLength(1)
    await noHorizontalOverflow(page)
  })
})

test('early input · calendar download range chosen while Settings loads is the range requested', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiExport', async s => {
    await login(page, db, s.email, '/app')
    const asked: string[] = []
    page.on('request', r => { if (r.url().includes('preview=1')) asked.push(new URL(r.url()).search) })
    await hold(page); await page.goto('/app/settings', { waitUntil: 'commit' })
    const card = page.locator('[data-calendar-export-card]')
    const from = addDays(todayInZone(ZONE), 3), to = addDays(from, 9)
    await card.getByLabel('From').fill(from); await card.getByLabel('To').fill(to)
    await card.getByLabel('Include my classes and fixed commitments').check()
    const button = card.getByRole('button', { name: 'Preview' })
    await attached(button)
    await expect(card.getByLabel('From')).toHaveValue(from)
    await button.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => asked.length, { timeout: 30_000 }).toBe(1)
    expect(Object.fromEntries(new URLSearchParams(asked[0]))).toMatchObject({ from, to, classes: '1' })
  })
})

test('early input · study time edited while the Settings setup screen loads is what gets saved; a half-typed time is refused and kept', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiWeek', async s => {
    await login(page, db, s.email, '/app')
    const posts = sent(page, 'POST', /^\/api\/onboarding\/week$/)
    await hold(page); await page.goto('/onboarding/week?returnTo=%2Fapp%2Fsettings', { waitUntil: 'commit' })
    const start = page.getByLabel('Monday start', { exact: true })
    await start.fill('19:15')
    await attached(start)
    await expect(start).toHaveValue('19:15')
    // Half-entered: refused, and the digits stay for the student to finish.
    const end = page.getByLabel('Tuesday end', { exact: true }), save = page.getByRole('button', { name: /^Save/ })
    await halfType(page, end)
    await expect(save).toBeDisabled()
    expect(await badInput(end)).toBe(true)
    expect(posts).toHaveLength(0)
    await end.fill('21:45')
    await expect(save).toBeEnabled()
    await save.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => posts.length, { timeout: 30_000 }).toBe(1)
    expect(posts[0].windows).toEqual(expect.arrayContaining([expect.objectContaining({ weekday: 1, startTime: '19:15' }), expect.objectContaining({ weekday: 2, endTime: '21:45' })]))
    await expect.poll(async () => (await db.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', s.id).eq('status', 'active').eq('weekday', 1).throwOnError()).data!.map(w => String(w.start_time).slice(0, 5)), { timeout: 30_000 }).toEqual(['19:15'])
    await noHorizontalOverflow(page)
  })
})

test('early input · a class moved from a deep link while Calendar loads saves exactly the times on screen; a half-typed time is refused', async ({ page }) => {
  local(); test.setTimeout(240_000)
  await run(page, 'eiClass', async s => {
    const cls = (await db.from('calendar_commitments').select('id, weekdays').eq('user_id', s.id).eq('kind', 'class').eq('status', 'active').throwOnError()).data!.find(c => (c.weekdays as number[]).includes(2))!.id as string
    let occurrence = addDays(todayInZone(ZONE), 2); while (wd(occurrence) !== 2) occurrence = addDays(occurrence, 1)
    await login(page, db, s.email, '/app')
    const previews = sent(page, 'POST', /\/api\/commitments\/[^/]+\/preview$/)
    await hold(page); await page.goto(`/app/calendar?commitment=${cls}&occurrence=${occurrence}&week=${occurrence}`, { waitUntil: 'commit' })
    const dialog = page.getByTestId('class-occurrence')
    const from = dialog.getByLabel('From', { exact: true }), to = dialog.getByLabel('To', { exact: true }), preview = dialog.getByRole('button', { name: 'Preview change' })
    await from.fill('07:10'); await to.fill('08:20')
    await attached(preview)
    await expect(from).toHaveValue('07:10'); await expect(to).toHaveValue('08:20')
    await halfType(page, to)
    await preview.focus(); await page.keyboard.press('Enter')
    await expect(dialog.getByTestId('class-error')).toBeVisible()
    expect(await badInput(to)).toBe(true)
    await expect(dialog.getByRole('button', { name: 'Confirm change' })).toHaveCount(0)
    const refusedCalls = previews.length
    await to.fill('08:20'); await preview.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => previews.length, { timeout: 30_000 }).toBe(refusedCalls + 1)
    expect(previews.at(-1)).toMatchObject({ newStartTime: '07:10', newEndTime: '08:20' })
    await dialog.getByRole('button', { name: 'Confirm change' }).click()
    await expect(page.getByTestId('class-change-done')).toBeVisible()
    expect((await db.from('commitment_exceptions').select('kind, new_start_time, new_end_time').eq('commitment_id', cls).eq('occurrence_date', occurrence).throwOnError()).data!.map(e => [e.kind, String(e.new_start_time).slice(0, 5), String(e.new_end_time).slice(0, 5)])).toEqual([['moved', '07:10', '08:20']])
    await noHorizontalOverflow(page)
  }, true)
})

test('early input · the next-class form opened by link keeps what is typed while the page loads', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiNext', async s => {
    await login(page, db, s.email, '/app')
    const posts = sent(page, 'POST', /^\/api\/commitments$/)
    await hold(page); await page.goto('/app/calendar?action=add-next-class', { waitUntil: 'commit' })
    const dialog = page.getByRole('dialog', { name: 'Add your next class' })
    const date = addDays(todayInZone(ZONE), 6)
    await dialog.getByLabel('Date', { exact: true }).fill(date)
    await dialog.getByLabel('Start', { exact: true }).fill('07:30'); await dialog.getByLabel('End', { exact: true }).fill('08:30')
    await dialog.getByLabel('Name (optional)').fill('Early class')
    const add = dialog.getByRole('button', { name: 'Add class' })
    await attached(add)
    await add.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => posts.length, { timeout: 30_000 }).toBe(1)
    expect(posts[0]).toMatchObject({ date, startTime: '07:30', endTime: '08:30', label: 'Early class' })
    await expect.poll(async () => (await db.from('calendar_commitments').select('starts_at').eq('user_id', s.id).eq('label', 'Early class').throwOnError()).data!.map(c => new Date(c.starts_at as string).toLocaleTimeString('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' })), { timeout: 30_000 }).toEqual(['07:30'])
  }, true)
})

test('early input · new task and new commitment: nothing typable is lost, and a half-typed time is refused and kept', async ({ page }) => {
  local(); test.setTimeout(240_000)
  await run(page, 'eiNew', async s => {
    await login(page, db, s.email, '/app')
    const tasks = sent(page, 'POST', /^\/api\/tasks$/), commitments = sent(page, 'POST', /^\/api\/commitments$/)
    await hold(page); await page.goto('/app/calendar', { waitUntil: 'commit' })
    const open = page.getByRole('button', { name: 'Add study task' })
    // Before the app is ready the button cannot take a press that would be silently dropped.
    await expect(open).toBeVisible()
    if (process.env.PROBE_AFTER_READY) await attached(open)
    await open.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 60_000 })
    await dialog.getByLabel('What is it?').fill('Early task')
    await dialog.getByRole('checkbox').check()
    const time = dialog.getByLabel('Start time')
    await time.fill('07:05')
    await halfType(page, time)
    await dialog.getByRole('button', { name: 'Add task' }).click()
    await refusedByBrowser(page, time, tasks)
    await time.fill('')   // emptied, with a timed start still ticked: refused, never saved as the old time
    await dialog.getByRole('button', { name: 'Add task' }).click()
    await expect(dialog.getByRole('alert').filter({ hasText: /start time/i })).toBeVisible()
    expect(tasks).toHaveLength(0)
    await time.fill('07:05')
    await dialog.getByRole('button', { name: 'Add task' }).click()
    // 07:05 is outside the saved study windows: the app asks first, and the confirmed request carries the same time.
    await dialog.getByRole('button', { name: 'Add it anyway' }).click()
    await expect.poll(() => tasks.length, { timeout: 30_000 }).toBe(2)
    for (const t of tasks) expect(t).toMatchObject({ title: 'Early task', startMinutes: 7 * 60 + 5 })
    await expect(dialog.getByRole('status')).toContainText('Early task')
    expect((await db.from('plan_blocks').select('placement').eq('user_id', s.id).eq('title', 'Early task').throwOnError()).data).toEqual([{ placement: 'timed' }])
    await dialog.getByRole('button', { name: 'Done', exact: true }).click()

    await page.getByRole('button', { name: 'Add commitment', exact: true }).first().click()
    const c = page.getByRole('dialog', { name: 'Add a commitment' })
    await c.getByLabel('What is it?').fill('Early shift')
    const from = c.getByLabel('From', { exact: true })
    await halfType(page, from)
    await c.getByRole('button', { name: 'Add commitment' }).click()
    await refusedByBrowser(page, from, commitments)
    await from.fill('06:00'); await c.getByLabel('To', { exact: true }).fill('06:45')
    await c.getByRole('button', { name: 'Add commitment' }).click()
    await expect.poll(() => commitments.length, { timeout: 30_000 }).toBe(1)
    expect(commitments[0]).toMatchObject({ label: 'Early shift', startTime: '06:00', endTime: '06:45' })
    await noHorizontalOverflow(page)
  })
})

test('early input · mock editing: the weekly choice pressed while Calendar loads is saved; a half-typed start time is refused and kept', async ({ page }) => {
  local(); test.setTimeout(240_000)
  await run(page, 'eiMock', async s => {
    await login(page, db, s.email, '/app/calendar')
    const writes: Record<string, any>[] = []
    page.on('request', r => { if (r.url().includes('/api/checkpoints') && r.method() !== 'GET') writes.push(r.postDataJSON()) })
    await page.getByRole('button', { name: 'Add a mock' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Date/).fill(todayInZone(ZONE))
    const time = dialog.locator('#cp-time')
    await halfType(page, time)
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await refusedByBrowser(page, time, writes)
    await time.fill('')   // a deliberate blank: no start time
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    expect((await db.from('mock_appointments').select('planned_date, start_time').eq('user_id', s.id).throwOnError()).data).toEqual([{ planned_date: todayInZone(ZONE), start_time: null }])

    writes.length = 0
    await hold(page); await page.reload({ waitUntil: 'commit' })
    const choice = page.getByRole('radio', { name: /Keep the weekly paper as well/ })
    await choice.click()   // waits until the page can hear it; the mark itself moves once the save is read back
    await expect.poll(() => writes.length, { timeout: 60_000 }).toBe(1)
    expect(writes[0]).toMatchObject({ action: 'choice', choice: 'keep_paper' })
    await expect.poll(async () => (await db.from('cycle_assessment_choices').select('choice').eq('user_id', s.id).throwOnError()).data, { timeout: 30_000 }).toEqual([{ choice: 'keep_paper' }])
    await expect(choice).toBeChecked()
  })
})

test('early input · a mock report typed while the page loads is the report saved', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiReport', async s => {
    await login(page, db, s.email, '/app')
    const posts = sent(page, 'POST', /^\/api\/mock-reports$/)
    await hold(page); await page.goto('/app/calendar/mock-report', { waitUntil: 'commit' })
    const form = page.getByRole('form', { name: 'Record a mock already taken' })
    const taken = addDays(todayInZone(ZONE), -2)
    await form.getByLabel('Date taken').fill(taken)
    await form.getByLabel('Only part of an exam').check()
    const score = form.getByRole('spinbutton', { name: 'Percentage', exact: true })
    await score.fill('61')
    await form.getByLabel(/^Notes/).fill('Typed early')
    const save = form.getByRole('button', { name: 'Save this mock' })
    await attached(save)
    await score.fill(''); await score.focus(); await page.keyboard.type('1e')
    await save.focus(); await page.keyboard.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: /you started typing/ })).toBeVisible()
    expect(await badInput(score)).toBe(true); expect(posts).toHaveLength(0)
    await score.fill('61'); await save.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => posts.length, { timeout: 30_000 }).toBe(1)
    expect(posts[0].input).toMatchObject({ takenOn: taken, scope: 'partial', score: 61, notes: 'Typed early' })
    await expect.poll(async () => (await db.from('mock_reports').select('taken_on').eq('user_id', s.id).throwOnError()).data, { timeout: 30_000 }).toEqual([{ taken_on: taken }])
  })
})

test('early input · weekly review answers given while the page loads are the answers sent; a half-typed added window is not accepted', async ({ page }) => {
  local(); test.setTimeout(240_000)
  await run(page, 'eiReview', async (s, owned) => {
    await shiftStudentTimeline(s.id, 1, owned)
    // One short evening: carried work has to wait, which is when the review offers one-off windows.
    await db.from('availability_windows').delete().eq('user_id', s.id).throwOnError()
    await db.from('availability_windows').insert({ user_id: s.id, weekday: 1, start_time: '19:00', end_time: '19:45', status: 'active' }).throwOnError()
    await login(page, db, s.email, '/app')
    const previews = sent(page, 'POST', /^\/api\/weekly-review\/preview$/)
    await hold(page); await page.goto('/app/review-week', { waitUntil: 'commit' })
    const groups = page.getByRole('radiogroup', { name: /^What happened with / })
    await expect(groups.first()).toBeVisible()
    for (const g of await groups.all()) await g.getByRole('radio', { name: 'Not done', exact: true }).check()
    const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
    if (await ack.isVisible()) await ack.check()
    for (const r of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await r.check()
    const go = page.getByRole('button', { name: 'Preview next week' }), asked = await groups.count()
    await attached(go)
    for (const g of await groups.all()) await expect(g.getByRole('radio', { name: 'Not done', exact: true })).toBeChecked()
    await go.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => previews.length, { timeout: 30_000 }).toBeGreaterThan(0)
    const answered = Object.values(previews[0].choices as Record<string, { happened: string }>)
    expect(answered).toHaveLength(asked)
    expect(answered.every(c => c.happened === 'not_done')).toBe(true)
    await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()

    const panel = page.getByTestId('extra-time'), from = panel.getByLabel('From', { exact: true }), add = panel.getByRole('button', { name: 'Add this window' })
    await halfType(page, from)
    await expect(add).toBeDisabled()
    await expect(panel.getByText(/Finish both times/)).toBeVisible()
    expect(await badInput(from)).toBe(true)
    const before = previews.length
    await from.fill('06:05'); await panel.getByLabel('To', { exact: true }).fill('06:50')
    await add.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => previews.length, { timeout: 30_000 }).toBe(before + 1)
    expect(previews.at(-1)!.extraWindows).toEqual([expect.objectContaining({ start: '06:05', end: '06:50' })])
    await noHorizontalOverflow(page)
  })
})

test('early input · class log answers given while the page loads stay selected', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiLog', async s => {
    await login(page, db, s.email, '/app')
    await hold(page); await page.goto('/app/calendar/log-class', { waitUntil: 'commit' })
    const kinds = page.getByRole('radiogroup', { name: 'What happened in class' }).getByRole('radio')
    await kinds.last().check()
    await attached(kinds.last())
    await expect(kinds.last()).toBeChecked()
  }, true)
})

const reading = async () => (await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).order('id').limit(1).single().throwOnError()).data!

test('early input · a flashcard typed while the reading page loads is the card saved', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiCard', async s => {
    const r = await reading()
    await login(page, db, s.email, '/app')
    const posts = sent(page, 'POST', /^\/api\/curriculum\/flashcards$/)
    await hold(page); await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?tab=cards`, { waitUntil: 'commit' })
    const front = page.locator('.flashcards__form input'), back = page.locator('.flashcards__form textarea'), add = page.getByRole('button', { name: 'Add card' })
    await front.fill('Early front'); await back.fill('Early back')
    await attached(front)
    await expect(front).toHaveValue('Early front'); await expect(back).toHaveValue('Early back')
    await add.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => posts.length, { timeout: 30_000 }).toBe(1)
    expect(posts[0]).toMatchObject({ action: 'create', front: 'Early front', back: 'Early back' })
    await expect.poll(async () => (await db.from('flashcards').select('front, back').eq('user_id', s.id).throwOnError()).data, { timeout: 30_000 }).toEqual([{ front: 'Early front', back: 'Early back' }])
    await noHorizontalOverflow(page)
  })
})

test('early input · Readiness disclosures opened while the page loads stay as opened, with no mismatch', async ({ page }) => {
  local(); test.setTimeout(180_000)
  await run(page, 'eiReady', async s => {
    await login(page, db, s.email, '/app')
    const messages: string[] = []
    page.on('console', m => { if (m.type() === 'error') messages.push(m.text()) })
    page.on('pageerror', e => messages.push(e.message))
    await hold(page); await page.goto('/app/curriculum?view=readiness', { waitUntil: 'commit' })
    const topic = page.locator('details.los-topic').last(), row = topic.locator('details.los-row').first()
    await topic.locator(':scope > summary').click()
    await topic.locator('summary').nth(1).click()
    await row.locator(':scope > summary').press('Enter').catch(() => {})
    const opened = [await topic.getAttribute('open'), await row.getAttribute('open')]
    await attached(page.getByRole('link', { name: 'Roadmap', exact: true }).last())
    await page.waitForLoadState('networkidle')
    expect([await topic.getAttribute('open'), await row.getAttribute('open')]).toEqual(opened)
    expect(opened[0]).toBe('')
    expect(messages).toEqual([])
    await noHorizontalOverflow(page)
  })
})

test('early input · reading, overview and Roadmap disclosures toggled while the page loads raise no mismatch', async ({ page }) => {
  local(); test.setTimeout(240_000)
  await run(page, 'eiFold', async s => {
    const r = await reading()
    await login(page, db, s.email, '/app')
    const messages: string[] = []
    page.on('console', m => { if (m.type() === 'error') messages.push(`${new URL(page.url()).pathname}${new URL(page.url()).search} ${m.text().slice(0, 1500)}`) })
    page.on('pageerror', e => messages.push(e.message))
    await hold(page)
    for (const url of [`/app/curriculum/${r.topic_id}/${r.id}`, '/app/curriculum', '/app/curriculum?view=roadmap']) {
      await page.goto('about:blank'); await page.goto(url, { waitUntil: 'commit' })
      const summary = page.locator('[class*="page"] details > summary:visible').first()
      await expect(summary, url).toBeVisible({ timeout: 60_000 })
      // The one disclosure is held by handle: "the first visible summary" can change once it opens.
      const picked = (await summary.elementHandle())!, details = (await picked.evaluateHandle(e => e.parentElement as HTMLElement)).asElement()!
      const was = await details.getAttribute('open'), what = `${url} “${(await picked.innerText()).trim().slice(0, 60)}”`
      await picked.press('Enter')   // the summary itself: on a narrow screen a pointer can land on a link inside it
      const now = await details.getAttribute('open')
      expect(now, what).not.toBe(was)
      await attached(page.locator('a[href]:visible').first())
      await page.waitForLoadState('networkidle')
      expect(await details.getAttribute('open'), url).toBe(now)
    }
    expect(messages).toEqual([])
  })
})
