import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { confirmClassLog } from '../../../../lib/planning/classlog/service'
import { parseLogInput } from '../../../../lib/planning/classlog/parse'

export const dynamic = 'force-dynamic'

/**
 * Explicit confirmation, POST only. Body: the log plus { idempotencyKey, fingerprint }.
 * The plan is recomputed on the server; the client never sends task rows.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null) as any
  const input = parseLogInput(body)
  if (!input || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 80
    || typeof body.fingerprint !== 'string') {
    return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  }
  const requestId = crypto.randomUUID()
  try {
    const result = await confirmClassLog(supabase, user.id, { ...input, idempotencyKey: body.idempotencyKey, fingerprint: body.fingerprint })
    if (result.ok) return NextResponse.json({ ...result, requestId, nextUrl: '/app/calendar' })
    const status = result.code === 'failed' ? 500 : result.code === 'invalid' ? 400 : 409
    return NextResponse.json({ ...result, requestId }, { status })
  } catch (error) {
    console.error(`[class-log/confirm ${requestId}]`, error)
    return NextResponse.json({ ok: false, code: 'failed', message: 'Could not save the class log. Nothing was changed.', requestId }, { status: 500 })
  }
}
