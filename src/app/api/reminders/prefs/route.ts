import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { deliveryConfigured, loadPrefs, savePrefs } from '../../../../lib/reminders/service'

export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await requireApplicationAccess(await createClient()); if (!a.ok) return a.response
  try { return NextResponse.json({ ok: true, prefs: await loadPrefs(a.user.id), delivery: deliveryConfigured() ? 'configured' : 'not_configured' }) }
  catch { return NextResponse.json({ ok: false, error: 'Your reminder choices could not be loaded. Nothing was changed.' }, { status: 503 }) }
}
/** Opt in or out: { assessmentReminders?, weeklyReviewReminders?, quietStart?, quietEnd? }. Turning both off cancels every pending reminder. */
export async function PUT(request: Request) {
  const a = await requireApplicationAccess(await createClient()); if (!a.ok) return a.response
  const b = await request.json().catch(() => null) as any
  if (!b || typeof b !== 'object') return NextResponse.json({ ok: false, error: 'Send your choices as an object.' }, { status: 400 })
  try {
    const r = await savePrefs(a.user.id, {
      assessmentReminders: typeof b.assessmentReminders === 'boolean' ? b.assessmentReminders : undefined,
      weeklyReviewReminders: typeof b.weeklyReviewReminders === 'boolean' ? b.weeklyReviewReminders : undefined,
      quietStart: typeof b.quietStart === 'string' ? b.quietStart : undefined, quietEnd: typeof b.quietEnd === 'string' ? b.quietEnd : undefined })
    return NextResponse.json({ ok: true, prefs: r.prefs, saved: true, confirmed: r.prefs !== null, sync: r.sync, delivery: deliveryConfigured() ? 'configured' : 'not_configured' })
  } catch (e) { const m = (e as Error).message; return NextResponse.json({ ok: false, error: m }, { status: /look like/.test(m) ? 400 : 503 }) }
}
