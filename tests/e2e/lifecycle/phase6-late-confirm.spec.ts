import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { todayInZone, utcToZonedParts } from '../../../src/lib/planning/studyWeek'
import { admin, login, noHorizontalOverflow, removeStudent, RUN, wd, zoneAtLocalHour } from './helpers'

/**
 * Phase 6 · confirming a first week. Desktop and 390 px. The database reads its own clock at acceptance; where a journey needs a draft that is already
 * old, it is prepared through the real draft generator with an earlier planning instant, so nothing waits longer than one minute. All student actions
 * after setup are UI actions.
 */
const db = admin()
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const nowIn = (zone: string) => { const p = utcToZonedParts(new Date(), zone); return Number(p.time.slice(0, 2)) * 60 + Number(p.time.slice(3, 5)) }
const intoNextMinute = async () => new Promise(r => setTimeout(r, 60_000 - (Date.now() % 60_000) + 3_000))
/** The real generator, run as the server runs it, with a planning instant `minutes` ago. */
const preparedAgo = (userId: string, minutes: number) => JSON.parse(execFileSync('npx', ['tsx', 'scripts/prepare-draft.ts', userId, String(minutes)], { encoding: 'utf8' }).trim().split('\n').at(-1)!) as { draftId: string; revision: number }
const accept = (page: Page) => page.getByRole('button', { name: 'Accept and open Calendar' })
const rebuild = (page: Page) => page.getByRole('button', { name: 'Rebuild preview' })

type Fixture = { today: string; zone: string }
async function student(browser: Browser, info: TestInfo, owned: string[], windows: (f: Fixture) => { weekday: number; startTime: string; endTime: string }[]) {
  const zone = zoneAtLocalHour(10, 14, 11), today = todayInZone(zone)
  const s = await createStudent(db, `first${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: {
    answersOnly: true, stage: 'starting_fresh', topicExposure: {}, exam: { sittingIndex: 1, registered: false, timezone: zone },
    week: { commitments: [], windows: windows({ today, zone }), maxSessionMinutes: 20 } } })
  const view = info.project.use
  const context = await browser.newContext({ viewport: view.viewport, isMobile: view.isMobile, hasTouch: view.hasTouch, timezoneId: zone, locale: 'en-GB', baseURL: view.baseURL })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error' && !/status of (409|503)|ERR_FAILED/.test(m.text())) errors.push(m.text()) })
  const answers = async () => ({
    profile: (await db.from('profiles').select('exam_window_id, exam_date, registered, prep_mode, stage, timezone, max_session_minutes, week_availability_mode, onboarding_context_version').eq('id', s.id).single().throwOnError()).data,
    windows: (await db.from('availability_windows').select('weekday, start_time, end_time, status').eq('user_id', s.id).order('weekday').order('start_time').throwOnError()).data,
  })
  const written = async () => ({
    cycles: (await db.from('planning_cycles').select('id, status, starts_at_local, ends_at_local').eq('user_id', s.id).throwOnError()).data!,
    blocks: (await db.from('plan_blocks').select('id, title, local_date, duration_minutes, execution').eq('user_id', s.id).order('id').throwOnError()).data!,
    activeRoadmaps: (await db.from('study_roadmaps').select('id').eq('user_id', s.id).eq('status', 'active').throwOnError()).data!,
    receipts: (await db.from('plan_drafts').select('id, accepted_cycle_id').eq('user_id', s.id).eq('status', 'accepted').throwOnError()).data!,
    status: (await db.from('profiles').select('onboarding_status').eq('id', s.id).single().throwOnError()).data!.onboarding_status as string,
  })
  const drafts = async () => (await db.from('plan_drafts').select('id, status, revision, cycle_start_date, cycle_end_date, draft_json').eq('user_id', s.id).order('created_at').throwOnError()).data!
  const nothingAccepted = async () => { const w = await written(); expect({ ...w, status: w.status === 'complete' }).toEqual({ cycles: [], blocks: [], activeRoadmaps: [], receipts: [], status: false }) }
  const todays = (d: { draft_json: any }) => (d.draft_json.tasks as { scheduled_date: string; duration_minutes: number }[]).filter(t => t.scheduled_date === today).reduce((n, t) => n + t.duration_minutes, 0)
  const open = async (target: Page = page) => { await login(target, db, s.email, '/onboarding/plan'); await expect(accept(target)).toBeEnabled({ timeout: 60_000 }) }
  return { s, zone, today, page, context, errors, answers, written, drafts, nothingAccepted, todays, open }
}

/** The saved week is the previewed draft: same dates, same tasks, one cycle, one active Roadmap, one receipt. */
async function savedAsShown(t: Awaited<ReturnType<typeof student>>, draftId: string) {
  const draft = (await t.drafts()).find(d => d.id === draftId)!, w = await t.written()
  expect(w.cycles.map(c => [c.status, c.starts_at_local, c.ends_at_local])).toEqual([['active', draft.cycle_start_date, draft.cycle_end_date]])
  const key = (x: { id: string; date: string; minutes: number }) => `${x.id}|${x.date}|${x.minutes}`
  expect(w.blocks.map(b => key({ id: b.id, date: b.local_date!, minutes: Number(b.duration_minutes) })).sort())
    .toEqual((draft.draft_json as any).tasks.map((x: any) => key({ id: x.id, date: x.scheduled_date, minutes: x.duration_minutes })).sort())
  expect(w.activeRoadmaps).toHaveLength(1)
  expect(w.receipts).toEqual([{ id: draftId, accepted_cycle_id: w.cycles[0].id }])
  expect(w.status).toBe('complete')
  expect(w.blocks.every(b => b.execution === 'not_started')).toBe(true)
  return w
}
/** The whole previewed week as written, once all seven days have arrived (they animate in one after another). */
const shown = async (page: Page) => { await expect(page.locator('.ob-weekpreview__day').last()).toBeVisible(); return (await page.locator('.ob-weekpreview').textContent())!.replace(/\s+/g, ' ') }
const run = (name: string, windows: Parameters<typeof student>[3], body: (t: Awaited<ReturnType<typeof student>>, info: TestInfo) => Promise<void>) =>
  test(name, async ({ browser }, info) => {
    local(); test.setTimeout(420_000)
    const owned: string[] = []
    let t: Awaited<ReturnType<typeof student>> | undefined
    try { t = await student(browser, info, owned, windows); await body(t, info); expect(t.errors).toEqual([]) }
    finally { await t?.context.close(); for (const id of owned) await removeStudent(db, id) }
  })
const todayOnly = (minutesLeft: number) => ({ today, zone }: Fixture) => [{ weekday: wd(today), startTime: '00:00', endTime: clock(nowIn(zone) + minutesLeft) }]
const everyDay = () => [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '00:00', endTime: '23:59' }))

run('first week · a plan read into the next minute is accepted exactly as shown, with the review time said', todayOnly(45), async t => {
  await t.open()
  const draft = (await t.drafts()).at(-1)!
  expect(t.todays(draft), 'today holds a sitting fitted after the buffer').toBeGreaterThanOrEqual(15)
  await expect(t.page.getByRole('status').filter({ hasText: /keeps 15 minutes clear for you to review/ })).toBeVisible()
  const before = await shown(t.page), answers = await t.answers()
  await noHorizontalOverflow(t.page)
  await intoNextMinute()
  expect(await shown(t.page)).toBe(before)
  await accept(t.page).dblclick()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  const saved = await savedAsShown(t, draft.id)
  const replay = await t.page.request.post('/api/onboarding/plan/confirm', { data: { draftId: draft.id, expectedRevision: draft.revision }, headers: { origin: new URL(t.page.url()).origin } })
  expect(replay.ok()).toBe(true)
  expect(await t.written()).toEqual(saved)
  expect(await t.answers()).toEqual(answers)
})

run('first week · a draft prepared 20 minutes ago that still fits is shown again and accepted', everyDay, async t => {
  const old = preparedAgo(t.s.id, 20)
  await t.open()
  expect((await t.drafts()).map(d => [d.id, d.status])).toEqual([[old.draftId, 'ready']])
  await accept(t.page).click()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  await savedAsShown(t, old.draftId)
})

run('first week · time taken after the preview: refused with nothing saved, explained, rebuilt in the UI and accepted once', todayOnly(120), async t => {
  await t.open()
  const first = (await t.drafts()).at(-1)!, answers = await t.answers()
  expect(t.todays(first)).toBeGreaterThanOrEqual(15)
  // Something protected now covers the rest of today: the previewed sittings cannot be honoured.
  const now = Date.now()
  await db.from('calendar_commitments').insert({ user_id: t.s.id, label: 'Late shift', kind: 'work', recurrence: 'none', starts_at: new Date(now - 60_000).toISOString(), ends_at: new Date(now + 3 * 3_600_000).toISOString(), is_protected: true, status: 'active', source: 'student' }).throwOnError()
  await accept(t.page).click()
  await expect(t.page.getByRole('alert').filter({ hasText: 'Your study time has passed or changed' })).toContainText('no longer fits your study windows. Nothing was saved and your answers are kept.')
  await expect(accept(t.page)).toBeDisabled()
  await t.nothingAccepted()
  expect(await t.answers()).toEqual(answers)
  expect((await t.drafts()).at(-1)).toMatchObject({ id: first.id, status: 'failed' })
  await noHorizontalOverflow(t.page)
  await rebuild(t.page).click()
  await expect(accept(t.page)).toBeEnabled({ timeout: 40_000 })
  const next = (await t.drafts()).at(-1)!
  expect(next.id).not.toBe(first.id); expect(t.todays(next)).toBe(0)
  await accept(t.page).click()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  await savedAsShown(t, next.id)
})

run('first week · an obsolete draft is refused by the clock, and opening the review again replaces it', todayOnly(5), async t => {
  const old = preparedAgo(t.s.id, 40)
  await login(t.page, db, t.s.email, '/onboarding/week')   // signed in without opening the review, which would replace the old draft
  const refused = await t.page.request.post('/api/onboarding/plan/confirm', { data: { draftId: old.draftId, expectedRevision: old.revision }, headers: { origin: new URL(t.page.url()).origin } })
  expect(refused.status()).toBe(409)
  expect(await refused.json()).toMatchObject({ ok: false, code: 'STALE_PREVIEW', error: expect.stringContaining('Nothing was saved') })
  await t.nothingAccepted()
  await t.page.goto('/onboarding/plan')
  await expect(accept(t.page)).toBeEnabled({ timeout: 40_000 })
  const next = (await t.drafts()).at(-1)!
  expect(next.id).not.toBe(old.draftId)
  await expect(t.page.getByRole('status').filter({ hasText: /not enough study time left in this cycle once 15 minutes are kept/ })).toBeVisible()
  await accept(t.page).click()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  await savedAsShown(t, next.id)
})

run('first week · a request that never reaches the server, then a reply lost after saving: truthful both times, one week saved', everyDay, async t => {
  await t.open()
  const draft = (await t.drafts()).at(-1)!
  await t.page.route('**/api/onboarding/plan/confirm', r => r.abort('failed'))
  await accept(t.page).click()
  await expect(t.page.getByRole('alert').filter({ hasText: 'not confirmed whether your plan saved' })).toContainText('you will not get a second copy')
  await t.nothingAccepted()
  expect((await t.drafts()).at(-1)!.status).toBe('ready')
  await expect(accept(t.page)).toBeEnabled()
  await t.page.unroute('**/api/onboarding/plan/confirm')
  await t.page.route('**/api/onboarding/plan/confirm', async r => { await r.fetch({ timeout: 90_000 }); await r.abort('failed') })
  await accept(t.page).click()
  await expect.poll(async () => (await t.written()).receipts.length, { timeout: 40_000 }).toBe(1)
  await expect(t.page.getByRole('alert').filter({ hasText: 'not confirmed whether your plan saved' })).toBeVisible()
  const saved = await savedAsShown(t, draft.id)
  await noHorizontalOverflow(t.page)
  await t.page.unroute('**/api/onboarding/plan/confirm')
  await accept(t.page).click()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  expect(await t.written()).toEqual(saved)
})

run('first week · an older tab accepting after a newer one: told it is already accepted, nothing added', everyDay, async t => {
  await t.open()
  const older = (await t.drafts()).at(-1)!
  // The older draft is replaced behind the first tab's back, as a rebuild elsewhere would, and the newer one is accepted in a second tab.
  await db.from('plan_drafts').update({ status: 'superseded' }).eq('id', older.id).throwOnError()
  const second = await t.context.newPage()
  await second.goto('/onboarding/plan'); await expect(accept(second)).toBeEnabled({ timeout: 40_000 })
  const newer = (await t.drafts()).at(-1)!
  await accept(second).click(); await second.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  const saved = await savedAsShown(t, newer.id)
  await accept(t.page).click()
  const note = t.page.getByRole('alert').filter({ hasText: 'already accepted, so nothing was added' })
  await expect(note.getByRole('link', { name: 'Open Calendar' })).toBeVisible()
  await noHorizontalOverflow(t.page)
  // And a third look at the review after acceptance cannot add the week again.
  await t.page.goto('/onboarding/plan'); await expect(accept(t.page)).toBeEnabled({ timeout: 40_000 })
  await accept(t.page).click()
  await expect(t.page.getByRole('alert').filter({ hasText: 'already accepted' })).toBeVisible()
  expect(await t.written()).toEqual(saved)
})

run('first week · a failed read during confirmation retires nothing, and the same press then saves once', everyDay, async t => {
  test.skip(!process.env.FAULTS_FILE, 'Needs the loopback fault proxy.')
  await t.open()
  const draft = (await t.drafts()).at(-1)!
  fs.writeFileSync(process.env.FAULTS_FILE!, JSON.stringify({ rules: [{ id: 'draft-check', match: 'select=status%2Conboarding_context_version', mode: 'status', status: 500 }] }))
  try {
    await accept(t.page).click()
    await expect(t.page.getByRole('alert').filter({ hasText: 'could not confirm whether your plan was saved' })).toBeVisible()
    await t.nothingAccepted()
    expect((await t.drafts()).at(-1)!.status).toBe('ready')
  } finally { fs.writeFileSync(process.env.FAULTS_FILE!, '{"rules":[]}') }
  await accept(t.page).click()
  await t.page.waitForURL(/\/app\/calendar/, { timeout: 40_000 })
  await savedAsShown(t, draft.id)
})

test('first week setup probe · a setup failure keeps its failing stage and response, and cleanup cannot replace it', async ({}, info) => {
  local(); test.skip(info.project.name !== 'desktop', 'No browser involved: once is enough.')
  const owned: string[] = []
  let message = ''
  const record = info.outputPath('setup-failure.jsonl'), shared = process.env.SETUP_FAILURE_FILE
  process.env.SETUP_FAILURE_FILE = record   // this failure is deliberate: it is kept with the test, not in the run's evidence
  await createStudent(db, `badsetup${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { week: { windows: [{ weekday: 1, startTime: '10:00', endTime: '09:00' }] } } })
    .catch(e => { message = String(e.message) })
  expect(message).toMatch(/^onboarding week failed: \{.*"ok":false/)
  process.env.SETUP_FAILURE_FILE = shared ?? ''
  expect(owned).toHaveLength(1)
  expect(JSON.parse(fs.readFileSync(record, 'utf8').trim())).toMatchObject({ studentId: owned[0], failure: message })
  for (const id of owned) await removeStudent(db, id)   // setup already removed it: reported as nothing, never "User not found"
})
