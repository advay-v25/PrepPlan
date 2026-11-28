/** Phase 6 remaining UI acceptance. Setup is seeded; all student changes are browser-driven. */
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { admin, login, noHorizontalOverflow, RUN, addDays, wd } from './helpers'
import { scopedErrors } from './scopedErrors'
import { todayInZone, zonedTimeToUtc } from '../../../src/lib/planning/studyWeek'

const db = admin(), owned: string[] = [], se = scopedErrors(), records: unknown[] = []
test.beforeEach(({ page }) => se.attach(page))
test.afterAll(async ({}, info) => {
  for (const id of owned.splice(0)) { const r = await db.auth.admin.deleteUser(id); expect(!r.error || /not found/i.test(r.error.message)).toBe(true) }
  fs.writeFileSync(`docs/evidence/phase6-completion-${info.project.name}-${RUN}.json`, JSON.stringify({ at: new Date().toISOString(), records, errors: se.unexpected, allowances: se.allowances }, null, 2))
  expect(se.unexpected).toEqual([])
})

test('Settings: committed impact-read failure remains visible; reload shows the saved version; lost response preserves the edit', async ({ page }) => {
  const s = await createStudent(db, `p6s${RUN}`, { onboard: true, register: id => owned.push(id) })
  await login(page, db, s.email, '/onboarding/week?returnTo=%2Fapp%2Fsettings')
  const version = async () => (await db.from('profiles').select('onboarding_context_version').eq('id', s.id).single()).data!.onboarding_context_version
  const before = await version()
  await page.route('**/api/onboarding/week', async r => {
    if (r.request().method() !== 'POST') return r.continue()
    const res = await r.fetch({timeout:90_000}), body = await res.json()
    expect(body.ok).toBe(true)
    await r.fulfill({ response: res, json: { ...body, impact: { unavailable: true } } })
  })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Your changes are saved' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText(`version ${before + 1}`)
  expect(await version()).toBe(before + 1)
  await page.unroute('**/api/onboarding/week')
  await page.getByRole('button', { name: 'Reload saved setup' }).click()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  // The response is lost after a real successful commit. No repeated write is claimed to be a new save.
  await page.route('**/api/onboarding/week', async r => { if (r.request().method() === 'POST') { await r.fetch({timeout:90_000}); await r.abort('failed') } else await r.continue() })
  await se.expecting([{ label: 'lost setup response after commit', url: /\/api\/onboarding\/week$/, failed: true, min: 1, max: 1 }], async () => {
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'not confirmed whether this saved' })).toBeVisible()
  })
  expect(await version()).toBe(before + 2)
  await page.unroute('**/api/onboarding/week'); await page.reload()
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
  await noHorizontalOverflow(page)
  records.push({ case: 'setup saved-impact-unavailable and lost commit response', seeded: 'ordinary student and accepted week', simulated: 'successful response impact marked unavailable; lost actual committed response', driven: 'Save, receipt, reload and second Save', versions: [before, await version()] })
})

test('Calendar: keyboard placement and resize, protected-conflict exact link, input retained, history and forecast', async ({ page }) => {
  const s = await createStudent(db, `p6c${RUN}`, { onboard: true, onboarding:FRESH_STUDENT_ONBOARDING, register: id => owned.push(id) })
  const cycle = (await db.from('planning_cycles').select('*').eq('user_id', s.id).eq('status', 'active').single()).data!
  const timezone = 'Europe/London'
  const day = addDays(todayInZone(timezone), 1)
  if (day > cycle.ends_at_local) {
    await db.from('planning_cycles').update({
      ends_at_local: day,
      ends_at: zonedTimeToUtc(day, '23:59', timezone).toISOString(),
    }).eq('id', cycle.id).throwOnError()
  }
  await db.from('plan_blocks').delete().eq('user_id', s.id).throwOnError()
  const task = `p6-keyboard-${RUN}`
  // This test starts from an ordinary in-window move on any weekday, then
  // deliberately exercises protected time and a longer-than-usual sitting.
  await db.from('availability_windows').delete().eq('user_id', s.id).eq('weekday', wd(day)).throwOnError()
  await db.from('availability_windows').insert({ user_id: s.id, weekday: wd(day), start_time: '18:30', end_time: '22:00', status: 'active' }).throwOnError()
  await db.from('plan_blocks').insert({ id: task, user_id: s.id, cycle_id: cycle.id, title: 'Keyboard placement probe', detail: 'Owned fixture for keyboard placement', task_type: 'study', origin: 'student', priority: 'core', placement: 'day_preferred', execution: 'not_started', local_date: day, day, duration_minutes: 44, duration: '44', created_by: 'student' }).throwOnError()
  const c = (await db.from('calendar_commitments').insert({ user_id: s.id, label: 'Protected appointment probe', kind: 'personal', recurrence: 'none', starts_at: zonedTimeToUtc(day, '20:00', timezone).toISOString(), ends_at: zonedTimeToUtc(day, '21:00', timezone).toISOString(), is_protected: true, status: 'active' }).select('id').single().throwOnError()).data!
  await login(page, db, s.email, `/app/calendar?week=${day}&view=agenda&task=${task}`)
  const drawer = page.getByRole('dialog'), start = drawer.getByLabel('Start', { exact: true })
  await start.fill('19:00'); await expect(drawer.getByRole('combobox', { name: 'Length', exact: true })).toHaveValue('44')
  let release!: () => void; const gate = new Promise<void>(r => { release = r })
  await page.route('**/api/tasks/*', async r => { if (r.request().method() === 'PATCH') await gate; await r.continue() })
  await drawer.getByRole('button', { name: 'Apply', exact: true }).focus(); await page.keyboard.press('Enter')
  await expect(start).toBeDisabled(); await page.keyboard.press('Escape'); await expect(drawer).toBeVisible()
  release()
  await expect(drawer).toHaveCount(0)
  await page.unroute('**/api/tasks/*')
  const saved = (await db.from('plan_blocks').select('starts_at, duration_minutes, revision').eq('id', task).single()).data!
  expect(saved.duration_minutes).toBe(44); expect(saved.starts_at).toBeTruthy()
  await page.goto(`/app/calendar?week=${day}&view=agenda&task=${task}`)
  await start.fill('20:00')
  await se.expecting([{ label: 'protected slot refusal', url: /\/api\/tasks\//, statuses: [409], min: 1, max: 1 }], async () => {
    await drawer.getByRole('button', { name: 'Apply', exact: true }).click()
    const conflict = page.getByRole('alertdialog')
    await expect(conflict.getByRole('link', { name: 'Open Protected appointment probe' })).toHaveAttribute('href', new RegExp(`entry=${c.id}`))
    await conflict.getByRole('button', { name: 'Leave it where it was' }).click()
  })
  await expect(start).toHaveValue('20:00')
  expect((await db.from('plan_blocks').select('starts_at, duration_minutes, revision').eq('id', task).single()).data).toEqual(saved)
  await start.fill('19:00'); await drawer.getByRole('combobox',{name:'Length',exact:true}).selectOption('60')
  await se.expecting([{label:'one-time sitting-length warning',url:/\/api\/tasks\//,statuses:[409],min:1,max:1}],async()=>{
    await drawer.getByRole('button',{name:'Apply',exact:true}).click()
    await expect(page.getByRole('alertdialog')).toContainText('longer than your usual 45-minute limit')
    expect((await db.from('plan_blocks').select('revision').eq('id',task).single()).data?.revision).toBe(saved.revision)
    await page.getByRole('alertdialog').getByRole('button',{name:'Place it anyway',exact:true}).click()
    await expect.poll(async()=>(await db.from('plan_blocks').select('duration_minutes').eq('id',task).single()).data?.duration_minutes).toBe(60)
  })
  expect((await db.from('profiles').select('max_session_minutes').eq('id',s.id).single()).data?.max_session_minutes).toBe(45)
  await page.keyboard.press('Escape'); await noHorizontalOverflow(page)
  await page.goto(`/app/calendar?week=${day}&entry=${c.id}&view=agenda`)
  await expect(page.getByRole('dialog').getByRole('heading')).toContainText('Protected appointment probe')
  await page.keyboard.press('Escape')
  await page.goto(`/app/calendar?week=${addDays(day, 21)}&view=agenda`)
  await expect(page.locator('main')).toContainText(/forecast/i)
  await page.getByRole('tab',{name:'Week',exact:true}).click()
  await page.locator('.calendar-column').first().click({position:{x:4,y:4}})
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Add commitment',exact:true})).toBeVisible()
  await page.getByRole('tab',{name:'Agenda',exact:true}).click()
  await noHorizontalOverflow(page)
  const past = addDays(cycle.starts_at_local, -21), pastEnd = addDays(cycle.ends_at_local,-21)
  await db.from('planning_cycles').update({ status:'closed', starts_at_local:past, ends_at_local:pastEnd, starts_at:`${past}T00:00:00Z`, ends_at:`${pastEnd}T23:59:59Z` }).eq('id',cycle.id).throwOnError()
  await db.from('plan_blocks').update({ local_date:past, day:past, starts_at:null, placement:'day_preferred' }).eq('id',task).throwOnError()
  await page.goto(`/app/calendar?week=${past}&view=agenda&task=${task}`)
  await expect(page.getByRole('dialog')).toContainText('This is recorded history')
  await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Add commitment',exact:true})).toHaveCount(0)
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('.cal-export > summary').click()
  await expect(page.locator('[data-calendar-export]').getByLabel('From',{exact:true})).toHaveValue(past)
  await expect(page.locator('[data-calendar-export]').getByLabel('To',{exact:true})).toHaveValue(pastEnd)
  let releaseExport!:()=>void; const exportGate=new Promise<void>(r=>{releaseExport=r})
  await page.route('**/api/calendar/export?**',async r=>{await exportGate;await r.continue()})
  await page.locator('[data-calendar-export]').getByRole('button',{name:'Preview',exact:true}).click()
  await expect(page.locator('[data-calendar-export]').getByLabel('From',{exact:true})).toBeDisabled()
  await expect(page.locator('[data-calendar-export]').getByLabel('To',{exact:true})).toBeDisabled()
  releaseExport(); await expect(page.locator('[data-export-preview]')).toBeVisible()
  await page.unroute('**/api/calendar/export?**')
  await page.getByRole('link',{name:'Today',exact:true}).click()
  await expect(page.locator('#calendar-today')).toBeVisible()
  await page.emulateMedia({ reducedMotion:'reduce' })
  const viewport = page.viewportSize()!
  if (viewport.width >= 1000) {
    // Half the CSS viewport is the reflow equivalent of 200% desktop zoom; no claim about native browser zoom input.
    await page.setViewportSize({width:Math.floor(viewport.width/2),height:Math.floor(viewport.height/2)})
    await noHorizontalOverflow(page)
    await page.setViewportSize(viewport)
  }
  await page.getByRole('tab',{name:'Agenda',exact:true}).focus(); await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab',{name:'Week',exact:true})).toHaveAttribute('aria-selected','true')
  await expect(page.getByRole('tab',{name:'Week',exact:true})).toBeFocused()
  await page.keyboard.press('End'); await page.reload()
  await expect(page.getByRole('tab',{name:'Agenda',exact:true})).toHaveAttribute('aria-selected','true')
  await noHorizontalOverflow(page)
  await page.screenshot({path:`/tmp/roadmap-p6-final/calendar-${test.info().project.name}.png`,fullPage:false})
  records.push({ case: 'keyboard placement/resize, conflict link and forecast', seeded: 'owned task, protected commitment and cycle dates', driven: 'drawer fields and Enter, refused conflicting time, exact entry link, future week', saved })
})

test('Account: failed deletion is retryable; a lost successful response never reports a definite rollback', async ({ page }) => {
  const s = await createStudent(db, `p6d${RUN}`, { onboard: true, register: id => owned.push(id) })
  await login(page, db, s.email, '/account')
  // Seed real owned commands through their APIs; the quota row represents a prior draft request, not a provider call.
  const reading=(await db.from('curriculum_readings').select('id').eq('is_active',true).eq('structure_pending',false).limit(1).single()).data!.id
  const card=await page.request.post('/api/curriculum/flashcards',{data:{action:'create',requestKey:`p6card-${RUN}`,scopeType:'reading',scopeId:reading,front:'My export marker',back:'My own note'}}); expect(card.ok()).toBe(true)
  const report=await page.request.post('/api/mock-reports',{data:{action:'create',key:`p6report-${RUN}`,input:{takenOn:new Date().toISOString().slice(0,10),scope:'full',scale:'percent',score:48,difficulties:[],topics:[],notes:'My own mock report'}}}); expect(report.ok()).toBe(true)
  await db.from('flashcard_draft_requests').insert({user_id:s.id}).throwOnError()
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download my data',exact:true}).click()])
  const exported=JSON.parse(fs.readFileSync((await download.path())!,'utf8'))
  for(const table of ['flashcard_commands','flashcard_draft_requests','mock_reports','mock_report_commands']) { expect(exported.counts[table]).toBe(1); expect(exported.tables[table].every((r:any)=>r.user_id===s.id)).toBe(true) }
  await page.getByRole('button', { name: 'Delete account…' }).click()
  await page.getByRole('alertdialog').getByRole('textbox').fill(s.email)
  await page.route('**/api/account/delete', r => r.fulfill({ status: 503, json: { error: 'Deletion could not be completed. Your account still exists.' } }))
  await se.expecting([{ label: 'controlled deletion failure', url: /\/api\/account\/delete$/, statuses: [503], min: 1, max: 1 }], async () => {
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'Your account still exists' })).toBeVisible()
  })
  expect((await db.auth.admin.getUserById(s.id)).data.user).toBeTruthy()
  await page.unroute('**/api/account/delete')
  await page.route('**/api/account/delete', async r => { const res = await r.fetch({timeout:90_000}); expect(res.ok()).toBe(true); await r.abort('failed') })
  await se.expecting([{ label: 'lost successful deletion response', url: /\/api\/account\/delete$/, failed: true, min: 1, max: 1 }], async () => {
    await page.getByRole('button', { name: 'Delete my account', exact: true }).click()
    await expect(page.getByRole('alert').filter({ hasText: 'not confirmed whether your account was deleted' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'not confirmed whether your account was deleted' })).toContainText('A failed sign-in alone does not prove deletion.')
  })
  expect((await db.auth.admin.getUserById(s.id)).data.user).toBeNull()
  for(const table of ['flashcard_commands','flashcard_draft_requests','mock_reports','mock_report_commands']) expect((await db.from(table).select('user_id',{count:'exact',head:true}).eq('user_id',s.id).throwOnError()).count).toBe(0)
  await noHorizontalOverflow(page)
  records.push({ case: 'delete failure and lost response', simulated: '503 before write; dropped response after actual deletion', driven: 'dialog confirmation and retry', accountActuallyDeleted: true })
})

test('Home: real failed progress read never becomes zero; retry recovers; final-week and exam-sat history', async ({ page }) => {
  const s = await createStudent(db, `p6h${RUN}`, { onboard: true, register: id => owned.push(id) })
  const faults = process.env.FAULTS_FILE
  expect(faults, 'this journey needs the private upstream harness').toBeTruthy()
  const snapshot = async () => (await db.from('plan_blocks').select('id,execution,revision').eq('user_id', s.id).order('id').throwOnError()).data
  await login(page, db, s.email, '/app'); const before = await snapshot()
  try {
    fs.writeFileSync(faults!, JSON.stringify({ rules: [{ id: 'p6-progress', match: '/rest/v1/evidence_events?select=attempt_id', method: 'GET', mode: 'status', status: 500 }] }))
    await page.reload()
    const failed = page.getByRole('alert').filter({ hasText: 'Your progress summary' })
    await expect(failed).toContainText('could not be loaded')
    await expect(failed.getByRole('button', { name: 'Retry' })).toBeVisible()
    expect(await snapshot()).toEqual(before)
    fs.writeFileSync(faults!, JSON.stringify({ rules: [] }))
    await failed.getByRole('button', { name: 'Retry' }).click()
    await expect(failed).toHaveCount(0)
    await noHorizontalOverflow(page)
  } finally { fs.writeFileSync(faults!, JSON.stringify({ rules: [] })) }
  // Relative-date phase fixture, not a supported 2026 signup: clear the 2027 window so it cannot contradict this UI-only target.
  const today = todayInZone('Europe/London')
  await db.from('profiles').update({ exam_date: addDays(today, 6), exam_window_id:null, exam_year:null, exam_sitting:null }).eq('id', s.id).throwOnError()
  await page.reload(); await expect(page.getByLabel('Final stretch', { exact: true })).toBeVisible()
  await expect(page.locator('.countdown')).toContainText('6 days')
  await noHorizontalOverflow(page)
  await db.from('profiles').update({exam_date:today}).eq('id',s.id).throwOnError()
  await db.from('exam_completion').insert({ user_id: s.id, sat_on: today }).throwOnError()
  await page.reload(); await expect(page.locator('[data-exam-sat]')).toContainText('Study prompts are paused')
  await expect(page.locator('.next-up')).toHaveCount(0); await expect(page.locator('.countdown')).toHaveCount(0)
  await page.locator('[data-exam-sat]').getByRole('link', { name: 'Your history', exact: false }).click()
  await expect(page).toHaveURL(/\/app\/calendar/); await noHorizontalOverflow(page)
  records.push({ case: 'failed Home read, retry, final week, exam sat', seeded: 'relative booked date and exam-completion report', fault: 'real upstream progress read 500 then removed', driven: 'reload/retry and history link', writesOnHomeRender: false })
})

test('Settings app-wide: midway coverage, uncertainty, sitting limit and booked exam preserve accepted work and evidence', async ({ page }) => {
  const topicIds=(await db.from('topics').select('id').order('id').limit(3).throwOnError()).data!.map(t=>t.id as string)
  const s = await createStudent(db, `p6m${RUN}`, { onboard: true, onboarding: { ...FRESH_STUDENT_ONBOARDING, stage:'first_pass_underway', topicExposure:Object.fromEntries(topicIds.map(id=>[id,'recent'])), positionExtra:{uncertainty:{[topicIds[0]]:{level:'few',lmIds:[]},[topicIds[1]]:{level:'most',lmIds:[]}}} }, register: id => owned.push(id) })
  const work = async () => (await db.from('plan_blocks').select('id,execution,revision,local_date,duration_minutes').eq('user_id',s.id).order('id').throwOnError()).data
  const before = await work()
  const save = async () => {
    await page.getByRole('button', { name:'Save', exact:true }).click()
    const next = page.getByRole('button',{name:'Continue',exact:true})
    await expect(page.getByRole('heading',{name:'Your setup',exact:true}).or(next)).toBeVisible()
    if(await next.count()) await next.click()
    await expect(page).toHaveURL(/\/app\/settings$/)
  }
  await login(page,db,s.email,'/onboarding/position?returnTo=%2Fapp%2Fsettings')
  await page.getByRole('button',{name:'Some subjects covered',exact:true}).click()
  const topic=(id:string)=>page.locator('.ob-topiccard').filter({has:page.locator(`[id="topic-${id}"]`)})
  for(const id of topicIds) await expect(topic(id).getByRole('button',{name:'Covered once',exact:true})).toHaveAttribute('aria-pressed','true')
  await topic(topicIds[0]).getByRole('button',{name:'Several areas',exact:true}).click()
  await topic(topicIds[0]).getByRole('button',{name:'A few areas',exact:true}).click()
  await topic(topicIds[1]).getByRole('button',{name:'A few areas',exact:true}).click()
  await topic(topicIds[1]).getByRole('button',{name:'Most of this topic',exact:true}).click()
  await save()
  expect((await db.from('user_topic_exposure').select('topic_id').eq('user_id',s.id).eq('recency','recent')).data).toHaveLength(3)
  expect((await db.from('user_entry_uncertainty').select('level').eq('user_id',s.id)).data?.map(x=>x.level).sort()).toEqual(['few','most'])
  await page.goto('/app/curriculum'); await expect(page.getByLabel('Where you are')).toContainText('recorded as covered')
  await page.goto('/onboarding/week?returnTo=%2Fapp%2Fsettings')
  await page.getByRole('button',{name:'30 min',exact:true}).click(); await save()
  expect((await db.from('profiles').select('max_session_minutes').eq('id',s.id).single()).data?.max_session_minutes).toBe(30)
  await expect(page.locator('.settings-section').filter({has:page.getByRole('heading',{name:'Study time',exact:true})})).toContainText('sittings up to 30 min')
  await page.goto('/onboarding/exam?returnTo=%2Fapp%2Fsettings')
  await page.getByRole('button',{name:/^August/}).click()
  await page.getByRole('button',{name:'Yes, I have a date',exact:true}).click()
  await page.getByLabel('Exact booked exam date').fill('2027-08-20'); await save()
  await expect(page.locator('.settings-section').filter({has:page.getByRole('heading',{name:'Exam date',exact:true})})).toContainText('2027-08-20')
  await page.goto('/app'); await expect(page.locator('.countdown')).toContainText('20 Aug 2027')
  await page.goto('/app/curriculum?view=roadmap'); await expect(page.locator('.curriculum-page')).toContainText(/2027|Aug/)
  await page.goto('/app/tests'); await expect(page.locator('.tests-page')).toBeVisible(); await expect(page.locator('.tests-page')).not.toContainText('Paper is ready')
  await page.goto('/app/coach'); const box=page.getByRole('textbox',{name:'Ask the coach',exact:true})
  await box.fill('when is my exam?'); await box.press('Enter'); await expect(page.locator('.coach-message--coach').last()).toBeVisible(); await expect(page.locator('a[href="/app/exam"]').first()).toBeVisible()
  await page.goto('/app/calendar?view=agenda'); await page.locator('[data-week-context] > summary').click(); await page.locator('[data-placement-summary] summary').click(); await expect(page.locator('[data-placement-summary]')).toContainText('not a weekly hours target')
  expect(await work()).toEqual(before)
  expect((await db.from('evidence_events').select('id',{count:'exact',head:true}).eq('user_id',s.id)).count).toBe(0)
  await noHorizontalOverflow(page)
  records.push({case:'midway entry/settings effects across Home, Calendar, Curriculum, Tests, Coach',seeded:'midway student with three covered subjects and few/most uncertainty, through actual onboarding commands',driven:'position editing, sitting length, target month and booked date; inspect dependent pages',acceptedWorkUnchanged:true,evidence:0})
})
