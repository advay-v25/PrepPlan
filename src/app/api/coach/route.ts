import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '../../../lib/supabase/server'
import { requireApplicationAccess } from '../../../lib/auth/applicationAccess'
import { runTurn } from '../../../lib/coach/turn'

export const dynamic = 'force-dynamic'

// `intent` is an untrusted hint from a quick action; it can only choose among intents the message itself carries (see resolveIntent).
const bodySchema = z.object({
  message: z.string().trim().min(1).max(1500),
  intent: z.string().max(40).optional(),
  attemptId: z.string().uuid().optional(),
  taskId: z.string().min(1).max(80).optional(),
  reportId: z.string().uuid().optional(),
  readingId: z.string().regex(/^[A-Za-z0-9_.:-]{1,80}$/).optional(),
  turnKey: z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return access.response
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Write a question under 1,500 characters.' }, { status: 400 })
  const { message, intent, attemptId, taskId, readingId, reportId, turnKey } = parsed.data
  const r = await runTurn({ userId: access.user.id, db: supabase, message, hint: intent, attemptId, taskId, readingId, reportId, turnKey })
  return NextResponse.json(r.body, { status: r.status })
}
