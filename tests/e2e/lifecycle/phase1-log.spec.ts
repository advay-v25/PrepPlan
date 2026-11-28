/**
 * Phase 1: session logging updates the right work. Desktop + 390px, one fresh owned student with an accepted first week (real onboarding API).
 * Every step is UI-driven, then asserted against plan_blocks, task_events, block_scope_confirmations, learning_activities and the command receipts.
 * Covered: an exact planned block (25 of 45 minutes + one outcome), replay, double submit, lost reply after commit, a stale second tab,
 * a time-only log mapped to scope afterwards, a separate session on a reading that also has an open block (it must not touch that block),
 * a late log, and the weekly-review carry with a 20-minute finish. No question bank is written: this suite needs no published inventory.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { addDays, admin, login, noHorizontalOverflow, recorder, RUN, wd } from './helpers'
import { scopedErrors } from './scopedErrors'
import { todayInZone } from '../../../src/lib/planning/studyWeek'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '' }, se = scopedErrors()
type Block = { id: string; title: string; lm_id: string | null; outcome_id: string | null; duration_minutes: number; revision: number; local_date: string; cycle_id: string }
let blocks: Block[] = []
const measure: Record<string, unknown> = {}
test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const a = await createStudent(db, `p1${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: FRESH_STUDENT_ONBOARDING })
  S.id = a.id; S.email = a.email
  const { data } = await db.from('plan_blocks').select('id,title,lm_id,outcome_id,duration_minutes,revision,local_date,cycle_id,task_type,is_protected_commitment')
    .eq('user_id', S.id).eq('task_type', 'study').is('cancelled_at', null).eq('execution', 'not_started').or('lm_id.not.is.null,outcome_id.not.is.null').order('local_date').order('id')
  blocks = (data ?? []).filter(b => !b.is_protected_commitment) as Block[]
  expect(blocks.length, 'the accepted first week must contain several readable study blocks').toBeGreaterThanOrEqual(5)
})
test.beforeEach(({ page }) => { se.attach(page); if (process.env.P1_DEBUG) page.on('requestfailed', r => { if (/app\/log/.test(r.url())) console.log('ABORT@step', rec.rows.length, r.url().replace(/task=[^&]+/, 'task=X'), r.headers()['next-router-prefetch'] ?? '-') }) })
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message) }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase1-log-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, seeded: 'fresh student + accepted first week via the onboarding API; no bank written', steps: rec.rows, measure, cleanup }, null, 2))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(se.unexpected, 'unexpected console/page errors').toEqual([])
})

const events = async (id: string) => (await db.from('task_events').select('event_type, actual_duration_minutes').eq('task_id', id).order('created_at')).data ?? []
const row = async (id: string) => (await db.from('plan_blocks').select('execution, revision, learning_activity_id, cycle_id, local_date').eq('id', id).single()).data!
const confirmed = async (id: string) => (await db.from('block_scope_confirmations').select('outcome_id').eq('block_id', id)).data?.map(c => c.outcome_id) ?? []
const blockCount = async () => (await db.from('plan_blocks').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0
const receipts = async () => (await db.from('planned_log_commands').select('idempotency_key', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0

async function openLog(page: Page, id: string) {
  await page.goto(`/app/log?task=${encodeURIComponent(id)}`)
  const b = blocks.find(x => x.id === id)!
  await expect(page.getByRole('radio', { name: new RegExp(b.title.replace(/[.*+?^${}()|[\]\\]/g, '\\.')) }).first()).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'How did it go?' }).or(page.getByText('How did it go?')).first()).toBeVisible()
  await noHorizontalOverflow(page)
}
/** Only the steps that save or follow a Link: Next may cancel its own prefetch or the post-save page refresh when the next navigation supersedes it. Nothing but `_rsc` GETs is covered. */
const quiet = <T,>(fn: () => Promise<T>) => se.expecting([{ label: 'navigation supersedes an in-flight RSC refresh or prefetch', url: /[?&]_rsc=/, failed: true, method: 'GET', min: 0, max: 60 }], fn)
const qb = (step: string, fn: () => Promise<void>) => rec.browser(step, () => quiet(fn))
/** A save ends in router.refresh(); let it finish so the next navigation never supersedes (aborts) it. */
const settle = (page: Page) => page.waitForLoadState('networkidle')
async function enterMinutes(page: Page, n: number) {
  await page.getByText('Enter different minutes').click()
  await page.getByLabel('Minutes studied').fill(String(n))
}

test('a planned block: 25 of 45 minutes and one outcome are one save, replayed safely, shown after reload', async ({ page }) => {
  const b = blocks[0]; const before = await blockCount()
  await login(page, db, S.email, '/app/calendar')
  await rec.browser('Calendar opens the exact block and its drawer offers Log this session', async () => {
    await page.goto(`/app/calendar?task=${encodeURIComponent(b.id)}`)
    const link = page.getByRole('link', { name: 'Log this session' })
    await expect(link).toHaveAttribute('href', `/app/log?task=${encodeURIComponent(b.id)}`)
    await quiet(async () => { await link.click(); await page.waitForURL(/\/app\/log\?task=/); await settle(page) })
  })
  await rec.browser('the sheet opens on that block with no catalogue-wide payload', async () => {
    const requested: string[] = []
    const trace = (r: import('@playwright/test').Request) => {
      const url = new URL(r.url())
      if (url.pathname === '/api/log-learning') requested.push(url.search)
    }
    page.on('request', trace)
    const context = page.waitForResponse(r => new URL(r.url()).pathname === '/api/log-learning' && new URL(r.url()).searchParams.get('task') === b.id)
    await openLog(page, b.id)
    page.off('request', trace)
    const taskQuery = `?task=${encodeURIComponent(b.id)}`
    expect([...new Set(requested)]).toEqual([taskQuery])
    expect((await context).ok()).toBe(true)
    const [scoped, options] = await Promise.all([page.request.get(`/api/log-learning${taskQuery}`), page.request.get('/api/log-learning')])
    expect(scoped.ok() && options.ok()).toBe(true)
    const scopedBytes = (await scoped.body()).length
    const optionsBytes = (await options.body()).length
    measure.knownTaskEntry = { scopedBytes, previousTwoRequestBytes: scopedBytes + optionsBytes }
    expect(scopedBytes).toBeLessThan(0.7 * (scopedBytes + optionsBytes))
  })
  await rec.browser('Partly done + 25 minutes + one outcome saves once; the receipt names the action, minutes and coverage', async () => {
    await page.getByRole('radio', { name: 'Partly done', exact: true }).click()
    await enterMinutes(page, 25)
    await page.getByRole('checkbox').first().check()
    await quiet(async () => {
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Progress saved.' })).toBeFocused()
      await expect(page.getByText('25 minutes reported once')).toBeVisible()
      await expect(page.getByText(/1 outcome marked as covered/)).toBeVisible()
      await expect(page.getByText(/Unfinished work is offered again at weekly review/)).toBeVisible()
      await noHorizontalOverflow(page); await settle(page)
    })
  })
  await rec.api('one task, one execution event of 25 minutes, one confirmed outcome, no new rows', async () => {
    expect(await blockCount()).toBe(before)
    const r = await row(b.id); expect(r.execution).toBe('partial'); expect(r.learning_activity_id).toBeNull()
    const ev = (await events(b.id)).filter(e => e.event_type === 'partial'); expect(ev).toEqual([{ event_type: 'partial', actual_duration_minutes: 25 }])
    expect((await confirmed(b.id)).length).toBe(1); expect(await receipts()).toBe(1)
  })
  await qb('the exact saved block opens in Coach with reported time and coverage, and remains read-only', async () => {
    const beforeEvents = await events(b.id)
    const beforeEvidence = await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', S.id).throwOnError()
    await page.getByRole('link', { name: 'Review this log with Coach' }).click()
    await page.waitForURL(url => url.pathname === '/app/coach' && url.searchParams.get('task') === b.id)
    const context = page.getByRole('region', { name: 'Selected task' })
    await expect(context).toContainText('Partly done. Latest report: 25 minutes studied. 1 outcome confirmed as covered.')
    expect(new URL((await context.getByRole('link', { name: 'Open in Calendar' }).getAttribute('href'))!, page.url()).searchParams.get('task')).toBe(b.id)
    await page.reload()
    await expect(context).toContainText('25 minutes studied')
    await noHorizontalOverflow(page)
    expect(await events(b.id)).toEqual(beforeEvents)
    expect((await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', S.id).throwOnError()).count).toBe(beforeEvidence.count)
  })
  await rec.browser('after reload the Calendar block shows the saved progress and its coverage', async () => {
    await page.goto(`/app/calendar?task=${encodeURIComponent(b.id)}`)
    await expect(page.getByRole('dialog')).toContainText(/Saved coverage: 1 outcome/)
    await page.getByRole('button', { name: 'What changed on this task?' }).click()
    await expect(page.getByRole('dialog')).toContainText(/25 min recorded/)
  })
  await qb('Home, Curriculum and Tests distinguish the confirmed study from demonstrated understanding', async () => {
    const [outcomeId] = await confirmed(b.id)
    const { data: reading } = await db.from('reading_los').select('reading_id,curriculum_readings!inner(topic_id)').eq('id', outcomeId).single().throwOnError()
    const { topic_id: subject } = reading.curriculum_readings as unknown as { topic_id: string }
    const href = `/app/curriculum/${subject}/${reading.reading_id}`
    await page.goto('/app')
    await expect(page.getByRole('link', { name: /Test evidence No valid evidence/ })).toBeVisible()
    await page.goto(href)
    await expect(page.getByRole('region', { name: 'Recorded learning' })).toContainText(/1 recorded sitting · 1 of \d+ outcomes confirmed covered/)
    await page.goto('/app/tests')
    const scope = page.getByRole('region', { name: /What this week.s paper tests/ })
    const disclosure = page.locator('details.scope-details:not([open]) > summary')
    await expect(scope.or(disclosure).first()).toBeVisible()
    if (await disclosure.isVisible()) await disclosure.click()
    await expect(scope.getByRole('link', { name: /^Reading/ })).toHaveAttribute('href', href)
    expect((await db.from('evidence_events').select('id', { count: 'exact', head: true }).eq('user_id', S.id).throwOnError()).count).toBe(0)
  })
  await rec.browser('reopening the sheet for a block that is already partly done is allowed and a second tab with the old revision is refused', async () => {
    const t2 = blocks[1]
    const other = await page.context().newPage(); se.attach(other)
    await openLog(page, t2.id); await openLog(other, t2.id)
    await quiet(async () => {
      await page.getByRole('radio', { name: 'Finished it', exact: true }).click(); await enterMinutes(page, 45); await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Block finished.' })).toBeVisible(); await settle(page)
    })
    await other.getByRole('radio', { name: 'Finished it', exact: true }).click(); await enterMinutes(other, 40)
    await se.expecting([{ label: 'stale second tab is refused by the owned command', url: /\/api\/log-learning\/planned$/, statuses: [409], min: 1, max: 1 }], async () => {
      await other.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(other.getByRole('alert').filter({ hasText: /changed somewhere else/ })).toBeVisible()
    })
    await expect(other.getByRole('button', { name: 'Reload this block' })).toBeVisible()
    await expect(other.getByLabel('Minutes studied')).toHaveValue('40')   // the student's input is kept
    const ev = (await events(t2.id)).filter(e => e.event_type === 'completed'); expect(ev).toEqual([{ event_type: 'completed', actual_duration_minutes: 45 }])
    expect(await receipts()).toBe(2)
    await other.close()
  })
})

test('double submit and a lost reply after commit each save exactly once', async ({ page }) => {
  const dbl = blocks[2], lost = blocks[3]
  await login(page, db, S.email, '/app/log')
  await qb('double submit: two rapid clicks on Save commit one event', async () => {
    await openLog(page, dbl.id)
    await page.getByRole('radio', { name: 'Finished it', exact: true }).click(); await enterMinutes(page, 45)
    await page.getByRole('button', { name: 'Save', exact: true }).dblclick()
    await expect(page.getByRole('heading', { name: 'Block finished.' })).toBeVisible(); await settle(page)
    expect((await events(dbl.id)).filter(e => e.event_type === 'completed').length).toBe(1)
  })
  await qb('lost reply after commit: the retry checks the original request and does not duplicate', async () => {
    await openLog(page, lost.id)
    await page.getByRole('radio', { name: 'Partly done', exact: true }).click(); await enterMinutes(page, 20); await page.getByRole('checkbox').first().check()
    await se.expecting([{ label: 'planned log reply lost after commit', url: /\/api\/log-learning\/planned$/, failed: true, method: 'POST', min: 1, max: 1 }], async () => {
      let n = 0
      await page.route('**/api/log-learning/planned', async r => { if (n++ > 0) return r.continue(); await r.fetch(); await r.abort('failed') })
      await page.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Check a pending save' })).toBeFocused()
      await expect(page.getByText(/may already be saved/)).toBeVisible()
    })
    expect((await events(lost.id)).filter(e => e.event_type === 'partial').length).toBe(1)   // it did commit
    await page.getByRole('button', { name: 'Retry same log' }).click()
    await expect(page.getByRole('heading', { name: 'Progress saved.' })).toBeVisible(); await settle(page)
    await page.unroute('**/api/log-learning/planned')
    expect((await events(lost.id)).filter(e => e.event_type === 'partial')).toEqual([{ event_type: 'partial', actual_duration_minutes: 20 }])
    expect((await confirmed(lost.id)).length).toBe(1)
  })
})

test('a time-only log is visible with Confirm coverage, then mapped to scope from Calendar', async ({ page }) => {
  const b = blocks[4]
  await login(page, db, S.email, '/app/log')
  await qb('saving with no outcomes records the time and says no coverage was confirmed', async () => {
    await openLog(page, b.id)
    await page.getByRole('radio', { name: 'Finished it', exact: true }).click(); await enterMinutes(page, 30)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByText(/Time only\. No outcomes are confirmed yet/)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Confirm coverage' })).toBeVisible(); await settle(page)
    expect((await confirmed(b.id)).length).toBe(0); expect((await row(b.id)).execution).toBe('completed')
    const coach = await page.context().newPage()
    try {
      const href = await page.getByRole('link', { name: 'Review this log with Coach' }).getAttribute('href')
      await coach.goto(new URL(href!, page.url()).href)
      await expect(coach.getByRole('region', { name: 'Selected task' })).toContainText('30 minutes studied. Coverage is still unconfirmed.')
    } finally { await coach.close() }
  })
  await qb('Confirm coverage opens the block and confirming one outcome updates the same task', async () => {
    await page.getByRole('link', { name: 'Confirm coverage' }).click()
    const dlg = page.getByRole('dialog'); await expect(dlg.getByRole('heading', { name: 'What did this sitting cover?' })).toBeVisible()
    await dlg.getByRole('checkbox').first().check()
    await dlg.getByRole('button', { name: /Save|Confirm/ }).last().click()
    await expect.poll(async () => (await confirmed(b.id)).length).toBe(1)
    expect((await row(b.id)).execution).toBe('completed')
  })
})

test('a separate session never updates a planned block, even for the same reading; a late log lands on its own date', async ({ page }) => {
  const same = blocks[5] ?? blocks[blocks.length - 1]
  const reading = same.lm_id ?? (await db.from('reading_los').select('reading_id').eq('id', same.outcome_id!).single()).data!.reading_id
  const title = (await db.from('curriculum_readings').select('title, reading_no').eq('id', reading).single()).data!
  const before = await blockCount(); const sameBefore = await row(same.id)
  await login(page, db, S.email, '/app/log')
  await qb('choosing "Log a separate session" and the same reading creates one new activity and leaves the open block untouched', async () => {
    await page.goto('/app/log')
    await expect(page.getByRole('radio', { name: /Log a separate session/ })).toBeVisible()
    await page.getByRole('radio', { name: /Log a separate session/ }).click()
    const lookup = /\/api\/log-learning\?q=/
    const query = page.getByLabel('Search readings')
    await se.expecting([{ label: 'injected reading search 503', url: lookup, statuses: [503], method: 'GET', min: 1, max: 1 }], async () => {
      await page.route(lookup, route => route.fulfill({ status: 503, json: { ok: false } }), { times: 1 })
      await query.fill(String(title.reading_no))
      await expect(page.getByRole('alert').filter({ hasText: 'Could not search readings.' })).toBeVisible()
      await expect(query).toHaveValue(String(title.reading_no))
    })
    await page.getByRole('button', { name: 'Retry search' }).click()
    await page.getByRole('option').filter({ hasText: title.title }).click()
    await expect(page.getByText('What did it cover?')).toBeVisible()
    await page.getByRole('checkbox').first().check()
    await page.getByRole('button', { name: '45m' }).click()
    await page.getByRole('button', { name: 'Yesterday' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Session logged.' })).toBeFocused()
    await expect(page.getByText('Added as a separate session. No planned block changed.')).toBeVisible()
    await noHorizontalOverflow(page); await settle(page)
    await page.getByRole('link', { name: 'Review this log with Coach' }).click()
    await expect(page.getByRole('region', { name: 'Selected task' })).toContainText('Separate session logged. Latest report: 45 minutes studied.')
  })
  await qb('Coach on the original open block shows no log; asking a question writes no schedule or evidence', async () => {
    await page.goto(`/app/coach?task=${encodeURIComponent(same.id)}`)
    const ctx = page.getByRole('region', { name: 'Selected task' })
    await expect(ctx).toContainText(same.title.slice(0, 20)); await expect(ctx).not.toContainText('Latest report')
    const tables = ['plan_blocks', 'task_events', 'block_scope_confirmations', 'evidence_events', 'assessment_attempts', 'planned_log_commands', 'learning_activities']
    const snap = async () => Object.fromEntries(await Promise.all(tables.map(async t => [t, (await db.from(t).select('*', { count: 'exact', head: true }).eq('user_id', S.id)).count])))
    const was = await snap(); const box = page.getByRole('textbox', { name: 'Ask the coach' }); const n = await page.locator('.coach-message--coach').count()
    await box.fill('What did I log for this block?'); await box.press('Enter')
    await expect.poll(() => page.locator('.coach-message--coach').count(), { timeout: 60_000 }).toBeGreaterThan(n)
    await settle(page); expect(await snap()).toEqual(was)
    expect(await row(same.id)).toEqual(sameBefore); await noHorizontalOverflow(page)
  })
  await rec.api('one new logged sitting dated yesterday; the planned block of the same reading is unchanged', async () => {
    expect(await blockCount()).toBe(before + 1)
    expect(await row(same.id)).toEqual(sameBefore)
    const made = (await db.from('plan_blocks').select('id, local_date, learning_activity_id, execution').eq('user_id', S.id).like('id', 'log-%')).data!
    expect(made.length).toBe(1); expect(made[0].local_date).toBe(addDays(todayInZone('Europe/London'), -1)); expect(made[0].execution).toBe('completed')
    expect(made[0].learning_activity_id).not.toBeNull()
    expect((await confirmed(made[0].id)).length).toBe(1)
    expect((await events(same.id)).length).toBe(0)
  })
})

test('Calendar quick capture opens the same choices and returns focus to its button', async ({ page }) => {
  await login(page, db, S.email, '/app/calendar')
  await qb('the dialog lists open blocks plus the separate-session option, and Escape returns focus', async () => {
    const opener = page.getByRole('button', { name: 'Log learning' }).first()
    await opener.click()
    const dlg = page.getByRole('dialog'); await expect(dlg.getByRole('radio', { name: /Log a separate session/ })).toBeVisible()
    expect(await dlg.getByRole('radio').count()).toBeGreaterThan(1)
    await noHorizontalOverflow(page)
    await page.keyboard.press('Escape'); await expect(dlg).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})

test('TIME FIXTURE: the unfinished work is carried once through weekly review and finished with 20 minutes', async ({ page }) => {
  const part = blocks[0]
  const cyc = (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data!
  const today = todayInZone('Europe/London')
  const shift = await shiftStudentTimeline(S.id, addDays(cyc.ends_at_local, -7) < today ? 1 : 2, owned)
  measure.timeFixture = { ...shift, proves: 'weekly review closure and continuation from consistent older history', cannotProve: 'that a real week elapsed' }
  await login(page, db, S.email, '/app/review-week')
  await qb('the review lists the partly done block; carrying it creates one continuation and keeps the old week as it was', async () => {
    await expect(page.getByText(/What happened with unfinished work/).first()).toBeVisible()
    const groups = page.getByRole('radiogroup', { name: /^What happened with / }); const n = await groups.count(); expect(n).toBeGreaterThan(0)
    for (let i = 0; i < n; i++) {
      const g = groups.nth(i); const label = await g.getAttribute('aria-label') ?? ''
      if (label.includes(part.title)) { await g.getByLabel('Partly done').check(); await page.locator('select').filter({ has: page.locator('option', { hasText: '30 min' }) }).first().selectOption({ label: '30 min' }) }
      else await g.getByLabel('Not done').check()
    }
    // No reviewed inventory exists for this student: the review offers the honest unavailable-paper closure and requires it to be chosen.
    const closeWithout = page.getByRole('checkbox', { name: /Close this week without a paper/ })
    if (await closeWithout.count()) await closeWithout.check()
    await page.getByRole('button', { name: 'Preview next week' }).click()
    await page.getByRole('button', { name: 'Save review and open next week' }).click({ noWaitAfter: true, timeout: 60_000 })
    await expect.poll(async () => (await db.from('plan_blocks').select('id').eq('continued_from_task_id', part.id)).data?.length ?? 0, { timeout: 40_000 }).toBe(1)
  })
  const cont = (await db.from('plan_blocks').select('id, title, lm_id, outcome_id, cycle_id, execution, revision, duration_minutes, local_date').eq('continued_from_task_id', part.id).single()).data!
  blocks.push(cont as unknown as Block)
  await rec.api('the original stays partly done with 25 minutes in the closed week; the continuation is open in the new week', async () => {
    const o = await row(part.id); expect(o.execution).toBe('partial'); expect(o.cycle_id).toBe(cyc.id)
    expect((await events(part.id)).filter(e => e.event_type === 'partial')[0].actual_duration_minutes).toBe(25)
    expect(cont.cycle_id).not.toBe(cyc.id); expect(cont.execution).toBe('not_started')
    expect((await confirmed(cont.id)).length).toBe(0)   // the earlier week's confirmed scope is not transferred
  })
  await qb('the original is read-only history; the continuation is finished with 20 minutes through the same sheet', async () => {
    await page.goto(`/app/log?task=${encodeURIComponent(part.id)}`)
    await expect(page.locator('.log-sheet .auth-error')).toContainText(/continues in a later week|earlier week/)
    await openLog(page, cont.id)
    await page.getByRole('radio', { name: 'Finished it', exact: true }).click(); await enterMinutes(page, 20); await page.getByRole('checkbox').first().check()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Block finished.' })).toBeVisible(); await settle(page)
  })
  await rec.api('45 minutes across the lineage: 25 in the closed week, 20 in the new one, each confirmation on its own task', async () => {
    const m = async (id: string) => (await events(id)).filter(e => ['partial', 'completed'].includes(e.event_type)).reduce((s, e) => s + (e.actual_duration_minutes ?? 0), 0)
    expect(await m(part.id)).toBe(25); expect(await m(cont.id)).toBe(20)
    expect((await confirmed(part.id)).length).toBe(1); expect((await confirmed(cont.id)).length).toBe(1)
    expect(wd((await db.from('planning_cycles').select('starts_at_local').eq('id', cont.cycle_id).single()).data!.starts_at_local)).toBe(1)
  })
})
