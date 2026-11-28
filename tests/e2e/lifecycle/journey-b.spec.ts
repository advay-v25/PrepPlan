/**
 * Journey B in a real browser, desktop and 390px. Start through class-led onboarding and exercise exact named class links,
 * a second tab changing the schedule, a lost class-log reply and the reviewed closing-week disposition.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { admin, login, noHorizontalOverflow, recorder, RUN, wd, chooseClassDay, addDays } from './helpers'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'

const db = admin(), rec = recorder(), owned: string[] = []
const S: { id: string; email: string; d1: string; d2: string; timeFixtures: Record<string, unknown>[] } = { id: '', email: '', d1: '', d2: '', timeFixtures: [] }
const unexpected: string[] = []
test.describe.configure({ mode: 'serial' })
test.beforeAll(() => acquireBankLock())
test.beforeEach(({ page }) => {
  const INJECTED = ['/api/class-log/confirm', '/api/coach']
  // A Next route prefetch that the page's own navigation cancels is not a failure (the shared collector and phase4-student allow it the same way); a failed API call still is.
  page.on('requestfailed', r => { if (r.failure()?.errorText === 'net::ERR_ABORTED' && r.method() === 'GET' && r.url().includes('_rsc=')) return; if (!INJECTED.some(u => r.url().includes(u))) unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`) })
  page.on('response', r => { if (r.status() >= 400 && !((r.status() === 409 && r.url().includes('/api/class-log/confirm')) || (r.status() === 503 && r.url().includes('/api/coach')))) unexpected.push(`HTTP ${r.status()} ${r.url()}`) })
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) unexpected.push(`${page.url()} ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 200)}`))
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  releaseBankLock()
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/lifecycle-browser-B-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, unexpected, timeFixtures: S.timeFixtures, cleanup, steps: rec.rows, notBrowserDriven: ['paper scoring and repair (A browser and B endpoint suites)', 'Coach move and drag in the class-led context'] }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

test('persona, Coach handoff, class-log mapping, stale preview, lost response, missed class, Coach outage', async ({ page, context }) => {
  const st = await createStudent(db, `lbB${RUN}`, { onboard: false, register: id => owned.push(id) }); S.id = st.id; S.email = st.email
  await login(page, db, S.email, '/onboarding/exam')
  const forward = async (step: string) => {
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForURL(`**/onboarding/${step}`)
  }
  await rec.browser('clear class-led onboarding in the browser: booked date, a weekly timetable, existing preparation and available hours', async () => {
    const { data: may } = await db.from('exam_windows').select('window_opens').eq('year', 2027).eq('sitting', 'may').single().throwOnError()
    await page.getByRole('button', { name: /^May/ }).click()
    await page.getByRole('button', { name: 'Yes, I have a date' }).click()
    await page.getByLabel('Exact booked exam date').fill(String(may!.window_opens).slice(0, 10))
    await forward('route')
    await page.getByRole('button', { name: /^Live classes/ }).click()
    await page.getByRole('button', { name: 'Same times every week' }).click()
    await page.getByRole('button', { name: 'Add a class' }).click()
    await page.getByRole('button', { name: 'Tue', exact: true }).click()
    await page.getByRole('button', { name: 'Thu', exact: true }).click()
    await page.getByText('Name or end date', { exact: true }).click()
    await page.getByLabel('Class name (optional)').fill('Coaching')
    await forward('position')
    await page.getByRole('button', { name: 'Some subjects covered' }).click()
    await forward('week')
    await page.getByRole('button', { name: /^Weekday evenings/ }).click()
    await page.getByRole('button', { name: /^(Weekends|Saturday morning)/ }).click()
    await page.getByRole('button', { name: '45 min' }).click()
    await forward('plan')
    await noHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Accept and open Calendar' }).click()
    await page.waitForURL('**/app/calendar')
    await expect(page.locator('.cal-head')).toBeVisible()
  })
  let cyc = (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data!
  await rec.api('persona saved; the class-led cycle runs Tuesday to Monday', async () => {
    expect((await db.from('profiles').select('prep_mode, stage, registered').eq('id', S.id).single()).data).toEqual({ prep_mode: 'instructor_led', stage: 'first_pass_underway', registered: true })
    expect(wd(cyc.starts_at_local)).toBe(2); expect(wd(cyc.ends_at_local)).toBe(1)
  })
  // SEEDED FIXTURE F1 (recorded, this student only). The persona's own classes (Tue/Thu 18:00) make "which classes have finished" depend on the time of day,
  // and the journey needs finished classes with real room left for follow-up. So: the accepted cycle starts six days ago, and the timetable is two NAMED classes
  // on one finished day (D1: Financial reporting 09:00, Economics 11:00) plus one on the next (D2: Quantitative methods 09:00). The same-day pair is the premise:
  // a date is not a class. Nothing else about the product's cadence or attendance rule is changed for the test.
  const tz = (await db.from('planning_cycles').select('timezone').eq('id', cyc.id).single()).data!.timezone as string
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date())
  S.d1 = addDays(today, -3); S.d2 = addDays(today, -2)
  await db.from('planning_cycles').update({ starts_at_local: addDays(today, -6), ends_at_local: addDays(today, 9) }).eq('id', cyc.id).throwOnError()
  await db.from('calendar_commitments').delete().eq('user_id', S.id).eq('kind', 'class').throwOnError()
  for (const [label, day, st, en] of [['Financial reporting', S.d1, '09:00', '10:00'], ['Economics', S.d1, '11:00', '12:00'], ['Quantitative methods', S.d2, '09:00', '10:00']] as const)
    await db.from('calendar_commitments').insert({ user_id: S.id, label, kind: 'class', recurrence: 'weekly', status: 'active', is_protected: true, weekdays: [wd(day)], start_time: st, end_time: en, starts_on: addDays(today, -8), starts_at: `${addDays(today, -8)}T${st}:00Z`, ends_at: `${addDays(today, -8)}T${en}:00Z` }).throwOnError()
  S.timeFixtures.push({ id: 'F1', note: 'cycle started six days ago; two named classes on one finished day and one on the next replace the persona timetable', d1: S.d1, d2: S.d2, timezone: tz })
  const readCtx = () => page.evaluate(async () => (await fetch('/api/class-log/context')).json())
  const ctx = await readCtx()
  expect((ctx.context.occurrences as any[]).filter(o => o.date === S.d1 && o.status === 'pending').map(o => o.label).sort()).toEqual(['Economics', 'Financial reporting'])
  expect(S.d1 && S.d2).toBeTruthy()

  await page.goto('/app/coach')
  await rec.browser('Coach links the named class report without writing anything', async () => {
    const before = (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count
    await page.getByRole('textbox', { name: 'Ask the coach' }).fill('I attended Financial reporting class, can you log it'); await page.getByRole('button', { name: 'Send' }).click()
    const link = page.getByRole('link', { name: /Log Financial reporting/ }); await expect(link).toBeVisible({ timeout: 40_000 })
    await expect(link).toHaveAttribute('href', /occurrence=/)
    expect((await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(before)
    await link.click(); await expect(page).toHaveURL(/log-class/)
  })

  const topic = (await db.from('curriculum_readings').select('topic_id').eq('id', 'r028').single()).data!.topic_id as string
  await rec.browser('class-log form: class day, covered material, four outcomes with one bounded partial (EPS, r028-d); long labels fit the viewport', async () => {
    await expect(page.getByLabel('Class', { exact: true }).locator('option:checked')).toContainText('Financial reporting')
    await page.getByRole('radio', { name: /We covered new material/ }).check()
    await page.getByLabel('Subject').selectOption(topic); await page.getByLabel('Reading').selectOption('r028')
    const boxes = page.locator('.class-log input[type=checkbox]'); await expect(boxes.first()).toBeVisible()
    for (const c of ['a', 'b', 'c', 'd']) await page.getByText(new RegExp(`^${c}\\.`)).first().click()
    for (const i of [0, 1, 2]) await page.getByRole('radio', { name: 'All of it' }).nth(i).check()   // d (fourth, EPS) is "Part of it"
    await page.getByRole('radio', { name: 'Part of it' }).nth(3).check()
    await page.getByRole('textbox', { name: /Which part of/ }).nth(3).fill('basic EPS only')
    await noHorizontalOverflow(page)
  })
  await rec.browser('Preview writes nothing and shows dates, minutes and the load verdict', async () => {
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    expect((await db.from('class_sessions').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(0)
  })
  await rec.browser('SECOND TAB adds protected time after the preview: Confirm refuses with nothing written, the input is kept and a fresh preview is shown', async () => {
    const day = await page.locator('.class-log__preview li > strong').first().innerText()
    const p2 = await context.newPage(); await p2.goto('/app/calendar')
    const r = await p2.evaluate(async d => (await fetch('/api/commitments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'personal', label: 'Added in another tab', date: d, startTime: '06:00', endTime: '23:00', isProtected: true }) })).json(), day)
    expect(r.ok).toBe(true); await p2.close()
    const stale409 = page.waitForResponse(r => r.url().includes('/api/class-log/confirm'))
    await page.getByRole('button', { name: 'Finish class log' }).click()
    const sb = await (await stale409).json(); expect(sb.code).toBe('preview_changed')
    await expect(page.locator('.class-log .review-error')).toBeVisible()
    expect((await db.from('class_sessions').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(0)
    await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()   // the fresh preview replaced the old one
    await expect(page.locator('.class-log__preview li > strong').first()).not.toHaveText(day)         // the new preview moved the work off the now-blocked day
    await expect(page.locator('.class-log input[type=checkbox]:checked')).toHaveCount(4)               // input retained
  })
  await rec.browser('POST-commit lost response: the UI says unconfirmed and keeps the input; confirming again replays it (one session, exactly the previewed tasks)', async () => {
    const previewDays = (await page.locator('.class-log__preview li > strong').allInnerTexts()).sort()
    await page.route('**/api/class-log/confirm', async r => { await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Finish class log' }).click()
    await expect(page.getByText(/could not confirm whether this was saved/i)).toBeVisible()
    await expect(page.getByTestId('class-log-unsure')).toBeVisible()
    expect((await db.from('class_sessions').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(1)
    await page.unroute('**/api/class-log/confirm')
    await page.getByRole('button', { name: 'Retry' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    expect((await db.from('class_sessions').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(1)
    const sess = (await db.from('class_sessions').select('id, cycle_id').eq('user_id', S.id).single()).data!
    const tasks = (await db.from('plan_blocks').select('id, local_date').eq('class_session_id', sess.id)).data!
    expect(sess.cycle_id).toBe(cyc.id); expect(tasks.length).toBeGreaterThan(0); expect([...new Set(tasks.map(t => t.local_date as string))].sort()).toEqual(previewDays)   // exactly the previewed days, once
    expect((await db.from('class_session_items').select('outcome_id, extent, portion_note').eq('session_id', sess.id)).data!.find(i => i.outcome_id === 'r028-d')).toMatchObject({ extent: 'part', portion_note: 'basic EPS only' })
  })
  await rec.browser('a missed class is recorded in the UI: no scope, no task, no commitment removed', async () => {
    const commitments = (await db.from('calendar_commitments').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count
    await page.goto('/app/calendar/log-class'); await chooseClassDay(page, S.d2); await page.getByRole('radio', { name: /I missed the class/ }).check()
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const miss = (await db.from('class_sessions').select('id').eq('user_id', S.id).eq('class_date', S.d2).single()).data!
    expect((await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('class_session_id', miss.id)).count).toBe(0)
    expect((await db.from('calendar_commitments').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(commitments)
  })
  await rec.browser('the OTHER class on the same day is logged separately: two sessions, and each follow-up task names the class it came from', async () => {
    const other = (await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).neq('id', 'r028').order('sequence').limit(1).single()).data!
    await page.goto('/app/calendar/log-class'); await chooseClassDay(page, S.d1)
    await page.getByRole('radio', { name: /We covered new material/ }).check(); await page.getByLabel('Subject').selectOption(other.topic_id as string); await page.getByLabel('Reading').selectOption(other.id as string)
    await page.locator('.class-log__outcomes input[type=checkbox]').first().check(); await page.getByRole('radio', { name: 'All of it' }).first().check()
    await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
    await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
    const onD1 = (await db.from('class_sessions').select('id, occurrence_key, commitment_id').eq('user_id', S.id).eq('class_date', S.d1)).data!
    expect(onD1).toHaveLength(2); expect(new Set(onD1.map(x => x.occurrence_key)).size).toBe(2); expect(new Set(onD1.map(x => x.commitment_id)).size).toBe(2)
    const names = new Map((await db.from('calendar_commitments').select('id, label').eq('user_id', S.id)).data!.map(c => [c.id as string, c.label as string]))
    for (const x of onD1) {
      const why = ((await db.from('plan_blocks').select('rationale').eq('class_session_id', x.id).is('cancelled_at', null)).data ?? []).map(r => String(r.rationale))
      expect(why.length).toBeGreaterThan(0)
      expect(why.every(r => r.includes(`(${names.get(x.commitment_id as string)})`)), `tasks of ${names.get(x.commitment_id as string)}`).toBe(true)
    }
    expect(new Set(onD1.map(x => names.get(x.commitment_id as string))).size).toBe(2)
  })
  await rec.browser('PAGE-LEVEL Coach outage (503): a clear error, the question is kept, retry works. (Server-side fallback for obvious requests is proven by coach:turns:runtime:test, not here.)', async () => {
    await page.goto('/app/coach')
    await page.route('**/api/coach', r => r.request().method() === 'POST' ? r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'The Coach is unavailable right now.' }) }) : r.continue())
    await page.getByRole('textbox', { name: 'Ask the coach' }).fill('What should I do today?'); await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('.coach-error')).toBeVisible()
    await page.unroute('**/api/coach')
    await page.getByRole('button', { name: /Try again|Retry/i }).first().click().catch(async () => { await page.getByRole('button', { name: 'Send' }).click() })
    await expect.poll(async () => ((await db.from('coach_messages').select('id').eq('user_id', S.id).eq('role', 'coach').ilike('intent', 'today')).data ?? []).length, { timeout: 40_000 }).toBeGreaterThan(0)   // a real answer was saved after the retry
    await expect(page.locator('.coach-error')).toHaveCount(0)
  })
  await rec.browser('weekly closure names the unresolved class and does not turn it into attendance or coverage', async () => {
    // The prior test already proves a student's report; this later closed-cycle fixture deliberately leaves one separate class unreported.
    const closeDay = today
    await db.from('planning_cycles').update({ ends_at_local: closeDay }).eq('id', cyc.id).throwOnError()
    const clinic = (await db.from('calendar_commitments').insert({
      user_id: S.id, label: 'Review clinic', kind: 'class', recurrence: 'none', status: 'active', is_protected: true,
      starts_at: `${S.d2}T07:00:00Z`, ends_at: `${S.d2}T08:00:00Z`,
    }).select('id').single().throwOnError()).data!
    const recorded = (await db.from('class_sessions').select('id,occurrence_key,commitment_id').eq('user_id', S.id).eq('class_date', S.d1).order('id').throwOnError()).data!
    await page.goto(`/app/calendar?week=${S.d1}&commitment=${recorded[0].commitment_id}&occurrence=${S.d1}`)
    await page.getByRole('link', { name: 'Open saved class log', exact: true }).click()
    await expect(page.getByTestId('class-log-saved')).toBeVisible()
    expect(new URL(page.url()).searchParams.get('session')).toBe(recorded[0].id)
    await page.goto('/app/review-week')
    const row = page.locator('.review-task', { hasText: 'Review clinic' })
    await expect(row.getByRole('link', { name: 'Log this class' })).toHaveAttribute('href', new RegExp(clinic.id))
    await expect(row.getByRole('checkbox', { name: 'Leave unreported' })).toBeVisible()
    await row.getByRole('checkbox', { name: 'Leave unreported' }).check()
    await page.reload()
    await expect(row.getByRole('checkbox', { name: 'Leave unreported' })).toBeChecked()
    // If the approved bank can serve this week's scope, finish the paper before closing.
    const weekly = await page.request.get('/api/weekly-review/state')
    expect(weekly.ok()).toBe(true)
    expect((await db.from('class_sessions').select('id').eq('user_id', S.id).eq('commitment_id', clinic.id).throwOnError()).data).toEqual([])
    expect(recorded.map(log => log.occurrence_key).every(Boolean)).toBe(true)
    const read = await weekly.json()
    if ((read.state ?? read).gate?.kind === 'paper_pending') {
      await page.goto('/app/tests')
      await page.getByRole('button', { name: /^Review and start/ }).first().click()
      await page.getByRole('button', { name: 'Start weekly paper' }).click()
      await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
      const attemptId = page.url().split('/').at(-1)!
      const form = (await db.from('assessment_attempts').select('form_id').eq('id', attemptId).single().throwOnError()).data!
      const items = (await db.from('form_items').select('item_id').eq('form_id', form.form_id).order('sequence_number').throwOnError()).data!
      expect(items.length).toBeGreaterThanOrEqual(5)
      await page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio').first().click()
      await page.getByRole('radio', { name: 'Sure', exact: true }).click()
      await page.getByRole('button', { name: /^Next/ }).click()
      for (let i = 1; i < items.length - 1; i++) await page.getByRole('button', { name: 'Skip', exact: true }).click()
      await page.getByRole('button', { name: /^Review/ }).click()
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Submit for scoring' }).click()
      await page.waitForURL(/\/result$/)
      expect((await db.from('assessment_attempts').select('status').eq('id', attemptId).single().throwOnError()).data?.status).toBe('scored')
      await page.goto('/app/review-week')
    }
    for (const choice of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await choice.check()
    for (const group of await page.getByRole('radiogroup', { name: /^What happened with / }).all()) await group.getByLabel('Not sure').check()
    const noPaper = page.getByRole('checkbox', { name: /Close this week without a paper/ })
    if (await noPaper.isVisible()) await noPaper.check()
    await page.getByRole('button', { name: 'Preview next week' }).click()
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await page.waitForURL(/reviewed=/)
    const receipt = (await db.from('weekly_reviews').select('recap').eq('cycle_id', cyc.id).single().throwOnError()).data!
    expect(receipt.recap.classReportsLeftUnreported).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Review clinic', sessionId: null })]))
    expect((await db.from('class_sessions').select('id').eq('user_id', S.id).eq('commitment_id', clinic.id).throwOnError()).data).toEqual([])
  })
  await noHorizontalOverflow(page)
})
