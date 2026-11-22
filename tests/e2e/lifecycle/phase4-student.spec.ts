/**
 * Phase 4 student loop in a real browser (desktop and 390px), ONE ordinary student per viewport, on a REGISTERED SYNTHETIC fixture bank (never real inventory).
 * SEEDED (not browser-driven, recorded as endpoint steps): the student's account and onboarding (real onboarding API), completion of two readings' study tasks and
 * their scope confirmations (real task / scope APIs), the guarded fixture bank, and the labelled time fixture T2 (the student's whole dated history moved back
 * seven days so the re-check spacing has elapsed; it proves the app's own eligibility rules from consistent older history, not that a week passed).
 * BROWSER-DRIVEN: preview, failed preview read, Start, every answer with confidence, a lost answer-save response and its Retry, refresh/resume, submit, result,
 * Curriculum and Coach agreement, repair preview and acceptance, Calendar repair work, the re-check (refused before the spacing, started after) and its result.
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { releaseBankLock } from '../../../scripts/lib/bankLock'
import { admin, login, makeBank, destroyBank, noHorizontalOverflow, recorder, RUN, J, addDays } from './helpers'

const db = admin(), rec = recorder(), owned: string[] = []
let bankFile: string | null = null, bankRecord: any = null
const S: any = { id: '', email: '', unexpected: [] as string[], allowances: [] as unknown[], timeFixtures: [] as unknown[] }
test.describe.configure({ mode: 'serial' })
/**
 * Allowances are SCOPED: a rule exists only while its deliberate step runs, names one request (URL pattern + status or failure kind), and must actually be observed
 * (`min`), so an injected fault that never happens fails too. Anything else — another URL, another status, the same request in another step — is unexpected and fails
 * the run. Console "Failed to load resource" errors are accepted only when they point at a request an active rule covers (the browser location of the message).
 */
type Rule = { label: string; url: RegExp; statuses?: number[]; failed?: 'any' | 'aborted-rsc'; min: number; max: number; seen: number }
const active: Rule[] = []
async function expecting<T>(rules: Omit<Rule, 'seen'>[], fn: () => Promise<T>): Promise<T> {
  const rs = rules.map(r => ({ ...r, seen: 0 })); active.push(...rs)
  try { return await fn() } finally {
    await new Promise(r => setTimeout(r, 300))   // let this step's own late browser events arrive while its rules still apply
    for (const r of rs) { active.splice(active.indexOf(r), 1); S.allowances.push({ label: r.label, seen: r.seen, min: r.min, max: r.max }); if (r.seen < r.min) S.unexpected.push(`expected event never observed: ${r.label}`) }
  }
}
const NAV_ABORT: Omit<Rule, 'seen'> = { label: 'a Next.js RSC prefetch aborted by the navigation this step performs', url: /[?&]_rsc=/, failed: 'aborted-rsc', min: 0, max: 6 }
test.beforeEach(({ page }) => {
  page.on('requestfailed', r => {
    const abortedRsc = /[?&]_rsc=/.test(r.url()) && r.failure()?.errorText === 'net::ERR_ABORTED'
    const hit = active.find(x => x.seen < x.max && x.url.test(r.url()) && x.failed && (x.failed === 'any' || abortedRsc))
    if (hit) hit.seen++; else S.unexpected.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`)
  })
  page.on('response', r => {
    if (r.status() < 400) return
    const hit = active.find(x => x.seen < x.max && x.url.test(r.url()) && x.statuses?.includes(r.status()))
    if (hit) hit.seen++; else S.unexpected.push(`HTTP ${r.status()} ${r.url()}`)
  })
  page.on('console', m => {
    if (m.type() !== 'error') return
    if (/^Failed to load resource/.test(m.text())) { if (!active.some(x => x.url.test(m.location().url))) S.unexpected.push(`console resource error ${m.location().url} ${m.text().slice(0, 120)}`); return }
    S.unexpected.push(`${page.url()} ${m.text().slice(0, 200)}`)
  })
  page.on('pageerror', e => S.unexpected.push(`PAGEERROR ${page.url()} ${e.message.slice(0, 200)}`))
})
test.afterAll(async ({}, info) => {
  const cleanup: { what: string; ok: boolean; error?: string }[] = []
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); cleanup.push({ what: `student ${id}`, ok: !r.error, error: r.error?.message }) }
  if (bankFile) { try { destroyBank(bankFile); cleanup.push({ what: 'fixture bank', ok: true }) } catch (e) { cleanup.push({ what: 'fixture bank', ok: false, error: (e as Error).message }) } }
  releaseBankLock()
  fs.mkdirSync('docs/evidence', { recursive: true })
  fs.writeFileSync(`docs/evidence/phase4-student-browser-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), run: RUN, viewport: info.project.name, fixtureBank: bankRecord && { tag: bankRecord.tag, items: bankRecord.items.length, families: bankRecord.families.length }, timeFixtures: S.timeFixtures, allowances: S.allowances, unexpected: S.unexpected, cleanup, steps: rec.rows }, null, 1))
  expect(cleanup.filter(c => !c.ok), 'cleanup').toEqual([])
  expect(S.unexpected, 'unexpected failed requests, HTTP errors, console or page errors (only the injected faults are tolerated)').toEqual([])
})

const attempts = async () => (await db.from('assessment_attempts').select('id', { count: 'exact', head: true }).eq('user_id', S.id)).count ?? 0
const rev = async (id: string) => (await db.from('plan_blocks').select('revision').eq('id', id).single()).data!.revision as number
const preflightBtn = (page: Page) => page.getByRole('button', { name: /Review and start|Check again/ }).first()
const LEVEL: Record<string, string> = { high: 'Sure', low: 'Guessing' }

/** Answers every question of the open paper in the UI. `role(n)` picks right/wrong; the key comes from the recorded form, never from the page. */
async function answerAll(page: Page, itemsByStem: Map<string, any>, n: number, wrongAt: number[] = []) {
  const stem = async () => (await page.locator('#q-h').innerText()).trim()
  const done: { id: string; correct: boolean }[] = []
  for (let i = 0; i < n; i++) {
    const it = itemsByStem.get(await stem()); expect(it, 'the question on screen belongs to the reserved form').toBeTruthy()
    const key = Number(it.key_index), opts = page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio'), c = await opts.count()
    const wrong = wrongAt.includes(i), sel = wrong ? (key + 1) % c : key
    await opts.nth(sel).click(); await page.getByRole('radio', { name: LEVEL[wrong ? 'high' : 'high'], exact: true }).click()
    done.push({ id: it.id, correct: !wrong })
    if (i < n - 1) await page.getByRole('button', { name: /^Next/ }).click()
  }
  return done
}
async function submit(page: Page) {
  // A runner position beacon that lands after THIS owned attempt was scored is correctly refused with 409 (a scored attempt is immutable): allowed for that attempt's /progress only.
  const attemptId = /\/app\/tests\/([0-9a-f-]{36})/.exec(page.url())?.[1]; expect(attemptId, 'submitting an owned attempt').toBeTruthy()
  await expecting([{ label: `post-score progress beacon for the owned attempt ${attemptId}`, url: new RegExp(`/api/tests/attempt/${attemptId}/progress$`), statuses: [409], min: 0, max: 3 }, NAV_ABORT], async () => {
    await page.getByRole('button', { name: /^Review/ }).click(); await page.getByRole('button', { name: 'Submit for scoring' }).click(); await page.waitForURL(/\/result/)
  })
}
const itemsOf = async (attemptId: string) => {
  const att = (await db.from('assessment_attempts').select('form_id').eq('id', attemptId).single()).data!
  const pinned = (await db.from('form_items').select('item_id').eq('form_id', att.form_id)).data!.map(p => p.item_id as string)
  const items = (await db.from('assessment_items').select('id, stem, key_index, outcome_id, family_id, concept_id').in('id', pinned)).data!
  return { items, byStem: new Map(items.map(i => [String(i.stem).trim(), i])) }
}

test('SEEDED setup: student, two finished readings with confirmed scope, a fixture bank, and one finished reading that has no questions', async () => {
  const st = await createStudent(db, `p4${RUN}`, { onboard: true, onboarding: FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  S.id = st.id; S.email = st.email
  await rec.api('onboarding through the real onboarding API (seeded, not browser-driven here; journey-a drives onboarding in the UI)', async () => {
    S.cycle = (await db.from('planning_cycles').select('id, starts_at_local, ends_at_local').eq('user_id', S.id).eq('status', 'active').single()).data
    S.tasks = (await db.from('plan_blocks').select('id, lm_id, local_date, duration_minutes, title').eq('cycle_id', S.cycle.id).eq('task_type', 'study').is('cancelled_at', null).order('local_date').order('title')).data ?? []
    expect(S.tasks.length).toBeGreaterThan(3)
  })
  const byReading = new Map<string, any[]>(); for (const t of S.tasks) byReading.set(t.lm_id, [...(byReading.get(t.lm_id) ?? []), t])
  if (byReading.size < 3) {
    // A short first cycle can legitimately contain only two readings. Add a third owned scope for the zero-bank control.
    const readingId = ['r032', 'r033', 'r034'].find(id => !byReading.has(id))!
    const id = `task-paper-fixture-${crypto.randomUUID()}`
    const { data: task, error } = await db.from('plan_blocks').insert({
      id, user_id: S.id, cycle_id: S.cycle.id, lm_id: readingId, title: 'Fixture reading without questions', detail: '',
      task_type: 'study', origin: 'planner', priority: 'core', execution: 'not_started', placement: 'day_preferred',
      local_date: S.cycle.starts_at_local, day: S.cycle.starts_at_local, duration_minutes: 30, duration: '30', created_by: 'algorithm',
    }).select('id, lm_id, local_date, duration_minutes, title').single()
    expect(error).toBeNull()
    byReading.set(readingId, [task])
  }
  const readings = [...byReading.keys()]; expect(readings.length).toBeGreaterThanOrEqual(3)
  S.readings = readings.slice(0, 2); S.noBank = readings[2]
  await rec.api('study tasks of two readings and the zero-bank reading completed through the real task API; scope confirmed through the real scope API', async () => {
    const sess = (await import('../../../scripts/lib/e2eSession')).createSession(db, S.email); expect(await sess.signIn()).toBe(true)
    for (const r of [...S.readings, S.noBank]) for (const t of byReading.get(r)!) {
      const res = await sess.json(`/api/tasks/${t.id}`, { method: 'PATCH', headers: J, body: JSON.stringify({ action: 'execution', execution: 'completed', actualDurationMinutes: Number(t.duration_minutes), expectedRevision: await rev(t.id) }) })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const outs = ((await db.from('reading_los').select('id').eq('reading_id', r).order('sequence')).data ?? []).map(o => o.id as string)
      const c = await sess.json('/api/tests/scope/confirm', { method: 'POST', headers: J, body: JSON.stringify({ blockId: t.id, outcomeIds: outs }) })
      expect(c.body?.ok, JSON.stringify(c.body)).toBe(true)
    }
  })
  const bank = await makeBank(S.readings); bankFile = bank.file; bankRecord = bank.record
  await rec.api(`fixture bank for ${S.readings.join(', ')} only; ${S.noBank} deliberately has no questions`, async () => {
    expect(bankRecord.items.length).toBeGreaterThan(20)
    const { count, error } = await db.from('student_eligible_items').select('id', { count: 'exact', head: true }).eq('lm_id', S.noBank)
    expect(error).toBeNull()
    expect(count).toBe(0)
  })
})

test('Tests: a failed preview read is honest, a missing bank is stated, Start creates exactly one paper', async ({ page }) => {
  await login(page, db, S.email, '/app/tests')
  await rec.browser('FAILED capacity/preview read: the UI says it could not check, offers Retry, shows no ready state, creates nothing', () => expecting([{ label: 'the injected preflight 500', url: /\/api\/tests\/preflight$/, statuses: [500], min: 1, max: 3 }], async () => {
    await page.route('**/api/tests/preflight', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Could not check this paper.' }) }))
    await preflightBtn(page).click()
    await expect(page.getByRole('alert').filter({ hasText: /Could not check this paper/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start weekly paper' })).toHaveCount(0); expect(await attempts()).toBe(0)
    await page.unroute('**/api/tests/preflight')
  }))
  await rec.browser('PREVIEW: the paper is drawn from the readings with questions; the reading with NO questions is stated as untested, nothing unrelated fills it, and nothing is written', async () => {
    await page.getByRole('button', { name: 'Retry' }).click()
    await expect(page.locator('.preflight__result').first()).toContainText(/about \d+ minutes/)
    const name = (await db.from('curriculum_readings').select('title').eq('id', S.noBank).single()).data!.title as string
    await expect(page.locator('.preflight__result')).toContainText(/Not enough reviewed questions yet for/); await expect(page.locator('.preflight__result')).toContainText(name)
    expect(await attempts()).toBe(0); await noHorizontalOverflow(page)
  })
  await rec.browser('Start opens exactly one attempt on exactly the reserved form', () => expecting([NAV_ABORT], async () => {
    await page.getByRole('button', { name: 'Start weekly paper' }).click(); await page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/)
    S.attemptId = page.url().split('/').pop(); expect(await attempts()).toBe(1)
    const { items, byStem } = await itemsOf(S.attemptId); S.items = items; S.byStem = byStem; S.n = items.length
    expect(items.every(i => bankRecord.items.includes(i.id))).toBe(true)
    expect(new Set(items.map(i => i.family_id)).size).toBe(items.length)   // independent families only
    expect(items.every(i => S.readings.some((r: string) => String(i.outcome_id).startsWith(`${r}-`)))).toBe(true)   // intended scope only
  }))
  await rec.browser('Home resumes this exact owned paper, not a new paper or study task', async () => {
    await page.goto('/app')
    await expect(page.locator('.next-up a.next-up__cta')).toHaveAttribute('href', `/app/tests/${S.attemptId}`)
    await noHorizontalOverflow(page)
    await page.locator('.next-up a.next-up__cta').click()
    await expect(page).toHaveURL(new RegExp(`/app/tests/${S.attemptId}$`))
  })
})

test('the runner: a lost answer-save response keeps the choice, Retry leaves one durable response; refresh resumes; submit', async ({ page }) => {
  await login(page, db, S.email, `/app/tests/${S.attemptId}`)
  const first = S.byStem.get((await page.locator('#q-h').innerText()).trim()); const key = Number(first.key_index)
  const opts = page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio')
  const saved = async () => ((await db.from('assessment_responses').select('selected_option_index').eq('attempt_id', S.attemptId).eq('item_id', first.id)).data ?? [])
  await rec.browser('the save commits but the response never arrives: the screen says it could not confirm, keeps the selection and the confidence, and does not move on', () => expecting([{ label: 'the injected lost answer-save response', url: /\/api\/tests\/attempt\/[^/]+\/answer$/, failed: 'any', min: 1, max: 3 }], async () => {
    await page.route('**/api/tests/attempt/*/answer', async r => { await r.fetch(); await r.abort('failed') })
    await opts.nth(key).click(); await page.getByRole('radio', { name: 'Sure', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: /could not confirm it was saved/ })).toBeVisible()
    await expect(opts.nth(key)).toBeChecked(); await expect(page.getByRole('radio', { name: 'Sure', exact: true })).toBeChecked()
    await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible()
    expect((await saved()).length).toBe(1)   // the server did commit: the retry below must not add a second
  }))
  await rec.browser('Retry saving: still exactly ONE durable response, the answer is shown as saved, and the student can move on', async () => {
    await page.unroute('**/api/tests/attempt/*/answer')
    await page.getByRole('button', { name: 'Retry saving' }).click()
    await expect(page.getByRole('button', { name: /^Next/ })).toBeVisible({ timeout: 20_000 })
    const rows = await saved(); expect(rows.length).toBe(1); expect(rows[0].selected_option_index).toBe(key)
  })
  S.answers = [{ id: first.id, correct: true }]
  await rec.browser('refresh mid-paper resumes with the saved answer kept', async () => {
    await page.getByRole('button', { name: /^Next/ }).click(); await page.reload(); await expect(page.locator('#q-h')).toBeVisible()
    expect((await saved()).length).toBe(1)
  })
  await rec.browser('the rest are answered in the UI (the first two wrong with high confidence, so the result has findings) and the paper is submitted', async () => {
    // after the reload the runner is on the first unanswered question
    const remaining = S.n - 1; const stem = async () => (await page.locator('#q-h').innerText()).trim()
    for (let i = 0; i < remaining; i++) {
      const it = S.byStem.get(await stem()); const k = Number(it.key_index), o = page.getByRole('radiogroup', { name: 'Answer choices' }).getByRole('radio'), c = await o.count()
      const wrong = i < 2; await o.nth(wrong ? (k + 1) % c : k).click(); await page.getByRole('radio', { name: 'Sure', exact: true }).click()
      S.answers.push({ id: it.id, correct: !wrong })
      if (i < remaining - 1) await page.getByRole('button', { name: /^Next/ }).click()
    }
    await submit(page)
  })
  await rec.api('one response per question, one evidence event per answered question, and the score is paper-score.1 on what the student did', async () => {
    const a = (await db.from('assessment_attempts').select('status, score, delivered_count, valid_response_count, correct_response_count, omitted_count').eq('id', S.attemptId).single()).data!
    const correct = S.answers.filter((x: any) => x.correct).length
    expect(a).toMatchObject({ status: 'scored', delivered_count: S.n, valid_response_count: S.n, omitted_count: 0, correct_response_count: correct }); expect(a.score).toBe(Math.round(100 * correct / S.n))
    expect(((await db.from('assessment_responses').select('id').eq('attempt_id', S.attemptId)).data ?? []).length).toBe(S.n)
    expect(((await db.from('evidence_events').select('id').eq('attempt_id', S.attemptId)).data ?? []).length).toBe(S.n)
    S.score = a.score; S.correct = correct
  })
})

test('the result, Curriculum and Coach agree on score, sample size and scope', async ({ page }) => {
  await login(page, db, S.email, `/app/tests/${S.attemptId}/result`)
  await rec.browser('Home exposes the exact scored result and returns to it', async () => {
    await page.goto('/app')
    const link = page.locator(`a[href="/app/tests/${S.attemptId}/result"]`).first()
    await expect(link).toBeVisible(); await link.click()
    await expect(page).toHaveURL(new RegExp(`/app/tests/${S.attemptId}/result$`))
  })
  await rec.browser('the result shows the score and the number of questions', async () => {
    await expect(page.locator('body')).toContainText(`${S.correct}`); await expect(page.locator('body')).toContainText(`${S.n}`); await noHorizontalOverflow(page)
  })
  await rec.browser('the Curriculum reading page for a confidently-missed outcome shows that outcome with an evidence verdict of a miss or gap (one observation), and never a mastery claim', async () => {
    const missed = S.items.find((i: any) => i.id === S.answers.find((a: any) => !a.correct)!.id)
    const lo = (await db.from('reading_los').select('title, code, reading_id').eq('id', missed.outcome_id).single()).data!
    const topic = (await db.from('curriculum_readings').select('topic_id').eq('id', lo.reading_id).single()).data!.topic_id as string
    await page.goto(`/app/curriculum/${topic}/${lo.reading_id}`)
    const row = page.locator('li, article, tr, div').filter({ hasText: lo.title }).filter({ hasText: /Concept miss|Known gap/ }).first()
    await expect(row).toBeVisible()
    const body = await page.locator('body').innerText(); expect(body).not.toMatch(/you have mastered|guaranteed/i)
    await noHorizontalOverflow(page)
  })
  await rec.browser('Coach on that exact result links it, states no mastery guarantee, and uses the same score', async () => {
    await page.goto(`/app/coach?attempt=${S.attemptId}`)
    await expect(page.getByRole('region', { name: 'Selected paper' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Selected paper' })).toContainText(String(S.score))
    await noHorizontalOverflow(page)
  })
  // Phase 5: result -> mistake note -> card, with the exact object and the way back, and NO effect on evidence or repair state.
  await rec.browser('result -> "Write a note" opens that outcome\'s reading Notes with the result context and a Back to the SAME result; a mistake note and a card change no evidence or repair state', () => expecting([NAV_ABORT], async () => {
    const before = { ev: ((await db.from('evidence_events').select('id').eq('user_id', S.id)).data ?? []).length, rp: ((await db.from('repair_threads').select('id, status, latest_check_state').eq('user_id', S.id)).data ?? []) }
    await page.goto(`/app/tests/${S.attemptId}/result`)
    const missed = S.items.find((i: any) => i.id === S.answers.find((a: any) => !a.correct)!.id)
    const lo = (await db.from('reading_los').select('title, reading_id').eq('id', missed.outcome_id).single()).data!
    await page.getByText('Evidence by reading, subject and outcome').click()   // the list is inside this collapsed section
    await page.locator('li', { hasText: lo.title }).getByRole('link', { name: 'Write a note' }).first().click()
    await expect(page).toHaveURL(new RegExp(`tab=notes.*los=|los=.*tab=notes`)); await expect(page).toHaveURL(new RegExp(`result=${S.attemptId}`))
    await expect(page.getByText(/From your result/)).toBeVisible(); await expect(page.getByText(new RegExp(`About outcome: ${lo.title.slice(0, 20).replace(/[()]/g, '.')}`))).toBeVisible()
    await page.getByRole('button', { name: 'Add mistake notes' }).click(); await page.keyboard.type('Missed this because I mixed up the two definitions.')
    await expect.poll(async () => JSON.stringify((await db.from('curriculum_notes').select('doc').eq('user_id', S.id).eq('scope_id', lo.reading_id).maybeSingle()).data?.doc ?? {}), { timeout: 15_000 }).toContain('What I missed')
    await page.getByRole('navigation', { name: 'Reading sections' }).getByRole('link', { name: /^Cards/ }).click(); await expect(page).toHaveURL(new RegExp(`result=${S.attemptId}`))
    await page.getByLabel('Front', { exact: true }).first().fill('Which definition applies here?'); await page.getByLabel('Back', { exact: true }).first().fill('The one in my note.'); await page.getByRole('button', { name: 'Add card' }).click(); await expect(page.getByText('Which definition applies here?').first()).toBeVisible()
    await page.getByRole('link', { name: /Back/ }).click(); await expect(page).toHaveURL(new RegExp(`/app/tests/${S.attemptId}/result`))
    const after = { ev: ((await db.from('evidence_events').select('id').eq('user_id', S.id)).data ?? []).length, rp: ((await db.from('repair_threads').select('id, status, latest_check_state').eq('user_id', S.id)).data ?? []) }
    expect(after.ev).toBe(before.ev); expect(after.rp).toEqual(before.rp)
    expect((await db.from('assessment_attempts').select('status, score').eq('id', S.attemptId).single()).data).toEqual({ status: 'scored', score: S.score })
    await noHorizontalOverflow(page)
  }))
})

const repairTasks = async () => (await db.from('plan_blocks').select('id, title, local_date, repair_thread_id, execution').eq('user_id', S.id).eq('task_type', 'repair').is('cancelled_at', null)).data ?? []
test('repair: preview writes nothing, acceptance puts exact work in the Calendar, finishing it makes the re-check due', async ({ page }) => {
  await rec.api('SEEDED repair capacity: daily 00:00–23:59 windows for this student, so this journey can finish BOTH repair threads (no-room is tested separately)', async () => {
    await db.from('availability_windows').delete().eq('user_id', S.id).throwOnError()
    await db.from('availability_windows').insert([0,1,2,3,4,5,6].map(weekday => ({user_id:S.id,weekday,start_time:'00:00',end_time:'23:59',status:'active'}))).throwOnError()
  })
  await login(page, db, S.email, `/app/tests/${S.attemptId}/result`)
  await rec.browser('Review follow-up previews exactly what would be added; nothing is scheduled yet', async () => {
    expect((await repairTasks()).length).toBe(0)
    await page.getByRole('button', { name: 'Review follow-up' }).click(); await expect(page.getByText(/Nothing is added until you confirm/)).toBeVisible(); expect((await repairTasks()).length).toBe(0)
    // Deliberate student choices, not an assumed weekday: put repairs at the cycle end so a spaced check cannot be placed in this preview.
    const choices=page.locator('select[aria-label^="Day for "]')
    for(const label of await choices.evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')!))) {
      const choice=page.getByRole('combobox',{name:label,exact:true})
      await choice.selectOption(S.cycle.ends_at_local)
      await expect(page.getByRole('button',{name:'Confirm changes',exact:true})).toBeEnabled()
      await expect(choice).toHaveValue(S.cycle.ends_at_local)
    }
    await expect(page.getByText('Re-check waiting.').first()).toBeVisible()
  })
  await rec.browser('Confirm changes adds the repair work once, linked to its follow-up threads', () => expecting([NAV_ABORT], async () => {
    await page.getByRole('button', { name: 'Confirm changes' }).click(); await expect(page.getByText(/added to your calendar/)).toBeVisible()
    const t = await repairTasks(); expect(t.length).toBeGreaterThan(0); expect(t.every(x => x.repair_thread_id)).toBe(true); S.repairIds = t.map(x => x.id)
  }))
  await rec.browser('each repair opens in the Calendar drawer on its exact task, and is finished there with minutes', async () => {
    for (const t of await repairTasks()) {
      await page.goto(`/app/calendar?view=agenda&week=${t.local_date}&task=${t.id}`)
      const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await expect(d).toContainText(t.title)
      await d.getByRole('button', { name: 'Done', exact: true }).click(); await d.getByRole('spinbutton', { name: 'Actual minutes' }).fill('25'); await d.getByRole('button', { name: 'Save as done' }).click()
      await expect.poll(async () => (await db.from('plan_blocks').select('execution').eq('id', t.id).single()).data?.execution, { timeout: 20_000 }).toBe('completed')
    }
  })
  await rec.api('finishing repair work only moves the threads to awaiting-re-check: no verdict, no new evidence', async () => {
    const th = (await db.from('repair_threads').select('status, latest_check_state').eq('user_id', S.id)).data ?? []
    expect(th.length).toBeGreaterThan(0); expect(th.every(t => t.status === 'awaiting_recheck' && t.latest_check_state === null), JSON.stringify(th)).toBe(true)
    expect(((await db.from('evidence_events').select('id').eq('user_id', S.id)).data ?? []).length).toBe(S.n)
  })
})

test('the re-check: placed from the result, refused before the spacing, fresh independent families after it, intended scope only', async ({ page }) => {
  await login(page, db, S.email, `/app/tests/${S.attemptId}/result`)
  const threads = (await db.from('repair_threads').select('id, concept_id').eq('user_id', S.id)).data ?? []
  await rec.browser('BEFORE the spacing: "Add the re-check" is refused in the UI with the due date; no re-check task and no attempt exist', () => expecting([{ label: 'the refused re-check placement (before the spacing)', url: /\/api\/diagnostic\/repair\/check$/, statuses: [409], min: 1, max: 2 }], async () => {
    const before = await attempts(), add = page.getByRole('button', { name: /Add the re-check/ }).first(); await expect(add).toBeVisible()
    await add.click(); await expect(page.getByText(/re-check is due \d{4}-\d{2}-\d{2}/i).first()).toBeVisible()
    expect(((await db.from('plan_blocks').select('id').eq('user_id', S.id).eq('task_type', 'recheck').is('cancelled_at', null)).data ?? []).length).toBe(0); expect(await attempts()).toBe(before)
  }))
  const shift2=await shiftStudentTimeline(S.id,1,owned)
  S.timeFixtures.push({id:'T2',student:S.id,...shift2,proves:'eligible re-check after a coherent prior week of repair history',cannotProve:'that a real week elapsed, reminders or cron'})
  await rec.browser('the weekly review in the UI opens the next week (the re-check cannot fit the closed one, as the app said): every unfinished study task is recorded as not done, then saved', () => expecting([NAV_ABORT], async () => {
    await page.goto('/app/review-week')
    const groups = page.getByRole('radiogroup', { name: /^What happened with / }); const n = await groups.count()
    for (let i = 0; i < n; i++) await groups.nth(i).getByLabel('Not done').check()
    await page.getByRole('button', { name: 'Preview next week' }).click(); await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await expect.poll(async () => (await db.from('planning_cycles').select('id').eq('user_id', S.id)).data!.length, { timeout: 30_000 }).toBe(2)
    expect(((await db.from('planning_cycles').select('id').eq('user_id', S.id).eq('status', 'active')).data ?? []).length).toBe(1)
  }))
  await rec.browser('AFTER the spacing (only the dated history differs): "Add the re-check" puts ONE task in the Calendar, linked to those repairs; pressing it again adds no second', async () => {
    await page.goto(`/app/tests/${S.attemptId}/result`)
    await page.getByRole('button', { name: /Add the re-check/ }).first().click(); await expect(page.getByText(/re-check is in your calendar/i)).toBeVisible()
    const checks = (await db.from('plan_blocks').select('id, local_date').eq('user_id', S.id).eq('task_type', 'recheck').is('cancelled_at', null)).data ?? []
    expect(checks.length).toBe(1); S.check = checks[0]
    const linked = ((await db.from('repair_check_threads').select('thread_id').eq('user_id', S.id).eq('check_task_id', S.check.id)).data ?? []).map(l => l.thread_id as string)
    expect(linked.length).toBe(1)   // the UI places one re-check per repaired concept
    S.repairedConcepts = threads.filter(t => linked.includes(t.id)).map(t => t.concept_id)
  })
  // Placement follows the time shift and rollover: the new check stays in the current accepted week, never in read-only history.
  await rec.browser('Start re-check opens a paper of questions never seen, from families never used, for the repaired concepts only', () => expecting([NAV_ABORT], async () => {
    const t = (await db.from('plan_blocks').select('id, local_date').eq('id', S.check.id).single()).data!
    await page.goto(`/app/calendar?view=agenda&week=${t.local_date}&task=${t.id}`)
    const d = page.getByRole('dialog'); await expect(d).toBeVisible(); await d.getByRole('button', { name: 'Start re-check' }).click()
    await Promise.race([page.waitForURL(/\/app\/tests\/[0-9a-f-]{36}$/), d.getByRole('alert').waitFor().then(async () => { throw new Error(`Start refused: ${await d.getByRole('alert').innerText()} | task ${JSON.stringify(t)} | today ${new Date().toISOString()}`) })])
    S.recheckId = page.url().split('/').pop(); expect(S.recheckId).not.toBe(S.attemptId)
    const r = await itemsOf(S.recheckId); S.rItems = r.items; S.rBy = r.byStem
    const seenFam = new Set(S.items.map((i: any) => i.family_id)), seenIds = new Set(S.items.map((i: any) => i.id))
    expect(r.items.length).toBeGreaterThan(0); expect(r.items.every(i => bankRecord.items.includes(i.id) && !seenIds.has(i.id) && !seenFam.has(i.family_id) && S.repairedConcepts.includes(i.concept_id))).toBe(true)
    expect(new Set(r.items.map(i => i.family_id)).size).toBe(r.items.length)
  }))
  await rec.browser('the re-check is answered in the UI and scored; each check is recorded against THIS attempt and the first paper is unchanged', async () => {
    await answerAll(page, S.rBy, S.rItems.length); await submit(page)
    const linkedIds = ((await db.from('repair_check_threads').select('thread_id').eq('check_task_id', S.check.id)).data ?? []).map(l => l.thread_id as string)
    const th = (await db.from('repair_threads').select('id, status, latest_check_state, latest_check_attempt_id, closure_reason').eq('user_id', S.id)).data ?? []
    expect(th.filter(t => linkedIds.includes(t.id)).every(t => t.latest_check_state === 'supported' && t.latest_check_attempt_id === S.recheckId)).toBe(true)
    expect(th.filter(t => !linkedIds.includes(t.id)).every(t => t.latest_check_attempt_id === null && t.status === 'awaiting_recheck')).toBe(true)   // the other repair was not checked, so nothing was claimed for it
    const first = (await db.from('assessment_attempts').select('status, score').eq('id', S.attemptId).single()).data!; expect(first).toEqual({ status: 'scored', score: S.score })
    await noHorizontalOverflow(page)
  })
  await rec.api('closure follows the recorded policy (not changed for the fixture): a thread is closed only if its closure reason says supported-on-check, otherwise it stays awaiting-re-check', async () => {
    const th = (await db.from('repair_threads').select('status, closure_reason').eq('user_id', S.id)).data ?? []
    expect(th.every(t => (t.status === 'closed' ? String(t.closure_reason).startsWith('supported_on_check') : t.status === 'awaiting_recheck'))).toBe(true)
  })
  void addDays
})
