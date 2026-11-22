import { createAdminClient } from '../supabase/admin'
import {
  ExamSetupSchema, PreparationSetupSchema, PositionSetupSchema, WeekSetupSchema,
} from './schema'
import { STEPS, type Step } from './steps'
import type { OnboardingState } from './state'
import { bookedDateProblem, isSelectableSitting } from './examWindows'
import { todayInZone } from '../planning/studyWeek'

/** Throws on a failed Supabase write — a swallowed error means a step that reports success but saved nothing. */
function must(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
}

/** A problem the student can fix, reported against a field. Distinct from a server fault. */
/** The setup changed (another tab or device) after this editor read it. Nothing was written. */
export class SetupStaleError extends Error {
  constructor(public currentVersion: number) { super('Your setup changed elsewhere since you opened this editor. Nothing was saved; your edits are kept here.') }
}
/** A completed student's planning edit arrived without a valid setup version. Nothing was written. */
export class SetupVersionRequiredError extends Error {
  constructor(public provided: boolean) { super(provided ? 'This save carried an invalid setup version, so it was not applied. Reload the editor and save again.' : 'This save did not say which version of your setup it was based on, so it was not applied. Reload the editor and save again.') }
}
export class SetupError extends Error {
  constructor(message: string, public field: string) { super(message) }
}

/**
 * One completion model, derived only from what is saved. It used to mix inferred steps with a separate
 * onboarding_step counter that could disagree with the data.
 */
export async function readCanonicalState(userId: string): Promise<OnboardingState> {
  const admin = createAdminClient()

  const [profileRes, classesRes, windowsRes, exposureRes, uncertaintyRes, claimsRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('calendar_commitments').select('*').eq('user_id', userId).eq('status', 'active'),
    admin.from('availability_windows').select('*').eq('user_id', userId).eq('status', 'active'),
    admin.from('user_topic_exposure').select('*').eq('user_id', userId),
    admin.from('user_entry_uncertainty').select('topic_id, level, lm_ids').eq('user_id', userId),
    admin.from('user_module_state').select('lm_id, coverage_state').eq('user_id', userId).eq('source', 'self_report').in('coverage_state', ['taught', 'studied']),
  ])
  must(profileRes, 'read profile')
  must(classesRes, 'read commitments')
  must(windowsRes, 'read availability')
  must(exposureRes, 'read exposure')
  must(uncertaintyRes, 'read uncertainty')
  must(claimsRes, 'read coverage claims')
  const profile = profileRes.data
  const windows = windowsRes.data ?? []
  const classes = (classesRes.data ?? []).filter(c => c.kind === 'class')

  const completed = {
    exam: !!(profile?.timezone && profile?.exam_window_id && (!profile?.registered || profile?.exam_date)),
    route: !!(profile?.prep_mode && profile?.class_pattern),
    position: !!profile?.stage,
    // A week is complete once the student has answered: either with study windows, or by saying they
    // cannot give them yet. The second is honest, and produces a setup attention item, not a made-up plan.
    week: profile?.max_session_minutes != null && (windows.length > 0 || !!profile?.week_availability_mode && profile.week_availability_mode !== 'windows'),
  }

  const firstIncompleteStep: Step =
    !completed.exam ? 'exam' :
    !completed.route ? 'route' :
    !completed.position ? 'position' :
    !completed.week ? 'week' :
    'plan'

  return {
    profile,
    commitments: classesRes.data ?? [],
    availability: windows,
    coverage: exposureRes.data ?? [],
    entry: {
      uncertainty: (uncertaintyRes.data ?? []).map(r => ({ topic_id: r.topic_id as string, level: r.level as string, lm_ids: (r.lm_ids ?? []) as string[] })),
      readingClaims: (claimsRes.data ?? []).map(r => ({ lm_id: r.lm_id as string, state: r.coverage_state === 'taught' ? 'partly' : 'covered' })),
      mock: profile?.mock_date && profile?.mock_kind ? { date: String(profile.mock_date), kind: String(profile.mock_kind), label: (profile.mock_label ?? null) as string | null, startTime: profile.mock_start_time ? String(profile.mock_start_time).slice(0, 5) : null, durationMinutes: (profile.mock_duration_minutes ?? null) as number | null } : null,
    },
    completed,
    firstIncompleteStep,
    hasClasses: classes.length > 0,
  }
}

/**
 * Every setup save goes through here: the change and the setup-version increment are one database transaction (see
 * onboarding_commit_step), so a failure leaves both the setup and its version exactly as they were, and a preview can never be
 * labelled with a version that its inputs do not belong to.
 */
async function commitStep(userId: string, step: 'exam' | 'route' | 'position' | 'week', args: Record<string, unknown>, what: string, expectedVersion?: unknown, receipt?: { version?: number }): Promise<number> {
  // A completed student's edit carries the setup version its editor read: compared and incremented in ONE transaction under the profile lock
  // (onboarding_commit_step_checked). A first-time setup passes none and keeps the original command.
  const valid = typeof expectedVersion === 'number' && Number.isInteger(expectedVersion) && expectedVersion >= 1
  // Server-side rule, for every caller: once setup is COMPLETE, a planning edit must name the version it read. Missing or malformed is refused here (nothing written);
  // first-time onboarding is not an edit of an accepted plan and passes none. Cosmetic name edits never come through this function.
  if (!valid) {
    const st = await createAdminClient().from('profiles').select('onboarding_status').eq('id', userId).maybeSingle(); must(st, 'read setup status')
    if (st.data?.onboarding_status === 'complete') throw new SetupVersionRequiredError(expectedVersion !== undefined && expectedVersion !== null)
  }
  if (valid) {
    const res = await createAdminClient().rpc('onboarding_commit_step_checked', { p_user: userId, p_step: step, p_args: args, p_expected: expectedVersion as number })
    must(res, what)
    const r = res.data as { ok: boolean; version?: number; currentVersion?: number }
    if (!r.ok) throw new SetupStaleError(Number(r.currentVersion))
    if (receipt) receipt.version = Number(r.version)
    return Number(r.version)
  }
  const res = await createAdminClient().rpc('onboarding_commit_step', { p_user: userId, p_step: step, p_args: args })
  must(res, what)
  if (receipt) receipt.version = res.data as number
  return res.data as number
}

async function markInProgress(userId: string) {
  const admin = createAdminClient()
  await admin.from('profiles').update({ onboarding_status: 'in_progress' }).eq('id', userId).eq('onboarding_status', 'not_started')
}

export async function saveExam(userId: string, payload: unknown, expectedVersion?: unknown, receipt?: { version?: number }) {
  const data = ExamSetupSchema.parse(payload)
  const admin = createAdminClient()

  // The window must be one the active curriculum supports, and an exact date must fall in that sitting.
  const [{ data: window }, { data: manifest }] = await Promise.all([
    admin.from('exam_windows').select('id, year, sitting, window_opens, window_closes').eq('id', data.examWindowId).maybeSingle(),
    admin.from('curriculum_manifests').select('year').eq('is_active', true).limit(1).maybeSingle(),
  ])
  if (!window) throw new SetupError('That exam sitting does not exist.', 'examWindowId')
  if (manifest && window.year !== manifest.year) {
    throw new SetupError(`PrepPlan currently supports the ${manifest.year} exam only.`, 'examWindowId')
  }
  if (!isSelectableSitting(window, new Date().toISOString())) throw new SetupError('That sitting has already finished. Choose a later one.', 'examWindowId')
  if (data.registered && data.examDate) {
    const problem = bookedDateProblem(window, data.examDate, todayInZone(data.timezone))
    if (problem) throw new SetupError(problem, 'examDate')
  }

  // exam_date is written unconditionally: switching to "not registered" must clear the old date. The write and the setup-version
  // increment are one transaction (onboarding_commit_step), so no reader can see new inputs under the old version.
  await commitStep(userId, 'exam', {
    timezone: data.timezone, registered: data.registered, exam_window_id: data.examWindowId, exam_sitting: window.sitting, exam_year: window.year, exam_date: data.examDate ?? '',
  }, 'write profiles', expectedVersion, receipt)
  await markInProgress(userId)
}

export async function saveRoute(userId: string, payload: unknown, expectedVersion?: unknown, receipt?: { version?: number }) {
  const data = PreparationSetupSchema.parse(payload)
  const admin = createAdminClient()

  const nextClass = data.nextClass
  let next: Record<string, string> | null = null
  if (nextClass) {
    const { data: p } = await admin.from('profiles').select('timezone').eq('id', userId).maybeSingle()
    const { zonedTimeToUtc } = await import('../planning/studyWeek')
    const tz = (p?.timezone as string) || 'UTC'
    next = {
      label: nextClass.label,
      starts_at: zonedTimeToUtc(nextClass.date, nextClass.startTime, tz).toISOString(),
      ends_at: zonedTimeToUtc(nextClass.date, nextClass.endTime, tz).toISOString(),
    }
  }

  await commitStep(userId, 'route', {
    prep_mode: data.prepMode, class_pattern: data.classPattern,
    classes: data.recurringClasses.map(c => ({ label: c.label, weekdays: c.weekdays, start_time: c.startTime, end_time: c.endTime, ends_on: c.endsOn ?? '' })),
    next_class: next,
  }, 'save route', expectedVersion, receipt)
  await markInProgress(userId)
}

/**
 * A mock is a checkpoint, not a second exam date: it must still be ahead, and before the exam we are planning against.
 * A close mock or exam never blocks anything; only a date that cannot be right is refused. Shared by onboarding,
 * Settings and the Calendar checkpoint editor, so one rule applies to the one checkpoint.
 */
export async function assertMockDateAllowed(userId: string, date: string) {
  const admin = createAdminClient()
  const { data: p } = await admin.from('profiles').select('timezone, registered, exam_date, exam_window_id').eq('id', userId).maybeSingle()
  const { todayInZone } = await import('../planning/studyWeek')
  if (date < todayInZone((p?.timezone as string) || 'UTC')) throw new SetupError('That date has already passed. Choose a date ahead, or leave the mock empty.', 'mock')
  let target = p?.registered ? (p?.exam_date as string | null) : null
  if (!target && p?.exam_window_id) {
    const { data: w } = await admin.from('exam_windows').select('window_opens').eq('id', p.exam_window_id as string).maybeSingle()
    target = (w?.window_opens ?? null) as string | null
  }
  if (target && date >= target) throw new SetupError(`That date is on or after your exam target (${target}). Choose an earlier date, or leave the mock empty.`, 'mock')
}

export async function savePosition(userId: string, payload: unknown, expectedVersion?: unknown, receipt?: { version?: number }) {
  const data = PositionSetupSchema.parse(payload)
  const admin = createAdminClient()

  const readingIds = Object.keys(data.readingStates ?? {})
  const uncertaintyEntries = Object.entries(data.uncertainty ?? {})
  const ids = [...new Set([...Object.keys(data.topicExposure), ...uncertaintyEntries.map(([topic]) => topic)])]
  if (ids.length) {
    const { data: known } = await admin.from('topics').select('id').in('id', ids)
    const bad = ids.find(id => !(known ?? []).some(k => k.id === id))
    if (bad) throw new SetupError(`Unknown topic: ${bad}`, 'topicExposure')
  }
  // Every named reading must exist, and a reading named under a topic's uncertainty must belong to that topic.
  const named = [...new Set([...readingIds, ...uncertaintyEntries.flatMap(([, u]) => u.lmIds)])]
  if (named.length) {
    const { data: mods } = await admin.from('learning_modules').select('id, topic_id').in('id', named)
    const topicOf = new Map((mods ?? []).map(m => [m.id as string, m.topic_id as string]))
    const missing = named.find(id => !topicOf.has(id))
    if (missing) throw new SetupError(`Unknown reading: ${missing}`, 'uncertainty')
    for (const [topic, u] of uncertaintyEntries) {
      const stray = u.lmIds.find(id => topicOf.get(id) !== topic)
      if (stray) throw new SetupError('A reading you picked does not belong to that topic.', 'uncertainty')
    }
  }

  if (data.mock) await assertMockDateAllowed(userId, data.mock.date)

  const timing: Record<string, unknown> = {}
  if (data.mock) {
    if (data.mock.label !== undefined) timing.mock_label = data.mock.label || ''
    if (data.mock.startTime !== undefined) timing.mock_start_time = data.mock.startTime ?? ''
    if (data.mock.durationMinutes !== undefined) timing.mock_duration_minutes = data.mock.durationMinutes ?? ''
  }
  try {
  await commitStep(userId, 'position', {
    stage: data.stage,
    exposure: Object.entries(data.topicExposure).map(([topic_id, recency]) => ({ topic_id, recency })),
    readings: data.readingStates ? Object.entries(data.readingStates).map(([lm_id, state]) => ({ lm_id, state })) : null,
    uncertainty: data.uncertainty ? uncertaintyEntries.map(([topic_id, u]) => ({ topic_id, level: u.level, lm_ids: u.lmIds })) : null,
    mock_set: data.mock !== undefined, mock: data.mock ? { date: data.mock.date, kind: data.mock.kind } : null,
    mock_timing: Object.keys(timing).length ? timing : null,
  }, 'save position', expectedVersion, receipt)
  } catch (e: any) {
    // A started rehearsal keeps its restrictions on this path too: nothing was saved, and the student is told why.
    if (/REHEARSAL_STARTED/.test(e?.message ?? '')) throw new SetupError('Your PrepPlan rehearsal has started, so it cannot be removed here. Finish it, or manage it in Calendar.', 'mock')
    throw e
  }
  await markInProgress(userId)
}

export async function saveWeek(userId: string, payload: unknown, expectedVersion?: unknown, receipt?: { version?: number }) {
  const data = WeekSetupSchema.parse(payload)
  await commitStep(userId, 'week', {
    max_session: data.maxSessionMinutes, mode: data.availabilityMode,
    windows: data.windows.map(w => ({ weekday: w.weekday, start_time: w.startTime, end_time: w.endTime })),
    commitments: data.commitments.map(c => ({ label: c.label, kind: c.kind, weekdays: c.weekdays, start_time: c.startTime, end_time: c.endTime })),
  }, 'save week', expectedVersion, receipt)
  await markInProgress(userId)
}

/**
 * Derived, never chosen: the week-closing day, from the class schedule. Shown on the review screen.
 *
 * Delegates to getStudyWeekContext so this agrees with what the calendar actually uses, including a variable
 * pattern's one-off "next class" anchor — there used to be a second, partial copy of this logic here that only
 * knew about recurring classes, so the review screen could show a different closing day than Calendar would.
 */
export async function deriveWeekClosing(userId: string) {
  const { getStudyWeekContext } = await import('../planning/schedule')
  const ctx = await getStudyWeekContext(userId)
  return { hasClasses: ctx.classLed, closingDay: ctx.anchorDay }
}
