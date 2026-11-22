import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '../supabase/server'
import { createAdminClient } from '../supabase/admin'
import { requireApplicationAccess } from '../auth/applicationAccess'
import { validPaperId } from './paperLinks'
import { recordFailure } from '../ops/routeFailure'

export type OwnedAttempt = {
  id: string; status: string; form_id: string; attempt_kind: string | null; paper_kind: string | null
  rehearsal_id: string | null; session_no: number | null; time_limit_minutes: number | null; deadline_at: string | null; paused_at: string | null; paused_seconds: number; started_at: string | null; submitted_at: string | null
}
export const LEVEL_TO_NUM = { low: 1, medium: 3, high: 5 } as const
export const NUM_TO_LEVEL = (n: number | null): 'low' | 'medium' | 'high' | null => (n === null || n === undefined ? null : n <= 2 ? 'low' : n === 3 ? 'medium' : 'high')

/** The verified, onboarded user and their own attempt (RLS through the user's client), or an HTTP error. */
export async function withOwnedAttempt(attemptId: string): Promise<
  | { ok: true; supabase: SupabaseClient; userId: string; attempt: OwnedAttempt; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const access = await requireApplicationAccess(supabase)
  if (!access.ok) return { ok: false, response: NextResponse.json(await access.response.json(), { status: access.response.status }) }
  const user = access.user
  if (!validPaperId(attemptId)) return { ok: false, response: NextResponse.json({ ok: false, error: 'Attempt not found' }, { status: 404 }) }
  const { data: attempt, error } = await supabase.from('assessment_attempts')
    .select('id, status, form_id, attempt_kind, paper_kind, rehearsal_id, session_no, time_limit_minutes, deadline_at, paused_at, paused_seconds, started_at, submitted_at')
    .eq('id', attemptId).eq('user_id', user.id).maybeSingle()
  if (error) {
    const requestId = recordFailure('paper.access', error, 503)
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Your paper could not be checked. Try again.', requestId }, { status: 503 }) }
  }
  if (!attempt) return { ok: false, response: NextResponse.json({ ok: false, error: 'Attempt not found' }, { status: 404 }) }
  return { ok: true, supabase, userId: user.id, attempt: attempt as OwnedAttempt, admin: createAdminClient() }
}
