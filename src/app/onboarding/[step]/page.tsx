import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { isStep, STEPS, STEP_META, RETIRED_STEPS } from '../../../lib/onboarding/steps'
import { ROUTES, safeReturnTo } from '../../../lib/routing/registry'
import { readCanonicalState } from '../../../lib/onboarding/service'
import { OnboardingShell } from '../../../components/onboarding/OnboardingShell'
import { refRows } from '../../../lib/ops/refCache'
import { todayInZone } from '../../../lib/planning/studyWeek'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params
  return { title: isStep(step) ? STEP_META[step].nav : 'Set up PrepPlan' }
}

export default async function OnboardingStepPage({
  params, searchParams,
}: { params: Promise<{ step: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { step } = await params
  // A saved link to a retired screen keeps working.
  if (step in RETIRED_STEPS) permanentRedirect(`/onboarding/${RETIRED_STEPS[step]}`)
  if (!isStep(step)) notFound()
  const requestedReturn = safeReturnTo((await searchParams).returnTo)

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/onboarding/${step}`)

  const state = await readCanonicalState(user.id)
  
  // A completed student may re-open any screen: every answer stays editable
  // from Settings. Only an unfinished student is held to the ordered path.
  const isComplete = state.profile?.onboarding_status === 'complete'

  // Enforce ordered access: prevent skipping ahead of the first incomplete step
  const targetIndex = STEPS.indexOf(step)
  const firstIncompleteIndex = STEPS.indexOf(state.firstIncompleteStep)
  if (!isComplete && targetIndex > firstIncompleteIndex) {
    redirect(`/onboarding/${state.firstIncompleteStep}`)
  }

  // Back to Review is honoured for a student who has reached it (every step answered); everything else needs a finished setup.
  const returnTo = requestedReturn && (isComplete || (requestedReturn === ROUTES.onboarding.plan && state.firstIncompleteStep === 'plan')) ? requestedReturn : null

  const admin = createAdminClient()

  // Only sittings the active curriculum supports (currently 2027) are offered.
  const { data: manifest } = await admin.from('curriculum_manifests').select('year').eq('is_active', true).limit(1).maybeSingle()

  const needsCatalogue = step === 'position'
  const savedReadingIds = needsCatalogue ? (state.entry?.readingClaims ?? []).map(r => r.lm_id) : []
  const none = { data: null as null, error: null }
  const [{ data: windows }, { data: topics }, { data: modules }] = await Promise.all([
    admin.from('exam_windows')
      .select('id, year, sitting, window_opens, window_closes, is_confirmed')
      .eq('year', manifest?.year ?? 2027)
      .gt('window_closes', new Date().toISOString())
      .order('year').order('window_opens'),
    needsCatalogue ? refRows('onboarding.topics', () => admin.from('topics')
      .select('id, name, exam_weight_min, exam_weight_max, summary')
      .order('default_sequence')) : none,
    // Existing refinements need their topic until the optional lists are opened.
    savedReadingIds.length ? admin.from('learning_modules').select('id, topic_id, name').eq('is_active', true).in('id', savedReadingIds).throwOnError() : none,
  ])

  return (
    <OnboardingShell
      step={step}
      state={state}
      today={todayInZone(state.profile?.timezone ?? 'UTC')}
      returnTo={returnTo}
      windows={(windows ?? []).map(w => ({
        id: w.id as string, year: w.year as number, sitting: w.sitting as string,
        opens: (w.window_opens ?? null) as string | null, closes: (w.window_closes ?? null) as string | null, confirmed: Boolean(w.is_confirmed),
      }))}
      readings={(modules ?? []).map(m => ({ id: m.id as string, topicId: m.topic_id as string, name: m.name as string }))}
      topics={(topics ?? []).map(t => ({
        id: t.id as string, name: t.name as string,
        weightMin: Number(t.exam_weight_min), weightMax: Number(t.exam_weight_max),
        summary: (t.summary ?? '') as string,
      }))}
    />
  )
}
