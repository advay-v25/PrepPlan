import { NextResponse } from 'next/server'
import { createClient } from '../supabase/server'
import { getReviewer } from './reviewAccess'

/** Auth for reviewer routes. Returns the user's own client so database commands run as the reviewer. */
export async function reviewerRoute() {
  const rv = await getReviewer()
  if (rv.userId) return { ok: true as const, userId: rv.userId, supabase: await createClient() }
  const signedIn = 'signedIn' in rv && rv.signedIn
  return { ok: false as const, response: NextResponse.json({ ok: false, error: signedIn ? 'You are not a reviewer for this curriculum' : 'Unauthorized' }, { status: signedIn ? 403 : 401 }) }
}

const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, BAD_DECISION: 400, NOTE_REQUIRED: 400, INVALID: 400, BAD_REQUEST: 400, RATIONALE_REQUIRED: 400, RATIONALE_TOO_LONG: 400, BAD_KEY: 400, KEY_CONFLICT: 409 }

/** Maps a database command result ({ok, code, message}) to an HTTP response without hiding the reason. */
export function commandResponse(data: any, error: { message: string } | null) {
  if (error) return NextResponse.json({ ok: false, error: 'The command failed. Nothing was changed.', detail: error.message }, { status: 500 })
  if (data?.ok) return NextResponse.json(data)
  return NextResponse.json({ ...data, error: data?.message ?? 'Not allowed' }, { status: STATUS[data?.code] ?? 409 })
}
