import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { computeProgress, generateRoadmap, getActiveRoadmap } from '../../../lib/curriculum/roadmapService'

/**
 * The long-term roadmap.
 *
 * GET  returns the roadmap in force, with planned-versus-actual progress.
 * POST regenerates it — as a draft by default, or activated when the student
 *      has seen it and accepted.
 */
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const active = await getActiveRoadmap(user.id)
  if (!active) return NextResponse.json({ ok: true, roadmap: null })

  const progress = await computeProgress(user.id, active.roadmap)
  return NextResponse.json({ ok: true, id: active.id, status: active.status, roadmap: active.roadmap, progress })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))

  // Setting an exam target is part of generating a roadmap: there is nothing to
  // plan towards without one, and onboarding does not yet collect it.
  if (body.examWindowId) {
    const admin = createAdminClient()
    const { data: window } = await admin
      .from('exam_windows').select('id, year, sitting').eq('id', body.examWindowId).maybeSingle()
    if (!window) return NextResponse.json({ ok: false, error: 'Unknown exam window' }, { status: 400 })

    const { error } = await admin.from('profiles').update({
      exam_window_id: window.id,
      exam_year: window.year,
      exam_sitting: window.sitting,
      registered: body.registered === true,
    }).eq('id', user.id)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
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
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }
}
