import { expect, test, type Page } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { addDays, admin, destroyBank, login, makeBank, noHorizontalOverflow, RUN, removeStudent } from './helpers'
import { todayInZone } from '../../../src/lib/planning/studyWeek'

const roadmap = '/app/curriculum?view=roadmap'
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

for (const [mode, hasBank] of [['self-study', true], ['class-led', true], ['empty bank', false], ['mock prep, no fresh re-check', true], ['mock prep, fresh re-check', true]] as const) {
  test(`${mode}: logged chapter, dated evidence and feasible recall`, async ({ page }) => {
    test.skip(process.env.E2E_SUITE !== 'local-stack', 'This scenario uses owned timeline fixtures on the local stack.')
    test.setTimeout(180_000)
    const db = admin(), owned: string[] = []
    const mockPrep = mode.startsWith('mock prep')
    const noFreshCheck = mode === 'mock prep, no fresh re-check'
    let bank: Awaited<ReturnType<typeof makeBank>> | null = null
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
      const student = await createStudent(db, `position${RUN}`, {
        onboard: true, register: id => owned.push(id),
        onboarding: { ...FRESH_STUDENT_ONBOARDING, ...(mode === 'class-led' ? { classes: [{ weekday: 2 }, { weekday: 4 }] } : {}) },
      })
      if (mockPrep) {
        // Own fixture: bring the booked target within the planner's existing final phase.
        await db.from('profiles').update({ registered: true, exam_date: addDays(todayInZone('Europe/London'), 38) }).eq('id', student.id).throwOnError()
      }
      const { data: reading } = await db.from('curriculum_readings').select('title').eq('id', readingId).single().throwOnError()
      await login(page, db, student.email, '/app')
      await page.getByRole('link', { name: /Full roadmap|Review it/ }).click()
      await expect(page.getByRole('heading', { name: 'Where you stand' })).toBeVisible()
      await expect(page.getByText('Ready for mocks.', { exact: true })).toBeVisible()
      await expect(page.getByText('Ready for exam day.', { exact: true })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Open Calendar', exact: true }).first()).toBeVisible()
      await noHorizontalOverflow(page)

      await page.goto(`/app/log?reading=${readingId}`)
      await page.getByRole('button', { name: /^Select all/ }).click()
      await page.getByRole('button', { name: '45m', exact: true }).click()
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Session logged.' })).toBeVisible()

      if (hasBank) bank = await makeBank([readingId])
      else await acquireBankLock()
      await page.goto(hasBank ? '/app/tests' : `/app/tests?view=practice&reading=${readingId}`)
      await page.getByRole('button', { name: hasBank ? /^Review and start/ : 'Review this check' }).click()
      let attemptId: string | null = null
      if (hasBank) {
        await page.getByRole('button', { name: 'Start weekly paper', exact: true }).click()
        await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
        attemptId = new URL(page.url()).pathname.split('/').at(-1)!
        await scorePaper(page, db, attemptId, mockPrep)
      } else {
        await expect(page.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)
        await expect(page.locator('.preflight__result')).toContainText(/approved|reviewed|questions/i)
      }

      // Rebase only this fixture's recorded dates. The score and item versions stay intact.
      await shiftStudentTimeline(student.id, 5, owned)
      await page.goto(roadmap)
      if (attemptId) {
        const { data: attempt } = await db.from('assessment_attempts').select('submitted_at,score').eq('id', attemptId).single().throwOnError()
        const result = page.getByRole('link', { name: 'Open scored result', exact: true })
        await expect(result).toHaveAttribute('href', `/app/tests/${attemptId}/result`)
        await expect(page.getByText(/older evidence/)).toBeVisible()
        await result.click()
        await expect(page.locator('header time')).toHaveAttribute('datetime', attempt!.submitted_at)
        await expect(page.getByRole('heading', { name: 'Your result' })).toBeVisible()
      } else {
        await expect(page.getByText(/No valid scored evidence is recorded yet/)).toBeVisible()
      }

      const buildPreview = async () => {
        await page.goto('/app/review-week')
        const groups = page.getByRole('radiogroup', { name: /^What happened with / })
        for (const group of await groups.all()) {
          await group.getByText('Not done', { exact: true }).click()
        }
        for (const group of await page.getByRole('radiogroup', { name: /^What next for / }).all()) {
          await group.getByText('Keep for later', { exact: true }).click()
        }
        const ack = page.getByRole('checkbox', { name: /Close this week without a paper/ })
        if (await ack.isVisible()) await ack.check()
        for (const report of await page.getByRole('checkbox', { name: 'Leave unreported' }).all()) await report.check()
        await page.getByRole('button', { name: 'Preview next week' }).click()
        await expect(page.getByRole('heading', { name: 'Next week, as it will be saved' })).toBeVisible()
      }
      await buildPreview()
      if (mockPrep) {
        const { data: evidence } = await db.from('evidence_events').select('concept_id,concept:curriculum_concepts(name)').eq('attempt_id', attemptId!).eq('is_correct', false).single().throwOnError()
        const name = (evidence!.concept as unknown as { name: string }).name
        await expect(page.getByRole('listitem').filter({ hasText: `Repair: ${name} · 30 min` }).last()).toBeVisible()
        const { data: mapped } = await db.from('concept_outcome_map').select('outcome_id').eq('concept_id', evidence!.concept_id).throwOnError()
        // Exact common link is asserted from the authored tracker view, not by deriving a second finding.
        await page.goto(roadmap)
        await expect(page.getByTestId('mock-transition')).toBeVisible()   // the evidence-based recommendation, not the calendar phase
        await page.getByText(/with a recorded gap/).click()
        const resultLink = page.getByRole('link', { name: 'Supporting result' }).first()
        await expect(resultLink).toHaveAttribute('href', `/app/tests/${attemptId}/result`)
        const row = resultLink.locator('..')
        const curriculum = row.getByRole('link').first()
        const href = (await curriculum.getAttribute('href'))!
        expect(mapped!.some(({ outcome_id }) => href.endsWith(`#los-${outcome_id}`))).toBe(true)
        await curriculum.click()
        await expect(page.getByText('Showing the outcome you came from')).toBeVisible()
        await page.goto(`/app/coach?attempt=${attemptId}`)
        const box = page.getByRole('textbox', { name: 'Ask the coach' })
        await box.fill('What should I do about this result?')
        await page.getByRole('button', { name: 'Send', exact: true }).click()
        await expect(page.getByRole('link', { name: 'Open the outcome in Curriculum' })).toHaveAttribute('href', href)
        await noHorizontalOverflow(page)
        await buildPreview()
        const countEvidence = async () => (await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', student.id).throwOnError()).count
        const before = await countEvidence()
        await page.getByRole('button', { name: 'Save review and open next week' }).click()
        await page.waitForURL(/\/app\/calendar/)
        const { data: task } = await db.from('plan_blocks').select('id,local_date,repair_thread_id').eq('user_id', student.id).eq('title', `Repair: ${name}`).single().throwOnError()
        await page.goto(`/app/calendar?view=agenda&week=${task!.local_date}&task=${task!.id}`)
        const drawer = page.getByRole('dialog')
        await drawer.getByRole('button', { name: 'Done', exact: true }).click()
        await drawer.getByRole('spinbutton', { name: 'Actual minutes' }).fill('25')
        await drawer.getByRole('button', { name: 'Save as done' }).click()
        await expect.poll(async () => (await db.from('repair_threads').select('status').eq('id', task!.repair_thread_id).single().throwOnError()).data!.status).toBe('awaiting_recheck')
        expect(await countEvidence()).toBe(before)
        await page.goto(roadmap)
        await page.getByText(/with a recorded gap/).click()
        await expect(page.getByText(/work recorded, new evidence pending/)).toBeVisible()
        if (noFreshCheck) {
          const original = await db.from('assessment_attempts').select('form_id,score').eq('id', attemptId!).single().throwOnError()
          const pinned = await db.from('form_items').select('item_id').eq('form_id', original.data!.form_id).throwOnError()
          const used = new Set(pinned.data!.map(item => item.item_id))
          // Retire only this registered fixture's unused inventory. The evidence and its original items remain readable.
          await db.from('assessment_items').update({ review_status: 'deprecated' }).in('id', bank!.record.items.filter(id => !used.has(id))).throwOnError()
        }
        await shiftStudentTimeline(student.id, 2, owned)
        await buildPreview()
        await page.getByRole('button', { name: 'Save review and open next week' }).click()
        await page.waitForURL(/\/app\/calendar/)
        await page.goto(`/app/tests/${attemptId}/result`)
        await page.getByRole('button', { name: 'Add the re-check to my calendar' }).click()
        await expect(page.getByText('The re-check is in your calendar.')).toBeVisible()
        const { data: check } = await db.from('plan_blocks').select('id,local_date').eq('task_type', 'recheck').eq('user_id', student.id).single().throwOnError()
        await page.goto(`/app/calendar?view=agenda&week=${check!.local_date}&task=${check!.id}`)
        if (noFreshCheck) {
          await expect(page.getByRole('dialog')).toContainText(/can serve 0 unseen reviewed questions/)
          await expect(page.getByRole('button', { name: 'Start re-check' })).toHaveCount(0)
          expect(await countEvidence()).toBe(before)
          await page.goto(roadmap)
          await page.getByText(/with a recorded gap/).click()
          await expect(page.getByText(/work recorded, new evidence pending/)).toBeVisible()
        } else {
          await page.getByRole('button', { name: 'Start re-check' }).click()
          await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
          const recheckId = new URL(page.url()).pathname.split('/').at(-1)!
          expect(recheckId).not.toBe(attemptId)
          await scorePaper(page, db, recheckId, false)
          expect(await countEvidence()).toBeGreaterThan(before!)
          const tracked = await page.request.get('/api/curriculum/readiness')
          expect(tracked.ok()).toBe(true)
          const { tracker } = await tracked.json()
          const outcomeId = new URL(href, page.url()).searchParams.get('los')
          const row = tracker.topics.flatMap((topic: any) => topic.modules.flatMap((reading: any) => reading.rows)).find((r: any) => r.outcomeId === outcomeId)
          expect(row.lastCheckAttemptId).toBe(recheckId)
        }
        return
      }
      await page.getByRole('button', { name: 'Make this draft lighter' }).click()
      const rotation = page.getByRole('region', { name: 'Revision in the next week' })
      await expect(rotation.locator('li > strong').filter({ hasText: reading!.title })).toBeVisible()
      await noHorizontalOverflow(page)

      // Constrain the future windows without editing any accepted task.
      const { data: before } = await db.from('plan_blocks').select('id, execution, local_date, revision').eq('user_id', student.id).order('id').throwOnError()
      const { data: windows } = await db.from('availability_windows').select('id').eq('user_id', student.id).throwOnError()
      expect(windows!.length).toBeGreaterThan(0)
      await db.from('availability_windows').update({ start_time: '09:00', end_time: '09:10' }).eq('user_id', student.id).throwOnError()
      await buildPreview()
      await rotation.getByText(/Waiting for a later week/).click()
      await expect(rotation.getByText(`${reading!.title} — Due for recall. No usable sitting fitted`, { exact: false })).toBeVisible()
      const { data: after } = await db.from('plan_blocks').select('id, execution, local_date, revision').eq('user_id', student.id).order('id').throwOnError()
      expect(after).toEqual(before)
      expect(errors).toEqual([])
    } finally {
      if (bank) destroyBank(bank.file)
      else releaseBankLock()
      for (const id of owned) await removeStudent(db, id)
    }
  })
}
