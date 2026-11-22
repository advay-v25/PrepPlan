/**
 * Journey A in a real browser: ONE ordinary fresh student per viewport, driven through the UI.
 * The remaining answers of the weekly paper use the real answer endpoint (documented split); submit, result, follow-up, Coach and weekly review are UI.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { releaseBankLock } from '../../../scripts/lib/bankLock'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { admin, addDays, wd, login, makeBank, destroyBank, noHorizontalOverflow, recorder, RUN } from './helpers'

const db = admin()
const rec = recorder()
const owned: string[] = []
let bankFile: string | null = null, bankRecord: unknown = null
const S: { next?: any; timeFixtures: Record<string, unknown>[]; repairIds?: string[]; attemptId?: string; itemsByStem?: Map<string, any>; nItems?: number; answers?: { id: string; sel: number | null; conf: string }[]; done?: string[]; part?: string[]; id: string; email: string; cycle?: any; tasks?: any[]; quick?: { reading: string; outcomes: string[] }; readings?: string[]; consoleErrors: string[] } = { id: '', email: '', consoleErrors: [], timeFixtures: [] }

test.describe.configure({ mode: 'serial' })
// Every page of every test reports console errors and uncaught page errors. Failures we inject ON PURPOSE (an aborted request) are classified separately.
test.beforeEach(({ page }) => {
  // Only the failures this spec injects on purpose are tolerated, each tied to its endpoint and status; anything else is recorded as unexpected.
  const INJECTED_ABORTS = ['/api/log-learning', '/api/diagnostic/repair/accept', '/api/weekly-review/accept']
  // A browser navigation may abandon the scope drawer read or Home markup prefetch.
  page.on('requestfailed', r => {
    const url = new URL(r.url())
    const navigationRead = url.pathname === '/app' && r.headers().rsc === '1' && url.searchParams.has('_rsc')
    if (r.method() === 'GET' && r.failure()?.errorText === 'net::ERR_ABORTED' && (url.pathname === '/api/tests/scope/confirm' || navigationRead)) return
    if (!INJECTED_ABORTS.some(u => r.url().includes(u))) S.consoleErrors.push(`UNEXPECTED requestfailed ${r.url()} ${r.failure()?.errorText}`)
  })
  page.on('response', async r => {
    if (r.status() < 400 || (r.status() === 409 && r.url().includes('/api/tests/start'))) return
    if (r.status() === 409 && r.url().includes(`/api/tests/attempt/${S.attemptId}/progress`)) {
      // A heartbeat already in flight can finish after this attempt is scored.
      if ((await r.json().catch(() => null))?.code === 'closed') return
    }
    S.consoleErrors.push(`UNEXPECTED HTTP ${r.status()} ${r.url()}`)
  })
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) S.consoleErrors.push(`${page.url()} ${m.text().slice(0, 200)}`) })
  page.on('pageerror', e => S.consoleErrors.push(`${page.url()} PAGEERROR ${e.message.slice(0, 200)}`))
})

test.beforeAll(async () => {
  const st = await createStudent(db, `lb${RUN}`, { onboard: false, register: id => owned.push(id) })
  S.id = st.id; S.email = st.email
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  if (bankFile) { try { destroyBank(bankFile); cleanup.push({ what: 'fixture bank', ok: true }) } catch (e) { cleanup.push({ what: 'fixture bank', ok: false, error: (e as Error).message }) } }
  releaseBankLock()
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/lifecycle-browser-${new Date().toISOString().slice(0, 10)}-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, fixtureBank: bankRecord, consoleErrors: S.consoleErrors, timeFixtures: S.timeFixtures, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([])
  expect(S.consoleErrors, 'unexpected failed requests, HTTP errors, console or page errors (only the injected aborts and the deliberate stale-start 409 are tolerated)').toEqual([])
})

const goContinue = async (page: Page, url: RegExp) => { await page.getByRole('button', { name: 'Continue' }).click(); await page.waitForURL(url) }

test('onboarding in the UI: fresh profile, reload midway, accept the first plan', async ({ page }) => {
  await login(page, db, S.email, '/onboarding/exam')
  await rec.browser('exam step: May 2027 sitting, not registered (a target month, not a booked date)', async () => {
    await page.goto('/onboarding/exam'); await page.getByRole('button', { name: /^May/ }).click(); await page.getByRole('button', { name: 'Not yet' }).click(); await goContinue(page, /route/)
  })
  await rec.browser('route step: on my own (self-study)', async () => { await page.getByRole('button', { name: /^On my own/ }).click(); await goContinue(page, /position/) })
  await rec.browser('position step: starting fresh, no covered topics selected', async () => { await page.getByRole('button', { name: 'Starting fresh' }).click(); await goContinue(page, /week/) })
  await rec.browser('reload midway: leaving and returning keeps the saved answers', async () => {
    await page.reload(); await page.goto('/onboarding/position'); await expect(page.getByRole('button', { name: 'Starting fresh' })).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/onboarding/exam'); await expect(page.getByRole('button', { name: 'Not yet' })).toHaveAttribute('aria-pressed', 'true'); await expect(page.getByRole('button', { name: /^May/ })).toHaveAttribute('aria-pressed', 'true')
    await page.goto('/onboarding/week')
  })
  await rec.browser('week step: weekday evenings and a longer Saturday window, 45-minute sittings, no phantom commitments', async () => {
    await page.getByRole('button', { name: /^Weekday evenings/ }).click()
    await page.getByRole('button', { name: /^Weekends/ }).click()
    // The fixture needs two whole readings and a partial one even on a Friday evening.
    await page.getByLabel('Saturday end').fill('19:00')
    await page.getByRole('button', { name: '45 min' }).click()
    await goContinue(page, /plan/)
  })
  await rec.browser('review step: the first plan is shown with its real boundaries; nothing demands uploads or sources; accept', async () => {
    await expect(page.getByRole('heading', { name: 'Your first week' })).toBeVisible()
    await expect(page.getByText(/Mon\s+\d+ \w+\s*to\s*Sun/i).first().or(page.getByText(/first cycle runs/i))).toBeVisible()
    await noHorizontalOverflow(page)
    await expect(page.getByRole('button', { name: 'Accept and open Calendar' })).toBeEnabled()
    await page.getByRole('button', { name: 'Accept and open Calendar' }).click(); await page.waitForURL(/\/app/)
  })
  await rec.api('saved state matches the inputs (profile, windows, zero reported coverage, cycle Monday–Sunday)', async () => {
    const prof = (await db.from('profiles').select('stage, registered, exam_sitting, exam_date, prep_mode, max_session_minutes, onboarding_status').eq('id', S.id).single()).data
    expect(prof).toEqual({ stage: 'starting_fresh', registered: false, exam_sitting: 'may', exam_date: null, prep_mode: 'self_study', max_session_minutes: 45, onboarding_status: 'complete' })
    expect((await db.from('user_topic_exposure').select('topic_id').eq('user_id', S.id)).data).toEqual([])
    const wins = (await db.from('availability_windows').select('weekday').eq('user_id', S.id).eq('status', 'active')).data ?? []
    expect(wins.length).toBe(7)
    S.cycle = (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data
    expect(wd(S.cycle.starts_at_local)).toBe(1); expect(wd(S.cycle.ends_at_local)).toBe(0)
    S.tasks = (await db.from('plan_blocks').select('id, title, local_date, task_type, lm_id, duration_minutes, execution').eq('cycle_id', S.cycle.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').order('title')).data ?? []
    expect(S.tasks.length).toBeGreaterThan(3)
    expect(S.tasks.every(t => wd(t.local_date) !== 0)).toBe(true)
  })
  await noHorizontalOverflow(page)
})

const openTask = async (page: Page, t: { id: string; local_date: string }) => {
  await page.goto(`/app/calendar?view=agenda&week=${t.local_date}&task=${t.id}`)
  const d = page.getByRole('dialog'); await expect(d).toBeVisible(); return d
}
const eventMinutes = async (id: string) => ((await db.from('task_events').select('actual_duration_minutes').eq('task_id', id).not('actual_duration_minutes', 'is', null)).data ?? []).reduce((a, e) => a + Number(e.actual_duration_minutes), 0)

test('Calendar in the UI: finish one reading, part-do another with minutes, defer one; quick capture on a third', async ({ page }) => {
  await login(page, db, S.email)
  const byReading = new Map<string, any[]>(); for (const t of S.tasks!) byReading.set(t.lm_id, [...(byReading.get(t.lm_id) ?? []), t])
  const readings = [...byReading.keys()]
  expect(readings.length).toBeGreaterThanOrEqual(3)
  // Two readings are finished (so the paper has enough scope to be serviceable), a third is part-done then left.
  const published = new Set((await db.from('student_eligible_items').select('lm_id').in('lm_id', [...readings, 'r028', 'r029', 'r030', 'r031']).throwOnError()).data?.map(row => row.lm_id))
  const [rDone, rDone2] = readings.filter(reading => !published.has(reading))
  const rPart = readings.find(reading => reading !== rDone && reading !== rDone2 && byReading.get(reading)!.length >= 2)
  const quickReading = ['r028', 'r029', 'r030', 'r031'].find(reading => !readings.includes(reading) && !published.has(reading))
  if (!rDone || !rDone2 || !rPart || !quickReading) throw new Error('Need two planned readings and a quick-log reading without published items for this fixture-only paper.')
  S.quick = { reading: quickReading, outcomes: [] }
  S.quick.outcomes = ((await db.from('reading_los').select('id').eq('reading_id', S.quick.reading).order('sequence').limit(2)).data ?? []).map(o => o.id as string)
  S.readings = [rDone, rDone2, rPart]
  const done = [...byReading.get(rDone)!, ...byReading.get(rDone2)!], part = byReading.get(rPart)!
  console.log(`[${test.info().project.name}] planned readings: ${readings.join(', ')}; finish ${rDone}+${rDone2} (${done.length} sittings), part-do ${rPart} (${part.length} sittings), quick capture ${S.quick.reading}`)
  const record = async (t: any, label: 'Done' | 'Partly done', minutes: number) => {
    const d = await openTask(page, t); await d.getByRole('button', { name: label, exact: true }).click()
    await d.getByRole('spinbutton', { name: 'Actual minutes' }).fill(String(minutes))
    await d.getByRole('button', { name: label === 'Done' ? 'Save as done' : 'Save partial progress' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', t.id).single()).data?.execution, { timeout: 20_000 }).toBe(label === 'Done' ? 'completed' : 'partial')
    expect(await eventMinutes(t.id)).toBe(minutes)
  }
  for (const t of done) await rec.browser(`Calendar drawer: "${t.title}" recorded done with ${t.duration_minutes} actual minutes`, () => record(t, 'Done', Number(t.duration_minutes)))
  await rec.browser(`Calendar drawer: "${part[0].title}" recorded partly done with 20 actual minutes`, () => record(part[0], 'Partly done', 20))
  await rec.browser(`Calendar drawer: "${part[1].title}" deferred (left unfinished)`, async () => {
    const d = await openTask(page, part[1]); await d.getByRole('button', { name: 'Defer', exact: true }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', part[1].id).single()).data?.execution, { timeout: 20_000 }).toBe('deferred')
  })
  S.tasks = (await db.from('plan_blocks').select('id, title, local_date, task_type, lm_id, duration_minutes, execution').eq('cycle_id', S.cycle.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').order('title')).data ?? []
  S.done = done.map(t => t.id); S.part = part.map(t => t.id)
  await rec.browser('quick capture page opens with Home/Calendar/Curriculum routes rendering (no horizontal overflow)', async () => {
    for (const path of ['/app/log', '/app/calendar', '/app/curriculum', '/app']) { await page.goto(path); await page.waitForLoadState('networkidle'); await noHorizontalOverflow(page) }
  })
  // ---- quick capture in the UI, with a pre-commit failure and a lost response AFTER commit
  const q = S.quick!
  const rt = (await db.from('curriculum_readings').select('reading_no, title, topic_id').eq('id', q.reading).single()).data!
  const topicName = (await db.from('topics').select('name').eq('id', rt.topic_id).single()).data!.name as string
  const counts = async () => ({ act: (await db.from('learning_activities').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0, blocks: (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0, conf: (await db.from('block_scope_confirmations').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0 })
  const c0 = await counts()
  await page.goto('/app/log')
  await rec.browser('quick capture: pick the reading, two outcomes and 40 minutes', async () => {
    await page.getByRole('tab', { name: topicName }).click()
    await page.getByRole('option', { name: new RegExp(`^${rt.reading_no} `) }).click()
    const boxes = page.getByRole('checkbox'); await expect(boxes.first()).toBeVisible()
    await boxes.nth(0).check(); await boxes.nth(1).check()
    await page.getByText('Enter different minutes').click(); await page.getByRole('spinbutton').first().fill('40')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled()
  })
  const pending = page.getByRole('heading', { name: 'Check a pending save' })
  await rec.browser('PRE-commit failure (request never reaches the server): no success is claimed, nothing is written, the log is kept as a pending retry with its summary', async () => {
    await page.route('**/api/log-learning', r => r.request().method() === 'POST' ? r.abort('failed') : r.continue())
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(pending).toBeVisible(); await expect(page.getByText(/2 selected outcomes · 40 minutes/)).toBeVisible()
    expect(await counts()).toEqual(c0)
  })
  await rec.browser('POST-commit lost response (the server saved, the browser never heard): the UI still says unconfirmed, and the save exists exactly once', async () => {
    await page.unroute('**/api/log-learning')
    await page.route('**/api/log-learning', async r => { if (r.request().method() !== 'POST') return r.continue(); await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Retry same log' }).click()
    await expect.poll(async () => (await counts()).act, { timeout: 20_000 }).toBe(c0.act + 1)
    await expect(pending).toBeVisible()
  })
  await rec.browser('retrying the same log returns the same outcome: still exactly one activity, one Calendar record, one set of confirmations', async () => {
    await page.unroute('**/api/log-learning')
    await page.getByRole('button', { name: 'Retry same log' }).click()
    await expect(pending).toBeHidden()
    expect(await counts()).toEqual({ act: c0.act + 1, blocks: c0.blocks + 1, conf: c0.conf + 2 })
    const cmds = (await db.from('learning_log_commands').select('idempotency_key').eq('user_id', S.id)).data ?? []; expect(cmds.length).toBe(1)
  })
  for (const path of ['/app/log', '/app/calendar', '/app/curriculum', '/app']) { await page.goto(path); await page.waitForLoadState('networkidle'); await noHorizontalOverflow(page) }
})

const attemptCount = async () => (await db.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0
const blockCard = (page: Page, title: string) => page.locator('.scope-panel__block').filter({ hasText: title })

test('Scope and the weekly paper in the UI: confirm scope, a second tab changes it after review, start, answer, refresh, submit', async ({ page, context }) => {
  await login(page, db, S.email)
  const bank = await makeBank([...S.readings!, S.quick!.reading]); bankFile = bank.file; bankRecord = bank.record
  const done = (S.tasks ?? []).filter(t => S.done!.includes(t.id))
  await page.goto('/app/tests')
  await rec.browser('Tests shows the quick-logged outcomes as scope and the finished reading as "confirm what these covered" (unconfirmed shown separately)', async () => {
    await expect(page.getByRole('heading', { name: 'Confirm what these covered' })).toBeVisible()
    for (const t of done) await expect(blockCard(page, t.title)).toBeVisible()
    await noHorizontalOverflow(page)
  })
  await rec.browser('the student confirms the covered outcomes of each finished sitting in the UI', async () => {
    for (const t of done) {
      const card = blockCard(page, t.title); const boxes = card.getByRole('checkbox'); const n = await boxes.count(); expect(n).toBeGreaterThan(0)
      for (let i = 0; i < n; i++) await boxes.nth(i).check()
      await card.getByRole('button', { name: 'Confirm what I covered' }).click()
      await expect.poll(async () => ((await db.from('block_scope_confirmations').select('outcome_id').eq('block_id', t.id)).data ?? []).length, { timeout: 20_000 }).toBe(n)
    }
  })
  const preflightBtn = () => page.getByRole('button', { name: /Review and start|Check again/ }).first()
  await rec.browser('review the weekly paper: the preview reads the scope and creates nothing', async () => {
    await page.goto('/app/tests'); const before = await attemptCount()
    await preflightBtn().click(); await expect(page.getByText(/questions · about/).first()).toBeVisible()
    expect(await attemptCount()).toBe(before)
  })
  await rec.browser('SECOND TAB changes the scope after the review; Start in the first tab refuses: no attempt, no form, the student keeps their view', async () => {
    const p2 = await context.newPage(); await p2.goto('/app/tests')
    const t0 = done[0]; const outs = (await db.from('block_scope_confirmations').select('outcome_id').eq('block_id', t0.id)).data!.map(o => o.outcome_id as string)
    const r = await p2.evaluate(async ({ id, outcomeIds }) => (await fetch('/api/tests/scope/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: id, outcomeIds }) })).json(), { id: t0.id, outcomeIds: outs.slice(0, 1) })
    expect(r.ok, JSON.stringify(r)).toBe(true)
    const attemptsBefore = await attemptCount(), forms = async () => (await db.from('assessment_forms').select('id', { count: 'exact', head: true })).count
    const formsBefore = await forms()
    await page.getByRole('button', { name: 'Start weekly paper' }).click()
    await expect(page.getByRole('alert').first()).toBeVisible()
    expect(await attemptCount()).toBe(attemptsBefore); expect(await forms()).toBe(formsBefore)
    await expect(page).not.toHaveURL(/\/app\/tests\/[0-9a-f-]{36}$/)
    // restore the confirmation from the second tab, then review again
    const r2 = await p2.evaluate(async ({ id, outcomeIds }) => (await fetch('/api/tests/scope/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockId: id, outcomeIds }) })).json(), { id: t0.id, outcomeIds: outs })
    expect(r2.ok).toBe(true); await p2.close()
  })
  await rec.browser('review again and start: the paper opens with its attempt', async () => {
    await page.reload(); await preflightBtn().click(); await expect(page.getByText(/questions · about/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Start weekly paper' }).click(); await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
    S.attemptId = page.url().split('/').pop()!
    expect(await attemptCount()).toBe(1)
  })
  const att = (await db.from('assessment_attempts').select('form_id').eq('id', S.attemptId!).single()).data!
  const pinned = (await db.from('form_items').select('item_id').eq('form_id', att.form_id)).data!.map(p => p.item_id as string)
  const items = (await db.from('assessment_items').select('id, stem, key_index, outcome_id, family_id, provenance').in('id', pinned)).data!
  await rec.api('every delivered question is a recorded fixture-bank question from confirmed scope only, from independent families', async () => {
    expect(pinned.every(id => bank.record.items.includes(id))).toBe(true)
    const confirmed = new Set<string>([...(await db.from('block_scope_confirmations').select('outcome_id').eq('user_id', S.id)).data!.map(o => o.outcome_id as string)])
    expect(items.every(i => confirmed.has(i.outcome_id))).toBe(true)
    expect(items.some(i => String(i.outcome_id).startsWith(`${S.readings![2]}-`))).toBe(false)
    expect(new Set(items.map(i => i.family_id)).size).toBe(items.length)
  })
  S.itemsByStem = new Map(items.map(i => [String(i.stem).trim(), i]))
  S.nItems = items.length
  await noHorizontalOverflow(page)
})

test('the paper in the runner: answers with required confidence, refresh, resume, submit with one omission', async ({ page }) => {
  await login(page, db, S.email, `/app/tests/${S.attemptId}`)
  const stem = async () => (await page.locator('#q-h').innerText()).trim()
  const item = async () => { const it = S.itemsByStem!.get(await stem()); expect(it, 'question belongs to the reserved form').toBeTruthy(); return it! }
  const levels: Record<string, string> = { high: 'Sure', low: 'Guessing' }
  const answers: { id: string; sel: number | null; conf: string }[] = []
  const roles = ['confident_wrong', 'uncertain_correct', 'omitted']
  for (let n = 0; n < S.nItems!; n++) {
    const it = await item(); const key = Number(it.key_index)
    const role = n < 3 ? roles[n] : 'confident_correct'
    const opts = page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio'); const optN = await opts.count()
    if (role === 'omitted') {
      await rec.browser(`question ${n + 1}: skipped (the omission)`, async () => { await page.getByRole('button', { name: 'Skip' }).click() })
      answers.push({ id: it.id, sel: null, conf: '' }); continue
    }
    const sel = role === 'confident_wrong' ? (key + 1) % optN : key, conf = role === 'uncertain_correct' ? 'low' : 'high'
    await rec.browser(`question ${n + 1}: ${role.replace('_', ' ')} saved with confidence`, async () => {
      await opts.nth(sel).click()
      if (n === 0) { await expect(page.getByRole('button', { name: /Next|Review/ }).first()).toBeDisabled() }   // an answer without confidence cannot be left behind
      await page.getByRole('radio', { name: levels[conf], exact: true }).click()
      await expect.poll(async () => ((await db.from('assessment_responses').select('selected_option_index').eq('attempt_id', S.attemptId!).eq('item_id', it.id)).data ?? []).length, { timeout: 20_000 }).toBe(1)
    })
    answers.push({ id: it.id, sel, conf })
    if (n < S.nItems! - 1) await page.getByRole('button', { name: /^Next/ }).click()
    if (n === 1) await rec.browser('refresh mid-paper: the saved answers and confidence survive and the runner resumes at the first unanswered question', async () => {
      await page.reload(); await expect(page.locator('#q-h')).toBeVisible()
      const saved = (await db.from('assessment_responses').select('self_reported_confidence').eq('attempt_id', S.attemptId!)).data!; expect(saved.map(r => r.self_reported_confidence).sort()).toEqual([1, 5])
      expect(S.itemsByStem!.get(await stem())!.id, 'resumes on the third question, not the first').not.toBe(answers[0].id)
    })
  }
  S.answers = answers
  await rec.browser('review screen counts answered and unanswered; submit with the one omission acknowledged', async () => {
    await page.getByRole('button', { name: /^Review/ }).click()
    await expect(page.locator('[data-review-counts]')).toContainText(`${S.nItems! - 1} answered · 1 not answered`)
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Submit for scoring' }).click()
    await page.waitForURL(/\/result/)
  })
  await rec.api('the score ledger and evidence agree with what the student did (answered, omitted, correct, one evidence event per answered question, none for the omission)', async () => {
    const a = (await db.from('assessment_attempts').select('status, score, delivered_count, valid_response_count, correct_response_count, omitted_count, scoreable_count').eq('id', S.attemptId!).single()).data!
    const answered = answers.filter(x => x.sel !== null), correct = answered.filter(x => S.itemsByStem && [...S.itemsByStem.values()].find(i => i.id === x.id)!.key_index === x.sel).length
    expect(a).toMatchObject({ status: 'scored', delivered_count: S.nItems, valid_response_count: answered.length, omitted_count: 1, scoreable_count: S.nItems, correct_response_count: correct })
    expect(a.score).toBe(Math.round(100 * correct / S.nItems!))
    const ev = (await db.from('evidence_events').select('item_id, validity').eq('attempt_id', S.attemptId!)).data!
    expect(ev.length).toBe(answered.length); expect(ev.every(e => e.validity === 'valid')).toBe(true); expect(ev.some(e => e.item_id === answers.find(x => x.sel === null)!.id)).toBe(false)
  })
  await noHorizontalOverflow(page)
})

const repairTasks = async () => (await db.from('plan_blocks').select('id, title, local_date, repair_thread_id, cycle_id').eq('user_id', S.id).eq('task_type', 'repair').is('cancelled_at', null)).data ?? []

test('result, Keep for later, follow-up acceptance (lost responses), exact Calendar task, and Coach on that exact result', async ({ page }) => {
  await login(page, db, S.email, `/app/tests/${S.attemptId}/result`)
  await rec.browser('the result opens with its findings; nothing about repair work has been scheduled', async () => {
    await expect(page.getByRole('heading', { name: /Findings and what to repair/ })).toBeVisible()
    expect((await repairTasks()).length).toBe(0)
    await noHorizontalOverflow(page)
  })
  const threads = async () => (await db.from('repair_threads').select('id, status, concept_id').eq('user_id', S.id).order('id')).data ?? []
  const th0 = await threads()
  await rec.api('two follow-up threads exist for the confident miss and the unstable answer, both open', async () => { expect(th0.length).toBe(2); expect(th0.every(t => ['open', 'proposed'].includes(t.status))).toBe(true) })
  const reviewBtn = () => page.getByRole('button', { name: 'Review follow-up' })
  await rec.browser('Review follow-up: the preview states exactly what would be added and writes nothing', async () => {
    await reviewBtn().click(); await expect(page.getByText(/Nothing is added until you confirm/)).toBeVisible()
    expect((await repairTasks()).length).toBe(0)
  })
  await rec.browser('KEEP FOR LATER (the real control): nothing is added; after leaving and reloading, the same follow-up threads are rediscovered', async () => {
    await page.getByRole('button', { name: 'Keep for later' }).click()
    await expect(page.getByText(/Nothing was added to your calendar/)).toBeVisible()
    expect((await repairTasks()).length).toBe(0)
    await page.goto('/app'); await page.goto('/app/tests'); await page.goto(`/app/tests/${S.attemptId}/result`)
    const names = ((await db.from('curriculum_concepts').select('name').in('id', th0.map(t => t.concept_id))).data ?? []).map(c => c.name as string)
    for (const n of names) await expect(page.locator('body')).toContainText(n)   // the follow-up list sits inside a collapsed section, so presence not visibility
    expect(JSON.stringify(await threads())).toBe(JSON.stringify(th0))
  })
  await rec.browser('Home and Tests still lead back to this result while the follow-up waits', async () => {
    for (const path of ['/app', '/app/tests']) { await page.goto(path); await expect(page.locator(`a[href*="${S.attemptId}"]`).first()).toBeVisible() }
    await page.goto(`/app/tests/${S.attemptId}/result`)
  })
  // The acceptance path needs a week with room. On a late-week run the real
  // first week can be full. Record the owned account's availability premise.
  await db.from('availability_windows').delete().eq('user_id', S.id).throwOnError()
  await db.from('availability_windows').insert([1, 2, 3, 4, 5, 6].map(weekday => ({
    user_id: S.id, weekday, start_time: '06:00', end_time: '23:30', status: 'active',
  }))).throwOnError()
  S.timeFixtures.push({ id: 'repair-room', note: 'Study windows opened on the owned account after proving Keep for later, to exercise acceptance independently of day and clock.' })
  await rec.browser('PRE-commit failure on Confirm: not claimed as saved, nothing written', async () => {
    await reviewBtn().click(); await expect(page.getByText(/Nothing is added until you confirm/)).toBeVisible()
    await page.route('**/api/diagnostic/repair/accept', r => r.abort('failed'))
    await page.getByRole('button', { name: 'Confirm changes' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /not confirmed/i })).toBeVisible()
    expect((await repairTasks()).length).toBe(0)
    await page.unroute('**/api/diagnostic/repair/accept')
  })
  await rec.browser('POST-commit lost response on Confirm: the UI says unconfirmed while the work exists once; confirming again returns the same outcome without duplicates', async () => {
    await page.route('**/api/diagnostic/repair/accept', async r => { await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Confirm changes' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /not confirmed/i })).toBeVisible()
    const committed = await repairTasks(); expect(committed.length).toBe(2)
    await page.unroute('**/api/diagnostic/repair/accept')
    await page.getByRole('button', { name: 'Confirm changes' }).click()
    await expect(page.getByText(/added to your calendar/)).toBeVisible()
    const after = await repairTasks(); expect(after.map(t => t.id).sort()).toEqual(committed.map(t => t.id).sort())
    expect((await db.from('coach_proposals').select('id, status').eq('user_id', S.id).eq('intent', 'diagnostic_repair').eq('status', 'executed')).data!.length).toBe(1)
  })
  await rec.browser('the accepted repair opens in Calendar on exactly that task (the drawer shows it)', async () => {
    const rt = (await repairTasks())[0]
    await page.getByRole('link', { name: /See this repair|Continue repair/ }).first().click()
    await expect(page).toHaveURL(/\/app\/calendar\?/); await expect(page.getByRole('dialog')).toBeVisible()
    const id = new URL(page.url()).searchParams.get('task')!; const row = (await repairTasks()).find(t => t.id === id)
    expect(row, 'the linked task is one of the accepted repairs').toBeTruthy()
    await expect(page.getByRole('dialog')).toContainText(row!.title)
    S.repairIds = (await repairTasks()).map(t => t.id); void rt
  })
  // ---- Coach on that exact result
  await page.goto(`/app/coach?attempt=${S.attemptId}`)
  await rec.browser('Coach opens on that exact paper; its answer links that result and does not teach or guarantee', async () => {
    await expect(page.getByRole('region', { name: 'Selected paper' })).toBeVisible()
    await page.getByRole('textbox', { name: 'Ask the coach' }).fill('what does this result show about my weakest area?'); await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator(`a[href*="${S.attemptId}"]`).first()).toBeVisible({ timeout: 40_000 })
    const body = await page.locator('body').innerText(); expect(body).not.toMatch(/you will pass|guarantee|the answer is/i)
  })
  await rec.browser('an unavailable selected result is never replaced by this (or the latest) one', async () => {
    await page.goto('/app/coach?attempt=00000000-0000-4000-8000-000000000000')
    await page.getByRole('textbox', { name: 'Ask the coach' }).fill('what does this result show about my weakest area?'); await page.getByRole('button', { name: 'Send' }).click()
    // Either the deterministic statement or the model interpreter's clarification is acceptable; substituting the latest result is not.
    await expect(page.getByText(/could not open the result you selected|not a scored result of yours|which result|what result/i).first()).toBeVisible({ timeout: 40_000 })
    await expect(page.locator(`a[href*="${S.attemptId}"]`)).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText(/Your latest result says|Open your latest result|Review repair follow-up/)
  })
})

test('TIME FIXTURE T1 then the weekly review in the UI, a lost acceptance response, and continuity of the partly-done work', async ({ page }) => {
  // One calendar week passes for this student (labelled fixture: every dated record of this run-owned student moves back seven days together).
  const today = todayInZone('Europe/London')
  const shift = await shiftStudentTimeline(S.id, addDays(S.cycle.ends_at_local, -7) < today ? 1 : 2, owned)
  S.timeFixtures.push({ id: 'T1', student: S.id, ...shift, proves: 'the weekly review, closure and continuation commands from consistent older history', cannotProve: 'that a real week elapsed, recurrence, reminders or cron' })
  const cyc = (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local, status').eq('user_id', S.id).eq('status', 'active').single()).data!
  expect(cyc.ends_at_local < today).toBe(true)
  S.cycle = cyc
  await login(page, db, S.email, '/app/review-week')
  await rec.browser('the review opens on the scored weekly paper (no "close without a paper" shortcut offered)', async () => {
    await expect(page.getByRole('heading', { name: /What happened with unfinished work/ }).or(page.getByText(/What happened with unfinished work/)).first()).toBeVisible()
    await expect(page.getByText(/Close this week without a paper/)).toHaveCount(0)
    await noHorizontalOverflow(page)
  })
  const partTask = (S.tasks ?? []).find(t => t.id === S.part![0])!
  await rec.browser('dispositions are recorded separately from next actions: the partly-done work continues with a 30-minute estimate; everything else not done and kept for later', async () => {
    const groups = page.getByRole('radiogroup', { name: /^What happened with / }); const n = await groups.count(); expect(n).toBeGreaterThan(1)
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i); const label = await g.getAttribute('aria-label') ?? ''
      if (label.includes(partTask.title)) { await g.getByLabel('Partly done').check(); await page.locator('select').filter({ has: page.locator('option', { hasText: '30 min' }) }).first().selectOption({ label: '30 min' }) }
      else await g.getByLabel('Not done').check()
    }
    await page.getByRole('button', { name: 'Preview next week' }).click(); await expect(page.getByRole('button', { name: 'Save review and open next week' })).toBeVisible()
    expect((await db.from('planning_cycles').select('id').eq('user_id', S.id)).data!.length).toBe(1)   // previewing created no cycle
  })
  await rec.browser('PRE-commit failure on Save: not claimed, still one cycle', async () => {
    await page.route('**/api/weekly-review/accept', r => r.abort('failed'))
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await expect(page.getByRole('alert').first()).toBeVisible()
    expect((await db.from('planning_cycles').select('id').eq('user_id', S.id)).data!.length).toBe(1)
    await page.unroute('**/api/weekly-review/accept')
  })
  await rec.browser('POST-commit lost response on Save: the week closed and one new week exists; saving again replays the same outcome (one active cycle, one continuation chain)', async () => {
    await page.route('**/api/weekly-review/accept', async r => { await r.fetch(); await r.abort('failed') })
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await expect.poll(async () => (await db.from('planning_cycles').select('id').eq('user_id', S.id)).data!.length, { timeout: 30_000 }).toBe(2)
    await page.unroute('**/api/weekly-review/accept')
    await page.getByRole('button', { name: 'Save review and open next week' }).click().catch(() => {})
    const cycles = (await db.from('planning_cycles').select('id, status, starts_at_local, ends_at_local').eq('user_id', S.id).order('starts_at_local')).data!
    expect(cycles.length).toBe(2); expect(cycles.filter(c => c.status === 'active').length).toBe(1)
    const next = cycles.find(c => c.status === 'active')!
    expect(wd(next.starts_at_local)).toBe(1); expect(wd(next.ends_at_local)).toBe(0); expect(next.starts_at_local > cyc.ends_at_local).toBe(true)
    S.next = next
  })
  const succ = (await db.from('plan_blocks').select('id, cycle_id, execution, learning_objective, outcome_id, lm_id').eq('continued_from_task_id', partTask.id)).data ?? []
  await rec.api('one continuation exists in the new week, linked to the original; the original stays partly done in the closed week', async () => {
    expect(succ.length).toBe(1); expect(succ[0].cycle_id).toBe(S.next.id); expect(succ[0].execution).toBe('not_started')
    const o = (await db.from('plan_blocks').select('execution, cycle_id').eq('id', partTask.id).single()).data!
    expect(o).toEqual({ execution: 'partial', cycle_id: cyc.id })
  })
  await rec.browser('the continuation opens in Calendar and states the earlier 20 minutes; finishing it with 25 more is recorded once', async () => {
    const t = (await db.from('plan_blocks').select('id, local_date').eq('id', succ[0].id).single()).data!
    const d = await openTask(page, t as any); await expect(d).toContainText(/20/); await expect(d).toContainText(/earlier|continu/i)
    await d.getByRole('button', { name: 'Done', exact: true }).click(); await d.getByRole('spinbutton', { name: 'Actual minutes' }).fill('25'); await d.getByRole('button', { name: 'Save as done' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', succ[0].id).single()).data?.execution, { timeout: 20_000 }).toBe('completed')
    expect(await eventMinutes(succ[0].id)).toBe(25); expect(await eventMinutes(partTask.id)).toBe(20)
  })
  await rec.api('the app\'s lineage read model: 20 earlier (closed week) + 25 now, each attributed once; the original, opened from its old link, names its successor and keeps its own record', async () => {
    const { getTaskLineage } = await import('../../../src/lib/planning/taskLineageService')
    const lin = await getTaskLineage(S.id, succ[0].id), orig = await getTaskLineage(S.id, partTask.id)
    expect(lin!.info.earlier!.minutes).toBe(20); expect(lin!.info.earlier!.occurrences[0].id).toBe(partTask.id); expect(lin!.info.earlier!.unknown).toBe(false)
    expect(orig!.task.execution).toBe('partial'); expect(orig!.info.continuedAs!.id).toBe(succ[0].id)
  })
  await noHorizontalOverflow(page)
})
