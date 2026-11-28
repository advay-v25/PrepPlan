import { expect, test, type Page } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { addDays, admin, destroyBank, login, makeBank, noHorizontalOverflow, RUN, removeStudent } from './helpers'
import { todayInZone } from '../../../src/lib/planning/studyWeek'

/**
 * Phase 5 · the Roadmap's mock recommendation, three cases, desktop and 390 px.
 * Each student is run-owned. Coverage is seeded; the evidence is real: one reading is logged and a narrow weekly paper is scored on the registered synthetic
 * bank (one wrong answer where a repair gap is wanted). The recommendation must agree on the Roadmap, in the Weekly Review proposal and in Coach, and no accepted row may
 * change until the student saves.
 */
const CASES = [
  { key: 'clean transition', exam: 84, covered: 1, repairs: 0, verdict: 'ready', adds: true },
  { key: 'more broad revision needed', exam: 140, covered: 0.6, repairs: 1, verdict: 'more_revision', adds: false },
  { key: 'time pressure with open gaps', exam: 18, covered: 0.6, repairs: 1, verdict: 'start_with_gaps', adds: true },
] as const

const readingId = 'r028'
async function scorePaper(page: Page, db: ReturnType<typeof admin>, attemptId: string, firstWrong: boolean) {
  const { data: form } = await db.from('assessment_attempts').select('form_id').eq('id', attemptId).single().throwOnError()
  const { data: items } = await db.from('form_items').select('sequence_number, item:assessment_items(stem,key_index)').eq('form_id', form!.form_id).order('sequence_number').throwOnError()
  expect(items!.length).toBeGreaterThan(0)
  for (let i = 0; i < items!.length; i++) {
    const item = items![i].item as unknown as { stem: string; key_index: number }
    await expect(page.locator('#q-h')).toHaveText(item.stem)
    const choices = page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio')
    await choices.nth(firstWrong && i === 0 ? (item.key_index + 1) % await choices.count() : item.key_index).click()
    await page.getByRole('radio', { name: 'Sure', exact: true }).click()
    if (i < items!.length - 1) await page.getByRole('button', { name: /^Next/ }).click()
  }
  await page.getByRole('button', { name: /^Review/ }).click()
  await page.getByRole('button', { name: 'Submit for scoring' }).click()
  await page.waitForURL(/\/result$/)
}

const snapshot = async (db: ReturnType<typeof admin>, uid: string) =>
  (await db.from('plan_blocks').select('id, execution, local_date, revision, duration_minutes, title').eq('user_id', uid).order('id').throwOnError()).data

async function buildPreview(page: Page, extra?: () => Promise<void>) {
  await page.goto('/app/review-week')
  for (const group of await page.getByRole('radiogroup', { name: /^What happened with / }).all()) await group.getByText('Not done', { exact: true }).click()
  for (const group of await page.getByRole('radiogroup', { name: /^What next for / }).all()) await group.getByText('Keep for later', { exact: true }).click()
  const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
  if (await ack.isVisible()) await ack.check()
  for (const report of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await report.check()
  await extra?.()
  await page.getByRole('button', { name: 'Preview next week' }).click()
  await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()
}

for (const c of CASES) {
  test(`mock transition · ${c.key}`, async ({ page }) => {
    test.skip(process.env.E2E_SUITE !== 'local-stack', 'This scenario seeds owned coverage and evidence on the local stack.')
    test.setTimeout(240_000)
    const db = admin(), owned: string[] = []
    let bank: Awaited<ReturnType<typeof makeBank>> | null = null
    const errors: string[] = []
    page.on('pageerror', e => errors.push(e.message))
    try {
      const student = await createStudent(db, `mocktrans${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
      await db.from('profiles').update({ registered: true, exam_date: addDays(todayInZone('Europe/London'), c.exam) }).eq('id', student.id).throwOnError()

      // Coverage: the first `covered` share of modules reported as studied; the rest stay not started.
      const { data: modules } = await db.from('learning_modules').select('id').eq('is_active', true).order('sequence_hint').throwOnError()
      const coveredIds = modules!.slice(0, Math.ceil(modules!.length * c.covered)).map(m => m.id as string)
      await db.from('user_module_state').upsert(coveredIds.map(lm_id => ({ user_id: student.id, lm_id, coverage_state: 'studied', source: 'self_report' })), { onConflict: 'user_id,lm_id' }).throwOnError()

      // Real evidence: log one reading, then score a narrow weekly paper on it.
      await login(page, db, student.email, `/app/log?reading=${readingId}`)
      await page.getByRole('button', { name: /^Select all/ }).click()
      await page.getByRole('button', { name: '45m', exact: true }).click()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Session logged.' })).toBeVisible()
      bank = await makeBank([readingId])
      await page.goto('/app/tests')
      await page.getByRole('button', { name: /^Review and start/ }).click()
      await page.getByRole('button', { name: 'Start weekly paper', exact: true }).click()
      await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
      await scorePaper(page, db, new URL(page.url()).pathname.split('/').at(-1)!, c.repairs > 0)

      await page.goto('/app/curriculum?view=roadmap')
      const card = page.getByTestId('mock-transition')
      await expect(card).toHaveAttribute('data-verdict', c.verdict)
      await expect(page.getByText('Ready for mocks.', { exact: true })).toBeVisible()
      await expect(page.getByText('Ready for exam day.', { exact: true })).toBeVisible()
      const changes = page.getByTestId('mock-transition-proposal')
      if (c.adds) { await expect(changes).toContainText('Mock sitting, 2 h 15 min'); await expect(changes).toContainText('Debrief the mock'); await expect(changes).toContainText('Follow up on what it found, 1 h') }
      else { await expect(changes).toContainText('No mock is added yet'); await expect(changes).toContainText('Keeps: broad revision') }
      if (c.repairs) {
        const gaps = page.getByTestId('mock-transition-gaps')
        await expect(gaps).toContainText('Recorded finding')
        expect(await gaps.getByRole('link').count()).toBeGreaterThan(0)
        await expect(gaps.getByRole('link').first()).toHaveAttribute('href', /\/app\/curriculum\/[^/]+\/[^/?#]+/)
      }
      if (c.verdict === 'start_with_gaps') await expect(card).toContainText(/Why not wait/)
      await expect(card).toContainText('Your accepted work does not change until you review the proposal and accept it')
      await expect(page.getByTestId('mock-transition-tradeoff')).not.toBeEmpty()
      // The synthetic bank is far too small for a linked two-session mock, so a recommended mock offers the external route, labelled self-reported.
      if (c.adds) await expect(page.getByTestId('mock-transition-external')).toContainText('self-reported')
      else await expect(page.getByTestId('mock-transition-external')).toHaveCount(0)
      await expect(card).not.toContainText(/founder|not fixed|provisional/i)
      if (c.verdict === 'more_revision') await expect(card).toContainText(/can be finished before the 2-week runway for mock prep: .+/)
      if (c.verdict === 'start_with_gaps') await expect(card).toContainText(/too little time for a mock, its debrief and the follow-up/)
      if (c.verdict === 'more_revision') await expect(page.getByTestId('mock-transition-work').getByRole('link').first()).toHaveAttribute('href', /\/app\/curriculum\/[^/]+\/[^/?#]+/)
      if (c.verdict === 'more_revision') expect((await page.request.get((await page.getByTestId('mock-transition-work').getByRole('link').first().getAttribute('href'))!)).status(), 'the named work opens').toBe(200)
      await noHorizontalOverflow(page)

      // Before: the accepted rows. The review's preview must leave every one of them untouched.
      const before = await snapshot(db, student.id)
      await buildPreview(page)
      const proposal = page.getByTestId('mock-proposal')
      await expect(proposal).toHaveAttribute('data-verdict', c.verdict)
      expect(await snapshot(db, student.id)).toEqual(before)
      const changesList = page.getByTestId('mock-proposal-changes')
      if (c.adds) {
        await expect(changesList).toContainText('Adds: Mock sitting, 135 min')
        await expect(changesList).toContainText('Adds: Debrief the mock, 45 min')
        // A 60-minute follow-up under a 45-minute sitting limit is split, never shortened.
        await expect(changesList).toContainText('Follow up on what it found, part 1 of 2, 30 min')
        await expect(changesList).toContainText('Follow up on what it found, part 2 of 2, 30 min')
        await expect(page.getByRole('heading', { name: /^Planned for/ })).toBeVisible()
        await expect(page.getByText('Mock sitting', { exact: false }).first()).toBeVisible()
      } else {
        await expect(changesList).not.toContainText('Adds:')
        await expect(changesList).toContainText('Keeps: broad revision')
        await expect(changesList).toContainText('Waits: Mock sitting')
        // The named work the planner can finish before the runway, with its week.
        const work = page.getByTestId('mock-proposal-work')
        await expect(work).toContainText(/Finish before the mock \((this proposed week|forecast: week \d+)\):/)
        await expect(work).toContainText(/Forecast, week 2 from \d{4}-\d\d-\d\d: [\d.]+ h usable/)
        await expect(work.getByRole('link').first()).toHaveAttribute('href', /\/app\/curriculum\/[^/]+\/[^/?#]+/)
        await expect(page.getByTestId('mock-estimates')).toHaveCount(0)
      }
      if (c.repairs) await expect(page.getByTestId('mock-proposal-gaps')).toContainText('Recorded finding')
      await noHorizontalOverflow(page)

      if (c.adds) {
        // The student can keep broad revision instead; the mock leaves the draft and nothing else is written.
        await page.getByRole('button', { name: 'Keep broad revision this week instead' }).click()
        await expect(proposal).toHaveAttribute('data-declined', 'true')
        await expect(changesList).toContainText('You kept broad revision this week')
        await expect(changesList).not.toContainText('Adds: Mock sitting')
        expect(await snapshot(db, student.id)).toEqual(before)
        await page.getByRole('button', { name: 'Use the recommended mock week' }).click()
        await expect(changesList).toContainText('Adds: Mock sitting, 135 min')
      }

      // Coach reads the Roadmap's judgment and links the action; it does not make its own.
      await page.goto('/app/coach')
      const box = page.getByRole('textbox', { name: 'Ask the coach' })
      await box.fill('Am I ready to start mocks?')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(page.getByText(/Your Roadmap says:/)).toBeVisible()
      await expect(page.getByRole('link', { name: 'Review the proposed week' })).toHaveAttribute('href', '/app/review-week')
      await expect(page.getByRole('link', { name: 'See the Roadmap recommendation' })).toHaveAttribute('href', '/app/curriculum?view=roadmap')

      if (c.adds) {
        // The student edits both estimates: the draft shows at once what fits and splits, and nothing is written.
        await buildPreview(page)
        const fields = page.getByTestId('mock-estimates')
        await expect(fields.getByLabel('Debrief')).toHaveValue('45')
        await expect(fields.getByLabel('Follow-up')).toHaveValue('60')
        await fields.getByLabel('Debrief').fill('90')
        await fields.getByLabel('Follow-up').fill('120')
        await fields.getByRole('button', { name: 'Update draft' }).click()
        await expect(changesList).toContainText('Debrief the mock, part 1 of 2, 45 min')
        await expect(changesList).toContainText('Follow up on what it found, part 3 of 3, 40 min')
        expect(await snapshot(db, student.id)).toEqual(before)
        await noHorizontalOverflow(page)

        // Saving is the only step that changes accepted work, and the estimates are saved with it.
        await page.getByRole('button', { name: 'Save review and open next week' }).click()
        await page.waitForURL(/\/app\/calendar/)
        const after = (await db.from('plan_blocks').select('title, task_type, placement, duration_minutes, local_date, execution').eq('user_id', student.id).is('cancelled_at', null).or('title.eq.Mock sitting,title.like.Debrief the mock%,title.like.Follow up on what the mock found%').order('local_date').throwOnError()).data!
        const sum = (t: string) => after.filter(r => r.title.startsWith(t)).reduce((n, r) => n + r.duration_minutes, 0)
        expect(after.find(r => r.title === 'Mock sitting')).toMatchObject({ task_type: 'other', placement: 'timed', duration_minutes: 135, execution: 'not_started' })
        expect(sum('Debrief the mock')).toBe(90)
        expect(sum('Follow up on what the mock found')).toBe(120)
        const { data: receipt } = await db.from('weekly_reviews').select('recap').eq('user_id', student.id).order('created_at', { ascending: false }).limit(1).single().throwOnError()
        expect((receipt!.recap as { mock: { estimates: unknown } }).mock.estimates).toEqual({ debrief: 90, followUp: 120 })
        // The recommendation now starts from the saved estimates, and reading it rewrites nothing that was accepted.
        const accepted = await snapshot(db, student.id)
        await page.goto('/app/curriculum?view=roadmap')
        const saved = page.getByTestId('mock-transition-proposal')
        await expect(saved).toContainText('Debrief the mock, 1 h 30 min')
        await expect(saved).toContainText('Follow up on what it found, 2 h')
        expect(await snapshot(db, student.id)).toEqual(accepted)
      }
      expect(errors).toEqual([])
    } finally {
      if (bank) destroyBank(bank.file)
      for (const id of owned) await removeStudent(db, id)
    }
  })
}

test('mock transition · the weekly total looks sufficient but the usable time cannot fit the revision', async ({ page }) => {
  test.skip(process.env.E2E_SUITE !== 'local-stack', 'This scenario seeds owned coverage on the local stack.')
  test.setTimeout(240_000)
  const db = admin(), owned: string[] = []
  try {
    const student = await createStudent(db, `mockroom${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
    await db.from('profiles').update({ registered: true, exam_date: addDays(todayInZone('Europe/London'), 56) }).eq('id', student.id).throwOnError()
    const { data: modules } = await db.from('learning_modules').select('id').eq('is_active', true).order('sequence_hint').throwOnError()
    await db.from('user_module_state').upsert(modules!.slice(0, Math.ceil(modules!.length * 0.6)).map(m => ({ user_id: student.id, lm_id: m.id as string, coverage_state: 'studied', source: 'self_report' })), { onConflict: 'user_id,lm_id' }).throwOnError()
    await login(page, db, student.email, '/app/curriculum?view=roadmap')
    const card = page.getByTestId('mock-transition')
    await expect(card).toHaveAttribute('data-verdict', 'more_revision')
    await expect(page.getByTestId('mock-transition-work')).toContainText(/Finish before the mock/)
    await expect(page.getByTestId('mock-transition-work')).toContainText(/Forecast, week 2/)

    // The stated study windows stay the same, so the weekly total does not change; protected commitments now leave ten minutes a day.
    const protect = (weekdays: number[], start_time: string, end_time: string) => ({ user_id: student.id, label: 'Evening shift', kind: 'work', recurrence: 'weekly', weekdays, start_time, end_time, starts_at: new Date().toISOString(), ends_at: new Date().toISOString(), is_protected: true, status: 'active', source: 'student' })
    await db.from('calendar_commitments').insert([protect([1, 2, 3, 4, 5], '18:40', '21:30'), protect([0, 6], '09:10', '13:00')]).throwOnError()
    await page.reload()
    await expect(card).toHaveAttribute('data-verdict', 'start_with_gaps')
    await expect(card).toContainText(/Your weekly study time adds up to [\d.]+ h before the runway, but after commitments, booked and accepted work.* 0 h is usable/)
    await expect(page.getByTestId('mock-transition-work')).toContainText(/Forecast, week 2 from \d{4}-\d\d-\d\d: 0 h usable/)
    await expect(page.getByTestId('mock-transition-work')).not.toContainText('Finish before the mock')
    await noHorizontalOverflow(page)
  } finally {
    for (const id of owned) await removeStudent(db, id)
  }
})
