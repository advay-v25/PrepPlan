/**
 * Phase 6 Home journey (desktop + 390px). An ordinary owned student with an accepted first week (SEEDED through createStudent's onboarding).
 * UI-driven: partial minutes on Home, reload, defer + receipt wording, undo, a stale second tab refused with no partial write. Assertions read plan_blocks.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent } from '../../../scripts/lib/e2eSession'
import { addDays, admin, login, noHorizontalOverflow, recorder, RUN, zoneAtLocalHour } from './helpers'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { scopedErrors } from './scopedErrors'

const db = admin(), rec = recorder(), owned: string[] = []
const S = { id: '', email: '' }, se = scopedErrors(), unexpected = se.unexpected
// The student's clock is known: a zone where it is mid-morning now, so "today" and its two tasks do not depend on when the suite runs.
const ZONE = zoneAtLocalHour(10, 11, 9)
test.use({ timezoneId: ZONE })
test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  const a = await createStudent(db, `ph${RUN}`, { onboard: true, register: id => owned.push(id), onboarding: { exam: { timezone: ZONE } } }); S.id = a.id; S.email = a.email
  // Exactly two eligible tasks today: the first sitting of two different readings. Anything else the planner put on today moves to tomorrow.
  const today = todayInZone(ZONE)
  const open = (await db.from('plan_blocks').select('id, lm_id, title, local_date').eq('user_id', S.id).eq('task_type', 'study').eq('execution', 'not_started').is('cancelled_at', null).order('local_date').order('title').throwOnError()).data!
  const two = [...new Map(open.filter(b => !/ · sitting (?!1 )\d+ of /.test(b.title)).map(b => [b.lm_id, b])).values()].slice(0, 2)
  expect(two, 'the seeded week needs first sittings of two readings').toHaveLength(2)
  await db.from('plan_blocks').update({ local_date: addDays(today, 1), day: addDays(today, 1) }).eq('user_id', S.id).eq('local_date', today).throwOnError()
  await db.from('plan_blocks').update({ local_date: today, day: today, placement: 'day_preferred', starts_at: null }).in('id', two.map(b => b.id)).throwOnError()
})
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error || /not found/i.test(r.error.message) }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase6-home-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), viewport: info.project.name, seeded: 'student + accepted first week via createStudent onboarding', unexpected, allowances:se.allowances, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok)).toEqual([])
  expect(unexpected, 'unexpected console/page errors').toEqual([])
})

const blocks = async () => { const r = await db.from('plan_blocks').select('id, title, execution, revision, local_date, task_type').eq('user_id', S.id).order('local_date').order('starts_at'); if (r.error) throw new Error(r.error.message); return r.data ?? [] }

const state = async (id: string) => { const b = (await db.from('plan_blocks').select('execution, revision').eq('id', id).single()).data; const ev = (await db.from('task_events').select('actual_duration_minutes').eq('task_id', id).eq('event_type', 'partial')).data ?? []; return { execution: b?.execution, revision: b?.revision, reported: ev.map(e => e.actual_duration_minutes) } }

test('Home: one next action, report partial minutes, reload, defer, undo, stale tab', async ({ page, browser }) => {
  await login(page, db, S.email, '/app')
  await rec.browser('Home renders one dominant next action and fits the viewport', async () => {
    await expect(page.locator('section.next-up')).toHaveCount(1)
    await expect(page.locator('section.next-up a.next-up__cta')).toHaveAttribute('href', /\/app\/calendar/)   // carries ?task= only when something is due today
    await noHorizontalOverflow(page)
  })
  await rec.browser('Up next never names a later sitting while an earlier sitting of the same reading is still open (declared order)', async () => {
    const up = (await page.locator('section.next-up h2').innerText()).trim()
    const m = up.match(/^(.*) · sitting (\d+) of (\d+)$/)
    if (m && Number(m[2]) > 1) await expect(page.locator('section.today li.today__row', { hasText: `${m[1]} · sitting ${Number(m[2]) - 1} of ${m[3]}` })).toHaveCount(0)
  })
  const rows = await blocks()
  rec.rows.push({ step: `seed check: ${rows.length} plan blocks`, status: 'pass', how: 'endpoint-supplement' })
  expect(rows.length).toBeGreaterThan(0)
  const today = page.locator('section.today')
  await expect(today.locator('li.today__row'), 'one task is featured, the other is listed').toHaveCount(1)
  const first = today.locator('li.today__row').first()
  const title = (await first.locator('.today__title').innerText()).trim()
  const id = rows.find(r => r.title === title)?.id
  expect(id).toBeTruthy(); se.allowCancelledScopeRead(id!)
  await rec.browser(`"${title}": Partly done with 20 minutes persists as partial, not done, and the minutes are 20`, async () => {
    await first.getByRole('button', { name: /partly done/i }).click()
    await first.getByLabel('Actual minutes').fill('20'); await first.getByRole('button', { name: 'Save as partly done' }).click()
    await expect(page.getByText('Saved as partly done').first()).toBeVisible()
    await expect.poll(async () => await state(id!)).toMatchObject({ execution: 'partial', reported: [20] })
  })
  await rec.browser('after reload the task is still open and shows 20 min reported (partial is not done)', async () => {
    await page.reload()
    // Partial work may become Up next; an open predecessor can keep it in the remaining list instead.
    const presentation = page.locator('li.today__row', {hasText:title}).or(page.locator('section.next-up').filter({hasText:title}))
    await expect(presentation).toContainText(/20 (of \d+ )?min reported/)
  })
  await rec.browser('Defer says "Saved as deferred. Set aside" (not rescheduled), sets the task aside, and Undo restores the previous state', async () => {
    const row = page.locator('li.today__row',{hasText:title})
    if(await row.count()) await row.getByRole('link',{name:`Open ${title}`,exact:true}).click()
    else await page.locator('section.next-up a.next-up__cta').click()
    await expect(page.getByRole('dialog')).toContainText(title)
    await expect(page.getByRole('dialog').getByText('Loading outcomes…',{exact:true})).toHaveCount(0)
    await page.getByRole('dialog').getByRole('button', { name: 'Defer', exact: true }).click()
    await expect(page.getByText(/saved as deferred/i).first()).toBeVisible()
    await expect(page.getByText(/rescheduled/i)).toHaveCount(0)
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', id!).single()).data?.execution).toBe('deferred')
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', id!).single()).data?.execution).toBe('partial')
  })
  await rec.browser('a second tab holding the old revision is refused and writes nothing', async () => {
    await page.goto(`/app/calendar?view=agenda&week=${rows.find(r=>r.id===id)!.local_date}&task=${id}`)
    const ctx2 = await browser.newContext({ storageState: await page.context().storageState(), viewport: page.viewportSize()!, timezoneId: ZONE, locale: 'en-GB' })
    const p2 = await ctx2.newPage(); se.attach(p2); await p2.goto(page.url()); await expect(p2.getByRole('dialog')).toContainText(title)
    await expect(p2.getByRole('dialog').getByText('Loading outcomes…',{exact:true})).toHaveCount(0)
    // the first tab changes the task; the second tab still holds the earlier revision
    await page.reload()
    const r1 = page.getByRole('dialog')
    await r1.getByRole('button', { name: /partly done/i }).click(); await r1.getByLabel('Actual minutes').fill('5'); await r1.getByRole('button', { name: 'Save partial progress' }).click()
    await expect.poll(async () => (await state(id!)).reported.length).toBe(2)
    const afterFirst = await state(id!)
    const r2 = p2.getByRole('dialog')
    await r2.getByRole('button', { name: /partly done/i }).click(); await r2.getByLabel('Actual minutes').fill('50')
    await se.expecting([{label:'stale task revision in the second tab',url:new RegExp(`/api/tasks/${id}$`),statuses:[409],min:1,max:1}],async()=>{
      await r2.getByRole('button', { name: 'Save partial progress' }).click()
      await expect(p2.getByRole('status').filter({ hasText: /refreshed|changed/ }).first()).toBeVisible()
    })
    expect(await state(id!)).toEqual(afterFirst)   // the refused save wrote nothing
    await expect(r2.getByLabel('Actual minutes')).toHaveValue('50')   // the typed input is kept
    await expect(r1.getByText('Loading outcomes…',{exact:true})).toHaveCount(0)
    await expect(r2.getByText('Loading outcomes…',{exact:true})).toHaveCount(0)
    await ctx2.close()
  })
})

test('Calendar agenda lists same-reading sittings in declared order on every day, and fits the viewport', async ({ page }) => {
  await login(page, db, S.email, '/app/calendar')
  await rec.browser('agenda: for each reading on each day, "sitting N of M" appears in ascending N', async () => {
    await page.goto('/app/calendar?view=agenda'); await page.waitForLoadState('networkidle')
    const titles: string[] = [await page.locator('body').innerText()]
    const seen = new Map<string, number>(); let checked = 0
    for (const t of titles) {
      for (const m of t.matchAll(/^(?:Study: )?(.+?) · sitting (\d+) of (\d+)$/gm)) {
        checked++
        const prev = seen.get(m[1]) ?? 0
        expect(Number(m[2]), `${m[1]}: sitting ${m[2]} listed after sitting ${prev}`).toBeGreaterThan(prev)
        seen.set(m[1], Number(m[2]))
      }
    }
    expect(checked, 'the agenda showed no sittings to check').toBeGreaterThan(0)
    await noHorizontalOverflow(page)
  })
})

test('Phase 6 page snapshots: Home, Calendar, Settings and Account fit the viewport with reduced motion', async ({ page }, info) => {
  await login(page,db,S.email,'/app')
  await page.emulateMedia({reducedMotion:'reduce'})
  expect(await page.evaluate(()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  for(const route of ['/app','/app/calendar?view=agenda','/app/settings','/account']) {
    await page.goto(route); await expect(page.locator('h1').first()).toBeVisible(); await noHorizontalOverflow(page)
    await page.screenshot({path:`docs/evidence/phase6-screens/after-${info.project.name}-${new URL(route,'http://roadmap.test').pathname.replaceAll('/','_')}.png`,fullPage:false})
  }
})
