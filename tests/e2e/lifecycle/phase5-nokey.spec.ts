/**
 * The NO-API-KEY branch, in a real browser (desktop and 390px). The app server for this run is started with NVIDIA_API_KEY set to the EMPTY string (generation disabled),
 * so there is no provider to call. Proves: drafting says it is unavailable and keeps the selected excerpt, counts nothing against the throttle, sends no provider call,
 * and manual cards still work (create, review) with no evidence or task mutation. SEEDED: the student and onboarding (real API). Everything else is UI.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = [], se = scopedErrors(), S: any = {}
test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { await db.from('flashcard_commands').delete().eq('user_id', id); await db.from('flashcard_draft_requests').delete().eq('user_id', id); const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase5-nokey-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, server: 'started with NVIDIA_API_KEY empty (no provider configured)', allowances: se.allowances, unexpected: se.unexpected, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([]); expect(se.unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})
const NOTE = 'Duration measures the sensitivity of a bond price to a change in yield. Convexity captures the curvature that duration misses for large yield changes.'
const count = async (t: string) => ((await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', S.id)).count) ?? -1

test('no API key: drafting is honestly unavailable, keeps the excerpt, spends nothing; manual cards still work', async ({ page }) => {
  const st = await createStudent(db, `p5k${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) }); S.id = st.id
  const r = (await db.from('curriculum_readings').select('id, topic_id, title').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(1).single()).data!
  S.before = { ev: await count('evidence_events'), rp: await count('repair_threads'), blocks: JSON.stringify((await db.from('plan_blocks').select('id, execution').eq('user_id', st.id).order('id')).data) }
  await login(page, db, st.email, `/app/curriculum/${r.topic_id}/${r.id}?tab=cards`)
  await rec.browser('Draft from my note: the excerpt is kept, the page says drafting is unavailable and that manual cards still work, nothing was saved, and NO throttle slot was spent', () => se.expecting([{ label: 'the deliberate unavailable-provider response (503)', url: /\/api\/curriculum\/flashcards\/draft$/, statuses: [503], min: 1, max: 2 }], async () => {
    await page.getByRole('button', { name: /Draft cards from my note/ }).click(); const d = page.locator('.flashcards__drafter')
    await d.getByLabel('Text to draw cards from').fill(NOTE); await d.getByRole('button', { name: /Draft up to 5 cards/ }).click()
    await expect(d.getByRole('alert')).toContainText(/Drafting is not available right now/); await expect(d.getByRole('alert')).toContainText(/write cards by hand/i)
    await expect(d.getByLabel('Text to draw cards from')).toHaveValue(NOTE); await expect(d.getByLabel(/Draft 1 front/)).toHaveCount(0)
    expect(await count('flashcard_draft_requests')).toBe(0); expect(await count('flashcards')).toBe(0); await noHorizontalOverflow(page)
  }))
  await rec.browser('a manual card is created and reviewed (no model involved); the schedule is the database\'s, and nothing else changes', async () => {
    await page.getByLabel('Front', { exact: true }).first().fill('What does duration measure?'); await page.getByLabel('Back', { exact: true }).first().fill('Price sensitivity to yield.'); await page.getByRole('button', { name: 'Add card' }).click(); await expect(page.getByText('What does duration measure?').first()).toBeVisible()
    await page.getByRole('button', { name: /Review 1 due/ }).click(); await page.getByRole('button', { name: 'Show the answer' }).click(); await page.getByRole('button', { name: 'Again' }).click()
    await expect(page.getByText(/1 card comes back (at|on)/)).toBeVisible()
    const c = (await db.from('flashcards').select('reps, lapses, revision, due_at').eq('user_id', S.id).single()).data!; expect(c).toMatchObject({ reps: 0, lapses: 1, revision: 2 }); const delay = new Date(c.due_at).getTime() - Date.now(); expect(delay).toBeGreaterThan(8 * 60_000); expect(delay).toBeLessThan(11 * 60_000)
  })
  await rec.api('no provider call was possible, and evidence, repair state and accepted work are exactly as before', async () => {
    expect(await count('evidence_events')).toBe(S.before.ev); expect(await count('repair_threads')).toBe(S.before.rp); expect(await count('flashcard_draft_requests')).toBe(0)
    expect(JSON.stringify((await db.from('plan_blocks').select('id, execution').eq('user_id', S.id).order('id')).data)).toBe(S.before.blocks)
  })
})
