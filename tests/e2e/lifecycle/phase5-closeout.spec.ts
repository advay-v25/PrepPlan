/**
 * Phase 5 acceptance closeout, in a real browser (desktop and 390px). No question bank, no real provider.
 * SEEDED (recorded as endpoint steps): students and onboarding through the real onboarding API, readings reported "covered" through the real coverage API,
 * one mock report through the real mock-reports route, a saved note and one revision (review) task row for the recall-linkage case, a database-level read fault for the
 * failed-initial-read case (a restrictive policy on an OWNED fixture student's notes, removed in a finally block).
 * BROWSER-DRIVEN: the failed note read and recovery, the February mature-entry Curriculum, opening its next step / mock report / note / card routes, the Calendar recall
 * linkage with the exact return task, and the normalised return-link boundary.
 */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createStudent, createSession, FRESH_STUDENT_ONBOARDING, type OnboardingOptions } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, recorder, RUN, J } from './helpers'
import { scopedErrors } from './scopedErrors'

const { connect } = createRequire(path.join(process.cwd(), 'package.json'))('./scripts/db.cjs') as { connect: () => { connect(): Promise<void>; query(q: string, p?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> } }
const db = admin(), rec = recorder(), owned: string[] = [], se = scopedErrors(), S: any = {}
test.describe.configure({ mode: 'serial' })
test.beforeEach(({ page }) => se.attach(page))
let faultOn = false
const dropFault = async () => { const c = connect(); await c.connect(); try { await c.query('drop policy if exists zz_p5_fail on public.curriculum_notes'); await c.query('drop function if exists public.zz_p5_fail(uuid)') } finally { await c.end() } faultOn = false }
test.afterAll(async ({}, info) => {
  if (faultOn) await dropFault().catch(() => {})
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { await db.from('flashcard_commands').delete().eq('user_id', id); const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase5-closeout-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, allowances: se.allowances, unexpected: se.unexpected, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([]); expect(se.unexpected, 'unexpected failed requests, HTTP errors, console or page errors').toEqual([])
})
const count = async (table: string, uid: string) => ((await db.from(table).select('*', { count: 'exact', head: true }).eq('user_id', uid)).count) ?? -1
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date())

test('1 failed initial note read: unavailable with Retry, no empty editable note, the saved text survives and returns', async ({ page }) => {
  const st = await createStudent(db, `p5f${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) }); S.f = st
  const r = (await db.from('curriculum_readings').select('id, topic_id, title').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(1).single()).data!
  await rec.api('SEEDED: a saved note with a distinctive sentence', async () => { expect((await db.from('curriculum_notes').insert({ user_id: st.id, scope_type: 'reading', scope_id: r.id, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ORIGINAL SAVED NOTE that must survive a failed read.' }] }] }, revision: 1 })).error).toBeNull() })
  await login(page, db, st.email, `/app/curriculum/${r.topic_id}/${r.id}`)
  await rec.api('FAULT: a restrictive read policy that raises for THIS fixture student only (a real database read failure, removed afterwards)', async () => {
    const c = connect(); await c.connect()
    try { await c.query(`create function public.zz_p5_fail(u uuid) returns boolean language plpgsql as $$ begin if u = '${st.id}'::uuid then raise exception 'injected notes read failure'; end if; return true; end $$`); await c.query('create policy zz_p5_fail on public.curriculum_notes as restrictive for select to authenticated using (public.zz_p5_fail(user_id))'); faultOn = true } finally { await c.end() }
  })
  await rec.browser('the Notes tab says it could not load, offers Retry, and mounts NO editor (an empty editable note would invite overwriting)', async () => {
    await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?tab=notes`)
    await expect(page.getByRole('alert').filter({ hasText: /Your notes could not be loaded/ })).toBeVisible(); await expect(page.getByRole('button', { name: /Retry|Try again/ })).toBeVisible()
    await expect(page.locator('.note-editor')).toHaveCount(0); await expect(page.getByRole('textbox')).toHaveCount(0); await noHorizontalOverflow(page)
    expect((await db.from('curriculum_notes').select('revision, doc').eq('user_id', st.id).eq('scope_id', r.id).single()).data!.revision).toBe(1)
  })
  await rec.browser('after the read recovers, Retry shows the ORIGINAL note, still revision 1 (nothing was overwritten)', async () => {
    await dropFault(); await page.getByRole('button', { name: /Retry|Try again/ }).click()
    await expect(page.locator('.note-editor__content')).toContainText('ORIGINAL SAVED NOTE'); const row = (await db.from('curriculum_notes').select('revision, doc').eq('user_id', st.id).eq('scope_id', r.id).single()).data!
    expect(row.revision).toBe(1); expect(JSON.stringify(row.doc)).toContain('ORIGINAL SAVED NOTE')
  })
})

test('2 February mature entry: first pass reported complete, poor external mock, selected concerns: no beginner restart, exact routes, nothing promoted', async ({ page }) => {
  const topics = ((await db.from('topics').select('id').order('default_sequence')).data ?? []).map(t => t.id as string)
  const concerned = ((await db.from('curriculum_readings').select('id').eq('topic_id', topics[0]).order('reading_no').limit(2)).data ?? []).map(r => r.id as string)
  const options: OnboardingOptions = { stage: 'revising_or_mocks', topicExposure: Object.fromEntries(topics.map(t => [t, 'recent'])), positionExtra: { uncertainty: { [topics[0]]: { level: 'several', lmIds: concerned }, [topics[1]]: { level: 'most', lmIds: [] } } }, exam: { sittingIndex: 0, registered: true, timezone: 'Europe/London' }, week: FRESH_STUDENT_ONBOARDING.week }
  const st = await createStudent(db, `p5m${RUN}`, { onboard: true, onboarding: options, register: id => owned.push(id) }); S.m = st
  const sess = createSession(db, st.email); expect(await sess.signIn()).toBe(true)
  const readings = (await db.from('curriculum_readings').select('id, topic_id, title').eq('is_active', true).eq('structure_pending', false).order('sequence')).data ?? []
  await rec.api('the exam is February 2027 and the student is already at the revision stage (set through the real onboarding API)', async () => {
    const p = (await db.from('profiles').select('exam_date, stage').eq('id', st.id).single()).data!; expect(String(p.exam_date)).toMatch(/^2027-02/); expect(p.stage).toBe('revising_or_mocks')
  })
  await rec.api('first pass reported complete: every active reading reported "covered" through the real coverage API (batches under the 200-entry limit)', async () => {
    for (let i = 0; i < readings.length; i += 100) { const res = await sess.json('/api/curriculum/coverage', { method: 'POST', headers: J, body: JSON.stringify({ updates: readings.slice(i, i + 100).map(r => ({ readingId: r.id, topicId: r.topic_id, state: 'covered' })) }) }); expect(res.body?.ok, JSON.stringify(res.body)).toBe(true) }
  })
  await rec.api('a poor external mock recorded through the real mock-reports route (a self-reported result, not evidence)', async () => {
    const res = await sess.json('/api/mock-reports', { method: 'POST', headers: J, body: JSON.stringify({ action: 'create', key: randomUUID(), input: { takenOn: new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10), provider: 'External provider', scope: 'full', scale: 'percent', score: 48, difficulties: ['ran_out_of_time'], topics: [{ topicId: topics[0], value: 41, scale: 'percent' }, { topicId: topics[1], value: 44, scale: 'percent' }], notes: null } }) })
    expect(res.body?.ok, JSON.stringify(res.body)).toBe(true); S.report = res.body.report.id
  })
  S.before = { ev: await count('evidence_events', st.id), rp: await count('repair_threads', st.id), blocks: JSON.stringify((await db.from('plan_blocks').select('id, execution, local_date, cancelled_at').eq('user_id', st.id).order('id')).data) }
  await login(page, db, st.email, '/app/curriculum')
  await rec.browser('Curriculum shows the recorded first pass (not "0 covered"), no beginner restart, and says covered is not understood', async () => {
    const summary = page.getByLabel('Where you are'); await expect(summary).toContainText(/recorded as covered/)
    const m = /(\d+) of (\d+) readings recorded as covered/.exec(await summary.innerText())!; expect(Number(m[1])).toBe(Number(m[2])); expect(Number(m[1])).toBeGreaterThan(90)
    await expect(summary).toContainText('does not mean understood'); expect(await page.locator('body').innerText()).not.toMatch(/start with reading 1|beginner|from the beginning/i)
    await page.goto('/app/curriculum?f=not_covered'); await expect(page.getByText(/No reading matches/)).toBeVisible(); await noHorizontalOverflow(page)
  })
  await rec.browser('the exact next step, the mock report, a reading note and a card all open (200) and keep their return path', () => se.expecting([{ label: 'navigation prefetch', url: /[?&]_rsc=/, failed: true, min: 0, max: 8 }], async () => {
    await page.goto('/app/curriculum'); const next = page.getByLabel('Where you are').getByRole('link').first()
    if (await next.count()) { const href = await next.getAttribute('href'); expect(href).toMatch(/^\/app\//); const res = await page.goto(href!); expect(res!.status()).toBeLessThan(400) }
    const rep = await page.goto(`/app/calendar/mock-report/${S.report}`); expect(rep!.status()).toBe(200); await expect(page.getByText(/48/).first()).toBeVisible()
    const r = readings[0]; await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?tab=notes&return=${encodeURIComponent(`/app/calendar/mock-report/${S.report}`)}`)
    await expect(page.getByRole('link', { name: /Back/ })).toHaveAttribute('href', `/app/calendar/mock-report/${S.report}`)
    await page.locator('.note-editor__content').click(); await page.keyboard.type('What I will revise after the mock: the topics I reported shaky.')
    await expect.poll(async () => JSON.stringify((await db.from('curriculum_notes').select('doc').eq('user_id', st.id).eq('scope_id', r.id).maybeSingle()).data?.doc ?? {}), { timeout: 15_000 }).toContain('after the mock')
    await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?tab=cards`); await page.getByLabel('Front', { exact: true }).first().fill('What did the mock show I should revise?'); await page.getByLabel('Back', { exact: true }).first().fill('The topics I reported shaky.'); await page.getByRole('button', { name: 'Add card' }).click(); await expect(page.getByText('What did the mock show I should revise?')).toBeVisible()
  }))
  await rec.api('the external score stayed a report; notes, cards and coverage created no evidence or repair state and changed no accepted work', async () => {
    expect(await count('evidence_events', st.id)).toBe(S.before.ev); expect(await count('repair_threads', st.id)).toBe(S.before.rp)
    expect(JSON.stringify((await db.from('plan_blocks').select('id, execution, local_date, cancelled_at').eq('user_id', st.id).order('id')).data)).toBe(S.before.blocks)
  })
})

test('3 recall linkage: a revision task in the Calendar opens ITS reading\'s cards, returns to the exact task, and practising cards completes nothing', async ({ page }) => {
  const st = S.m, r = ((await db.from('curriculum_readings').select('id, topic_id, title').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(1).single()).data)!
  // The task sits on the active cycle's first day, not "today": on a Sunday (the cycle boundary) today belongs to a different Calendar week.
  const cyc = (await db.from('planning_cycles').select('id, starts_at_local').eq('user_id', st.id).eq('status', 'active').single()).data!, cycle = cyc.id as string, today = String(cyc.starts_at_local).slice(0, 10), taskId = `p5-review-${RUN}`
  await rec.api('SEEDED: one revision (review) task for that reading in the open week, as the revision rotation would place it (a seeded row, not a UI step)', async () => {
    expect((await db.from('plan_blocks').insert({ id: taskId, user_id: st.id, cycle_id: cycle, title: `Revise: ${r.title}`, detail: 'Revision of a reading you reported covered.', task_type: 'review', origin: 'planner', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: today, day: today, duration_minutes: 30, duration: '30', lm_id: r.id, rationale: 'In your revision rotation.', is_protected_commitment: false, created_by: 'algorithm' })).error).toBeNull()
  })
  await rec.api('SEEDED: one recall card for that exact reading through the real card route (so the deck has something due)', async () => {
    const sess = createSession(db, st.email); expect(await sess.signIn()).toBe(true)
    const res = await sess.json('/api/curriculum/flashcards', { method: 'POST', headers: J, body: JSON.stringify({ action: 'create', scopeType: 'reading', scopeId: r.id, front: 'Recall: what is a return?', back: 'The gain or loss on an investment over a period.', requestKey: randomUUID() }) })
    expect(res.body?.ok, JSON.stringify(res.body)).toBe(true)
  })
  const taskUrl = `/app/calendar?view=agenda&week=${today}&task=${taskId}`
  await login(page, db, st.email, taskUrl)
  if (!page.url().includes(taskId)) await page.goto(taskUrl)
  const before = { ev: await count('evidence_events', st.id), rp: await count('repair_threads', st.id) }
  await rec.browser('the task drawer offers "Practise your recall cards for this reading" and it opens THAT reading\'s Cards with Back = this exact task', async () => {
    const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await d.getByRole('link', { name: 'Practise your recall cards for this reading' }).click()
    await expect(page).toHaveURL(new RegExp(`/app/curriculum/${r.topic_id}/${r.id}\\?.*tab=cards`)); await expect(page.getByRole('heading', { level: 1, name: new RegExp(r.title.slice(0, 15)) })).toBeVisible()
    await expect(page.getByRole('link', { name: /Back/ })).toHaveAttribute('href', taskUrl)
  })
  await rec.browser('review the reading\'s due card (the student\'s own report); then Back returns to the SAME task, still not done', async () => {
    await page.getByRole('button', { name: /Review \d+ due/ }).click(); await page.getByRole('button', { name: 'Show the answer' }).click(); await page.getByRole('button', { name: 'Good' }).click(); await expect(page.getByText(/You reviewed 1 card/)).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click(); await page.getByRole('link', { name: /Back/ }).first().click(); await expect(page).toHaveURL(new RegExp(`task=${taskId}`)); await expect(page.getByRole('dialog')).toBeVisible()
    expect((await db.from('plan_blocks').select('execution').eq('id', taskId).single()).data!.execution).toBe('not_started')
    expect(await count('evidence_events', st.id)).toBe(before.ev); expect(await count('repair_threads', st.id)).toBe(before.rp)
  })
  await rec.browser('marking the revision task Done (the existing path) records activity only: no evidence, no repair change, no outcome confirmation', async () => {
    const d = page.getByRole('dialog'); await d.getByRole('button', { name: 'Done', exact: true }).click(); await d.getByRole('spinbutton', { name: 'Actual minutes' }).fill('25'); await d.getByRole('button', { name: 'Save as done' }).click()
    await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', taskId).single()).data?.execution, { timeout: 20_000 }).toBe('completed')
    expect(await count('evidence_events', st.id)).toBe(before.ev); expect(await count('repair_threads', st.id)).toBe(before.rp)
    expect(((await db.from('block_scope_confirmations').select('id').eq('block_id', taskId)).data ?? []).length).toBe(0)
  })
})

test('4 return links stay inside the app after normalisation, in the real page', async ({ page }) => {
  const r = ((await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).order('sequence').limit(1).single()).data)!
  await login(page, db, S.m.email, '/app/curriculum')
  await rec.browser('dot-segment and encoded escapes show no Back link; a legitimate app return (with its query) does', async () => {
    for (const bad of ['/app/../account', '/app/%2e%2e/account', '/app/%2E%2E%2faccount', '/app/curriculum/../../account']) { await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?return=${encodeURIComponent(bad)}`); await expect(page.getByRole('link', { name: /Back/ })).toHaveCount(0) }
    const good = '/app/curriculum?f=covered&q=cash'; await page.goto(`/app/curriculum/${r.topic_id}/${r.id}?return=${encodeURIComponent(good)}`); await expect(page.getByRole('link', { name: /Back/ })).toHaveAttribute('href', good)
    await page.getByRole('link', { name: /Back/ }).click(); await expect(page).toHaveURL(/\/app\/curriculum\?f=covered&q=cash/)
  })
})
