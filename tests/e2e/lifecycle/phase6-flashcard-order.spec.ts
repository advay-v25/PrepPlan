import { expect, test, type Page } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, removeStudent, RUN } from './helpers'

/**
 * Phase 6 · the flashcard list after a slow change. The student keeps using the list while an add, edit or delete is still on its way; when it lands, the
 * list must show what is chosen NOW (filter, search, pages), and the saved card must be what they asked for. Desktop and 390 px.
 */
const db = admin()
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
async function setup(page: Page, owned: string[]) {
  const s = await createStudent(db, `cards${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { ...FRESH_STUDENT_ONBOARDING } })
  const r = (await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).order('id').limit(1).single().throwOnError()).data!
  // 130 cards in a fixed order: the first 30 are due now, the rest next week.
  const rows = Array.from({ length: 130 }, (_, i) => ({ user_id: s.id, scope_type: 'reading', scope_id: r.id, front: `Card ${String(i + 1).padStart(3, '0')}`, back: `Answer ${i + 1}`, due_at: new Date(Date.now() + (i < 30 ? -3_600_000 : 7 * 86_400_000)).toISOString(), created_at: new Date(Date.now() - 86_400_000 + i * 1000).toISOString() }))
  await db.from('flashcards').insert(rows).throwOnError()
  await login(page, db, s.email, `/app/curriculum/${r.topic_id}/${r.id}?tab=cards`)
  const items = page.locator('.flashcards__list > li')
  await expect(items).toHaveCount(50)
  /** Holds the next change on its way to the server; `release` lets it land. */
  const slow = async () => {
    let release!: () => void; const gate = new Promise<void>(res => { release = res })
    await page.route('**/api/curriculum/flashcards', async route => { if (route.request().method() !== 'POST') return route.continue(); await gate; await route.continue() })
    const landed = page.waitForResponse(x => x.request().method() === 'POST' && /\/api\/curriculum\/flashcards$/.test(new URL(x.url()).pathname))
    return async () => { release(); await (await landed).finished(); await page.waitForLoadState('networkidle'); await page.unroute('**/api/curriculum/flashcards') }
  }
  const saved = async (front: string) => (await db.from('flashcards').select('front, back').eq('user_id', s.id).eq('front', front).throwOnError()).data!
  return { s, items, slow, saved, fronts: () => items.locator('strong').allInnerTexts() }
}
const run = (name: string, body: (page: Page, t: Awaited<ReturnType<typeof setup>>) => Promise<void>) => test(name, async ({ page }) => {
  local(); test.setTimeout(240_000)
  const owned: string[] = []
  try { await body(page, await setup(page, owned)); await noHorizontalOverflow(page) }
  finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); for (const id of owned) await removeStudent(db, id) }
})

run('flashcards · an add that lands after switching to Due leaves the Due list, with the saved card in it', async (page, t) => {
  const land = await t.slow()
  await page.locator('.flashcards__form input').fill('Slow new card'); await page.locator('.flashcards__form textarea').fill('Saved while looking elsewhere')
  await page.getByRole('button', { name: 'Add card' }).click()
  await page.getByLabel('Show').selectOption('due'); await expect(t.items).toHaveCount(30)
  await land()
  await expect(page.getByLabel('Show')).toHaveValue('due')
  await expect(t.items).toHaveCount(31)   // a new card is due at once
  const fronts = await t.fronts()
  expect(fronts.filter(f => /^Card (0[0-2]\d|030)$/.test(f))).toHaveLength(30); expect(fronts).toContain('Slow new card')
  await expect(page.getByRole('status').filter({ hasText: /131 cards · 31 due now/ })).toBeVisible()
  expect(await t.saved('Slow new card')).toEqual([{ front: 'Slow new card', back: 'Saved while looking elsewhere' }])
})

run('flashcards · a delete that lands after a new search leaves the search results', async (page, t) => {
  const land = await t.slow()
  const first = t.items.first()
  await first.getByRole('button', { name: 'Delete' }).click(); await first.getByRole('button', { name: 'Yes, delete' }).click()
  await page.getByLabel('Search cards').fill('Card 12'); await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(t.items).toHaveCount(10)
  await land()
  await expect(t.items).toHaveCount(10)
  expect((await t.fronts()).every(f => /^Card 12\d$/.test(f))).toBe(true)
  expect(await t.saved('Card 001')).toEqual([])
  await expect(page.getByRole('status').filter({ hasText: /129 cards · 29 due now/ })).toBeVisible()
})

run('flashcards · an edit that lands after Show more keeps the longer list and shows the saved text', async (page, t) => {
  const land = await t.slow()
  await t.items.first().getByRole('button', { name: 'Edit' }).click()
  await page.locator('.flashcards__edit input').fill('Card 001 rewritten'); await page.locator('.flashcards__edit button', { hasText: 'Save' }).click()
  await page.getByRole('button', { name: /Show more/ }).click(); await expect(t.items).toHaveCount(100)
  await land()
  await expect(t.items).toHaveCount(100)
  await expect(t.items.first().locator('strong')).toHaveText('Card 001 rewritten')
  expect(await t.saved('Card 001 rewritten')).toHaveLength(1)
  await page.getByRole('button', { name: /Show more \(30 more\)/ }).click(); await expect(t.items).toHaveCount(130)
  // A later change reloads everything on screen, past one page of the server's limit.
  const again = await t.slow()
  await t.items.first().getByRole('button', { name: 'Delete' }).click(); await t.items.first().getByRole('button', { name: 'Yes, delete' }).click()
  await again()
  await expect(t.items).toHaveCount(129)
})
