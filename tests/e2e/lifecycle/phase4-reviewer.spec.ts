/**
 * Phase 4 reviewer journey in a real browser (desktop and 390px), on a REGISTERED SYNTHETIC fixture bank. Nothing here is real inventory, real rights, or a real
 * concept sign-off: the fixture batch's "authority" says it is test-only. SEEDED (by the guarded fixture command): the fixture reviewer account and role, an
 * approved fixture bank for one empty reading, and two automatically-checked CANDIDATES with a provisional family, a concept awaiting sign-off and a cleared
 * FIXTURE batch. BROWSER-DRIVEN: everything the reviewer does with those candidates, including the concept sign-off, family confirmation, level, approval,
 * a stale second tab and a material edit.
 */
import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { admin, login, noHorizontalOverflow, recorder, RUN, bankCli } from './helpers'
import { scopedErrors } from './scopedErrors'
import { getCapacityReport } from '../../../src/lib/tests/capacityReport'

const db = admin(), rec = recorder(), errors = scopedErrors()
const S: { file: string; tag: string; rev: string; revEmail: string; reading: string; outcome: string; candidates: string[]; concept: string; conceptName: string } = { file: '', tag: '', rev: '', revEmail: '', reading: '', outcome: '', candidates: [], concept: '', conceptName: '' }
test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => { errors.attach(page) })
test.beforeAll(async () => {
  errors.unexpected.length = 0; errors.allowances.length = 0
  await acquireBankLock()
  S.file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p4-rev-')), 'bank.json')
  const empty = ((await db.from('curriculum_readings').select('id').eq('is_active', true)).data ?? []).map(r => r.id as string)
  const used = new Set(((await db.from('assessment_items').select('lm_id')).data ?? []).map(i => i.lm_id as string))
  S.reading = empty.filter(r => !used.has(r)).sort()[0]
  try { execFileSync('node', bankCli('create', [`--out=${S.file}`, `--readings=${S.reading}`, '--per-outcome=3', '--variants=0', '--candidates=2']), { stdio: 'inherit' }) }
  catch (e) { if (fs.existsSync(S.file)) execFileSync('node', bankCli('destroy', [`--file=${S.file}`]), { stdio: 'inherit' }); releaseBankLock(); throw e }
  const r = JSON.parse(fs.readFileSync(S.file, 'utf8'))
  // The fixture's own reviewer row was inserted directly (it can sign commands in the database but cannot sign in through the auth service), so the
  // browser reviewer is a separate, run-owned account made through the auth API and given the reviewer role.
  S.revEmail = `p4rev+${RUN}@example.com`
  const made = await db.auth.admin.createUser({ email: S.revEmail, email_confirm: true }); if (made.error) throw new Error(made.error.message)
  S.rev = made.data.user!.id
  await db.from('profiles').upsert({ id: S.rev, onboarding_status: 'complete' }).throwOnError(); await db.from('user_roles').insert({ user_id: S.rev, role: 'diagnostic_reviewer' }).throwOnError()
  S.tag = r.tag; S.candidates = r.candidates; S.concept = r.candidateConcept
  S.conceptName = `Fixture ${r.tag} candidate concept`
  S.outcome = (await db.from('assessment_items').select('outcome_id').eq('id', S.candidates[0]).single()).data!.outcome_id as string
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  try { await db.from('concept_signoffs').delete().eq('concept_id', S.concept); await db.from('user_roles').delete().eq('user_id', S.rev); await db.from('item_review_decisions').delete().eq('reviewer_id', S.rev) } catch { /* the destroy below reports what remains */ }
  try { execFileSync('node', bankCli('destroy', [`--file=${S.file}`]), { stdio: 'inherit' }); cleanup.push({ what: 'fixture bank', ok: true }) } catch (e) { cleanup.push({ what: 'fixture bank', ok: false, error: (e as Error).message }) }
  { const r = await db.auth.admin.deleteUser(S.rev); cleanup.push({ what: `reviewer ${S.rev}`, ok: !r.error, error: r.error?.message }) }
  releaseBankLock()
  await new Promise(r => setTimeout(r, 2200))
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase4-reviewer-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, seeded: ['fixture reviewer account+role', 'approved fixture bank (reading ' + S.reading + ')', '2 automatically-checked candidates in a cleared FIXTURE batch, provisional family, concept awaiting sign-off'], unexpected: errors.unexpected, allowances: errors.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([])
  expect(errors.unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

// This journey reviews FIXTURE items, so it measures fixture capacity on purpose; the default report ignores every synthetic item.
const row = async (outcome: string) => (await getCapacityReport({ includeFixtures: true })).outcomes.find(o => o.id === outcome)!
const item = (id: string) => `/app/tests/review/${encodeURIComponent(id)}`
const hold = (page: Page) => page.route('**/_next/static/**/*.js*', async r => { await new Promise(x => setTimeout(x, 2500)); await r.continue().catch(() => {}) })
const attached = async (target: Locator) => { await expect.poll(() => target.evaluate(e => Object.keys(e).some(k => k.startsWith('__reactProps'))), { timeout: 60_000 }).toBe(true) }

test('the reviewer sees source, limits, scope, family and blockers on one screen; approval is off', async ({ page }) => {
  await login(page, db, S.revEmail, item(S.candidates[0]))
  await rec.browser('Source and provenance names the pack, its revision and edition, the source file reference, its hash and the authoring package', async () => {
    const src = page.getByRole('region', { name: 'Source and provenance' }).or(page.locator('section[aria-labelledby="src-h"]'))
    await expect(src).toContainText('fixture-pack'); await expect(src).toContainText('v1'); await expect(src).toContainText('edition 2027')
    await expect(src).toContainText('Synthetic fixture source'); await expect(src).toContainText('fixture p. 1'); await expect(src).toContainText('writer writer.fixture')
    await expect(src).toContainText('cleared'); await expect(src).toContainText('FIXTURE authority')
  })
  await rec.browser('the automatic checks say what they cannot prove', async () => {
    const chk = page.locator('section[aria-labelledby="chk-h"]'); await expect(chk).toContainText('Limits of these checks'); await expect(chk).toContainText(/arithmetic, not meaning/)
  })
  await rec.browser('concept scope, provisional family, and the exact publication blockers are visible; Approve is disabled', async () => {
    await expect(page.locator('section[aria-labelledby="map-h"]')).toContainText(/not signed off yet/); await expect(page.locator('section[aria-labelledby="map-h"]')).toContainText('Fixture scope')
    await expect(page.locator('section[aria-labelledby="fam-h"]')).toContainText(/provisional/)
    const dec = page.getByRole('complementary', { name: 'Decision' })
    await expect(dec).toContainText('Publication is blocked'); await expect(dec).toContainText(/signed off/); await expect(dec).toContainText(/family is provisional/)
    await expect(dec.getByRole('button', { name: 'Approve and publish' })).toBeDisabled()
    await noHorizontalOverflow(page)
  })
})

test('sign off the concept in the UI: explicit confirmation, a reason, the exact scope; the audit row names the reviewer', async ({ page }) => {
  await login(page, db, S.revEmail, '/app/tests/manifest')
  const art = page.locator('article.review-item').filter({ hasText: S.conceptName })
  await rec.browser('the sign-off control stays off until the reviewer confirms they read the scope and gives a reason', async () => {
    const head = art.locator('button.review-item__head'); if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
    await expect(art).toContainText('Fixture scope'); await expect(art).toContainText('Fixture exclusion')
    const btn = art.getByRole('button', { name: 'This scope is correct' }); await expect(btn).toBeDisabled()
    await art.getByRole('checkbox').check(); await expect(btn).toBeDisabled()
    await art.getByLabel(/^Why/).fill('Read the scope and exclusion against the fixture curriculum text.'); await expect(btn).toBeEnabled()
  })
  await rec.browser('signing off records one audit row for this reviewer and this exact scope', async () => {
    await art.getByRole('button', { name: 'This scope is correct' }).click()
    await expect.poll(async () => (await db.from('curriculum_concepts').select('verification_status').eq('id', S.concept).single()).data?.verification_status, { timeout: 20_000 }).toBe('verified')
    const rows = (await db.from('concept_signoffs').select('reviewer_id, decision, scope_hash, rationale').eq('concept_id', S.concept)).data!
    expect(rows.length).toBe(1); expect(rows[0]).toMatchObject({ reviewer_id: S.rev, decision: 'verify' }); expect(rows[0].rationale).toMatch(/fixture curriculum/)
  })
  await errors.expecting([{ label: 'deliberate concept verify 400s', url: /\/api\/curriculum\/concepts\/[^/]+\/verify$/, method: 'POST', statuses: [400], min: 2, max: 2 }], async () => {
    await rec.api('a request that is not a human decision (old body shape, empty body) approves nothing', async () => {
      const r1 = await page.evaluate(async id => (await fetch(`/api/curriculum/concepts/${id}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verified: true }) })).status, S.concept)
      const r2 = await page.evaluate(async id => (await fetch(`/api/curriculum/concepts/${id}/verify`, { method: 'POST' })).status, S.concept)
      expect([r1, r2]).toEqual([400, 400]); expect((await db.from('concept_signoffs').select('id').eq('concept_id', S.concept)).data!.length).toBe(1)
    })
  })
})

test('family, level and approval in the UI; capacity refreshes by exactly one routine item and one family', async ({ page }) => {
  await login(page, db, S.revEmail, item(S.candidates[0]))
  const before = await row(S.outcome)
  const dec = page.getByRole('complementary', { name: 'Decision' })
  await rec.browser('with the concept signed, only the family and the level still block approval', async () => {
    await expect(dec).toContainText(/family is provisional/); await expect(dec).not.toContainText(/not .*signed off|has not been signed off/)
  })
  await rec.browser('confirm the family construction (needs a note) and the difficulty level (needs a reason) for this exact version', async () => {
    await dec.getByLabel(/^Note/).fill('Own construction in the fixture bank.')
    await page.getByRole('button', { name: 'Confirm this is its own construction' }).click(); await expect(page.getByText('Done.')).toBeVisible()
    await expect.poll(async () => (await db.from('item_families').select('construction_status').eq('id', (await db.from('assessment_items').select('family_id').eq('id', S.candidates[0]).single()).data!.family_id).single()).data?.construction_status).toBe('confirmed')
    await dec.locator('select').selectOption('standard'); await dec.getByLabel(/^Cognitive demand/).fill('One stated relationship applied to a short worked example.')
    await dec.getByRole('button', { name: 'Confirm level' }).click()
    await expect.poll(async () => ((await db.from('item_confirmed_difficulty').select('level').eq('item_id', S.candidates[0]).eq('item_version', 1)).data ?? []).length).toBe(1)
  })
  await rec.browser('Approve becomes available only now; approving with the keyboard publishes exactly this version', async () => {
    const approve = dec.getByRole('button', { name: 'Approve and publish' }); await expect(approve).toBeEnabled()
    await approve.focus(); await page.keyboard.press('Enter')
    await expect.poll(async () => (await db.from('assessment_items').select('review_status').eq('id', S.candidates[0]).single()).data?.review_status, { timeout: 20_000 }).toBe('reviewed')
    const d = (await db.from('item_review_decisions').select('reviewer_id, decision, item_version').eq('item_id', S.candidates[0])).data!
    expect(d).toEqual([{ reviewer_id: S.rev, decision: 'approve', item_version: 1 }])
  })
  await rec.api('capacity refreshed: one more approved routine item and one more confirmed family for that outcome, nothing double counted', async () => {
    const after = await row(S.outcome)
    expect(after.approvedRoutine).toBe(before.approvedRoutine + 1); expect(after.familiesRoutine).toBe(before.familiesRoutine + 1); expect(after.raw).toBe(before.raw - 1)
  })
  await noHorizontalOverflow(page)
})

test('simultaneous decision from a stale second tab leaves one receipt; a material edit makes a new unapproved version', async ({ page, context }) => {
  await login(page, db, S.revEmail, item(S.candidates[1]))
  const c1 = S.candidates[1]
  const prep = async (p: Page) => { const dec = p.getByRole('complementary', { name: 'Decision' }); return dec }
  const dec1 = await prep(page)
  await dec1.getByLabel(/^Note/).fill('Own construction in the fixture bank.'); await page.getByRole('button', { name: 'Confirm this is its own construction' }).click(); await expect(page.getByText('Done.')).toBeVisible()
  await dec1.locator('select').selectOption('standard'); await dec1.getByLabel(/^Cognitive demand/).fill('One stated relationship applied to a short worked example.'); await dec1.getByRole('button', { name: 'Confirm level' }).click()
  await expect.poll(async () => ((await db.from('item_confirmed_difficulty').select('level').eq('item_id', c1)).data ?? []).length).toBe(1)
  await expect(dec1.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
  const p2 = await context.newPage(); await p2.goto(item(c1)); const dec2 = await prep(p2); await expect(dec2.getByRole('button', { name: 'Approve and publish' })).toBeEnabled()
  await rec.browser('both tabs hold an enabled Approve; the second tab approves; the first, now stale, is told and records nothing more', async () => {
    const decision = (p: Page) => p.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === `/api/diagnostic/items/${c1}/review`)
    const published = decision(p2)
    await dec2.getByRole('button', { name: 'Approve and publish' }).click()
    expect((await published).ok()).toBe(true)
    await expect.poll(async () => (await db.from('assessment_items').select('review_status').eq('id', c1).single()).data?.review_status).toBe('reviewed')
    const response = await errors.expecting([{ label: 'stale second-tab review 409', url: new RegExp(`/api/diagnostic/items/${c1}/review$`), method: 'POST', statuses: [409], min: 0, max: 1 }], async () => {
      const replay = decision(page)
      await dec1.getByRole('button', { name: 'Approve and publish' }).click()
      return await replay
    })
    expect(response.ok() || response.status() === 409).toBe(true)
    await expect(page.getByText(/Already recorded|nothing changed|already|no longer/i).first()).toBeVisible()
    expect(((await db.from('item_review_decisions').select('id').eq('item_id', c1).eq('decision', 'approve')).data ?? []).length).toBe(1)
    await expect(dec1.getByRole('button', { name: 'Approve and publish' })).toBeDisabled()
    // The reload is real and slow: the page's scripts are held back, so Edit is on screen before anything can hear it.
    await hold(page)
    await page.getByRole('button', { name: 'Reload this question' }).click()
    await p2.close()
  })
  await rec.browser('Edit pressed during the reload, by keyboard then pointer: it says it is not ready, loses nothing and opens the editor once ready', async () => {
    const edit = page.getByRole('button', { name: 'Edit', exact: true })
    await expect(edit).toBeVisible()
    await expect(edit).toBeDisabled()
    await page.keyboard.press('Enter')
    await edit.click()   // waits until the control accepts a press
    await expect(page.getByText(/Saving creates a new candidate version/)).toBeVisible()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
  await rec.browser('editing the published item creates a NEW candidate version that cannot be approved; the approved version stays live and the capacity does not count the draft as approved', async () => {
    const before = await row(S.outcome)
    await expect(dec1.getByRole('button', { name: 'Approve and publish' })).toHaveCount(0)
    await page.locator('label', { hasText: /^Question/ }).locator('textarea').first().fill('Fixture material edit: a different stem that is long enough to count as a rewrite of this question.')
    await page.getByLabel(/What did you change/).fill('rewrote the stem'); await page.getByRole('button', { name: 'Save as a new version' }).click()
    await expect.poll(async () => ((await db.from('assessment_items').select('id').eq('supersedes_item_id', c1)).data ?? []).length, { timeout: 20_000 }).toBe(1)
    const succ = (await db.from('assessment_items').select('id, review_status, item_version').eq('supersedes_item_id', c1).single()).data!
    expect(succ.item_version).toBe(2); expect(succ.review_status).not.toBe('reviewed')
    expect((await db.from('assessment_items').select('review_status').eq('id', c1).single()).data?.review_status, 'the approved version stays live').toBe('reviewed')
    expect(((await db.from('item_review_decisions').select('id').eq('item_id', c1).eq('decision', 'approve')).data ?? []).length, 'the stale tab left no second decision').toBe(1)
    expect(((await db.from('item_review_decisions').select('id').eq('item_id', succ.id)).data ?? []).length, 'the new candidate is unapproved').toBe(0)
    await page.waitForURL(u => u.pathname === item(succ.id)); const dec = await prep(page)
    await expect(dec.getByRole('button', { name: 'Approve and publish' })).toBeDisabled(); await expect(dec).toContainText('Publication is blocked')
    const after = await row(S.outcome)
    expect(after.approvedRoutine).toBe(before.approvedRoutine); expect(after.raw).toBe(before.raw + 1)
    await noHorizontalOverflow(page)
  })
})

test('the staff controls beside Edit, the review disclosures and the draft preview keep input given while the page loads', async ({ page }) => {
  await login(page, db, S.revEmail, item(S.candidates[0]))
  await rec.browser('a note typed and a history opened during loading are both still there, and the note enables its action', async () => {
    await hold(page); await page.goto(item(S.candidates[0]), { waitUntil: 'commit' })
    const history = page.locator('details').filter({ hasText: 'Level history' })
    await history.locator(':scope > summary').click()
    const note = page.getByRole('complementary', { name: 'Decision' }).getByLabel(/^Note/)
    await note.fill('Typed while the page was loading.')
    await attached(note)
    await expect(note).toHaveValue('Typed while the page was loading.')
    await expect(history).toHaveAttribute('open', '')
    await expect(page.getByRole('button', { name: 'Retire' })).toBeEnabled()   // the app holds the note, not only the field
  })
  await rec.browser('in the draft preview an answer chosen during loading is the answer selected', async () => {
    await page.unrouteAll({ behavior: 'ignoreErrors' }); await hold(page)
    await page.goto(`${item(S.candidates[0])}/preview`, { waitUntil: 'commit' })
    const answer = page.getByRole('radio', { name: 'Sure', exact: true })
    await answer.click()
    await attached(answer)
    await expect(answer).toHaveAttribute('aria-checked', 'true')
    await noHorizontalOverflow(page)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
