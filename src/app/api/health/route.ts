import { NextResponse } from 'next/server'
import { createAdminClient } from '../../../lib/supabase/admin'
import { SUPPORT_EMAIL } from '../../../lib/support'
import { hasBearer } from '../../../lib/auth/securityServer'
import { boundedStage } from '../../../lib/ops/requestBudget'

export const dynamic = 'force-dynamic'

/** The public probe performs no remote operations. Readiness is for the deployment monitor. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  if (url.searchParams.get('diag') === '1') {
    return NextResponse.json({
      ok: true,
      env: {
        hasSupabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasSupabaseAnonKey: !!(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
        hasSupabaseSecretKey: !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
        hasAppSecuritySecret: !!process.env.APP_SECURITY_SECRET,
        appSecuritySecretLen: (process.env.APP_SECURITY_SECRET ?? '').length,
        supabaseSecretKeyLen: (process.env.SUPABASE_SECRET_KEY ?? '').length,
        supabaseServiceRoleKeyLen: (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').length,
        hasHealthcheckSecret: !!process.env.HEALTHCHECK_SECRET,
        hasCronSecret: !!process.env.CRON_SECRET,
        hasTurnstileSiteKey: !!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        hasTurnstileSecretKey: !!process.env.TURNSTILE_SECRET_KEY,
        hasResendApiKey: !!process.env.RESEND_API_KEY,
        hasResendFromEmail: !!process.env.RESEND_FROM_EMAIL,
        googleSignIn: process.env.NEXT_PUBLIC_GOOGLE_SIGN_IN === '1',
        siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
      }
    }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (url.searchParams.get('ready') !== '1') {
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (!hasBearer(request, process.env.HEALTHCHECK_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  const started = Date.now()
  const out: Record<string, unknown> = { revision: process.env.RELEASE_REVISION ?? 'unset', time: new Date().toISOString() }
  let ok = true
  try {
    const admin = createAdminClient()
    const [{ data: latest, error }, { data: adm, error: admissionError }] = await boundedStage('readiness', 4000, () => Promise.all([
      admin.from('schema_migrations').select('version').order('version', { ascending: false }).limit(1),
      admin.from('beta_settings').select('value').eq('key', 'admission').maybeSingle(),
    ]))
    if (error || admissionError) throw error ?? admissionError
    out.database = 'ok'; out.schemaVersion = latest?.[0]?.version ?? null; out.admission = adm?.value ?? 'unknown'
    if (process.env.EXPECTED_SCHEMA_VERSION && out.schemaVersion !== process.env.EXPECTED_SCHEMA_VERSION) { out.schema = 'mismatch'; ok = false } else out.schema = 'ok'
  } catch { out.database = 'unreachable'; ok = false }
  out.config = { supportContact: !!SUPPORT_EMAIL, emailProvider: !!(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL), reminderWorker: !!process.env.CRON_SECRET, siteUrl: !!process.env.NEXT_PUBLIC_SITE_URL, coachModel: !!process.env.NVIDIA_API_KEY }
  out.ms = Date.now() - started
  return NextResponse.json({ ok, ...out }, { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
