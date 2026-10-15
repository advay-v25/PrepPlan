import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { isStep } from '../../../../lib/onboarding/steps'
import {
  readCanonicalState,
  saveExam,
  saveRoute,
  savePosition,
  saveWeek,
  SetupError,
} from '../../../../lib/onboarding/service'
import { saveWithPlanImpact, type PlanImpact } from '../../../../lib/onboarding/planImpact'
import { ZodError } from 'zod'

type OnboardingResponse<T = unknown> =
  | { ok: true; data?: T; next?: string; impact?: PlanImpact | null }
  | { ok: false; code: string; message: string; fields?: Record<string, string> }

function errorResponse(status: number, code: string, message: string, fields?: Record<string, string>) {
  return NextResponse.json({ ok: false, code, message, fields } satisfies OnboardingResponse, { status })
}

export async function POST(req: Request, { params }: { params: Promise<{ step: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse(401, 'unauthorized', 'Unauthorized')

  const { step } = await params
  if (!isStep(step)) return errorResponse(404, 'not_found', `Unknown step "${step}"`)

  // Plan logic is split out to /api/onboarding/plan endpoints
  if (step === 'plan') {
    return errorResponse(400, 'invalid_endpoint', 'Plan completion happens at /api/onboarding/plan/confirm')
  }

  const body = await req.json().catch(() => ({}))

  try {
    // A completed student's save is wrapped so its effect on the days ahead can be reported — never to
    // change what gets saved. saveWithPlanImpact returns null for a student still completing onboarding for
    // the first time, since there is nothing committed yet to have an impact on.
    const impact = await saveWithPlanImpact(user.id, async () => {
      switch (step) {
        case 'exam': return saveExam(user.id, body)
        case 'route': return saveRoute(user.id, body)
        case 'position': return savePosition(user.id, body)
        case 'week': return saveWeek(user.id, body)
      }
    })

    // Resolve what the next step should be (the first incomplete step)
    const { firstIncompleteStep } = await readCanonicalState(user.id)
    return NextResponse.json({ ok: true, next: firstIncompleteStep, impact } satisfies OnboardingResponse)

  } catch (error: any) {
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
