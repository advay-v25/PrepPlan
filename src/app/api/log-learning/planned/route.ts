import { NextResponse } from 'next/server'
import { createClient } from '../../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../../lib/auth/applicationAccess'
import { PlannedLogError, plannedLogSchema, recordPlannedLog } from '../../../../lib/learning/plannedLog'

export const dynamic = 'force-dynamic'

/** Log a session against one owned planned block: minutes, status, explicit coverage and history in one command. */
export async function POST(request: Request) {
  const db = await createClient()
  const access = await requireApplicationAccess(db)
  if (!access.ok) return access.response
  const parsed = plannedLogSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ ok: false, code: 'INVALID_INPUT', error: 'Choose a block, a status and valid optional minutes (1–720).' }, { status: 400 })
  try { return NextResponse.json(await recordPlannedLog(db, access.user.id, parsed.data)) }
  catch (error) {
    if (error instanceof PlannedLogError) return NextResponse.json({ ok: false, code: error.code, error: error.message, ...(error.current ? { current: error.current } : {}) }, { status: error.status })
    return NextResponse.json({ ok: false, code: 'SAVE_UNCONFIRMED', error: 'Could not confirm the save. Retry the same log to check safely.' }, { status: 503 })
  }
}
