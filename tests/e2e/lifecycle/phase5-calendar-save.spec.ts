import { expect, test, type Page, type Request } from '@playwright/test'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { todayInZone, zonedTimeToUtc } from '../../../src/lib/planning/studyWeek'
import { addDays, admin, login, noHorizontalOverflow, RUN, wd, removeStudent } from './helpers'

/**
 * A timed move from the Calendar drawer must save exactly the time on screen, or refuse and keep what was typed; day-only placement stays deliberate.
 * Desktop and 390 px. Every assertion checks both the request the app sent and the row that was saved. The slow load is real: the page's scripts are
 * held back, so the server-rendered drawer is on screen before the app is ready to act on input.
 */
const db = admin()
const ZONE = 'Europe/London'
const clock = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

async function setup(page: Page, owned: string[], timed: boolean) {
  const s = await createStudent(db, `calsave${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const { data: cycle } = await db.from('planning_cycles').select('*').eq('user_id', s.id).eq('status', 'active').single().throwOnError()
  const day = addDays(todayInZone(ZONE), 1)
  if (day > cycle!.ends_at_local) await db.from('planning_cycles').update({ ends_at_local: day, ends_at: zonedTimeToUtc(day, '23:59', ZONE).toISOString() }).eq('id', cycle!.id).throwOnError()
  await db.from('plan_blocks').delete().eq('user_id', s.id).throwOnError()
  await db.from('availability_windows').delete().eq('user_id', s.id).eq('weekday', wd(day)).throwOnError()
  await db.from('availability_windows').insert({ user_id: s.id, weekday: wd(day), start_time: '18:30', end_time: '22:00', status: 'active' }).throwOnError()
  const id = `p5-save-${RUN}-${Math.random().toString(36).slice(2, 7)}`
  await db.from('plan_blocks').insert({ id, user_id: s.id, cycle_id: cycle!.id, title: 'Save probe', detail: 'Owned fixture', task_type: 'study', origin: 'student', priority: 'core', placement: timed ? 'timed' : 'day_preferred', starts_at: timed ? zonedTimeToUtc(day, '20:00', ZONE).toISOString() : null, execution: 'not_started', local_date: day, day, duration: '45', duration_minutes: 45 }).throwOnError()
  const url = `/app/calendar?week=${day}&view=agenda&task=${id}`
  await login(page, db, s.email, '/app')
  const moves: Record<string, unknown>[] = []
  page.on('request', (r: Request) => { if (r.method() === 'PATCH' && r.url().includes(`/api/tasks/${id}`)) moves.push(r.postDataJSON()) })
  const row = async () => (await db.from('plan_blocks').select('starts_at, placement, local_date, duration_minutes, revision').eq('id', id).single().throwOnError()).data!
  const drawer = page.getByRole('dialog')
  return { id, url, moves, row, drawer, start: drawer.getByLabel('Start', { exact: true }), apply: drawer.getByRole('button', { name: 'Apply', exact: true }) }
}
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')

test('calendar save · time typed while the page is still loading is saved exactly, never as an empty time', async ({ page }) => {
  local(); test.setTimeout(180_000)
  const owned: string[] = []
  try {
    const t = await setup(page, owned, false)
    // Hold every script back: the drawer is painted, but nothing on it is wired up yet.
    await page.route('**/_next/static/**/*.js*', async route => { await new Promise(r => setTimeout(r, 2500)); await route.continue().catch(() => {}) })
    await page.goto(t.url, { waitUntil: 'commit' })
    await expect(t.start).toBeVisible()
    // Painted but not yet wired: the field visibly refuses input, so nothing can be typed and then lost.
    await expect(t.start).toBeDisabled()
    await expect(t.drawer.getByRole('status').filter({ hasText: 'Getting this task ready' })).toBeVisible()
    await expect(t.apply).toBeDisabled()
    expect(t.moves).toHaveLength(0)
    await t.start.fill('19:00')   // immediate keyboard entry, as soon as the field accepts it
    // The app has taken over the drawer only once React is attached to its controls; the student presses Apply after that.
    await page.waitForFunction(() => { const b = document.querySelector('[role="dialog"] button'); return !!b && Object.keys(b).some(k => k.startsWith('__reactProps')) }, undefined, { timeout: 60_000 })
    await expect(t.start).toHaveValue('19:00')
    await t.apply.focus(); await page.keyboard.press('Enter')
    await expect.poll(() => t.moves.length, { timeout: 40_000 }).toBeGreaterThan(0)
    expect(t.moves[0]).toMatchObject({ action: 'move', startMinutes: 19 * 60, durationMinutes: 45 })
    await expect(t.drawer).toHaveCount(0)
    const saved = await t.row()
    expect(saved.placement).toBe('timed')
    expect(clock(saved.starts_at as string)).toBe('19:00')
    expect(t.moves).toHaveLength(1)
  } finally { await page.unrouteAll({ behavior: 'ignoreErrors' }); for (const id of owned) await removeStudent(db, id) }
})

test('calendar save · a half-typed time is refused and kept; day-only placement stays deliberate', async ({ page }) => {
  local(); test.setTimeout(180_000)
  const owned: string[] = []
  try {
    const t = await setup(page, owned, true)
    await page.goto(t.url)
    await expect(t.start).toBeEnabled()
    await expect(t.start).toHaveValue('20:00')
    const before = await t.row()
    // Only the hour is typed: the browser holds an incomplete time whose value reads as empty.
    await t.start.fill('')
    await t.start.focus(); await page.keyboard.type('1')
    expect(await t.start.evaluate((e: HTMLInputElement) => e.validity.badInput)).toBe(true)
    await t.apply.focus(); await page.keyboard.press('Enter')
    await expect(t.drawer.getByRole('alert').or(page.getByRole('alert')).filter({ hasText: 'Finish the start time' }).first()).toBeVisible()
    expect(await t.start.evaluate((e: HTMLInputElement) => e.validity.badInput)).toBe(true)   // what was typed is still there
    expect(t.moves).toHaveLength(0)
    expect(await t.row()).toEqual(before)
    await noHorizontalOverflow(page)
    // Clearing the field entirely is a choice: day-only, said as such in the request and the row.
    await t.start.fill('')
    expect(await t.start.evaluate((e: HTMLInputElement) => e.validity.badInput)).toBe(false)
    await t.apply.click()
    await expect(t.drawer).toHaveCount(0)
    expect(t.moves).toHaveLength(1)
    expect(t.moves[0]).toMatchObject({ action: 'move', startMinutes: null })
    expect(await t.row()).toMatchObject({ starts_at: null, placement: 'day_preferred' })
  } finally { for (const id of owned) await removeStudent(db, id) }
})
