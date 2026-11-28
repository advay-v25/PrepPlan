/**
 * Phase 5: the Curriculum workspace in a real browser (desktop and 390px), ONE run-owned ordinary student per viewport, NO question bank and NO real provider.
 * SEEDED (recorded as endpoint steps): the student and onboarding (real API), reported coverage through the real coverage API, bulk cards (1,200) for the long-list case,
 * a second student for the owner-switch case. A CONTROLLED local provider stands in for the model (drafting paths): that proves the software paths, not model quality.
 * BROWSER-DRIVEN: search/filters/outline, deep links, reading tabs, notes (autosave, reload, conflict, lost save, draft recovery, IME, owner switch), cards (add, edit, stale edit,
 * delete, review, Again delay, competing ratings, lost response), draft-from-note (valid, malformed, error, timeout), long deck pagination with a failed later page.
 * Needs the app started with NVIDIA_BASE_URL=http://127.0.0.1:39177/v1 and NVIDIA_API_KEY set (any value).
 */
import { test, expect, type Page } from '@playwright/test'
import http from 'node:http'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN, J } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = [], se = scopedErrors()
const S: any = { id: '', email: '' }
test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => se.attach(page))

// ---- controlled provider ---------------------------------------------------------------------------------------------------------------------------------------
type Mode = 'valid' | 'malformed' | 'error' | 'hang'
let mode: Mode = 'valid', providerCalls = 0
const NOTE_TEXT = 'Duration measures the sensitivity of a bond price to a change in yield. Convexity captures the curvature that duration misses for large yield changes. The final amount is 105.'
const provider = http.createServer((req, res) => {
  let b = ''; req.on('data', d => { b += d }); req.on('end', () => {
    providerCalls++
    if (mode === 'hang') return
    if (mode === 'error') { res.statusCode = 500; return res.end(JSON.stringify({ error: { message: 'simulated' } })) }
    const content = mode === 'malformed' ? 'I am sorry, here are some cards without JSON'
      : JSON.stringify({ cards: [{ front: 'What does duration measure?', back: 'The sensitivity of a bond price to a change in yield.', support: 'Duration measures the sensitivity of a bond price to a change in yield.' }, { front: 'What does convexity capture?', back: 'The curvature that duration misses for large yield changes.', support: 'Convexity captures the curvature that duration misses for large yield changes.' }, { front: 'What is the final amount?', back: 'The final amount is 150.', support: 'The final amount is 105.' }, { front: 'Who approved this?', back: 'The CFA Institute officially approved it.', support: 'Duration measures the sensitivity of a bond price' }] })
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 40 } }))
  })
})
test.beforeAll(async () => { await new Promise<void>(r => provider.listen(39177, '127.0.0.1', r)) })
test.afterAll(async ({}, info) => {
  provider.close()
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { await db.from('flashcard_commands').delete().eq('user_id', id); await db.from('flashcard_draft_requests').delete().eq('user_id', id); const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase5-workspace-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, provider: 'CONTROLLED local simulation (not a real provider)', providerCalls, allowances: se.allowances, unexpected: se.unexpected, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([])
  expect(se.unexpected, 'unexpected failed requests, HTTP errors, console or page errors (only the deliberate faults are tolerated)').toEqual([])
})

const shot = async (page: Page, name: string) => { await page.screenshot({ path: `docs/evidence/screens/phase5-${test.info().project.name}-${name}.png`, fullPage: false }) }
const noteRow = async (scope: string) => (await db.from('curriculum_notes').select('doc, revision').eq('user_id', S.id).eq('scope_type', 'reading').eq('scope_id', scope).maybeSingle()).data
const plain = (doc: any): string => JSON.stringify(doc ?? {})
const cards = async (scope: string) => (await db.from('flashcards').select('*').eq('user_id', S.id).eq('scope_id', scope).order('created_at')).data ?? []
const editor = (page: Page) => page.locator('.note-editor__content')
const tab = (page: Page, name: RegExp) => page.getByRole('navigation', { name: 'Reading sections' }).getByRole('link', { name })
const evidenceCount = async () => ((await db.from('evidence_events').select('id').eq('user_id', S.id)).data ?? []).length
const repairCount = async () => ((await db.from('repair_threads').select('id').eq('user_id', S.id)).data ?? []).length
const track = async (id: string) => (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', id)).count ?? 0

test('SEEDED setup: a fresh student, reported coverage on three readings in three subjects, a second student', async () => {
  const st = await createStudent(db, `p5${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  S.id = st.id; S.email = st.email
  const rs = (await db.from('curriculum_readings').select('id, topic_id, title, reading_no, legacy_module_ids, structure_pending').eq('is_active', true).eq('structure_pending', false).order('sequence')).data ?? []
  const bySubject = new Map<string, any[]>(); for (const r of rs) bySubject.set(r.topic_id, [...(bySubject.get(r.topic_id) ?? []), r])
  const subjects = [...bySubject.keys()]; expect(subjects.length).toBeGreaterThanOrEqual(3)
  S.fsa = bySubject.get(subjects[0])![0]; S.covered = subjects.slice(0, 3).map(s => bySubject.get(s)![0]); S.other = bySubject.get(subjects[0])![1]; S.third = bySubject.get(subjects[1])![1]
  S.state = { evidence: await evidenceCount(), repairs: await repairCount() }
  const st2 = await createStudent(db, `p5b${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) }); S.email2 = st2.email; S.id2 = st2.id
})

test('1 fresh self-study, no bank, no provider: find a reading, honest summary, own note, manual card, review the last card, reload', async ({ page }) => {
  await login(page, db, S.email, '/app/curriculum')
  await rec.browser('the landing answers where am I / what needs attention / where next, with no claim of understanding or readiness', async () => {
    await expect(page.getByRole('heading', { name: 'Curriculum', exact: true })).toBeVisible()
    await expect(page.getByLabel('Where you are')).toContainText(/0 of \d+ readings recorded as covered/); await expect(page.getByLabel('Where you are')).toContainText('does not mean understood')
    expect(await page.locator('body').innerText()).not.toMatch(/\b\d+%\s*(ready|prepared|pass)|pass probability|you (are|have) mastered/i)
    await expect(page.getByRole('search').first()).toBeVisible(); await noHorizontalOverflow(page); await shot(page, '1-landing')
  })
  await rec.browser('search finds the reading and the compact outline opens it with a way back', async () => {
    await page.getByLabel('Find a reading').fill(S.fsa.title.split(' ').slice(0, 2).join(' ')); await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.getByRole('status').filter({ hasText: /match/ })).toBeVisible()
    await page.locator('.curriculum-outline').getByRole('link', { name: new RegExp(S.fsa.title.slice(0, 20)) }).first().click(); await expect(page.getByRole('heading', { level: 1, name: new RegExp(S.fsa.title.slice(0, 20)) })).toBeVisible()
    await expect(page.getByRole('link', { name: /Back/ })).toBeVisible(); await noHorizontalOverflow(page)
  })
  await rec.browser('Work / Notes / Cards: only the chosen section is mounted (no editor, no deck on the Work view)', async () => {
    await expect(page.getByRole('heading', { name: 'Your notes' })).toHaveCount(0); await expect(page.locator('.note-editor')).toHaveCount(0); await expect(page.locator('.flashcards')).toHaveCount(0)
    await expect(page.locator('details.reading-outcomes')).toHaveCount(1); await shot(page, '2-reading-work')
  })
  await rec.browser('own note: type, it is saved; reload shows it', async () => {
    await tab(page, /^Notes/).click(); await editor(page).click(); await page.keyboard.type('Revenue recognition: check the performance obligation first.')
    await expect.poll(async () => plain((await noteRow(S.fsa.id))?.doc), { timeout: 15_000 }).toContain('performance obligation')
    await page.reload(); await expect(editor(page)).toContainText('performance obligation'); await shot(page, '3-reading-notes')
  })
  await rec.browser('manual card (no model): add, review the only card with Good, the empty queue does not crash, reload shows it scheduled later', async () => {
    await tab(page, /^Cards/).click(); await page.getByLabel('Front').fill('What comes first in revenue recognition?'); await page.getByLabel('Back').fill('Identify the contract.'); await page.getByRole('button', { name: 'Add card' }).click()
    await expect(page.getByRole('status').filter({ hasText: '1 card' })).toBeVisible()
    await page.getByRole('button', { name: /Review 1 due/ }).click(); await page.getByRole('button', { name: 'Show the answer' }).click(); await page.getByRole('button', { name: 'Good' }).click()
    await expect(page.getByText(/You reviewed 1 card/)).toBeVisible(); await expect(page.getByText(/1 card comes back (at|on)/)).toBeVisible()
    const [c] = await cards(S.fsa.id); expect(c).toMatchObject({ reps: 1, revision: 2 }); expect(new Date(c.due_at).getTime()).toBeGreaterThan(Date.now() + 20 * 3600_000)
    await page.getByRole('button', { name: 'Back' }).click(); await page.reload(); await tab(page, /^Cards/).click(); await expect(page.getByText(/1 card · 0 due now/)).toBeVisible(); await shot(page, '4-reading-cards')
  })
  await rec.api('notes and cards wrote no evidence, repair state or readiness', async () => { expect(await evidenceCount()).toBe(S.state.evidence); expect(await repairCount()).toBe(S.state.repairs) })
})

test('2 midway: reported coverage on three subjects, filters expose them, return context, self-report never becomes evidence', async ({ page }) => {
  await login(page, db, S.email, '/app/curriculum')
  await rec.browser('the three-subject midway entry: the student reports "Covered" on one reading in each of three subjects through the reading page (real UI and real API, no seeded rows)', async () => {
    for (const r of S.covered) {
      await page.goto(`/app/curriculum/${r.topic_id}/${r.id}`)
      await page.getByRole('radiogroup', { name: /What have you covered of/ }).getByLabel('Covered', { exact: true }).check()
      await expect.poll(async () => (await db.from('user_module_state').select('coverage_state, source').eq('user_id', S.id).eq('lm_id', r.id).maybeSingle()).data, { timeout: 15_000 }).toEqual({ coverage_state: 'studied', source: 'self_report' })
      await page.reload(); await expect(page.getByRole('radiogroup', { name: /What have you covered of/ }).getByLabel('Covered', { exact: true })).toBeChecked()
    }
    expect(S.covered.map((r: any) => r.topic_id).length).toBe(new Set(S.covered.map((r: any) => r.topic_id)).size)   // three DIFFERENT subjects
    await noHorizontalOverflow(page)
  })
  await rec.browser('a failed coverage save keeps the choice on screen, says it was not saved, and Try again saves it once', () => se.expecting([{ label: 'the injected coverage save failure', url: /\/api\/curriculum\/coverage$/, failed: true, min: 1, max: 2 }], async () => {
    const r = S.other; await page.goto(`/app/curriculum/${r.topic_id}/${r.id}`)
    await page.route('**/api/curriculum/coverage', route => route.abort('failed'))
    await page.getByRole('radiogroup', { name: /What have you covered of/ }).getByLabel('Partly covered', { exact: true }).check()
    await expect(page.getByRole('alert').filter({ hasText: /not saved/i })).toBeVisible(); await expect(page.getByLabel('Partly covered', { exact: true })).toBeChecked()
    expect(((await db.from('user_module_state').select('lm_id').eq('user_id', S.id).eq('lm_id', r.id)).data ?? []).length).toBe(0)
    await page.unroute('**/api/curriculum/coverage'); await page.getByRole('button', { name: 'Try again' }).first().click()
    await expect.poll(async () => (await db.from('user_module_state').select('coverage_state').eq('user_id', S.id).eq('lm_id', r.id).maybeSingle()).data?.coverage_state, { timeout: 15_000 }).toBe('taught')
    await db.from('user_module_state').delete().eq('user_id', S.id).eq('lm_id', r.id)   // cleanup of this step's own row so later filters stay exact
  }))
  await login(page, db, S.email, '/app/curriculum?f=covered')
  await rec.browser('the Covered filter shows exactly the reported readings; Not covered excludes them; counts are canonical words, not a score', async () => {
    await expect(page.getByRole('status').filter({ hasText: /reading.* match/ })).toBeVisible()
    for (const r of S.covered) await expect(page.locator('.curriculum-outline').getByRole('link', { name: new RegExp(r.title.slice(0, 15)) }).first()).toBeVisible()
    await page.goto('/app/curriculum?f=not_covered'); await expect(page.locator('.curriculum-outline').getByRole('link', { name: new RegExp(S.covered[0].title.slice(0, 18)) })).toHaveCount(0)
    await page.goto('/app/curriculum'); await expect(page.getByLabel('Where you are')).toContainText(/[1-9]\d* of \d+ readings recorded as covered/)
    await expect(page.getByLabel('Where you are')).toContainText('does not mean understood')
  })
  await rec.browser('opening a reading from a filtered list keeps the filter in Back', async () => {
    await page.goto('/app/curriculum?f=covered'); await page.locator('.curriculum-outline').getByRole('link', { name: new RegExp(S.covered[0].title.slice(0, 18)) }).first().click()
    await page.getByRole('link', { name: /Back/ }).click(); await expect(page).toHaveURL(/\/app\/curriculum\?f=covered/)
  })
  await rec.api('reported coverage, notes and cards left evidence and repairs exactly as they were (Covered is never tested understanding)', async () => { expect(await evidenceCount()).toBe(S.state.evidence); expect(await repairCount()).toBe(S.state.repairs) })
})

test('7a deep links: unknown, foreign and malformed context is honest, never a different reading', async ({ page }) => {
  await login(page, db, S.email, '/app/curriculum')
  await rec.browser('an unknown reading and a reading under the wrong subject are not found', () => se.expecting([{ label: 'deliberate unknown deep links', url: /\/app\/curriculum\//, statuses: [404], min: 2, max: 4 }], async () => {
    await page.goto(`/app/curriculum/${S.fsa.topic_id}/no-such-reading`); await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible()
    await page.goto(`/app/curriculum/${S.third.topic_id === S.fsa.topic_id ? 'zzz' : S.third.topic_id}/${S.fsa.id}`); await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible()
  }))
  await rec.browser('an outcome that is not in this reading selects nothing and says so; an unsafe return link is ignored; a foreign result is not linked', async () => {
    await page.goto(`/app/curriculum/${S.fsa.topic_id}/${S.fsa.id}?los=not-an-outcome&return=//evil.example/x`); await expect(page.getByText(/not part of this reading/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Back/ })).toHaveCount(0)
    await page.goto(`/app/curriculum/${S.fsa.topic_id}/${S.fsa.id}?return=/app/calendar&result=00000000-0000-4000-8000-000000000000&tab=notes`)
    await expect(page.getByRole('link', { name: /Back/ })).toHaveAttribute('href', '/app/calendar'); await expect(page.getByText(/not available to you, so nothing was linked/)).toBeVisible()
  })
})

test('5 notes: conflict in two tabs, lost save, reload recovery, IME, owner switch, failed read', async ({ page, context }) => {
  const url = `/app/curriculum/${S.other.topic_id}/${S.other.id}?tab=notes`
  await login(page, db, S.email, url)
  page.on('dialog', d => d.accept())   // the editor warns before leaving with unsaved text; the scripted reloads choose to leave
  const page2 = await context.newPage(); se.attach(page2); page2.on('dialog', d => d.accept()); await page2.goto(url)
  await rec.browser('two tabs: the first saves; the second is told the note changed, keeps BOTH versions, and replaces only when the student chooses', () => se.expecting([{ label: 'the deliberate stale-revision conflict (409)', url: /\/api\/curriculum\/notes$/, statuses: [409], min: 1, max: 2 }], async () => {
    await editor(page).click(); await page.keyboard.type('Tab one text.'); await expect.poll(async () => plain((await noteRow(S.other.id))?.doc), { timeout: 15_000 }).toContain('Tab one text')
    await editor(page2).click(); await page2.keyboard.type('Tab two text.')
    await expect(page2.getByRole('alert').filter({ hasText: /changed somewhere else/ })).toBeVisible({ timeout: 20_000 })
    expect(plain((await noteRow(S.other.id))?.doc)).not.toContain('Tab two text'); await expect(editor(page2)).toContainText('Tab two text')
    await page2.getByRole('button', { name: 'Keep mine and replace it' }).click(); await expect.poll(async () => plain((await noteRow(S.other.id))?.doc), { timeout: 15_000 }).toContain('Tab two text')
  }))
  await rec.browser('a lost save keeps the text and says Not saved; Retry saves it once', () => se.expecting([{ label: 'the injected note save failure', url: /\/api\/curriculum\/notes$/, failed: true, min: 1, max: 6 }], async () => {
    await page.route('**/api/curriculum/notes', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())
    await page.reload(); await editor(page).click(); await page.keyboard.type(' Offline words.')
    await expect(page.locator('.note-editor__status')).toHaveText(/Not saved/, { timeout: 25_000 }); await expect(editor(page)).toContainText('Offline words')
    await page.unroute('**/api/curriculum/notes'); await page.getByRole('button', { name: 'Retry' }).click()
    await expect.poll(async () => plain((await noteRow(S.other.id))?.doc), { timeout: 20_000 }).toContain('Offline words')
  }))
  await rec.browser('closing before it saved: the text is offered back on reload and Restore saves it', () => se.expecting([{ label: 'the injected note save failure before reload', url: /\/api\/curriculum\/notes$/, failed: true, min: 1, max: 8 }], async () => {
    await page.route('**/api/curriculum/notes', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())
    await editor(page).click(); await page.keyboard.type(' Draft before reload.'); await expect(page.locator('.note-editor__status')).toHaveText(/Not saved/, { timeout: 25_000 })
    await page.reload()   // the fault stays active across the reload, so no automatic retry can save it first
    await expect(page.getByText(/unsaved draft/)).toBeVisible(); await page.unroute('**/api/curriculum/notes'); await page.getByRole('button', { name: /Restore/ }).click()
    await expect.poll(async () => plain((await noteRow(S.other.id))?.doc), { timeout: 20_000 }).toContain('Draft before reload')
  }))
  await rec.browser('IME composition is not saved half-finished; the committed text is', async () => {
    const cdp = await context.newCDPSession(page); await editor(page).click(); await page.keyboard.press('Control+End')
    const before = plain((await noteRow(S.other.id))?.doc); let saves = 0; page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/curriculum/notes')) saves++ })
    await cdp.send('Input.imeSetComposition', { text: 'にほ', selectionStart: 2, selectionEnd: 2 }); await page.waitForTimeout(2500)
    expect(saves, 'no save while the composition is in progress').toBe(0); expect(plain((await noteRow(S.other.id))?.doc)).toBe(before)
    await cdp.send('Input.insertText', { text: '日本' }); await expect.poll(async () => plain((await noteRow(S.other.id))?.doc), { timeout: 15_000 }).toContain('日本')
  })
  await rec.browser('another account in the same browser never sees this account\'s draft or note', async () => {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`roadmap-note-draft:${S.id}:reading:${S.other.id}`, JSON.stringify({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'FIRST ACCOUNT SECRET DRAFT' }] }] }, at: new Date().toISOString(), base: 1 })])
    await context.clearCookies(); await login(page, db, S.email2, url)
    await expect(editor(page)).toBeVisible(); expect(await page.locator('body').innerText()).not.toContain('FIRST ACCOUNT SECRET'); expect(await page.locator('body').innerText()).not.toContain('Tab two text'); await expect(page.getByText(/unsaved draft/)).toHaveCount(0)
    await context.clearCookies(); await login(page, db, S.email, '/app/curriculum')
  })
  await page2.close()
})

test('6 cards: edit with a stale second tab, delete, Again delay, competing ratings, a lost response, quota in the database test', async ({ page, context }) => {
  const url = `/app/curriculum/${S.third.topic_id}/${S.third.id}?tab=cards`
  await login(page, db, S.email, url)
  const add = async (f: string, b: string) => { await page.getByLabel('Front').fill(f); await page.getByLabel('Back').fill(b); await page.getByRole('button', { name: 'Add card' }).click(); await expect(page.getByText(f, { exact: true })).toBeVisible() }
  await rec.browser('create two cards; an edit applies once and bumps the revision', async () => {
    await add('Card A front', 'Card A back'); await add('Card B front', 'Card B back')
    const rowA = page.locator('li', { hasText: 'Card A front' }); await rowA.getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('Front', { exact: true }).last().fill('Card A front (edited)'); await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText('Card A front (edited)')).toBeVisible(); expect((await cards(S.third.id)).find(c => c.front.includes('edited'))!.revision).toBe(2)
  })
  await rec.browser('a stale edit from a second tab changes nothing, shows the saved version, and keeps the student\'s own text', () => se.expecting([{ label: 'the deliberate stale-card conflict (409)', url: /\/api\/curriculum\/flashcards$/, statuses: [409], min: 1, max: 2 }], async () => {
    const p2 = await context.newPage(); se.attach(p2); await p2.goto(url)
    const row2 = p2.locator('li', { hasText: 'Card B front' }); await row2.getByRole('button', { name: 'Edit' }).click()
    await page.locator('li', { hasText: 'Card B front' }).getByRole('button', { name: 'Edit' }).click(); await page.getByLabel('Front', { exact: true }).last().fill('Card B front (tab one)'); await page.getByRole('button', { name: 'Save', exact: true }).click(); await expect(page.getByText('Card B front (tab one)')).toBeVisible()
    await p2.getByLabel('Front', { exact: true }).last().fill('Card B front (tab two)'); await p2.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(p2.getByRole('alert').filter({ hasText: /changed somewhere else/ })).toBeVisible(); await expect(p2.getByLabel('Front', { exact: true }).last()).toHaveValue('Card B front (tab two)')
    expect((await cards(S.third.id)).some(c => c.front.includes('tab two'))).toBe(false)
    await p2.getByRole('button', { name: /Save my text anyway/ }).click(); await expect.poll(async () => (await cards(S.third.id)).some(c => c.front.includes('tab two'))).toBe(true); await p2.close()
  }))
  await rec.browser('Again: the card is not re-queued now; it returns after the real ten minutes, shown as a time', async () => {
    await page.reload(); await page.getByRole('button', { name: /Review 2 due/ }).click()
    await page.getByRole('button', { name: 'Show the answer' }).click(); await page.getByRole('button', { name: 'Again' }).click()
    await expect(page.getByText(/1 coming back later/)).toBeVisible()
    const again = (await cards(S.third.id)).find(c => c.lapses === 1)!; const delay = new Date(again.due_at).getTime() - Date.now(); expect(delay).toBeGreaterThan(8 * 60_000); expect(delay).toBeLessThan(11 * 60_000)
    await page.getByRole('button', { name: 'Show the answer' }).click(); await page.getByRole('button', { name: 'Easy' }).click()
    await expect(page.getByText(/come[s]? back at/)).toBeVisible(); await page.getByRole('button', { name: 'Check again' }).click(); await expect(page.getByText('Not due yet.')).toBeVisible()
  })
  await rec.browser('a lost rating response then Retry: one durable change; the card is not advanced twice', () => se.expecting([{ label: 'the injected lost rating response', url: /\/api\/curriculum\/flashcards$/, failed: true, min: 1, max: 3 }], async () => {
    // SEEDED: the earlier steps rated both cards, so one fresh card that is due now is inserted directly (not a UI step).
    expect((await db.from('flashcards').insert({ user_id: S.id, scope_type: 'reading', scope_id: S.third.id, front: 'Card C front', back: 'Card C back' })).error).toBeNull()
    await page.reload(); await page.getByRole('button', { name: /Review \d+ due/ }).click(); await page.getByRole('button', { name: 'Show the answer' }).click()
    const target = (await cards(S.third.id)).filter(c => new Date(c.due_at).getTime() <= Date.now())[0]; const before = target.revision
    await page.route('**/api/curriculum/flashcards', async r => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('failed') } else await r.continue() })
    await page.getByRole('button', { name: 'Good' }).click(); await expect(page.locator('.flashcard-review [role=alert]')).toContainText(/safe to repeat|not confirmed/i)
    await page.unroute('**/api/curriculum/flashcards'); await page.getByRole('button', { name: 'Good' }).click()
    await expect(page.getByText(/already been saved|reviewed/).first()).toBeVisible()
    const after = (await db.from('flashcards').select('revision, reps').eq('id', target.id).single()).data!; expect(after.revision).toBe(before + 1); expect(after.reps).toBe(target.reps + 1)
  }))
  await rec.api('competing ratings with different keys at one revision: exactly one applies, the other is told the card changed (same facts as the database test, through the real route)', async () => {
    const sess = (await import('../../../scripts/lib/e2eSession')).createSession(db, S.email); expect(await sess.signIn()).toBe(true)
    const c = (await cards(S.third.id))[0]
    const [x, y] = await Promise.all(['again', 'easy'].map(rating => sess.json('/api/curriculum/flashcards', { method: 'POST', headers: J, body: JSON.stringify({ action: 'review', cardId: c.id, rating, expectedRevision: c.revision, requestKey: crypto.randomUUID() }) })))
    expect([x, y].filter(r => r.status === 200).length).toBe(1); expect([x, y].filter(r => r.status === 409 && r.body?.code === 'STALE_CARD').length).toBe(1)
  })
  await rec.browser('a competing rating parks the stale card until its newly saved due time', () => se.expecting([{ label: 'the deliberate stale rating conflict (409)', url: /\/api\/curriculum\/flashcards$/, statuses: [409], min: 1, max: 1 }], async () => {
    const { data: card, error } = await db.from('flashcards').insert({ user_id: S.id, scope_type: 'reading', scope_id: S.third.id, front: 'Competing review', back: 'Answer' }).select('id, revision').single()
    expect(error).toBeNull()
    await page.reload()
    await page.getByRole('button', { name: /Review 1 due/ }).click()
    await page.getByRole('button', { name: 'Show the answer' }).click()
    const sess = (await import('../../../scripts/lib/e2eSession')).createSession(db, S.email)
    expect(await sess.signIn()).toBe(true)
    const reply = await sess.json('/api/curriculum/flashcards', { method: 'POST', headers: J, body: JSON.stringify({ action: 'review', cardId: card!.id, rating: 'again', expectedRevision: card!.revision, requestKey: crypto.randomUUID() }) })
    expect(reply.status).toBe(200)
    await page.getByRole('button', { name: 'Good' }).click()
    await expect(page.getByText(/was rescheduled elsewhere/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show the answer' })).toHaveCount(0)
    expect((await db.from('flashcards').select('revision').eq('id', card!.id).single()).data?.revision).toBe(card!.revision + 1)
  }))
  await rec.browser('delete asks first; a failed delete is NOT a deletion; a real delete removes it once', () => se.expecting([{ label: 'the injected delete failure', url: /\/api\/curriculum\/flashcards$/, failed: true, min: 1, max: 2 }], async () => {
    await page.reload(); const total = (await cards(S.third.id)).length
    const row = page.locator('li', { hasText: 'Card A front (edited)' }); await row.getByRole('button', { name: 'Delete' }).click(); await expect(row.getByText('Delete this card?')).toBeVisible()
    await page.route('**/api/curriculum/flashcards', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())
    await row.getByRole('button', { name: 'Yes, delete' }).click(); await expect(page.getByRole('alert').filter({ hasText: /was not deleted/i })).toBeVisible(); expect((await cards(S.third.id)).length).toBe(total)
    await page.unroute('**/api/curriculum/flashcards'); await row.getByRole('button', { name: 'Yes, delete' }).click(); await expect.poll(async () => (await cards(S.third.id)).length).toBe(total - 1)
  }))
  await rec.api('card actions wrote no evidence or repair state', async () => { expect(await evidenceCount()).toBe(S.state.evidence); expect(await repairCount()).toBe(S.state.repairs) })
})

test('9 drafts from my own note text: valid (edit, select, save once), grounded-only, malformed, provider error, timeout; manual cards unaffected', async ({ page }) => {
  test.setTimeout(180_000)
  const url = `/app/curriculum/${S.fsa.topic_id}/${S.fsa.id}?tab=cards`
  await login(page, db, S.email, url)
  const drafter = page.locator('.flashcards__drafter')
  await rec.browser('the drafter is opt-in: nothing is generated on load, and the excerpt is the student\'s own text', async () => {
    expect(providerCalls).toBe(0); await page.getByRole('button', { name: /Draft cards from my note/ }).click()
    await drafter.getByLabel('Text to draw cards from').fill(NOTE_TEXT); await expect(drafter).toContainText(/not checked against any course material/); expect(providerCalls).toBe(0)
  })
  await rec.browser('valid output: ungrounded "approved" card is dropped; the student edits, selects and saves; a lost response then retry creates ONE card', () => se.expecting([{ label: 'the injected lost card-create response', url: /\/api\/curriculum\/flashcards$/, failed: true, min: 1, max: 2 }], async () => {
    mode = 'valid'; await drafter.getByRole('button', { name: /Draft up to 5 cards/ }).click()
    await expect(drafter.getByLabel('Draft 1 front')).toHaveValue('What does duration measure?'); await expect(drafter.getByLabel('Draft 3 front')).toHaveCount(0); await expect(drafter).toContainText(/2 draft\(s\) were discarded/)
    await expect(drafter).toContainText('From your note:'); await expect(drafter).toContainText(/does not prove they mean what your note means/); await expect(drafter.getByRole('checkbox').first()).not.toBeChecked(); await expect(drafter.getByRole('button', { name: 'Save selected cards' })).toBeDisabled()
    await drafter.getByLabel('Draft 2 front').fill('What does convexity capture? (edited)'); await drafter.getByRole('checkbox').nth(1).check()
    const before = (await cards(S.fsa.id)).length
    await page.route('**/api/curriculum/flashcards', async r => { if (r.request().method() === 'POST') { await r.fetch(); await r.abort('failed') } else await r.continue() })
    await drafter.getByRole('button', { name: 'Save selected cards' }).click(); await expect(drafter.getByRole('alert').first()).toBeVisible()
    await page.unroute('**/api/curriculum/flashcards'); await drafter.getByRole('button', { name: 'Save selected cards' }).click()
    await expect(drafter).toContainText(/1 card saved|saved/)
    const after = await cards(S.fsa.id); expect(after.length).toBe(before + 1); expect(after.filter(c => c.front.includes('(edited)')).length).toBe(1); expect(after.find(c => c.front.includes('(edited)'))!.source).toBe('note_draft')
  }))
  await rec.browser('malformed output, a provider error and a timeout each leave the excerpt, save nothing, and manual cards still work', () => se.expecting([{ label: 'deliberate draft failures (502/504)', url: /\/api\/curriculum\/flashcards\/draft$/, statuses: [502, 504], min: 3, max: 4 }], async () => {
    const before = (await cards(S.fsa.id)).length
    for (const m of ['malformed', 'error'] as const) { mode = m; await drafter.getByRole('button', { name: /Draft up to 5 cards/ }).click(); await expect(drafter.getByRole('alert')).toContainText(/Nothing was saved|did not work|could not be used/); await expect(drafter.getByLabel('Text to draw cards from')).toHaveValue(NOTE_TEXT) }
    mode = 'hang'; await drafter.getByRole('button', { name: /Draft up to 5 cards/ }).click(); await expect(drafter.getByRole('alert')).toContainText(/took too long/, { timeout: 40_000 }); mode = 'valid'
    expect((await cards(S.fsa.id)).length).toBe(before)
    await page.getByLabel('Front', { exact: true }).first().fill('Manual after failure'); await page.getByLabel('Back', { exact: true }).first().fill('Still works.'); await page.getByRole('button', { name: 'Add card' }).click(); await expect(page.getByText('Manual after failure')).toBeVisible()
  }))
  await rec.api('drafts and saved cards created no evidence, repair state or shared-bank item', async () => { expect(await evidenceCount()).toBe(S.state.evidence); expect(await repairCount()).toBe(S.state.repairs); expect(((await db.from('assessment_items').select('id').ilike('stem', '%convexity capture%')).data ?? []).length).toBe(0) })
})

test('7b a deck beyond 1,000 cards: exact counts, pagination, search, filters, a failed later page, due list', async ({ page }) => {
  const scope = S.covered[1].id, sub = S.covered[1].topic_id
  await rec.api('SEEDED: 1,200 cards for one reading (bulk insert by the fixture owner)', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({ user_id: S.id, scope_type: 'reading', scope_id: scope, front: `Bulk card ${i + 1}`, back: `Answer ${i + 1}`, due_at: new Date(Date.now() + (i < 30 ? -3600_000 : 7 * 86400_000)).toISOString() }))
    for (let i = 0; i < rows.length; i += 400) expect((await db.from('flashcards').insert(rows.slice(i, i + 400))).error).toBeNull()
  })
  await login(page, db, S.email, `/app/curriculum/${sub}/${scope}?tab=cards`)
  await rec.browser('the count is exact (not capped at a page), 30 are due, and the first page shows 50 with Show more', async () => {
    await expect(page.getByText(/1200 cards · 30 due now/)).toBeVisible(); await expect(page.locator('.flashcards__list > li')).toHaveCount(50); await expect(page.getByRole('button', { name: /Show more \(1150 more\)/ })).toBeVisible(); await noHorizontalOverflow(page)
  })
  await rec.browser('a failed later page keeps what is loaded, says so, and Try again loads it', () => se.expecting([{ label: 'the injected failed second page', url: /\/api\/curriculum\/flashcards\?.*offset=50/, statuses: [503], min: 1, max: 2 }], async () => {
    await page.route(/\/api\/curriculum\/flashcards\?.*offset=50/, r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, code: 'unavailable', error: 'Your cards could not be loaded just now. Nothing was changed; try again shortly.' }) }))
    await page.getByRole('button', { name: /Show more/ }).click(); await expect(page.getByRole('alert').filter({ hasText: /could not be loaded/ })).toBeVisible(); await expect(page.locator('.flashcards__list > li')).toHaveCount(50)
    await page.unroute(/\/api\/curriculum\/flashcards\?.*offset=50/); await page.getByRole('button', { name: 'Try again' }).click(); await expect(page.locator('.flashcards__list > li')).toHaveCount(100)
  }))
  await rec.browser('search and the due filter narrow the list from the server, with true match counts', async () => {
    await page.getByLabel('Search cards').fill('Bulk card 1199'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect(page.locator('.flashcards__list > li')).toHaveCount(1)
    // The unfiltered reply that Clear search asks for is held back, so it lands after the newer "due" reply: the newer choice must stay on screen.
    const slowAll = /\/api\/curriculum\/flashcards\?.*offset=0&filter=all$/
    await page.route(slowAll, async r => { await new Promise(x => setTimeout(x, 1500)); await r.continue() })
    const late = page.waitForResponse(slowAll)
    await page.getByRole('button', { name: 'Clear search' }).click(); await page.getByLabel('Show').selectOption('due'); await expect(page.locator('.flashcards__list > li')).toHaveCount(30)
    await (await late).finished(); await page.waitForTimeout(500)
    await expect(page.locator('.flashcards__list > li')).toHaveCount(30); await expect(page.getByLabel('Show')).toHaveValue('due')
    await page.unroute(slowAll)
  })
  await rec.browser('the cross-scope due page counts exactly and reviews the first page while saying how many follow', async () => {
    const dueNow = ((await db.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', S.id).eq('suspended', false).lte('due_at', new Date().toISOString())).count) ?? -1; expect(dueNow).toBeGreaterThanOrEqual(30)
    await page.goto('/app/curriculum/flashcards'); await expect(page.getByText(new RegExp(`${dueNow} cards due`))).toBeVisible(); if (dueNow > 50) await expect(page.getByText(/showing the first 50/)).toBeVisible(); else await expect(page.getByText(/showing the first/)).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Your cards by reading' })).toBeVisible(); await noHorizontalOverflow(page)
    await page.goto('/app/'); await expect(page.getByText(new RegExp(`${dueNow} recall cards due`))).toBeVisible()
    const totalCards = ((await db.from('flashcards').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count) ?? -1
    await page.goto('/app/curriculum?f=cards'); await expect(page.getByLabel('Where you are')).toContainText(new RegExp(`${dueNow} cards? due for recall practice`))   // the workspace summary, Home and the Cards page all show the same exact count
    await expect(page.locator('.curriculum-outline').getByRole('link', { name: /Cards \(\d+ due\)/ }).first()).toBeVisible(); expect(totalCards).toBeGreaterThanOrEqual(1200)
  })
})

test('4 the notes index finds a note by its FULL text (well past 160 characters), in reading and subject notes, and opens the right one', async ({ page }) => {
  const long = (term: string) => `${'Some preliminary study words to push the interesting part well past the preview. '.repeat(4)}${term}`
  await login(page, db, S.email, `/app/curriculum/${S.third.topic_id}/${S.third.id}?tab=notes`)
  await rec.browser('write a reading note and a subject note whose distinctive terms sit beyond the first 160 characters', async () => {
    await editor(page).click(); await page.keyboard.type(long('zeppelin-clause is the term'), { delay: 0 })
    await expect.poll(async () => plain((await noteRow(S.third.id))?.doc), { timeout: 20_000 }).toContain('zeppelin-clause')
    await page.goto(`/app/curriculum/${S.fsa.topic_id}?tab=notes`); await editor(page).click(); await page.keyboard.type(long('harpsichord-term lives here'), { delay: 0 })
    await expect.poll(async () => plain((await db.from('curriculum_notes').select('doc').eq('user_id', S.id).eq('scope_type', 'subject').eq('scope_id', S.fsa.topic_id).maybeSingle()).data?.doc), { timeout: 20_000 }).toContain('harpsichord-term')
  })
  await rec.browser('searching a term beyond the preview finds exactly that reading note, shows a window around the match, and opens it with a way back', async () => {
    await page.goto('/app/curriculum?view=notes'); await page.getByLabel('Search your notes').fill('zeppelin-clause'); await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.locator('.note-index li')).toHaveCount(1); await expect(page.locator('.note-index li').first()).toContainText('zeppelin-clause'); await expect(page.locator('.note-index li a').first()).toContainText(S.third.title.slice(0, 15))
    await page.locator('.note-index a').first().click(); await expect(page).toHaveURL(new RegExp(`/${S.third.id}.*tab=notes`)); await expect(editor(page)).toContainText('zeppelin-clause')
  })
  await rec.browser('the same for a SUBJECT note', async () => {
    await page.goto('/app/curriculum?view=notes'); await page.getByLabel('Search your notes').fill('harpsichord-term'); await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.locator('.note-index li')).toHaveCount(1); await expect(page.locator('.note-index li').first()).toContainText('subject'); await page.locator('.note-index a').first().click(); await expect(page).toHaveURL(new RegExp(`/${S.fsa.topic_id}\\?.*tab=notes`)); await expect(editor(page)).toContainText('harpsichord-term')
  })
  await login(page, db, S.email, '/app/curriculum?view=notes')

  await rec.browser('the notes index lists scope, preview and saved time; search by note text; a hit opens that reading\'s Notes with a way back', async () => {
    await expect(page.locator('.note-index li').first()).toBeVisible(); await page.getByLabel('Search your notes').fill('performance obligation'); await page.getByRole('button', { name: 'Search' }).click()
    await expect(page.locator('.note-index li')).toHaveCount(1); await page.locator('.note-index a').first().click()
    await expect(page).toHaveURL(/tab=notes/); await expect(editor(page)).toContainText('performance obligation'); await page.getByRole('link', { name: /Back/ }).click(); await expect(page).toHaveURL(/view=notes/)
    await noHorizontalOverflow(page)
  })
})
