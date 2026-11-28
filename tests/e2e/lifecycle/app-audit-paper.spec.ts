import { expect, test } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, destroyBank, login, makeBank, noHorizontalOverflow, TARGET_HOST } from './helpers'

test('a failed paper load can retry the same reserved paper', async ({ page, baseURL }) => {
  expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname).toBe(TARGET_HOST)
  expect(['localhost', '127.0.0.1']).toContain(new URL(baseURL!).hostname)
  const db = admin()
  const student = await createStudent(db, 'auditpaper', { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING })
  let bankFile: string | null = null
  try {
    const bank = await makeBank(['r028'])
    bankFile = bank.file
    const res = await student.s.post('/api/tests/start', { kind: 'reading', readingId: 'r028', baseline: true })
    expect(res.status).toBe(200)
    const attemptId = res.body.attemptId as string
    const endpoint = `**/api/tests/attempt/${attemptId}`

    let drops = 0
    await page.route(endpoint, route => { drops++; return route.abort('failed') })
    await login(page, db, student.email, `/app/tests/${attemptId}`)
    await expect(page.getByRole('alert').filter({ hasText: 'Your paper could not be loaded.' })).toBeVisible()
    expect(drops).toBeGreaterThan(0)
    await page.unroute(endpoint)
    await page.getByRole('button', { name: 'Retry loading paper' }).click()
    await expect(page.getByRole('radiogroup', { name: 'Answer choices' })).toBeVisible({ timeout: 30_000 })
    await noHorizontalOverflow(page)

    const { count, error } = await db.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', student.id)
    expect(error).toBeNull()
    expect(count).toBe(1)
    expect(page.url()).toContain(`/app/tests/${attemptId}`)
  } finally {
    try {
      const result = await db.auth.admin.deleteUser(student.id)
      expect(result.error).toBeNull()
    } finally {
      if (bankFile) destroyBank(bankFile)
    }
  }
})
