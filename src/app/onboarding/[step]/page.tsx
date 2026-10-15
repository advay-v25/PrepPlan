import { notFound, permanentRedirect, redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { isStep, STEPS, RETIRED_STEPS } from '../../../lib/onboarding/steps'
import { safeReturnTo } from '../../../lib/routing/registry'
import { readCanonicalState } from '../../../lib/onboarding/service'
import { OnboardingShell } from '../../../components/onboarding/OnboardingShell'

export const dynamic = 'force-dynamic'

export default async function OnboardingStepPage({
  params, searchParams,
}: { params: Promise<{ step: string }>; searchParams: Promise<{ returnTo?: string }> }) {
  const { step } = await params
  // A saved link to a retired screen keeps working.
  if (step in RETIRED_STEPS) permanentRedirect(`/onboarding/${RETIRED_STEPS[step]}`)
  if (!isStep(step)) notFound()
  const returnTo = safeReturnTo((await searchParams).returnTo)

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

  const admin = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)

  // Only sittings the active curriculum supports (currently 2027) are offered.
  const { data: manifest } = await admin.from('curriculum_manifests').select('year').eq('is_active', true).limit(1).maybeSingle()

  const [{ data: windows }, { data: topics }] = await Promise.all([
    admin.from('exam_windows')
      .select('id, year, sitting, window_opens, is_confirmed')
      .eq('year', manifest?.year ?? 2027)
      .gt('window_opens', today)
      .order('year').order('window_opens'),
    admin.from('topics')
      .select('id, name, exam_weight_min, exam_weight_max, summary')
      .order('default_sequence'),
  ])

  return (
    <OnboardingShell
      step={step}
      state={state}
      returnTo={isComplete ? returnTo : null}
      windows={(windows ?? []).map(w => ({
        id: w.id as string, year: w.year as number, sitting: w.sitting as string,
        opens: (w.window_opens ?? null) as string | null, confirmed: Boolean(w.is_confirmed),
      }))}
      topics={(topics ?? []).map(t => ({
        id: t.id as string, name: t.name as string,
        weightMin: Number(t.exam_weight_min), weightMax: Number(t.exam_weight_max),
        summary: (t.summary ?? '') as string,
      }))}
    />
  )
}
