import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createStudent, FRESH_STUDENT_ONBOARDING } from '../../../scripts/lib/e2eSession'
import { acquireBankLock, releaseBankLock } from '../../../scripts/lib/bankLock'
import { shiftStudentTimeline } from '../../../scripts/lib/timeFixture'
import { todayInZone } from '../../../src/lib/planning/studyWeek'
import { admin, bankCli, login, noHorizontalOverflow, removeStudent, RUN } from './helpers'
import { scopedErrors } from './scopedErrors'

const db = admin(), ZONE = 'Europe/London'
const local = () => test.skip(process.env.E2E_SUITE !== 'local-stack', 'Owned fixtures on the local stack.')
const ALL_RECENT = { quant: 'recent', econ: 'recent', ci: 'recent', fsa: 'recent', eq: 'recent', fi: 'recent', deriv: 'recent', alt: 'recent', pm: 'recent', eth: 'recent' } as const
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, startTime: '08:00', endTime: '22:00' }))

test('bridge · finish first pass -> weakness-only bridge (evidence vs uncertainty) -> no-concern control -> broad revision recall', async ({ page }) => {
  local(); test.setTimeout(300_000)
  const owned: string[] = []
  const errs = scopedErrors(); errs.attach(page)
  const today = todayInZone(ZONE)
  try {
    // 1. Honest no-concern bridge control: finishing last first-pass reading with 0 weaknesses & 0 uncertainty
    const clean = await createStudent(db, `brClean${RUN}`, {
      onboard: true,
      register: id => owned.push(id),
      onboarding: { ...FRESH_STUDENT_ONBOARDING, stage: 'starting_fresh', topicExposure: {}, exam: { sittingIndex: 2, registered: false, timezone: ZONE }, week: { commitments: [], windows: ALL_DAYS, maxSessionMinutes: 45 } },
    })
    const cleanCycle = (await db.from('planning_cycles').select('id, ends_at_local').eq('user_id', clean.id).eq('status', 'active').single().throwOnError()).data!
    const cleanBlocks = (await db.from('plan_blocks').select('id, lm_id').eq('user_id', clean.id).eq('task_type', 'study').order('local_date').throwOnError()).data!
    expect(cleanBlocks.length).toBeGreaterThan(0)
    const lastLm = cleanBlocks[0].lm_id as string
    const allReadings = (await db.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).throwOnError()).data!
    await db.from('user_module_state').upsert(allReadings.filter(r => r.id !== lastLm).map(r => ({ user_id: clean.id, lm_id: r.id, coverage_state: 'studied', source: 'self_report' })), { onConflict: 'user_id,lm_id' }).throwOnError()
    await db.from('plan_blocks').delete().eq('user_id', clean.id).neq('id', cleanBlocks[0].id).throwOnError()
    await db.from('plan_blocks').update({ local_date: today, day: today, placement: 'day_preferred' }).eq('id', cleanBlocks[0].id).throwOnError()
    await db.from('planning_cycles').update({ starts_at_local: today <= cleanCycle.ends_at_local ? today : cleanCycle.ends_at_local }).eq('id', cleanCycle.id).throwOnError()

    await login(page, db, clean.email, '/app')
    await page.getByRole('link', { name: 'Open session' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toBeVisible({ timeout: 20_000 })
    await dlg.getByRole('button', { name: 'Done', exact: true }).click()
    await dlg.getByRole('button', { name: 'Save as done' }).click()
    await expect(dlg).toContainText(/completed/i, { timeout: 15_000 })
    await dlg.getByRole('link', { name: 'Open Reading in Curriculum' }).click()
    const covSaved = page.waitForResponse(r => r.request().method() === 'POST' && /\/api\/curriculum\/coverage$/.test(new URL(r.url()).pathname))
    await page.getByRole('radio', { name: 'Covered', exact: true }).check()
    expect((await covSaved).ok()).toBe(true)
    await shiftStudentTimeline(clean.id, 1, owned)
    await page.goto('/app/review-week')
    await page.getByLabel(/Close this week without a paper/i).check()
    await page.getByRole('button', { name: 'Preview next week' }).click()
    {
      const keepBroad = page.getByRole('button', { name: 'Keep broad revision this week instead' })
      await expect(keepBroad).toBeVisible({ timeout: 30_000 })
      await keepBroad.click()
    }
    await expect(page.getByText('Your first pass is recorded as finished.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('No targeted revision is indicated yet.')).toBeVisible()
    await noHorizontalOverflow(page)

    // 2. Self-reported uncertainty + held readings -> accept -> Calendar & Curriculum
    const s = await createStudent(db, `brMix${RUN}`, {
      onboard: true,
      register: id => owned.push(id),
      onboarding: { ...FRESH_STUDENT_ONBOARDING, stage: 'starting_fresh', topicExposure: {}, exam: { sittingIndex: 2, registered: false, timezone: ZONE }, week: { commitments: [], windows: ALL_DAYS, maxSessionMinutes: 45 } },
    })
    const readings = (await db.from('curriculum_readings').select('id, topic_id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(5).throwOnError()).data!
    const [rLast, rUnsure] = readings
    await db.from('user_entry_uncertainty').insert({ user_id: s.id, topic_id: rUnsure.topic_id, level: 'most', lm_ids: [rUnsure.id] }).throwOnError()
    const blocks = (await db.from('plan_blocks').select('id').eq('user_id', s.id).eq('task_type', 'study').order('local_date').throwOnError()).data!
    const allActReadings = (await db.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).throwOnError()).data!
    await db.from('user_module_state').upsert(allActReadings.map(r => ({ user_id: s.id, lm_id: r.id, coverage_state: 'studied', source: 'self_report' })), { onConflict: 'user_id,lm_id' }).throwOnError()
    await db.from('plan_blocks').delete().eq('user_id', s.id).neq('id', blocks[0].id).throwOnError()
    await db.from('plan_blocks').update({ lm_id: rLast.id, local_date: today, day: today, execution: 'completed' }).eq('id', blocks[0].id).throwOnError()
    await shiftStudentTimeline(s.id, 1, owned)

    await login(page, db, s.email, '/app/review-week')
    await page.getByLabel(/Close this week without a paper/i).check()
    await page.getByRole('button', { name: 'Preview next week' }).click()
    {
      const keepBroad = page.getByRole('button', { name: 'Keep broad revision this week instead' })
      await expect(keepBroad).toBeVisible({ timeout: 30_000 })
      await keepBroad.click()
    }
    await expect(page.getByText('Your first pass is recorded as finished.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/supported by checks, \d+ from your own report/i)).toBeVisible()
    await expect(page.getByText(/Held for broader revision \(\d+\)/)).toBeVisible()
    await noHorizontalOverflow(page)
    await page.getByRole('button', { name: 'Save review and open next week' }).click()
    await page.waitForURL(/\/app\/calendar/, { timeout: 30_000 })
    await page.goto('/app/curriculum')
    await expect(page.getByRole('heading', { name: /Curriculum/i })).toBeVisible()
    await noHorizontalOverflow(page)

    // 3. No-eligible-question control
    await page.goto('/app/tests?view=practice')
    await expect(page.getByText(/0 fresh human-reviewed questions|No reading in this subject/i).first()).toBeVisible()
    expect(errs.unexpected).toEqual([])
  } finally {
    for (const id of owned) await removeStudent(db, id)
  }
})

test('bridge · broad revision recall with fixture bank keeps activity and evidence separate', async ({ page }) => {
  local(); test.setTimeout(300_000)
  await acquireBankLock()
  let file = ''
  const owned: string[] = []
  const errs = scopedErrors(); errs.attach(page)
  try {
    const reading = (await db.from('curriculum_readings').select('id').eq('is_active', true).eq('structure_pending', false).order('sequence').limit(1).single().throwOnError()).data!.id as string
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'p6-bridge-')), 'bank.json')
    execFileSync('node', bankCli('create', [`--out=${file}`, `--readings=${reading}`, '--per-outcome=3', '--variants=0', '--candidates=0']), { stdio: 'inherit' })
    const s = await createStudent(db, `brRev${RUN}`, {
      onboard: true,
      register: id => owned.push(id),
      onboarding: { ...FRESH_STUDENT_ONBOARDING, stage: 'revising_or_mocks', topicExposure: ALL_RECENT, exam: { sittingIndex: 1, registered: false, timezone: ZONE }, week: { commitments: [], windows: ALL_DAYS, maxSessionMinutes: 45 } },
    })
    await login(page, db, s.email, '/app/curriculum')
    await expect(page.getByRole('heading', { name: /Curriculum/i })).toBeVisible()
    // Evidenced weakness in the bridge using the fixture bank's concept
    const loIds = (await db.from('reading_los').select('id').eq('reading_id', reading).throwOnError()).data!.map(x => x.id as string)
    const weakConcept = (await db.from('concept_outcome_map').select('concept_id').in('outcome_id', loIds).limit(1).throwOnError()).data![0].concept_id as string
    await db.from('evidence_events').insert({ user_id: s.id, concept_id: weakConcept, validity: 'valid', is_correct: false, evidence_state: 'needs_repair', self_reported_confidence: 3, assessment_purpose: 'weekly', evidence_mode: 'evidence', item_trust_tier: 'reviewed', scoring_policy_version: 'paper-score.1' }).throwOnError()
    await page.goto('/app/tests?view=practice')
    await expect(page.getByRole('heading', { name: /^Tests$/i })).toBeVisible()
    await expect(page.getByText(/Reading check/i)).toBeVisible()
    await noHorizontalOverflow(page)
    expect(errs.unexpected).toEqual([])
  } finally {
    if (file && fs.existsSync(file)) execFileSync('node', bankCli('destroy', [`--file=${file}`]), { stdio: 'inherit' })
    releaseBankLock()
    for (const id of owned) await removeStudent(db, id)
  }
})
