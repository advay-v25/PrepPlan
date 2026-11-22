import { NextResponse } from 'next/server'
import { commandResponse, reviewerRoute } from '../../../../../../lib/diagnostic/reviewApi'

/**
 * A reviewer confirms (or corrects) the difficulty level of the EXACT item version they are looking at, with a short cognitive-demand
 * rationale. One database command (`confirm_item_difficulty`): reviewer role, current version, level and rationale are checked there.
 * The generator's proposed level is only a proposal; nothing here is an empirical calibration.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await reviewerRoute()
  if (!auth.ok) return auth.response
  const { id } = await params
  const body = await req.json().catch(() => ({} as any))
  const expectedVersion = Number(body.expectedVersion)
  if (!Number.isInteger(expectedVersion)) return NextResponse.json({ ok: false, error: 'expectedVersion is required' }, { status: 400 })
  const { data, error } = await auth.supabase.rpc('confirm_item_difficulty', {
    p_item_id: id, p_expected_version: expectedVersion, p_level: String(body.level ?? ''), p_rationale: typeof body.rationale === 'string' ? body.rationale.slice(0, 1000) : '',
  })
  return commandResponse(data, error)
}
