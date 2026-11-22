import { NextResponse } from 'next/server'
import { createClient } from '../../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../../lib/auth/applicationAccess'
import { acceptRecovery, previewRecovery } from '../../../../../lib/mocks/recovery'
import { getReport, ReportError } from '../../../../../lib/mocks/reportService'
import type { RecoverySelection } from '../../../../../lib/mocks/report'

export const dynamic = 'force-dynamic'

function selectionOf(raw: any): RecoverySelection | null {
  if (!raw || !Array.isArray(raw.items) || raw.items.length > 40) return null
  const items = raw.items.map((i: any) => ({ key: String(i?.key ?? ''), kind: i?.kind, outcomeId: typeof i?.outcomeId === 'string' ? i.outcomeId : undefined, readingId: typeof i?.readingId === 'string' ? i.readingId : undefined, minutes: Number(i?.minutes) }))
  return { items }
}

/**
 * Body { mode: 'preview' | 'accept', selection, fingerprint?, key?, reportVersion?, confirmRemove? }. A preview writes nothing. Accept is the one explicit command: the plan is recomputed here, a
 * changed week or report is refused with nothing written, and the same key replays its original receipt. Owner = the signed-in student; a foreign id is a 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const { id } = await params
  const body = await request.json().catch(() => null) as any
  const selection = selectionOf(body?.selection)
  if (!selection || !['preview', 'accept'].includes(body?.mode)) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  try {
    const report = await getReport(access.user.id, id)
    if (!report) return NextResponse.json({ ok: false, error: 'That report was not found.' }, { status: 404 })
    if (body.mode === 'preview') {
      const p = await previewRecovery(access.user.id, report, selection)
      return NextResponse.json(p.ok ? { ...p } : p, { status: p.ok ? 200 : 409 })
    }
    if (typeof body.fingerprint !== 'string') return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
    const confirmRemove = Array.isArray(body.confirmRemove) && body.confirmRemove.length <= 40 && body.confirmRemove.every((k: unknown) => typeof k === 'string') ? body.confirmRemove as string[] : []
    const r = await acceptRecovery(access.user.id, report, { key: body.key, selection, fingerprint: body.fingerprint, reportVersion: Number.isInteger(body.reportVersion) ? body.reportVersion : undefined, confirmRemove })
    return NextResponse.json({ ok: true, ...r, nextUrl: '/app/calendar' })
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ ok: false, code: e.code, error: e.message, ...e.extra }, { status: e.status })
    console.error('[mock-reports recovery]', e); return NextResponse.json({ ok: false, code: 'failed', error: 'Could not apply the plan. Nothing was changed.' }, { status: 500 })
  }
}
