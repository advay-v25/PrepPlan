import { createAdminClient } from '../supabase/admin'
import { readCanonicalState } from './service'
import { loadRoadmapInputs } from '../curriculum/roadmapService'
import { buildRoadmap } from '../curriculum/roadmap'
import { buildWeekPlanWithPaper } from '../planning/pulse/generateWeek'
import { getStudyWeekContext } from '../planning/schedule'
import { initialCycleNote, REVIEW_BUFFER_MINUTES, USABLE_GAP_MINUTES } from '../planning/pulse/firstCycle'
import { permitsStudyPortions } from '../planning/pulse/weekBoundary'
import { dailyFreeRanges, minutesBetween } from '../planning/pulse/capacity'
import { shiftStudyWeek, utcToZonedParts, weekdayOf } from '../planning/studyWeek'
import { toDraftTasks } from '../planning/draftTasks'
import { withReadSnapshot } from '../ops/perRequest'
import { trace } from '../ops/trace'

export function draftFingerprint(contextVersion: number, weekStart: string, planningDate = weekStart) {
  return `onboarding_initial_week:p2:v${contextVersion}:${weekStart}:${planningDate}`
}

const contextVersionOf = async (userId: string) =>
  ((await createAdminClient().from('profiles').select('onboarding_context_version').eq('id', userId).maybeSingle()).data?.onboarding_context_version ?? 1) as number

/** What the draft says about itself. Stored with it, so a replayed or reused draft describes the week it actually holds. */
export type DraftCycle = {
  start: string; end: string; timezone: string; closingDay: number; classLed: boolean
  initialCycle: { advanced: boolean; reason: string; note: string | null } | null
  /** Set when time was left clear today for reviewing the plan. */ reviewNote: string | null
  /** Study time in this draft starts no earlier than this instant. */ reference: string
}

/** Says what the buffer took from today, or nothing when it took nothing. */
async function reviewNoteFor(userId: string, today: string, timezone: string, now: Date, reference: Date) {
  const sum = (ranges: { start: string; end: string }[], atLeast: number) => ranges.map(r => minutesBetween(r.start, r.end)).filter(m => m >= atLeast).reduce((a, b) => a + b, 0)
  const [beforeRanges, afterRanges] = await Promise.all([
    dailyFreeRanges(userId, weekdayOf(today), today, timezone, now),
    dailyFreeRanges(userId, weekdayOf(today), today, timezone, reference),
  ])
  const before = sum(beforeRanges, 1), left = sum(afterRanges, 1), usable = sum(afterRanges, USABLE_GAP_MINUTES)
  if (before === left) return null   // the buffer took nothing from today
  return usable > 0 ? `Study today starts no earlier than ${utcToZonedParts(new Date(reference.getTime() + 59_999), timezone).time.slice(0, 5)}, which keeps ${REVIEW_BUFFER_MINUTES} minutes clear for you to review this plan.`
    : `Nothing is planned for the rest of today: ${REVIEW_BUFFER_MINUTES} minutes are kept clear for you to review this plan, and what is left is too short for a sitting.`
}

/**
 * `now` is the instant the draft is prepared at (the caller's, so selection and generation agree); study time starts REVIEW_BUFFER_MINUTES later.
 * `afterInputsRead` exists for the race test only: it runs between reading the planning inputs and labelling the draft.
 */
export async function generatePreview(userId: string, opts: { afterInputsRead?: () => Promise<void>; now?: Date } = {}) {
  return withReadSnapshot(async () => {
    const admin = createAdminClient()
  const now = opts.now ?? new Date(), reference = new Date(now.getTime() + REVIEW_BUFFER_MINUTES * 60_000)

  // 0. The version FIRST. Every input below is read at or after this version, so a setup edit made while the preview
  // is generated can only make the draft look older than the setup, never newer (which would let it be accepted).
  const contextVersion = await contextVersionOf(userId)
  const laps: Record<string, number> = {}; let t0 = Date.now()
  const lap = (name: string) => { const n = Date.now(); laps[name] = n - t0; t0 = n }

  // 1. Read canonical state
  const state = await readCanonicalState(userId)
  lap('state')

  // 2. Fetch inputs to build the roadmap
  const input = await loadRoadmapInputs(userId, { now })
  if (!input) throw new Error('Cannot build roadmap: missing inputs')

  // 3. Generate Roadmap Sequence
  lap('roadmap_inputs')
  const roadmap = buildRoadmap(input)

  // 4. The cycle's dates must be the same pulse week buildWeekPlan (below)
  // builds tasks for — that week includes today and ends on the student's
  // derived pulse day, not an arbitrary tomorrow-plus-six span.
  const ctx = await getStudyWeekContext(userId, now)
  lap('roadmap_build_and_week_context')
  const cycleStartDate = ctx.week.startDate
  const cycleEndDate = ctx.week.endDate

  // 5. Persist the roadmap BEFORE calling buildWeekPlan, so getActiveRoadmap can find it
  const { data: tempRoadmap, error: roadmapError } = await admin.from('study_roadmaps').insert({
    user_id: userId,
    exam_window_id: state.profile?.exam_window_id ?? undefined,
    // The resolved target: the exact booked date, or the start of the chosen sitting for an unregistered candidate.
    target_date: input.targetDate,
    route: input.route,
    status: 'draft',
    phases: roadmap.phases,
    inputs: input,
    feasibility: roadmap.feasibility ?? {}
  }).select().single()

  if (roadmapError || !tempRoadmap) {
    throw new Error(`Failed to create roadmap: ${roadmapError?.message || 'Unknown error'}`)
  }

  // 6. Generate first week's tasks — the real Pulse engine (spec Phase A)
  // Now buildWeekPlan's internal getActiveRoadmap() can find the persisted roadmap. The paper decision is
  // kept (not discarded) so the review screen can explain an honest "no paper" rather than guess why.
  lap('roadmap_insert')
  const { days: dayPlans, paper } = await buildWeekPlanWithPaper(userId, ctx.week, { now, notBefore: reference })
  lap('week_plan')

  // Names for whatever the paper decision names by id, so the review screen can explain a skipped module
  // by name rather than a bare id — the same reason a student would want, not the id an engineer would.
  const skippedIds = paper.skipped.map(s => s.moduleId)
  const { data: moduleNameRows } = skippedIds.length
    ? await admin.from('learning_modules').select('id, name').in('id', skippedIds)
    : { data: [] as { id: string; name: string }[] }
  const moduleNames = new Map((moduleNameRows ?? []).map(m => [m.id as string, m.name as string]))
  const paperSummary = {
    kind: paper.kind,
    reason: paper.kind === 'none' ? paper.reason : null,
    purpose: paper.kind === 'paper' ? paper.purpose : null,
    skipped: paper.skipped.map(s => ({ ...s, name: moduleNames.get(s.moduleId) ?? s.moduleId })),
  }

  await opts.afterInputsRead?.()
  const { tasks, draftTasks } = toDraftTasks(dayPlans, ctx.timezone)

  const cycle: DraftCycle = {
    start: cycleStartDate, end: cycleEndDate, timezone: ctx.timezone, closingDay: ctx.anchorDay, classLed: ctx.classLed,
    initialCycle: ctx.initialCycle ? { advanced: ctx.initialCycle.advanced, reason: ctx.initialCycle.reason, note: initialCycleNote(ctx.initialCycle) } : null,
    // Only said about a day this plan could have used: inside its week and open to study on this route.
    reviewNote: ctx.week.days.includes(ctx.today) && permitsStudyPortions(input.route, weekdayOf(ctx.today)) ? await reviewNoteFor(userId, ctx.today, ctx.timezone, now, reference) : null, reference: reference.toISOString(),
  }

  // 7. Store preview in plan_drafts
  const { data: draft, error } = await admin.from('plan_drafts').insert({
    user_id: userId,
    purpose: 'onboarding_initial_week',
    status: 'ready',
    revision: 1,
    roadmap_id: tempRoadmap.id,
    cycle_start_date: cycleStartDate,
    cycle_end_date: cycleEndDate,
    timezone: ctx.timezone,
    // What this draft was built from: the same setup version and week always
    // resolve to the same draft, which is what makes recovery idempotent.
    onboarding_context_version: contextVersion,
    context_fingerprint: draftFingerprint(contextVersion, cycleStartDate, ctx.today),
    draft_json: {
      tasks: draftTasks,
      paper: paperSummary,
      cycle,
    }
  }).select().single()

  if (error) {
    // Don't leave the draft roadmap created above orphaned when the draft itself is rejected.
    await admin.from('study_roadmaps').update({ status: 'superseded' }).eq('id', tempRoadmap.id).eq('status', 'draft')
    throw Object.assign(new Error(`Draft generation failed: ${error.message}`), { code: (error as any).code as string | undefined })
  }

  lap('draft_insert')
  trace('onboarding', 'preview_built', { ms: laps, tasks: tasks.length })
  // An edit that landed while this was generated makes the draft stale at birth: retire it now rather than offer it.
  if (await contextVersionOf(userId) !== contextVersion) {
    await admin.from('plan_drafts').update({ status: 'superseded' }).eq('id', draft.id).eq('status', 'ready')
    await admin.from('study_roadmaps').update({ status: 'superseded' }).eq('id', tempRoadmap.id).eq('status', 'draft')
    throw Object.assign(new Error('Your setup changed while the preview was prepared.'), { code: 'CONTEXT_CHANGED' })
  }
    return { draftId: draft.id, tasks, revision: draft.revision, paper: paperSummary, cycle }
  })
}

import { createClient } from '../supabase/server'

/** A confirmation that did not go through, in the student's words, and whether the database has ruled on it. */
const refusal = (code: 'STALE_PREVIEW' | 'ALREADY_ACCEPTED' | 'ACCEPT_REJECTED' | 'UNCONFIRMED', message: string) => Object.assign(new Error(message), { code })
/** Acceptance is one transaction, so a refused confirmation saved nothing. */
const stale = (what: string, next = 'to continue') => refusal('STALE_PREVIEW', `${what} Nothing was saved and your answers are kept. Rebuild the preview ${next}.`)
const ALREADY = 'Your first week is already accepted, so nothing was added. Open Calendar to see it.'
const unconfirmed = () => refusal('UNCONFIRMED', 'We could not confirm whether your plan was saved. Press Accept again: if it already saved, you will not get a second copy.')

/** What the acceptance command's error means. Only an answer from the database is a ruling; anything else leaves the outcome unknown. */
export function classifyAcceptError(error: { message?: string; code?: string }): 'already' | 'no_fit' | 'setup_changed' | 'not_ready' | 'rejected' | 'unconfirmed' {
  const m = error.message ?? ''
  if (m.includes('ALREADY_ACCEPTED')) return 'already'
  if (m.includes('STALE_PREVIEW')) return m.includes('no longer fit') ? 'no_fit' : 'setup_changed'
  if (/Stale revision|Draft is not ready|Draft not found/.test(m)) return 'not_ready'
  // SQLSTATE classes that are a decision about this request (raised, bad data, constraint, definition). Serialisation, timeouts and transport are not.
  return /^(P0|22|23|42)/.test(error.code ?? '') ? 'rejected' : 'unconfirmed'
}

export async function confirmPreview(userId: string, draftId: string, expectedRevision: number) {
  const supabase = await createClient()
  // Anything that fails before the command is sent is "not confirmed": this attempt saved nothing, but an earlier one may have.
  const checks = await (async () => {
    const [draft, profile] = await Promise.all([
      supabase.from('plan_drafts').select('status,onboarding_context_version,cycle_start_date,cycle_end_date').eq('id', draftId).eq('user_id', userId).maybeSingle().throwOnError(),
      supabase.from('profiles').select('onboarding_context_version,onboarding_status').eq('id', userId).maybeSingle().throwOnError(),
    ])
    return { draft: draft.data, profile: profile.data, week: draft.data?.status === 'ready' ? await getStudyWeekContext(userId) : null }
  })().catch(e => { console.error('Confirmation checks could not be read:', e); throw unconfirmed() })
  const { draft, profile, week } = checks
  if (draft?.status === 'ready' && week) {
    if (draft.onboarding_context_version !== (profile?.onboarding_context_version ?? 1)) throw stale('Your setup changed after this preview was prepared.')
    // The week a preview names is part of what the student agreed to. It must still be this cycle or the next one on today's class boundary, and not
    // over. Whether its sittings still fit is the database's decision, on its own clock.
    const base = week.initialCycle?.fromWeek ?? week.week
    const open = [base, shiftStudyWeek(base, 1)].some(w => w.startDate === draft.cycle_start_date && w.endDate === draft.cycle_end_date)
    if (!open || String(draft.cycle_end_date) < week.today) throw stale('This plan was prepared for a week that no longer applies: it has passed, or your classes or windows changed.', 'to see the current week')
  }
  const { data, error } = await supabase.rpc('accept_onboarding_preview', {
    p_draft_id: draftId,
    p_expected_revision: expectedRevision
  })

  if (error) {
    const kind = classifyAcceptError(error)
    if (kind === 'unconfirmed') { console.error('Confirmation outcome unknown:', error); throw unconfirmed() }
    if (kind === 'already' || (kind === 'not_ready' && profile?.onboarding_status === 'complete')) throw refusal('ALREADY_ACCEPTED', ALREADY)
    if (kind === 'no_fit') throw stale('Your study time has passed or changed since this plan was prepared, so it no longer fits your study windows.', 'to plan the time that is left')
    if (kind === 'setup_changed') throw stale('Your setup changed after this preview was prepared.')
    if (kind === 'not_ready') throw stale('This preview has been replaced by a newer one.', 'to see the current plan')
    console.error('Confirmation rejected:', error)
    throw refusal('ACCEPT_REJECTED', 'We could not start your plan. Nothing was saved and your answers are kept. Rebuild the preview and try again.')
  }
  return data as { roadmap_id: string | null; cycle_id: string }
}
