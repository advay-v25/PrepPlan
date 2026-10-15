import { createAdminClient } from '../supabase/admin'
import {
  ExamSetupSchema, PreparationSetupSchema, PositionSetupSchema, WeekSetupSchema,
} from './schema'
import { STEPS, type Step } from './steps'
import type { OnboardingState } from './state'

/** Throws on a failed Supabase write — a swallowed error means a step that reports success but saved nothing. */
function must(res: { error: { message: string } | null }, what: string) {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
}

/** A problem the student can fix, reported against a field. Distinct from a server fault. */
export class SetupError extends Error {
  constructor(message: string, public field: string) { super(message) }
}

/**
 * One completion model, derived only from what is saved. It used to mix inferred steps with a separate
 * onboarding_step counter that could disagree with the data.
 */
export async function readCanonicalState(userId: string): Promise<OnboardingState> {
  const admin = createAdminClient()

  const [profileRes, classesRes, windowsRes, exposureRes] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('calendar_commitments').select('*').eq('user_id', userId).eq('status', 'active'),
    admin.from('availability_windows').select('*').eq('user_id', userId).eq('status', 'active'),
    admin.from('user_topic_exposure').select('*').eq('user_id', userId),
  ])
  must(profileRes, 'read profile')
  must(classesRes, 'read commitments')
  must(windowsRes, 'read availability')
  must(exposureRes, 'read exposure')
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
    completed,
    firstIncompleteStep,
    hasClasses: classes.length > 0,
  }
}

export async function bumpContextVersion(userId: string) {
  const admin = createAdminClient()
  const { error } = await admin.rpc('increment_onboarding_context_version', { p_user_id: userId })
  if (error) {
    const { data } = await admin.from('profiles').select('onboarding_context_version').eq('id', userId).single()
    if (data) {
      await admin.from('profiles').update({ onboarding_context_version: (data.onboarding_context_version || 1) + 1 }).eq('id', userId)
    }
  }
  // Bumping the version is what invalidates an unused preview: drafts are keyed by it (draftService).
}

async function markInProgress(userId: string) {
  const admin = createAdminClient()
  await admin.from('profiles').update({ onboarding_status: 'in_progress' }).eq('id', userId).eq('onboarding_status', 'not_started')
}

export async function saveExam(userId: string, payload: unknown) {
  const data = ExamSetupSchema.parse(payload)
  const admin = createAdminClient()

  // The window must be one the active curriculum supports, and an exact date must fall in that sitting.
  const [{ data: window }, { data: manifest }] = await Promise.all([
    admin.from('exam_windows').select('id, year, sitting, window_opens').eq('id', data.examWindowId).maybeSingle(),
    admin.from('curriculum_manifests').select('year').eq('is_active', true).limit(1).maybeSingle(),
  ])
  if (!window) throw new SetupError('That exam sitting does not exist.', 'examWindowId')
  if (manifest && window.year !== manifest.year) {
    throw new SetupError(`Roadmap currently supports the ${manifest.year} exam only.`, 'examWindowId')
  }
  if (data.registered && data.examDate && window.window_opens) {
    if (data.examDate.slice(0, 7) !== String(window.window_opens).slice(0, 7)) {
      throw new SetupError(`That date is not in the ${window.sitting[0].toUpperCase()}${window.sitting.slice(1)} ${window.year} sitting you chose.`, 'examDate')
    }
  }

  // exam_date is written unconditionally: switching to "not registered" must clear the old date.
  must(await admin.from('profiles').update({
    timezone: data.timezone,
    registered: data.registered,
    exam_window_id: data.examWindowId,
    exam_sitting: window.sitting,
    exam_year: window.year,
    exam_date: data.examDate,
  }).eq('id', userId), 'write profiles')
  await markInProgress(userId)
  await bumpContextVersion(userId)
}

export async function saveRoute(userId: string, payload: unknown) {
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

  must(await admin.rpc('onboarding_replace_route', {
    p_user: userId,
    p_prep_mode: data.prepMode,
    p_class_pattern: data.classPattern,
    p_classes: data.recurringClasses.map(c => ({
      label: c.label, weekdays: c.weekdays, start_time: c.startTime, end_time: c.endTime, ends_on: c.endsOn ?? '',
    })),
    p_next_class: next,
  }), 'save route')
  await syncDerivedWeek(userId)
  await markInProgress(userId)
  await bumpContextVersion(userId)
}

export async function savePosition(userId: string, payload: unknown) {
  const data = PositionSetupSchema.parse(payload)
  const admin = createAdminClient()

  const ids = Object.keys(data.topicExposure)
  if (ids.length) {
    const { data: known } = await admin.from('topics').select('id').in('id', ids)
    const bad = ids.find(id => !(known ?? []).some(k => k.id === id))
    if (bad) throw new SetupError(`Unknown topic: ${bad}`, 'topicExposure')
  }

  must(await admin.rpc('onboarding_replace_position', {
    p_user: userId,
    p_stage: data.stage,
    p_exposure: Object.entries(data.topicExposure).map(([topic_id, recency]) => ({ topic_id, recency })),
  }), 'save position')
  await markInProgress(userId)
  await bumpContextVersion(userId)
}

export async function saveWeek(userId: string, payload: unknown) {
  const data = WeekSetupSchema.parse(payload)
  const admin = createAdminClient()

  must(await admin.rpc('onboarding_replace_week', {
    p_user: userId,
    p_max_session: data.maxSessionMinutes,
    p_mode: data.availabilityMode,
    p_windows: data.windows.map(w => ({ weekday: w.weekday, start_time: w.startTime, end_time: w.endTime })),
    p_commitments: data.commitments.map(c => ({
      label: c.label, kind: c.kind, weekdays: c.weekdays, start_time: c.startTime, end_time: c.endTime,
    })),
  }), 'save week')
  await markInProgress(userId)
  await bumpContextVersion(userId)
}

/**
 * profiles.diagnostic_day is a snapshot of the derived closing day, kept so readers that predate the
 * derivation still agree with it. It is recomputed whenever the class schedule changes.
 */
export async function syncDerivedWeek(userId: string) {
  const { closingDay } = await deriveWeekClosing(userId)
  must(await createAdminClient().from('profiles').update({ diagnostic_day: closingDay }).eq('id', userId), 'write profiles')
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
