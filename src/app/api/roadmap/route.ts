import { routeFailure } from '../../../lib/ops/routeFailure'
import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { computeProgress, generateRoadmap, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'

/**
 * The long-term roadmap.
 *
 * GET  returns the roadmap in force, with planned-versus-actual progress.
 * POST regenerates it — as a draft by default, or activated when the student
 *      has seen it and accepted.
 */
export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  try {
    const active = await getActiveRoadmap(user.id)
    if (!active) return NextResponse.json({ ok: true, roadmap: null })
    const progress = await computeProgress(user.id, active.roadmap)
    return NextResponse.json({ ok: true, id: active.id, status: active.status, roadmap: active.roadmap, progress })
  } catch (error) { return routeFailure('roadmap.load', 'Your roadmap could not be loaded. Try again.', error) }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const user = access.user

  const body = await req.json().catch(() => ({} as any))

  // The exam is changed in one place: the setup editor (atomic with the setup version, stale drafts refused). This route only rebuilds the roadmap.
  if (body.examWindowId !== undefined) {
    return NextResponse.json({ ok: false, code: 'USE_EXAM_EDITOR', error: 'Change your exam in the exam step of setup.', href: '/onboarding/exam' }, { status: 410 })
  }

  try {
    const result = await generateRoadmap(user.id, { activate: body.activate === true })
    if (!result) {
      return NextResponse.json(
        { ok: false, code: 'NO_TARGET', error: 'Choose which exam you are sitting before Roadmap can plan towards it.' },
        { status: 400 }
      )
    }
    const progress = await computeProgress(user.id, result.roadmap)
    return NextResponse.json({ ok: true, id: result.id, roadmap: result.roadmap, progress })
  } catch (error) {
    return routeFailure('roadmap.save', 'Could not confirm the roadmap update. Reload to see the current roadmap.', error)
  }
}
