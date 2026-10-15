import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '../supabase/server'
import { createAdminClient } from '../supabase/admin'

export type OwnedAttempt = {
  id: string; status: string; form_id: string; attempt_kind: string | null; paper_kind: string | null
  time_limit_minutes: number | null; deadline_at: string | null; paused_at: string | null; paused_seconds: number; started_at: string | null; submitted_at: string | null
}
export const LEVEL_TO_NUM = { low: 1, medium: 3, high: 5 } as const
export const NUM_TO_LEVEL = (n: number | null): 'low' | 'medium' | 'high' | null => (n === null || n === undefined ? null : n <= 2 ? 'low' : n === 3 ? 'medium' : 'high')

/** The signed-in user and their own attempt (RLS through the user's client), or an HTTP error. */
export async function withOwnedAttempt(attemptId: string): Promise<
  | { ok: true; supabase: SupabaseClient; userId: string; attempt: OwnedAttempt; admin: ReturnType<typeof createAdminClient> }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) }
  const { data: attempt } = await supabase.from('assessment_attempts')
    .select('id, status, form_id, attempt_kind, paper_kind, time_limit_minutes, deadline_at, paused_at, paused_seconds, started_at, submitted_at')
    .eq('id', attemptId).eq('user_id', user.id).maybeSingle()
  if (!attempt) return { ok: false, response: NextResponse.json({ ok: false, error: 'Attempt not found' }, { status: 404 }) }
  return { ok: true, supabase, userId: user.id, attempt: attempt as OwnedAttempt, admin: createAdminClient() }
}
