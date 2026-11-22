import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { buildExport } from '../../../../lib/account/export'
import { rateLimit } from '../../../../lib/auth/securityServer'

export const dynamic = 'force-dynamic'

/** Download of the signed-in student's own data (JSON). Needs a signed-in, verified account; nothing else is readable through it. */
export async function GET() {
  const { data: { user } } = await (await createClient()).auth.getUser()
  if (!user || !user.email_confirmed_at) return NextResponse.json({ error: 'Sign in to export your data.' }, { status: 401 })
  const limited = await rateLimit('account_export', user.id)
  if (limited) return limited
  try {
    const body = JSON.stringify(await buildExport(user.id, user.email ?? null), null, 1)
    return new NextResponse(body, { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="roadmap-export-${new Date().toISOString().slice(0, 10)}.json"`, 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[account export]', e)
    return NextResponse.json({ error: 'The export could not be prepared. Nothing was changed; try again.' }, { status: 500 })
  }
}
