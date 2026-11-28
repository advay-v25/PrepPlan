/**
 * Settings, calendar download, personal-data download and account deletion in a real browser, desktop and 390px. Ordinary throwaway students, removed by id.
 * Downloads are saved and PARSED (.ics with an independent parser, the personal export as JSON).
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import ICAL from 'ical.js'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = [], se = scopedErrors()
const S = { id: '', email: '', delId: '', delEmail: '', clsId: '', clsEmail: '' }, consoleErrors = se.unexpected
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  const a = await createStudent(db, `ss${RUN}`, { onboard: true, register: id => owned.push(id) }); S.id = a.id; S.email = a.email
  const c = await createStudent(db, `sc${RUN}`, { onboard: true, onboarding: (await classLedPersona(db)).options, register: id => owned.push(id) }); S.clsId = c.id; S.clsEmail = c.email
  const d = await createStudent(db, `sd${RUN}`, { onboard: false, register: id => owned.push(id) }); S.delId = d.id; S.delEmail = d.email   // unfinished setup
})
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message), error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/settings-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, consoleErrors, allowances:se.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(consoleErrors, 'unexpected requests, console / page errors').toEqual([])
})

test('Starting point loads one topic’s readings on demand and keeps a saved refinement', async ({ page }) => {
  const persona = await classLedPersona(db)
  const s = await createStudent(db, `sread${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  const topic = persona.topics[0]
  const lookup = `**/api/onboarding/position?topic=${topic}`
  const editor = '/onboarding/position?returnTo=%2Fapp%2Fsettings'
  const card = page.locator('.ob-topiccard').filter({ has: page.locator(`#topic-${topic}`) })
  let calls = 0
  await page.route(lookup, route => {
    calls++
    return calls === 1 ? route.fulfill({ status: 503, json: { ok: false } }) : route.continue()
  })
  await login(page, db, s.email, editor)
  const disclosure = card.getByText('Individual readings', { exact: false })
  await expect(disclosure).toBeVisible()
  expect(calls).toBe(0)
  await se.expecting([{ label: 'one failed optional reading lookup', url: /\/api\/onboarding\/position\?topic=/, statuses: [503], min: 1, max: 1 }], async () => {
    await disclosure.click()
    await expect(card.getByRole('alert')).toContainText('Readings could not be loaded')
  })
  await card.getByRole('button', { name: 'Retry' }).click()
  const field = card.getByRole('combobox', { name: /^Coverage of/ }).first()
  await field.selectOption('partly')
  const fieldName = await field.getAttribute('aria-label')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.waitForURL(url => url.pathname === '/app/settings')
  await page.goto(editor)
  await disclosure.click()
  await expect(card.getByRole('combobox', { name: fieldName!, exact: true })).toHaveValue('partly')
  expect(calls).toBe(3)
  await noHorizontalOverflow(page)
})

test('Settings page: grouped controls, honest units, no overflow, name edit', async ({ page }) => {
  await login(page, db, S.email, '/app/settings')
  await rec.browser('Settings renders the groups and fits the viewport (no horizontal overflow, controls wrap)', async () => {
    for (const h of ['Exam date', 'Study style and classes', 'Starting point', 'Study time', 'Reminders', 'Download your calendar', 'Account']) await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible()
    await expect(page.getByText(/modules marked/i)).toHaveCount(0)
    await expect(page.getByText(/roughly \d+–\d+ hours/)).toHaveCount(0)
    await noHorizontalOverflow(page)
  })
  await rec.browser('display name saves through the name-only patch and survives a reload; the exam, route and sitting limit are untouched', async () => {
    const before = (await db.from('profiles').select('exam_sitting, prep_mode, max_session_minutes').eq('id', S.id).single()).data
    await page.getByLabel('Display name').fill('Grace Hopper'); await page.getByRole('button', { name: 'Save name' }).click()
    await expect(page.getByText('Saved.').first()).toBeVisible()
    await expect(page.locator('.app-shell > .sidebar .profile-row strong')).toHaveText('Grace Hopper')
    await page.reload(); await expect(page.getByLabel('Display name')).toHaveValue('Grace Hopper')
    expect((await db.from('profiles').select('display_name, exam_sitting, prep_mode, max_session_minutes').eq('id', S.id).single()).data).toEqual({ display_name: 'Grace Hopper', ...before })
  })
})

test('Display name: a newer edit typed while the save is in flight survives, and no overlapping save is possible', async ({ page }, info) => {
  await login(page, db, S.email, '/app/settings')
  await rec.browser('the response for the earlier name does not overwrite the newer draft; Save stays disabled while saving; the newer name then saves', async () => {
    let release!: () => void; const gate = new Promise<void>(r => { release = r }); let puts = 0
    await page.route('**/api/profile', async r => { if (r.request().method() === 'PUT') { puts++; await gate } await r.continue() })
    const input = page.getByLabel('Display name'), save = page.getByRole('button', { name: /Save name|Saving/ })
    await input.fill('First Draft')
    await input.dispatchEvent('compositionstart'); await input.press('Enter')
    expect(puts).toBe(0)                                  // IME confirmation must not submit an unfinished name
    await input.dispatchEvent('compositionend'); await save.click()
    await expect(save).toBeDisabled(); await expect(save).toHaveText('Saving…')
    await input.fill('Second Draft')
    await expect(save).toBeDisabled()                     // typing must not re-enable Save mid-flight
    await input.press('Enter'); expect(puts).toBe(1)      // Enter cannot start an overlapping save
    release()
    await expect(page.getByText('Your current edit is not saved.', { exact: false })).toBeVisible()
    await expect(page.getByText('Saved.', { exact: true })).toHaveCount(0)
    await expect(input).toHaveValue('Second Draft')       // the newer draft was not replaced by the submitted snapshot
    await expect(save).toBeEnabled()                      // and it is still unsaved, so it can be saved
    await page.screenshot({ path: `/tmp/roadmap-phase6-name-${info.project.name}.png` })
    await page.unroute('**/api/profile')
    await save.click(); await expect(save).toBeDisabled()
    await expect.poll(async () => (await db.from('profiles').select('display_name').eq('id', S.id).single()).data?.display_name).toBe('Second Draft')
    await expect(page.locator('[data-display-name]').getByRole('status')).toHaveText('Saved.')
    await db.from('profiles').update({ display_name: 'Grace Hopper' }).eq('id', S.id)   // later tests in this serial file expect the name set in the first test
  })
})

test('Reminders: load failure recovers, explicit Save, atomic patch survives a lost response, invalid time blocked', async ({ page }) => {
  await login(page, db, S.email)
  await rec.browser('a 503 on load shows a retryable error (not an endless "Loading")', () => se.expecting([{ label: 'injected preferences load failure (development remount may request twice)', url: /\/api\/reminders\/prefs$/, statuses: [503], min: 1, max: 2 }], async () => {
    await page.route('**/api/reminders/prefs', r => r.request().method() === 'GET' ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Your reminder choices could not be loaded. Nothing was changed.' }) }) : r.continue())
    await page.goto('/app/settings'); await expect(page.getByText(/could not be loaded/)).toBeVisible()
    await page.unroute('**/api/reminders/prefs'); await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('button', { name: 'Save reminder choices' })).toBeDisabled()   // nothing to save yet
  }))
  await rec.browser('delivery state is stated truthfully and no fake Connected/Sent status exists', async () => {
    const cfg = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)
    if (!cfg) await expect(page.locator('[data-delivery="not_configured"]')).toBeVisible()
    await expect(page.getByText(/Connected|Test email|Sent!/)).toHaveCount(0)
  })
  await rec.browser('an incomplete quiet-hours time disables Save and says why', async () => {
    await page.getByLabel('Quiet hours start').fill(''); await expect(page.getByRole('button', { name: 'Save reminder choices' })).toBeDisabled(); await expect(page.getByText(/Enter both quiet-hour times/)).toBeVisible()
    await page.getByLabel('Quiet hours start').fill('22:30')
  })
  await rec.browser('POST-commit lost response: the UI keeps the edit and says unconfirmed; saving again sets the same values (one row, no loss)', () => se.expecting([{ label: 'lost committed preferences response', url: /\/api\/reminders\/prefs$/, failed: true, min: 1, max: 1 }], async () => {
    await page.getByLabel('Email me when my weekly review is ready').check()
    await page.route('**/api/reminders/prefs', async r => { if (r.request().method() !== 'PUT') return r.continue(); await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Save reminder choices' }).click()
    await expect(page.getByText(/Could not confirm the save/)).toBeVisible()
    await page.unroute('**/api/reminders/prefs')
    await page.getByRole('button', { name: 'Save reminder choices' }).click(); await expect(page.getByText(/^Saved/).first()).toBeVisible()
    const row = (await db.from('reminder_prefs').select('weekly_review_reminders, quiet_start').eq('user_id', S.id)).data!
    expect(row.length).toBe(1); expect(row[0].weekly_review_reminders).toBe(true); expect(String(row[0].quiet_start).slice(0, 5)).toBe('22:30')
  }))
  await noHorizontalOverflow(page)
})

test('Calendar and personal-data downloads are real files that parse', async ({ page }) => {
  await login(page, db, S.email, '/app/settings')
  await rec.browser('calendar preview then Download .ics: the saved file parses and its event count equals the preview', async () => {
    const card = page.locator('[data-calendar-export-card]')
    await card.getByRole('button', { name: 'Preview' }).click(); const txt = await card.locator('[data-export-preview]').innerText()
    const n = Number(/^(\d+) event/.exec(txt)![1])
    const [dl] = await Promise.all([page.waitForEvent('download'), card.getByRole('button', { name: 'Download .ics' }).click()])
    expect(dl.suggestedFilename()).toMatch(/^roadmap-schedule-.*\.ics$/)
    const text = fs.readFileSync((await dl.path())!, 'utf8')
    expect(new ICAL.Component(ICAL.parse(text)).getAllSubcomponents('vevent').length).toBe(n); expect(text).toContain('\r\n')
  })
  await rec.browser('an invalid range shows an error in the page and downloads nothing', () => se.expecting([{label:'deliberately reversed calendar download range',url:/\/api\/calendar\/export\?.*to=2020-01-01/,statuses:[400],min:1,max:1}],async () => {
    const card = page.locator('[data-calendar-export-card]')
    await card.getByLabel('To').fill('2020-01-01'); await card.getByRole('button', { name: 'Download .ics' }).click()
    await expect(card.getByRole('alert')).toBeVisible()
  }))
  await rec.browser('Download my data: the saved JSON is complete for this student only and is versioned', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
    const j = JSON.parse(fs.readFileSync((await dl.path())!, 'utf8'))
    expect(j.schema).toBe('roadmap-export-2'); expect(j.account.id).toBe(S.id); expect(j.profile.display_name).toBe('Grace Hopper')
    expect((j.tables.plan_blocks as any[]).every(r => r.user_id === S.id)).toBe(true); expect(j.counts.reminder_prefs).toBe(1)
  })
  await rec.browser('a failed export preparation is a message, not a saved error file', () => se.expecting([{ label: 'injected export failure', url: /\/api\/account\/export$/, statuses: [500], min: 1, max: 1 }], async () => {
    await page.route('**/api/account/export', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'The export could not be prepared. Nothing was changed; try again.' }) }))
    await page.getByRole('button', { name: 'Download my data' }).click(); await expect(page.getByText(/could not be prepared/)).toBeVisible()
    await page.unroute('**/api/account/export')
  }))
  await noHorizontalOverflow(page)
})

test('Two tabs edit the same setup: the stale tab is refused with its input kept, then saves after a reload', async ({ page, context }) => {
  await login(page, db, S.email, '/onboarding/week?returnTo=%2Fapp%2Fsettings')
  await rec.browser('the editor opens in edit mode with the saved windows', async () => { await expect(page.getByRole('button', { name: 'Save' })).toBeVisible() })
  const v0 = (await db.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version as number
  await rec.api('SECOND TAB saves a different setup with the version it read (a labelled supplement: the same command the editor uses)', async () => {
    const p2 = await context.newPage(); await p2.goto('/app/settings')
    const r = await p2.evaluate(async v => { const res = await fetch('/api/onboarding/week', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ availabilityMode: 'windows', windows: [{ weekday: 2, startTime: '07:00', endTime: '08:00' }], commitments: [], maxSessionMinutes: 45, expectedVersion: v }) }); return res.json() }, v0)
    expect(r.ok, JSON.stringify(r)).toBe(true); await p2.close()
    expect((await db.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version).toBe(v0 + 1)
  })
  await rec.browser('Save in the STALE tab is refused: a clear message, the typed values remain, and nothing was written', () => se.expecting([{ label: 'expected stale setup refusal', url: /\/api\/onboarding\/week$/, statuses: [409], min: 1, max: 1 }], async () => {
    const before = JSON.stringify((await db.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', S.id).eq('status', 'active').order('weekday')).data)
    await page.getByRole('textbox', { name: 'Monday start' }).fill('18:45')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText(/changed in another tab or device/)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Monday start' })).toHaveValue('18:45')
    expect(JSON.stringify((await db.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', S.id).eq('status', 'active').order('weekday')).data)).toBe(before)
    expect((await db.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version).toBe(v0 + 1)
  }))
  await rec.browser('after a reload the editor shows the other tab\'s saved windows and the next Save commits (one more version)', async () => {
    await page.reload(); await expect(page.getByRole('textbox', { name: 'Tuesday start' })).toHaveValue('07:00')
    await page.getByRole('textbox', { name: 'Tuesday start' }).fill('07:30'); await page.getByRole('button', { name: 'Save' }).click()
    await expect.poll(async () => (await db.from('profiles').select('onboarding_context_version').eq('id', S.id).single()).data!.onboarding_context_version, { timeout: 20_000 }).toBe(v0 + 2)
  })
})

test('Class-led: classes finished and undo from Settings, with both downloads parsed', async ({ page }) => {
  await login(page, db, S.clsEmail, '/app/settings')
  const series = async () => (await db.from('calendar_commitments').select('ends_on, ended_by_completion').eq('user_id', S.clsId).eq('kind', 'class').eq('status', 'active')).data ?? []
  const parseClasses = async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-calendar-export-card]').getByRole('button', { name: 'Download .ics' }).click()])
    return new ICAL.Component(ICAL.parse(fs.readFileSync((await dl.path())!, 'utf8'))).getAllSubcomponents('vevent').filter(e => /class/i.test(String(e.getFirstPropertyValue('summary')))).length
  }
  await rec.browser('Settings offers "Mark my classes as finished" only to a class-led student; the effective date and its limits are stated', async () => {
    await expect(page.getByRole('button', { name: 'Mark my classes as finished' })).toBeVisible()
    await expect(page.getByText(/accepted week, finished work and class history are unchanged|consolidation and revision/)).toBeVisible()
    await noHorizontalOverflow(page)
  })
  await rec.browser('marking finished ends the class series (persisted ends_on and flag) and the next calendar download has no future classes', async () => {
    await page.getByRole('button', { name: 'Mark my classes as finished' }).click()
    await expect(page.getByRole('button', { name: /Undo/ })).toBeVisible()
    const rows = await series(); expect(rows.length).toBe(2); expect(rows.every(r => r.ended_by_completion)).toBe(true)
    const card = page.locator('[data-calendar-export-card]'); await card.getByLabel('Include my classes and fixed commitments').check()
    const from = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), to = new Date(Date.now() + 17 * 86_400_000).toISOString().slice(0, 10)
    await card.getByLabel('From').fill(from); await card.getByLabel('To').fill(to)
    expect(await parseClasses()).toBe(0)
  })
  await rec.browser('undo restores the series and the download has the classes again', async () => {
    await page.getByRole('button', { name: /Undo/ }).click(); await expect(page.getByRole('button', { name: 'Mark my classes as finished' })).toBeVisible()
    const rows = await series(); expect(rows.every(r => !r.ended_by_completion && r.ends_on === '2027-01-01')).toBe(true)
    expect(await parseClasses()).toBeGreaterThanOrEqual(2)
  })
  await rec.browser('Home, Calendar, Curriculum, Tests and Coach all still render for this student after both changes', async () => {
    for (const path of ['/app', '/app/calendar', '/app/curriculum', '/app/tests', '/app/coach']) { const r = await page.goto(path); expect(r!.status(), path).toBeLessThan(400); await noHorizontalOverflow(page) }
  })
})

test('Account controls outside the study gate, and deletion: Cancel, Escape, wrong email, then the real deletion', async ({ page }, info) => {
  await login(page, db, S.delEmail, '/account')
  await rec.browser('a signed-in person with UNFINISHED setup reaches /account while /app stays gated', async () => {
    await expect(page.getByRole('heading', { name: 'Your account', exact: true })).toBeVisible()
    await page.goto('/app'); await expect(page).not.toHaveURL(/\/app$/)
    await page.goto('/account')
    await noHorizontalOverflow(page)
    await page.screenshot({ path: `/tmp/roadmap-phase6-account-${info.project.name}.png` })
  })
  await rec.browser('Cancel and Escape close the dialog before submission and delete nothing', async () => {
    const open = async () => { await page.getByRole('button', { name: 'Delete account…' }).click(); await expect(page.getByRole('alertdialog')).toBeVisible(); await expect(page.getByRole('button', { name: 'Delete my account' })).toBeDisabled() }
    await open(); await page.getByRole('button', { name: 'Cancel' }).click(); await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await open(); await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Delete account…' })).toBeFocused()   // focus returns to the trigger
    expect(!!(await db.auth.admin.getUserById(S.delId)).data.user).toBe(true)
  })
  await rec.browser('a failed server sign-out states that the session revocation was not confirmed and offers sign-in instead of stale account controls', () => se.expecting([{label:'controlled sign-out refusal',url:/\/api\/auth$/,statuses:[502],min:1,max:1}],async()=>{
    // Sign-out runs server-side (POST /api/auth), so the failure is injected there, not at the provider.
    await page.route('**/api/auth',async r=>{
      if (r.request().postDataJSON()?.action !== 'signout') return r.continue()
      await r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'This browser has been signed out. PrepPlan could not confirm that its session was revoked.'})})
    })
    await page.getByRole('button',{name:'Sign out of this device',exact:true}).click()
    await expect(page.getByRole('alert').filter({hasText:'could not confirm that its session was revoked'})).toBeVisible()
    await expect(page.getByRole('link',{name:'Sign in again',exact:true})).toBeFocused()
    await expect(page.getByRole('button',{name:'Delete account…',exact:true})).toHaveCount(0)
    await page.unroute('**/api/auth')
    await page.context().clearCookies()   // the injected failure bypassed the real server sign-out
    await page.reload(); await expect(page).toHaveURL(/\/login/)
    await login(page,db,S.delEmail,'/account')
  }))
  await rec.browser('a wrong email keeps the button disabled; the right email deletes, clears this session, and the account is gone with its rows', () => se.expecting([{ label: 'post-deletion session cleanup', url: /\/auth\/v1\/logout(?:\?|$)/, statuses: [403], min: 0, max: 1 }], async () => {
    await page.getByRole('button', { name: 'Delete account…' }).click()
    const field = page.getByRole('alertdialog').getByRole('textbox'); await field.fill('someone@else.example'); await expect(page.getByRole('button', { name: 'Delete my account' })).toBeDisabled()
    await field.fill(S.delEmail); await page.getByRole('button', { name: 'Delete my account' }).click()
    await page.waitForURL(url => new URL(url).pathname === '/')
    await expect.poll(async () => !!(await db.auth.admin.getUserById(S.delId)).data.user, { timeout: 20_000 }).toBe(false)
    expect((await db.from('profiles').select('id').eq('id', S.delId)).data!.length).toBe(0)
    const r = await page.request.get('/api/account/export'); expect([401, 403]).toContain(r.status())
  }))
})

test('Sidebar account controls: the saved name reaches both navigation views; sign-out is this device only and failures are truthful',async({page,browser})=>{
  let logoutStage='setup'
  const logoutEvents:unknown[]=[]
  page.on('response',r=>{if(new URL(r.url()).pathname==='/auth/v1/logout')logoutEvents.push({stage:logoutStage,event:'response',status:r.status()})})
  page.on('requestfailed',r=>{if(new URL(r.url()).pathname==='/auth/v1/logout')logoutEvents.push({stage:logoutStage,event:'failed',failure:r.failure()?.errorText})})
  await login(page,db,S.email,'/app/settings')
  const before=(await db.from('profiles').select('onboarding_context_version').eq('id',S.id).single()).data!
  const taskCount=(await db.from('plan_blocks').select('id',{head:true,count:'exact'}).eq('user_id',S.id)).count
  const longName='A'.repeat(100)
  await page.getByLabel('Display name',{exact:true}).fill(longName);await page.getByRole('button',{name:'Save name',exact:true}).click()
  await expect(page.locator('.app-shell > .sidebar .profile-row strong')).toHaveText(longName)
  expect((await db.from('profiles').select('onboarding_context_version').eq('id',S.id).single()).data!.onboarding_context_version).toBe(before.onboarding_context_version)
  await page.goto('/app');await expect(page.locator('h1')).toContainText(longName);await noHorizontalOverflow(page)
  const nav=()=>page.viewportSize()!.width<768?page.locator('.sidebar--compact'):page.locator('.app-shell > .sidebar')
  const open=async()=>{if(page.viewportSize()!.width<768)await page.getByRole('button',{name:'Open navigation',exact:true}).click();await expect(nav().locator('.profile-row strong')).toHaveText(longName);await noHorizontalOverflow(page)}
  await open()
  logoutStage='controlled refusal'
  await se.expecting([{label:'controlled sidebar sign-out refusal',url:/\/api\/auth$/,statuses:[502],min:1,max:1}],async()=>{
    // Sign-out runs server-side (POST /api/auth), so the refusal is injected there.
    await page.route('**/api/auth',async r=>{
      if (r.request().postDataJSON()?.action !== 'signout') return r.continue()
      await r.fulfill({status:502,contentType:'application/json',body:JSON.stringify({error:'This browser has been signed out. PrepPlan could not confirm that its session was revoked.'})})
    })
    await nav().getByRole('button',{name:'Sign out of this device',exact:true}).click()
    await expect(nav().getByRole('alert')).toContainText('could not confirm that its session was revoked')
    await expect(nav().getByRole('link',{name:'Sign in again',exact:true})).toBeFocused()
  })
  await page.unroute('**/api/auth')
  await page.context().clearCookies()   // the injected refusal bypassed the real server sign-out
  logoutStage='re-authentication'
  expect([401,403]).toContain((await page.request.post('/api/tasks',{data:{title:'Must not be created',date:'2027-01-01'}})).status())
  expect((await db.from('plan_blocks').select('id',{head:true,count:'exact'}).eq('user_id',S.id)).count).toBe(taskCount)
  await login(page,db,S.email,'/app/settings')
  const second=await browser.newContext({viewport:page.viewportSize()!,timezoneId:'Europe/London'}),other=await second.newPage()
  try{
    await login(other,db,S.email,'/app')
    expect((await other.request.get('/api/profile')).status()).toBe(200)
    await open()
    logoutStage='real sign-out'
    // Auth's noResolveJson returns on the 204 headers. Full navigation may cancel the unused body, not the server revocation.
    await se.expecting([{label:'unused logout body cancelled after proved 204 and local sign-out',url:/\/auth\/v1\/logout\?scope=local$/,failed:true,method:'POST',failureText:'net::ERR_ABORTED',min:0,max:1}],async()=>{
      const response=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/auth')
      await nav().getByRole('button',{name:'Sign out of this device',exact:true}).click()
      const result=await response;expect(result.ok()).toBe(true)
      await expect(page).toHaveURL(/\/login$/)
      expect([401,403]).toContain((await page.request.get('/api/profile')).status())
    })
    expect((await other.request.get('/api/profile')).status()).toBe(200)
    expect((await db.auth.admin.getUserById(S.id)).data.user).toBeTruthy()
  }finally{await second.close();rec.rows.push({step:'Sidebar logout transport sequence (no tokens)',status:'pass',how:'browser',detail:JSON.stringify(logoutEvents)})}
})
