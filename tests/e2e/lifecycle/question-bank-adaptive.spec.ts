import { expect, test } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, destroyBank, login, makeBank, noHorizontalOverflow, RUN } from './helpers'
import { scopedErrors } from './scopedErrors'

test('item-by-item practice retries a lost omission receipt and resumes the frozen sequence', async ({ page }) => {
  const db = admin()
  const errors = scopedErrors()
  errors.attach(page)
  const bank = await makeBank(['r032'])
  let owner: string | undefined
  try {
    const student = await createStudent(db, `adaptive${RUN}`, {
      onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => { owner = id },
    })
    await login(page, db, student.email, '/app/tests?view=practice')   // practice lives under its own Tests view
    const practice = page.getByRole('region', { name: 'Choose a check' })
    await practice.getByRole('radio', { name: /Item-by-item adaptive/ }).check()
    await practice.getByRole('combobox', { name: /^Subject/ }).selectOption('fsa')   // the mode radios also mention "subject"
    await practice.getByRole('combobox', { name: /^Reading/ }).selectOption('r032')
    await practice.getByLabel(/Narrow to one outcome/).selectOption('r032-a')
    await practice.getByRole('button', { name: 'Review item-by-item practice' }).click()
    await practice.getByRole('button', { name: 'Start', exact: true }).click()
    await expect(page).toHaveURL(/\/app\/tests\/adaptive\/[0-9a-f-]+$/)
    const runId = new URL(page.url()).pathname.split('/').at(-1)!
    await expect(page.getByRole('region', { name: 'Question 1' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Last committed feedback' })).toHaveCount(0)

    const endpoint = `**/api/tests/adaptive-item/${runId}`
    const submissions: string[] = []
    await errors.expecting([{ label: 'lost response after server commit', url: /\/api\/tests\/adaptive-item\//, failed: true, min: 1, max: 1 }], async () => {
      await page.route(endpoint, async route => {
        submissions.push(route.request().postData() ?? '')
        const response = await route.fetch()
        if (submissions.length === 1) {
          await route.abort('failed')
        } else {
          await route.fulfill({ response })
        }
      })
      await page.getByRole('button', { name: 'Skip (omit)' }).click()
      await expect(page.getByRole('alert').filter({ hasText: 'Connection lost' })).toBeVisible()   // not the route announcer, which is also an alert
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await expect(page.getByRole('region', { name: 'Last committed feedback' })).toContainText('omitted')
      await page.unroute(endpoint)
    })
    expect(submissions).toHaveLength(2)
    expect(submissions[1]).toBe(submissions[0])
    const steps = () => db.from('adaptive_item_steps').select('seq, item_id, tier, committed_outcome').eq('run_id', runId).order('seq').throwOnError()
    const committed = (await steps()).data!
    expect(committed).toHaveLength(2)
    expect(committed[0]).toMatchObject({ seq: 1, tier: 'foundation', committed_outcome: 'omitted' })
    expect(committed[1]).toMatchObject({ seq: 2, tier: 'foundation', committed_outcome: null })
    expect(committed.every(step => bank.record.items.includes(step.item_id))).toBe(true)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Question 2' })).toBeVisible()
    expect((await steps()).data).toEqual(committed)
    await noHorizontalOverflow(page)
    await page.getByRole('button', { name: 'End practice' }).click()
    await expect(page.getByRole('heading', { name: 'Practice ended' })).toBeVisible()
    const { count } = await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', student.id).throwOnError()
    expect(count).toBe(0)
    expect(errors.unexpected).toEqual([])
  } finally {
    try {
      if (owner) {
        await db.from('adaptive_item_runs').delete().eq('user_id', owner).throwOnError()
        const { error } = await db.auth.admin.deleteUser(owner)
        if (error) throw error
      }
    } finally {
      destroyBank(bank.file)
    }
  }
})
