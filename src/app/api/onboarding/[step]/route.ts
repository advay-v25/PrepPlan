import { isAdmitted } from '../../../../lib/beta/admission'
import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { isStep } from '../../../../lib/onboarding/steps'
import {
  readCanonicalState,
  saveExam,
  saveRoute,
  savePosition,
  saveWeek,
  SetupError,
  SetupStaleError,
  SetupVersionRequiredError,
} from '../../../../lib/onboarding/service'
import { saveWithPlanImpact, type PlanImpact, type ImpactUnavailable } from '../../../../lib/onboarding/planImpact'
import { ZodError } from 'zod'

type OnboardingResponse<T = unknown> =
  | { ok: true; data?: T; committed?: boolean; followUpUnavailable?: boolean; next?: string; impact?: PlanImpact | ImpactUnavailable | null; version?: number | null }
  | { ok: false; code: string; message: string; fields?: Record<string, string> }

function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, code, message, fields } satisfies OnboardingResponse, { status })
}

export async function GET(req: Request, { params }: { params: Promise<{ step: string }> }) {
  const { step } = await params
  if (step !== 'position') return errorResponse(404, 'not_found', 'No lookup is available for this step.')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'unauthorized', 'Sign in to open your setup.')
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return errorResponse(403, 'not_admitted', 'PrepPlan needs a verified and invited account.')
  const topic = new URL(req.url).searchParams.get('topic')
  if (!topic || !/^[a-z][a-z0-9_-]{0,39}$/.test(topic)) return errorResponse(400, 'invalid_input', 'Choose a topic.')
  try {
    const { data } = await createAdminClient().from('learning_modules').select('id, topic_id, name')
      .eq('is_active', true).eq('topic_id', topic).order('sequence_hint').order('id').throwOnError()
    return NextResponse.json({ ok: true, readings: (data ?? []).map(r => ({ id: r.id, topicId: r.topic_id, name: r.name })) })
  } catch {
    return errorResponse(503, 'lookup_unavailable', 'Readings could not be loaded. Try again.')
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ step: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'unauthorized', 'Unauthorized')
  if (!user.email_confirmed_at || !(await isAdmitted(user.id))) return errorResponse(403, 'not_admitted', 'PrepPlan needs an invitation and this account has none.')

  const { step } = await params
  if (!isStep(step)) return errorResponse(404, 'not_found', `Unknown step "${step}"`)

  // Plan logic is split out to /api/onboarding/plan endpoints
  if (step === 'plan') {
    return errorResponse(400, 'invalid_endpoint', 'Plan completion happens at /api/onboarding/plan/confirm')
  }

  const raw = await req.json().catch(() => ({})) as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return errorResponse(400, 'invalid_input', 'Send your setup answers as a JSON object.')
  // A completed student's editor sends the setup version it read; it is not part of the saved payload.
  const { expectedVersion, ...body } = raw
  const expected = expectedVersion   // validated at the authoritative boundary (commitStep): required and integer for a completed student, whatever the caller
  const receipt: { version?: number } = {}

  try {
    // A completed student's save is wrapped so its effect on the days ahead can be reported — never to
    // change what gets saved. saveWithPlanImpact returns null for a student still completing onboarding for
    // the first time, since there is nothing committed yet to have an impact on.
    const impact = await saveWithPlanImpact(user.id, async () => {
      switch (step) {
        case 'exam': return saveExam(user.id, body, expected, receipt)
        case 'route': return saveRoute(user.id, body, expected, receipt)
        case 'position': return savePosition(user.id, body, expected, receipt)
        case 'week': return saveWeek(user.id, body, expected, receipt)
      }
    }, receipt)

    // The save has COMMITTED. A failed read of "what is next" is "saved, follow-up unavailable", never a failed save (a blind retry would be refused as stale).
    let next: string | undefined
    try { next = (await readCanonicalState(user.id)).firstIncompleteStep } catch (e) { console.error('[setup] next-step read after commit failed', (e as Error).message) }
    // `version` is the setup version THIS command committed; the impact was computed around it. A later edit gets its own version.
    return NextResponse.json({ ok: true, next, impact, version: receipt.version ?? null, ...(next === undefined ? { followUpUnavailable: true } : {}) } satisfies OnboardingResponse)

  } catch (error: any) {
    // Committed before the failure (the receipt is only set by a returned commit): report the authoritative version, never a generic failure.
    if (receipt.version !== undefined) return NextResponse.json({ ok: true, committed: true, version: receipt.version, impact: { unavailable: true }, followUpUnavailable: true, next: undefined } satisfies OnboardingResponse)
    if (error instanceof SetupVersionRequiredError) return errorResponse(400, error.provided ? 'version_invalid' : 'version_required', error.message)
    if (error instanceof SetupStaleError) return NextResponse.json({ ok: false, code: 'setup_changed', message: error.message, currentVersion: error.currentVersion }, { status: 409 })
    if (error instanceof SetupError) {
      return errorResponse(400, 'validation_error', error.message, { [error.field]: error.message })
    }
    if (error instanceof ZodError) {
      const fields: Record<string, string> = {}
      for (const issue of error.issues) {
        fields[issue.path.join('.')] = issue.message
      }
      return errorResponse(400, 'validation_error', error.issues[0]?.message ?? 'Invalid input data', fields)
    }
    console.error(`Onboarding save error [${step}]:`, error)
    return errorResponse(500, 'internal_error', error.message || 'An unexpected error occurred')
  }
}
