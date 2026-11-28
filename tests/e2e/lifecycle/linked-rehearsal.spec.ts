import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { addDays, admin, bankCli, destroyBank, login, noHorizontalOverflow, RUN, J, removeStudent } from './helpers'

test('both rehearsal clocks start separately and two scored sessions produce one result', async ({ page }) => {
  test.skip(process.env.E2E_SUITE !== 'local-stack', 'The rehearsal fixture bank is local-only in this spec.')
  const db = admin()
  const dir = mkdtempSync(join(tmpdir(), 'p4-rehearsal-'))
  const bank = join(dir, 'bank.json')
  let studentId: string | undefined
  await acquireBankLock()
  try {
    execFileSync('node', bankCli('create', [`--out=${bank}`, '--rehearsal=auto']), { stdio: 'inherit' })
    const s = await createStudent(db, `p4rehearsal${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => { studentId = id } })
    const appointment = await s.s.json('/api/checkpoints', { method: 'POST', headers: J, body: JSON.stringify({
      action: 'add', date: addDays(todayInZone('Europe/London'), 2), kind: 'internal_rehearsal', label: 'Linked rehearsal fixture', key: crypto.randomUUID(),
    }) })
    expect(appointment.body?.ok, JSON.stringify(appointment.body)).toBe(true)
    await login(page, db, s.email, '/app/tests?view=mocks')
    await page.getByRole('button', { name: 'Prepare my rehearsal' }).click()
    await page.waitForURL(/\/app\/tests\/rehearsal\/[0-9a-f-]+$/)
    const hub = page.url()
    const attempts = async () => (await db.from('assessment_attempts').select('deadline_at, status').eq('rehearsal_id', hub.split('/').pop()!).order('session_no').throwOnError()).data!
    expect((await attempts()).map(a => a.deadline_at)).toEqual([null, null])
    await expect(page.getByRole('button', { name: 'Start session 2' })).toHaveCount(0)

    for (const session of [1, 2]) {
      await page.getByRole('button', { name: `Start session ${session}` }).click()
      await page.waitForURL(/\/app\/tests\/[0-9a-f-]+$/)
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible()
      const clocks = (await attempts()).map(a => a.deadline_at)
      expect(clocks[session - 1]).toBeTruthy()
      if (session === 1) expect(clocks[1]).toBeNull()
      await page.reload()
      await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible()
      expect((await attempts()).map(a => a.deadline_at)).toEqual(clocks)
      await page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio').first().click()
      await page.getByRole('radio', { name: 'Somewhat sure', exact: true }).click()
      await expect(page.locator('.attempt__save')).toHaveText('Saved')
      await noHorizontalOverflow(page)
      await page.getByRole('button', { name: 'Question 90, not answered', exact: true }).click()
      await page.getByRole('button', { name: 'Review and submit' }).click()
      await page.getByLabel('Submit with 89 unanswered').check()
      await page.getByRole('button', { name: 'Submit for scoring' }).click()
      await page.waitForURL(hub)
      if (session === 1) {
        await expect(page.getByText('Take a break.', { exact: false })).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Combined result' })).toHaveCount(0)
        expect((await attempts())[1].deadline_at).toBeNull()
      }
    }
    const combined = page.getByRole('region', { name: 'Combined result' })
    await expect(combined).toContainText('2 of 180 answered')
    expect((await attempts()).map(a => a.status)).toEqual(['scored', 'scored'])
    await noHorizontalOverflow(page)
  } finally {
    try {
      if (existsSync(bank)) destroyBank(bank)
      else releaseBankLock()
      if (studentId) await removeStudent(db, studentId)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
