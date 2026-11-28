import { expect, test, type Page } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { addDays, admin, login, noHorizontalOverflow, RUN, removeStudent } from './helpers'

/**
 * Phase 5 · catch-up and formal recovery, three cases, desktop and 390 px. Run-owned students, owned time fixtures (whole weeks), the real review
 * preview and accept commands, and the real Log command for completion. One status must read the same on Home, Calendar, the Roadmap and Coach.
 */
const db = admin()
type Block = { id: string; execution: string; local_date: string | null; duration_minutes: number | null; continued_from_task_id: string | null; cycle_id: string | null; task_type: string; cancelled_at: string | null; title: string }
const blocks = async (uid: string) => (await db.from('plan_blocks').select('id, execution, local_date, duration_minutes, continued_from_task_id, cycle_id, task_type, cancelled_at, title').eq('user_id', uid).order('id').throwOnError()).data as Block[]
const accepted = async (uid: string) => (await db.from('plan_blocks').select('id, execution, local_date, revision, duration_minutes').eq('user_id', uid).order('id').throwOnError()).data

async function reviewPreview(page: Page, o: { path?: string; plannedBreak?: boolean } = {}) {
  await page.goto('/app/review-week')
  for (const g of await page.getByRole('radiogroup', { name: /^What happened with / }).all()) await g.getByText('Not done', { exact: true }).click()
  for (const g of await page.getByRole('radiogroup', { name: /^What next for / }).all()) await g.getByText('Continue next week', { exact: true }).click()
  const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
  if (await ack.isVisible()) await ack.check()
  for (const r of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await r.check()
  if (o.plannedBreak) await page.getByRole('checkbox', { name: /This week was a planned break/ }).check()
  await page.getByRole('button', { name: 'Preview next week' }).click()
  await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()
  if (o.path) await page.getByTestId('recovery-paths').locator(`[data-path="${o.path}"]`).getByRole('button', { name: 'Use this path' }).click()
}
async function accept(page: Page) {
  await page.getByRole('button', { name: 'Save review and open next week' }).click()
  await page.waitForURL(/\/app\/calendar/)
}
async function logFinished(page: Page, id: string) {
  await page.goto(`/app/log?task=${encodeURIComponent(id)}`)
  await page.getByRole('radio', { name: 'Finished it', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Block finished.' })).toBeVisible()
  await page.waitForLoadState('networkidle')
}
/** The one status, read from each surface. */
async function surfaces(page: Page, coachQuestion = 'I am behind, how do I catch up?') {
  const read = async (url: string) => {
    await page.goto(url)
    const n = page.getByTestId('recovery-status')
    if (!(await n.count())) return { level: 'on_track', numbers: '', headline: '' }
    return { level: (await n.getAttribute('data-level'))!, numbers: (await page.getByTestId('recovery-numbers').innerText()).replace(/\s+/g, ' ').trim(), headline: (await n.locator('h2').innerText()).trim() }
  }
  const out = { home: await read('/app'), calendar: await read('/app/calendar'), roadmap: await read('/app/curriculum?view=roadmap') }
  await page.goto('/app/coach')
  await page.getByRole('textbox', { name: 'Ask the coach' }).fill(coachQuestion)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const note = out.home.level === 'on_track' ? null : page.getByText(/Catch-up status:/).last()
  if (note) await expect(note).toContainText(out.home.headline)   // waits for the NEW answer, which must carry the same headline the other surfaces show
  const coach = note ? (await note.innerText()).replace(/\s+/g, ' ') : ''
  return { ...out, coach }
}
const hoursOf = (numbers: string) => Number(/([\d.]+) h to catch up/.exec(numbers)?.[1] ?? NaN)
const agree = (s: Awaited<ReturnType<typeof surfaces>>) => {
  expect(s.calendar.level).toBe(s.home.level); expect(s.roadmap.level).toBe(s.home.level)
  expect(s.calendar.numbers).toBe(s.home.numbers); expect(s.roadmap.numbers).toBe(s.home.numbers)
  expect(s.calendar.headline).toBe(s.home.headline); expect(s.roadmap.headline).toBe(s.home.headline)
  if (s.home.level !== 'on_track') expect(s.coach).toContain(s.home.headline)
}
/** Every original block has at most one continuation: carried work appears once. */
const oneChild = (all: Block[]) => {
  const parents = all.filter(b => b.continued_from_task_id).map(b => b.continued_from_task_id)
  expect(new Set(parents).size).toBe(parents.length)
}

for (const c of ['one missed week', 'two missed weeks, then catch-up in weeks 3 and 4', 'persistent shortfalls'] as const) {
  test(`recovery · ${c}`, async ({ page }) => {
    test.skip(process.env.E2E_SUITE !== 'local-stack', 'This scenario uses owned timeline fixtures on the local stack.')
    test.setTimeout(480_000)
    const owned: string[] = []
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    await acquireBankLock()   // an empty bank, so every review closes without a paper
    try {
      const S = await createStudent(db, `recover${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
      await login(page, db, S.email, '/app')

      if (c === 'one missed week') {
        const first = await blocks(S.id)
        await shiftStudentTimeline(S.id, 1, owned)
        const s = await surfaces(page)
        expect(s.home.level).toBe('catching_up'); agree(s)
        expect(hoursOf(s.home.numbers)).toBeGreaterThan(0)
        await noHorizontalOverflow(page)

        const before = await accepted(S.id)
        await reviewPreview(page)
        const proposal = page.getByTestId('recovery-proposal')
        await expect(proposal).toHaveAttribute('data-level', 'catching_up')
        await expect(page.getByTestId('recovery-fits')).toContainText('Additional hours to close the gap')
        await expect(page.getByTestId('recovery-fits')).toContainText('Fits in this draft')
        await expect(page.getByTestId('recovery-paths')).toHaveCount(0)   // the same roadmap first: no recovery on one missed week
        expect(await accepted(S.id)).toEqual(before)
        await noHorizontalOverflow(page)
        await accept(page)

        const all = await blocks(S.id)
        oneChild(all)
        const carried = all.filter(b => b.continued_from_task_id)
        expect(carried.length).toBeGreaterThan(0)
        // Each unfinished original continues exactly once, on the same lineage; no original was duplicated or lost.
        for (const k of carried) expect(first.some(f => f.id === k.continued_from_task_id)).toBe(true)
        expect(new Set(carried.map(k => k.title)).size).toBe(carried.length)
        const after = await surfaces(page)
        agree(after)
      }

      if (c === 'two missed weeks, then catch-up in weeks 3 and 4') {
        await shiftStudentTimeline(S.id, 2, owned)
        const missed = await surfaces(page)
        expect(missed.home.level).toBe('catching_up'); agree(missed)
        await reviewPreview(page); await accept(page)

        // Week 3: finish part of the carried work through the real Log command.
        let all = await blocks(S.id)
        const carried3 = all.filter(b => b.continued_from_task_id && b.execution === 'not_started')
        expect(carried3.length).toBeGreaterThan(1)
        const owed0 = hoursOf((await surfaces(page)).home.numbers)
        const done3 = carried3.slice(0, Math.ceil(carried3.length / 2))
        for (const b of done3) await logFinished(page, b.id)
        const w3 = await surfaces(page)
        agree(w3)
        const loggedHours3 = done3.reduce((n, b) => n + Number(b.duration_minutes ?? 0), 0) / 60
        expect(hoursOf(w3.home.numbers)).toBeLessThan(owed0)
        expect(owed0 - hoursOf(w3.home.numbers)).toBeCloseTo(loggedHours3, 0)   // the gap fell by what was logged: minutes counted once

        // Week 4: the rest of the carried work continues once more, and is finished.
        await shiftStudentTimeline(S.id, 1, owned)
        await reviewPreview(page); await accept(page)
        all = await blocks(S.id)
        oneChild(all)
        const remaining = all.filter(b => b.continued_from_task_id && b.execution === 'not_started' && !b.cancelled_at)
        const doneIds = new Set(done3.map(b => b.id))
        expect(remaining.every(b => !doneIds.has(b.continued_from_task_id!))).toBe(true)   // finished work was not carried again
        for (const b of remaining) await logFinished(page, b.id)
        const finalBlocks = await blocks(S.id)
        oneChild(finalBlocks)
        for (const b of [...done3, ...remaining]) expect((finalBlocks.find(x => x.id === b.id))!.execution).toBe('completed')
        const w4 = await surfaces(page)
        agree(w4)
        expect(hoursOf(w4.home.numbers) || 0).toBeLessThan(hoursOf(w3.home.numbers))
      }

      if (c === 'persistent shortfalls') {
        // Four weeks in a row that deliver nothing: each is reviewed and carried through the real commands.
        // The oldest one is declared a planned break: it still owes its work but is not counted, and three genuine shortfalls remain.
        for (let w = 0; w < 4; w++) { await shiftStudentTimeline(S.id, 1, owned); await reviewPreview(page, { plannedBreak: w === 0 }); await accept(page) }
        const offered = await surfaces(page)
        expect(offered.home.level).toBe('recovery_offered'); agree(offered)
        expect(offered.home.headline).toMatch(/hard to sustain/)
        await page.goto('/app')
        await expect(page.getByTestId('recovery-status')).toContainText('3 of the last 4 weeks (1 planned break not counted)')

        const before = await accepted(S.id)
        await shiftStudentTimeline(S.id, 1, owned)
        const beforePreview = await accepted(S.id)
        await reviewPreview(page)
        const paths = page.getByTestId('recovery-paths')
        for (const key of ['steady', 'protect_core', 'next_sitting']) {
          const li = paths.locator(`[data-path="${key}"]`)
          await expect(li).toContainText('Revision:'); await expect(li).toContainText('Mocks:'); await expect(li).toContainText('Timeline:')
        }
        await expect(paths.locator('[data-path="protect_core"]')).toContainText(/Waits:.*Revision/)
        await expect(paths.locator('[data-path="steady"]')).toContainText(/h in total/)
        await expect(paths.locator('[data-path="next_sitting"]').getByRole('link', { name: 'Change your exam date' })).toHaveAttribute('href', '/app/exam')
        expect(await accepted(S.id)).toEqual(beforePreview)   // previewing a path changes nothing
        void before

        await paths.locator('[data-path="protect_core"]').getByRole('button', { name: 'Use this path' }).click()
        await expect(page.getByTestId('recovery-proposal')).toHaveAttribute('data-chosen', 'protect_core')
        expect(await accepted(S.id)).toEqual(beforePreview)   // and so does choosing one: only saving takes effect
        await noHorizontalOverflow(page)
        await accept(page)

        const chosen = await surfaces(page, 'I fell behind, what are my recovery options?')
        expect(chosen.home.level).toBe('recovery_chosen'); agree(chosen)
        expect(chosen.home.headline).toMatch(/Protect core coverage first/)
        expect(chosen.coach).toMatch(/You chose this path/)
        // The mock recommendation agrees with the accepted choice.
        await page.goto('/app/curriculum?view=roadmap')
        await expect(page.getByTestId('mock-transition')).toContainText('protect core coverage first')
      }
      expect(errors).toEqual([])
    } finally {
      releaseBankLock()
      for (const id of owned) await removeStudent(db, id)
    }
  })
}

const minutesLogged = async (uid: string, taskId: string) => ((await db.from('task_events').select('actual_duration_minutes').eq('user_id', uid).eq('task_id', taskId).not('actual_duration_minutes', 'is', null).throwOnError()).data ?? []).reduce((n, e) => n + Number(e.actual_duration_minutes), 0)
async function logMinutes(page: Page, id: string, how: 'Finished it' | 'Partly done', minutes: number) {
  await page.goto(`/app/log?task=${encodeURIComponent(id)}`)
  await page.getByRole('radio', { name: how, exact: true }).click()
  await page.getByText('Enter different minutes').click()
  await page.getByLabel('Minutes studied').fill(String(minutes))
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: how === 'Finished it' ? 'Block finished.' : 'Progress saved.' })).toBeVisible()
  await page.waitForLoadState('networkidle')
}
async function student(page: Page, owned: string[]) {
  const S = await createStudent(db, `recover${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
  await login(page, db, S.email, '/app')
  return S
}
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'This scenario uses owned fixtures on the local stack.')

test('recovery · partly done: 20 minutes logged, a 25-minute continuation owed once, each session’s minutes kept', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(page, owned)
    const first = (await blocks(S.id)).filter(b => b.duration_minutes === 45 && b.task_type === 'study')
    expect(first.length).toBeGreaterThan(1)
    const part = first[0]
    await logMinutes(page, part.id, 'Partly done', 20)
    await shiftStudentTimeline(S.id, 1, owned)   // the week has ended, so its review is open

    await page.goto('/app/review-week')
    const groups = page.getByRole('radiogroup', { name: /^What happened with / })
    let kept = false
    for (let i = 0; i < await groups.count(); i++) {
      const g = groups.nth(i), name = (await g.getAttribute('aria-label'))!.replace('What happened with ', '')
      const mine = name === part.title
      await g.getByText(mine ? 'Partly done' : 'Not done', { exact: true }).click()
      const next = page.getByRole('radiogroup', { name: /^What next for / }).nth(i)
      const keep = mine || (!kept && name === first[1].title)
      if (keep && !mine) kept = true
      await next.getByText(keep ? 'Continue next week' : 'Remove from the plan', { exact: true }).click()
    }
    await expect(page.getByText('20 min logged of 45. If you are not sure, 25 min is carried as PrepPlan’s estimate.')).toBeVisible()
    const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
    if (await ack.isVisible()) await ack.check()
    await page.getByRole('button', { name: 'Preview next week' }).click()
    await expect(page.getByTestId('recovery-why')).toContainText('20 min already logged')
    await accept(page)

    const next = (await db.from('plan_blocks').select('id, duration_minutes, estimate_provisional, continued_from_task_id, execution').eq('user_id', S.id).eq('continued_from_task_id', part.id).throwOnError()).data!
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ duration_minutes: 25, estimate_provisional: true, execution: 'not_started' })
    expect(await minutesLogged(S.id, part.id)).toBe(20)
    const owed = await surfaces(page)
    agree(owed)
    // 25 (this chain) + 45 (the other carried task) = 70 minutes, counted once; the 20 logged stay logged.
    expect(owed.home.numbers).toContain('1.2 h to catch up')
    expect(owed.home.numbers).toContain('20 min already logged')
    expect(owed.home.numbers).toContain('25 min is PrepPlan’s estimate')

    await logMinutes(page, next[0].id, 'Finished it', 25)
    expect([await minutesLogged(S.id, part.id), await minutesLogged(S.id, next[0].id)]).toEqual([20, 25])
    const after = await surfaces(page)
    agree(after)
    expect(after.home.numbers).toContain('0.8 h to catch up')   // only the other carried task is still owed
    oneChild(await blocks(S.id))
  } finally {
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})

test('recovery · add time: extra windows are reviewed, a stale draft is refused, and a lost reply saves once', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(page, owned)
    await shiftStudentTimeline(S.id, 1, owned)   // the week has ended; the proposed week is what is left of the current one
    // Almost no recurring room, so the carried work waits unless time is added.
    await db.from('availability_windows').update({ start_time: '06:00', end_time: '06:10' }).eq('user_id', S.id).throwOnError()
    const windowsBefore = (await db.from('availability_windows').select('id, weekday, start_time, end_time, status').eq('user_id', S.id).order('id').throwOnError()).data
    const before = await accepted(S.id)
    await reviewPreview(page)
    const panel = page.getByTestId('extra-time')
    await expect(panel.getByTestId('extra-time-waiting')).toContainText('Still waiting:')
    await expect(panel.getByTestId('extra-time-impact')).toContainText('of carried work still waits')
    await expect(panel.getByTestId('extra-time-impact')).toContainText(/Revision:/)
    await expect(panel.getByTestId('extra-time-impact')).toContainText(/Mocks:/)

    const date = laterDay(await offeredDays(page))!
    test.skip(!date, 'No day after today is left in the proposed week (a Sunday run).')
    await db.from('calendar_commitments').insert({ user_id: S.id, label: 'Lunch with family', kind: 'personal', recurrence: 'none', starts_at: `${date}T12:00:00Z`, ends_at: `${date}T13:00:00Z`, is_protected: true, status: 'active', source: 'student' }).throwOnError()
    const add = async (from: string, to: string) => { await panel.getByLabel('Day').selectOption(date); await panel.getByLabel('From', { exact: true }).fill(from); await panel.getByLabel('To', { exact: true }).fill(to); await panel.getByRole('button', { name: 'Add this window' }).click() }
    // Over booked time: refused by name, and the draft is unchanged.
    await add('12:15', '12:45')
    await expect(page.getByRole('alert').filter({ hasText: '“Lunch with family” is already at that time' })).toBeVisible()
    await expect(panel.getByTestId('extra-time-windows')).toHaveCount(0)

    await add('19:00', '20:30')
    const listed = panel.getByTestId('extra-time-windows')
    await expect(listed).toContainText('45 min at 19:00')
    const times = [...(await listed.innerText()).matchAll(/min at (\d\d:\d\d)/g)].map(m => m[1])
    expect(times.length).toBeGreaterThan(1)
    expect(times[1]).toBe('19:45')   // sittings follow one another inside the window
    await noHorizontalOverflow(page)
    expect(await accepted(S.id)).toEqual(before)

    // Stale: something is booked over the window after the draft was prepared. Saving is refused and writes nothing.
    const { data: booked } = await db.from('calendar_commitments').insert({ user_id: S.id, label: 'Dentist', kind: 'personal', recurrence: 'none', starts_at: `${date}T19:15:00Z`, ends_at: `${date}T20:00:00Z`, is_protected: true, status: 'active', source: 'student' }).select('id').single().throwOnError()
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Your week changed' })).toBeVisible()
    expect(await accepted(S.id)).toEqual(before)
    await db.from('calendar_commitments').delete().eq('id', booked!.id).throwOnError()

    // Lost reply: the save commits but the response never arrives. Saving again confirms it, once.
    await reviewPreview(page)
    await add('19:00', '20:30')
    await expect(listed).toContainText('45 min at 19:00')
    let lost = 0
    await page.route('**/api/weekly-review/accept', async r => { if (lost++ > 0) return r.continue(); await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Save not confirmed' })).toBeVisible()
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await page.waitForURL(/\/app\/calendar/)
    await page.unroute('**/api/weekly-review/accept')

    const saved = (await db.from('plan_blocks').select('starts_at, placement, duration_minutes, local_date, continued_from_task_id').eq('user_id', S.id).eq('local_date', date).eq('placement', 'timed').not('continued_from_task_id', 'is', null).order('starts_at').throwOnError()).data!
    expect(saved.map(b => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' }).format(new Date(b.starts_at as string)))).toEqual(times)
    oneChild(await blocks(S.id))
    expect((await db.from('weekly_reviews').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count).toBe(1)
    const { data: receipt } = await db.from('weekly_reviews').select('recap').eq('user_id', S.id).single().throwOnError()
    expect((receipt!.recap as { extraWindows: unknown[] }).extraWindows).toEqual([{ date, start: 1140, end: 1230 }])
    expect((await db.from('availability_windows').select('id, weekday, start_time, end_time, status').eq('user_id', S.id).order('id').throwOnError()).data).toEqual(windowsBefore)
  } finally {
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})

/** Closes the ended week keeping only the named tasks; everything else is removed from the plan. */
async function reviewKeeping(page: Page, keep: string[]) {
  await page.goto('/app/review-week')
  const groups = page.getByRole('radiogroup', { name: /^What happened with / })
  await expect(groups.first()).toBeVisible()
  const kept = new Set<string>()
  for (let i = 0; i < await groups.count(); i++) {
    const g = groups.nth(i), name = (await g.getAttribute('aria-label'))!.replace('What happened with ', '')
    await g.getByText('Not done', { exact: true }).click()
    const mine = keep.includes(name) && !kept.has(name)
    if (mine) kept.add(name)
    await page.getByRole('radiogroup', { name: /^What next for / }).nth(i).getByText(mine ? 'Continue next week' : 'Remove from the plan', { exact: true }).click()
  }
  const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
  if (await ack.isVisible()) await ack.check()
  await page.getByRole('button', { name: 'Preview next week' }).click()
  await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()
}
const london = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())
const weekdayNumber = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
/** A day of the proposed week after today, as the panel offers it: study days (not Sunday) when asked. Undefined when the week has none left. */
const laterDay = (offered: string[], studyOnly = false) => offered.find(d => d > london() && (!studyOnly || weekdayNumber(d) !== 0))
const offeredDays = (page: Page) => page.getByTestId('extra-time').getByLabel('Day').locator('option').evaluateAll(o => o.map(x => (x as HTMLOptionElement).value))
async function addWindow(page: Page, date: string, from: string, to: string) {
  const panel = page.getByTestId('extra-time')
  await panel.getByLabel('Day').selectOption(date); await panel.getByLabel('From', { exact: true }).fill(from); await panel.getByLabel('To', { exact: true }).fill(to)
  await panel.getByRole('button', { name: 'Add this window' }).click()
}

test('recovery · long carried work: ordered sittings with history and remainder kept; a check stays whole', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(page, owned)
    const study = (await blocks(S.id)).find(b => b.duration_minutes === 45 && b.task_type === 'study')!
    const { data: source } = await db.from('plan_blocks').select('*').eq('id', study.id).single().throwOnError()
    const checkId = `p5-check-${RUN}`
    await db.from('plan_blocks').insert({ id: checkId, user_id: S.id, cycle_id: source!.cycle_id, title: 'Scored re-check probe', detail: 'Owned fixture', task_type: 'verification', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: source!.local_date, day: source!.day, duration: '40', duration_minutes: 40 }).throwOnError()
    await db.from('profiles').update({ max_session_minutes: 20 }).eq('id', S.id).throwOnError()
    await shiftStudentTimeline(S.id, 1, owned)   // the week has ended; the proposed week is what is left of the current one
    // One short evening on one remaining study day, so only part of the carried reading fits.
    const today = london()
    const studyDay = Array.from({ length: 6 }, (_, i) => addDays(today, i + 1)).find(d => weekdayNumber(d) !== 0 && weekdayNumber(d) > weekdayNumber(today) && weekdayNumber(today) !== 0)
    test.skip(!studyDay, 'No study day is left in the current week (a Saturday or Sunday run).')
    await db.from('availability_windows').delete().eq('user_id', S.id).neq('weekday', weekdayNumber(studyDay!)).throwOnError()
    await db.from('availability_windows').update({ start_time: '18:30', end_time: '18:50' }).eq('user_id', S.id).throwOnError()
    const before = await accepted(S.id)
    await reviewKeeping(page, [study.title, 'Scored re-check probe'])
    const continuing = page.locator('.review-continuing > li')
    const longRow = continuing.filter({ hasText: study.title })
    await expect(longRow.getByTestId('review-sittings')).toContainText(/waiting/)
    const checkRow = continuing.filter({ hasText: 'Scored re-check probe' })
    await expect(checkRow).toContainText(/done in one sitting, so it needs a single 40-minute opening, longer than your 20-minute study sitting/)
    await expect(checkRow.getByTestId('review-sittings')).toHaveCount(0)

    const date = laterDay(await offeredDays(page))!
    await addWindow(page, date, '19:00', '20:30')
    const listed = page.getByTestId('extra-time').getByTestId('extra-time-windows')
    await expect(listed).toContainText('Scored re-check probe, 40 min at')
    await expect(longRow.getByTestId('review-sittings')).toContainText('in the window you added')
    expect(await accepted(S.id)).toEqual(before)
    await noHorizontalOverflow(page)
    await accept(page)

    const rows = (await db.from('plan_blocks').select('id, title, task_type, duration_minutes, placement, local_date, continued_from_task_id, scope_group_id, dependencies, execution, starts_at, cycle_id').eq('user_id', S.id).neq('cycle_id', source!.cycle_id).throwOnError()).data!
    const first = rows.filter(r => r.continued_from_task_id === study.id)
    expect(first).toHaveLength(1)
    expect(first[0].scope_group_id).not.toBeNull()
    const parts = rows.filter(r => r.scope_group_id === first[0].scope_group_id)
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.reduce((n, r) => n + r.duration_minutes, 0)).toBe(45)
    expect(parts.every(r => r.duration_minutes <= 20 && r.duration_minutes >= 5)).toBe(true)
    // Declared order: each sitting follows exactly the one before, starting from the continuation.
    let previous = first[0].id, seen = 1
    for (;;) { const next = parts.find(r => (r.dependencies as string[] | null)?.[0] === previous); if (!next) break; expect(next.continued_from_task_id).toBeNull(); previous = next.id; seen++ }
    expect(seen).toBe(parts.length)
    const check = rows.filter(r => r.continued_from_task_id === checkId)
    expect(check).toHaveLength(1)
    expect(check[0]).toMatchObject({ duration_minutes: 40, placement: 'timed', scope_group_id: null })
    // The original keeps its record; it is history now.
    expect((await db.from('plan_blocks').select('duration_minutes, execution, title').eq('id', study.id).single().throwOnError()).data).toMatchObject({ duration_minutes: 45, execution: 'deferred', title: study.title })
    // 45 + 40 minutes are still owed, once, whether or not a sitting has a continuation link of its own.
    await page.goto('/app')
    await expect(page.getByTestId('recovery-numbers')).toContainText('1.4 h to catch up')
  } finally {
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})

test('recovery · leftover added time goes to new work after the carried work: named, optional, and can be turned off', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const S = await student(page, owned)
    const study = (await blocks(S.id)).find(b => b.duration_minutes === 45 && b.task_type === 'study')!
    await shiftStudentTimeline(S.id, 1, owned)   // the week has ended; the proposed week is what is left of the current one
    await db.from('availability_windows').update({ start_time: '06:00', end_time: '06:10' }).eq('user_id', S.id).throwOnError()
    const windowsBefore = (await db.from('availability_windows').select('id, weekday, start_time, end_time').eq('user_id', S.id).order('id').throwOnError()).data
    const before = await accepted(S.id)
    await reviewKeeping(page, [study.title])
    const date = laterDay(await offeredDays(page))!
    test.skip(!date, 'No day after today is left in the proposed week (a Sunday run).')
    await addWindow(page, date, '19:00', '22:00')
    const panel = page.getByTestId('extra-time'), listed = panel.getByTestId('extra-time-windows')
    // With almost no regular time the Roadmap advises starting mocks, so the order is: carried work, then the mock. Keeping broad revision frees the rest.
    await expect(listed).toContainText(`${study.title}, 45 min at 19:00; Mock sitting, 135 min at 19:45`)
    await page.getByRole('button', { name: 'Keep broad revision this week instead' }).click()
    // The carried work takes the first minutes; new work follows it, named and marked optional.
    await expect(listed).toContainText(`${study.title}, 45 min at 19:00`)
    await expect(listed).toContainText(/New, optional: (Study|Revise|Recall): .+?, \d+ min at 19:45/)
    await expect(panel.getByTestId('extra-time-waiting')).toContainText(/New study: /)
    await noHorizontalOverflow(page)
    const box = panel.getByRole('checkbox', { name: /offer leftover time to new study or revision/ })
    await box.click()
    await expect(listed).not.toContainText('New, optional:')
    await expect(listed).toContainText(`${study.title}, 45 min at 19:00`)
    await box.click()
    await expect(listed).toContainText('New, optional:')
    expect(await accepted(S.id)).toEqual(before)
    await accept(page)

    const saved = (await db.from('plan_blocks').select('title, priority, placement, starts_at, duration_minutes, continued_from_task_id').eq('user_id', S.id).eq('local_date', date).eq('placement', 'timed').order('starts_at').throwOnError()).data!
    expect(saved[0].continued_from_task_id).toBe(study.id)
    const fresh = saved.filter(r => !r.continued_from_task_id)
    expect(fresh.length).toBeGreaterThan(0)
    expect(fresh.every(r => r.priority === 'optional')).toBe(true)
    for (let i = 1; i < saved.length; i++) expect(new Date(saved[i].starts_at as string).getTime()).toBeGreaterThanOrEqual(new Date(saved[i - 1].starts_at as string).getTime() + saved[i - 1].duration_minutes * 60_000)
    expect((await db.from('availability_windows').select('id, weekday, start_time, end_time').eq('user_id', S.id).order('id').throwOnError()).data).toEqual(windowsBefore)
  } finally {
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})

test('recovery · two students with the same weekly hours: only the one with usable slots is told they can still catch up', async ({ page, browser }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  await acquireBankLock()
  try {
    const A = await createStudent(db, `usableA${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
    const B = await createStudent(db, `usableB${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
    for (const S of [A, B]) await shiftStudentTimeline(S.id, 1, owned)
    // B states the same study windows as A, but protected commitments leave ten usable minutes in each.
    const protect = (weekdays: number[], start_time: string, end_time: string) => ({ user_id: B.id, label: 'Evening shift', kind: 'work', recurrence: 'weekly', weekdays, start_time, end_time, starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), is_protected: true, status: 'active', source: 'student' })
    await db.from('calendar_commitments').insert([protect([1, 2, 3, 4, 5], '18:40', '21:30'), protect([0, 6], '09:10', '13:00')]).throwOnError()
    const hoursStated = async (uid: string) => (await db.from('availability_windows').select('weekday, start_time, end_time').eq('user_id', uid).order('weekday').order('start_time').throwOnError()).data
    expect(await hoursStated(B.id)).toEqual(await hoursStated(A.id))

    await login(page, db, A.email, '/app')
    const a = await surfaces(page)
    expect(a.home.level).toBe('catching_up'); agree(a)
    await page.goto('/app')
    await expect(page.getByTestId('recovery-numbers')).toContainText(/fits your usable time by week \d+/)
    await noHorizontalOverflow(page)

    const context = await browser.newContext({ viewport: page.viewportSize()! })
    const other = await context.newPage()
    other.on('pageerror', e => { throw e })
    try {
      await login(other, db, B.email, '/app')
      const b = await surfaces(other)
      expect(b.home.level).toBe('recovery_offered'); agree(b)
      await other.goto('/app')
      await expect(other.getByTestId('recovery-numbers')).toContainText(/h of it does not fit your usable time before mocks/)
      await reviewPreview(other)
      await expect(other.getByTestId('recovery-why')).toContainText(/Your usable study time before the 2 weeks kept for mocks is 0 h/)
      await expect(other.getByTestId('recovery-paths').locator('[data-path="steady"]')).toContainText('This does not fit')
      await noHorizontalOverflow(other)
    } finally { await context.close() }
  } finally {
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})
