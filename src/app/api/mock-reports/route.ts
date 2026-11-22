import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { listReports, ReportError, saveReport } from '../../../lib/mocks/reportService'

export const dynamic = 'force-dynamic'

/** The student's own reports (read-only list). */
export async function GET() {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  try { return NextResponse.json({ ok: true, reports: await listReports(access.user.id) }) }
  catch (e) { console.error('[mock-reports list]', e); return NextResponse.json({ ok: false, error: 'Your mock reports could not be loaded. Try again.' }, { status: 500 }) }
}

/**
 * Create / edit / withdraw a mock already taken. Body: { action, key, reportId?, expectedVersion?, input? }. The owner is the signed-in student, never a
 * client field; `key` makes a double click, reload or lost response one report. Nothing here creates evidence, coverage or a booking.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const body = await request.json().catch(() => null) as any
  if (!body || !['create', 'edit', 'withdraw'].includes(body.action)) return NextResponse.json({ ok: false, error: 'Invalid request.' }, { status: 400 })
  try {
    const r = await saveReport(access.user.id, { action: body.action, key: body.key, reportId: body.reportId ?? null, expectedVersion: Number.isInteger(body.expectedVersion) ? body.expectedVersion : null, input: body.input })
    return NextResponse.json({ ok: true, replayed: r.replayed, report: r.report, nextUrl: r.report.status === 'active' ? `/app/calendar/mock-report/${r.report.id}` : '/app/calendar' })
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ ok: false, code: e.code, error: e.message, ...e.extra }, { status: e.status })
    console.error('[mock-reports]', e); return NextResponse.json({ ok: false, code: 'failed', error: 'Could not save the report. Nothing was changed.' }, { status: 500 })
  }
}
