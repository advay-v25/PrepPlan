/**
 * Phase 2 (desktop and 390px): consistent progress, honest assessment actions and a trustworthy Coach.
 * One ordinary class-led throwaway student per project, deleted afterwards. Steps marked "fixture" are setup written directly to the database and are
 * recorded as such; every assertion about saved state reads the database after the UI acted. No expected failures are allowed, except ONE narrow
 * allowance: the ordered-move refusal is an intentional 409 on exactly POST /api/coach/proposals/<id> (and its console line), only while that step runs.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createStudent, classLedPersona } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, recorder, RUN, chooseClassDay } from './helpers'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '', cycle: '', tz: 'Europe/London', today: '', topic: '', reading: '', outcome: { id: '', code: '', title: '' }, apptId: '', attemptId: '' }
const unexpected: string[] = []
const fixtureBlueprints: string[] = []   // exact ids of the fixture blueprint/form behind the routing-only attempt
let expectRefusal = false

test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => {
  page.on('requestfailed', r => { if (r.failure()?.errorText === 'net::ERR_ABORTED') return; unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`) })
  page.on('response', r => { if (expectRefusal && r.status() === 409 && r.request().method() === 'POST' && /\/api\/coach\/proposals\/[0-9a-f-]{36}$/.test(r.url())) return; if (r.status() >= 400) unexpected.push(`HTTP ${r.status()} ${r.url()}`) })
  page.on('console', m => { if (m.type() === 'error' && expectRefusal && /status of 409/.test(m.text())) return; if (m.type() === 'error') unexpected.push(`${page.url()} ${m.text().slice(0, 600)}`) })
  page.on('pageerror', e => unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 300)}`))
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message), error: r.error?.message }) }
  for (const id of fixtureBlueprints.splice(0)) { const r = await db.from('assessment_blueprints').delete().eq('id', id); cleanup.push({ what: `fixture blueprint ${id}`, ok: !r.error, error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase2-truth-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name,
    allowance: 'ONE intentional 409 on POST /api/coach/proposals/<id> during the ordered-move refusal step only', steps: rec.rows, cleanup, unexpected }, null, 2))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})

async function fitsViewport(page: Page) {
  const w = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  expect(w.scroll, `horizontal overflow on ${page.url()} (${JSON.stringify(w)})`).toBeLessThanOrEqual(w.client + 1)
  expect(w.client).toBeLessThanOrEqual(page.viewportSize()!.width)
}
const coverageTile = (page: Page) => page.getByRole('region', { name: 'How you are progressing' }).getByRole('link', { name: /^Covered/ })
const lastCoach = (page: Page) => page.locator('.coach-message--coach').last()

async function logClass(page: Page, classDay: string, extent: 'All of it' | 'Part of it') {
  await page.goto('/app/calendar/log-class'); await fitsViewport(page)
  await chooseClassDay(page, classDay); await page.getByRole('radio', { name: /We covered new material/ }).check()
  await page.getByLabel('Subject').selectOption(S.topic); await page.getByLabel('Reading').selectOption(S.reading)
  await page.getByText(new RegExp(`^${S.outcome.code}\\.`)).first().click(); await page.getByRole('radio', { name: extent }).nth(0).check()
  if (extent === 'Part of it') await page.getByRole('textbox', { name: /Which part of/ }).first().fill('the definition only')
  await page.getByRole('button', { name: 'Preview the plan update' }).click(); await expect(page.getByRole('heading', { name: 'What will be added to your week' })).toBeVisible()
  await page.getByRole('button', { name: 'Finish class log' }).click(); await page.waitForURL(u => !u.pathname.includes('log-class'))
}
async function ask(page: Page, message: string) {
  const box = page.getByRole('textbox', { name: 'Ask the coach' }); await expect(box).toBeVisible()
  const before = await page.locator('.coach-message--coach').count()
  await box.fill(message); await box.press('Enter')
  await expect.poll(async () => page.locator('.coach-message--coach').count(), { timeout: 60_000 }).toBeGreaterThan(before)
  await expect(page.getByText('Checking your evidence…')).toHaveCount(0, { timeout: 60_000 })
  return lastCoach(page)
}
const counts = async () => Object.fromEntries(await Promise.all(['plan_blocks', 'block_scope_confirmations', 'evidence_events', 'assessment_attempts', 'coach_proposals', 'mock_outcomes', 'class_sessions'].map(async t => [t, (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', S.id)).count]))) as Record<string, number>

test('partial class -> Home/Tests agree -> whole confirmation -> they agree again; unavailable bank; saved external mock with no booking; resume/result routing; ordered-move refusal', async ({ page }) => {
  test.setTimeout(540_000)
  const persona = await classLedPersona(db)
  const c = await createStudent(db, `p2${RUN}`, { onboard: true, onboarding: persona.options, register: id => owned.push(id) })
  S.id = c.id; S.email = c.email
  const cyc = (await db.from('planning_cycles').select('id, timezone').eq('user_id', c.id).eq('status', 'active').single()).data!
  S.cycle = cyc.id as string; S.tz = (cyc.timezone as string) || S.tz
  S.today = new Intl.DateTimeFormat('en-CA', { timeZone: S.tz }).format(new Date())
  // Seven days back, so two of this student's Tuesday/Thursday classes are always in the past, even on a class morning.
  await db.from('planning_cycles').update({ starts_at_local: addDays(S.today, -7), ends_at_local: addDays(S.today, 9) }).eq('id', S.cycle)
  await db.from('profiles').update({ max_session_minutes: 45 }).eq('id', c.id)
  await login(page, db, c.email)
  const ctx = await page.evaluate(async () => (await fetch('/api/class-log/context')).json())
  const days = (ctx.context.pendingDates as string[]).slice().sort(); expect(days.length).toBeGreaterThanOrEqual(2)
  for (const r of ((await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(40)).data ?? [])) {
    const los = (await db.from('reading_los').select('id, code, title').eq('reading_id', r.id).order('sequence').limit(1)).data ?? []
    if (!los[0]) continue
    const p = await page.evaluate(async ([d, o]) => (await fetch('/api/class-log/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classDate: d, kind: 'covered', items: [{ outcomeId: o, extent: 'part', portionNote: 'x', studiedInClass: false }] }) })).json(), [days[0], los[0].id])
    if (p.ok) { S.reading = r.id as string; S.topic = r.topic_id as string; S.outcome = los[0] as any; break }
  }
  expect(S.outcome.id).toBeTruthy()

  await rec.browser('log the class as only PART of an outcome (browser form, preview then confirm)', async () => { await logClass(page, days[0], 'Part of it') })
  await rec.browser('Home and Tests agree: one outcome is partly covered, none is confirmed whole, and Tests lists it as not yet testable', async () => {
    await page.goto('/app'); await fitsViewport(page)
    const sig = await page.evaluate(async () => (await fetch('/api/signals')).json())
    expect(sig.signals.position.whole).toBe(0); expect(sig.signals.position.partial).toBe(1)
    const { covered, total, partial } = sig.signals.position.readings
    expect(partial).toBeGreaterThan(0)
    await expect(coverageTile(page)).toContainText(`${covered}/${total}`)
    await expect(coverageTile(page)).toContainText(`${partial} partly`)
    await page.goto('/app/tests'); const pending = page.getByTestId('pending-portions'); await expect(pending).toBeVisible(); await expect(pending).toContainText(S.outcome.title); await fitsViewport(page)
    await page.reload(); await expect(page.getByTestId('pending-portions')).toBeVisible()   // reload keeps it
  })
  await rec.browser('log a later class as ALL of it: Home now says one whole outcome confirmed, Tests no longer lists it as pending (same outcome, not double counted)', async () => {
    await logClass(page, days[1], 'All of it')
    await page.goto('/app')
    const sig = await page.evaluate(async () => (await fetch('/api/signals')).json())
    expect(sig.signals.position.whole).toBe(1); expect(sig.signals.position.partial).toBe(0); expect(sig.signals.position.exposed).toBe(1)
    const { covered, total, partial } = sig.signals.position.readings
    await expect(coverageTile(page)).toContainText(`${covered}/${total}`)
    if (partial) await expect(coverageTile(page)).toContainText(`${partial} partly`)
    else await expect(coverageTile(page)).not.toContainText('partly')
    await page.goto('/app/tests'); await expect(page.getByTestId('pending-portions')).toHaveCount(0); await fitsViewport(page)
  })

  await rec.browser('zero eligible bank: Coach explains limited availability, offers NO "start paper", and links to the availability view', async () => {
    await page.goto('/app/coach'); await fitsViewport(page)
    const reply = await ask(page, 'What should I focus on next?')
    const t = (await reply.innerText()).replace(/\s+/g, ' ')
    expect(t).not.toMatch(/Start paper|can be started now/); expect(t).toMatch(/not enough approved, unseen questions|no completed, eligible study|confirm what you covered/i)
    await expect(reply.getByRole('link', { name: /Go to this week’s paper/ })).toHaveCount(0)
    const link = reply.getByRole('link', { name: /assessment availability|Open Calendar|Confirm what you covered/ }).first(); await expect(link).toBeVisible()
    await fitsViewport(page)
  })

  await rec.api('fixture: a completed external mock (48%) with NO upcoming appointment', async () => {
    S.apptId = randomUUID(); const d = addDays(S.today, -12)
    await db.from('mock_appointments').insert({ id: S.apptId, user_id: S.id, kind: 'provider_mock', planned_date: d, status: 'completed', label: 'Provider mock' }).throwOnError()
    await db.from('mock_outcomes').insert({ user_id: S.id, checkpoint_id: S.apptId, planned_date: d, actual_date: d, kind: 'provider_mock', label: 'Provider mock', outcome: 'taken', reported_result: '48%', notes: 'FSA 35%, Fixed Income 40%. Ran out of time; changed right answers to wrong.' }).throwOnError()
    expect((await db.from('mock_appointments').select('id').eq('user_id', S.id).eq('status', 'planned')).data).toHaveLength(0)
  })
  await rec.browser('Coach: the exact poor-mock message uses the SAVED report (labelled self-reported), links to it, diagnoses nothing, and writes nothing', async () => {
    await page.goto('/app/coach'); await expect(page.getByTestId('coach-last-mock')).toContainText('48%')
    const before = await counts()
    const reply = await ask(page, 'My February mock was 48%; FSA 35%, Fixed Income 40%. I ran out of time and changed right answers to wrong.')
    const t = (await reply.innerText()).replace(/\s+/g, ' ')
    expect(t).toMatch(/“48%”/); expect(t).toMatch(/your own report/); expect(t).toMatch(/not test evidence/); expect(t).not.toMatch(/cannot see a mock/)
    expect(t).not.toMatch(/you will pass|on track|probab|because you/i)
    const link = reply.getByRole('link', { name: 'Open your saved mock report' }); await expect(link).toHaveAttribute('href', new RegExp(`appointment=${S.apptId}`))
    await expect(reply.getByText('Suggested change')).toHaveCount(0)
    expect(await counts()).toEqual(before)
    const msg = (await db.from('coach_messages').select('turn_meta').eq('user_id', S.id).eq('role', 'coach').order('created_at', { ascending: false }).limit(1)).data![0]
    rec.rows.push({ step: `evidence: interpretation source for the poor-mock message = ${(msg.turn_meta as any)?.source}, fallback=${(msg.turn_meta as any)?.fallback}, reason=${(msg.turn_meta as any)?.fallbackReason}`, status: 'pass', how: 'endpoint-supplement' })
    await link.click(); await page.waitForURL(/\/app\/calendar/); expect(page.url()).toContain(`appointment=${S.apptId}`); await expect(page.locator('body')).toContainText('48%'); await fitsViewport(page)
  })
  await rec.browser('Coach: "I finished the syllabus and revised it once." is preparation context: acknowledged, nothing recorded, the position editor offered, not refused as teaching', async () => {
    await page.goto('/app/coach'); const before = await counts()
    const reply = await ask(page, 'I finished the syllabus and revised it once.')
    const t = (await reply.innerText()).replace(/\s+/g, ' ')
    expect(t).toMatch(/have not changed your coverage, revision status or calendar/); expect(t).not.toMatch(/teach the chapter|does not teach/)
    await expect(reply.getByRole('link', { name: 'Update where you are in the syllabus' })).toHaveAttribute('href', /onboarding\/position/)
    expect(await counts()).toEqual(before); await fitsViewport(page)
  })

  await rec.api('fixture: an in-progress weekly attempt, then a scored one (routing only; no paper content)', async () => {
    S.attemptId = randomUUID()
    const manifest = (await db.from('curriculum_manifests').select('id').eq('is_active', true).limit(1).single().throwOnError()).data!.id as string
    const bp = (await db.from('assessment_blueprints').insert({ manifest_id: manifest, purpose: 'diagnostic' }).select('id').single().throwOnError()).data!.id as string; fixtureBlueprints.push(bp)
    const form = (await db.from('assessment_forms').insert({ blueprint_id: bp }).select('id').single().throwOnError()).data!.id as string
    await db.from('assessment_attempts').insert({ id: S.attemptId, user_id: S.id, cycle_id: S.cycle, form_id: form, attempt_kind: 'weekly', status: 'in_progress', paper_kind: 'diagnostic', started_at: new Date().toISOString() }).throwOnError()
  })
  await rec.browser('resume routing: Coach points to the OWNED attempt (resume), never a new paper', async () => {
    await page.goto('/app/coach'); const reply = await ask(page, 'What should I focus on next?')
    await expect(reply.getByRole('link', { name: 'Resume your paper' })).toHaveAttribute('href', `/app/tests/${S.attemptId}`)
    expect((await reply.innerText())).not.toMatch(/Go to this week’s paper/)
  })
  await rec.api('fixture: the attempt becomes scored', async () => { await db.from('assessment_attempts').update({ status: 'scored', submitted_at: new Date().toISOString() }).eq('id', S.attemptId).throwOnError() })
  await rec.browser('result routing: Coach opens the exact result', async () => {
    await page.goto('/app/coach'); const reply = await ask(page, 'What should I focus on next?')
    await expect(reply.getByRole('link', { name: 'Open your result' })).toHaveAttribute('href', `/app/tests/${S.attemptId}/result`)
  })

  const A = `p2-a-${randomUUID()}`, B = `p2-b-${randomUUID()}`
  const D = addDays(S.today, 2), D2 = addDays(S.today, 4)
  await rec.api('fixture: two ordered sittings of one task on the same day', async () => {
    const row = (id: string, title: string, o: Record<string, unknown>) => ({ id, user_id: S.id, cycle_id: S.cycle, title, detail: '', task_type: 'study', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: D, day: D, duration_minutes: 30, duration: '30', created_by: 'algorithm', dependencies: [], ...o })
    await db.from('plan_blocks').insert([row(A, 'Order probe sitting 1', { sitting_ordinal: 1 }), row(B, 'Order probe sitting 2', { sitting_ordinal: 2, dependencies: [A] })]).throwOnError()
  })
  await rec.browser('ordered-move refusal: the Coach previews the move, the student confirms, the authoritative boundary refuses it with a useful reason and a Calendar link; nothing moved', async () => {
    await page.goto(`/app/coach?task=${A}`)
    const reply = await ask(page, `Move it to ${D2}`)
    await expect(reply.getByRole('group', { name: 'Suggested change' })).toBeVisible()
    const a0 = (await db.from('plan_blocks').select('local_date, revision').eq('id', A).single()).data!
    expectRefusal = true
    await reply.getByRole('button', { name: 'Confirm' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /break the order you planned/ })).toBeVisible({ timeout: 30_000 })
    expectRefusal = false
    const refusal = page.locator('.coach-error[role=alert]'); await expect(refusal).toContainText('Order probe sitting 2'); await expect(refusal).toContainText('Nothing was moved')
    const link = page.getByRole('link', { name: 'Open it in Calendar' }); await expect(link).toHaveAttribute('href', new RegExp(`task=${A}`))
    const a1 = (await db.from('plan_blocks').select('local_date, revision').eq('id', A).single()).data!
    expect(a1).toEqual(a0)
    await fitsViewport(page)
    await link.click(); await page.waitForURL(/\/app\/calendar/); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.getByRole('dialog')).toContainText('Order probe sitting 1')
  })
  await rec.browser('keyboard and focus: the Coach box is reachable by Tab, the drawer traps Tab and Escape returns to the page', async () => {
    for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'))).toBe(true) }
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement && document.activeElement !== document.body)).toBe(true)
    await page.goto('/app/coach'); await page.getByLabel('Ask the coach').waitFor({ state: 'visible' }); await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); let found = false, tabs = 0; const stops: string[] = []
    for (; tabs < 300 && !found; tabs++) {
      await page.keyboard.press('Tab')
      const at = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; return { label: e?.getAttribute('aria-label') ?? '', text: (e?.textContent ?? '').trim().slice(0, 28), where: e?.closest('[class]')?.className?.toString().slice(0, 30) ?? '' } })
      found = at.label === 'Ask the coach'; stops.push(`${at.label || at.text}|${at.where}`)
    }
    expect(found, 'the Coach composer is reachable by keyboard').toBe(true)
    expect(tabs, `the Coach composer was reached after ${tabs} Tab presses; stops 15-45: ${stops.slice(15, 45).join(' > ')}`).toBeLessThanOrEqual(60)
  })
})
