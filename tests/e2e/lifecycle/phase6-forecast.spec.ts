import { expect, test, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { addDays, admin, login, noHorizontalOverflow, RUN, removeStudent } from './helpers'

/**
 * Phase 6 · unaccepted first-pass study in the catch-up forecast, desktop and 390 px. Owned students, owned time fixtures, an empty bank, the real review
 * preview and accept. One explanation must read the same on Home, Calendar, the Roadmap, Weekly Review and Coach, and reading it must write nothing.
 */
const db = admin()
const rows = async (uid: string) => ({
  blocks: (await db.from('plan_blocks').select('id, execution, local_date, revision, duration_minutes, cancelled_at').eq('user_id', uid).order('id').throwOnError()).data,
  reviews: (await db.from('weekly_reviews').select('id').eq('user_id', uid).order('id').throwOnError()).data,
  events: (await db.from('task_events').select('id').eq('user_id', uid).order('id').throwOnError()).data,
})
async function answerReview(page: Page) {
  await page.goto('/app/review-week')
  for (const g of await page.getByRole('radiogroup', { name: /^What happened with / }).all()) await g.getByText('Not done', { exact: true }).click()
  for (const g of await page.getByRole('radiogroup', { name: /^What next for / }).all()) await g.getByText('Continue next week', { exact: true }).click()
  const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
  if (await ack.isVisible()) await ack.check()
  for (const r of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await r.check()
  await page.getByRole('button', { name: 'Preview next week' }).click()
  await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()
}
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
/** The status as each surface says it: headline, numbers and the trade-off sentence. */
async function surfaces(page: Page) {
  const read = async (url: string) => {
    await page.goto(url)
    const n = page.getByTestId('recovery-status')
    await expect(n).toBeVisible()
    await noHorizontalOverflow(page)
    return { level: await n.getAttribute('data-level'), headline: clean(await n.locator('h2').innerText()), numbers: clean(await page.getByTestId('recovery-numbers').innerText()),
      tradeoff: await page.getByTestId('recovery-tradeoff').count() ? clean(await page.getByTestId('recovery-tradeoff').innerText()) : null }
  }
  const home = await read('/app')
  expect(await read('/app/calendar')).toEqual(home)
  expect(await read('/app/curriculum?view=roadmap')).toEqual(home)
  await page.goto('/app/coach')
  await page.getByRole('textbox', { name: 'Ask the coach' }).fill('I am behind, how do I catch up?')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const note = page.getByText(/Catch-up status:/).last()
  await expect(note).toContainText(home.headline)
  if (home.tradeoff) await expect(note).toContainText(home.tradeoff)
  await noHorizontalOverflow(page)
  return { ...home, coach: clean(await note.innerText()) }
}
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
async function student(owned: string[], tag: string) {
  const s = await createStudent(db, `${tag}${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
  await shiftStudentTimeline(s.id, 1, owned)   // one week passes with nothing done: that work is now owed
  return s
}
const cleanup = async (owned: string[]) => { releaseBankLock(); for (const id of owned) await removeStudent(db, id) }

test('forecast · first-pass study that fits is said to fit; the review preview says the same and nothing is written', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(owned, 'fcfit')
    // Whole days free well before the sitting: the Roadmap's remaining study has room.
    await db.from('availability_windows').delete().eq('user_id', S.id).throwOnError()
    await db.from('availability_windows').insert([0, 1, 2, 3, 4, 5, 6].map(weekday => ({ user_id: S.id, weekday, start_time: '06:00', end_time: '22:00', status: 'active' }))).throwOnError()
    await db.from('calendar_commitments').delete().eq('user_id', S.id).throwOnError()
    await login(page, db, S.email, '/app')
    const before = await rows(S.id)
    const seen = await surfaces(page)
    expect(seen.level).toBe('catching_up')
    expect(seen.headline).toBe('Catching up on the same roadmap')
    expect(seen.tradeoff).toBeNull()
    await answerReview(page)
    await expect(page.getByTestId('recovery-why')).toContainText(/New first-pass study the Roadmap still schedules \([\d.]+ h, not accepted yet, at planning estimates\) fits too\./)
    await noHorizontalOverflow(page)
    expect(await rows(S.id)).toEqual(before)
  } finally { await cleanup(owned) }
})

test('forecast · the same owed work with little time: the unaccepted study changes the recommendation, names what would wait and records nothing', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(owned, 'fctight')
    // Three short evenings: enough for what is owed, nowhere near enough for the whole first pass.
    await db.from('availability_windows').delete().eq('user_id', S.id).throwOnError()
    await db.from('availability_windows').insert([1, 3, 5].map(weekday => ({ user_id: S.id, weekday, start_time: '19:00', end_time: '20:30', status: 'active' }))).throwOnError()
    await login(page, db, S.email, '/app')
    const before = await rows(S.id)
    const seen = await surfaces(page)
    expect(seen.level).toBe('catching_up')   // new study alone never offers recovery
    expect(seen.headline).toBe('Catching up fits, with a trade-off ahead')
    expect(seen.tradeoff).toMatch(/What is owed fits, but the whole Roadmap does not\. Would wait: [\d.]+ h of new study: .+ \(\d+ min\)/)
    expect(seen.tradeoff).toMatch(/To keep it, add about [\d.]+ h of study time by \d{4}-\d\d-\d\d/)
    await answerReview(page)
    // The draft's explanation: the closing week's unfinished study is carried (owed), and counted once.
    await expect(page.getByTestId('recovery-proposal')).toHaveAttribute('data-level', 'catching_up')
    await expect(page.getByTestId('recovery-why')).toContainText(/Would wait: [\d.]+ h of new study/)
    await expect(page.getByTestId('recovery-paths')).toHaveCount(0)
    await noHorizontalOverflow(page)
    expect(await rows(S.id)).toEqual(before)
    const drafted = clean(await page.getByTestId('recovery-why').getByRole('listitem').filter({ hasText: 'Would wait: ' }).innerText())
    // Saving the reviewed draft is the only write, and every surface afterwards says what the draft said, to the minute.
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await page.waitForURL(/\/app\/calendar/)
    expect((await surfaces(page)).tradeoff).toBe(drafted)
  } finally { await cleanup(owned) }
})

test('forecast · final preparation adds no new study, and says what is not counted', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(owned, 'fcfinal')
    await db.from('profiles').update({ registered: true, exam_date: addDays(todayInZone('Europe/London'), 40) }).eq('id', S.id).throwOnError()
    await login(page, db, S.email, '/app')
    const before = await rows(S.id)
    await answerReview(page)
    await expect(page.getByTestId('recovery-why')).toContainText(/Not counted: [\d.]+ h of new study\. Your Roadmap is in final preparation, which adds no new study\./)
    expect(await rows(S.id)).toEqual(before)
  } finally { await cleanup(owned) }
})

test('forecast · an accepted mock-led week holds broad study until it ends, then forecasts it as provisional', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(owned, 'fcmock')
    // Booked twenty weeks out with one opening a week that holds a mock, and far more deferred work than those openings can clear: no broad reading
    // can be finished before the runway, while the Roadmap's first pass is still open.
    await db.from('profiles').update({ registered: true, exam_date: addDays(todayInZone('Europe/London'), 140) }).eq('id', S.id).throwOnError()
    await db.from('availability_windows').delete().eq('user_id', S.id).throwOnError()
    await db.from('availability_windows').insert([{ user_id: S.id, weekday: 6, start_time: '09:00', end_time: '11:20', status: 'active' }]).throwOnError()
    const past = addDays(todayInZone('Europe/London'), -10)
    await db.from('plan_blocks').insert(Array.from({ length: 18 }, (_, i) => ({ id: `p6-owed-${RUN}-${i}`, user_id: S.id, cycle_id: null, title: `Earlier work ${i + 1}`, detail: 'Owned fixture', task_type: 'study', origin: 'student', priority: 'core', placement: 'day_preferred', starts_at: null, execution: 'deferred', local_date: past, day: past, duration: '180', duration_minutes: 180 }))).throwOnError()
    await login(page, db, S.email, '/app')
    await answerReview(page)
    await expect(page.getByTestId('mock-proposal')).toHaveAttribute('data-verdict', 'start_with_gaps')
    const why = page.getByTestId('recovery-why'), heldLine = /Your accepted mock-led week holds broad new study until (\d{4}-\d\d-\d\d)/
    // The mock-led week defers broad study; the readings the Roadmap schedules afterwards stay in the forecast, named.
    await expect(why).toContainText(heldLine)
    await expect(why).toContainText(/h of new study: .+ \(\d+ min\)/)
    await expect(why).not.toContainText('Not counted:')
    const until = heldLine.exec(await why.innerText())![1]
    expect(until > todayInZone('Europe/London')).toBe(true)
    // Keeping broad revision instead leaves nothing held.
    await page.getByRole('button', { name: 'Keep broad revision this week instead' }).click()
    await expect(why).not.toContainText(heldLine)
    await page.getByRole('button', { name: 'Use the recommended mock week' }).click()
    await expect(why).toContainText(heldLine)
    await noHorizontalOverflow(page)
    const before = await rows(S.id)
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await page.waitForURL(/\/app\/calendar/)
    expect((await db.from('weekly_reviews').select('recap').eq('user_id', S.id).order('created_at', { ascending: false }).limit(1).single().throwOnError()).data!.recap).toMatchObject({ mock: { led: true } })
    // Home, Calendar, Roadmap and Coach give the same explanation after saving, and reading it writes nothing.
    const accepted = await rows(S.id)
    const seen = await surfaces(page)
    expect(seen.coach).toContain(seen.headline)
    expect(seen.tradeoff).toMatch(/of new study: /)
    expect(await rows(S.id)).toEqual(accepted)
    expect(accepted.events.length).toBeGreaterThanOrEqual(before.events.length)
    await page.goto('/app/review-week'); await page.goto('/app/curriculum?view=roadmap')
    expect(await rows(S.id)).toEqual(accepted)
  } finally { await cleanup(owned) }
})

test('forecast · a failed catch-up read is said to have failed, never shown as nothing owed', async ({ page }) => {
  local(); test.skip(!process.env.FAULTS_FILE, 'Needs the loopback fault proxy.'); test.setTimeout(240_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(owned, 'fcfault')
    await login(page, db, S.email, '/app')
    await expect(page.getByTestId('recovery-status')).toBeVisible()
    // Only the logged-minutes read behind the status fails; the rest of each page loads.
    fs.writeFileSync(process.env.FAULTS_FILE!, JSON.stringify({ rules: [{ id: 'logged-minutes', match: 'select=id%2Ctask_id%2Cactual_duration_minutes', mode: 'status', status: 500 }] }))
    for (const url of ['/app', '/app/calendar', '/app/curriculum?view=roadmap']) {
      await page.goto(url)
      await expect(page.getByTestId('recovery-unavailable'), url).toContainText('could not be loaded')
      await expect(page.getByTestId('recovery-status')).toHaveCount(0)
      await noHorizontalOverflow(page)
    }
    fs.writeFileSync(process.env.FAULTS_FILE!, '{"rules":[]}')
    await page.goto('/app'); await expect(page.getByTestId('recovery-status')).toBeVisible()
  } finally { if (process.env.FAULTS_FILE) fs.writeFileSync(process.env.FAULTS_FILE, '{"rules":[]}'); await cleanup(owned) }
})
