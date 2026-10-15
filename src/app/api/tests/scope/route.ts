import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { getPaperPreview, type PaperKind } from '../../../../lib/tests/paperPreview'

export const dynamic = 'force-dynamic'

/** Read-only: the canonical completed scope and the weighted paper it would produce. Creates nothing. */
export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const kind = new URL(request.url).searchParams.get('paper')
  const requested = kind === 'diagnostic' || kind === 'revisionary' || kind === 'mixed' ? (kind as PaperKind) : undefined
  try {
    return NextResponse.json({ ok: true, preview: await getPaperPreview(user.id, requested) })
  } catch (error) {
    const requestId = crypto.randomUUID()
    console.error(`[tests/scope ${requestId}]`, error)
    return NextResponse.json({ ok: false, error: 'Could not load your scope.', requestId }, { status: 500 })
  }
}
