/** UI save/cancellation proof. The draft RESPONSE is a labelled fixture; note/card persistence uses the real routes. No model or bank. */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, RUN } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), owned: string[] = [], se = scopedErrors()
const TEXT = 'Duration measures the sensitivity of a bond price to a change in yield. A longer maturity usually means higher duration.'
const draft = { ok: true, label: 'Controlled draft response', drafts: [{ front: 'What does duration measure?', back: 'The sensitivity of a bond price to a change in yield.', support: TEXT }], dropped: 0 }
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { id: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ id, ok: !r.error }); expect(r.error).toBeNull() }
  fs.writeFileSync(`docs/evidence/phase5-owner-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ run: RUN, at: new Date().toISOString(), draftResponse: 'controlled browser fixture; not a provider/grounding test', real: 'ordinary onboarding, note save, card write, reload', unexpected: se.unexpected, allowances: se.allowances, cleanup }, null, 2))
  expect(se.unexpected).toEqual([])
})

async function setup(page: import('@playwright/test').Page) {
  const s = await createStudent(db, `p5owner${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const r = (await db.from('curriculum_readings').select('id,topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(1).single().throwOnError()).data!
  const n = await s.s.post('/api/curriculum/notes', { scopeType: 'reading', scopeId: r.id, expectedRevision: 0, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: TEXT }] }] } })
  expect(n.body.ok).toBe(true)
  const url = `/app/curriculum/${r.topic_id}/${r.id}?tab=cards`
  await login(page, db, s.email, '/app/curriculum'); await page.goto(url)
  await page.getByRole('button', { name: 'Draft cards from my note…' }).click()
  const panel = page.getByRole('region', { name: 'Draft cards from my note' })
  await expect(panel.getByLabel('Text to draw cards from')).toHaveValue(TEXT)
  return { s, panel, url }
}

test('a delayed confirmed card save cannot overwrite newer edits or be closed mid-save', async ({ page }, info) => {
  const { s, panel, url } = await setup(page)
  await page.route('**/api/curriculum/flashcards/draft', r => r.fulfill({ json: draft }))
  await panel.getByRole('button', { name: 'Draft up to 5 cards' }).click()
  await panel.getByLabel('Draft 1 front').fill('Duration recall — saved once')
  await panel.getByRole('checkbox').check()
  let release!: () => void, committed!: () => void
  const held = new Promise<void>(r => { release = r }), stored = new Promise<void>(r => { committed = r })
  await page.route('**/api/curriculum/flashcards', async r => {
    if (r.request().method() !== 'POST') return r.continue()
    const response = await r.fetch(); committed(); await held
    try { await r.fulfill({ response }) } catch { /* page may close after a failed assertion; persistence already completed */ }
  })
  try {
    await panel.getByRole('button', { name: 'Save selected cards' }).click(); await stored
    await expect(panel.getByLabel('Draft 1 front')).toBeDisabled()
    await expect(panel.getByLabel('Draft 1 back')).toBeDisabled()
    await expect(panel.getByRole('checkbox')).toBeDisabled()
    await expect(panel.getByLabel('Text to draw cards from')).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeDisabled()
  } finally { release() }
  await expect(panel.getByText('1 card saved.', { exact: false })).toBeVisible()
  await page.unroute('**/api/curriculum/flashcards'); await page.goto(url)
  await expect(page.getByText('Duration recall — saved once', { exact: true })).toBeVisible()
  const rows = (await db.from('flashcards').select('id').eq('user_id', s.id).eq('front', 'Duration recall — saved once').throwOnError()).data!
  expect(rows.length).toBe(1); await noHorizontalOverflow(page)
  await page.screenshot({ path: `/tmp/roadmap-p5-owner-${info.project.name}.png` })
})

test('closing a delayed generation discards its response and reopening starts from the note', async ({ page }) => {
  const { panel } = await setup(page)
  let started!: () => void, release!: () => void, settled!: () => void
  const sent = new Promise<void>(r => { started = r }), held = new Promise<void>(r => { release = r }), done = new Promise<void>(r => { settled = r })
  await page.route('**/api/curriculum/flashcards/draft', async r => {
    started(); await held
    try { await r.fulfill({ json: draft }) } catch { /* cancellation is the intended result */ } finally { settled() }
  })
  await panel.getByRole('button', { name: 'Draft up to 5 cards' }).click(); await sent
  await expect(panel.getByLabel('Text to draw cards from')).toBeDisabled()
  await se.expecting([{ label: 'owned draft cancelled by Close', url: /\/api\/curriculum\/flashcards\/draft$/, failed: true, min: 1, max: 1 }], async () => {
    const cancelled = page.waitForEvent('requestfailed', { predicate: r => r.url().endsWith('/api/curriculum/flashcards/draft') })
    await panel.getByRole('button', { name: 'Close', exact: true }).click(); await cancelled; release(); await done
    await expect(page.getByRole('button', { name: 'Draft cards from my note…' })).toBeVisible()
  })
  await page.getByRole('button', { name: 'Draft cards from my note…' }).click()
  await expect(panel.getByLabel('Text to draw cards from')).toHaveValue(TEXT)
  await expect(panel.getByLabel('Draft 1 front')).toHaveCount(0)
  await noHorizontalOverflow(page)
})

test('a delayed manual save freezes its fields and a lost edit response reuses the original receipt', async ({ page }) => {
  const { s, panel } = await setup(page)
  await panel.getByRole('button', { name: 'Close', exact: true }).click()
  const form = page.locator('.flashcards__form')
  await form.getByLabel('Front', { exact: true }).fill('Manual recall — saved once')
  await form.getByLabel('Back', { exact: true }).fill('My own recall answer')
  let release!: () => void, committed!: () => void
  const held = new Promise<void>(r => { release = r }), stored = new Promise<void>(r => { committed = r })
  await page.route('**/api/curriculum/flashcards', async r => {
    if (r.request().method() !== 'POST') return r.continue()
    const response = await r.fetch(); committed(); await held; await r.fulfill({ response })
  })
  try {
    await form.getByRole('button', { name: 'Add card' }).click(); await stored
    await expect(form.getByLabel('Front', { exact: true })).toBeDisabled()
    await expect(form.locator('textarea')).toBeDisabled()
  } finally { release() }
  await expect(page.getByText('Manual recall — saved once', { exact: true })).toBeVisible()
  await page.unroute('**/api/curriculum/flashcards')
  const row = page.locator('.flashcards__list > li').filter({ hasText: 'Manual recall — saved once' })
  await row.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.locator('.flashcards__edit').filter({ has: page.getByRole('button', { name: 'Save', exact: true }) })
  await edit.getByLabel('Front', { exact: true }).fill('Manual recall — edited once')
  const keys: string[] = []
  await se.expecting([{ label: 'owned edit committed but reply lost', url: /\/api\/curriculum\/flashcards$/, failed: true, min: 1, max: 1 }], async () => {
    await page.route('**/api/curriculum/flashcards', async r => {
      if (r.request().method() !== 'POST') return r.continue()
      keys.push(r.request().postDataJSON().requestKey); await r.fetch(); await r.abort('failed')
    })
    await edit.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(edit.getByRole('alert')).toBeVisible()
  })
  await expect(edit.getByLabel('Front', { exact: true })).toHaveValue('Manual recall — edited once')
  await page.unroute('**/api/curriculum/flashcards')
  await page.route('**/api/curriculum/flashcards', async r => {
    if (r.request().method() === 'POST') keys.push(r.request().postDataJSON().requestKey)
    await r.continue()
  })
  await edit.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Manual recall — edited once', { exact: true })).toBeVisible()
  expect(keys.length).toBe(2); expect(keys[1]).toBe(keys[0])
  const cards = (await db.from('flashcards').select('revision').eq('user_id', s.id).throwOnError()).data!
  expect(cards.length).toBe(1); expect(cards[0].revision).toBe(2)
  await noHorizontalOverflow(page)
})
