import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { createAdminClient } from '../../../../lib/supabase/admin'
import { buildCalendarExport, parseExportOptions, ExportInputError, todayInZone } from '../../../../lib/calendar/exportService'
import { buildIcs } from '../../../../lib/calendar/ics'

export const dynamic = 'force-dynamic'
const H = { 'Cache-Control': 'private, no-store' }

/**
 * Read-only one-way .ics snapshot of the signed-in student's accepted schedule. The account is the session's, never a parameter.
 * ?from&to (default: this week plus four), ?classes=1 (actual classes / protected commitments), ?history=1 (completed work, labelled "(done)"), ?preview=1 (counts only).
 */
export async function GET(request: Request) {
  const access = await requireApplicationAccess(await createClient())
  if (!access.ok) return access.response
  const url = new URL(request.url)
  try {
    const { data: prof } = await createAdminClient().from('profiles').select('timezone').eq('id', access.user.id).maybeSingle().throwOnError()
    const opts = parseExportOptions(url.searchParams, todayInZone((prof?.timezone as string) || 'UTC'))
    const { events, preview } = await buildCalendarExport(access.user.id, opts, url.origin)
    if (url.searchParams.get('preview') === '1') return NextResponse.json({ ok: true, preview }, { headers: H })
    const body = buildIcs(access.user.id, events, { name: 'PrepPlan schedule (snapshot)' })
    return new NextResponse(body, { headers: { ...H, 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="roadmap-schedule-${opts.from}-to-${opts.to}.ics"` } })
  } catch (e) {
    if (e instanceof ExportInputError) return NextResponse.json({ ok: false, error: e.message }, { status: 400, headers: H })
    console.error('[calendar export]', e)
    return NextResponse.json({ ok: false, error: 'The calendar could not be prepared. Nothing was changed; try again.' }, { status: 500, headers: H })
  }
}
