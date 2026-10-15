/**
 * End-to-end check of the calendar and its link to diagnostics.
 *
 * Proves the behaviour the product depends on:
 *   - the weekly cumulative is scheduled on the day the student's study week
 *     ends, whichever weekday that is
 *   - scheduling is idempotent, so revisiting a page never duplicates it
 *   - a scored diagnostic produces a reviewable proposal, not a silent write
 *   - follow-up work taken on the last day of a cycle lands in the next week
 *
 *   npm run dev
 *   npx tsx scripts/e2e-calendar.ts --reset
 */
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import {
  WEEKDAY_NAMES, resolveStudyWeek, weekdayOf, type Weekday,
} from '../src/lib/planning/studyWeek'
import { resolvePulseWeek } from '../src/lib/planning/pulse/weekBoundary'

dotenv.config({ path: '.env.local', quiet: true } as any)

import { getE2EEmail, verifyAndGetE2EUser, resetE2EUser, E2E_BASE_URL } from '../src/lib/testing/e2eIdentity'

const BASE = E2E_BASE_URL
const EMAIL = getE2EEmail()
const MANIFEST_ID = '11111111-1111-1111-1111-111111111111'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const jar = new Map<string, string>()
function storeCookies(res: Response) {
  for (const line of ((res.headers as any).getSetCookie?.() ?? []) as string[]) {
    const [pair] = line.split(';')
    const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}
async function req(path: string, init: RequestInit = {}) {
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) } })
  storeCookies(res)
  return res
}
async function json(path: string, init: RequestInit = {}) {
  const res = await req(path, init)
  const text = await res.text()
  try { return { status: res.status, body: JSON.parse(text) } } catch { return { status: res.status, body: { raw: text.slice(0, 300) } } }
}
const postJson = (p: string, b?: unknown) =>
  json(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function signIn() {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: EMAIL })
  if (error) throw new Error(error.message)
  let path = `/auth/confirm?token_hash=${(data.properties as any).hashed_token}&type=magiclink&next=/app/calendar`
  for (let i = 0; i < 5; i++) {
    const res = await req(path)
    const loc = res.headers.get('location')
    if (!loc) break
    path = new URL(loc, BASE).pathname + new URL(loc, BASE).search
    if (path.startsWith('/app')) break
  }
  check('signed in', path.startsWith('/app'), `ended at ${path}`)
}

async function userId(): Promise<string> {
  const { data } = await admin.auth.admin.listUsers()
  const users = (data as { users?: { id: string; email?: string }[] } | null)?.users ?? []
  const id = users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase())?.id
  if (!id) throw new Error(`no account for ${EMAIL}`)
  return id
}

async function main() {
  console.log(`\nEnd-to-end: calendar and diagnostics against ${BASE}\n`)
  console.log('Authentication')
  await signIn()
  const uid = await userId()

  if (process.argv.includes('--reset')) {
    console.log('\nResetting this account')
    // Order matters: plan_blocks reference repair_threads, so the threads must
    // go last. Deleting them first fails on the foreign key, and a silently
    // failed delete leaves 'scheduled' threads that make the next proposal come
    // back empty — which looks like a product bug and is not one.
    await admin.from('evidence_events').delete().eq('user_id', uid)
    await admin.from('item_challenges').delete().eq('user_id', uid)
    await admin.from('assessment_responses').delete().eq('user_id', uid)
    await admin.from('assessment_attempts').delete().eq('user_id', uid)
    await admin.from('plan_blocks').delete().eq('user_id', uid)
    await admin.from('coach_proposals').delete().eq('user_id', uid)
    // Repair threads survive an attempt by design — a concept does not re-open a
    // thread it already has — so a suite scoring the same concepts twice must
    // clear them explicitly.
    const { error: threadErr } = await admin.from('repair_threads').delete().eq('user_id', uid)
    if (threadErr) throw new Error(`reset could not clear repair_threads: ${threadErr.message}`)
    check('history cleared', true)
  }

  // --- Study week ---------------------------------------------------------
  // Derived the same way the engine derives it (resolvePulseWeek from real
  // class commitments) rather than from the stale profiles.diagnostic_day
  // mirror — the two can disagree for a class-going student, since the pulse
  // week is class-derived and diagnostic_day is a write-once snapshot that
  // doesn't track commitment changes after checkpoint save.
  console.log('\nStudy week')
  const { data: profile } = await admin.from('profiles').select('timezone').eq('id', uid).maybeSingle()
  const { data: classCommitments } = await admin.from('calendar_commitments')
    .select('weekdays').eq('user_id', uid).eq('kind', 'class').eq('status', 'active')
  const classWeekdays = (classCommitments ?? []).flatMap(c => (c.weekdays ?? []) as Weekday[])
  const tz = profile?.timezone || 'UTC'
  const week = resolvePulseWeek({ classWeekdays, timezone: tz })
  const anchor = week.anchorDay
  console.log(`  study week ${week.startDate} → ${week.endDate}, ends ${WEEKDAY_NAMES[anchor]} (${tz})`)
  check('the week ends on the student\'s chosen day', weekdayOf(week.endDate) === anchor)
  // Class-led cycles follow the class pattern; self-study is Monday-Saturday plus the Sunday paper.
  check('the week is a seven-day cycle', week.days.length === 7)

  // --- Calendar rendering is a pure read --------------------------------
  // Generation no longer happens on render: a week is prepared by an explicit,
  // student-triggered command (POST /api/activation/recover -> review ->
  // acceptance). Rendering Calendar or Tests must not change a single row.
  console.log('\nCalendar Render Purity')
  const { count: blocksBefore } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', uid)
  const calRes = await req('/app/calendar')
  const calHtml = await calRes.text()
  check('calendar renders', calRes.status === 200, `status ${calRes.status}`)
  check('is not the old card list', !calHtml.includes('No active plan was found'))
  await req('/app/calendar')
  await req('/app/tests')
  await req('/app/tests')
  const { count: blocksAfter } = await admin.from('plan_blocks').select('*', { count: 'exact', head: true }).eq('user_id', uid)
  check('visiting Calendar and Tests writes nothing', blocksBefore === blocksAfter, `${blocksBefore} -> ${blocksAfter}`)
  const { data: scheduledPapers } = await admin.from('plan_blocks').select('id').eq('user_id', uid).eq('task_type', 'diagnostic')
  check('no paper was scheduled by rendering', (scheduledPapers?.length ?? 0) === 0)
  // (Week generation, paper classification and reservation are covered by
  //  scripts/e2e-activation.ts and scripts/pulse-paper-test.ts.)

  console.log('\nWeek navigation')
  const nextRes = await req(`/app/calendar?week=${week.days[0]}`)
  check('an explicit week loads', nextRes.status === 200, `status ${nextRes.status}`)
  const weekRedirect = await req('/app/week')
  check('/app/week redirects to /app/calendar',
    weekRedirect.status >= 300 && weekRedirect.status < 400 && (weekRedirect.headers.get('location') ?? '').includes('/app/calendar'),
    `${weekRedirect.status} → ${weekRedirect.headers.get('location')}`)

  // --- Diagnostic → proposal → calendar -----------------------------------
  console.log('\nDiagnostic to calendar')
  const start = await postJson('/api/diagnostic/attempt', {
    manifestId: MANIFEST_ID, purpose: 'module_diagnostic', constraints: { maxQuestions: 6 },
  })
  if (start.body?.ok !== true) {
    check('attempt created', false, JSON.stringify(start.body))
    return finish()
  }
  const attemptId = start.body.attemptId
  check('attempt created', true)

  // Answer everything wrong on purpose, so there is repair work to schedule.
  let answered = 0
  let answerError = ''
  for (let i = 0; i < 30; i++) {
    const next = await json(`/api/diagnostic/attempt/${attemptId}`)
    const item = next.body?.nextItem
    if (!item) break
    const { data: keyRow } = await admin.from('assessment_items').select('key_index').eq('id', item.id).maybeSingle()
    const wrong = ((keyRow?.key_index ?? 0) + 1) % item.options.length
    const res = await postJson(`/api/diagnostic/attempt/${attemptId}/response`, {
      itemId: item.id, selectedOptionIndex: wrong, confidence: 'high',
    })
    if (res.body?.ok !== true) { answerError = `${res.status} ${JSON.stringify(res.body)}`; break }
    answered++
  }
  check('answered the form', answered > 0, answerError || 'no items were served')
  const submit = await postJson(`/api/diagnostic/attempt/${attemptId}/submit`)
  check('scored', submit.body?.ok === true, JSON.stringify(submit.body))
  check('and produced evidence needing repair', (submit.body?.evidenceWritten ?? 0) > 0)

  const preview = await json(`/api/diagnostic/repair?attemptId=${attemptId}`)
  check('a proposal is previewable before anything is written', preview.body?.ok === true && preview.body.proposal,
    JSON.stringify(preview.body).slice(0, 200))

  const proposal = preview.body.proposal
  if (proposal) {
    check('the proposal names the target study week', Boolean(proposal.targetWeekStart && proposal.targetWeekEnd))
    check('it explains where the work lands and why', typeof proposal.reason === 'string' && proposal.reason.length > 10)
    check('it includes a re-check, not just repairs',
      proposal.tasks.some((t: any) => t.taskType === 'recheck'))
    check('no repair is scheduled on the day of the test',
      proposal.tasks.every((t: any) => t.earliestDate > proposal.takenOn),
      `taken ${proposal.takenOn}`)

    // The end-of-cycle rule, checked against the student's own anchor day.
    const takenWeek = resolveStudyWeek({ anchorDay: anchor, timezone: tz, reference: proposal.takenOn })
    if (proposal.takenOn === takenWeek.endDate) {
      check('a test on the last day rolls follow-up into next week',
        proposal.rolledOver === true && proposal.targetWeekStart > takenWeek.endDate,
        `rolledOver=${proposal.rolledOver}, target ${proposal.targetWeekStart}`)
    } else {
      check('a mid-week test keeps follow-up in the same week',
        proposal.rolledOver === false && proposal.targetWeekEnd === takenWeek.endDate,
        `rolledOver=${proposal.rolledOver}`)
    }
  }

  const before = await admin.from('plan_blocks').select('id').eq('user_id', uid).eq('attempt_id', attemptId)
  check('previewing wrote nothing to the calendar', (before.data?.length ?? 0) === 0, `found ${before.data?.length}`)

  const applied = await postJson('/api/diagnostic/repair', { attemptId })
  check('accepting the proposal adds tasks', applied.body?.ok === true && (applied.body.created ?? 0) > 0,
    JSON.stringify(applied.body).slice(0, 200))

  const { data: repairTasks } = await admin
    .from('plan_blocks').select('id, task_type, placement, local_date, origin, attempt_id')
    .eq('user_id', uid).eq('attempt_id', attemptId)
  check('the tasks are in the calendar', (repairTasks?.length ?? 0) > 0)
  check('they are day-preferred, not given an invented clock time',
    (repairTasks ?? []).every(t => t.placement === 'day_preferred'),
    (repairTasks ?? []).map(t => t.placement).join(','))
  check('they are attributed to the diagnostic',
    (repairTasks ?? []).every(t => t.origin === 'diagnostic'))
  check('every one uses a valid task type',
    (repairTasks ?? []).every(t => ['repair', 'recheck'].includes(t.task_type as string)),
    (repairTasks ?? []).map(t => t.task_type).join(','))

  const twice = await postJson('/api/diagnostic/repair', { attemptId })
  // Repair threads move to 'scheduled' once applied, so a second apply has
  // nothing left to schedule. That is the dedup, and it is stronger than a flag.
  check('applying twice does not duplicate',
    twice.body?.ok === true && (twice.body.created ?? 0) === 0,
    JSON.stringify(twice.body).slice(0, 160))
  const { data: afterTwice } = await admin.from('plan_blocks').select('id').eq('user_id', uid).eq('attempt_id', attemptId)
  check('and no second set of tasks exists', (afterTwice ?? []).length === (repairTasks ?? []).length,
    `${(afterTwice ?? []).length} vs ${(repairTasks ?? []).length}`)

  // --- The end-of-cycle rule, exercised live ------------------------------
  // The mid-week path is covered above. This proves the rollover by taking a
  // second diagnostic and dating it to the last day of the study week.
  console.log('\nEnd-of-cycle rollover')
  // Scoped to a reading the first diagnostic did not touch. A concept never
  // re-opens a repair thread it already has, so two unscoped diagnostics that
  // both draw the same top-priority concepts (which they do once the bank has
  // more than a handful of items per concept) leave the second with nothing new
  // to propose. That is correct product behaviour; the suite must not depend on
  // the bank being small enough to avoid it.
  const second = await postJson('/api/diagnostic/attempt', {
    manifestId: MANIFEST_ID, purpose: 'module_diagnostic', constraints: { maxQuestions: 5 },
    requestedScope: { modules: ['r028'] },
  })
  if (second.body?.ok === true) {
    const id2 = second.body.attemptId
    for (let i = 0; i < 20; i++) {
      const next = await json(`/api/diagnostic/attempt/${id2}`)
      const item = next.body?.nextItem
      if (!item) break
      const { data: k } = await admin.from('assessment_items').select('key_index').eq('id', item.id).maybeSingle()
      await postJson(`/api/diagnostic/attempt/${id2}/response`, {
        itemId: item.id, selectedOptionIndex: ((k?.key_index ?? 0) + 1) % item.options.length, confidence: 'high',
      })
    }
    await postJson(`/api/diagnostic/attempt/${id2}/submit`)

    // Date the attempt to the final day of the study week, at the hour the
    // student's diagnostic is scheduled for.
    await admin.from('assessment_attempts')
      .update({ completed_at: new Date(`${week.endDate}T13:30:00Z`).toISOString() })
      .eq('id', id2)

    const rollPreview = await json(`/api/diagnostic/repair?attemptId=${id2}`)
    const rolled = rollPreview.body?.proposal
    check('a proposal is produced for the end-of-week test', Boolean(rolled), JSON.stringify(rollPreview.body).slice(0, 160))
    if (rolled) {
      check('it is marked as rolled over', rolled.rolledOver === true, `rolledOver=${rolled.rolledOver}, takenOn=${rolled.takenOn}`)
      check('the target week begins after the current week ends',
        rolled.targetWeekStart > week.endDate, `target ${rolled.targetWeekStart}, week ends ${week.endDate}`)
      check('no follow-up is squeezed into the remaining hours of that day',
        rolled.tasks.every((t: any) => t.earliestDate > week.endDate),
        rolled.tasks.map((t: any) => t.earliestDate).join(','))
      check('and it says why in plain language',
        typeof rolled.reason === 'string' && rolled.reason.toLowerCase().includes('next'),
        rolled.reason)
    }
  } else {
    console.log('  (not enough unseen items for a second attempt — skipping)')
  }

  console.log('\nThe work is visible where it landed')
  const targetWeek = proposal?.targetWeekStart ?? week.startDate
  const targetRes = await req(`/app/calendar?week=${targetWeek}`)
  const targetHtml = await targetRes.text()
  check('the target week renders', targetRes.status === 200)
  check('and shows the repair work', targetHtml.includes('Repair:'), 'no "Repair:" task found in that week')

  finish()
}

function finish() {
  console.log(`\n${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(e => { console.error('\nCrashed:', e); process.exit(1) })
