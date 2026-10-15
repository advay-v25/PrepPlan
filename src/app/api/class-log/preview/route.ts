import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { previewClassLog } from '../../../../lib/planning/classlog/service'
import { parseLogInput } from '../../../../lib/planning/classlog/parse'

export const dynamic = 'force-dynamic'

/** POST only, and a pure read: shows what confirming would add. Writes nothing. */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const input = parseLogInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  const requestId = crypto.randomUUID()
  try {
    const preview = await previewClassLog(user.id, input)
    return NextResponse.json({ ...preview, requestId }, { status: preview.ok ? 200 : 409 })
  } catch (error) {
    console.error(`[class-log/preview ${requestId}]`, error)
    return NextResponse.json({ ok: false, error: 'Could not build the preview.', requestId }, { status: 500 })
  }
}
